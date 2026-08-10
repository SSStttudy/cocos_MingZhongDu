import {
    _decorator,
    Color,
    Component,
    EventTouch,
    Graphics,
    Label,
    Layers,
    Mask,
    Node,
    resources,
    Sprite,
    SpriteFrame,
    UITransform,
    Vec2,
    view,
} from 'cc';
import {
    LocationInteractionContext,
    LocationInteractionRegistry,
} from '../location/LocationInteractionRegistry';

const { ccclass } = _decorator;
const HANDLER_ID = 'stone-base-restoration';

/** Non-modal, same-viewpoint restoration lens for Location 2's stone bases. */
@ccclass('StoneBaseRestorationViewer')
export class StoneBaseRestorationViewer extends Component {
    private root!: Node;
    private lens!: Node;
    private lensMask!: Node;
    private historicalImage!: Node;
    private rim!: Graphics;
    private stencil!: Graphics;
    private closeButton!: Node;
    private notice!: Label;
    private frame: SpriteFrame | null = null;
    private loadFailed = false;
    private dragging = false;
    private expanded = false;
    private home = new Vec2();
    private collapsedRadius = 34;
    private expandedRadius = 116;
    private lastVisibleWidth = -1;
    private lastVisibleHeight = -1;

    onLoad(): void {
        LocationInteractionRegistry.register(HANDLER_ID, this.openFromInteraction);
        resources.load('restoration/location-2-stone-base/spriteFrame', SpriteFrame, (error, frame) => {
            this.loadFailed = Boolean(error || !frame);
            this.frame = frame ?? null;
            if (this.root?.active) this.updateNotice();
        });
    }

    onDestroy(): void {
        LocationInteractionRegistry.unregister(HANDLER_ID);
    }

    private openFromInteraction = (context: LocationInteractionContext): void => {
        if (context.locationId !== 'location-2' || context.sceneId !== '2') return;
        this.open();
    };

    open(): void {
        this.ensureUi();
        this.dragging = false;
        this.expanded = false;
        this.root.active = true;
        this.lastVisibleWidth = -1;
        this.layout();
        this.updateNotice();
    }

    hide(): void {
        this.dragging = false;
        this.expanded = false;
        if (this.root) this.root.active = false;
    }

    update(): void {
        if (!this.root?.active) return;
        this.layout();
        if (this.expanded) this.alignHistoricalImage();
    }

    private ensureUi(): void {
        if (this.root) return;
        this.root = new Node('StoneBaseRestorationViewer');
        this.root.layer = Layers.Enum.UI_2D;
        this.root.addComponent(UITransform);
        this.node.addChild(this.root);
        // Keep the photo world below and the existing HUD/action controls above.
        this.root.setSiblingIndex(1);

        const hint = new Node('RestorationHint');
        hint.layer = Layers.Enum.UI_2D;
        hint.addComponent(UITransform).setContentSize(360, 36);
        this.notice = hint.addComponent(Label);
        this.notice.fontSize = 18;
        this.notice.lineHeight = 24;
        this.notice.color = new Color(255, 247, 215, 255);
        this.notice.enableOutline = true;
        this.notice.outlineColor = new Color(42, 34, 24, 225);
        this.notice.outlineWidth = 3;
        this.root.addChild(hint);

        this.lens = new Node('RestorationMagnifier');
        this.lens.layer = Layers.Enum.UI_2D;
        this.lens.addComponent(UITransform);
        this.root.addChild(this.lens);

        this.lensMask = new Node('CircularViewport');
        this.lensMask.layer = Layers.Enum.UI_2D;
        this.lensMask.addComponent(UITransform);
        this.stencil = this.lensMask.addComponent(Graphics);
        const mask = this.lensMask.addComponent(Mask);
        mask.type = Mask.Type.GRAPHICS_STENCIL;
        this.lens.addChild(this.lensMask);

        this.historicalImage = new Node('HistoricalImage');
        this.historicalImage.layer = Layers.Enum.UI_2D;
        this.historicalImage.addComponent(UITransform);
        const sprite = this.historicalImage.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this.lensMask.addChild(this.historicalImage);

        const rimNode = new Node('BrassRim');
        rimNode.layer = Layers.Enum.UI_2D;
        rimNode.addComponent(UITransform);
        this.rim = rimNode.addComponent(Graphics);
        this.lens.addChild(rimNode);

        this.lens.on(Node.EventType.TOUCH_START, this.onLensStart, this);
        this.lens.on(Node.EventType.TOUCH_MOVE, this.onLensMove, this);
        this.lens.on(Node.EventType.TOUCH_END, this.onLensEnd, this);
        this.lens.on(Node.EventType.TOUCH_CANCEL, this.onLensEnd, this);

        this.closeButton = this.createButton(
            'CloseRestorationViewer',
            '×',
            48,
            new Color(90, 54, 42, 235),
        );
        this.closeButton.on(Node.EventType.TOUCH_END, this.onClose, this);
        this.root.addChild(this.closeButton);
        this.root.active = false;
    }

    private createButton(name: string, text: string, size: number, color: Color): Node {
        const button = new Node(name);
        button.layer = Layers.Enum.UI_2D;
        button.addComponent(UITransform).setContentSize(size, size);
        const graphics = button.addComponent(Graphics);
        graphics.fillColor = color;
        graphics.strokeColor = new Color(255, 239, 198, 245);
        graphics.lineWidth = 3;
        graphics.circle(0, 0, size * 0.5);
        graphics.fill();
        graphics.stroke();

        const labelNode = new Node('Text');
        labelNode.layer = Layers.Enum.UI_2D;
        labelNode.addComponent(UITransform).setContentSize(size, size);
        const label = labelNode.addComponent(Label);
        label.string = text;
        label.fontSize = 34;
        label.lineHeight = size;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.color = new Color(255, 248, 220, 255);
        button.addChild(labelNode);
        return button;
    }

