import { AudioClip, director, resources, SpriteFrame } from 'cc';

export type InitialWarmupProgress = {
    ratio: number;
    label: string;
    completedGroups: number;
    totalGroups: number;
};

export type InitialWarmupResult = {
    failures: string[];
};

type WarmupJob = {
    key: string;
    label: string;
    weight: number;
    run: (report: (ratio: number) => void) => Promise<boolean>;
};

const JOB_TIMEOUT_MS = 45_000;

/**
 * 首屏只等待首段导览真正会用到的约 25 MiB 资源。
 * 其余地点按导览顺序单线程后台预取，避免一次解码全部 100+ MiB 图片导致手机内存峰值过高。
 */
export class InitialResourcePreloader {
    private static criticalPromise: Promise<InitialWarmupResult> | null = null;
    private static criticalResult: InitialWarmupResult | null = null;
    private static readonly listeners = new Set<(progress: InitialWarmupProgress) => void>();
    private static backgroundStarted = false;

    static warmupCritical(
        listener?: (progress: InitialWarmupProgress) => void,
    ): Promise<InitialWarmupResult> {
        if (listener) this.listeners.add(listener);
        if (this.criticalResult) {
            listener?.({ ratio: 1, label: '关键资源已缓存', completedGroups: 1, totalGroups: 1 });
            return Promise.resolve({ failures: [...this.criticalResult.failures] });
        }
        if (!this.criticalPromise) {
            this.criticalPromise = this.runJobs(this.createCriticalJobs(), true).then((result) => {
                this.criticalResult = result;
                return result;
            });
        }
        return this.criticalPromise.then(
            (result) => {
                if (listener) this.listeners.delete(listener);
                return result;
            },
            (error) => {
                if (listener) this.listeners.delete(listener);
                throw error;
            },
        );
    }

    /** 关键资源完成后继续低并发预取剩余路线；不阻塞玩家进入游戏。 */
    static warmupRemainingRoute(): void {
        if (this.backgroundStarted) return;
        this.backgroundStarted = true;
        void this.runJobs(this.createBackgroundJobs(), false).then((result) => {
            if (result.failures.length > 0) {
                console.warn('[ResourceWarmup] 部分后续资源将在进入场景时重试：', result.failures);
            } else {
                console.log('[ResourceWarmup] 全路线视觉资源后台预取完成。');
            }
        });
    }

    private static createCriticalJobs(): WarmupJob[] {
        return [
            this.sceneJob('scene-overworld', '准备俯瞰地图', 'Overworld', 1),
            this.sceneJob('scene-visitor-center', '准备游客中心场景', 'LocationTemplate', 1),
            this.directoryJob('map', '下载俯瞰地图', 'map', 3),
            this.directoryJob(
                'character-modern',
                '下载角色行走动画',
                'characters/modern-explorer',
                8,
            ),
            this.directoryJob('guide-ui', '准备导览与放大镜', 'ui', 2),
            this.loadedDirectoryJob(
                'visitor-scenes',
                '载入游客中心画面',
                'locations/visitor-center/scenes',
                9,
            ),
            this.directoryJob(
                'visitor-interactions',
                '准备游客中心讲解',
                'interactions/visitor-center',
                1,
            ),
            this.audioDirectoryJob('background-music', '缓存导览背景音乐', 'audio', 4),
            this.directoryJob('fragments', '准备碎片线索', 'fragments', 3),
        ];
    }

    private static createBackgroundJobs(): WarmupJob[] {
        return [
            this.sceneJob('scene-west-gate', '预取西门场景', 'Location4', 1),
            this.directoryJob('west-gate-scenes', '预取西门画面', 'locations/location-4', 10),
            this.directoryJob('west-gate-info', '预取西门讲解', 'interactions/west-gate', 3),
            this.sceneJob('scene-stone-base', '预取石础场景', 'Location2', 1),
            this.directoryJob('stone-base-scenes', '预取石础画面', 'locations/location-2', 16),
            this.directoryJob('stone-base-info', '预取石础讲解', 'interactions/stone-base', 2),
            this.sceneJob('scene-well', '预取古井场景', 'Location2_5', 1),
            this.directoryJob('well-scenes', '预取古井画面', 'locations/location-2-5', 4),
            this.sceneJob('scene-wumen', '预取午门场景', 'Location3', 1),
            this.directoryJob('wumen-scenes', '预取午门画面', 'locations/location-3', 29),
            this.directoryJob('wumen-info', '预取午门讲解', 'interactions/wumen', 3),
        ];
    }

    private static async runJobs(jobs: WarmupJob[], visible: boolean): Promise<InitialWarmupResult> {
        const failures: string[] = [];
        const totalWeight = jobs.reduce((sum, job) => sum + job.weight, 0);
        let completedWeight = 0;
        for (let index = 0; index < jobs.length; index += 1) {
            const job = jobs[index];
            const report = (partial: number): void => {
                if (!visible) return;
                const ratio = (completedWeight + job.weight * this.clamp01(partial)) / totalWeight;
                this.emit({
                    ratio,
                    label: job.label,
                    completedGroups: index,
                    totalGroups: jobs.length,
                });
            };
            report(0);
            const succeeded = await job.run(report);
            if (!succeeded) failures.push(job.label);
            completedWeight += job.weight;
            report(1);
            // 单线程分组预取，主动让出一帧，避免解码连续占满主线程。
            await new Promise<void>((resolve) => setTimeout(resolve, 16));
        }
        if (visible) {
            this.emit({
                ratio: 1,
                label: failures.length > 0 ? '基础资源已就绪，缺失项进入场景后重试' : '资源准备完成',
                completedGroups: jobs.length,
                totalGroups: jobs.length,
            });
        }
        return { failures };
    }

