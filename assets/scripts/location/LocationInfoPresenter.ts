import {
    _decorator,
    BlockInputEvents,
    Color,
    Component,
    EventKeyboard,
    EventTouch,
    Graphics,
    input,
    Input,
    KeyCode,
    Label,
    Layers,
    Node,
    resources,
    Sprite,
    SpriteFrame,
    UITransform,
    Vec2,
    view,
} from 'cc';
import { EDITOR } from 'cc/env';
import {
    LocationInteractionContext,
    LocationInteractionRegistry,
} from './LocationInteractionRegistry';

const { ccclass, executeInEditMode, property } = _decorator;

type LocationInfoImage = {
    path: string;
    caption?: string;
};

type LocationInfoPayload = {
    kicker?: string;
    title: string;
    body: string;
    images?: LocationInfoImage[];
};

/**
 * Shared presenter for editor-authored Location interaction regions.
 * Content and trigger polygons live in regions.json / RegionEditor; this
 * component only owns the reusable F-key, modal and image paging behaviour.
 */
@ccclass('LocationInfoPresenter')
@executeInEditMode
export class LocationInfoPresenter extends Component {
    @property({ tooltip: '图文卡片设计宽度；可在属性检查器中调整。' })
    panelWidth = 880;

    @property({ tooltip: '图文卡片设计高度；可在属性检查器中调整。' })
    panelHeight = 480;

    @property({ tooltip: '卡片左侧图片区域宽度。' })
    imagePaneWidth = 420;

    @property({ tooltip: '卡片内容边距。' })
    contentPadding = 26;

    @property({ tooltip: '靠近交互点时，底部提示距屏幕底部的距离。' })
    promptBottom = 122;

    @property({ tooltip: '弹窗相对屏幕的最大占用比例。' })
    screenCoverage = 0.8;

    private promptRoot!: Node;
    private promptLabel!: Label;
    private overlay!: Node;
    private panel!: Node;
    private imageNode!: Node;
    private imageSpriteNode!: Node;
    private imageSprite!: Sprite;
    private kickerLabel!: Label;
    private titleLabel!: Label;
    private bodyLabel!: Label;
    private captionLabel!: Label;
    private pageLabel!: Label;
    private previousButton!: Node;
    private nextButton!: Node;
    private activeRegionId = '';
    private currentContext: LocationInteractionContext | null = null;
    private currentPayload: LocationInfoPayload | null = null;
    private imageIndex = 0;
    private imageLoadToken = 0;
    private lastVisibleSize = new Vec2(-1, -1);

    onLoad(): void {
        if (!this.bindAuthoredUi()) {
            if (EDITOR) return;
            this.createUi();
        }
        this.drawAuthoredUi();
        if (EDITOR) return;
        LocationInteractionRegistry.register('location-info', this.openInfo);
        this.node.on('location-interaction-enter', this.onInteractionEnter, this);
        this.node.on('location-interaction-exit', this.onInteractionExit, this);
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        this.layoutUi(true);
    }

    onDestroy(): void {
        if (EDITOR) return;
        LocationInteractionRegistry.unregister('location-info');
        this.node.off('location-interaction-enter', this.onInteractionEnter, this);
        this.node.off('location-interaction-exit', this.onInteractionExit, this);
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    }

    update(): void {
        if (!EDITOR) this.layoutUi(false);
    }

