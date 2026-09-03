import {
    _decorator,
    BlockInputEvents,
    Color,
    Component,
    Graphics,
    Label,
    Layers,
    Node,
    Rect,
    resources,
    Size,
    Sprite,
    SpriteFrame,
    tween,
    UIOpacity,
    UITransform,
    Vec2,
    Vec3,
    view,
} from 'cc';
import { LocationInteractionRegistry } from '../location/LocationInteractionRegistry';
import {
    TOUR_FEATURE_EVENTS,
    TourFragmentProvider,
    TourFragmentSceneProgress,
    TourFeatureBridge,
} from '../tour/TourFeatureBridge';
import {
    FRAGMENT_DEFINITIONS,
    FragmentCollectionState,
    FragmentCollectionStore,
} from './FragmentCollectionStore';

const { ccclass } = _decorator;
const PUZZLE_RESOURCE = 'fragments/ming-zhongdu-reconstruction/spriteFrame';

type FragmentPayload = { fragmentId?: string; title?: string };

type CollectionTarget = {
    regionId: string;
    handlerId: string;
    prompt: string;
    payload: unknown;
    position: Vec2;
};

type CollectionHost = Component & {
    getTourWorld: () => Node;
    getTourLocationId: () => string;
    getTourSceneId: () => string;
    getCollectionTargets: () => CollectionTarget[];
    setTourPaused: (paused: boolean) => void;
};

type MagnifierMoveEvent = {
    locationId?: string;
    sceneId?: string;
    position?: { x?: number; y?: number };
    radius?: number;
};

/**
 * collect-fragment 多边形只保存可视化可调的搜索点；碎片由放大镜扫过拾取，
 * 不再占用普通 F 交互，也不在世界中绘制破坏画面的巨大箭头。
 */
@ccclass('FragmentCollectionController')
export class FragmentCollectionController extends Component implements TourFragmentProvider {
    private toast!: Node;
    private toastLabel!: Label;
    private overlay!: Node;
    private puzzleImage!: Node;
    private puzzleStatus!: Label;
    private assembleButton!: Node;
    private assembleLabel!: Label;
    private achievementBanner!: Node;
    private state: FragmentCollectionState = FragmentCollectionStore.load();
    private masterFrame: SpriteFrame | null = null;
    private toastVersion = 0;
    private sceneTargets: CollectionTarget[] = [];
    private readonly announcedScenes = new Set<string>();

    onLoad(): void {
        LocationInteractionRegistry.register('assemble-fragments', this.openPuzzle);
        TourFeatureBridge.registerFragmentProvider(this);
        this.node.on('location-runtime-scene-rendered', this.onRuntimeSceneRendered, this);
        this.node.on(TOUR_FEATURE_EVENTS.magnifierMoved, this.onMagnifierMoved, this);
        this.createUi();
        this.scheduleOnce(this.refreshSceneTargets, 0);
        resources.load(PUZZLE_RESOURCE, SpriteFrame, (error, frame) => {
            if (error || !frame) {
                console.warn('[FragmentCollection] 拼图资源加载失败。', error);
                return;
            }
            this.masterFrame = frame;
            if (this.overlay.active) this.refreshPuzzle();
        });
    }

    onDestroy(): void {
        LocationInteractionRegistry.unregister('assemble-fragments');
        TourFeatureBridge.unregisterFragmentProvider(this);
        this.node.off('location-runtime-scene-rendered', this.onRuntimeSceneRendered, this);
        this.node.off(TOUR_FEATURE_EVENTS.magnifierMoved, this.onMagnifierMoved, this);
    }

    update(): void {
        const size = view.getVisibleSize();
        this.toast.setPosition(-size.width * 0.5 + 244, size.height * 0.5 - 182);
        this.overlay.getComponent(UITransform)?.setContentSize(size.width, size.height);
    }

    getSceneProgress(locationId: string, sceneId: string): TourFragmentSceneProgress | null {
        const host = this.getHost();
        if (!host || host.getTourLocationId() !== locationId || host.getTourSceneId() !== sceneId) return null;
        const targets = this.sceneTargets.filter((target) => target.handlerId === 'collect-fragment');
        if (targets.length === 0) return null;
        this.state = FragmentCollectionStore.load();
        const collected = targets.filter((target) => {
            const payload = (target.payload ?? {}) as FragmentPayload;
            return this.state.collected.indexOf(String(payload.fragmentId ?? '')) >= 0;
        }).length;
        return { total: targets.length, collected };
    }

