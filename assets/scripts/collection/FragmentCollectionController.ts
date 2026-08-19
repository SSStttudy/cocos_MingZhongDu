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
    UITransform,
    Vec2,
    Vec3,
    view,
} from 'cc';
import {
    LocationInteractionContext,
    LocationInteractionRegistry,
} from '../location/LocationInteractionRegistry';
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
    getTourPlayerPosition: () => Vec2;
    getTourPerspectiveScale: (y: number) => number;
    getCollectionTargets: () => CollectionTarget[];
};

type MarkerView = {
    node: Node;
    baseY: number;
    baseScale: number;
    target: CollectionTarget;
};

@ccclass('FragmentCollectionController')
export class FragmentCollectionController extends Component {
    private hud!: Node;
    private hudLabel!: Label;
    private toast!: Node;
    private toastLabel!: Label;
    private prompt!: Node;
    private promptLabel!: Label;
    private overlay!: Node;
    private puzzleImage!: Node;
    private puzzleStatus!: Label;
    private assembleButton!: Node;
    private assembleLabel!: Label;
    private state: FragmentCollectionState = FragmentCollectionStore.load();
    private masterFrame: SpriteFrame | null = null;
    private toastVersion = 0;
    private activePromptRegionId = '';
    private markerLayer: Node | null = null;
    private markerViews: MarkerView[] = [];
    private objectiveTarget: CollectionTarget | null = null;
    private markerElapsed = 0;
    private readonly shownSceneGuides = new Set<string>();

    onLoad(): void {
        LocationInteractionRegistry.register('collect-fragment', this.collectFragment);
        LocationInteractionRegistry.register('assemble-fragments', this.openPuzzle);
        this.node.on('location-interaction-enter', this.onInteractionEnter, this);
        this.node.on('location-interaction-exit', this.onInteractionExit, this);
        this.node.on('location-runtime-scene-rendered', this.onRuntimeSceneRendered, this);
        this.createUi();
        this.refreshHud();
        this.scheduleOnce(this.rebuildMarkers, 0);
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
        LocationInteractionRegistry.unregister('collect-fragment');
        LocationInteractionRegistry.unregister('assemble-fragments');
        this.node.off('location-interaction-enter', this.onInteractionEnter, this);
        this.node.off('location-interaction-exit', this.onInteractionExit, this);
        this.node.off('location-runtime-scene-rendered', this.onRuntimeSceneRendered, this);
    }

    update(deltaTime: number): void {
        const size = view.getVisibleSize();
        this.markerElapsed += deltaTime;
        // 避开场景右上角的“历史复原”切换按钮，并为微信安全区留出空间。
        this.hud.setPosition(size.width * 0.5 - 200, size.height * 0.5 - 146);
        this.prompt.setPosition(0, -size.height * 0.5 + 90);
        this.toast.setPosition(0, -size.height * 0.5 + 150);
        this.overlay.getComponent(UITransform)?.setContentSize(size.width, size.height);
        this.animateMarkers();
        this.refreshHud();
    }

    private readonly collectFragment = (context: LocationInteractionContext): void => {
        const payload = (context.payload ?? {}) as FragmentPayload;
        const fragmentId = String(payload.fragmentId ?? '');
        const definition = FRAGMENT_DEFINITIONS.find((item) => item.id === fragmentId);
        if (!definition) return;
        const result = FragmentCollectionStore.collect(fragmentId);
        this.state = result.state;
        this.refreshHud();
        this.prompt.active = false;
        this.activePromptRegionId = '';
        this.rebuildMarkers();
        this.showToast(result.firstTime
            ? `获得「${payload.title ?? definition.title}」  ${this.state.collected.length}/${FRAGMENT_DEFINITIONS.length}`
            : `「${payload.title ?? definition.title}」已经收集过了`);
    };

    private readonly openPuzzle = (): void => {
        this.state = FragmentCollectionStore.load();
        this.overlay.active = true;
        this.refreshPuzzle();
    };