    private bindAuthoredUi(): boolean {
        const root = this.node.getChildByName('InteractionUI');
        const prompt = root?.getChildByName('InteractionPrompt');
        const overlay = root?.getChildByName('LocationInfoOverlay');
        const panel = overlay?.getChildByName('InfoCard');
        const image = panel?.getChildByName('Photo');
        const imageSpriteNode = image?.getChildByName('PhotoSprite');
        if (!root || !prompt || !overlay || !panel || !image || !imageSpriteNode) return false;

        const labelFrom = (parentName: string, childName: string): Label | null => (
            panel.getChildByName(parentName)?.getChildByName(childName)?.getComponent(Label) ?? null
        );
        const promptLabel = prompt.getChildByName('InteractionPromptLabel')?.getComponent(Label);
        const imageSprite = imageSpriteNode.getComponent(Sprite);
        const kicker = labelFrom('Kicker', 'KickerLabel');
        const title = labelFrom('Title', 'TitleLabel');
        const body = labelFrom('Body', 'BodyLabel');
        const caption = labelFrom('Caption', 'CaptionLabel');
        const page = labelFrom('PhotoPage', 'PhotoPageLabel');
        const previous = panel.getChildByName('PreviousPhoto');
        const next = panel.getChildByName('NextPhoto');
        if (
            !promptLabel || !imageSprite || !kicker || !title || !body
            || !caption || !page || !previous || !next
        ) return false;

        this.promptRoot = prompt;
        this.promptLabel = promptLabel;
        this.overlay = overlay;
        this.panel = panel;
        this.imageNode = image;
        this.imageSpriteNode = imageSpriteNode;
        this.imageSprite = imageSprite;
        this.kickerLabel = kicker;
        this.titleLabel = title;
        this.bodyLabel = body;
        this.captionLabel = caption;
        this.pageLabel = page;
        this.previousButton = previous;
        this.nextButton = next;

        if (!EDITOR) {
            overlay.on(Node.EventType.TOUCH_END, this.onOverlayTouched, this);
            panel.getChildByName('Close')?.on(Node.EventType.TOUCH_END, this.onCloseTouched, this);
            previous.on(Node.EventType.TOUCH_END, this.onPreviousTouched, this);
            next.on(Node.EventType.TOUCH_END, this.onNextTouched, this);
        }
        return true;
    }

    private drawAuthoredUi(): void {
        if (!this.overlay || !this.panel || !this.promptRoot || !this.imageNode) return;
        const promptGraphics = this.promptRoot.getComponent(Graphics);
        if (promptGraphics) {
            promptGraphics.clear();
            promptGraphics.fillColor = new Color(24, 23, 21, 246);
            promptGraphics.strokeColor = new Color(224, 181, 91, 255);
            promptGraphics.lineWidth = 2;
            const size = this.promptRoot.getComponent(UITransform)?.contentSize;
            const width = size?.width ?? 380;
            const height = size?.height ?? 48;
            promptGraphics.roundRect(-width * 0.5, -height * 0.5, width, height, 8);
            promptGraphics.fill();
            promptGraphics.stroke();
        }

        const panelGraphics = this.panel.getComponent(Graphics);
        if (panelGraphics) {
            panelGraphics.clear();
            panelGraphics.fillColor = new Color(28, 27, 25, 252);
            panelGraphics.strokeColor = new Color(218, 176, 91, 255);
            panelGraphics.lineWidth = 3;
            panelGraphics.roundRect(
                -this.panelWidth * 0.5,
                -this.panelHeight * 0.5,
                this.panelWidth,
                this.panelHeight,
                18,
            );
            panelGraphics.fill();
            panelGraphics.stroke();
        }

        const imageGraphics = this.imageNode.getComponent(Graphics);
        if (imageGraphics) {
            imageGraphics.clear();
            imageGraphics.fillColor = new Color(12, 12, 11, 255);
            const height = this.panelHeight - this.contentPadding * 2;
            imageGraphics.roundRect(
                -this.imagePaneWidth * 0.5,
                -height * 0.5,
                this.imagePaneWidth,
                height,
                12,
            );
            imageGraphics.fill();
        }

        for (const name of ['Close', 'PreviousPhoto', 'NextPhoto']) {
            const button = this.panel.getChildByName(name);
            const graphics = button?.getComponent(Graphics);
            const size = button?.getComponent(UITransform)?.contentSize;
            if (!graphics || !size) continue;
            graphics.clear();
            graphics.fillColor = new Color(128, 88, 38, 255);
            graphics.roundRect(
                -size.width * 0.5,
                -size.height * 0.5,
                size.width,
                size.height,
                Math.min(size.width, size.height) * 0.5,
            );
            graphics.fill();
        }
    }

    private readonly openInfo = (context: LocationInteractionContext): void => {
        const payload = this.toPayload(context.payload);
        if (!payload) {
            console.warn(`[LocationInfoPresenter] 交互 ${context.regionId} 缺少有效图文数据。`);
            return;
        }

        this.currentContext = context;
        this.currentPayload = payload;
        this.imageIndex = 0;
        this.overlay.parent?.setSiblingIndex(this.node.children.length - 1);
        this.kickerLabel.string = payload.kicker || '明中都遗址导览';
        this.titleLabel.string = payload.title;
        this.bodyLabel.string = payload.body;
        this.overlay.active = true;
        this.promptRoot.active = false;
        this.node.emit('location-info-opened', context);
        this.showCurrentImage();
        this.layoutUi(true);
    };

