import {
    _decorator,
    Color,
    Component,
    EventTouch,
    Graphics,
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

const { ccclass } = _decorator;
const MAGNIFICATION = 1.65;
const DOCKED_FRAME = 'ui/magnifier/magnifier-docked/spriteFrame';
const EXPANDED_FRAME = 'ui/magnifier/magnifier-expanded-frame/spriteFrame';

/** A persistent optical magnifier shared by every location photo scene. */
@ccclass('StoneBaseRestorationViewer')
export class StoneBaseRestorationViewer extends Component {
    private root!: Node;
    private lens!: Node;
    private viewport!: Node;
    private magnifiedImage!: Node;
    private dockedVisual!: Node;
    private expandedVisual!: Node;
    private handle!: Node;
    private stencil!: Graphics;
    private fallback!: Graphics;
    private dragging = false;
    private dragStartTouch = new Vec2();
    private dragStartLens = new Vec2();
    private home = new Vec2();
    private radius = 112;
    private expandedHandleOffset = new Vec2(96, -108);
    private lastVisibleWidth = -1;
    private lastVisibleHeight = -1;

    onLoad(): void {
        this.ensureUi();
        this.root.active = false;
        this.loadArtwork();
    }

    /** Called by LocationBootstrap whenever its internal photo scene changes. */
    setScene(_locationId: string, _sceneId: string): void {
        this.ensureUi();
        this.dragging = false;
        this.root.active = true;
        this.lastVisibleWidth = -1;
        this.layout();
        this.showDockedState();
    }

    hide(): void {
        this.dragging = false;
        if (this.root) this.root.active = false;
    }

    update(): void {
        if (!this.root?.active) return;
        this.layout();
        if (this.dragging) this.alignMagnifiedImage();
    }

    private ensureUi(): void {
        if (this.root) return;
        this.root = new Node('SceneMagnifier');
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
        const magnifiedSprite = this.magnifiedImage.addComponent(Sprite);
        magnifiedSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this.viewport.addChild(this.magnifiedImage);

        this.dockedVisual = this.createArtworkNode('DockedArtwork');
        this.expandedVisual = this.createArtworkNode('ExpandedArtwork');

        const fallbackNode = new Node('ArtworkFallback');
        fallbackNode.layer = Layers.Enum.UI_2D;
        fallbackNode.addComponent(UITransform);
        this.fallback = fallbackNode.addComponent(Graphics);
        this.lens.addChild(fallbackNode);

        this.handle = new Node('DragHandle');
        this.handle.layer = Layers.Enum.UI_2D;
        this.handle.addComponent(UITransform);
        this.lens.addChild(this.handle);
        this.handle.on(Node.EventType.TOUCH_START, this.onHandleStart, this);
        this.handle.on(Node.EventType.TOUCH_MOVE, this.onHandleMove, this);
        this.handle.on(Node.EventType.TOUCH_END, this.onHandleEnd, this);
        this.handle.on(Node.EventType.TOUCH_CANCEL, this.onHandleEnd, this);
    }

    private createArtworkNode(name: string): Node {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        node.addComponent(UITransform);
        const sprite = node.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this.lens.addChild(node);
        return node;
    }

    private loadArtwork(): void {
        resources.load(DOCKED_FRAME, SpriteFrame, (error, frame) => {
            if (error || !this.isValid) return;
            this.dockedVisual.getComponent(Sprite)!.spriteFrame = frame;
            this.layoutArtwork();
            this.updateFallbackVisibility();
        });
        resources.load(EXPANDED_FRAME, SpriteFrame, (error, frame) => {
            if (error || !this.isValid) return;
            this.expandedVisual.getComponent(Sprite)!.spriteFrame = frame;
            this.layoutArtwork();
            this.updateFallbackVisibility();
        });
    }

    private layout(): void {
        const visible = view.getVisibleSize();
        if (visible.width === this.lastVisibleWidth && visible.height === this.lastVisibleHeight) return;
        this.lastVisibleWidth = visible.width;
        this.lastVisibleHeight = visible.height;
        this.root.getComponent(UITransform)!.setContentSize(visible);

        this.radius = Math.max(88, Math.min(124, visible.height * 0.165));
        // The compact icon rests on the right without occupying the action-button area.
        this.home.set(visible.width * 0.5 - 62, Math.min(70, visible.height * 0.1));
        this.expandedHandleOffset.set(this.radius * 0.86, -this.radius * 0.96);
        if (!this.dragging) this.lens.setPosition(this.home.x, this.home.y, 0);

        const innerRadius = this.radius - 10;
        this.lens.getComponent(UITransform)!.setContentSize(this.radius * 4, this.radius * 4);
        this.viewport.getComponent(UITransform)!.setContentSize(innerRadius * 2, innerRadius * 2);
        this.stencil.clear();
        this.stencil.fillColor = Color.WHITE;
        this.stencil.circle(0, 0, innerRadius);
        this.stencil.fill();
        this.layoutArtwork();
        this.layoutHandle();
    }

    private layoutArtwork(): void {
        if (!this.dockedVisual) return;
        const dockedHeight = Math.max(76, Math.min(92, this.lastVisibleHeight * 0.125));
        const dockedWidth = dockedHeight * 643 / 788;
        this.dockedVisual.getComponent(UITransform)!.setContentSize(dockedWidth, dockedHeight);
        // The source circle is left/above its image centre because the handle extends down-right.
        this.dockedVisual.setPosition(dockedHeight * 0.10, -dockedHeight * 0.21, 0);

        const expandedWidth = this.radius * 2.18;
        const expandedHeight = expandedWidth * 968 / 844;
        this.expandedVisual.getComponent(UITransform)!.setContentSize(expandedWidth, expandedHeight);
        // Align the artwork's ring centre with the circular mask centre.
        this.expandedVisual.setPosition(this.radius * 0.044, -this.radius * 0.20, 0);
    }

    private layoutHandle(): void {
        const dockedOffset = new Vec2(26, -34);
        const offset = this.dragging ? this.expandedHandleOffset : dockedOffset;
        this.handle.setPosition(offset.x, offset.y, 0);
        // The invisible touch target stays on the visible wooden grip only.
        this.handle.getComponent(UITransform)!.setContentSize(
            this.dragging ? Math.max(54, this.radius * 0.48) : 48,
            this.dragging ? Math.max(68, this.radius * 0.62) : 58,
        );
        this.handle.setRotationFromEuler(0, 0, -45);
    }

    private showDockedState(): void {
        this.dragging = false;
        this.lens.setPosition(this.home.x, this.home.y, 0);
        this.viewport.active = false;
        this.dockedVisual.active = true;
        this.expandedVisual.active = false;
        this.layoutHandle();
        this.drawFallback(false);
    }

    private showExpandedState(): void {
        this.viewport.active = true;
        this.dockedVisual.active = false;
        this.expandedVisual.active = true;
        this.layoutHandle();
        this.drawFallback(true);
        this.alignMagnifiedImage();
    }

    private updateFallbackVisibility(): void {
        this.drawFallback(this.dragging);
    }

    private drawFallback(expanded: boolean): void {
        const frame = (expanded ? this.expandedVisual : this.dockedVisual).getComponent(Sprite)!.spriteFrame;
        this.fallback.node.active = !frame;
        if (frame) return;
        this.fallback.clear();
        this.fallback.lineWidth = expanded ? 10 : 5;
        this.fallback.strokeColor = new Color(190, 132, 58, 255);
        this.fallback.circle(0, 0, expanded ? this.radius : 26);
        this.fallback.stroke();
        this.fallback.lineWidth = expanded ? 16 : 9;
        this.fallback.moveTo(expanded ? 76 : 18, expanded ? -76 : -18);
        this.fallback.lineTo(expanded ? 112 : 35, expanded ? -112 : -35);
        this.fallback.stroke();
    }

    private alignMagnifiedImage(): void {
        const world = this.node.getChildByName('PerspectiveWorld');
        const background = world?.getChildByName('BackgroundCurrent')?.getComponent(Sprite);
        const target = this.magnifiedImage.getComponent(Sprite)!;
        target.spriteFrame = background?.spriteFrame ?? null;
        if (!world || !background?.spriteFrame) return;

        const worldSize = world.getComponent(UITransform)?.contentSize ?? view.getVisibleSize();
        this.magnifiedImage.getComponent(UITransform)!.setContentSize(worldSize);
        this.magnifiedImage.setScale(world.scale.x * MAGNIFICATION, world.scale.y * MAGNIFICATION, 1);
        // Keep the pixel beneath the lens centre fixed while magnifying it.
        this.magnifiedImage.setPosition(
            (world.position.x - this.lens.position.x) * MAGNIFICATION,
            (world.position.y - this.lens.position.y) * MAGNIFICATION,
            0,
        );
    }

    private onHandleStart(event: EventTouch): void {
        event.propagationStopped = true;
        const point = event.getUILocation();
        this.dragging = true;
        // Expand around the held handle so the grip does not jump away from the finger.
        this.lens.setPosition(
            this.lens.position.x + 26 - this.expandedHandleOffset.x,
            this.lens.position.y - 34 - this.expandedHandleOffset.y,
            0,
        );
        this.dragStartTouch.set(point.x, point.y);
        this.dragStartLens.set(this.lens.position.x, this.lens.position.y);
        this.showExpandedState();
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
        this.showDockedState();
    }

    private moveLensTo(desiredX: number, desiredY: number): void {
        const visible = view.getVisibleSize();
        // Let the glass travel partly beyond the photo so its edge pixels remain inspectable.
        const overflow = this.radius * 0.55;
        const x = Math.max(-visible.width * 0.5 - overflow, Math.min(visible.width * 0.5 + overflow, desiredX));
        const y = Math.max(-visible.height * 0.5 - overflow, Math.min(visible.height * 0.5 + overflow, desiredY));
        this.lens.setPosition(x, y, 0);
        this.alignMagnifiedImage();
    }
}
