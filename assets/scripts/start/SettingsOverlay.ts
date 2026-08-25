import {
    _decorator,
    BlockInputEvents,
    Color,
    Component,
    director,
    EventTouch,
    Graphics,
    Label,
    Layers,
    Node,
    Rect,
    sys,
    tween,
    Tween,
    UIOpacity,
    UITransform,
    view,
} from 'cc';
import { FragmentCollectionStore } from '../collection/FragmentCollectionStore';
import { LocationTransitionState } from '../location/LocationTransitionState';
import { TourProgressStore } from '../tour/TourProgressStore';
import {
    GameSettings,
    loadSettings,
    onSettingsChanged,
    resetSettings,
    saveSettings,
} from './GameSettings';
import { SurveyQuestionnaire } from './SurveyQuestionnaire';

const { ccclass } = _decorator;

const CREAM = new Color(255, 246, 218, 255);
const PAPER = new Color(225, 204, 153, 255);
const PAPER_LIGHT = new Color(242, 226, 184, 255);
const INK = new Color(45, 36, 25, 255);
const INK_MUTED = new Color(92, 73, 47, 225);
const GOLD = new Color(218, 181, 104, 255);
const GOLD_LIGHT = new Color(239, 203, 128, 255);
const SHAFT_BROWN = new Color(88, 52, 30, 255);
const PALACE_RED = new Color(116, 43, 31, 255);
const VERMILION = new Color(151, 62, 43, 255);
const DEEP_RED = new Color(62, 25, 22, 255);

type SettingsCategory = 'audio' | 'tour' | 'data' | 'survey' | 'about';

const SETTINGS_CATEGORY_ORDER: readonly SettingsCategory[] = [
    'audio',
    'tour',
    'data',
    'survey',
    'about',
];

type SettingsRowLayout = {
    row: Node;
    title: Label;
    detail: Label;
    action: Node;
    actionWidth: number;
    actionDanger?: boolean;
};

export type SettingsOverlayOptions = {
    onVisibilityChanged?: (visible: boolean) => void;
};

type SafeAreaProvider = {
    getSafeAreaRect?: () => Rect;
};

@ccclass('SettingsOverlay')
export class SettingsOverlay extends Component {
    private uiRoot: Node | null = null;
    private overlayRoot: Node | null = null;
    private dim: Node | null = null;
    private shell: Node | null = null;
    private nav: Node | null = null;
    private content: Node | null = null;
    private heading: Label | null = null;
    private ornament: Node | null = null;
    private confirmRoot: Node | null = null;
    private confirmCard: Node | null = null;
    private confirmAction: (() => void) | null = null;
    private surveyQuestionnaire: SurveyQuestionnaire | null = null;
    private categoryButtons = new Map<SettingsCategory, Node>();
    private categoryPanels = new Map<SettingsCategory, Node>();
    private toggleValues = new Map<keyof GameSettings, Label>();
    private rowLayouts: SettingsRowLayout[] = [];
    private selectedCategory: SettingsCategory = 'audio';
    private settings: GameSettings = loadSettings();
    private options: SettingsOverlayOptions = {};
    private unsubscribeSettings: (() => void) | null = null;
    private entryButtons: Array<{ node: Node; topOffset: number }> = [];
    private lastWidth = 0;
    private lastHeight = 0;
    private visible = false;
    private fadeTween: Tween<UIOpacity> | null = null;

    initialize(uiRoot: Node, options: SettingsOverlayOptions = {}): void {
        this.uiRoot = uiRoot;
        this.options = options;
        this.build();
        this.unsubscribeSettings?.();
        this.unsubscribeSettings = onSettingsChanged((settings) => {
            this.settings = { ...settings };
            this.refreshToggleValues();
        });
    }

    get isOpen(): boolean {
        return this.visible;
    }

    open(event?: EventTouch): void {
        this.stopTouch(event);
        if (!this.overlayRoot || this.visible) return;
        this.surveyQuestionnaire?.close();
        this.settings = loadSettings();
        this.refreshToggleValues();
        this.hideConfirmation();
        this.selectCategory('audio');
        this.visible = true;
        this.overlayRoot.active = true;
        this.overlayRoot.setSiblingIndex(this.uiRoot!.children.length - 1);
        this.layout(true);
        const opacity = this.overlayRoot.getComponent(UIOpacity)!;
        this.fadeTween?.stop();
        opacity.opacity = 0;
        this.fadeTween = tween(opacity)
            .to(0.16, { opacity: 255 })
            .call(() => this.fadeTween = null)
            .start();
        this.options.onVisibilityChanged?.(true);
    }

    close(event?: EventTouch): void {
        this.stopTouch(event);
        if (!this.overlayRoot || !this.visible || this.confirmRoot?.active) return;
        this.surveyQuestionnaire?.close();
        this.fadeTween?.stop();
        this.fadeTween = null;
        this.visible = false;
        this.overlayRoot.active = false;
        this.options.onVisibilityChanged?.(false);
    }

    update(): void {
        this.layout(false);
    }

    onDestroy(): void {
        this.unsubscribeSettings?.();
        this.unsubscribeSettings = null;
        this.fadeTween?.stop();
        this.fadeTween = null;
        if (this.visible) this.options.onVisibilityChanged?.(false);
        this.overlayRoot?.destroy();
        this.overlayRoot = null;
        this.surveyQuestionnaire = null;
    }

