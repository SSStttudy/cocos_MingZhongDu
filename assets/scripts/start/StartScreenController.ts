import {
    _decorator,
    BlockInputEvents,
    CCObject,
    Color,
    Component,
    director,
    EventTouch,
    Graphics,
    Label,
    Layers,
    Node,
    resources,
    Sprite,
    SpriteFrame,
    tween,
    UIOpacity,
    UITransform,
    Vec3,
    view,
} from 'cc';
import { EDITOR } from 'cc/env';
import { LocationTransitionState } from '../location/LocationTransitionState';
import { GameSettings, loadSettings, saveSettings } from './GameSettings';
import { TourProgressStore } from '../tour/TourProgressStore';
import { getLocationCocosSceneName } from '../tour/TourConfig';

const { ccclass, executeInEditMode, property } = _decorator;

const PAPER = new Color(225, 204, 153, 255);
const INK = new Color(45, 36, 25, 255);
const GOLD = new Color(218, 181, 104, 255);
const CREAM = new Color(255, 246, 218, 255);
const MUTED_CREAM = new Color(226, 214, 184, 255);

@ccclass('StartScreenController')
@executeInEditMode
export class StartScreenController extends Component {
    @property({ type: SpriteFrame, tooltip: '开始页主视觉。显式绑定后可在编辑器中稳定预览。' })
    startVisual: SpriteFrame | null = null;

    @property({ tooltip: 'resources 下的开始页主视觉路径，不包含 spriteFrame 后缀。' })
    visualResourcePath = 'start/start-visual/spriteFrame';

    @property({ tooltip: '标题组相对屏幕中心的纵向偏移。' })
    titleOffsetY = 152;

    @property({ tooltip: '主按钮组相对屏幕中心的纵向偏移。' })
    actionsOffsetY = -138;

    private screenRoot: Node | null = null;
    private background: Node | null = null;
    private backgroundSprite: Sprite | null = null;
    private backgroundFallback: Node | null = null;
    private titleGroup: Node | null = null;
    private mainActions: Node | null = null;
    private settingsPanel: Node | null = null;
    private restartPanel: Node | null = null;
    private startButton: Node | null = null;
    private restartButton: Node | null = null;
    private scrollTransition: Node | null = null;
    private scrollLeft: Node | null = null;
    private scrollRight: Node | null = null;
    private musicValue: Label | null = null;
    private soundValue: Label | null = null;
    private settings: GameSettings = loadSettings();
    private starting = false;
    private resumeExistingTour = false;
    private lastWidth = 0;
    private lastHeight = 0;

    onLoad(): void {
        this.buildScreen();
        if (this.startVisual) {
            this.backgroundSprite!.spriteFrame = this.startVisual;
        } else if (!EDITOR) {
            this.loadBackground();
        }
        this.layout(true);
    }

    update(): void {
        this.layout(false);
    }