    private readonly onRuntimeSceneRendered = (): void => {
        this.scheduleOnce(this.refreshSceneTargets, 0);
    };

    private readonly refreshSceneTargets = (): void => {
        const host = this.getHost();
        if (!host) return;
        this.state = FragmentCollectionStore.load();
        this.sceneTargets = host.getCollectionTargets();
        const progress = this.getSceneProgress(host.getTourLocationId(), host.getTourSceneId());
        if (!progress || progress.collected >= progress.total) return;
        const key = `${host.getTourLocationId()}/${host.getTourSceneId()}`;
        if (this.announcedScenes.has(key)) return;
        this.announcedScenes.add(key);
        this.node.emit(TOUR_FEATURE_EVENTS.fragmentDiscovered, {
            locationId: host.getTourLocationId(),
            sceneId: host.getTourSceneId(),
            total: progress.total,
            collected: progress.collected,
        });
    };

    private readonly onMagnifierMoved = (event: MagnifierMoveEvent): void => {
        const host = this.getHost();
        if (!host || event.locationId !== host.getTourLocationId() || event.sceneId !== host.getTourSceneId()) return;
        const lensX = Number(event.position?.x);
        const lensY = Number(event.position?.y);
        if (!Number.isFinite(lensX) || !Number.isFinite(lensY)) return;
        this.state = FragmentCollectionStore.load();
        const hitRadius = Math.max(42, (Number(event.radius) || 96) * 0.68);
        const target = this.sceneTargets.find((item) => {
            if (item.handlerId !== 'collect-fragment') return false;
            const payload = (item.payload ?? {}) as FragmentPayload;
            if (this.state.collected.indexOf(String(payload.fragmentId ?? '')) >= 0) return false;
            const screenPoint = this.targetCanvasPosition(item.position);
            return Boolean(screenPoint && Vec2.distance(screenPoint, new Vec2(lensX, lensY)) <= hitRadius);
        });
        if (target) this.collectWithMagnifier(target);
    };

    private targetCanvasPosition(position: Vec2): Vec2 | null {
        const world = this.getHost()?.getTourWorld();
        const worldTransform = world?.getComponent(UITransform);
        const canvasTransform = this.node.getComponent(UITransform);
        if (!worldTransform || !canvasTransform) return null;
        const worldPoint = worldTransform.convertToWorldSpaceAR(new Vec3(position.x, position.y, 0));
        const localPoint = canvasTransform.convertToNodeSpaceAR(worldPoint);
        return new Vec2(localPoint.x, localPoint.y);
    }

    private collectWithMagnifier(target: CollectionTarget): void {
        const payload = (target.payload ?? {}) as FragmentPayload;
        const fragmentId = String(payload.fragmentId ?? '');
        const definition = FRAGMENT_DEFINITIONS.find((item) => item.id === fragmentId);
        const host = this.getHost();
        if (!definition || !host) return;
        const result = FragmentCollectionStore.collect(fragmentId);
        if (!result.firstTime) return;
        this.state = result.state;
        const progress = this.getSceneProgress(host.getTourLocationId(), host.getTourSceneId());
        const title = payload.title ?? definition.title;
        this.showToast(`放大镜发现「${title}」  已收入任务册 ${this.state.collected.length}/5`);
        this.node.emit(TOUR_FEATURE_EVENTS.fragmentCollected, {
            locationId: host.getTourLocationId(),
            sceneId: host.getTourSceneId(),
            fragmentId,
            fragmentName: title,
            total: progress?.total,
            collected: progress?.collected,
        });
        if (progress && progress.collected >= progress.total) {
            this.node.emit(TOUR_FEATURE_EVENTS.fragmentSceneCompleted, {
                locationId: host.getTourLocationId(),
                sceneId: host.getTourSceneId(),
                total: progress.total,
                collected: progress.collected,
            });
        }
    }

    private readonly openPuzzle = (): void => {
        this.state = FragmentCollectionStore.load();
        this.getHost()?.setTourPaused(true);
        this.overlay.active = true;
        this.refreshPuzzle();
    };

    private closePuzzle(): void {
        this.overlay.active = false;
        this.getHost()?.setTourPaused(false);
    }