    private closeInfo(): void {
        if (!this.overlay.active) return;
        const closedContext = this.currentContext;
        this.overlay.active = false;
        this.currentContext = null;
        this.currentPayload = null;
        this.imageLoadToken += 1;
        this.promptRoot.active = this.activeRegionId.length > 0;
        if (closedContext) this.node.emit('location-info-closed', closedContext);
    }

    private onInteractionEnter(context: LocationInteractionContext): void {
        if (context.handlerId !== 'location-info') return;
        this.activeRegionId = context.regionId;
        this.promptLabel.string = `F  ·  ${context.prompt || '查看遗址介绍'}`;
        if (!this.overlay.active) this.promptRoot.active = true;
    }

    private onInteractionExit(regionId: string): void {
        if (regionId !== this.activeRegionId) return;
        this.activeRegionId = '';
        this.promptRoot.active = false;
    }

    private onKeyDown(event: EventKeyboard): void {
        if (!this.overlay.active) return;
        if (event.keyCode === KeyCode.ESCAPE) {
            this.closeInfo();
        } else if (event.keyCode === KeyCode.ARROW_LEFT || event.keyCode === KeyCode.KEY_A) {
            this.changeImage(-1);
        } else if (event.keyCode === KeyCode.ARROW_RIGHT || event.keyCode === KeyCode.KEY_D) {
            this.changeImage(1);
        }
    }