    private buildScreen(): void {
        this.screenRoot?.destroy();
        this.screenRoot = new Node('StartScreen');
        this.screenRoot.layer = Layers.Enum.UI_2D;
        this.screenRoot.addComponent(UITransform);
        if (EDITOR) this.screenRoot.hideFlags = CCObject.Flags.DontSave;
        this.node.addChild(this.screenRoot);

        this.backgroundFallback = this.createNode('BackgroundFallback', this.screenRoot);
        this.backgroundFallback.addComponent(UITransform);
        this.backgroundFallback.addComponent(Graphics);

        this.background = this.createNode('Background', this.screenRoot);
        this.backgroundSprite = this.background.addComponent(Sprite);
        this.backgroundSprite.sizeMode = Sprite.SizeMode.CUSTOM;

        const shade = this.createNode('BackgroundShade', this.screenRoot);
        shade.addComponent(Graphics);

        this.titleGroup = this.createNode('TitleGroup', this.screenRoot);
        const eyebrow = this.createLabel('古今双时空 · 遗址探索', 18, GOLD, this.titleGroup);
        eyebrow.node.setPosition(0, 58);
        eyebrow.spacingX = 3;
        const title = this.createLabel('明中都遗址探索', 58, CREAM, this.titleGroup);
        title.isBold = true;
        title.enableOutline = true;
        title.outlineColor = new Color(36, 28, 20, 220);
        title.outlineWidth = 3;
        const subtitle = this.createLabel('循现实遗迹，重访大明中都', 20, MUTED_CREAM, this.titleGroup);
        subtitle.node.setPosition(0, -58);
        subtitle.spacingX = 2;

        this.mainActions = this.createNode('MainActions', this.screenRoot);
        const progress = TourProgressStore.load();
        this.resumeExistingTour = TourProgressStore.hasStarted();
        const startText = progress.completed
            ? '自由探索'
            : this.resumeExistingTour ? '继续游览' : '开始游览';
        this.startButton = this.createButton('StartButton', startText, 274, 58, true, this.mainActions);
        this.startButton.setPosition(0, 58);
        this.restartButton = this.createButton(
            'RestartTourButton',
            progress.completed ? '重新开始导览' : '重新开始',
            274,
            46,
            false,
            this.mainActions,
        );
        this.restartButton.setPosition(0, -5);
        this.restartButton.active = this.resumeExistingTour;
        const settingsButton = this.createButton('SettingsButton', '设置', 274, 50, false, this.mainActions);
        settingsButton.setPosition(0, this.resumeExistingTour ? -62 : -22);

        const version = this.createLabel('开发版本 0.2', 13, new Color(232, 223, 202, 190), this.screenRoot);
        version.node.name = 'VersionLabel';

        this.createSettingsPanel();
        this.createRestartPanel();
        this.createScrollTransition();

        if (!EDITOR) {
            this.startButton.on(Node.EventType.TOUCH_END, this.startGame, this);
            this.restartButton.on(Node.EventType.TOUCH_END, this.openRestartPanel, this);
            settingsButton.on(Node.EventType.TOUCH_END, this.openSettings, this);
        }
    }

    private createSettingsPanel(): void {
        this.settingsPanel = this.createNode('SettingsPanel', this.screenRoot!);
        this.settingsPanel.active = false;
        this.settingsPanel.addComponent(UITransform);
        this.settingsPanel.addComponent(BlockInputEvents);

        const dim = this.createNode('SettingsDim', this.settingsPanel);
        dim.addComponent(UITransform);
        dim.addComponent(Graphics);

        const card = this.createNode('SettingsCard', this.settingsPanel);
        card.addComponent(UITransform).setContentSize(470, 330);
        const cardGraphics = card.addComponent(Graphics);
        cardGraphics.fillColor = new Color(39, 43, 37, 248);
        cardGraphics.roundRect(-235, -165, 470, 330, 18);
        cardGraphics.fill();
        cardGraphics.strokeColor = new Color(210, 181, 117, 210);
        cardGraphics.lineWidth = 2;
        cardGraphics.roundRect(-235, -165, 470, 330, 18);
        cardGraphics.stroke();

        const heading = this.createLabel('设置', 34, CREAM, card);
        heading.node.setPosition(0, 112);
        const hint = this.createLabel('开关会保存在当前设备', 14, MUTED_CREAM, card);
        hint.node.setPosition(0, 76);

        const musicRow = this.createSettingRow('MusicRow', '音乐', 25, card);
        this.musicValue = musicRow.value;
        const soundRow = this.createSettingRow('SoundRow', '音效', -43, card);
        this.soundValue = soundRow.value;

        const close = this.createButton('CloseSettingsButton', '返回', 184, 46, false, card);
        close.setPosition(0, -116);
        this.refreshSettingsLabels();

        if (!EDITOR) {
            musicRow.node.on(Node.EventType.TOUCH_END, this.toggleMusic, this);
            soundRow.node.on(Node.EventType.TOUCH_END, this.toggleSound, this);
            close.on(Node.EventType.TOUCH_END, this.closeSettings, this);
            card.on(Node.EventType.TOUCH_END, this.stopTouch, this);
        }
    }