    private createUi(): void {
        this.toast = this.makeNode('FragmentToast', 456, 56);
        this.drawPanel(this.toast, 456, 56, new Color(30, 53, 50, 244), new Color(222, 185, 104), 14);
        this.toastLabel = this.addLabel(this.toast, '', 17, new Color(255, 246, 218));
        this.toast.active = false;
        this.node.addChild(this.toast);

        this.overlay = this.makeNode('FragmentPuzzleOverlay', 1280, 720);
        this.overlay.addComponent(BlockInputEvents);
        const shade = this.overlay.addComponent(Graphics);
        shade.fillColor = new Color(9, 16, 15, 214);
        shade.rect(-1000, -800, 2000, 1600);
        shade.fill();
        this.node.addChild(this.overlay);

        const panel = this.makeNode('SandTablePuzzle', 900, 610);
        this.drawPanel(panel, 900, 610, new Color(31, 48, 44, 255), new Color(222, 185, 104), 18);
        this.overlay.addChild(panel);
        const title = this.addLabel(panel, '游客中心 · 明中都沙盘拼图', 30, new Color(255, 239, 194));
        title.node.setPosition(0, 265);

        this.puzzleImage = this.makeNode('PuzzlePieces', 600, 390);
        this.puzzleImage.setPosition(0, 25);
        panel.addChild(this.puzzleImage);
        this.puzzleStatus = this.addLabel(panel, '', 17, new Color(242, 233, 208));
        this.puzzleStatus.node.setPosition(0, -205);

        this.assembleButton = this.makeNode('AssembleButton', 270, 48);
        this.assembleButton.setPosition(0, -252);
        this.assembleButton.on(Node.EventType.TOUCH_END, this.assemble, this);
        panel.addChild(this.assembleButton);
        this.assembleLabel = this.addLabel(this.assembleButton, '拼合全部碎片', 19, new Color(255, 248, 224));

        this.achievementBanner = this.makeNode('AchievementBanner', 620, 104);
        this.drawPanel(this.achievementBanner, 620, 104, new Color(101, 69, 27, 252), new Color(255, 226, 148), 18);
        this.addLabel(this.achievementBanner, '全收集成就解锁\n「重构明中都」', 28, new Color(255, 247, 218));
        this.achievementBanner.addComponent(UIOpacity).opacity = 0;
        this.achievementBanner.active = false;
        panel.addChild(this.achievementBanner);

        const close = this.makeNode('CloseButton', 52, 52);
        close.setPosition(414, 270);
        close.on(Node.EventType.TOUCH_END, this.closePuzzle, this);
        this.drawPanel(close, 52, 52, new Color(115, 77, 32, 255), new Color(240, 203, 120), 26);
        this.addLabel(close, '×', 30, new Color(255, 247, 224));
        panel.addChild(close);
        this.overlay.active = false;
    }

    private refreshPuzzle(): void {
        this.puzzleImage.removeAllChildren();
        const collected = new Set(this.state.collected);
        const pieceWidth = 120;
        for (let index = 0; index < FRAGMENT_DEFINITIONS.length; index += 1) {
            const definition = FRAGMENT_DEFINITIONS[index];
            const piece = this.makeNode(`PuzzlePiece-${definition.id}`, pieceWidth - 4, 390);
            piece.setPosition(-240 + index * pieceWidth, 0);
            this.puzzleImage.addChild(piece);
            if (this.masterFrame && (collected.has(definition.id) || this.state.assembled)) {
                const source = this.masterFrame.rect;
                const frame = new SpriteFrame();
                frame.texture = this.masterFrame.texture;
                const cropWidth = source.width / FRAGMENT_DEFINITIONS.length;
                frame.rect = new Rect(source.x + cropWidth * index, source.y, cropWidth, source.height);
                frame.originalSize = new Size(cropWidth, source.height);
                frame.offset = this.masterFrame.offset;
                const sprite = piece.addComponent(Sprite);
                sprite.sizeMode = Sprite.SizeMode.CUSTOM;
                sprite.spriteFrame = frame;
            } else {
                const placeholder = piece.addComponent(Graphics);
                placeholder.fillColor = new Color(17, 31, 29, 255);
                placeholder.strokeColor = new Color(128, 105, 61, 255);
                placeholder.lineWidth = 2;
                placeholder.rect(-(pieceWidth - 4) * 0.5, -195, pieceWidth - 4, 390);
                placeholder.fill();
                placeholder.stroke();
                const unknown = this.addLabel(piece, '?', 44, new Color(151, 126, 73));
                unknown.node.setPosition(0, 12);
            }
        }
        const count = this.state.collected.length;
        if (this.state.assembled) {
            this.puzzleStatus.string = '全收集成就「重构明中都」已解锁';
            this.assembleLabel.string = '已完成拼合';
        } else if (count === FRAGMENT_DEFINITIONS.length) {
            this.puzzleStatus.string = '全部碎片已经归位，点击下方按钮完成沙盘复原。';
            this.assembleLabel.string = '拼合全部碎片';
        } else {
            const missing = FRAGMENT_DEFINITIONS.filter((item) => !collected.has(item.id));
            this.puzzleStatus.string = `已找到 ${count}/5；尚缺：${missing.map((item) => item.location).join('、')}`;
            this.assembleLabel.string = '碎片尚未集齐';
        }
        this.drawAssembleButton(count === FRAGMENT_DEFINITIONS.length && !this.state.assembled);
    }

