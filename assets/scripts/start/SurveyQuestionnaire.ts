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
    SurveyAgeGroup,
    SurveyAgreement,
    SurveyAnswerDraftV1,
    SurveyImprovementId,
    SurveyModuleId,
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

const PAGE_COUNT = 9;

type SafeAreaProvider = {
    getSafeAreaRect?: () => Rect;
};

type ChoiceOption<T extends string> = {
    value: T;
    label: string;
};

const MODULE_OPTIONS: ReadonlyArray<ChoiceOption<SurveyModuleId>> = [
    { value: 'start-map', label: '开始页与大地图移动' },
    { value: 'location-scenes', label: '地点照片场景与场景切换' },
    { value: 'tour-route', label: '导览目标或路线提示' },
    { value: 'knowledge-cards', label: '遗址历史知识卡' },
    { value: 'magnifier', label: '可拖动的细节放大镜' },
    { value: 'fragments-puzzle', label: '遗址碎片收集与沙盘拼合' },
    { value: 'settings', label: '设置界面' },
];

const AGE_OPTIONS: ReadonlyArray<ChoiceOption<SurveyAgeGroup>> = [
    { value: 'under-18', label: '18岁以下' },
    { value: '18-25', label: '18—25岁' },
    { value: '26-40', label: '26—40岁' },
    { value: '41-60', label: '41—60岁' },
    { value: '61-plus', label: '61岁及以上' },
    { value: 'prefer-not', label: '不愿透露' },
];

