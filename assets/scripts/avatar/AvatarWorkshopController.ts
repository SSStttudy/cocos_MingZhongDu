import {
    _decorator,
    assetManager,
    Component,
    EventTouch,
    ImageAsset,
    Label,
    Node,
    Sprite,
    SpriteFrame,
    Texture2D,
    director,
} from 'cc';
import {
    AvatarJob,
    clearPendingAvatarJob,
    createAvatarJobFromBlob,
    createAvatarJobFromWechatFile,
    getAvatarJob,
    loadPendingAvatarJob,
    savePendingAvatarJob,
} from './AvatarGenerationClient';
import {
    createPackagedAnimatedPresetManifest,
    loadAvatarFrame,
    loadAvatarProfile,
    saveAvatarProfile,
} from './AvatarProfileStore';

const { ccclass, property } = _decorator;

type WechatTempFile = { tempFilePath?: string; size?: number };
type WechatMediaResult = { tempFiles?: WechatTempFile[]; tempFilePaths?: string[] };
type WechatMediaApi = {
    chooseMedia?: (options: Record<string, unknown>) => void;
    chooseImage?: (options: Record<string, unknown>) => void;
};

const PRESET_ANIMATION_ROOTS = [
    'characters/modern-explorer',
    'characters/vermillion-explorer',
    'characters/jade-explorer',
];
const PRESET_NAMES = ['蓝衫少年', '赤衣旅者', '青衣行者'];

/**
 * 场景中的视觉节点全部由 AvatarWorkshop.scene 静态搭建；本组件只负责
 * 选择照片、提交任务、轮询进度、保存资源清单和切换场景。
 */
@ccclass('AvatarWorkshopController')
export class AvatarWorkshopController extends Component {
    @property(Sprite)
    previewSprite: Sprite | null = null;

    @property(Label)
    statusTitle: Label | null = null;

    @property(Label)
    statusDetails: Label | null = null;

    @property({ type: [Node], tooltip: '在场景中摆放好的三个默认角色卡片。' })
    presetCards: Node[] = [];

    @property({ type: [SpriteFrame], tooltip: '与 presetCards 按相同顺序绑定。' })
    presetFrames: SpriteFrame[] = [];

    @property(Node)
    choosePhotoButton: Node | null = null;

    @property(Node)
    generateButton: Node | null = null;

    @property(Node)
    playButton: Node | null = null;

    @property(Node)
    backButton: Node | null = null;

    @property({ tooltip: '生产环境填写 HTTPS 服务地址；API 密钥只能保存在服务器。' })
    apiBaseUrl = '';

    @property({ tooltip: '开启后，没有服务地址时可在网页预览中演示上传与生成流程。' })
    demoMode = true;

    @property({ tooltip: '发送给后端的可调整风格标识。' })
    stylePreset = 'ming-zhongdu-traveler';

    @property({ tooltip: '查询异步生成任务的间隔（秒）。', min: 0.5 })
    pollIntervalSeconds = 2;

    @property({ tooltip: '生成任务最长等待时间（秒）。', min: 30 })
    jobTimeoutSeconds = 240;

    private selectedPhotoPath = '';
    private selectedPhotoBlob: Blob | null = null;
    private previewObjectUrl = '';
    private currentJobId = '';
    private polling = false;
    private generating = false;
    private jobStartedAt = 0;
    private selectedPreset = 0;

    onLoad(): void {
        this.presetCards.forEach((card, index) => {
            card.on(Node.EventType.TOUCH_END, () => this.selectPreset(index), this);
        });
        this.choosePhotoButton?.on(Node.EventType.TOUCH_END, this.choosePhoto, this);
        this.generateButton?.on(Node.EventType.TOUCH_END, this.generateAvatar, this);
        this.playButton?.on(Node.EventType.TOUCH_END, this.enterGame, this);
        this.backButton?.on(Node.EventType.TOUCH_END, this.backToStart, this);

        const saved = loadAvatarProfile();
        if (saved) void this.refreshPreview();
        else this.selectPreset(0);
        const pending = loadPendingAvatarJob();
        if (pending && this.apiBaseUrl.trim() && pending.baseUrl === this.apiBaseUrl.trim()) {
            this.currentJobId = pending.jobId;
            this.polling = true;
            this.generating = true;
            this.jobStartedAt = Date.now();
            this.setStatus('正在恢复生成任务', '已找到上次提交的任务，正在查询服务器进度。');
            this.scheduleOnce(() => void this.pollJob(), 0.2);
        }
    }

    onDestroy(): void {
        this.polling = false;
        if (this.previewObjectUrl && typeof URL !== 'undefined') URL.revokeObjectURL(this.previewObjectUrl);
    }

