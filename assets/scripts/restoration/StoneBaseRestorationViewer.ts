import {
    _decorator, Color, Component, EventTouch, Graphics, Label, Layers, Mask,
    Node, resources, Sprite, SpriteFrame, UITransform, Vec2, view,
} from 'cc';
import { LocationInteractionContext, LocationInteractionRegistry } from '../location/LocationInteractionRegistry';

const { ccclass } = _decorator;
const HANDLER_ID = 'stone-base-restoration';

/** A non-modal, same-viewpoint restoration lens for Location 2's stone bases. */
@ccclass('StoneBaseRestorationViewer')
export class StoneBaseRestorationViewer extends Component {
    private root!: Node;
    private lens!: Node;
    private closeButton!: Node;
    private notice!: Label;
    private frame: SpriteFrame | null = null;
    private dragging = false;
    private home = new Vec2();

    onLoad(): void {
        LocationInteractionRegistry.register(HANDLER_ID, this.openFromInteraction);
        resources.load('restoration/location-2-stone-base/spriteFrame', SpriteFrame, (error, frame) => {
            if (error || !frame) return;
            this.frame = frame;
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
        this.root.active = true;
        this.layout();
        this.notice.string = this.frame ? '拖动放大镜查看复原柱网' : '复原图暂不可用，可关闭后继续探索';
    }

    hide(): void {
        if (this.root) this.root.active = false;
        this.dragging = false;
    }

    update(): void {
        if (this.root?.active) this.layout();
    }

    private ensureUi(): void {
        if (this.root) return;
        this.root = new Node('StoneBaseRestorationViewer');
        this.root.layer = Layers.Enum.UI_2D;
        this.root.addComponent(UITransform);
        this.node.addChild(this.root);
        // Sit above the photo world but below the existing HUD/joystick/action buttons.
        this.root.setSiblingIndex(1);

        const hint = new Node('RestorationHint');
        hint.layer = Layers.Enum.UI_2D;
        hint.addComponent(UITransform).setContentSize(280, 34);
        this.notice = hint.addComponent(Label);
        this.notice.fontSize = 18;
        this.notice.lineHeight = 24;
        this.notice.color = new Color(255, 247, 215, 255);
        this.notice.enableOutline = true;
        this.notice.outlineColor = new Color(42, 34, 24, 220);
        this.notice.outlineWidth = 3;
        this.root.addChild(hint);

        this.lens = new Node('RestorationMagnifier');
        this.lens.layer = Layers.Enum.UI_2D;
        this.lens.addComponent(UITransform).setContentSize(220, 220);
        const rim = this.lens.addComponent(Graphics);
        rim.fillColor = new Color(92, 67, 38, 205);
        rim.strokeColor = new Color(239, 211, 149, 255);
        rim.lineWidth = 9;
        rim.circle(0, 0, 108);
        rim.fill();
        rim.stroke();
        const mask = this.lens.addComponent(Mask);
        mask.type = Mask.Type.GRAPHICS_STENCIL;
        const restoration = new Node('HistoricalImage');
        restoration.layer = Layers.Enum.UI_2D;
        restoration.addComponent(UITransform);
        const sprite = restoration.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this.lens.addChild(restoration);
        this.root.addChild(this.lens);
        this.lens.on(Node.EventType.TOUCH_START, this.onLensStart, this);
        this.lens.on(Node.EventType.TOUCH_MOVE, this.onLensMove, this);
        this.lens.on(Node.EventType.TOUCH_END, this.onLensEnd, this);
        this.lens.on(Node.EventType.TOUCH_CANCEL, this.onLensEnd, this);

        this.closeButton = this.createButton('CloseRestorationViewer', '×', 48, new Color(90, 54, 42, 235));
        this.closeButton.on(Node.EventType.TOUCH_END, this.hide, this);
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
        this.root.getComponent(UITransform)!.setContentSize(visible);
        const radius = Math.max(82, Math.min(126, visible.height * 0.17));
        this.lens.getComponent(UITransform)!.setContentSize(radius * 2, radius * 2);
        const graphics = this.lens.getComponent(Graphics)!;
        graphics.clear();
        graphics.fillColor = new Color(92, 67, 38, 205);
        graphics.strokeColor = new Color(239, 211, 149, 255);
        graphics.lineWidth = Math.max(6, radius * 0.075);
        graphics.circle(0, 0, radius);
        graphics.fill();
        graphics.stroke();
        this.home.set(visible.width * 0.5 - radius - 38, 8);
        if (!this.dragging) this.lens.setPosition(this.home.x, this.home.y, 0);
        const image = this.lens.getChildByName('HistoricalImage')!;
        image.getComponent(UITransform)!.setContentSize(visible);
        image.setPosition(-this.lens.position.x, -this.lens.position.y, 0);
        image.getComponent(Sprite)!.spriteFrame = this.frame;
        this.closeButton.setPosition(visible.width * 0.5 - 42, visible.height * 0.5 - 42, 0);
        this.root.getChildByName('RestorationHint')!.setPosition(0, visible.height * 0.5 - 42, 0);
    }

    private onLensStart(event: EventTouch): void { this.dragging = true; this.moveLens(event); }
    private onLensMove(event: EventTouch): void { if (this.dragging) this.moveLens(event); }
    private onLensEnd(): void { this.dragging = false; this.lens.setPosition(this.home.x, this.home.y, 0); }
    private moveLens(event: EventTouch): void {
        const point = event.getUILocation();
        const visible = view.getVisibleSize();
        this.lens.setPosition(point.x - visible.width * 0.5, point.y - visible.height * 0.5, 0);
    }
}