    private createUi(): void {
        this.hud = this.makeNode('FragmentCollectionHUD', 360, 72);
        this.drawPanel(this.hud, 360, 72, new Color(25, 24, 21, 242), new Color(224, 181, 91));
        this.hudLabel = this.addLabel(this.hud, '', 17, new Color(255, 246, 220));
        this.node.addChild(this.hud);

        this.toast = this.makeNode('FragmentToast', 540, 50);
        this.drawPanel(this.toast, 540, 50, new Color(24, 23, 20, 245), new Color(224, 181, 91));
        this.toastLabel = this.addLabel(this.toast, '', 18, new Color(255, 246, 220));
        this.toast.active = false;
        this.node.addChild(this.toast);

        this.prompt = this.makeNode('FragmentInteractionPrompt', 430, 48);
        this.drawPanel(this.prompt, 430, 48, new Color(24, 23, 20, 246), new Color(224, 181, 91));
        this.promptLabel = this.addLabel(this.prompt, 'F  收集遗址碎片', 20, new Color(255, 246, 220));
        this.prompt.active = false;
        this.node.addChild(this.prompt);

        this.overlay = this.makeNode('FragmentPuzzleOverlay', 1280, 720);
        this.overlay.addComponent(BlockInputEvents);
        const shade = this.overlay.addComponent(Graphics);
        shade.fillColor = new Color(9, 8, 7, 225);
        shade.rect(-1000, -800, 2000, 1600);
        shade.fill();
        this.node.addChild(this.overlay);

        const panel = this.makeNode('SandTablePuzzle', 900, 610);
        this.drawPanel(panel, 900, 610, new Color(38, 34, 26, 255), new Color(222, 177, 83), 18);
        this.overlay.addChild(panel);
        const title = this.addLabel(panel, '游客中心 · 明中都沙盘拼图', 30, new Color(255, 239, 194));
        title.node.setPosition(0, 265);

        this.puzzleImage = this.makeNode('PuzzlePieces', 600, 390);
        this.puzzleImage.setPosition(0, 25);
        panel.addChild(this.puzzleImage);

        this.puzzleStatus = this.addLabel(panel, '', 17, new Color(232, 221, 193));
        this.puzzleStatus.node.setPosition(0, -205);

        this.assembleButton = this.makeNode('AssembleButton', 270, 48);
        this.assembleButton.setPosition(0, -252);
        this.assembleButton.on(Node.EventType.TOUCH_END, this.assemble, this);
        panel.addChild(this.assembleButton);
        this.assembleLabel = this.addLabel(this.assembleButton, '拼合全部碎片', 19, new Color(255, 248, 224));

        const close = this.makeNode('CloseButton', 52, 52);
        close.setPosition(414, 270);
        close.on(Node.EventType.TOUCH_END, () => { this.overlay.active = false; }, this);
        this.drawPanel(close, 52, 52, new Color(92, 61, 25, 255), new Color(240, 203, 120), 26);
        this.addLabel(close, '×', 30, new Color(255, 247, 224));
        panel.addChild(close);
        this.overlay.active = false;
    }

    private readonly onInteractionEnter = (context: LocationInteractionContext): void => {
        if (context.handlerId !== 'collect-fragment' && context.handlerId !== 'assemble-fragments') return;
        if (context.handlerId === 'collect-fragment') {
            const payload = (context.payload ?? {}) as FragmentPayload;
            if (this.state.collected.indexOf(String(payload.fragmentId ?? '')) >= 0) return;
        }
        this.activePromptRegionId = context.regionId;
        this.promptLabel.string = `F  ${context.prompt || (context.handlerId === 'collect-fragment' ? '收集遗址碎片' : '拼合遗址碎片')}`;
        if (!this.overlay.active) this.prompt.active = true;
    };

    private readonly onInteractionExit = (regionId: string): void => {
        if (regionId !== this.activePromptRegionId) return;
        this.activePromptRegionId = '';
        this.prompt.active = false;
    };

    private readonly onRuntimeSceneRendered = (): void => {
        this.scheduleOnce(this.rebuildMarkers, 0);
    };

    private getHost(): CollectionHost | null {
        return this.node.getComponent('LocationBootstrap') as CollectionHost | null;
    }

