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

const DIRECTIONS: WalkDirection[] = ['down', 'up', 'left', 'right'];
const FRAME_COUNT = 8;
const WALK_FRAME_INTERVAL = 1 / 6;
const RUN_FRAME_INTERVAL = 1 / 9;
const RESOURCE_ROOT = 'characters/modern-explorer/walk';
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
    private readonly frames = new Map<WalkDirection, SpriteFrame[]>();
    private readonly runFrames = new Map<WalkDirection, SpriteFrame[]>();
    private readonly idleFrames = new Map<WalkDirection, SpriteFrame>();
    private sprite!: Sprite;
    private direction: WalkDirection = 'down';
    private moving = false;
    private running = false;
    private elapsed = 0;
    private frameIndex = 0;
    private loadVersion = 0;

    onLoad(): void {
        this.sprite = this.getComponent(Sprite) ?? this.addComponent(Sprite);
        this.sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        // All exported frames share a 384x512 transparent canvas. Disabling
        // trimming prevents each walking pose's changing tight bounds from being
        // stretched to the node size, which otherwise makes side walking pulse
        // wider and narrower.
        this.sprite.trim = false;
        const transform = this.getComponent(UITransform) ?? this.addComponent(UITransform);
        // Every exported frame places the soles at y=480 on a 512px canvas.
        // Making that point the node anchor keeps collision and perspective scaling
        // attached to the character's feet rather than the image centre.
        transform.setAnchorPoint(0.5, 1 - 480 / 512);
        void this.loadFrames();
    }

    onDestroy(): void {
        this.loadVersion += 1;
    }

    update(deltaTime: number): void {
        const directionFrames = this.getActiveFrames();
        if (!directionFrames || directionFrames.length === 0) return;
        if (!this.moving) return;

        this.elapsed += deltaTime;
        const frameInterval = this.running ? RUN_FRAME_INTERVAL : WALK_FRAME_INTERVAL;
        while (this.elapsed >= frameInterval) {
            this.elapsed -= frameInterval;
            this.frameIndex = (this.frameIndex + 1) % directionFrames.length;
        }
        this.applyCurrentFrame();
    }

    setDisplaySize(width: number, height: number): void {
        const transform = this.getComponent(UITransform) ?? this.addComponent(UITransform);
        transform.setContentSize(width, height);
        transform.setAnchorPoint(0.5, 1 - 480 / 512);
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

    private async loadFrames(): Promise<void> {
        const version = ++this.loadVersion;
        try {
            const loadedDirections = await Promise.all(DIRECTIONS.map(async (direction) => {
                const [directionFrames, directionRunFrames, idleFrame] = await Promise.all([
                    Promise.all(
                    Array.from({ length: FRAME_COUNT }, (_, index) => {
                        const frameNumber = index < 10 ? `0${index}` : `${index}`;
                        return this.loadSpriteFrame(
                            `${RESOURCE_ROOT}/${direction}/${direction}-${frameNumber}/spriteFrame`,
                        );
                    }),
                    ),
                    Promise.all(
                        Array.from({ length: FRAME_COUNT }, (_, index) => {
                            const frameNumber = index < 10 ? `0${index}` : `${index}`;
                            return this.loadSpriteFrame(
                                `${RUN_RESOURCE_ROOT}/${direction}/${direction}-${frameNumber}/spriteFrame`,
                            );
                        }),
                    ).catch((error) => {
                        console.warn(`[DirectionalWalkAnimator] 奔跑序列加载失败，将使用行走序列`, error);
                        return [] as SpriteFrame[];
                    }),
                    this.loadSpriteFrame(
                        `${IDLE_RESOURCE_ROOT}/${IDLE_RESOURCE_NAME[direction]}/spriteFrame`,
                    ),
                ]);
                return [direction, directionFrames, directionRunFrames, idleFrame] as const;
            }));
            if (version !== this.loadVersion || !this.isValid) return;
            for (const [direction, directionFrames, directionRunFrames, idleFrame] of loadedDirections) {
                this.frames.set(direction, directionFrames);
                this.runFrames.set(direction, directionRunFrames);
                this.idleFrames.set(direction, idleFrame);
            }
            this.applyCurrentFrame();
        } catch (error) {
            console.error('[DirectionalWalkAnimator] 角色序列帧加载失败', error);
        }
    }

    private loadSpriteFrame(path: string): Promise<SpriteFrame> {
        return new Promise((resolve, reject) => {
            resources.load(path, SpriteFrame, (error, frame) => {
                if (error) {
                    reject(new Error(`${path}: ${error.message}`));
                    return;
                }
                resolve(frame);
            });
        });
    }

    private applyCurrentFrame(): void {
        const directionFrames = this.getActiveFrames();
        if (!directionFrames || directionFrames.length === 0 || !this.sprite) return;
        const idleFrame = this.idleFrames.get(this.direction);
        if (!this.moving && idleFrame) {
            this.sprite.spriteFrame = idleFrame;
            return;
        }
        const index = this.moving
            ? this.frameIndex % directionFrames.length
            : IDLE_FRAME_INDEX[this.direction];
        this.sprite.spriteFrame = directionFrames[index];
    }

    private getActiveFrames(): SpriteFrame[] | undefined {
        const runningFrames = this.runFrames.get(this.direction);
        if (this.running && runningFrames && runningFrames.length > 0) {
            return runningFrames;
        }
        return this.frames.get(this.direction);
    }
}
