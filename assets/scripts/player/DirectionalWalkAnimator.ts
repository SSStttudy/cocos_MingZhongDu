import {
    _decorator,
    Component,
    resources,
    Sprite,
    SpriteFrame,
    UITransform,
    Vec2,
} from 'cc';
import {
    AvatarDirection,
    AvatarManifest,
    clearAvatarProfile,
    loadAvatarFrame,
    loadAvatarProfile,
} from '../avatar/AvatarProfileStore';

const { ccclass } = _decorator;

export type WalkDirection = 'down' | 'up' | 'left' | 'right';

const DIRECTIONS: WalkDirection[] = ['down', 'up', 'left', 'right'];
const FRAME_COUNT = 8;
const WALK_FRAME_INTERVAL = 1 / 6;
const RUN_FRAME_INTERVAL = 1 / 9;
const WALK_RESOURCE_ROOT = 'characters/modern-explorer/walk';
const RUN_RESOURCE_ROOT = 'characters/modern-explorer/run';
const IDLE_RESOURCE_ROOT = 'characters/modern-explorer/idle';
const IDLE_RESOURCE_NAME: Record<WalkDirection, string> = {
    down: 'down-idle-v2',
    up: 'up-idle-v2',
    left: 'left-idle',
    right: 'right-idle',
};
const IDLE_FRAME_INDEX: Record<WalkDirection, number> = {
    down: 5,
    up: 4,
    left: 4,
    right: 4,
};

@ccclass('DirectionalWalkAnimator')
export class DirectionalWalkAnimator extends Component {
    private readonly walkFrames = new Map<WalkDirection, SpriteFrame[]>();
    private readonly runFrames = new Map<WalkDirection, SpriteFrame[]>();
    private readonly idleFrames = new Map<WalkDirection, SpriteFrame>();
    private sprite!: Sprite;
    private direction: WalkDirection = 'down';
    private moving = false;
    private running = false;
    private elapsed = 0;
    private frameIndex = 0;
    private loadVersion = 0;
    private avatarProfile: AvatarManifest | null = null;

    onLoad(): void {
        this.sprite = this.getComponent(Sprite) ?? this.addComponent(Sprite);
        this.sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this.sprite.trim = false;
        this.applyFeetAnchor(480, 512);
        void this.loadFrames();
    }

    onDestroy(): void {
        this.loadVersion += 1;
    }

    update(deltaTime: number): void {
        const frames = this.getActiveFrames();
        if (!frames?.length || !this.moving) return;
        this.elapsed += deltaTime;
        const interval = this.running ? RUN_FRAME_INTERVAL : WALK_FRAME_INTERVAL;
        while (this.elapsed >= interval) {
            this.elapsed -= interval;
            this.frameIndex = (this.frameIndex + 1) % frames.length;
        }
        this.applyCurrentFrame();
    }

    setDisplaySize(width: number, height: number): void {
        const transform = this.getComponent(UITransform) ?? this.addComponent(UITransform);
        transform.setContentSize(width, height);
        const canvas = this.avatarProfile?.canvas;
        this.applyFeetAnchor(canvas?.feetY ?? 480, canvas?.height ?? 512);
    }

    setMovement(
        input: Readonly<Vec2>,
        actuallyMoving = input.lengthSqr() > 0.001,
        running = false,
    ): void {
        if (input.lengthSqr() > 0.001) {
            const nextDirection = Math.abs(input.x) > Math.abs(input.y)
                ? (input.x >= 0 ? 'right' : 'left')
                : (input.y >= 0 ? 'up' : 'down');
            if (nextDirection !== this.direction) {
                this.direction = nextDirection;
                this.frameIndex = 0;
                this.elapsed = 0;
            }
        }
        if (actuallyMoving !== this.moving) {
            this.moving = actuallyMoving;
            this.elapsed = 0;
        }
        const nextRunning = actuallyMoving && running;
        if (nextRunning !== this.running) {
            this.running = nextRunning;
            this.frameIndex = 0;
            this.elapsed = 0;
        }
        this.applyCurrentFrame();
    }

    stop(): void {
        this.moving = false;
        this.running = false;
        this.elapsed = 0;
        this.applyCurrentFrame();
    }

    /** 角色工坊完成任务后，可由常驻玩家节点调用以立即重新读取角色。 */
    reloadAvatarProfile(): void {
        this.walkFrames.clear();
        this.runFrames.clear();
        this.idleFrames.clear();
        this.frameIndex = 0;
        this.elapsed = 0;
        void this.loadFrames();
    }