    private readonly assemble = (): void => {
        if (this.state.collected.length < FRAGMENT_DEFINITIONS.length) {
            this.showToast('碎片尚未集齐，请跟随任务提示继续寻找');
            return;
        }
        if (this.state.assembled) return;
        const result = FragmentCollectionStore.assemble();
        this.state = result.state;
        this.refreshPuzzle();
        if (result.unlockedNow) this.playAchievementAnimation();
    };

    private playAchievementAnimation(): void {
        this.puzzleImage.children.forEach((piece, index) => {
            const opacity = piece.getComponent(UIOpacity) ?? piece.addComponent(UIOpacity);
            opacity.opacity = 0;
            piece.setScale(0.72, 0.72, 1);
            tween(opacity).delay(index * 0.12).to(0.28, { opacity: 255 }).start();
            tween(piece).delay(index * 0.12).to(0.38, { scale: Vec3.ONE }, { easing: 'backOut' }).start();
        });
        this.achievementBanner.active = true;
        this.achievementBanner.setScale(0.82, 0.82, 1);
        const opacity = this.achievementBanner.getComponent(UIOpacity)!;
        opacity.opacity = 0;
        tween(opacity).delay(0.9).to(0.35, { opacity: 255 }).delay(2.2).to(0.35, { opacity: 0 }).call(() => {
            if (this.achievementBanner.isValid) this.achievementBanner.active = false;
        }).start();
        tween(this.achievementBanner).delay(0.9).to(0.45, { scale: Vec3.ONE }, { easing: 'backOut' }).start();
        this.node.emit('fragment-achievement-unlocked', { achievementId: 'rebuild-mingzhongdu' });
    }

    private drawAssembleButton(enabled: boolean): void {
        const graphics = this.assembleButton.getComponent(Graphics) ?? this.assembleButton.addComponent(Graphics);
        graphics.clear();
        graphics.fillColor = enabled ? new Color(155, 99, 35, 255) : new Color(69, 79, 72, 255);
        graphics.strokeColor = enabled ? new Color(241, 203, 116, 255) : new Color(130, 137, 119, 255);
        graphics.lineWidth = 2;
        graphics.roundRect(-135, -24, 270, 48, 10);
        graphics.fill();
        graphics.stroke();
    }

    private showToast(message: string): void {
        const version = ++this.toastVersion;
        this.toastLabel.string = message;
        this.toast.active = true;
        this.toast.setSiblingIndex(this.node.children.length - 1);
        this.scheduleOnce(() => {
            if (version === this.toastVersion && this.toast.isValid) this.toast.active = false;
        }, 3.2);
    }

    private getHost(): CollectionHost | null {
        return this.node.getComponent('LocationBootstrap') as CollectionHost | null;
    }

    private makeNode(name: string, width: number, height: number): Node {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        node.addComponent(UITransform).setContentSize(width, height);
        node.setPosition(Vec3.ZERO);
        return node;
    }

    private addLabel(parent: Node, text: string, size: number, color: Color): Label {
        const node = this.makeNode(`${parent.name}Label`, parent.getComponent(UITransform)!.width, parent.getComponent(UITransform)!.height);
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = size;
        label.lineHeight = Math.ceil(size * 1.3);
        label.color = color;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.overflow = Label.Overflow.SHRINK;
        parent.addChild(node);
        return label;
    }

    private drawPanel(node: Node, width: number, height: number, fill: Color, stroke: Color, radius = 10): void {
        const graphics = node.addComponent(Graphics);
        graphics.fillColor = fill;
        graphics.strokeColor = stroke;
        graphics.lineWidth = 2;
        graphics.roundRect(-width * 0.5, -height * 0.5, width, height, radius);
        graphics.fill();
        graphics.stroke();
    }
}