    private createRestartPanel(): void {
        this.restartPanel = this.createNode('RestartTourPanel', this.screenRoot!);
        this.restartPanel.active = false;
        this.restartPanel.addComponent(UITransform);
        this.restartPanel.addComponent(BlockInputEvents);

        const dim = this.createNode('RestartDim', this.restartPanel);
        dim.addComponent(UITransform);
        dim.addComponent(Graphics);
        const card = this.createNode('RestartCard', this.restartPanel);
        card.addComponent(UITransform).setContentSize(470, 260);
        const graphics = card.addComponent(Graphics);
        graphics.fillColor = new Color(39, 43, 37, 250);
        graphics.strokeColor = new Color(210, 181, 117, 220);
        graphics.lineWidth = 2;
        graphics.roundRect(-235, -130, 470, 260, 18);
        graphics.fill();
        graphics.stroke();

        const title = this.createLabel('重新开始导览？', 30, CREAM, card);
        title.node.setPosition(0, 73);
        const detail = this.createLabel('已保存的游览进度会被清除。', 17, MUTED_CREAM, card);
        detail.node.setPosition(0, 24);
        const confirm = this.createButton('ConfirmRestartButton', '确认重新开始', 190, 48, true, card);
        confirm.setPosition(-106, -70);
        const cancel = this.createButton('CancelRestartButton', '取消', 150, 48, false, card);
        cancel.setPosition(108, -70);
        if (!EDITOR) {
            confirm.on(Node.EventType.TOUCH_END, this.confirmRestart, this);
            cancel.on(Node.EventType.TOUCH_END, this.closeRestartPanel, this);
            card.on(Node.EventType.TOUCH_END, this.stopTouch, this);
        }
    }

    private createSettingRow(
        name: string,
        labelText: string,
        y: number,
        parent: Node,
    ): { node: Node; value: Label } {
        const row = this.createNode(name, parent);
        row.setPosition(0, y);
        row.addComponent(UITransform).setContentSize(350, 54);
        const graphics = row.addComponent(Graphics);
        graphics.fillColor = new Color(255, 255, 255, 18);
        graphics.roundRect(-175, -27, 350, 54, 10);
        graphics.fill();
        const label = this.createLabel(labelText, 21, CREAM, row);
        label.horizontalAlign = Label.HorizontalAlign.LEFT;
        label.node.setPosition(-105, 0);
        const value = this.createLabel('', 18, GOLD, row);
        value.node.setPosition(105, 0);
        return { node: row, value };
    }

    private createScrollTransition(): void {
        this.scrollTransition = this.createNode('ScrollTransition', this.screenRoot!);
        this.scrollTransition.active = false;
        this.scrollTransition.addComponent(UITransform);
        this.scrollTransition.addComponent(BlockInputEvents);
        this.scrollLeft = this.createScrollPanel('ScrollLeft', this.scrollTransition, true);
        this.scrollRight = this.createScrollPanel('ScrollRight', this.scrollTransition, false);
    }

    private createScrollPanel(name: string, parent: Node, left: boolean): Node {
        const panel = this.createNode(name, parent);
        panel.addComponent(UITransform);
        const graphics = panel.addComponent(Graphics);
        graphics.fillColor = PAPER;
        graphics.rect(-1, -1, 2, 2);
        graphics.fill();

        const innerBand = this.createNode(left ? 'LeftShaft' : 'RightShaft', panel);
        innerBand.addComponent(UITransform);
        const bandGraphics = innerBand.addComponent(Graphics);
        bandGraphics.fillColor = new Color(88, 52, 30, 255);
        bandGraphics.roundRect(-8, -1, 16, 2, 7);
        bandGraphics.fill();
        return panel;
    }

    private loadBackground(): void {
        resources.load(this.visualResourcePath, SpriteFrame, (error, spriteFrame) => {
            if (!this.backgroundSprite || !this.backgroundSprite.node.isValid) return;
            if (error) {
                console.warn('[StartScreen] 主视觉加载失败，开始游戏功能仍可正常使用。', error);
                this.drawBackgroundFallback();
                return;
            }
            this.startVisual = spriteFrame;
            this.backgroundSprite.spriteFrame = spriteFrame;
            this.layoutBackground();
        });
    }