    createEntryButton(parent: Node, topOffset = 0): Node {
        const node = new Node('SettingsEntryButton');
        node.layer = Layers.Enum.UI_2D;
        node.addComponent(UITransform).setContentSize(56, 56);
        const graphics = node.addComponent(Graphics);
        this.drawSettingsGearButton(graphics);
        this.bindPressFeedback(node);
        node.on(Node.EventType.TOUCH_END, this.open, this);
        parent.addChild(node);
        this.entryButtons.push({ node, topOffset });
        this.layout(true);
        return node;
    }

    private drawSettingsGearButton(graphics: Graphics): void {
        const plaque = [
            [-18, 27], [18, 27], [27, 18], [27, -18],
            [18, -27], [-18, -27], [-27, -18], [-27, 18],
        ];
        graphics.fillColor = new Color(PALACE_RED.r, PALACE_RED.g, PALACE_RED.b, 242);
        graphics.strokeColor = GOLD_LIGHT;
        graphics.lineWidth = 2;
        plaque.forEach(([x, y], index) => {
            if (index === 0) graphics.moveTo(x, y);
            else graphics.lineTo(x, y);
        });
        graphics.close();
        graphics.fill();
        graphics.stroke();

        graphics.strokeColor = new Color(GOLD.r, GOLD.g, GOLD.b, 150);
        graphics.lineWidth = 1;
        graphics.roundRect(-21, -21, 42, 42, 6);
        graphics.stroke();

        const toothCount = 8;
        const toothStep = Math.PI * 2 / toothCount;
        const gearPoints: Array<[number, number]> = [];
        for (let index = 0; index < toothCount; index += 1) {
            const center = index * toothStep;
            for (const [offset, radius] of [
                [-0.42, 10.5],
                [-0.22, 15],
                [0.22, 15],
                [0.42, 10.5],
            ] as Array<[number, number]>) {
                const angle = center + toothStep * offset;
                gearPoints.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
            }
        }
        graphics.fillColor = GOLD_LIGHT;
        gearPoints.forEach(([x, y], index) => {
            if (index === 0) graphics.moveTo(x, y);
            else graphics.lineTo(x, y);
        });
        graphics.close();
        graphics.fill();
        graphics.fillColor = PALACE_RED;
        graphics.circle(0, 0, 4.5);
        graphics.fill();
        graphics.strokeColor = CREAM;
        graphics.lineWidth = 1;
        graphics.circle(0, 0, 4.5);
        graphics.stroke();
    }

    private build(): void {
        this.overlayRoot?.destroy();
        this.surveyQuestionnaire = null;
        if (!this.uiRoot) return;
        this.categoryButtons.clear();
        this.categoryPanels.clear();
        this.toggleValues.clear();
        this.rowLayouts.length = 0;

        this.overlayRoot = this.makeNode('SettingsOverlay', this.uiRoot);
        this.overlayRoot.addComponent(UITransform);
        this.overlayRoot.addComponent(BlockInputEvents);
        this.overlayRoot.addComponent(UIOpacity);
        this.overlayRoot.active = false;

        this.dim = this.makeNode('SettingsDim', this.overlayRoot);
        this.dim.addComponent(UITransform);
        this.dim.addComponent(Graphics);

        this.shell = this.makeNode('SettingsShell', this.overlayRoot);
        this.shell.addComponent(UITransform);
        this.shell.addComponent(Graphics);

        this.nav = this.makeNode('SettingsNavigation', this.shell);
        this.nav.addComponent(UITransform);
        this.nav.addComponent(Graphics);
        const title = SettingsOverlay.makeLabel('明中都', 28, GOLD_LIGHT, this.nav, 180, 48);
        title.node.name = 'SettingsTitle';
        title.spacingX = 3;
        title.isBold = true;
        title.overflow = Label.Overflow.SHRINK;
        const subtitle = SettingsOverlay.makeLabel('游览设置', 15, CREAM, this.nav, 170, 32);
        subtitle.node.name = 'SettingsSubtitle';
        subtitle.spacingX = 4;
        subtitle.overflow = Label.Overflow.SHRINK;

        this.createCategoryButton('audio', '声音');
        this.createCategoryButton('tour', '导览');
        this.createCategoryButton('data', '数据');
        this.createCategoryButton('survey', '问卷');
        this.createCategoryButton('about', '关于');

        this.content = this.makeNode('SettingsContent', this.shell);
        this.content.addComponent(UITransform);
        this.heading = SettingsOverlay.makeLabel('声音设置', 27, PALACE_RED, this.content, 420, 52);
        this.heading.node.name = 'SettingsSectionHeading';
        this.heading.horizontalAlign = Label.HorizontalAlign.LEFT;
        this.heading.isBold = true;
        this.heading.overflow = Label.Overflow.SHRINK;
        this.heading.node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);

        this.ornament = this.makeNode('SettingsHeaderOrnament', this.content);
        this.ornament.addComponent(UITransform);
        this.ornament.addComponent(Graphics);

        const back = this.createButton('SettingsBackButton', '返回', 126, 48, false, this.content);
        back.on(Node.EventType.TOUCH_END, this.close, this);

