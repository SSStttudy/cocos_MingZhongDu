import {
    BlockInputEvents,
    Color,
    EventTouch,
    Graphics,
    Label,
    Layers,
    Node,
    resources,
    Sprite,
    SpriteFrame,
    UITransform,
    view,
} from 'cc';

const CREAM = new Color(255, 246, 218, 255);
const GOLD = new Color(222, 185, 104, 255);
const INK = new Color(0, 0, 0, 128);

export class TourGuideOverlay {
    readonly root: Node;

    private objectiveCard: Node;
    private objectiveTitle: Label;
    private objectiveText: Label;
    private speechGroup: Node;
    private speechBubble: Node;
    private speechLabel: Label;
    private portraitNode: Node;
    private portraitSprite: Sprite;
    private portraitLabel: Label;
    private minimizeButton: Node;
    private checkpointPanel: Node;
    private checkpointTitle: Label;
    private checkpointText: Label;
    private checkpointContinueButton: Node;
    private checkpointSecondaryButton: Node;
    private contextActionButton: Node;
    private continueAction: (() => void) | null = null;
    private secondaryAction: (() => void) | null = null;
    private contextAction: (() => void) | null = null;
    private minimized = false;
    private portraitRequest = 0;
    private portraitDragDistance = 0;
    private bubbleVisibleBeforeDrag = true;
    private speechBubbleWidth = 340;
    private lastWidth = 0;
    private lastHeight = 0;

    constructor(private readonly host: Node) {
        this.root = this.createNode('TourGuideUI', host);
        this.root.addComponent(UITransform);

        this.objectiveCard = this.createPanel('TourObjectiveCard', this.root, 360, 96, 16);
        this.objectiveTitle = this.createLabel('当前目标', 16, GOLD, this.objectiveCard, 318, 28);
        this.objectiveTitle.node.setPosition(0, 25);
        this.objectiveText = this.createLabel('', 20, CREAM, this.objectiveCard, 318, 48);
        this.objectiveText.node.setPosition(0, -13);

        this.minimizeButton = this.createRoundButton('TourMinimizeButton', '－', this.root, 42);
        this.minimizeButton.on(Node.EventType.TOUCH_END, this.toggleMinimized, this);

        this.speechGroup = this.createNode('TourSpeechGroup', this.root);
        this.speechGroup.addComponent(UITransform).setContentSize(470, 168);
        const portrait = this.createNode('TourPortrait', this.speechGroup);
        portrait.addComponent(UITransform).setContentSize(156, 156);
        portrait.setPosition(181, -4);
        this.portraitNode = portrait;
        portrait.on(Node.EventType.TOUCH_START, this.onPortraitTouchStart, this);
        portrait.on(Node.EventType.TOUCH_MOVE, this.onPortraitTouchMove, this);
        portrait.on(Node.EventType.TOUCH_END, this.onPortraitTouchEnd, this);
        portrait.on(Node.EventType.TOUCH_CANCEL, this.onPortraitTouchEnd, this);
        const portraitImage = this.createNode('PortraitImage', portrait);
        portraitImage.addComponent(UITransform).setContentSize(150, 150);
        this.portraitSprite = portraitImage.addComponent(Sprite);
        this.portraitSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this.portraitLabel = this.createLabel('朱', 54, GOLD, portrait, 120, 120);

        const bubble = this.createPanel('TourSpeechBubble', this.speechGroup, 340, 110, 18);
        bubble.setPosition(-51, 4);
        this.speechBubble = bubble;
        this.speechLabel = this.createLabel('', 18, CREAM, bubble, 300, 82);

        this.checkpointPanel = this.createNode('TourCheckpointPanel', this.root);
        this.checkpointPanel.addComponent(UITransform);
        this.checkpointPanel.addComponent(BlockInputEvents);
        const dim = this.createNode('CheckpointDim', this.checkpointPanel);
        dim.addComponent(UITransform);
        dim.addComponent(Graphics);
        const card = this.createPanel('CheckpointCard', this.checkpointPanel, 560, 320, 22);
        this.checkpointTitle = this.createLabel('', 34, GOLD, card, 490, 56);
        this.checkpointTitle.node.setPosition(0, 88);
        this.checkpointText = this.createLabel('', 20, CREAM, card, 470, 110);
        this.checkpointText.node.setPosition(0, 12);
        this.checkpointContinueButton = this.createButton('CheckpointContinue', '继续游览', card, 220, 52);
        this.checkpointContinueButton.setPosition(0, -102);
        this.checkpointContinueButton.on(Node.EventType.TOUCH_END, this.onContinue, this);
        this.checkpointSecondaryButton = this.createButton('CheckpointSecondary', '返回大地图', card, 190, 48);
        this.checkpointSecondaryButton.setPosition(125, -102);
        this.checkpointSecondaryButton.on(Node.EventType.TOUCH_END, this.onSecondary, this);
        this.checkpointSecondaryButton.active = false;
        this.checkpointPanel.active = false;

        this.contextActionButton = this.createButton('TourContextAction', '查看', this.root, 132, 52);
        this.contextActionButton.on(Node.EventType.TOUCH_END, this.onContextAction, this);
        this.contextActionButton.active = false;

        this.layout(true);
    }