    private drawBackgroundFallback(): void {
        if (!this.backgroundFallback) return;
        const fallback = this.backgroundFallback.getComponent(Graphics);
        if (!fallback) return;
        fallback.clear();
        fallback.fillColor = new Color(70, 66, 49, 255);
        fallback.rect(-this.lastWidth * 0.5, -this.lastHeight * 0.5, this.lastWidth, this.lastHeight);
        fallback.fill();
    }

    private createButton(
        name: string,
        text: string,
        width: number,
        height: number,
        primary: boolean,
        parent: Node,
    ): Node {
        const button = this.createNode(name, parent);
        button.addComponent(UITransform).setContentSize(width, height);
        const graphics = button.addComponent(Graphics);
        graphics.fillColor = primary ? new Color(153, 70, 48, 238) : new Color(31, 39, 34, 225);
        graphics.roundRect(-width * 0.5, -height * 0.5, width, height, height * 0.5);
        graphics.fill();
        graphics.strokeColor = primary ? new Color(239, 203, 128, 255) : new Color(214, 194, 150, 220);
        graphics.lineWidth = 2;
        graphics.roundRect(-width * 0.5, -height * 0.5, width, height, height * 0.5);
        graphics.stroke();
        const label = this.createLabel(text, primary ? 25 : 21, CREAM, button);
        label.isBold = primary;
        return button;
    }

    private createNode(name: string, parent: Node): Node {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        parent.addChild(node);
        return node;
    }

    private createLabel(text: string, size: number, color: Color, parent: Node): Label {
        const node = this.createNode(`${text}-Label`, parent);
        const transform = node.addComponent(UITransform);
        transform.setContentSize(620, size + 18);
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = size;
        label.lineHeight = size + 8;
        label.color = color;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.overflow = Label.Overflow.SHRINK;
        return label;
    }

    private layout(force: boolean): void {
        if (!this.screenRoot) return;
        const visible = view.getVisibleSize();
        if (!force && visible.width === this.lastWidth && visible.height === this.lastHeight) return;
        this.lastWidth = visible.width;
        this.lastHeight = visible.height;
        this.screenRoot.getComponent(UITransform)!.setContentSize(visible);
        this.backgroundFallback?.getComponent(UITransform)?.setContentSize(visible);
        this.scrollTransition?.getComponent(UITransform)?.setContentSize(visible);

        this.layoutBackground();
        if (!this.backgroundSprite?.spriteFrame) this.drawBackgroundFallback();
        this.layoutShade();
        this.titleGroup?.setPosition(0, Math.min(this.titleOffsetY, visible.height * 0.23));
        this.mainActions?.setPosition(0, Math.max(this.actionsOffsetY, -visible.height * 0.23));

        const version = this.screenRoot.getChildByName('VersionLabel');
        version?.setPosition(visible.width * 0.5 - 92, -visible.height * 0.5 + 28);

        if (this.settingsPanel) {
            this.settingsPanel.getComponent(UITransform)?.setContentSize(visible);
            const dim = this.settingsPanel.getChildByName('SettingsDim');
            dim?.getComponent(UITransform)?.setContentSize(visible);
            const graphics = dim?.getComponent(Graphics);
            if (graphics) {
                graphics.clear();
                graphics.fillColor = new Color(8, 12, 10, 190);
                graphics.rect(-visible.width * 0.5, -visible.height * 0.5, visible.width, visible.height);
                graphics.fill();
            }
        }

        if (this.restartPanel) {
            this.restartPanel.getComponent(UITransform)?.setContentSize(visible);
            const dim = this.restartPanel.getChildByName('RestartDim');
            dim?.getComponent(UITransform)?.setContentSize(visible);
            const graphics = dim?.getComponent(Graphics);
            if (graphics) {
                graphics.clear();
                graphics.fillColor = new Color(8, 12, 10, 190);
                graphics.rect(-visible.width * 0.5, -visible.height * 0.5, visible.width, visible.height);
                graphics.fill();
            }
        }

        this.layoutScrollPanels(false);
    }