    private createUi(): void {
        this.promptRoot = this.makeNode('InteractionPrompt', 380, 48);
        const promptBackground = this.promptRoot.addComponent(Graphics);
        promptBackground.fillColor = new Color(24, 23, 21, 246);
        promptBackground.strokeColor = new Color(224, 181, 91, 255);
        promptBackground.lineWidth = 2;
        promptBackground.roundRect(-190, -24, 380, 48, 8);
        promptBackground.fill();
        promptBackground.stroke();
        this.promptLabel = this.addLabel(this.promptRoot, 'F  查看遗址介绍', 20, new Color(255, 250, 238));
        this.promptLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        this.promptLabel.verticalAlign = Label.VerticalAlign.CENTER;
        this.promptRoot.active = false;
        this.node.addChild(this.promptRoot);

        this.overlay = this.makeNode('LocationInfoOverlay', 1, 1);
        this.overlay.addComponent(BlockInputEvents);
        this.overlay.on(Node.EventType.TOUCH_END, this.onOverlayTouched, this);
        this.node.addChild(this.overlay);

        this.panel = this.makeNode('InfoCard', this.panelWidth, this.panelHeight);
        const panelBackground = this.panel.addComponent(Graphics);
        panelBackground.fillColor = new Color(28, 27, 25, 252);
        panelBackground.strokeColor = new Color(218, 176, 91, 255);
        panelBackground.lineWidth = 3;
        panelBackground.roundRect(
            -this.panelWidth * 0.5,
            -this.panelHeight * 0.5,
            this.panelWidth,
            this.panelHeight,
            18,
        );
        panelBackground.fill();
        panelBackground.stroke();
        this.overlay.addChild(this.panel);

        const imageHeight = this.panelHeight - this.contentPadding * 2;
        this.imageNode = this.makeNode('Photo', this.imagePaneWidth, imageHeight);
        this.imageNode.setPosition(
            -this.panelWidth * 0.5 + this.contentPadding + this.imagePaneWidth * 0.5,
            0,
        );
        const imageBackdrop = this.imageNode.addComponent(Graphics);
        imageBackdrop.fillColor = new Color(12, 12, 11, 255);
        imageBackdrop.roundRect(
            -this.imagePaneWidth * 0.5,
            -imageHeight * 0.5,
            this.imagePaneWidth,
            imageHeight,
            12,
        );
        imageBackdrop.fill();
        this.imageSpriteNode = this.makeNode('PhotoSprite', this.imagePaneWidth, imageHeight);
        this.imageSprite = this.imageSpriteNode.addComponent(Sprite);
        this.imageSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this.imageNode.addChild(this.imageSpriteNode);
        this.panel.addChild(this.imageNode);

        const textLeft = -this.panelWidth * 0.5
            + this.contentPadding * 2
            + this.imagePaneWidth;
        const textWidth = this.panelWidth * 0.5 - this.contentPadding - textLeft;

        const kickerNode = this.makeNode('Kicker', textWidth, 32);
        kickerNode.setPosition(textLeft + textWidth * 0.5, this.panelHeight * 0.5 - 42);
        this.kickerLabel = this.addLabel(kickerNode, '', 17, new Color(232, 189, 99));
        this.kickerLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
        this.panel.addChild(kickerNode);

        const titleNode = this.makeNode('Title', textWidth, 70);
        titleNode.setPosition(textLeft + textWidth * 0.5, this.panelHeight * 0.5 - 88);
        this.titleLabel = this.addLabel(titleNode, '', 30, new Color(255, 250, 238));
        this.titleLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
        this.titleLabel.verticalAlign = Label.VerticalAlign.CENTER;
        this.titleLabel.overflow = Label.Overflow.SHRINK;
        this.panel.addChild(titleNode);

        const bodyNode = this.makeNode('Body', textWidth, 244);
        bodyNode.setPosition(textLeft + textWidth * 0.5, 2);
        this.bodyLabel = this.addLabel(bodyNode, '', 19, new Color(239, 235, 226));
        this.bodyLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
        this.bodyLabel.verticalAlign = Label.VerticalAlign.TOP;
        this.bodyLabel.overflow = Label.Overflow.SHRINK;
        this.bodyLabel.enableWrapText = true;
        this.bodyLabel.lineHeight = 30;
        this.panel.addChild(bodyNode);

        const captionNode = this.makeNode('Caption', textWidth, 56);
        captionNode.setPosition(textLeft + textWidth * 0.5, -this.panelHeight * 0.5 + 62);
        this.captionLabel = this.addLabel(captionNode, '', 16, new Color(207, 195, 174));
        this.captionLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
        this.captionLabel.verticalAlign = Label.VerticalAlign.CENTER;
        this.captionLabel.overflow = Label.Overflow.SHRINK;
        this.panel.addChild(captionNode);

        const closeButton = this.createTextButton('Close', '×', 48, 48, 28);
        closeButton.setPosition(this.panelWidth * 0.5 - 34, this.panelHeight * 0.5 - 34);
        closeButton.on(Node.EventType.TOUCH_END, this.onCloseTouched, this);
        this.panel.addChild(closeButton);

        this.previousButton = this.createTextButton('PreviousPhoto', '‹', 48, 48, 30);
        this.previousButton.setPosition(-this.panelWidth * 0.5 + this.contentPadding + 34, -this.panelHeight * 0.5 + 40);
        this.previousButton.on(Node.EventType.TOUCH_END, this.onPreviousTouched, this);
        this.panel.addChild(this.previousButton);

        this.nextButton = this.createTextButton('NextPhoto', '›', 48, 48, 30);
        this.nextButton.setPosition(
            -this.panelWidth * 0.5 + this.contentPadding + this.imagePaneWidth - 34,
            -this.panelHeight * 0.5 + 40,
        );
        this.nextButton.on(Node.EventType.TOUCH_END, this.onNextTouched, this);
        this.panel.addChild(this.nextButton);

        const pageNode = this.makeNode('PhotoPage', 130, 40);
        pageNode.setPosition(
            -this.panelWidth * 0.5 + this.contentPadding + this.imagePaneWidth * 0.5,
            -this.panelHeight * 0.5 + 40,
        );
        this.pageLabel = this.addLabel(pageNode, '', 18, new Color(255, 245, 220));
        this.pageLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        this.pageLabel.verticalAlign = Label.VerticalAlign.CENTER;
        this.panel.addChild(pageNode);

        this.overlay.active = false;
    }

    private showCurrentImage(): void {
        const images = this.currentPayload?.images ?? [];
        const hasMultipleImages = images.length > 1;
        this.previousButton.active = hasMultipleImages;
        this.nextButton.active = hasMultipleImages;
        this.pageLabel.node.active = images.length > 0;

        if (images.length === 0) {
            this.imageSprite.spriteFrame = null;
            this.captionLabel.string = '暂无现场照片';
            this.pageLabel.string = '';
            return;
        }

        this.imageIndex = (this.imageIndex + images.length) % images.length;
        const image = images[this.imageIndex];
        this.captionLabel.string = image.caption || '';
        this.pageLabel.string = `${this.imageIndex + 1} / ${images.length}`;
        const token = ++this.imageLoadToken;
        this.imageSprite.spriteFrame = null;
        resources.load(`${image.path}/spriteFrame`, SpriteFrame, (error, frame) => {
            if (token !== this.imageLoadToken || !this.imageNode.isValid) return;
            if (error || !frame) {
                console.warn(`[LocationInfoPresenter] 图片加载失败：${image.path}`, error);
                return;
            }
            this.imageSprite.spriteFrame = frame;
            this.fitImage(frame);
        });
    }

