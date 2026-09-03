import {
    _decorator,
    BlockInputEvents,
    Color,
    Component,
    EditBox,
    EventTouch,
    Graphics,
    Label,
    Layers,
    Node,
    Rect,
    sys,
    UITransform,
    view,
} from 'cc';
import {
    SurveyAnswerDraftV2,
    SurveyImprovementId,
    SurveyImpressionId,
    SurveyRating,
    SurveyResponseStore,
} from './SurveyResponseStore';

const { ccclass } = _decorator;

const CREAM = new Color(255, 246, 218, 255);
const PAPER = new Color(225, 204, 153, 255);
const PAPER_LIGHT = new Color(242, 226, 184, 255);
const INK = new Color(45, 36, 25, 255);
const INK_MUTED = new Color(92, 73, 47, 235);
const GOLD = new Color(218, 181, 104, 255);
const GOLD_LIGHT = new Color(239, 203, 128, 255);
const PALACE_RED = new Color(116, 43, 31, 255);
const VERMILION = new Color(151, 62, 43, 255);
const DEEP_RED = new Color(62, 25, 22, 255);

const PAGE_COUNT = 7;

type SafeAreaProvider = {
    getSafeAreaRect?: () => Rect;
};

type ChoiceOption<T extends string> = {
    value: T;
    label: string;
};

const IMPRESSION_OPTIONS: ReadonlyArray<ChoiceOption<SurveyImpressionId>> = [
    { value: 'map', label: '地图探索' },
    { value: 'knowledge-cards', label: '历史知识卡' },
    { value: 'site-scenes', label: '遗址场景' },
    { value: 'interaction', label: '互动探索' },
];

const KNOWLEDGE_CAPTIONS = ['完全不了解', '不太了解', '一般', '比较了解', '非常了解'];
const IMPROVEMENT_OPTIONS: ReadonlyArray<ChoiceOption<SurveyImprovementId>> = [
    { value: 'history-depth', label: '知识内容更加丰富' },
    { value: 'map-expansion', label: '地图和地点进一步拓展' },
    { value: 'movement-touch', label: '操作手感更加顺畅' },
    { value: 'scene-interaction', label: '场景与互动更加有趣' },
    { value: 'visual-readability', label: '界面展示更加清晰美观' },
    { value: 'performance', label: '加载和运行更加稳定' },
    { value: 'none', label: '暂无明显需要改进的地方' },
    { value: 'other', label: '其他' },
];

@ccclass('SurveyQuestionnaire')
export class SurveyQuestionnaire extends Component {
    private host: Node | null = null;
    private root: Node | null = null;
    private dim: Node | null = null;
    private card: Node | null = null;
    private content: Node | null = null;
    private errorLabel: Label | null = null;
    private progressLabel: Label | null = null;
    private previousButton: Node | null = null;
    private nextButton: Node | null = null;
    private answers: SurveyAnswerDraftV2 = {};
    private sessionId = '';
    private pageIndex = 0;
    private visible = false;
    private completion: 'submitted' | null = null;
    private cardWidth = 1000;
    private cardHeight = 600;
    private contentWidth = 920;
    private contentHeight = 400;
    private lastViewWidth = 0;
    private lastViewHeight = 0;

    initialize(parent: Node): void {
        this.host = parent;
        this.build();
    }

    get isOpen(): boolean {
        return this.visible;
    }

    open(event?: EventTouch): void {
        this.stopTouch(event);
        if (!this.root || this.visible) return;
        this.loadOrCreateDraft();
        this.pageIndex = 0;
        this.completion = null;
        this.visible = true;
        this.root.active = true;
        this.root.setSiblingIndex(this.host!.children.length - 1);
        const size = view.getVisibleSize();
        this.layout(size.width, size.height);
        this.renderPage();
    }

    close(event?: EventTouch): void {
        this.stopTouch(event);
        if (!this.root || !this.visible) return;
        if (!this.completion) this.persistDraft();
        this.visible = false;
        this.root.active = false;
    }

