import { _decorator, AudioClip, AudioSource, Component, director, game, Game, input, Input, Node, resources } from 'cc';
import { EDITOR } from 'cc/env';
import { loadSettings, onSettingsChanged } from '../start/GameSettings';

const { ccclass } = _decorator;
const MUSIC_PATH = 'audio/sunset-plains-loop';
const MUSIC_VOLUME = 0.55;

/** One background track for Start, Overworld and all photo scenes. */
@ccclass('BackgroundMusic')
export class BackgroundMusic extends Component {
    private static instance: BackgroundMusic | null = null;
    private source!: AudioSource;
    private clip: AudioClip | null = null;
    private unsubscribe: (() => void) | null = null;
    private loading = false;
    private hidden = false;
    private hasGesture = false;
    private requested = false;
    private requestedAt = 0;
    private retryAfter = 0;
    private disposed = false;

    static ensureStarted(): void {
        if (EDITOR || this.instance?.isValid) return;
        const scene = director.getScene();
        if (!scene) return;
        const node = new Node('BackgroundMusic');
        scene.addChild(node);
        game.addPersistRootNode(node);
        this.instance = node.addComponent(BackgroundMusic);
    }

    onLoad(): void {
        this.source = this.node.addComponent(AudioSource);
        this.source.playOnAwake = false;
        this.source.loop = true;
        this.source.volume = 0;
        this.node.on(AudioSource.EventType.STARTED, this.onStarted, this);
        this.unsubscribe = onSettingsChanged(() => this.sync());
        input.on(Input.EventType.TOUCH_END, this.onGesture, this);
        input.on(Input.EventType.MOUSE_UP, this.onGesture, this);
        input.on(Input.EventType.KEY_DOWN, this.onGesture, this);
        game.on(Game.EVENT_HIDE, this.onHide, this);
        game.on(Game.EVENT_SHOW, this.onShow, this);
        this.sync();
    }

    private allowed(): boolean {
        return !this.disposed && !this.hidden && this.hasGesture && loadSettings().musicEnabled;
    }

    private sync(): void {
        if (this.disposed) return;
        const enabled = loadSettings().musicEnabled;
        if (!this.allowed()) {
            // Silence immediately, including any late native autoplay callback.
            this.source.volume = 0;
            if (this.requested || this.source.playing) this.source.pause();
            this.requested = false;
        }
        if (!enabled || this.hidden) return;
        if (!this.clip) {
            if (this.loading || Date.now() < this.retryAfter) return;
            this.loading = true;
            resources.load(MUSIC_PATH, AudioClip, (error, clip) => {
                this.loading = false;
                if (this.disposed || !this.isValid) return;
                if (error || !clip) {
                    this.retryAfter = Date.now() + 10000;
                    console.warn('[BackgroundMusic] 背景音乐加载失败，稍后交互时重试；不影响游览。', error);
                    return;
                }
                clip.addRef();
                this.clip = clip;
                this.source.clip = clip;
                this.sync();
            });
            return;
        }
        if (!this.allowed()) return;
        if (this.source.playing || this.requested) return;
        this.source.volume = 0;
        this.requested = true;
        this.requestedAt = Date.now();
        this.source.play();
    }

    update(deltaTime: number): void {
        if (this.allowed() && this.source.playing) {
            this.source.volume = Math.min(MUSIC_VOLUME, this.source.volume + deltaTime * MUSIC_VOLUME / 0.45);
        }
    }

    private onGesture(): void {
        this.hasGesture = true;
        // Retry a rejected platform play request on a later gesture, not every frame.
        if (this.requested && !this.source.playing && Date.now() - this.requestedAt > 2000) {
            this.requested = false;
        }
        this.sync();
    }

    private onStarted(): void {
        if (!this.allowed()) {
            this.source.volume = 0;
            this.source.pause();
            this.requested = false;
        }
    }

    private onHide(): void {
        this.hidden = true;
        this.sync();
    }

    private onShow(): void {
        this.hidden = false;
        this.sync();
    }

    onDestroy(): void {
        this.disposed = true;
        this.unsubscribe?.();
        input.off(Input.EventType.TOUCH_END, this.onGesture, this);
        input.off(Input.EventType.MOUSE_UP, this.onGesture, this);
        input.off(Input.EventType.KEY_DOWN, this.onGesture, this);
        game.off(Game.EVENT_HIDE, this.onHide, this);
        game.off(Game.EVENT_SHOW, this.onShow, this);
        this.node.off(AudioSource.EventType.STARTED, this.onStarted, this);
        this.source?.stop();
        if (this.source) this.source.clip = null;
        this.clip?.decRef();
        this.clip = null;
        if (BackgroundMusic.instance === this) BackgroundMusic.instance = null;
    }
}