    destroy(): void {
        this.root.destroy();
    }

    layout(force = false): void {
        if (!this.root.isValid) return;
        const visible = view.getVisibleSize();
        if (!force && visible.width === this.lastWidth && visible.height === this.lastHeight) return;
        this.lastWidth = visible.width;
        this.lastHeight = visible.height;
        this.root.getComponent(UITransform)!.setContentSize(visible);
        this.objectiveCard.setPosition(-visible.width * 0.5 + 205, visible.height * 0.5 - 70);
        this.minimizeButton.setPosition(-visible.width * 0.5 + 400, visible.height * 0.5 - 48);
        // 右下角留给固定交互与疾行按键。
        this.speechGroup.setPosition(visible.width * 0.5 - 270, -visible.height * 0.5 + 250);
        this.contextActionButton.setPosition(0, -visible.height * 0.5 + 72);
        this.placeSpeechBubble();
        this.checkpointPanel.getComponent(UITransform)!.setContentSize(visible);
        const dim = this.checkpointPanel.getChildByName('CheckpointDim');
        dim?.getComponent(UITransform)?.setContentSize(visible);
        const graphics = dim?.getComponent(Graphics);
        if (graphics) {
            graphics.clear();
            graphics.fillColor = new Color(8, 12, 10, 178);
            graphics.rect(-visible.width * 0.5, -visible.height * 0.5, visible.width, visible.height);
            graphics.fill();
        }
    }

    setObjective(title: string, objective: string, speech?: string): void {
        this.objectiveTitle.string = title || '自由探索';
        this.objectiveText.string = objective || '主线已完成，可自由游览';
        if (speech) this.setSpeech(speech);
    }

    setSpeech(text: string, state: 'welcome' | 'pointing' | 'explain' | 'complete' = 'pointing'): void {
        this.speechLabel.string = text;
        this.resizeSpeechBubble(text);
        this.portraitLabel.string = ({
            welcome: '迎',
            pointing: '指',
            explain: '讲',
            complete: '成',
        })[state];
        this.loadPortrait(state);
    }

    private loadPortrait(state: 'welcome' | 'pointing' | 'explain' | 'complete'): void {
        const request = ++this.portraitRequest;
        resources.load(`ui/tour-guide/${state}/spriteFrame`, SpriteFrame, (error, frame) => {
            if (request !== this.portraitRequest || !this.root.isValid) return;
            if (error || !frame) {
                this.portraitSprite.spriteFrame = null;
                this.portraitLabel.node.active = true;
                return;
            }
            this.portraitSprite.spriteFrame = frame;
            this.portraitLabel.node.active = false;
        });
    }

    private resizeSpeechBubble(text: string): void {
        const length = Math.max(1, Array.from(text).length);
        const width = Math.max(210, Math.min(390, 150 + Math.min(length, 20) * 12));
        const charsPerLine = Math.max(8, Math.floor((width - 36) / 19));
        const lines = Math.max(1, Math.ceil(length / charsPerLine));
        const height = Math.max(72, Math.min(174, 38 + lines * 28));
        this.speechBubbleWidth = width;
        this.drawPanel(this.speechBubble, width, height, 18);
        this.placeSpeechBubble();
        this.speechLabel.node.getComponent(UITransform)!.setContentSize(width - 36, height - 20);
    }

    private placeSpeechBubble(): void {
        if (!this.speechBubble || !this.portraitNode) return;
        const portraitScreenX = this.speechGroup.position.x + this.portraitNode.position.x;
        const side = portraitScreenX >= 0 ? -1 : 1;
        const offset = 78 + 18 + this.speechBubbleWidth * 0.5;
        this.speechBubble.setPosition(
            this.portraitNode.position.x + side * offset,
            this.portraitNode.position.y + 8,
        );
    }

    private onPortraitTouchStart(event: EventTouch): void {
        event.propagationStopped = true;
        this.portraitDragDistance = 0;
        this.bubbleVisibleBeforeDrag = this.speechBubble.active;
    }

    private onPortraitTouchMove(event: EventTouch): void {
        event.propagationStopped = true;
        const delta = event.getUIDelta();
        this.portraitDragDistance += Math.sqrt(delta.x * delta.x + delta.y * delta.y);
        const position = this.portraitNode.position;
        this.portraitNode.setPosition(position.x + delta.x, position.y + delta.y, position.z);
        this.placeSpeechBubble();
        if (this.portraitDragDistance >= 6) this.speechBubble.active = false;
    }

    private onPortraitTouchEnd(event: EventTouch): void {
        event.propagationStopped = true;
        if (this.portraitDragDistance < 6) {
            this.speechBubble.active = !this.speechBubble.active;
        } else {
            this.speechBubble.active = this.bubbleVisibleBeforeDrag;
        }
        this.portraitDragDistance = 0;
    }