    layout(viewWidth: number, viewHeight: number): void {
        if (!this.root || !this.dim || !this.card || !this.content) return;
        this.lastViewWidth = viewWidth;
        this.lastViewHeight = viewHeight;
        const safe = this.getSafeArea(viewWidth, viewHeight);
        this.root.getComponent(UITransform)!.setContentSize(viewWidth, viewHeight);
        this.dim.getComponent(UITransform)!.setContentSize(viewWidth, viewHeight);
        const dimGraphics = this.dim.getComponent(Graphics)!;
        dimGraphics.clear();
        dimGraphics.fillColor = new Color(DEEP_RED.r, DEEP_RED.g, DEEP_RED.b, 238);
        dimGraphics.rect(-viewWidth * 0.5, -viewHeight * 0.5, viewWidth, viewHeight);
        dimGraphics.fill();

        const availableWidth = Math.max(1, safe.width - Math.min(32, safe.width * 0.06));
        const availableHeight = Math.max(1, safe.height - Math.min(24, safe.height * 0.06));
        // 短横屏缩放整张卡片，保证题目、选项和输入框不相互覆盖。
        const scale = Math.min(1, availableWidth / 640, availableHeight / 520);
        this.card.setScale(scale, scale, 1);
        this.cardWidth = Math.min(1080, availableWidth / scale);
        this.cardHeight = Math.min(610, availableHeight / scale);
        this.card.setPosition(safe.centerX, safe.centerY);
        this.card.getComponent(UITransform)!.setContentSize(this.cardWidth, this.cardHeight);
        this.drawCard();

        const title = this.card.getChildByName('SurveyTitle');
        const back = this.card.getChildByName('SurveyBackButton');
        title?.getComponent(UITransform)?.setContentSize(Math.max(120, this.cardWidth - 250), 48);
        title?.setPosition(-this.cardWidth * 0.5 + 34, this.cardHeight * 0.5 - 43);
        const backWidth = this.cardWidth < 700 ? 104 : 126;
        if (back) {
            this.drawButton(back, backWidth, 46, false);
            back.setPosition(this.cardWidth * 0.5 - 26 - backWidth * 0.5, this.cardHeight * 0.5 - 43);
        }

        const contentTop = this.cardHeight * 0.5 - 92;
        const contentBottom = -this.cardHeight * 0.5 + 112;
        this.contentWidth = Math.max(1, this.cardWidth - 64);
        this.contentHeight = Math.max(1, contentTop - contentBottom);
        this.content.setPosition(0, (contentTop + contentBottom) * 0.5);
        this.content.getComponent(UITransform)!.setContentSize(this.contentWidth, this.contentHeight);

        const footerY = -this.cardHeight * 0.5 + 40;
        const footerButtonWidth = this.cardWidth < 700 ? 106 : 132;
        if (this.previousButton) {
            this.drawButton(this.previousButton, footerButtonWidth, 48, false);
            this.previousButton.setPosition(-this.cardWidth * 0.5 + 28 + footerButtonWidth * 0.5, footerY);
        }
        if (this.nextButton) {
            this.drawButton(this.nextButton, footerButtonWidth, 48, true);
            this.nextButton.setPosition(this.cardWidth * 0.5 - 28 - footerButtonWidth * 0.5, footerY);
        }
        this.progressLabel?.node.setPosition(0, footerY);
        this.progressLabel?.node.getComponent(UITransform)?.setContentSize(180, 42);
        this.errorLabel?.node.setPosition(0, -this.cardHeight * 0.5 + 82);
        this.errorLabel?.node.getComponent(UITransform)?.setContentSize(Math.max(120, this.cardWidth - 300), 32);

        if (this.visible) this.renderPage();
    }

    onDestroy(): void {
        this.root = null;
        this.host = null;
    }