        this.createAudioPanel();
        this.createTourPanel();
        this.createDataPanel();
        this.createSurveyPanel();
        this.createAboutPanel();
        this.createConfirmation();
        this.surveyQuestionnaire = this.overlayRoot.addComponent(SurveyQuestionnaire);
        this.surveyQuestionnaire.initialize(this.overlayRoot);
        this.selectCategory('audio');
        this.refreshToggleValues();
    }

    private createAudioPanel(): void {
        const panel = this.createCategoryPanel('audio');
        this.createToggleRow(panel, '背景音乐', '控制导览及场景背景音乐', 'musicEnabled', 70);
        this.createToggleRow(panel, '游戏音效', '控制按钮、交互和提示音效', 'soundEnabled', -12);
        const note = SettingsOverlay.makeLabel('音频资源接入后，播放模块将自动读取这些设置。', 14, INK_MUTED, panel, 560, 38);
        note.node.name = 'SettingsAudioNote';
        note.node.setPosition(0, -76);
        note.horizontalAlign = Label.HorizontalAlign.LEFT;
    }

    private createTourPanel(): void {
        const panel = this.createCategoryPanel('tour');
        this.createToggleRow(panel, '导览提示', '显示目标卡、讲解气泡与路线提示', 'tourHintsEnabled', 70);
        this.createActionRow(
            panel,
            '重新开始导览',
            '清除当前导览步骤并回到第一站',
            '重新开始',
            -12,
            () => this.showConfirmation(
                '重新开始导览？',
                '当前导览步骤和讲解记录将被清除，碎片与设置不会改变。',
                () => {
                    TourProgressStore.reset();
                    LocationTransitionState.resetForNewGame();
                    this.returnToStart();
                },
            ),
        );
    }

    private createDataPanel(): void {
        const panel = this.createCategoryPanel('data');
        this.createActionRow(
            panel,
            '恢复默认设置',
            '恢复音乐、音效和导览提示开关',
            '恢复默认',
            70,
            () => {
                this.settings = resetSettings();
                this.refreshToggleValues();
            },
            false,
        );
        this.createActionRow(
            panel,
            '清除收集进度',
            '删除已收集的历史碎片与拼合成就',
            '清除',
            -12,
            () => this.showConfirmation(
                '清除收集进度？',
                '所有历史碎片与拼合成就将被删除，导览和设置不会改变。',
                () => {
                    FragmentCollectionStore.reset();
                    this.returnToStart();
                },
            ),
        );
    }

    private createAboutPanel(): void {
        const panel = this.createCategoryPanel('about');
        const name = SettingsOverlay.makeLabel('明中都遗址探索', 28, PALACE_RED, panel, 560, 50);
        name.node.name = 'SettingsAboutName';
        name.node.setPosition(0, 76);
        name.horizontalAlign = Label.HorizontalAlign.LEFT;
        const detail = SettingsOverlay.makeLabel(
            '开发版本 0.2\n\n循现实遗迹，重访大明中都。\n设置与进度保存在当前设备。',
            18,
            INK_MUTED,
            panel,
            560,
            150,
        );
        detail.node.name = 'SettingsAboutDetail';
        detail.node.setPosition(0, -16);
        detail.horizontalAlign = Label.HorizontalAlign.LEFT;
        detail.verticalAlign = Label.VerticalAlign.TOP;
        detail.overflow = Label.Overflow.SHRINK;
    }

    private createSurveyPanel(): void {
        const panel = this.createCategoryPanel('survey');
        this.createActionRow(
            panel,
            '文化传播体验调查',
            '共15题，约3—4分钟，重点了解文化传播效果',
            '开始填写',
            70,
            () => this.surveyQuestionnaire?.open(),
            false,
        );
        const note = SettingsOverlay.makeLabel(
            '匿名填写，不收集姓名或联系方式。答卷将保存在当前设备。',
            14,
            INK_MUTED,
            panel,
            560,
            46,
        );
        note.node.name = 'SettingsSurveyNote';
        note.node.setPosition(0, -30);
        note.horizontalAlign = Label.HorizontalAlign.LEFT;
        note.enableWrapText = true;
    }

    private createCategoryButton(category: SettingsCategory, text: string): void {
        if (!this.nav) return;
        const button = this.makeNode(`SettingsCategory-${category}`, this.nav);
        button.addComponent(UITransform).setContentSize(160, 50);
        button.addComponent(Graphics);
        SettingsOverlay.makeLabel(text, 19, CREAM, button, 130, 42);
        this.bindPressFeedback(button);
        button.on(Node.EventType.TOUCH_END, (event: EventTouch) => {
            this.stopTouch(event);
            this.selectCategory(category);
        });
        this.categoryButtons.set(category, button);
    }

    private createCategoryPanel(category: SettingsCategory): Node {
        const panel = this.makeNode(`SettingsPanel-${category}`, this.content!);
        panel.addComponent(UITransform);
        this.categoryPanels.set(category, panel);
        return panel;
    }

    private createToggleRow(
        panel: Node,
        title: string,
        detail: string,
        key: keyof GameSettings,
        y: number,
    ): void {
        const layout = this.createRow(panel, title, detail, y);
        const toggle = this.makeNode(`SettingsToggle-${key}`, layout.row);
        toggle.setPosition(240, 0);
        toggle.addComponent(UITransform).setContentSize(76, 48);
        toggle.addComponent(Graphics);
        const value = SettingsOverlay.makeLabel('', 16, CREAM, toggle, 68, 42);
        this.toggleValues.set(key, value);
        this.rowLayouts.push({ ...layout, action: toggle, actionWidth: 76 });
        this.bindPressFeedback(toggle);
        toggle.on(Node.EventType.TOUCH_END, (event: EventTouch) => {
            this.stopTouch(event);
            this.settings = saveSettings({ ...this.settings, [key]: !this.settings[key] });
            this.refreshToggleValues();
        });
    }

    private createActionRow(
        panel: Node,
        title: string,
        detail: string,
        buttonText: string,
        y: number,
        action: () => void,
        danger = true,
    ): void {
        const layout = this.createRow(panel, title, detail, y);
        const button = this.createButton(`${buttonText}Button`, buttonText, 126, 48, danger, layout.row);
        button.setPosition(210, 0);
        this.rowLayouts.push({ ...layout, action: button, actionWidth: 126, actionDanger: danger });
        button.on(Node.EventType.TOUCH_END, (event: EventTouch) => {
            this.stopTouch(event);
            action();
        });
    }

    private createRow(
        panel: Node,
        title: string,
        detail: string,
        y: number,
    ): Omit<SettingsRowLayout, 'action' | 'actionWidth'> {
        const row = this.makeNode(`${title}Row`, panel);
        row.setPosition(0, y);
        row.addComponent(UITransform).setContentSize(560, 72);
        row.addComponent(Graphics);
        this.drawSettingRow(row, 560, 72);
        const titleLabel = SettingsOverlay.makeLabel(title, 19, INK, row, 330, 30);
        titleLabel.node.setPosition(-102, 11);
        titleLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
        const detailLabel = SettingsOverlay.makeLabel(detail, 13, INK_MUTED, row, 360, 27);
        detailLabel.node.setPosition(-87, -14);
        detailLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
        return { row, title: titleLabel, detail: detailLabel };
    }

    private createConfirmation(): void {
        this.confirmRoot = this.makeNode('SettingsConfirmation', this.overlayRoot!);
        this.confirmRoot.addComponent(UITransform);
        this.confirmRoot.addComponent(BlockInputEvents);
        const dim = this.makeNode('ConfirmationDim', this.confirmRoot);
        dim.addComponent(UITransform);
        dim.addComponent(Graphics);
        this.confirmCard = this.makeNode('ConfirmationCard', this.confirmRoot);
        this.confirmCard.addComponent(UITransform).setContentSize(500, 250);
        this.confirmCard.addComponent(Graphics);
        const title = SettingsOverlay.makeLabel('', 28, PALACE_RED, this.confirmCard, 430, 48);
        title.node.name = 'ConfirmationTitle';
        title.node.setPosition(0, 72);
        const detail = SettingsOverlay.makeLabel('', 16, INK_MUTED, this.confirmCard, 420, 66);
        detail.node.name = 'ConfirmationDetail';
        detail.node.setPosition(0, 18);
        detail.overflow = Label.Overflow.SHRINK;
        detail.enableWrapText = true;
        const confirm = this.createButton('ConfirmDangerButton', '确认', 150, 48, true, this.confirmCard);
        confirm.setPosition(-92, -72);
        const cancel = this.createButton('CancelDangerButton', '取消', 150, 48, false, this.confirmCard);
        cancel.setPosition(92, -72);
        confirm.on(Node.EventType.TOUCH_END, this.confirmDangerAction, this);
        cancel.on(Node.EventType.TOUCH_END, this.hideConfirmation, this);
        this.confirmRoot.active = false;
    }

    private showConfirmation(title: string, detail: string, action: () => void): void {
        if (!this.confirmRoot || !this.confirmCard) return;
        const titleLabel = this.confirmCard.getChildByName('ConfirmationTitle')?.getComponent(Label);
        const detailLabel = this.confirmCard.getChildByName('ConfirmationDetail')?.getComponent(Label);
        if (titleLabel) titleLabel.string = title;
        if (detailLabel) detailLabel.string = detail;
        this.confirmAction = action;
        this.confirmRoot.active = true;
        this.confirmRoot.setSiblingIndex(this.overlayRoot!.children.length - 1);
        this.layoutConfirmation();
    }

    private hideConfirmation(event?: EventTouch): void {
        this.stopTouch(event);
        if (this.confirmRoot) this.confirmRoot.active = false;
        this.confirmAction = null;
    }

    private confirmDangerAction(event?: EventTouch): void {
        this.stopTouch(event);
        const action = this.confirmAction;
        this.hideConfirmation();
        action?.();
    }

    private returnToStart(): void {
        this.visible = false;
        if (this.overlayRoot) this.overlayRoot.active = false;
        this.options.onVisibilityChanged?.(false);
        const accepted = director.loadScene('Start', (error) => {
            if (error) console.error('[SettingsOverlay] 开始页加载失败。', error);
        });
        if (!accepted) console.error('[SettingsOverlay] Start 尚未加入当前构建场景。');
    }

    private selectCategory(category: SettingsCategory): void {
        this.selectedCategory = category;
        const titles: Record<SettingsCategory, string> = {
            audio: '声音设置',
            tour: '导览设置',
            data: '数据管理',
            survey: '问卷调查',
            about: '关于明中都',
        };
        if (this.heading) this.heading.string = titles[category];
        this.categoryPanels.forEach((panel, key) => panel.active = key === category);
        this.categoryButtons.forEach((button, key) => this.drawCategoryButton(button, key === category));
    }

    private drawCategoryButton(button: Node, selected: boolean): void {
        const graphics = button.getComponent(Graphics)!;
        graphics.clear();
        const size = button.getComponent(UITransform)!.contentSize;
        const label = button.children.map((child) => child.getComponent(Label)).find((item) => item);
        if (selected) {
            graphics.fillColor = GOLD_LIGHT;
            graphics.roundRect(-size.width * 0.5, -size.height * 0.5, size.width, size.height, 4);
            graphics.fill();
            graphics.fillColor = PALACE_RED;
            graphics.moveTo(-size.width * 0.5 + 8, 0);
            graphics.lineTo(-size.width * 0.5 + 15, 7);
            graphics.lineTo(-size.width * 0.5 + 22, 0);
            graphics.lineTo(-size.width * 0.5 + 15, -7);
            graphics.close();
            graphics.fill();
            if (label) label.color = PALACE_RED;
            return;
        }
        graphics.strokeColor = new Color(GOLD.r, GOLD.g, GOLD.b, 75);
        graphics.lineWidth = 1;
        graphics.moveTo(-size.width * 0.5 + 18, -size.height * 0.5);
        graphics.lineTo(size.width * 0.5 - 18, -size.height * 0.5);
        graphics.stroke();
        if (label) label.color = CREAM;
    }

    private refreshToggleValues(): void {
        this.toggleValues.forEach((label, key) => {
            const enabled = this.settings[key];
            label.string = enabled ? '开启' : '关闭';
            label.color = enabled ? CREAM : new Color(239, 224, 191, 230);
            const graphics = label.node.parent?.getComponent(Graphics);
            if (!graphics) return;
            graphics.clear();
            graphics.fillColor = enabled ? VERMILION : new Color(109, 91, 67, 255);
            graphics.roundRect(-34, -17, 68, 34, 17);
            graphics.fill();
        });
    }

    private layout(force: boolean): void {
        if (!this.overlayRoot || !this.shell || !this.nav || !this.content) return;
        const visibleSize = view.getVisibleSize();
        if (!force && visibleSize.width === this.lastWidth && visibleSize.height === this.lastHeight) return;
        this.lastWidth = visibleSize.width;
        this.lastHeight = visibleSize.height;
        const safe = this.getSafeArea(visibleSize.width, visibleSize.height);
        this.entryButtons.forEach(({ node, topOffset }) => {
            const size = node.getComponent(UITransform)?.contentSize;
            const width = size?.width ?? 56;
            const height = size?.height ?? 56;
            node.setPosition(
                safe.centerX + safe.width * 0.5 - 20 - width * 0.5,
                safe.centerY + safe.height * 0.5 - 20 - height * 0.5 - topOffset,
            );
        });
        this.overlayRoot.getComponent(UITransform)!.setContentSize(visibleSize);
        this.dim?.getComponent(UITransform)?.setContentSize(visibleSize);
        const dimGraphics = this.dim?.getComponent(Graphics);
        if (dimGraphics) {
            dimGraphics.clear();
            dimGraphics.fillColor = new Color(DEEP_RED.r, DEEP_RED.g, DEEP_RED.b, 225);
            dimGraphics.rect(-visibleSize.width * 0.5, -visibleSize.height * 0.5, visibleSize.width, visibleSize.height);
            dimGraphics.fill();
        }

        const shellWidth = Math.max(1, Math.min(1120, safe.width - Math.min(40, safe.width * 0.08)));
        const shellHeight = Math.max(1, Math.min(610, safe.height - Math.min(32, safe.height * 0.1)));
        const navWidth = shellWidth < 760
            ? Math.max(112, Math.min(150, shellWidth * 0.28))
            : 190;
        const contentWidth = shellWidth - navWidth;
        this.shell.setPosition(safe.centerX, safe.centerY);
        this.shell.getComponent(UITransform)!.setContentSize(shellWidth, shellHeight);
        const shellGraphics = this.shell.getComponent(Graphics)!;
        shellGraphics.clear();
        shellGraphics.fillColor = PAPER;
        shellGraphics.strokeColor = GOLD;
        shellGraphics.lineWidth = 3;
        shellGraphics.roundRect(-shellWidth * 0.5, -shellHeight * 0.5, shellWidth, shellHeight, 12);
        shellGraphics.fill();
        shellGraphics.stroke();
        shellGraphics.strokeColor = new Color(PALACE_RED.r, PALACE_RED.g, PALACE_RED.b, 135);
        shellGraphics.lineWidth = 1;
        shellGraphics.roundRect(
            -shellWidth * 0.5 + 8,
            -shellHeight * 0.5 + 8,
            shellWidth - 16,
            shellHeight - 16,
            7,
        );
        shellGraphics.stroke();
        shellGraphics.fillColor = GOLD;
        for (const x of [-shellWidth * 0.5 + 18, shellWidth * 0.5 - 18]) {
            for (const y of [-shellHeight * 0.5 + 18, shellHeight * 0.5 - 18]) {
                shellGraphics.moveTo(x - 5, y);
                shellGraphics.lineTo(x, y + 5);
                shellGraphics.lineTo(x + 5, y);
                shellGraphics.lineTo(x, y - 5);
                shellGraphics.close();
                shellGraphics.fill();
            }
        }

        this.nav.setPosition(-shellWidth * 0.5 + navWidth * 0.5, 0);
        this.nav.getComponent(UITransform)!.setContentSize(navWidth, shellHeight);
        const navGraphics = this.nav.getComponent(Graphics)!;
        navGraphics.clear();
        navGraphics.fillColor = PALACE_RED;
        navGraphics.roundRect(-navWidth * 0.5, -shellHeight * 0.5, navWidth, shellHeight, 12);
        navGraphics.fill();
        navGraphics.rect(0, -shellHeight * 0.5, navWidth * 0.5, shellHeight);
        navGraphics.fill();
        navGraphics.fillColor = SHAFT_BROWN;
        navGraphics.roundRect(-navWidth * 0.5 + 5, -shellHeight * 0.5 + 12, 9, shellHeight - 24, 4);
        navGraphics.fill();
        navGraphics.strokeColor = GOLD;
        navGraphics.lineWidth = 2;
        navGraphics.moveTo(navWidth * 0.5 - 1, -shellHeight * 0.5 + 14);
        navGraphics.lineTo(navWidth * 0.5 - 1, shellHeight * 0.5 - 14);
        navGraphics.stroke();
        const shortLayout = shellHeight < 500;
        const navLabelWidth = Math.max(72, navWidth - 34);
        const titleNode = this.nav.getChildByName('SettingsTitle');
        const subtitleNode = this.nav.getChildByName('SettingsSubtitle');
        titleNode?.getComponent(UITransform)?.setContentSize(navLabelWidth, 44);
        subtitleNode?.getComponent(UITransform)?.setContentSize(navLabelWidth, 30);
        const titleLabel = titleNode?.getComponent(Label);
        const subtitleLabel = subtitleNode?.getComponent(Label);
        if (titleLabel) titleLabel.fontSize = navWidth < 145 ? 23 : 28;
        if (subtitleLabel) subtitleLabel.fontSize = navWidth < 145 ? 13 : 15;
        titleNode?.setPosition(4, shellHeight * 0.5 - (shortLayout ? 38 : 50));
        subtitleNode?.setPosition(4, shellHeight * 0.5 - (shortLayout ? 68 : 84));
        const buttonStartY = shellHeight * 0.5 - (shortLayout ? 108 : 145);
        const buttonGap = shortLayout
            ? Math.max(42, Math.min(54, (shellHeight - 132) / (SETTINGS_CATEGORY_ORDER.length - 1)))
            : 62;
        SETTINGS_CATEGORY_ORDER.forEach((key, index) => {
            const button = this.categoryButtons.get(key);
            button?.setPosition(4, buttonStartY - index * buttonGap);
            button?.getComponent(UITransform)?.setContentSize(navWidth - 24, 50);
            if (button) {
                const label = button.children.map((child) => child.getComponent(Label)).find((item) => item);
                if (label) {
                    label.fontSize = navWidth < 145 ? 17 : 19;
                    label.node.getComponent(UITransform)?.setContentSize(Math.max(60, navWidth - 52), 42);
                }
                this.drawCategoryButton(button, key === this.selectedCategory);
            }
        });

        this.content.setPosition(navWidth * 0.5, 0);
        this.content.getComponent(UITransform)!.setContentSize(contentWidth, shellHeight);
        const contentPadding = contentWidth < 560 ? 18 : 38;
        const headerLeft = -contentWidth * 0.5 + contentPadding;
        const backButton = this.content.getChildByName('SettingsBackButton');
        const backWidth = contentWidth < 420 ? 104 : 126;
        if (backButton) this.drawButton(backButton, backWidth, 48, false);
        const backRight = contentWidth * 0.5 - contentPadding;
        const backLeft = backRight - backWidth;
        const headingWidth = Math.max(36, backLeft - 24 - headerLeft);
        this.heading?.node.getComponent(UITransform)?.setContentSize(headingWidth, 52);
        if (this.heading) this.heading.fontSize = headingWidth < 150 ? 22 : 27;
        const headerY = shellHeight * 0.5 - (shortLayout ? 43 : 55);
        this.heading?.node.setPosition(headerLeft, headerY);
        backButton?.setPosition(backRight - backWidth * 0.5, headerY);
        this.drawHeaderOrnament(contentWidth, shellHeight);

        const rowWidth = Math.max(1, Math.min(720, contentWidth - contentPadding * 2));
        const rowX = -contentWidth * 0.5 + contentPadding + rowWidth * 0.5;
        const firstRowY = shellHeight * 0.5 - (shortLayout ? 120 : 153);
        const rowGap = shortLayout ? 80 : 86;
        this.categoryPanels.forEach((panel) => {
            panel.setPosition(0, 0);
            panel.getComponent(UITransform)?.setContentSize(contentWidth, shellHeight - 112);
            const rows = this.rowLayouts.filter((layout) => layout.row.parent === panel);
            rows.forEach((row, index) => {
                row.row.setPosition(rowX, firstRowY - index * rowGap);
                this.layoutSettingRow(row, rowWidth, 72);
            });
        });
        const audioNote = this.categoryPanels.get('audio')?.getChildByName('SettingsAudioNote');
        const audioNoteHeight = shortLayout ? 30 : 38;
        const audioNoteGap = shortLayout ? 6 : 10;
        audioNote?.getComponent(UITransform)?.setContentSize(rowWidth, audioNoteHeight);
        audioNote?.setPosition(
            rowX,
            firstRowY - rowGap - 36 - audioNoteGap - audioNoteHeight * 0.5,
        );
        const surveyNote = this.categoryPanels.get('survey')?.getChildByName('SettingsSurveyNote');
        const surveyNoteHeight = shortLayout ? 38 : 46;
        surveyNote?.getComponent(UITransform)?.setContentSize(rowWidth, surveyNoteHeight);
        surveyNote?.setPosition(
            rowX,
            firstRowY - 36 - (shortLayout ? 14 : 20) - surveyNoteHeight * 0.5,
        );
        const aboutName = this.categoryPanels.get('about')?.getChildByName('SettingsAboutName');
        const aboutDetail = this.categoryPanels.get('about')?.getChildByName('SettingsAboutDetail');
        aboutName?.getComponent(UITransform)?.setContentSize(rowWidth, 50);
        aboutName?.setPosition(rowX, firstRowY + 4);
        const aboutDetailHeight = Math.max(
            72,
            Math.min(150, shellHeight - (shortLayout ? 165 : 198)),
        );
        aboutDetail?.getComponent(UITransform)?.setContentSize(rowWidth, aboutDetailHeight);
        aboutDetail?.setPosition(rowX, firstRowY - 31 - aboutDetailHeight * 0.5);
        this.layoutConfirmation();
        this.surveyQuestionnaire?.layout(visibleSize.width, visibleSize.height);
    }

    private drawHeaderOrnament(contentWidth: number, shellHeight: number): void {
        if (!this.ornament) return;
        const width = Math.max(80, contentWidth - 72);
        this.ornament.setPosition(0, shellHeight * 0.5 - (shellHeight < 500 ? 80 : 96));
        this.ornament.getComponent(UITransform)?.setContentSize(width, 20);
        const graphics = this.ornament.getComponent(Graphics)!;
        graphics.clear();
        graphics.strokeColor = new Color(GOLD.r, GOLD.g, GOLD.b, 175);
        graphics.lineWidth = 1.5;
        graphics.moveTo(-width * 0.5, 0);
        graphics.lineTo(width * 0.5, 0);
        graphics.stroke();
        graphics.fillColor = PALACE_RED;
        for (const x of [-width * 0.5 + 8, width * 0.5 - 8]) {
            graphics.moveTo(x - 6, 0);
            graphics.lineTo(x, 6);
            graphics.lineTo(x + 6, 0);
            graphics.lineTo(x, -6);
            graphics.close();
            graphics.fill();
        }
    }

    private layoutSettingRow(layout: SettingsRowLayout, width: number, height: number): void {
        layout.row.setScale(1, 1, 1);
        layout.row.getComponent(UITransform)?.setContentSize(width, height);
        this.drawSettingRow(layout.row, width, height);
        const horizontalPadding = width < 420 ? 18 : 26;
        const actionWidth = layout.actionDanger === undefined || width >= 300
            ? layout.actionWidth
            : Math.max(82, Math.min(layout.actionWidth, width * 0.38));
        if (layout.actionDanger !== undefined) {
            this.drawButton(layout.action, actionWidth, 48, layout.actionDanger);
        }
        const actionX = width * 0.5 - horizontalPadding - actionWidth * 0.5;
        const textWidth = Math.max(44, width - actionWidth - horizontalPadding * 2 - 30);
        const textX = -width * 0.5 + horizontalPadding + textWidth * 0.5;
        layout.title.node.getComponent(UITransform)?.setContentSize(textWidth, 30);
        layout.detail.node.getComponent(UITransform)?.setContentSize(textWidth, 26);
        layout.title.node.setPosition(textX, 12);
        layout.detail.node.setPosition(textX, -15);
        layout.action.setPosition(actionX, 0);
    }

    private drawSettingRow(row: Node, width: number, height: number): void {
        const graphics = row.getComponent(Graphics)!;
        graphics.clear();
        graphics.fillColor = PAPER_LIGHT;
        graphics.strokeColor = new Color(GOLD.r, GOLD.g, GOLD.b, 155);
        graphics.lineWidth = 1.5;
        graphics.roundRect(-width * 0.5, -height * 0.5, width, height, 4);
        graphics.fill();
        graphics.stroke();
        graphics.fillColor = PALACE_RED;
        graphics.roundRect(-width * 0.5, -height * 0.5, 7, height, 3);
        graphics.fill();
    }

    private layoutConfirmation(): void {
        if (!this.confirmRoot || !this.confirmCard || !this.overlayRoot) return;
        this.confirmRoot.getComponent(UITransform)?.setContentSize(this.lastWidth, this.lastHeight);
        const safe = this.getSafeArea(this.lastWidth, this.lastHeight);
        const dim = this.confirmRoot.getChildByName('ConfirmationDim');
        dim?.getComponent(UITransform)?.setContentSize(this.lastWidth, this.lastHeight);
        const graphics = dim?.getComponent(Graphics);
        if (graphics) {
            graphics.clear();
            graphics.fillColor = new Color(DEEP_RED.r, DEEP_RED.g, DEEP_RED.b, 195);
            graphics.rect(-this.lastWidth * 0.5, -this.lastHeight * 0.5, this.lastWidth, this.lastHeight);
            graphics.fill();
        }
        const cardWidth = Math.max(1, Math.min(500, safe.width - Math.min(40, safe.width * 0.08)));
        const cardHeight = Math.max(1, Math.min(250, safe.height - Math.min(32, safe.height * 0.08)));
        const halfWidth = cardWidth * 0.5;
        const halfHeight = cardHeight * 0.5;
        this.confirmCard.setPosition(safe.centerX, safe.centerY);
        this.confirmCard.getComponent(UITransform)?.setContentSize(cardWidth, cardHeight);
        const cardGraphics = this.confirmCard.getComponent(Graphics)!;
        cardGraphics.clear();
        cardGraphics.fillColor = PAPER_LIGHT;
        cardGraphics.strokeColor = GOLD;
        cardGraphics.lineWidth = 3;
        cardGraphics.roundRect(-halfWidth, -halfHeight, cardWidth, cardHeight, 12);
        cardGraphics.fill();
        cardGraphics.stroke();
        cardGraphics.strokeColor = new Color(PALACE_RED.r, PALACE_RED.g, PALACE_RED.b, 130);
        cardGraphics.lineWidth = 1;
        cardGraphics.roundRect(-halfWidth + 8, -halfHeight + 8, cardWidth - 16, cardHeight - 16, 7);
        cardGraphics.stroke();

        const compact = cardHeight < 235;
        const edgeOffset = Math.min(55, Math.max(42, cardHeight * 0.22));
        const title = this.confirmCard.getChildByName('ConfirmationTitle');
        const detail = this.confirmCard.getChildByName('ConfirmationDetail');
        title?.getComponent(UITransform)?.setContentSize(Math.max(1, cardWidth - 60), 44);
        detail?.getComponent(UITransform)?.setContentSize(Math.max(1, cardWidth - 70), compact ? 54 : 60);
        const titleLabel = title?.getComponent(Label);
        if (titleLabel) titleLabel.fontSize = cardWidth < 390 ? 23 : 28;
        title?.setPosition(0, halfHeight - edgeOffset);
        detail?.setPosition(0, compact ? 10 : 14);

        const confirm = this.confirmCard.getChildByName('ConfirmDangerButton');
        const cancel = this.confirmCard.getChildByName('CancelDangerButton');
        const actionWidth = Math.max(72, Math.min(150, (cardWidth - 54) * 0.5));
        const actionHeight = 48;
        if (confirm) this.drawButton(confirm, actionWidth, actionHeight, true);
        if (cancel) this.drawButton(cancel, actionWidth, actionHeight, false);
        const actionX = actionWidth * 0.5 + 10;
        confirm?.setPosition(-actionX, -halfHeight + edgeOffset);
        cancel?.setPosition(actionX, -halfHeight + edgeOffset);
    }

    private getSafeArea(width: number, height: number): {
        centerX: number;
        centerY: number;
        width: number;
        height: number;
    } {
        try {
            const rect = (sys as unknown as SafeAreaProvider).getSafeAreaRect?.();
            if (rect && rect.width > 0 && rect.height > 0) {
                return {
                    centerX: rect.x + rect.width * 0.5 - width * 0.5,
                    centerY: rect.y + rect.height * 0.5 - height * 0.5,
                    width: rect.width,
                    height: rect.height,
                };
            }
        } catch (error) {
            console.warn('[SettingsOverlay] 无法读取安全区域，已使用完整可视区域。', error);
        }
        return { centerX: 0, centerY: 0, width, height };
    }

    private createButton(
        name: string,
        text: string,
        width: number,
        height: number,
        danger: boolean,
        parent: Node,
    ): Node {
        const button = this.makeNode(name, parent);
        button.addComponent(UITransform).setContentSize(width, height);
        button.addComponent(Graphics);
        SettingsOverlay.makeLabel(text, 17, danger ? CREAM : PALACE_RED, button, width - 34, height - 8);
        this.drawButton(button, width, height, danger);
        this.bindPressFeedback(button);
        return button;
    }

    private drawButton(button: Node, width: number, height: number, danger: boolean): void {
        button.getComponent(UITransform)?.setContentSize(width, height);
        const graphics = button.getComponent(Graphics)!;
        graphics.clear();
        graphics.fillColor = danger ? VERMILION : PAPER_LIGHT;
        graphics.strokeColor = danger ? GOLD_LIGHT : PALACE_RED;
        graphics.lineWidth = 2;
        graphics.roundRect(-width * 0.5, -height * 0.5, width, height, 6);
        graphics.fill();
        graphics.stroke();
        graphics.fillColor = danger ? GOLD_LIGHT : PALACE_RED;
        if (width >= 110) {
            for (const x of [-width * 0.5 + 10, width * 0.5 - 10]) {
                graphics.moveTo(x - 3.5, 0);
                graphics.lineTo(x, 3.5);
                graphics.lineTo(x + 3.5, 0);
                graphics.lineTo(x, -3.5);
                graphics.close();
                graphics.fill();
            }
        }
        const label = button.children.map((child) => child.getComponent(Label)).find((item) => item);
        if (label) {
            label.color = danger ? CREAM : PALACE_RED;
            label.fontSize = width < 110 ? 15 : 17;
            label.node.getComponent(UITransform)?.setContentSize(Math.max(38, width - 34), height - 8);
        }
    }

    private bindPressFeedback(node: Node): void {
        const restore = (): void => node.setScale(1, 1, 1);
        node.on(Node.EventType.TOUCH_START, () => node.setScale(0.98, 0.98, 1), this);
        node.on(Node.EventType.TOUCH_END, restore, this);
        node.on(Node.EventType.TOUCH_CANCEL, restore, this);
    }

    private makeNode(name: string, parent: Node): Node {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        parent.addChild(node);
        return node;
    }

    private static makeLabel(
        text: string,
        size: number,
        color: Color,
        parent: Node,
        width: number,
        height: number,
    ): Label {
        const node = new Node(`${text || 'Value'}Label`);
        node.layer = Layers.Enum.UI_2D;
        node.addComponent(UITransform).setContentSize(width, height);
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = size;
        label.lineHeight = size + 7;
        label.color = color;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.overflow = Label.Overflow.SHRINK;
        parent.addChild(node);
        return label;
    }

    private stopTouch(event?: EventTouch): void {
        if (event) event.propagationStopped = true;
    }
}