const IMPROVEMENT_OPTIONS: ReadonlyArray<ChoiceOption<SurveyImprovementId>> = [
    { value: 'history-clarity', label: '历史信息的清晰度' },
    { value: 'history-depth', label: '历史内容的丰富度' },
    { value: 'map-spatial-relations', label: '大地图与地点关系的呈现' },
    { value: 'tour-guidance', label: '导览路线与提示' },
    { value: 'movement-touch', label: '角色移动与触控操作' },
    { value: 'scene-navigation', label: '场景切换与返回' },
    { value: 'magnifier-fragments', label: '放大镜或碎片互动' },
    { value: 'visual-readability', label: '视觉风格与文字可读性' },
    { value: 'performance', label: '加载速度与运行稳定性' },
    { value: 'none', label: '暂无明显问题' },
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
    private answers: SurveyAnswerDraftV1 = {};
    private sessionId = '';
    private pageIndex = 0;
    private visible = false;
    private completion: 'submitted' | 'declined' | null = null;
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

        this.cardWidth = Math.max(1, Math.min(1080, safe.width - Math.min(32, safe.width * 0.06)));
        this.cardHeight = Math.max(1, Math.min(610, safe.height - Math.min(24, safe.height * 0.06)));
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

        const title = this.makeLabel('明中都 · 文化传播体验调查', 27, PALACE_RED, this.card, 700, 48);
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

        this.previousButton = this.createButton('SurveyPreviousButton', '上一步', 132, 48, false, this.card);
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
        if (this.answers.consent === 'declined') {
            SurveyResponseStore.declineParticipation();
            return;
        }
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
        if (this.pageIndex === 0 && this.answers.consent === 'declined') {
            SurveyResponseStore.declineParticipation();
            this.completion = 'declined';
            this.renderPage();
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
            case 0:
                return this.answers.consent ? null : '请选择是否自愿参加本次调查。';
            case 1:
                return this.answers.participationMode ? null : '请选择您刚才了解应用的方式。';
            case 2:
                return (this.answers.experiencedModules?.length ?? 0) > 0
                    ? null
                    : '请至少选择一项实际看到或体验的内容。';
            case 3:
                return this.answers.priorKnowledge ? null : '请选择体验前对明中都的了解程度。';
            case 4: {
                const needsKnowledge = (this.answers.experiencedModules?.indexOf('knowledge-cards') ?? -1) >= 0;
                if (needsKnowledge && this.answers.knowledgeCardClarity === undefined) {
                    return '请评价知识卡中的历史信息。';
                }
                if (this.answers.spatialRelationshipUnderstanding === undefined) {
                    return '请评价遗址空间关系的理解情况。';
                }
                return this.answers.historicalMeaningUnderstanding === undefined
                    ? '请评价现存遗迹历史意义的理解情况。'
                    : null;
            }
            case 5:
                if (this.answers.furtherLearningInterest === undefined) return '请评价进一步了解明中都的兴趣。';
                if (this.answers.digitalDisplaySuitability === undefined) return '请评价数字互动展示方式。';
                return this.answers.visualThemeCoherence === undefined
                    ? '请评价应用视觉风格。'
                    : null;
            case 6:
                if (this.answers.overallSatisfaction === undefined) return '请选择总体满意度。';
                return this.answers.recommendationWillingness === undefined
                    ? '请选择推荐意愿。'
                    : null;
            case 7: {
                const selected = this.answers.improvementPriorities ?? [];
                if (selected.length < 1 || selected.length > 3) return '请选择一至三项优先改进内容。';
                return selected.indexOf('none') >= 0 && selected.length > 1
                    ? '“暂无明显问题”不能与其他选项同时选择。'
                    : null;
            }
            case 8:
                return (this.answers.improvementPriorities?.indexOf('other') ?? -1) >= 0
                    && !this.answers.improvementOther?.trim()
                    ? '选择“其他”后，请填写具体改进内容。'
                    : null;
            default:
                return null;
        }
    }

    private renderPage(): void {
        if (!this.content || !this.previousButton || !this.nextButton || !this.progressLabel) return;
        [...this.content.children].forEach((child) => child.destroy());
        if (this.errorLabel) this.errorLabel.string = '';
        if (this.completion) {
            this.renderCompletion();
            return;
        }

        this.previousButton.active = this.pageIndex > 0;
        this.nextButton.active = true;
        this.progressLabel.node.active = true;
        this.progressLabel.string = `第 ${this.pageIndex + 1} / ${PAGE_COUNT} 页`;
        this.setButtonText(this.nextButton, this.pageIndex === PAGE_COUNT - 1 ? '提交问卷' : '下一步');

        switch (this.pageIndex) {
            case 0: this.renderConsentPage(); break;
            case 1: this.renderParticipationPage(); break;
            case 2: this.renderModulesPage(); break;
            case 3: this.renderBackgroundPage(); break;
            case 4: this.renderCulturePageOne(); break;
            case 5: this.renderCulturePageTwo(); break;
            case 6: this.renderOverallPage(); break;
            case 7: this.renderImprovementPage(); break;
            case 8: this.renderOpenPage(); break;
        }
    }

    private renderConsentPage(): void {
        this.addPageTitle('Q1　请确认您的参与情况');
        const options = [
            { value: 'adult-consent', label: '我已满18周岁，已阅读说明并自愿参加' },
            { value: 'minor-guardian-consent', label: '我未满18周岁，已取得监护人同意并自愿参加' },
            { value: 'declined', label: '我不同意参加，或尚未取得监护人同意' },
        ] as const;
        this.renderChoiceGrid(options, 1, this.answers.consent, (value) => {
            this.answers.consent = value;
        }, 64);
        this.addHint('匿名填写，不收集姓名、手机号、微信号或精确位置。', -this.contentHeight * 0.5 + 18);
    }

    private renderParticipationPage(): void {
        this.addPageTitle('Q2　您刚才主要通过哪种方式了解这款应用？');
        const options = [
            { value: 'self', label: '主要由我亲自操作' },
            { value: 'mixed', label: '我既亲自操作，也观看了工作人员演示' },
            { value: 'demo', label: '我仅观看工作人员演示，未亲自操作' },
        ] as const;
        this.renderChoiceGrid(options, 1, this.answers.participationMode, (value) => {
            this.answers.participationMode = value;
        }, 64);
    }

    private renderModulesPage(): void {
        this.addPageTitle('Q3　您刚才实际看到或亲自体验了哪些内容？（可多选）');
        const selected = this.answers.experiencedModules ?? [];
        this.renderMultiChoiceGrid(MODULE_OPTIONS, this.contentWidth >= 760 ? 3 : 2, selected, (value) => {
            const current = this.answers.experiencedModules ?? [];
            this.answers.experiencedModules = current.indexOf(value) >= 0
                ? current.filter((item) => item !== value)
                : [...current, value];
        });
    }

    private renderBackgroundPage(): void {
        this.addPageTitle('Q4　您的年龄段是？（选答）', this.contentHeight * 0.5 - 18);
        const ageTop = this.contentHeight * 0.5 - 62;
        this.renderChoiceGrid(AGE_OPTIONS, 3, this.answers.ageGroup, (value) => {
            this.answers.ageGroup = value;
        }, 52, ageTop);

        const q5Y = -38;
        const q5 = this.makeLabel('Q5　体验前，您对明中都的了解程度如何？', 18, INK, this.content!, this.contentWidth, 38);
        q5.node.setPosition(0, q5Y);
        q5.horizontalAlign = Label.HorizontalAlign.LEFT;
        q5.isBold = true;
        this.renderRatingButtons(
            this.answers.priorKnowledge,
            (value) => this.answers.priorKnowledge = value,
            q5Y - 64,
            ['完全不了解', '听说过', '了解一些', '比较了解', '非常了解'],
        );
    }

    private renderCulturePageOne(): void {
        this.addPageTitle('Q6—Q8　文化理解');
        const questions: Array<{ field: keyof SurveyAnswerDraftV1; text: string }> = [];
        if ((this.answers.experiencedModules?.indexOf('knowledge-cards') ?? -1) >= 0) {
            questions.push({ field: 'knowledgeCardClarity', text: 'Q6　知识卡中的历史信息容易理解' });
        } else {
            delete this.answers.knowledgeCardClarity;
        }
        questions.push(
            { field: 'spatialRelationshipUnderstanding', text: 'Q7　应用帮助我理解各处遗址在整体格局中的空间关系' },
            { field: 'historicalMeaningUnderstanding', text: 'Q8　应用中的介绍帮助我理解现存遗迹的历史意义' },
        );
        this.renderAgreementRows(questions);
    }

    private renderCulturePageTwo(): void {
        this.addPageTitle('Q9—Q11　文化传播效果');
        this.renderAgreementRows([
            { field: 'furtherLearningInterest', text: 'Q9　体验后，我更有兴趣进一步了解明中都' },
            { field: 'digitalDisplaySuitability', text: 'Q10　这种数字互动方式适合用于明中都遗址文化展示' },
            { field: 'visualThemeCoherence', text: 'Q11　应用整体视觉风格与明中都主题协调一致' },
        ]);
    }

    private renderOverallPage(): void {
        this.addPageTitle('Q12—Q13　总体效果');
        this.renderRatingRows([
            {
                field: 'overallSatisfaction',
                text: 'Q12　您对应用的体验或展示效果满意吗？',
                left: '非常不满意',
                right: '非常满意',
            },
            {
                field: 'recommendationWillingness',
                text: 'Q13　您向同行者推荐该应用的意愿如何？',
                left: '完全不愿意',
                right: '非常愿意',
            },
        ]);
    }

    private renderImprovementPage(): void {
        this.addPageTitle('Q14　您最希望优先改进哪些方面？（选择1—3项）');
        const selected = this.answers.improvementPriorities ?? [];
        this.renderMultiChoiceGrid(
            IMPROVEMENT_OPTIONS,
            this.contentWidth >= 820 ? 3 : 2,
            selected,
            (value) => {
                const current = this.answers.improvementPriorities ?? [];
                if (value === 'none') {
                    this.answers.improvementPriorities = current.indexOf('none') >= 0 ? [] : ['none'];
                    return;
                }
                const withoutNone = current.filter((item) => item !== 'none');
                if (withoutNone.indexOf(value) >= 0) {
                    this.answers.improvementPriorities = withoutNone.filter((item) => item !== value);
                } else if (withoutNone.length < 3) {
                    this.answers.improvementPriorities = [...withoutNone, value];
                } else if (this.errorLabel) {
                    this.errorLabel.string = '最多选择三项。';
                    return false;
                }
                return true;
            },
        );
    }

    private renderOpenPage(): void {
        const top = this.contentHeight * 0.5 - 18;
        let currentY = top;
        if ((this.answers.improvementPriorities?.indexOf('other') ?? -1) >= 0) {
            const other = this.makeLabel('Q14　请填写“其他”改进内容', 18, INK, this.content!, this.contentWidth, 34);
            other.node.setPosition(0, currentY);
            other.horizontalAlign = Label.HorizontalAlign.LEFT;
            other.isBold = true;
            currentY -= 58;
            this.createEditBox(
                'SurveyImprovementOther',
                this.answers.improvementOther ?? '',
                '请输入具体改进内容（最多120字）',
                120,
                this.contentWidth,
                54,
                currentY,
                (text) => this.answers.improvementOther = text,
            );
            currentY -= 70;
        } else {
            delete this.answers.improvementOther;
        }

        const q15 = this.makeLabel('Q15　哪项有关明中都的内容给您留下的印象最深？为什么？（选答）', 18, INK, this.content!, this.contentWidth, 48);
        q15.node.setPosition(0, currentY);
        q15.horizontalAlign = Label.HorizontalAlign.LEFT;
        q15.enableWrapText = true;
        q15.isBold = true;
        currentY -= 96;
        const availableHeight = Math.max(92, Math.min(180, currentY + this.contentHeight * 0.5 + 42));
        this.createEditBox(
            'SurveyMemorableContent',
            this.answers.memorableContent ?? '',
            '请勿填写姓名或联系方式（最多300字）',
            300,
            this.contentWidth,
            availableHeight,
            currentY - availableHeight * 0.5 + 24,
            (text) => this.answers.memorableContent = text,
        );
    }

    private renderCompletion(): void {
        if (!this.content || !this.previousButton || !this.nextButton || !this.progressLabel) return;
        this.previousButton.active = false;
        this.nextButton.active = false;
        this.progressLabel.node.active = false;
        const submitted = this.completion === 'submitted';
        const title = this.makeLabel(submitted ? '感谢填写' : '问卷已结束', 34, PALACE_RED, this.content, this.contentWidth, 58);
        title.node.setPosition(0, 68);
        title.isBold = true;
        const detail = this.makeLabel(
            submitted
                ? '您的匿名答卷已保存，并会自动同步到问卷后台；网络暂时不可用时将在下次打开时重试。'
                : '本次未提交任何答案。',
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

    private renderAgreementRows(
        questions: Array<{ field: keyof SurveyAnswerDraftV1; text: string }>,
    ): void {
        const gap = questions.length >= 3 ? 94 : 112;
        const startY = (questions.length - 1) * gap * 0.5 - 14;
        questions.forEach((question, index) => {
            this.renderScaleRow(
                question.text,
                this.answers[question.field] as SurveyAgreement | undefined,
                (value) => {
                    (this.answers as Record<string, unknown>)[question.field] = value;
                },
                startY - index * gap,
                true,
            );
        });
    }

    private renderRatingRows(
        questions: Array<{
            field: 'overallSatisfaction' | 'recommendationWillingness';
            text: string;
            left: string;
            right: string;
        }>,
    ): void {
        questions.forEach((question, index) => {
            const y = 74 - index * 154;
            this.renderScaleRow(
                question.text,
                this.answers[question.field],
                (value) => this.answers[question.field] = value as SurveyRating,
                y,
                false,
            );
            const left = this.makeLabel(question.left, 12, INK_MUTED, this.content!, 120, 24);
            const right = this.makeLabel(question.right, 12, INK_MUTED, this.content!, 120, 24);
            const scaleWidth = 5 * 48 + 4 * 6;
            const centerX = this.contentWidth * 0.5 - scaleWidth * 0.5 - 8;
            left.node.setPosition(centerX - scaleWidth * 0.5 + 42, y - 48);
            right.node.setPosition(centerX + scaleWidth * 0.5 - 42, y - 48);
        });
    }

    private renderScaleRow(
        text: string,
        selected: SurveyAgreement | undefined,
        onSelect: (value: SurveyAgreement) => void,
        y: number,
        allowNA: boolean,
    ): void {
        const naWidth = allowNA ? 72 : 0;
        const scaleWidth = 5 * 48 + 4 * 6 + (allowNA ? 10 + naWidth : 0);
        const labelWidth = Math.max(180, this.contentWidth - scaleWidth - 28);
        const label = this.makeLabel(text, 17, INK, this.content!, labelWidth, 62);
        label.node.setPosition(-this.contentWidth * 0.5 + labelWidth * 0.5, y);
        label.horizontalAlign = Label.HorizontalAlign.LEFT;
        label.enableWrapText = true;
        const startX = this.contentWidth * 0.5 - scaleWidth;
        ([1, 2, 3, 4, 5] as SurveyRating[]).forEach((value, index) => {
            const button = this.createChoiceButton(String(value), 48, 48, selected === value, () => {
                onSelect(value);
                this.renderPage();
            });
            button.setPosition(startX + 24 + index * 54, y);
            this.content!.addChild(button);
        });
        if (allowNA) {
            const button = this.createChoiceButton('不适用', naWidth, 48, selected === 'na', () => {
                onSelect('na');
                this.renderPage();
            });
            button.setPosition(startX + 5 * 54 + naWidth * 0.5 + 4, y);
            this.content!.addChild(button);
        }
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
        topY = this.contentHeight * 0.5 - 78,
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
        const rows = Math.ceil(options.length / columns);
        const gridHeight = rows * rowHeight + (rows - 1) * gapY;
        const startY = Math.min(this.contentHeight * 0.5 - 62, gridHeight * 0.5 - rowHeight * 0.5);
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

    private addPageTitle(text: string, y = this.contentHeight * 0.5 - 24): void {
        const label = this.makeLabel(text, 20, PALACE_RED, this.content!, this.contentWidth, 44);
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

    private cloneDraftAnswers(answers: SurveyAnswerDraftV1): SurveyAnswerDraftV1 {
        return {
            ...answers,
            experiencedModules: answers.experiencedModules ? [...answers.experiencedModules] : undefined,
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