    private async loadFrames(): Promise<void> {
        const version = ++this.loadVersion;
        this.avatarProfile = loadAvatarProfile();
        try {
            const loaded = await Promise.all(DIRECTIONS.map(async (direction) => {
                const result = this.avatarProfile
                    ? await this.loadProfileDirection(this.avatarProfile, direction)
                    : await this.loadDefaultDirection(direction);
                return [direction, ...result] as const;
            }));
            if (version !== this.loadVersion || !this.isValid) return;
            for (const [direction, walk, run, idle] of loaded) {
                this.walkFrames.set(direction, walk);
                this.runFrames.set(direction, run);
                this.idleFrames.set(direction, idle);
            }
            const canvas = this.avatarProfile?.canvas;
            this.applyFeetAnchor(canvas?.feetY ?? 480, canvas?.height ?? 512);
            this.applyCurrentFrame();
        } catch (error) {
            if (!this.avatarProfile) {
                console.error('[DirectionalWalkAnimator] 默认角色序列帧加载失败。', error);
                return;
            }
            console.warn('[DirectionalWalkAnimator] 自定义角色不可用，已自动恢复默认角色。', error);
            clearAvatarProfile();
            this.avatarProfile = null;
            if (version === this.loadVersion) void this.loadFrames();
        }
    }

    private async loadProfileDirection(
        profile: AvatarManifest,
        direction: AvatarDirection,
    ): Promise<[SpriteFrame[], SpriteFrame[], SpriteFrame]> {
        const walkLocators = profile.walk[direction];
        const runLocators = profile.run?.[direction] ?? walkLocators;
        const idleLocator = profile.idle[direction];
        const [walk, run, idle] = await Promise.all([
            Promise.all(walkLocators.map(loadAvatarFrame)),
            Promise.all(runLocators.map(loadAvatarFrame)),
            loadAvatarFrame(idleLocator),
        ]);
        return [walk, run, idle];
    }

    private async loadDefaultDirection(
        direction: WalkDirection,
    ): Promise<[SpriteFrame[], SpriteFrame[], SpriteFrame]> {
        const paths = (root: string): Promise<SpriteFrame[]> => Promise.all(
            Array.from({ length: FRAME_COUNT }, (_, index) => {
                const frameNumber = index < 10 ? `0${index}` : `${index}`;
                return this.loadSpriteFrame(`${root}/${direction}/${direction}-${frameNumber}/spriteFrame`);
            }),
        );
        const [walk, run, idle] = await Promise.all([
            paths(WALK_RESOURCE_ROOT),
            paths(RUN_RESOURCE_ROOT).catch((error) => {
                console.warn('[DirectionalWalkAnimator] 奔跑序列加载失败，将复用行走序列。', error);
                return [] as SpriteFrame[];
            }),
            this.loadSpriteFrame(`${IDLE_RESOURCE_ROOT}/${IDLE_RESOURCE_NAME[direction]}/spriteFrame`),
        ]);
        return [walk, run.length > 0 ? run : walk, idle];
    }

    private loadSpriteFrame(path: string): Promise<SpriteFrame> {
        return new Promise((resolve, reject) => {
            resources.load(path, SpriteFrame, (error, frame) => {
                if (error || !frame) reject(error ?? new Error(`无法加载 ${path}`));
                else resolve(frame);
            });
        });
    }

    private applyFeetAnchor(feetY: number, canvasHeight: number): void {
        const transform = this.getComponent(UITransform) ?? this.addComponent(UITransform);
        transform.setAnchorPoint(0.5, 1 - feetY / canvasHeight);
    }

    private applyCurrentFrame(): void {
        const frames = this.getActiveFrames();
        if (!frames?.length || !this.sprite) return;
        const idle = this.idleFrames.get(this.direction);
        if (!this.moving && idle) {
            this.sprite.spriteFrame = idle;
            return;
        }
        const index = this.moving ? this.frameIndex % frames.length : IDLE_FRAME_INDEX[this.direction];
        this.sprite.spriteFrame = frames[index % frames.length];
    }

    private getActiveFrames(): SpriteFrame[] | undefined {
        const run = this.runFrames.get(this.direction);
        return this.running && run?.length ? run : this.walkFrames.get(this.direction);
    }
}