    private build(): void {
        if (!this.host) return;
        this.root?.destroy();
        this.root = this.makeNode('SurveyQuestionnaireRoot', this.host);
        this.root.addComponent(UITransform);
        this.root.addComponent(BlockInputEvents);

        this.dim = this.makeNode('SurveyQuestionnaireDim', this.root);
        this.dim.addComponent(UITransform);
        this.dim.addComponent(Graphics);

        this.card = this.makeNode('SurveyQuestionnaireCard', this.root);
        this.card.addComponent(UITransform);
        this.card.addComponent(Graphics);

        const title = this.makeLabel('问卷', 20, PALACE_RED, this.card, 700, 48);
        title.node.name = 'SurveyTitle';
        title.horizontalAlign = Label.HorizontalAlign.LEFT;
        title.isBold = true;
        title.node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);

        const back = this.createButton('SurveyBackButton', '返回设置', 126, 46, false, this.card);
        back.on(Node.EventType.TOUCH_END, this.close, this);

        this.content = this.makeNode('SurveyPageContent', this.card);
        this.content.addComponent(UITransform);

        this.errorLabel = this.makeLabel('', 14, VERMILION, this.card, 700, 32);
        this.errorLabel.node.name = 'SurveyError';
        this.errorLabel.overflow = Label.Overflow.SHRINK;

        this.previousButton = this.createButton('SurveyPreviousButton', '上一题', 132, 48, false, this.card);
        this.previousButton.on(Node.EventType.TOUCH_END, this.goPrevious, this);
        this.nextButton = this.createButton('SurveyNextButton', '下一步', 132, 48, true, this.card);
        this.nextButton.on(Node.EventType.TOUCH_END, this.goNext, this);
        this.progressLabel = this.makeLabel('', 15, INK_MUTED, this.card, 180, 42);