    private layoutBackground(): void {
        if (!this.background || !this.backgroundSprite) return;
        const frame = this.backgroundSprite.spriteFrame;
        let width = this.lastWidth;
        let height = this.lastHeight;
        if (frame) {
            const size = frame.originalSize;
            const imageRatio = size.width / Math.max(1, size.height);
            const screenRatio = this.lastWidth / Math.max(1, this.lastHeight);
            if (imageRatio > screenRatio) width = height * imageRatio;
            else height = width / imageRatio;
        }
        this.background.getComponent(UITransform)?.setContentSize(width, height);
    }

    private layoutShade(): void {
        const shade = this.screenRoot?.getChildByName('BackgroundShade')?.getComponent(Graphics);
        if (!shade) return;
        shade.clear();
        shade.fillColor = new Color(15, 20, 17, 92);
        shade.rect(-this.lastWidth * 0.5, -this.lastHeight * 0.5, this.lastWidth, this.lastHeight);
        shade.fill();
        shade.fillColor = new Color(10, 15, 12, 82);
        shade.rect(-this.lastWidth * 0.5, -95, this.lastWidth, 300);
        shade.fill();
    }

    private layoutScrollPanels(resetPositions: boolean): void {
        if (!this.scrollLeft || !this.scrollRight) return;
        const halfWidth = this.lastWidth * 0.5 + 8;
        for (const panel of [this.scrollLeft, this.scrollRight]) {
            panel.getComponent(UITransform)?.setContentSize(halfWidth, this.lastHeight + 16);
            const graphics = panel.getComponent(Graphics)!;
            graphics.clear();
            graphics.fillColor = PAPER;
            graphics.rect(-halfWidth * 0.5, -(this.lastHeight + 16) * 0.5, halfWidth, this.lastHeight + 16);
            graphics.fill();
            graphics.strokeColor = new Color(120, 86, 48, 110);
            graphics.lineWidth = 2;
            for (let y = -this.lastHeight * 0.5 + 40; y < this.lastHeight * 0.5; y += 58) {
                graphics.moveTo(-halfWidth * 0.5 + 20, y);
                graphics.lineTo(halfWidth * 0.5 - 20, y + 8);
            }
            graphics.stroke();
        }

        const leftShaft = this.scrollLeft.getChildByName('LeftShaft');
        const rightShaft = this.scrollRight.getChildByName('RightShaft');
        for (const shaft of [leftShaft, rightShaft]) {
            shaft?.getComponent(UITransform)?.setContentSize(18, this.lastHeight + 28);
            const g = shaft?.getComponent(Graphics);
            if (g) {
                g.clear();
                g.fillColor = new Color(88, 52, 30, 255);
                g.roundRect(-9, -(this.lastHeight + 28) * 0.5, 18, this.lastHeight + 28, 8);
                g.fill();
            }
        }
        leftShaft?.setPosition(halfWidth * 0.5 - 6, 0);
        rightShaft?.setPosition(-halfWidth * 0.5 + 6, 0);

        if (resetPositions || !this.starting) {
            this.scrollLeft.setPosition(-this.lastWidth * 0.75 - 10, 0);
            this.scrollRight.setPosition(this.lastWidth * 0.75 + 10, 0);
        }
    }

    private startGame(event?: EventTouch): void {
        this.stopTouch(event);
        if (this.starting || EDITOR) return;
        this.starting = true;
        this.closeSettings();
        this.scrollTransition!.active = true;
        this.layoutScrollPanels(true);

        const leftTarget = new Vec3(-this.lastWidth * 0.25, 0, 0);
        const rightTarget = new Vec3(this.lastWidth * 0.25, 0, 0);
        tween(this.scrollLeft!).to(0.72, { position: leftTarget }, { easing: 'quadInOut' }).start();
        tween(this.scrollRight!)
            .to(0.72, { position: rightTarget }, { easing: 'quadInOut' })
            .call(() => this.enterOverworld())
            .start();

        this.scheduleOnce(() => this.enterOverworld(), 0.88);
    }