    showCheckpoint(
        title: string,
        text: string,
        onContinue: () => void,
        continueLabel = '继续游览',
        secondary?: { label: string; action: () => void },
    ): void {
        this.continueAction = onContinue;
        this.secondaryAction = secondary?.action ?? null;
        this.checkpointTitle.string = title;
        this.checkpointText.string = text;
        const continueText = this.checkpointContinueButton
            .getChildByName('ButtonLabel')?.getComponent(Label);
        if (continueText) continueText.string = continueLabel;
        this.checkpointSecondaryButton.active = Boolean(secondary);
        const secondaryText = this.checkpointSecondaryButton
            .getChildByName('ButtonLabel')?.getComponent(Label);
        if (secondaryText && secondary) secondaryText.string = secondary.label;
        this.checkpointContinueButton.setPosition(secondary ? -125 : 0, -102);
        this.checkpointPanel.active = true;
        this.checkpointPanel.setSiblingIndex(this.root.children.length - 1);
    }

    setContextAction(label: string, action: (() => void) | null): void {
        this.contextAction = action;
        // 实际触发统一交给右下角固定“交互”键；保留节点仅兼容旧布局。
        this.contextActionButton.active = false;
        const text = this.contextActionButton.getChildByName('ButtonLabel')?.getComponent(Label);
        if (text) text.string = label;
    }

    triggerContextAction(): boolean {
        if (!this.contextAction) return false;
        this.contextAction();
        return true;
    }

    hideCheckpoint(): void {
        this.continueAction = null;
        this.secondaryAction = null;
        this.checkpointPanel.active = false;
    }

    isCheckpointOpen(): boolean {
        return this.checkpointPanel.active;
    }

    private toggleMinimized(event?: EventTouch): void {
        if (event) event.propagationStopped = true;
        this.minimized = !this.minimized;
        this.speechGroup.active = !this.minimized;
        const label = this.minimizeButton.getChildByName('ButtonLabel')?.getComponent(Label);
        if (label) label.string = this.minimized ? '导' : '－';
    }

    private onContinue(event?: EventTouch): void {
        if (event) event.propagationStopped = true;
        const action = this.continueAction;
        this.hideCheckpoint();
        action?.();
    }

    private onSecondary(event?: EventTouch): void {
        if (event) event.propagationStopped = true;
        const action = this.secondaryAction;
        this.hideCheckpoint();
        action?.();
    }

    private onContextAction(event?: EventTouch): void {
        if (event) event.propagationStopped = true;
        this.contextAction?.();
    }

    private createNode(name: string, parent: Node): Node {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        parent.addChild(node);
        return node;
    }

    private createPanel(
        name: string,
        parent: Node,
        width: number,
        height: number,
        radius: number,
    ): Node {
        const node = this.createNode(name, parent);
        node.addComponent(UITransform);
        node.addComponent(Graphics);
        this.drawPanel(node, width, height, radius);
        return node;
    }

    private drawPanel(node: Node, width: number, height: number, radius: number): void {
        node.getComponent(UITransform)!.setContentSize(width, height);
        const graphics = node.getComponent(Graphics)!;
        graphics.clear();
        graphics.fillColor = INK;
        graphics.strokeColor = new Color(220, 187, 115, 220);
        graphics.lineWidth = 2;
        graphics.roundRect(-width * 0.5, -height * 0.5, width, height, radius);
        graphics.fill();
        graphics.stroke();
    }

    private createButton(name: string, text: string, parent: Node, width: number, height: number): Node {
        const node = this.createNode(name, parent);
        node.addComponent(UITransform).setContentSize(width, height);
        const graphics = node.addComponent(Graphics);
        graphics.fillColor = new Color(151, 70, 49, 250);
        graphics.strokeColor = GOLD;
        graphics.lineWidth = 2;
        graphics.roundRect(-width * 0.5, -height * 0.5, width, height, height * 0.5);
        graphics.fill();
        graphics.stroke();
        const label = this.createLabel(text, 21, CREAM, node, width - 20, height - 8);
        label.node.name = 'ButtonLabel';
        return node;
    }

    private createRoundButton(name: string, text: string, parent: Node, size: number): Node {
        const node = this.createNode(name, parent);
        node.addComponent(UITransform).setContentSize(size, size);
        const graphics = node.addComponent(Graphics);
        graphics.fillColor = new Color(43, 38, 30, 238);
        graphics.strokeColor = GOLD;
        graphics.lineWidth = 2;
        graphics.circle(0, 0, size * 0.5);
        graphics.fill();
        graphics.stroke();
        const label = this.createLabel(text, 19, CREAM, node, size, size);
        label.node.name = 'ButtonLabel';
        return node;
    }

    private createLabel(
        text: string,
        fontSize: number,
        color: Color,
        parent: Node,
        width: number,
        height: number,
    ): Label {
        const node = this.createNode('Label', parent);
        node.addComponent(UITransform).setContentSize(width, height);
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = fontSize;
        label.lineHeight = fontSize + 7;
        label.color = color;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.enableWrapText = true;
        label.overflow = Label.Overflow.SHRINK;
        return label;
    }
}