    private static directoryJob(
        key: string,
        label: string,
        path: string,
        weight: number,
    ): WarmupJob {
        return {
            key,
            label,
            weight,
            run: (report) => new Promise<boolean>((resolve) => {
                let settled = false;
                let timer: ReturnType<typeof setTimeout> | null = null;
                const finish = (success: boolean): void => {
                    if (settled) return;
                    settled = true;
                    if (timer) clearTimeout(timer);
                    resolve(success);
                };
                const armTimeout = (): void => {
                    if (timer) clearTimeout(timer);
                    timer = setTimeout(() => {
                        console.warn(`[ResourceWarmup] ${label} 长时间无进度，将在需要时重试。`);
                        finish(false);
                    }, JOB_TIMEOUT_MS);
                };
                armTimeout();
                resources.preloadDir(
                    path,
                    SpriteFrame,
                    (completed, total) => {
                        if (!settled) {
                            armTimeout();
                            report(total > 0 ? completed / total : 0);
                        }
                    },
                    (error) => {
                        if (error) console.warn(`[ResourceWarmup] ${label} 失败。`, error);
                        finish(!error);
                    },
                );
            }),
        };
    }

    /**
     * 首段场景需要在进入前完成反序列化与纹理解码。仅调用 preloadDir
     * 会把文件下载到缓存，但冷启动恢复存档时仍可能先显示数秒黑底。
     * 这里只对约 4 MiB 的游客中心画面使用 loadDir；后续大场景继续
     * 使用 preloadDir，以免一次性解码全路线图片造成手机内存峰值。
     */
    private static loadedDirectoryJob(
        key: string,
        label: string,
        path: string,
        weight: number,
    ): WarmupJob {
        return {
            key,
            label,
            weight,
            run: (report) => new Promise<boolean>((resolve) => {
                let settled = false;
                let timer: ReturnType<typeof setTimeout> | null = null;
                const finish = (success: boolean): void => {
                    if (settled) return;
                    settled = true;
                    if (timer) clearTimeout(timer);
                    resolve(success);
                };
                const armTimeout = (): void => {
                    if (timer) clearTimeout(timer);
                    timer = setTimeout(() => {
                        console.warn(`[ResourceWarmup] ${label} 长时间无进度，将在需要时重试。`);
                        finish(false);
                    }, JOB_TIMEOUT_MS);
                };
                armTimeout();
                resources.loadDir(
                    path,
                    SpriteFrame,
                    (completed, total) => {
                        if (!settled) {
                            armTimeout();
                            report(total > 0 ? completed / total : 0);
                        }
                    },
                    (error) => {
                        if (error) console.warn(`[ResourceWarmup] ${label} 失败。`, error);
                        finish(!error);
                    },
                );
            }),
        };
    }

    private static audioDirectoryJob(
        key: string,
        label: string,
        path: string,
        weight: number,
    ): WarmupJob {
        return {
            key,
            label,
            weight,
            run: (report) => new Promise<boolean>((resolve) => {
                let settled = false;
                let timer: ReturnType<typeof setTimeout> | null = null;
                const finish = (success: boolean): void => {
                    if (settled) return;
                    settled = true;
                    if (timer) clearTimeout(timer);
                    resolve(success);
                };
                const armTimeout = (): void => {
                    if (timer) clearTimeout(timer);
                    timer = setTimeout(() => {
                        console.warn(`[ResourceWarmup] ${label} 长时间无进度，将在需要时重试。`);
                        finish(false);
                    }, JOB_TIMEOUT_MS);
                };
                armTimeout();
                resources.preloadDir(
                    path,
                    AudioClip,
                    (completed, total) => {
                        if (!settled) {
                            armTimeout();
                            report(total > 0 ? completed / total : 0);
                        }
                    },
                    (error) => {
                        if (error) console.warn(`[ResourceWarmup] ${label} 失败。`, error);
                        finish(!error);
                    },
                );
            }),
        };
    }

    private static sceneJob(
        key: string,
        label: string,
        sceneName: string,
        weight: number,
    ): WarmupJob {
        return {
            key,
            label,
            weight,
            run: (report) => new Promise<boolean>((resolve) => {
                let settled = false;
                let timer: ReturnType<typeof setTimeout> | null = null;
                const finish = (success: boolean): void => {
                    if (settled) return;
                    settled = true;
                    if (timer) clearTimeout(timer);
                    resolve(success);
                };
                const armTimeout = (): void => {
                    if (timer) clearTimeout(timer);
                    timer = setTimeout(() => {
                        console.warn(`[ResourceWarmup] ${label} 长时间无进度，将在进入时重试。`);
                        finish(false);
                    }, JOB_TIMEOUT_MS);
                };
                armTimeout();
                director.preloadScene(
                    sceneName,
                    (completed, total) => {
                        if (!settled) {
                            armTimeout();
                            report(total > 0 ? completed / total : 0);
                        }
                    },
                    (error) => {
                        if (error) console.warn(`[ResourceWarmup] ${label} 失败。`, error);
                        finish(!error);
                    },
                );
            }),
        };
    }

    private static emit(progress: InitialWarmupProgress): void {
        for (const listener of this.listeners) listener(progress);
    }

    private static clamp01(value: number): number {
        return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
    }
}