    private enterOverworld(): void {
        if (!this.starting) return;
        this.starting = false;
        LocationTransitionState.resetForNewGame();
        let sceneName = 'Overworld';
        if (this.resumeExistingTour) {
            const anchor = TourProgressStore.load().resumeAnchor;
            if (anchor.kind === 'location') {
                LocationTransitionState.enterLocation(anchor.locationId, anchor.sceneId, anchor.spawnId);
                sceneName = getLocationCocosSceneName(anchor.locationId);
            } else if (anchor.entryId) {
                LocationTransitionState.returnToOverworld(anchor.entryId);
            }
        } else {
            TourProgressStore.reset();
        }
        try {
            const accepted = director.loadScene(sceneName, (error) => {
                if (error && this.node.isValid) {
                    console.error(`[StartScreen] ${sceneName} 加载失败。`, error);
                    this.scrollTransition!.active = false;
                }
            });
            if (!accepted) {
                console.error(`[StartScreen] ${sceneName} 未加入当前构建场景。`);
                this.scrollTransition!.active = false;
            }
        } catch (error) {
            console.error(`[StartScreen] 无法进入 ${sceneName}。`, error);
            this.scrollTransition!.active = false;
        }
    }

    private openRestartPanel(event?: EventTouch): void {
        this.stopTouch(event);
        if (!this.restartPanel || this.starting) return;
        this.restartPanel.active = true;
        this.restartPanel.setSiblingIndex(this.screenRoot!.children.length - 1);
    }

    private closeRestartPanel(event?: EventTouch): void {
        this.stopTouch(event);
        if (this.restartPanel) this.restartPanel.active = false;
    }

    private confirmRestart(event?: EventTouch): void {
        this.stopTouch(event);
        TourProgressStore.reset();
        LocationTransitionState.resetForNewGame();
        this.resumeExistingTour = false;
        this.closeRestartPanel();
        this.restartButton!.active = false;
        this.setButtonText(this.startButton!, '开始游览');
        const settingsButton = this.mainActions?.getChildByName('SettingsButton');
        settingsButton?.setPosition(0, -22);
    }

    private setButtonText(button: Node, text: string): void {
        const label = button.children
            .map((child) => child.getComponent(Label))
            .find((item) => item);
        if (label) label.string = text;
    }

    private openSettings(event?: EventTouch): void {
        this.stopTouch(event);
        if (this.starting || !this.settingsPanel) return;
        this.settings = loadSettings();
        this.refreshSettingsLabels();
        this.settingsPanel.active = true;
        const opacity = this.settingsPanel.getComponent(UIOpacity) ?? this.settingsPanel.addComponent(UIOpacity);
        opacity.opacity = 0;
        tween(opacity).to(0.18, { opacity: 255 }).start();
    }

    private closeSettings(event?: EventTouch): void {
        this.stopTouch(event);
        if (this.settingsPanel) this.settingsPanel.active = false;
    }

    private toggleMusic(event?: EventTouch): void {
        this.stopTouch(event);
        this.settings.musicEnabled = !this.settings.musicEnabled;
        this.settings = saveSettings(this.settings);
        this.refreshSettingsLabels();
    }

    private toggleSound(event?: EventTouch): void {
        this.stopTouch(event);
        this.settings.soundEnabled = !this.settings.soundEnabled;
        this.settings = saveSettings(this.settings);
        this.refreshSettingsLabels();
    }

    private refreshSettingsLabels(): void {
        if (this.musicValue) this.musicValue.string = this.settings.musicEnabled ? '开启' : '关闭';
        if (this.soundValue) this.soundValue.string = this.settings.soundEnabled ? '开启' : '关闭';
    }

    private stopTouch(event?: EventTouch): void {
        if (event) event.propagationStopped = true;
    }
}