    private layout(): void {
        const visible = view.getVisibleSize();
        const sizeChanged = visible.width !== this.lastVisibleWidth
            || visible.height !== this.lastVisibleHeight;
        if (!sizeChanged) return;

        this.lastVisibleWidth = visible.width;
        this.lastVisibleHeight = visible.height;
        this.root.getComponent(UITransform)!.setContentSize(visible);
        this.collapsedRadius = Math.max(28, Math.min(38, visible.height * 0.052));
        this.expandedRadius = Math.max(88, Math.min(126, visible.height * 0.17));
        this.home.set(
            visible.width * 0.5 - this.collapsedRadius - 28,
            Math.min(54, visible.height * 0.08),
        );
        if (!this.dragging) this.lens.setPosition(this.home.x, this.home.y, 0);
        this.closeButton.setPosition(
            visible.width * 0.5 - 42,
            Math.min(visible.height * 0.5 - 54, this.home.y + 94),
            0,
        );
        this.root.getChildByName('RestorationHint')!.setPosition(
            0,
            visible.height * 0.5 - 42,
            0,
        );
        this.redrawLens();
    }

    private redrawLens(): void {
        const radius = this.expanded ? this.expandedRadius : this.collapsedRadius;
        const touchExtent = this.expanded ? radius * 2 + 28 : radius * 2.6;
        this.lens.getComponent(UITransform)!.setContentSize(touchExtent, touchExtent);

        this.rim.clear();
        this.rim.lineWidth = this.expanded ? Math.max(7, radius * 0.075) : 6;
        this.rim.strokeColor = new Color(242, 211, 142, 255);
        this.rim.fillColor = this.expanded
            ? new Color(55, 42, 28, 45)
            : new Color(93, 66, 37, 235);
        this.rim.circle(0, 0, radius);
        this.rim.fill();
        this.rim.stroke();
        this.rim.lineCap = Graphics.LineCap.ROUND;
        this.rim.moveTo(radius * 0.68, -radius * 0.68);
        this.rim.lineTo(radius * 1.08, -radius * 1.08);
        this.rim.stroke();

        if (!this.expanded) {
            this.rim.fillColor = new Color(169, 205, 205, 105);
            this.rim.circle(0, 0, radius * 0.62);
            this.rim.fill();
        }

        this.lensMask.active = this.expanded;
        if (!this.expanded) return;
        this.lensMask.getComponent(UITransform)!.setContentSize(radius * 2, radius * 2);
        this.stencil.clear();
        this.stencil.fillColor = Color.WHITE;
        this.stencil.circle(0, 0, radius - this.rim.lineWidth * 0.55);
        this.stencil.fill();
        this.alignHistoricalImage();
    }

    private alignHistoricalImage(): void {
        if (!this.expanded || !this.historicalImage?.isValid) return;
        const sprite = this.historicalImage.getComponent(Sprite)!;
        sprite.spriteFrame = this.frame;

        const world = this.node.getChildByName('PerspectiveWorld');
        const worldTransform = world?.getComponent(UITransform);
        const visible = view.getVisibleSize();
        const contentSize = worldTransform?.contentSize ?? visible;
        this.historicalImage.getComponent(UITransform)!.setContentSize(contentSize);

        if (world) {
            this.historicalImage.setScale(world.scale.x, world.scale.y, 1);
            this.historicalImage.setPosition(
                world.position.x - this.lens.position.x,
                world.position.y - this.lens.position.y,
                0,
            );
        } else {
            this.historicalImage.setScale(1, 1, 1);
            this.historicalImage.setPosition(-this.lens.position.x, -this.lens.position.y, 0);
        }
    }

    private updateNotice(): void {
        if (!this.notice) return;
        this.notice.string = this.loadFailed
            ? '复原图暂不可用，可关闭后继续探索'
            : '按住右侧放大镜并拖动查看，松手自动归位';
    }

    private onClose(event: EventTouch): void {
        event.propagationStopped = true;
        this.hide();
    }

    private onLensStart(event: EventTouch): void {
        event.propagationStopped = true;
        this.dragging = true;
        this.expanded = true;
        this.redrawLens();
        this.moveLens(event);
    }

    private onLensMove(event: EventTouch): void {
        event.propagationStopped = true;
        if (this.dragging) this.moveLens(event);
    }

    private onLensEnd(event: EventTouch): void {
        event.propagationStopped = true;
        this.dragging = false;
        this.expanded = false;
        this.lens.setPosition(this.home.x, this.home.y, 0);
        this.redrawLens();
    }

    private moveLens(event: EventTouch): void {
        const point = event.getUILocation();
        const visible = view.getVisibleSize();
        const radius = this.expandedRadius;
        const margin = 14;
        const desiredX = point.x - visible.width * 0.5;
        const desiredY = point.y - visible.height * 0.5;
        const x = Math.max(
            -visible.width * 0.5 + radius + margin,
            Math.min(visible.width * 0.5 - radius - margin, desiredX),
        );
        const y = Math.max(
            -visible.height * 0.5 + radius + margin,
            Math.min(visible.height * 0.5 - radius - margin, desiredY),
        );
        this.lens.setPosition(x, y, 0);
        this.alignHistoricalImage();
    }
}
