import {
    _decorator,
    Color,
    Component,
    EventTouch,
    Graphics,
    Layers,
    Mask,
    Node,
    Sprite,
    UITransform,
    Vec2,
    view,
} from 'cc';

const { ccclass } = _decorator;
const MAGNIFICATION = 1.65;

/** A persistent optical magnifier for Location 2, scene 2. */
@ccclass('StoneBaseRestorationViewer')
export class StoneBaseRestorationViewer extends Component {
    private root!: Node;
    private lens!: Node;
    private viewport!: Node;
    private magnifiedImage!: Node;
    private handle!: Node;
    private rim!: Graphics;
    private stencil!: Graphics;
    private dragging = false;
    private dragStartTouch = new Vec2();
    private dragStartLens = new Vec2();
    private home = new Vec2();
    private radius = 112;
    private handleLength = 92;
    private handleSignX = 1;
    private handleSignY = -1;
    private lastVisibleWidth = -1;
    private lastVisibleHeight = -1;

    onLoad(): void {
        this.ensureUi();
        this.root.active = false;
    }

    /** Called by LocationBootstrap whenever its internal photo scene changes. */
    setScene(locationId: string, sceneId: string): void {
        this.ensureUi();
        this.dragging = false;
        this.root.active = locationId === 'location-2' && sceneId === '2';
        if (!this.root.active) return;
        this.lastVisibleWidth = -1;
        this.layout();
        this.alignMagnifiedImage();
    }

    hide(): void {
        this.dragging = false;
        if (this.root) this.root.active = false;
    }

    update(): void {
        if (!this.root?.active) return;
        this.layout();
        this.alignMagnifiedImage();
    }

    private ensureUi(): void {
        if (this.root) return;
        this.root = new Node('StoneBaseMagnifier');
        this.root.layer = Layers.Enum.UI_2D;
        this.root.addComponent(UITransform);
        this.node.addChild(this.root);
        // Above the photo world, below joystick and action controls.
        this.root.setSiblingIndex(1);

        this.lens = new Node('Lens');
        this.lens.layer = Layers.Enum.UI_2D;
        this.lens.addComponent(UITransform);
        this.root.addChild(this.lens);

        this.viewport = new Node('CircularViewport');
        this.viewport.layer = Layers.Enum.UI_2D;
        this.viewport.addComponent(UITransform);
        this.stencil = this.viewport.addComponent(Graphics);
        const mask = this.viewport.addComponent(Mask);
        mask.type = Mask.Type.GRAPHICS_STENCIL;
        this.lens.addChild(this.viewport);

        this.magnifiedImage = new Node('MagnifiedCurrentPhoto');
        this.magnifiedImage.layer = Layers.Enum.UI_2D;
        this.magnifiedImage.addComponent(UITransform);
        const sprite = this.magnifiedImage.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this.viewport.addChild(this.magnifiedImage);

        const glass = new Node('GlassAndRim');
        glass.layer = Layers.Enum.UI_2D;
        glass.addComponent(UITransform);
        this.rim = glass.addComponent(Graphics);
        this.lens.addChild(glass);

        this.handle = new Node('DragHandle');
        this.handle.layer = Layers.Enum.UI_2D;
        this.handle.addComponent(UITransform);
        this.handle.addComponent(Graphics);
        this.lens.addChild(this.handle);
        this.handle.on(Node.EventType.TOUCH_START, this.onHandleStart, this);
        this.handle.on(Node.EventType.TOUCH_MOVE, this.onHandleMove, this);
        this.handle.on(Node.EventType.TOUCH_END, this.onHandleEnd, this);
        this.handle.on(Node.EventType.TOUCH_CANCEL, this.onHandleEnd, this);
    }

    private layout(): void {
        const visible = view.getVisibleSize();
        const sizeChanged = visible.width !== this.lastVisibleWidth
            || visible.height !== this.lastVisibleHeight;
        if (!sizeChanged) return;

        this.lastVisibleWidth = visible.width;
        this.lastVisibleHeight = visible.height;
        this.root.getComponent(UITransform)!.setContentSize(visible);
        this.radius = Math.max(88, Math.min(124, visible.height * 0.165));
        this.handleLength = Math.max(76, Math.min(98, this.radius * 0.82));

        this.home.set(
            visible.width * 0.5 - this.radius - this.handleLength * 0.48 - 34,
            46,
        );
        if (!this.dragging) this.lens.setPosition(this.home.x, this.home.y, 0);
        this.redraw();
    }