    private readonly rebuildMarkers = (): void => {
        if (this.markerLayer?.isValid) this.markerLayer.destroy();
        this.markerLayer = null;
        this.markerViews = [];
        this.objectiveTarget = null;

        const host = this.getHost();
        const world = host?.getTourWorld();
        if (!host || !world?.isValid) return;
        this.state = FragmentCollectionStore.load();
        const targets = host.getCollectionTargets().filter((target) => {
            if (target.handlerId !== 'collect-fragment') return true;
            const payload = (target.payload ?? {}) as FragmentPayload;
            return this.state.collected.indexOf(String(payload.fragmentId ?? '')) < 0;
        });

        this.markerLayer = this.makeNode('FragmentMarkerLayer', 1, 1);
        world.addChild(this.markerLayer);
        targets.forEach((target, index) => this.createMarker(target, index, host));
        this.objectiveTarget = targets.find((target) => target.handlerId === 'collect-fragment')
            ?? targets.find((target) => target.handlerId === 'assemble-fragments')
            ?? null;
        this.refreshHud();
        this.showSceneGuide(host, this.objectiveTarget);
    };

    private createMarker(target: CollectionTarget, index: number, host: CollectionHost): void {
        if (!this.markerLayer) return;
        const isPuzzle = target.handlerId === 'assemble-fragments';
        const payload = (target.payload ?? {}) as FragmentPayload;
        const title = payload.title ?? (isPuzzle ? '游客中心沙盘' : '遗址碎片');
        const marker = this.makeNode(`FragmentMarker-${target.regionId}`, 78, 96);
        marker.setPosition(target.position.x, target.position.y + 24);
        const graphics = marker.addComponent(Graphics);
        const main = isPuzzle ? new Color(92, 205, 193, 245) : new Color(255, 201, 72, 250);
        graphics.fillColor = new Color(main.r, main.g, main.b, 42);
        graphics.circle(0, 2, 37);
        graphics.fill();
        graphics.strokeColor = new Color(main.r, main.g, main.b, 210);
        graphics.lineWidth = 3;
        graphics.circle(0, 2, 30);
        graphics.stroke();
        graphics.fillColor = main;
        graphics.moveTo(0, 30);
        graphics.lineTo(22, 5);
        graphics.lineTo(0, -25);
        graphics.lineTo(-22, 5);
        graphics.close();
        graphics.fill();
        graphics.strokeColor = new Color(255, 248, 218, 255);
        graphics.lineWidth = 2;
        graphics.moveTo(0, 22);
        graphics.lineTo(14, 5);
        graphics.lineTo(0, -17);
        graphics.lineTo(-14, 5);
        graphics.close();
        graphics.stroke();

        const labelRoot = this.makeNode('MarkerLabel', 210, 48);
        labelRoot.setPosition(0, 63);
        this.drawPanel(labelRoot, 210, 48, new Color(22, 21, 18, 236), main, 8);
        this.addLabel(labelRoot, `${isPuzzle ? '拼图点' : '可收集'} · ${title}`, 16, new Color(255, 248, 226));
        marker.addChild(labelRoot);
        this.markerLayer.addChild(marker);

        const perspectiveScale = host.getTourPerspectiveScale(target.position.y);
        const baseScale = Math.max(0.72, Math.min(1.12, perspectiveScale));
        marker.setScale(baseScale, baseScale, 1);
        this.markerViews.push({
            node: marker,
            baseY: target.position.y + 24,
            baseScale,
            target,
        });
        marker.setSiblingIndex(index);
    }

    private animateMarkers(): void {
        this.markerViews.forEach((view, index) => {
            if (!view.node.isValid) return;
            const wave = Math.sin(this.markerElapsed * 2.7 + index * 0.8);
            view.node.setPosition(view.target.position.x, view.baseY + wave * 7);
            const scale = view.baseScale * (1 + wave * 0.045);
            view.node.setScale(scale, scale, 1);
        });
    }

