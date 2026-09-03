import {
    _decorator,
    Component,
    resources,
    Sprite,
    SpriteFrame,
    UITransform,
    Vec2,
} from 'cc';

const { ccclass } = _decorator;

export type WalkDirection = 'down' | 'up' | 'left' | 'right';

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
    private readonly pendingDefaultDirections = new Map<WalkDirection, Promise<void>>();

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
        this.applyFeetAnchor(480, 512);
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
                this.ensureDefaultDirection(nextDirection);
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

    private async loadFrames(): Promise<void> {
        const version = ++this.loadVersion;
        try {
            // 冷启动时先加载一张正面待机图，避免必须等待整套 68 帧后角色才出现。
            // 默认角色只加载当前方向；其余方向在玩家首次使用时按需加载。
            await this.loadDefaultDirectionProgressively('down', version);
        } catch (error) {
            console.error('[DirectionalWalkAnimator] 默认角色序列帧加载失败。', error);
        }
    }

    private ensureDefaultDirection(direction: WalkDirection): void {
        if (this.walkFrames.get(direction)?.length || this.pendingDefaultDirections.has(direction)) return;
        const version = this.loadVersion;
        const pending = this.loadDefaultDirectionProgressively(direction, version)
            .catch((error) => {
                if (version === this.loadVersion) {
                    console.error(`[DirectionalWalkAnimator] ${direction} 方向序列加载失败。`, error);
                }
            });
        this.pendingDefaultDirections.set(direction, pending);
        void pending.then(() => this.pendingDefaultDirections.delete(direction));
    }

    private async loadDefaultDirectionProgressively(
        direction: WalkDirection,
        version: number,
    ): Promise<void> {
        const idle = await this.loadSpriteFrame(
            `${IDLE_RESOURCE_ROOT}/${IDLE_RESOURCE_NAME[direction]}/spriteFrame`,
        );
        if (version !== this.loadVersion || !this.isValid) return;
        this.idleFrames.set(direction, idle);
        this.walkFrames.set(direction, [idle]);
        this.runFrames.set(direction, [idle]);
        if (this.direction === direction) this.applyCurrentFrame();

        // 微信端不再等待整套 8 帧行走 + 8 帧奔跑全部下载完才开始动画。
        // 先取得两张行走帧形成最小循环，剩余帧继续在后台并行补齐。
        const quickWalk = await Promise.all([0, 1].map((index) => {
            const frameNumber = `0${index}`;
            return this.loadSpriteFrame(
                `${WALK_RESOURCE_ROOT}/${direction}/${direction}-${frameNumber}/spriteFrame`,
            );
        }));
        if (version !== this.loadVersion || !this.isValid) return;
        this.walkFrames.set(direction, quickWalk);
        this.runFrames.set(direction, quickWalk);
        if (this.direction === direction) this.applyCurrentFrame();

        const [walk, run, loadedIdle] = await this.loadDefaultDirection(direction);
        if (version !== this.loadVersion || !this.isValid) return;
        this.walkFrames.set(direction, walk);
        this.runFrames.set(direction, run);
        this.idleFrames.set(direction, loadedIdle);
        if (this.direction === direction) this.applyCurrentFrame();
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