    private selectPreset(index: number): void {
        const frame = this.presetFrames[index];
        const animationRoot = PRESET_ANIMATION_ROOTS[index];
        if (!frame || !animationRoot || !this.previewSprite) return;
        this.selectedPreset = index;
        this.previewSprite.spriteFrame = frame;
        this.selectedPhotoPath = '';
        this.selectedPhotoBlob = null;
        const profile = createPackagedAnimatedPresetManifest(
            animationRoot,
            PRESET_NAMES[index] ?? `默认角色 ${index + 1}`,
        );
        saveAvatarProfile(profile);
        this.setStatus('默认角色已启用', `${profile.displayName} 已保存，返回游戏后会立即使用这个形象。`);
    }

    private async choosePhoto(event?: EventTouch): Promise<void> {
        this.stopTouch(event);
        if (this.generating) return;
        try {
            const wx = (globalThis as unknown as { wx?: WechatMediaApi }).wx;
            if (wx?.chooseMedia || wx?.chooseImage) {
                const path = await this.chooseWechatPhoto(wx);
                this.selectedPhotoPath = path;
                this.selectedPhotoBlob = null;
                await this.showPhoto(path, '.jpg');
            } else {
                const file = await this.chooseBrowserPhoto();
                this.selectedPhotoBlob = file;
                this.selectedPhotoPath = '';
                if (this.previewObjectUrl) URL.revokeObjectURL(this.previewObjectUrl);
                this.previewObjectUrl = URL.createObjectURL(file);
                await this.showPhoto(this.previewObjectUrl, file.type === 'image/png' ? '.png' : '.jpg');
            }
            this.setStatus('全身照已选择', '确认人物完整入镜后点击“开始生成”。照片只会在你确认后上传。');
        } catch (error) {
            this.setStatus('没有选择照片', this.errorMessage(error));
        }
    }

    private chooseWechatPhoto(wx: WechatMediaApi): Promise<string> {
        return new Promise((resolve, reject) => {
            const success = (result: WechatMediaResult) => {
                const path = result.tempFiles?.[0]?.tempFilePath ?? result.tempFilePaths?.[0];
                if (path) resolve(path);
                else reject(new Error('没有取得照片文件。'));
            };
            const fail = (error: { errMsg?: string }) => reject(new Error(error.errMsg ?? '照片选择已取消。'));
            if (wx.chooseMedia) {
                wx.chooseMedia({
                    count: 1,
                    mediaType: ['image'],
                    sourceType: ['camera', 'album'],
                    sizeType: ['compressed'],
                    success,
                    fail,
                });
            } else {
                wx.chooseImage!({ count: 1, sourceType: ['camera', 'album'], sizeType: ['compressed'], success, fail });
            }
        });
    }

    private chooseBrowserPhoto(): Promise<File> {
        return new Promise((resolve, reject) => {
            if (typeof document === 'undefined') {
                reject(new Error('当前平台不支持照片选择。'));
                return;
            }
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/jpeg,image/png,image/webp';
            input.onchange = () => {
                const file = input.files?.[0];
                if (!file) {
                    reject(new Error('照片选择已取消。'));
                    return;
                }
                if (file.size > 10 * 1024 * 1024) {
                    reject(new Error('照片不能超过 10 MB。'));
                    return;
                }
                resolve(file);
            };
            input.click();
        });
    }

    private showPhoto(path: string, ext: string): Promise<void> {
        if (!this.previewSprite) return Promise.resolve();
        return new Promise((resolve, reject) => {
            assetManager.loadRemote<ImageAsset>(path, { ext }, (error, image) => {
                if (error || !image) {
                    reject(error ?? new Error('照片预览加载失败。'));
                    return;
                }
                const texture = new Texture2D();
                texture.image = image;
                const frame = new SpriteFrame();
                frame.texture = texture;
                if (this.previewSprite) this.previewSprite.spriteFrame = frame;
                resolve();
            });
        });
    }

    private async generateAvatar(event?: EventTouch): Promise<void> {
        this.stopTouch(event);
        if (this.generating) return;
        if (!this.selectedPhotoPath && !this.selectedPhotoBlob) {
            this.setStatus('请先选择全身照', '建议正面站立、全身完整入镜、背景简单且光线均匀。');
            return;
        }

        this.generating = true;
        this.jobStartedAt = Date.now();
        try {
            if (!this.apiBaseUrl.trim()) {
                if (!this.demoMode) throw new Error('尚未配置角色生成服务地址。');
                await this.runDemoGeneration();
                return;
            }

            this.setStatus('正在上传全身照', '上传成功后服务器会生成四方向待机、行走和奔跑动画。');
            const request = {
                baseUrl: this.apiBaseUrl,
                displayName: '我的明中都角色',
                stylePreset: this.stylePreset,
            };
            const job = this.selectedPhotoPath
                ? await createAvatarJobFromWechatFile(this.selectedPhotoPath, request)
                : await createAvatarJobFromBlob(this.selectedPhotoBlob!, request);
            this.currentJobId = job.jobId;
            savePendingAvatarJob(job.jobId, this.apiBaseUrl.trim());
            await this.handleJob(job);
        } catch (error) {
            this.generating = false;
            this.setStatus('提交生成失败', this.errorMessage(error));
        }
    }