    private changeImage(offset: number): void {
        const count = this.currentPayload?.images?.length ?? 0;
        if (count < 2) return;
        this.imageIndex = (this.imageIndex + offset + count) % count;
        this.showCurrentImage();
    }

    private fitImage(frame: SpriteFrame): void {
        const source = frame.originalSize;
        const availableWidth = this.imagePaneWidth - 20;
        const availableHeight = this.panelHeight - this.contentPadding * 2 - 20;
        const scale = Math.min(availableWidth / source.width, availableHeight / source.height);
        this.imageSpriteNode.getComponent(UITransform)?.setContentSize(
            source.width * scale,
            source.height * scale,
        );
    }

    private layoutUi(force: boolean): void {
        if (!this.overlay) return;
        const visible = view.getVisibleSize();
        if (!force && visible.width === this.lastVisibleSize.x && visible.height === this.lastVisibleSize.y) return;
        this.lastVisibleSize.set(visible.width, visible.height);

        this.overlay.getComponent(UITransform)?.setContentSize(visible);
        const overlayGraphics = this.overlay.getComponent(Graphics) ?? this.overlay.addComponent(Graphics);
        overlayGraphics.clear();
        overlayGraphics.fillColor = new Color(10, 10, 9, 214);
        overlayGraphics.rect(-visible.width * 0.5, -visible.height * 0.5, visible.width, visible.height);
        overlayGraphics.fill();

        const safeWidth = Math.max(1, visible.width * this.screenCoverage);
        const safeHeight = Math.max(1, visible.height * this.screenCoverage);
        const scale = Math.min(1, safeWidth / this.panelWidth, safeHeight / this.panelHeight);
        this.panel.setScale(scale, scale, 1);
        this.panel.setPosition(0, 0, 0);
        this.promptRoot.setPosition(0, -visible.height * 0.5 + this.promptBottom, 0);
    }

    private toPayload(payload: unknown): LocationInfoPayload | null {
        if (!payload || typeof payload !== 'object') return null;
        const raw = payload as Record<string, unknown>;
        if (typeof raw.title !== 'string' || typeof raw.body !== 'string') return null;
        const images = Array.isArray(raw.images)
            ? raw.images
                .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
                .filter((item) => typeof item.path === 'string')
                .map((item) => ({
                    path: item.path as string,
                    caption: typeof item.caption === 'string' ? item.caption : '',
                }))
            : [];
        return {
            kicker: typeof raw.kicker === 'string' ? raw.kicker : '',
            title: raw.title,
            body: raw.body,
            images,
        };
    }

    private makeNode(name: string, width: number, height: number): Node {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        node.addComponent(UITransform).setContentSize(width, height);
        return node;
    }

    private addLabel(parent: Node, text: string, fontSize: number, color: Color): Label {
        const parentSize = parent.getComponent(UITransform)?.contentSize;
        const labelNode = this.makeNode(
            `${parent.name}Label`,
            parentSize?.width ?? 1,
            parentSize?.height ?? 1,
        );
        const label = labelNode.addComponent(Label);
        label.string = text;
        label.fontSize = fontSize;
        label.lineHeight = Math.round(fontSize * 1.4);
        label.color = color;
        parent.addChild(labelNode);
        return label;
    }

    private createTextButton(
        name: string,
        text: string,
        width: number,
        height: number,
        fontSize: number,
    ): Node {
        const node = this.makeNode(name, width, height);
        const background = node.addComponent(Graphics);
        background.fillColor = new Color(128, 88, 38, 255);
        background.roundRect(-width * 0.5, -height * 0.5, width, height, 8);
        background.fill();
        const label = this.addLabel(node, text, fontSize, new Color(255, 245, 220));
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        return node;
    }

    private onOverlayTouched(event: EventTouch): void {
        event.propagationStopped = true;
    }

    private onCloseTouched(event: EventTouch): void {
        event.propagationStopped = true;
        this.closeInfo();
    }

    private onPreviousTouched(event: EventTouch): void {
        event.propagationStopped = true;
        this.changeImage(-1);
    }

    private onNextTouched(event: EventTouch): void {
        event.propagationStopped = true;
        this.changeImage(1);
    }
}
