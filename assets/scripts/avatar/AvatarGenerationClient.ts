import { AvatarManifest, validateAvatarManifest } from './AvatarProfileStore';

export type AvatarGenerationStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export type AvatarJob = {
    jobId: string;
    status: AvatarGenerationStatus;
    progress?: number;
    message?: string;
    avatar?: AvatarManifest;
};

const LAST_JOB_STORAGE_KEY = 'mingzhongdu.avatar.pending-job.v1';

export type AvatarJobRequest = {
    baseUrl: string;
    displayName: string;
    stylePreset: string;
};

type WxUploadResult = { statusCode: number; data: string };
type WxUploadApi = {
    uploadFile?: (options: Record<string, unknown>) => void;
    request?: (options: Record<string, unknown>) => void;
};

function apiUrl(baseUrl: string, path: string): string {
    const normalized = baseUrl.trim().replace(/\/$/, '');
    if (!normalized) throw new Error('尚未配置角色生成服务地址。');
    return `${normalized}${path}`;
}

function parseJob(raw: unknown): AvatarJob {
    if (!raw || typeof raw !== 'object') throw new Error('角色服务返回了无效数据。');
    const job = raw as Partial<AvatarJob>;
    const statuses: AvatarGenerationStatus[] = ['queued', 'running', 'succeeded', 'failed'];
    if (typeof job.jobId !== 'string' || statuses.indexOf(job.status as AvatarGenerationStatus) < 0) {
        throw new Error('角色服务响应缺少 jobId 或 status。');
    }
    if (job.status === 'succeeded' && !validateAvatarManifest(job.avatar)) {
        throw new Error('角色已经生成，但服务返回的动画资源清单不完整。');
    }
    return job as AvatarJob;
}

export function savePendingAvatarJob(jobId: string, baseUrl: string): void {
    try {
        const value = JSON.stringify({ jobId, baseUrl, savedAt: Date.now() });
        const wx = (globalThis as unknown as { wx?: { setStorageSync?: (key: string, data: string) => void } }).wx;
        if (wx?.setStorageSync) wx.setStorageSync(LAST_JOB_STORAGE_KEY, value);
        else globalThis.localStorage?.setItem(LAST_JOB_STORAGE_KEY, value);
    } catch {
        // 任务仍可在当前页面继续轮询；持久化失败不应阻断生成。
    }
}

export function loadPendingAvatarJob(): { jobId: string; baseUrl: string } | null {
    try {
        const wx = (globalThis as unknown as { wx?: { getStorageSync?: (key: string) => unknown } }).wx;
        const raw = wx?.getStorageSync
            ? wx.getStorageSync(LAST_JOB_STORAGE_KEY)
            : globalThis.localStorage?.getItem(LAST_JOB_STORAGE_KEY);
        if (typeof raw !== 'string') return null;
        const value = JSON.parse(raw) as { jobId?: unknown; baseUrl?: unknown; savedAt?: unknown };
        if (typeof value.jobId !== 'string' || typeof value.baseUrl !== 'string') return null;
        if (typeof value.savedAt === 'number' && Date.now() - value.savedAt > 24 * 60 * 60 * 1000) return null;
        return { jobId: value.jobId, baseUrl: value.baseUrl };
    } catch {
        return null;
    }
}

export function clearPendingAvatarJob(): void {
    try {
        const wx = (globalThis as unknown as { wx?: { removeStorageSync?: (key: string) => void } }).wx;
        if (wx?.removeStorageSync) wx.removeStorageSync(LAST_JOB_STORAGE_KEY);
        else globalThis.localStorage?.removeItem(LAST_JOB_STORAGE_KEY);
    } catch {
        // 无需阻断角色保存。
    }
}

async function requestJson(url: string, options?: RequestInit): Promise<AvatarJob> {
    const response = await fetch(url, options);
    let body: unknown;
    try {
        body = await response.json();
    } catch {
        throw new Error(`角色服务响应无法解析（HTTP ${response.status}）。`);
    }
    if (!response.ok) {
        const message = (body as { message?: unknown })?.message;
        throw new Error(typeof message === 'string' ? message : `角色服务请求失败（HTTP ${response.status}）。`);
    }
    return parseJob(body);
}

export async function createAvatarJobFromBlob(
    photo: Blob,
    request: AvatarJobRequest,
): Promise<AvatarJob> {
    const form = new FormData();
    form.append('photo', photo, 'full-body-photo.jpg');
    form.append('displayName', request.displayName);
    form.append('stylePreset', request.stylePreset);
    form.append('clientPlatform', 'web-preview');
    form.append('manifestVersion', '2');
    return requestJson(apiUrl(request.baseUrl, '/v1/avatar/jobs'), { method: 'POST', body: form });
}

export function createAvatarJobFromWechatFile(
    filePath: string,
    request: AvatarJobRequest,
): Promise<AvatarJob> {
    return new Promise((resolve, reject) => {
        const wx = (globalThis as unknown as { wx?: WxUploadApi }).wx;
        if (!wx?.uploadFile) {
            reject(new Error('当前运行环境不支持微信文件上传。'));
            return;
        }
        wx.uploadFile({
            url: apiUrl(request.baseUrl, '/v1/avatar/jobs'),
            filePath,
            name: 'photo',
            formData: {
                displayName: request.displayName,
                stylePreset: request.stylePreset,
                clientPlatform: 'wechat-mini-game',
                manifestVersion: '2',
            },
            success: (result: WxUploadResult) => {
                try {
                    if (result.statusCode < 200 || result.statusCode >= 300) {
                        throw new Error(`上传失败（HTTP ${result.statusCode}）。`);
                    }
                    resolve(parseJob(JSON.parse(result.data)));
                } catch (error) {
                    reject(error);
                }
            },
            fail: (error: { errMsg?: string }) => reject(new Error(error.errMsg ?? '上传全身照失败。')),
        });
    });
}

export function getAvatarJob(baseUrl: string, jobId: string): Promise<AvatarJob> {
    const url = apiUrl(baseUrl, `/v1/avatar/jobs/${encodeURIComponent(jobId)}`);
    const wx = (globalThis as unknown as { wx?: WxUploadApi }).wx;
    if (!wx?.request) return requestJson(url);
    return new Promise((resolve, reject) => {
        wx.request!({
            url,
            method: 'GET',
            success: (result: { statusCode: number; data: unknown }) => {
                try {
                    if (result.statusCode < 200 || result.statusCode >= 300) {
                        const message = (result.data as { message?: unknown })?.message;
                        throw new Error(typeof message === 'string'
                            ? message
                            : `角色服务请求失败（HTTP ${result.statusCode}）。`);
                    }
                    const body = typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
                    resolve(parseJob(body));
                } catch (error) {
                    reject(error);
                }
            },
            fail: (error: { errMsg?: string }) => reject(new Error(error.errMsg ?? '无法查询角色任务。')),
        });
    });
}