    private async runDemoGeneration(): Promise<void> {
        this.setStatus('演示模式：正在分析照片', '正在提取服装轮廓与人物比例…… 20%');
        await this.delay(0.8);
        if (!this.node.isValid) return;
        this.setStatus('演示模式：正在生成角色', '正在绘制明中都主题服饰与四方向动作…… 55%');
        await this.delay(0.9);
        if (!this.node.isValid) return;
        this.setStatus('演示模式：正在整理动画', '正在校准透明画布、脚底锚点与行走帧…… 85%');
        await this.delay(0.8);
        if (!this.node.isValid) return;

        const animationRoot = PRESET_ANIMATION_ROOTS[this.selectedPreset] ?? PRESET_ANIMATION_ROOTS[0];
        const manifest = createPackagedAnimatedPresetManifest(
            animationRoot,
            'AI 演示角色',
            'local-demo-provider',
        );
        saveAvatarProfile(manifest);
        if (this.previewSprite) this.previewSprite.spriteFrame = this.presetFrames[this.selectedPreset] ?? this.presetFrames[0];
        this.generating = false;
        this.setStatus('演示角色已生成并保存', '这是无 API 的汇报演示流程；配置服务器地址后将替换为真实四方向动画。');
    }

    private delay(seconds: number): Promise<void> {
        return new Promise((resolve) => this.scheduleOnce(resolve, seconds));
    }

    private async handleJob(job: AvatarJob): Promise<void> {
        if (job.status === 'succeeded' && job.avatar) {
            saveAvatarProfile(job.avatar);
            clearPendingAvatarJob();
            this.polling = false;
            this.generating = false;
            clearPendingAvatarJob();
            await this.refreshPreview();
            this.setStatus('专属角色已生成并保存', '进入游戏后，所有场景都会使用这套四方向待机、行走和奔跑动画。');
            return;
        }
        if (job.status === 'failed') {
            this.polling = false;
            this.generating = false;
            this.setStatus('角色生成失败', job.message ?? '请重新选择清晰的全身照。');
            return;
        }
        this.setStatus('正在生成专属角色', job.message ?? `当前进度 ${job.progress ?? 0}%`);
        if (!this.polling) {
            this.polling = true;
            this.scheduleOnce(() => void this.pollJob(), this.pollIntervalSeconds);
        }
    }

    private async pollJob(): Promise<void> {
        if (!this.polling || !this.currentJobId || !this.node.isValid) return;
        if ((Date.now() - this.jobStartedAt) / 1000 > this.jobTimeoutSeconds) {
            this.polling = false;
            this.generating = false;
            this.setStatus('生成等待超时', '任务可能仍在服务器执行，请稍后重新进入角色工坊查询。');
            return;
        }
        try {
            const job = await getAvatarJob(this.apiBaseUrl, this.currentJobId);
            if (job.status === 'queued' || job.status === 'running') {
                this.setStatus('正在生成专属角色', job.message ?? `当前进度 ${job.progress ?? 0}%`);
                this.scheduleOnce(() => void this.pollJob(), this.pollIntervalSeconds);
                return;
            }
            await this.handleJob(job);
        } catch (error) {
            this.polling = false;
            this.generating = false;
            this.setStatus('无法查询生成进度', this.errorMessage(error));
        }
    }

    private async refreshPreview(): Promise<void> {
        const profile = loadAvatarProfile();
        if (!profile || !this.previewSprite) return;
        try {
            this.previewSprite.spriteFrame = await loadAvatarFrame(profile.previewUrl);
            this.setStatus('已加载保存的角色', `${profile.displayName} 将在全部游戏场景中使用。`);
        } catch (error) {
            this.setStatus('保存的角色暂时不可用', this.errorMessage(error));
        }
    }

    private enterGame(event?: EventTouch): void {
        this.stopTouch(event);
        director.loadScene('Overworld');
    }

    private backToStart(event?: EventTouch): void {
        this.stopTouch(event);
        if (!this.generating) director.loadScene('Start');
    }

    private setStatus(title: string, details: string): void {
        if (this.statusTitle) this.statusTitle.string = title;
        if (this.statusDetails) this.statusDetails.string = details;
    }

    private stopTouch(event?: EventTouch): void {
        if (event) event.propagationStopped = true;
    }

    private errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : '发生未知错误，请重试。';
    }
}