    private showSceneGuide(host: CollectionHost, target: CollectionTarget | null): void {
        if (!target) return;
        const key = `${host.getTourLocationId()}/${host.getTourSceneId()}/${target.regionId}`;
        if (this.shownSceneGuides.has(key)) return;
        this.shownSceneGuides.add(key);
        const payload = (target.payload ?? {}) as FragmentPayload;
        if (target.handlerId === 'collect-fragment') {
            this.showToast(`发现「${payload.title ?? '遗址碎片'}」：跟随金色标记，靠近后按 F 收集`);
        } else {
            this.showToast('这里是游客中心沙盘：集齐碎片后，靠近青色标记按 F 拼合');
        }
    }

    private directionHint(from: Vec2, to: Vec2): string {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const horizontal = dx > 35 ? '→' : dx < -35 ? '←' : '';
        const vertical = dy > 35 ? '↑' : dy < -35 ? '↓' : '';
        if (vertical && horizontal) {
            return ({ '↑→': '↗', '↑←': '↖', '↓→': '↘', '↓←': '↙' } as Record<string, string>)[`${vertical}${horizontal}`];
        }
        return horizontal || vertical || '就在附近';
    }

    private refreshHud(): void {
        if (this.state.assembled) {
            this.hudLabel.string = '遗址碎片  5/5\n成就「重构明中都」已解锁';
            return;
        }
        const target = this.objectiveTarget;
        if (!target) {
            this.hudLabel.string = `遗址碎片  ${this.state.collected.length}/${FRAGMENT_DEFINITIONS.length}\n本场景的碎片已收集`;
            return;
        }
        const payload = (target.payload ?? {}) as FragmentPayload;
        const player = this.getHost()?.getTourPlayerPosition();
        const direction = player ? this.directionHint(player, target.position) : '';
        const distance = player ? Math.max(1, Math.round(Vec2.distance(player, target.position) / 18)) : 0;
        const title = payload.title ?? (target.handlerId === 'assemble-fragments' ? '游客中心沙盘' : '遗址碎片');
        const suffix = target.handlerId === 'assemble-fragments' && this.state.collected.length < FRAGMENT_DEFINITIONS.length
            ? `还缺 ${FRAGMENT_DEFINITIONS.length - this.state.collected.length} 枚碎片`
            : `${direction} 约 ${distance} 步`;
        this.hudLabel.string = `遗址碎片  ${this.state.collected.length}/${FRAGMENT_DEFINITIONS.length}\n目标：${title}  ${suffix}`;
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
                placeholder.fillColor = new Color(18, 17, 15, 255);
                placeholder.strokeColor = new Color(112, 94, 61, 255);
                placeholder.lineWidth = 2;
                placeholder.rect(-(pieceWidth - 4) * 0.5, -195, pieceWidth - 4, 390);
                placeholder.fill();
                placeholder.stroke();
                const unknown = this.addLabel(piece, '?', 44, new Color(121, 104, 72));
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
        this.drawAssembleButton(count === FRAGMENT_DEFINITIONS.length);
    }

    private readonly assemble = (): void => {
        if (this.state.collected.length < FRAGMENT_DEFINITIONS.length) {
            this.showToast('还没有集齐全部五枚碎片');
            return;
        }
        const result = FragmentCollectionStore.assemble();
        this.state = result.state;
        this.refreshHud();
        this.refreshPuzzle();
        if (result.unlockedNow) this.showToast('成就解锁：重构明中都');
    };

    private drawAssembleButton(enabled: boolean): void {
        const graphics = this.assembleButton.getComponent(Graphics) ?? this.assembleButton.addComponent(Graphics);
        graphics.clear();
        graphics.fillColor = enabled ? new Color(155, 99, 35, 255) : new Color(75, 69, 57, 255);
        graphics.strokeColor = enabled ? new Color(241, 203, 116, 255) : new Color(124, 115, 95, 255);
        graphics.lineWidth = 2;
        graphics.roundRect(-135, -24, 270, 48, 10);
        graphics.fill();
        graphics.stroke();
    }

    private showToast(message: string): void {
        const version = ++this.toastVersion;
        this.toastLabel.string = message;
        this.toast.active = true;
        this.scheduleOnce(() => {
            if (version === this.toastVersion && this.toast.isValid) this.toast.active = false;
        }, 2.6);
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
        label.lineHeight = Math.ceil(size * 1.25);
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