        this.root.active = false;
        const size = view.getVisibleSize();
        this.layout(size.width, size.height);
    }

    private loadOrCreateDraft(): void {
        let draft = SurveyResponseStore.loadDraft();
        if (!draft) {
            let result = SurveyResponseStore.startDraft();
            if ('reason' in result && result.reason === 'already-submitted') {
                result = SurveyResponseStore.startNextRespondent();
            }
            draft = result.draft ?? null;
        }
        this.sessionId = draft?.sessionId ?? '';
        this.answers = draft ? this.cloneDraftAnswers(draft.answers) : {};
    }

    private persistDraft(): void {
        if (!this.sessionId) return;
        const result = SurveyResponseStore.saveDraft(this.answers, this.sessionId);
        if (!result.ok && this.errorLabel) this.errorLabel.string = '答案暂时无法保存，请稍后重试。';
    }

    private goPrevious(event?: EventTouch): void {
        this.stopTouch(event);
        if (this.completion || this.pageIndex <= 0) return;
        this.persistDraft();
        this.pageIndex -= 1;
        this.renderPage();
    }

    private goNext(event?: EventTouch): void {
        this.stopTouch(event);
        if (this.completion) return;
        const error = this.validateCurrentPage();
        if (error) {
            if (this.errorLabel) this.errorLabel.string = error;
            return;
        }
        this.persistDraft();
        if (this.pageIndex < PAGE_COUNT - 1) {
            this.pageIndex += 1;
            this.renderPage();
            return;
        }
        const result = SurveyResponseStore.submit(this.answers, this.sessionId || undefined);
        if (!result.ok) {
            if (this.errorLabel) {
                this.errorLabel.string = ('errors' in result ? result.errors[0]?.message : undefined)
                    ?? '问卷未能保存，请稍后重试。';
            }
            return;
        }
        this.completion = 'submitted';
        this.sessionId = '';
        this.answers = {};
        this.renderPage();
    }

    private validateCurrentPage(): string | null {
        switch (this.pageIndex) {
            case 0: return this.answers.priorKnowledge ? null : '请选择体验前的了解程度。';
            case 1: return this.answers.deepestImpression ? null : '请选择印象最深的部分。';
            case 2: {
                const selected = this.answers.improvementPriorities ?? [];
                if (selected.length < 1 || selected.length > 2) return '请选择一至两项改进内容。';
                if (selected.indexOf('none') >= 0 && selected.length > 1) return '“暂无明显需要改进的地方”不能与其他选项同时选择。';
                return selected.indexOf('other') >= 0 && !this.answers.improvementOther?.trim()
                    ? '请填写“其他”改进内容。' : null;
            }
            case 3: return this.answers.postKnowledge ? null : '请选择体验后的了解程度。';
            case 4: return this.answers.furtherLearningInterest ? null : '请选择继续了解或参观的意愿。';
            case 5: return this.answers.overallSatisfaction ? null : '请选择总体满意度。';
            default: return null;
        }
    }

    private renderPage(): void {
        if (!this.content || !this.previousButton || !this.nextButton || !this.progressLabel) return;
        // destroy 延迟到帧末；先移除，避免同一帧重绘时新旧文字叠加。
        const oldChildren = [...this.content.children];
        this.content.removeAllChildren();
        oldChildren.forEach((child) => child.destroy());
        if (this.errorLabel) this.errorLabel.string = '';
        if (this.completion) {
            this.renderCompletion();
            return;
        }
        this.previousButton.active = this.pageIndex > 0;
        this.nextButton.active = true;
        this.progressLabel.node.active = true;
        this.progressLabel.string = `第 ${this.pageIndex + 1} / ${PAGE_COUNT} 题`;
        this.setButtonText(this.nextButton, this.pageIndex === PAGE_COUNT - 1 ? '提交问卷' : '下一题');

        switch (this.pageIndex) {
            case 0:
                this.renderRatingPage('1. 体验应用前，您对明中都的了解程度如何？', 'priorKnowledge', KNOWLEDGE_CAPTIONS);
                this.addHint('匿名、自愿填写，仅用于三下乡实践总结和应用优化。', -this.contentHeight * 0.5 + 18);
                break;
            case 1:
                this.addPageTitle('2. 应用中哪一部分给您留下的印象最深？');
                this.renderChoiceGrid(IMPRESSION_OPTIONS, 2, this.answers.deepestImpression,
                    (value) => this.answers.deepestImpression = value, 58);
                break;
            case 2: this.renderImprovementPage(); break;
            case 3:
                this.renderRatingPage('4. 体验应用后，您对明中都的了解程度如何？', 'postKnowledge', KNOWLEDGE_CAPTIONS);
                break;
            case 4:
                this.renderRatingPage('5. 体验后，我更愿意继续了解明中都或实地参观相关遗址。',
                    'furtherLearningInterest', ['完全不同意', '比较不同意', '一般', '比较同意', '完全同意']);
                break;
            case 5:
                this.renderRatingPage('6. 总体而言，您对这款应用的体验满意吗？',
                    'overallSatisfaction', ['很不满意', '不太满意', '一般', '比较满意', '很满意']);
                break;
            case 6: this.renderOpenPage(); break;
        }
    }

    private renderRatingPage(
        question: string,
        field: 'priorKnowledge' | 'postKnowledge' | 'furtherLearningInterest' | 'overallSatisfaction',
        captions: string[],
    ): void {
        this.addPageTitle(question);
        this.renderRatingButtons(this.answers[field], (value) => this.answers[field] = value, 0, captions);
    }

    private renderImprovementPage(): void {
        this.addPageTitle('3. 您认为应用最需要改进哪些方面？（最多选2项）');
        this.renderMultiChoiceGrid(IMPROVEMENT_OPTIONS, 3, this.answers.improvementPriorities ?? [], (value) => {
            const current = this.answers.improvementPriorities ?? [];
            if (value === 'none') {
                this.answers.improvementPriorities = current.indexOf('none') >= 0 ? [] : ['none'];
            } else {
                const selected = current.filter((item) => item !== 'none');
                if (selected.indexOf(value) >= 0) {
                    this.answers.improvementPriorities = selected.filter((item) => item !== value);
                } else if (selected.length < 2) {
                    this.answers.improvementPriorities = [...selected, value];
                } else {
                    if (this.errorLabel) this.errorLabel.string = '最多选择两项。';
                    return false;
                }
            }
            if ((this.answers.improvementPriorities?.indexOf('other') ?? -1) < 0) delete this.answers.improvementOther;
            return true;
        });
        if ((this.answers.improvementPriorities?.indexOf('other') ?? -1) >= 0) {
            this.createEditBox('SurveyImprovementOther', this.answers.improvementOther ?? '',
                '其他改进内容（最多120字）', 120, this.contentWidth, 48,
                this.contentHeight * 0.5 - 260, (text) => this.answers.improvementOther = text);
        }
    }

    private renderOpenPage(): void {
        this.addPageTitle('7. 您对这款应用还有什么建议？（选填）');
        this.createEditBox('SurveySuggestions', this.answers.suggestions ?? '',
            '请勿填写姓名或联系方式（最多300字）', 300, this.contentWidth,
            Math.min(180, this.contentHeight - 112), -12, (text) => this.answers.suggestions = text);
    }

    private renderCompletion(): void {
        if (!this.content || !this.previousButton || !this.nextButton || !this.progressLabel) return;
        this.previousButton.active = false;
        this.nextButton.active = false;
        this.progressLabel.node.active = false;
        const title = this.makeLabel('感谢填写', 34, PALACE_RED, this.content, this.contentWidth, 58);
        title.node.setPosition(0, 68);
        title.isBold = true;
        const detail = this.makeLabel(
            '您的匿名答卷已保存，并会自动同步到问卷后台；网络暂时不可用时将在下次打开时重试。',
            18,
            INK_MUTED,
            this.content,
            this.contentWidth,
            48,
        );
        detail.node.setPosition(0, 8);
        const done = this.createButton('SurveyDoneButton', '返回设置', 160, 50, false, this.content);
        done.setPosition(0, -70);
        done.on(Node.EventType.TOUCH_END, this.close, this);
    }

    private renderRatingButtons(
        selected: SurveyRating | undefined,
        onSelect: (value: SurveyRating) => void,
        y: number,
        captions: string[],
    ): void {
        const gap = 8;
        const width = Math.min(112, (this.contentWidth - gap * 4) / 5);
        const total = width * 5 + gap * 4;
        const startX = -total * 0.5 + width * 0.5;
        ([1, 2, 3, 4, 5] as SurveyRating[]).forEach((value, index) => {
            const button = this.createChoiceButton(
                `${value}\n${captions[index]}`,
                width,
                58,
                selected === value,
                () => {
                    onSelect(value);
                    this.renderPage();
                },
                14,
            );
            button.setPosition(startX + index * (width + gap), y);
            this.content!.addChild(button);
        });
    }

    private renderChoiceGrid<T extends string>(
        options: ReadonlyArray<ChoiceOption<T>>,
        columns: number,
        selected: T | undefined,
        onSelect: (value: T) => void,
        rowHeight = 54,
        topY = this.contentHeight * 0.5 - 94,
    ): void {
        const gapX = 10;
        const gapY = 8;
        const width = Math.min(760, (this.contentWidth - gapX * (columns - 1)) / columns);
        const gridWidth = width * columns + gapX * (columns - 1);
        const startX = -gridWidth * 0.5 + width * 0.5;
        options.forEach((option, index) => {
            const column = index % columns;
            const row = Math.floor(index / columns);
            const button = this.createChoiceButton(option.label, width, rowHeight, selected === option.value, () => {
                onSelect(option.value);
                this.renderPage();
            });
            button.setPosition(startX + column * (width + gapX), topY - row * (rowHeight + gapY));
            this.content!.addChild(button);
        });
    }

    private renderMultiChoiceGrid<T extends string>(
        options: ReadonlyArray<ChoiceOption<T>>,
        columns: number,
        selected: T[],
        onToggle: (value: T) => boolean | void,
    ): void {
        const gapX = 10;
        const gapY = 7;
        const rowHeight = 48;
        const width = (this.contentWidth - gapX * (columns - 1)) / columns;
        const startY = this.contentHeight * 0.5 - 92;
        const startX = -this.contentWidth * 0.5 + width * 0.5;
        options.forEach((option, index) => {
            const column = index % columns;
            const row = Math.floor(index / columns);
            const button = this.createChoiceButton(option.label, width, rowHeight, selected.indexOf(option.value) >= 0, () => {
                if (onToggle(option.value) !== false) this.renderPage();
            }, 15);
            button.setPosition(startX + column * (width + gapX), startY - row * (rowHeight + gapY));
            this.content!.addChild(button);
        });
    }

    private addPageTitle(text: string, y = this.contentHeight * 0.5 - 32): void {
        const label = this.makeLabel(text, 20, PALACE_RED, this.content!, this.contentWidth, 64);
        label.node.setPosition(0, y);
        label.horizontalAlign = Label.HorizontalAlign.LEFT;
        label.isBold = true;
        label.enableWrapText = true;
    }

    private addHint(text: string, y: number): void {
        const label = this.makeLabel(text, 13, INK_MUTED, this.content!, this.contentWidth, 28);
        label.node.setPosition(0, y);
        label.horizontalAlign = Label.HorizontalAlign.LEFT;
    }

    private createEditBox(
        name: string,
        value: string,
        placeholder: string,
        maxLength: number,
        width: number,
        height: number,
        y: number,
        onChange: (text: string) => void,
    ): EditBox {
        const node = this.makeNode(name, this.content!);
        node.setPosition(0, y);
        node.addComponent(UITransform).setContentSize(width, height);
        const graphics = node.addComponent(Graphics);
        graphics.fillColor = CREAM;
        graphics.strokeColor = GOLD;
        graphics.lineWidth = 2;
        graphics.roundRect(-width * 0.5, -height * 0.5, width, height, 5);
        graphics.fill();
        graphics.stroke();

        const textLabel = this.makeLabel('', 16, INK, node, width - 28, height - 16);
        textLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
        textLabel.verticalAlign = Label.VerticalAlign.TOP;
        textLabel.enableWrapText = true;
        textLabel.overflow = Label.Overflow.CLAMP;
        const placeholderLabel = this.makeLabel(placeholder, 15, new Color(92, 73, 47, 150), node, width - 28, height - 16);
        placeholderLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
        placeholderLabel.verticalAlign = Label.VerticalAlign.TOP;
        placeholderLabel.enableWrapText = true;
        placeholderLabel.overflow = Label.Overflow.CLAMP;

        const editBox = node.addComponent(EditBox);
        editBox.textLabel = textLabel;
        editBox.placeholderLabel = placeholderLabel;
        editBox.inputMode = EditBox.InputMode.ANY;
        editBox.inputFlag = EditBox.InputFlag.DEFAULT;
        editBox.returnType = EditBox.KeyboardReturnType.DONE;
        editBox.maxLength = maxLength;
        editBox.string = value;
        node.on(EditBox.EventType.TEXT_CHANGED, (component: EditBox) => {
            onChange(component.string);
        }, this);
        return editBox;
    }

    private createChoiceButton(
        text: string,
        width: number,
        height: number,
        selected: boolean,
        action: () => void,
        fontSize = 16,
    ): Node {
        const button = new Node('SurveyChoice');
        button.layer = Layers.Enum.UI_2D;
        button.addComponent(UITransform).setContentSize(width, height);
        const graphics = button.addComponent(Graphics);
        graphics.fillColor = selected ? PALACE_RED : PAPER_LIGHT;
        graphics.strokeColor = selected ? GOLD_LIGHT : GOLD;
        graphics.lineWidth = 2;
        graphics.roundRect(-width * 0.5, -height * 0.5, width, height, 5);
        graphics.fill();
        graphics.stroke();
        const label = this.makeLabel(text, fontSize, selected ? CREAM : INK, button, width - 18, height - 8);
        label.enableWrapText = true;
        label.overflow = Label.Overflow.SHRINK;
        button.on(Node.EventType.TOUCH_END, (event: EventTouch) => {
            this.stopTouch(event);
            action();
        }, this);
        return button;
    }

    private createButton(
        name: string,
        text: string,
        width: number,
        height: number,
        primary: boolean,
        parent: Node,
    ): Node {
        const button = this.makeNode(name, parent);
        button.addComponent(UITransform).setContentSize(width, height);
        button.addComponent(Graphics);
        this.makeLabel(text, 16, primary ? CREAM : PALACE_RED, button, width - 28, height - 8);
        this.drawButton(button, width, height, primary);
        return button;
    }

    private drawButton(button: Node, width: number, height: number, primary: boolean): void {
        button.getComponent(UITransform)?.setContentSize(width, height);
        const graphics = button.getComponent(Graphics)!;
        graphics.clear();
        graphics.fillColor = primary ? VERMILION : PAPER_LIGHT;
        graphics.strokeColor = primary ? GOLD_LIGHT : PALACE_RED;
        graphics.lineWidth = 2;
        graphics.roundRect(-width * 0.5, -height * 0.5, width, height, 6);
        graphics.fill();
        graphics.stroke();
        const label = button.children.map((child) => child.getComponent(Label)).find((item) => item);
        if (label) {
            label.color = primary ? CREAM : PALACE_RED;
            label.node.getComponent(UITransform)?.setContentSize(width - 28, height - 8);
        }
    }

    private setButtonText(button: Node, text: string): void {
        const label = button.children.map((child) => child.getComponent(Label)).find((item) => item);
        if (label) label.string = text;
    }

    private drawCard(): void {
        if (!this.card) return;
        const graphics = this.card.getComponent(Graphics)!;
        graphics.clear();
        graphics.fillColor = PAPER;
        graphics.strokeColor = GOLD;
        graphics.lineWidth = 3;
        graphics.roundRect(-this.cardWidth * 0.5, -this.cardHeight * 0.5, this.cardWidth, this.cardHeight, 12);
        graphics.fill();
        graphics.stroke();
        graphics.strokeColor = new Color(PALACE_RED.r, PALACE_RED.g, PALACE_RED.b, 140);
        graphics.lineWidth = 1;
        graphics.roundRect(
            -this.cardWidth * 0.5 + 8,
            -this.cardHeight * 0.5 + 8,
            this.cardWidth - 16,
            this.cardHeight - 16,
            7,
        );
        graphics.stroke();
        graphics.strokeColor = GOLD;
        graphics.lineWidth = 1.5;
        graphics.moveTo(-this.cardWidth * 0.5 + 28, this.cardHeight * 0.5 - 76);
        graphics.lineTo(this.cardWidth * 0.5 - 28, this.cardHeight * 0.5 - 76);
        graphics.stroke();
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
            console.warn('[SurveyQuestionnaire] 无法读取安全区域，已使用完整可视区域。', error);
        }
        return { centerX: 0, centerY: 0, width, height };
    }

    private cloneDraftAnswers(answers: SurveyAnswerDraftV2): SurveyAnswerDraftV2 {
        return {
            ...answers,
                improvementPriorities: answers.improvementPriorities ? [...answers.improvementPriorities] : undefined,
        };
    }

    private makeNode(name: string, parent: Node): Node {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        parent.addChild(node);
        return node;
    }

    private makeLabel(
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
        label.lineHeight = size + 6;
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