    private redraw(): void {
        const innerRadius = this.radius - 9;
        this.lens.getComponent(UITransform)!.setContentSize(
            this.radius * 2 + this.handleLength,
            this.radius * 2 + this.handleLength,
        );
        this.viewport.getComponent(UITransform)!.setContentSize(innerRadius * 2, innerRadius * 2);

        this.stencil.clear();
        this.stencil.fillColor = Color.WHITE;
        this.stencil.circle(0, 0, innerRadius);
        this.stencil.fill();

        this.rim.clear();
        // Dark outer bevel, warm brass body, then a bright inner highlight.
        this.rim.lineWidth = 14;
        this.rim.strokeColor = new Color(54, 37, 22, 245);
        this.rim.circle(0, 0, this.radius + 1);
        this.rim.stroke();
        this.rim.lineWidth = 9;
        this.rim.strokeColor = new Color(184, 126, 54, 255);
        this.rim.circle(0, 0, this.radius - 2);
        this.rim.stroke();
        this.rim.lineWidth = 2;
        this.rim.strokeColor = new Color(255, 226, 151, 235);
        this.rim.circle(-2, 2, this.radius - 8);
        this.rim.stroke();
        // A restrained glass reflection; it remains non-interactive.
        this.rim.lineWidth = 6;
        this.rim.strokeColor = new Color(225, 248, 247, 82);
        this.rim.arc(-15, 16, this.radius * 0.68, 1.95, 2.72, false);
        this.rim.stroke();

        const handleWidth = Math.max(34, this.radius * 0.34);
        const handleGraphics = this.handle.getComponent(Graphics)!;
        handleGraphics.clear();
        handleGraphics.lineWidth = 5;
        handleGraphics.strokeColor = new Color(58, 38, 22, 255);
        handleGraphics.fillColor = new Color(108, 61, 31, 255);
        handleGraphics.roundRect(
            -handleWidth * 0.5,
            -this.handleLength * 0.5,
            handleWidth,
            this.handleLength,
            handleWidth * 0.46,
        );
        handleGraphics.fill();
        handleGraphics.stroke();
        handleGraphics.lineWidth = 3;
        handleGraphics.strokeColor = new Color(223, 165, 83, 220);
        handleGraphics.moveTo(-handleWidth * 0.25, -this.handleLength * 0.25);
        handleGraphics.lineTo(-handleWidth * 0.25, this.handleLength * 0.25);
        handleGraphics.stroke();

        this.updateHandleOrientation(this.lens.position.x, this.lens.position.y);
        const handleOffset = this.getHandleOffset();
        this.handle.setPosition(handleOffset.x, handleOffset.y, 0);
        // Generous touch box around the handle, never around the glass itself.
        this.handle.getComponent(UITransform)!.setContentSize(handleWidth + 28, this.handleLength + 28);
        this.handle.setRotationFromEuler(
            0,
            0,
            Math.atan2(handleOffset.y, handleOffset.x) * 180 / Math.PI - 90,
        );
    }

    private alignMagnifiedImage(): void {
        const world = this.node.getChildByName('PerspectiveWorld');
        const background = world?.getChildByName('BackgroundCurrent')?.getComponent(Sprite);
        const target = this.magnifiedImage.getComponent(Sprite)!;
        target.spriteFrame = background?.spriteFrame ?? null;
        if (!world || !background?.spriteFrame) return;

        const worldSize = world.getComponent(UITransform)?.contentSize ?? view.getVisibleSize();
        this.magnifiedImage.getComponent(UITransform)!.setContentSize(worldSize);
        this.magnifiedImage.setScale(
            world.scale.x * MAGNIFICATION,
            world.scale.y * MAGNIFICATION,
            1,
        );
        // Keep the pixel beneath the lens centre fixed while magnifying it.
        this.magnifiedImage.setPosition(
            (world.position.x - this.lens.position.x) * MAGNIFICATION,
            (world.position.y - this.lens.position.y) * MAGNIFICATION,
            0,
        );
    }

    private getHandleOffset(): Vec2 {
        const distance = this.radius + this.handleLength * 0.42;
        return new Vec2(
            distance * 0.7071 * this.handleSignX,
            distance * 0.7071 * this.handleSignY,
        );
    }

    private updateHandleOrientation(lensX: number, lensY: number): void {
        // Point the handle toward the screen centre so it remains reachable
        // while the glass itself travels beyond any edge.
        this.handleSignX = lensX > 0 ? -1 : 1;
        this.handleSignY = lensY > 0 ? -1 : 1;
        const handleOffset = this.getHandleOffset();
        this.handle.setPosition(handleOffset.x, handleOffset.y, 0);
        this.handle.setRotationFromEuler(
            0,
            0,
            Math.atan2(handleOffset.y, handleOffset.x) * 180 / Math.PI - 90,
        );
    }

    private onHandleStart(event: EventTouch): void {
        event.propagationStopped = true;
        this.dragging = true;
        const point = event.getUILocation();
        this.dragStartTouch.set(point.x, point.y);
        this.dragStartLens.set(this.lens.position.x, this.lens.position.y);
    }

    private onHandleMove(event: EventTouch): void {
        event.propagationStopped = true;
        if (!this.dragging) return;
        const point = event.getUILocation();
        this.moveLensTo(
            this.dragStartLens.x + point.x - this.dragStartTouch.x,
            this.dragStartLens.y + point.y - this.dragStartTouch.y,
        );
    }

    private onHandleEnd(event: EventTouch): void {
        event.propagationStopped = true;
        this.dragging = false;
    }

    private moveLensTo(desiredX: number, desiredY: number): void {
        const visible = view.getVisibleSize();
        // The lens centre reaches every screen corner, allowing roughly half
        // the glass to travel outside. Its handle automatically flips inward.
        const x = Math.max(-visible.width * 0.5, Math.min(visible.width * 0.5, desiredX));
        const y = Math.max(-visible.height * 0.5, Math.min(visible.height * 0.5, desiredY));
        this.lens.setPosition(x, y, 0);
        this.updateHandleOrientation(x, y);
        this.alignMagnifiedImage();
    }
}
