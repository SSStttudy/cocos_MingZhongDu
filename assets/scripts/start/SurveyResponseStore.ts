import { sys } from 'cc';

export const SURVEY_STORAGE_KEY = 'ming-zhongdu.survey.v1';
export const SURVEY_QUESTIONNAIRE_VERSION = '1.1' as const;

export type SurveyConsent = 'adult-consent' | 'minor-guardian-consent';
export type SurveyParticipationMode = 'self' | 'mixed' | 'demo';
export type SurveyModuleId =
    | 'start-map'
    | 'location-scenes'
    | 'tour-route'
    | 'knowledge-cards'
    | 'magnifier'
    | 'fragments-puzzle'
    | 'settings';
export type SurveyAgeGroup =
    | 'under-18'
    | '18-25'
    | '26-40'
    | '41-60'
    | '61-plus'
    | 'prefer-not';
export type SurveyRating = 1 | 2 | 3 | 4 | 5;
export type SurveyAgreement = SurveyRating | 'na';
export type SurveyImprovementId =
    | 'history-clarity'
    | 'history-depth'
    | 'map-spatial-relations'
    | 'tour-guidance'
    | 'movement-touch'
    | 'scene-navigation'
    | 'magnifier-fragments'
    | 'visual-readability'
    | 'performance'
    | 'none'
    | 'other';

export const SURVEY_CONSENT_OPTIONS: ReadonlyArray<SurveyConsent> = [
    'adult-consent',
    'minor-guardian-consent',
];
export const SURVEY_PARTICIPATION_MODES: ReadonlyArray<SurveyParticipationMode> = [
    'self',
    'mixed',
    'demo',
];
export const SURVEY_MODULE_IDS: ReadonlyArray<SurveyModuleId> = [
    'start-map',
    'location-scenes',
    'tour-route',
    'knowledge-cards',
    'magnifier',
    'fragments-puzzle',
    'settings',
];
export const SURVEY_AGE_GROUPS: ReadonlyArray<SurveyAgeGroup> = [
    'under-18',
    '18-25',
    '26-40',
    '41-60',
    '61-plus',
    'prefer-not',
];
export const SURVEY_IMPROVEMENT_IDS: ReadonlyArray<SurveyImprovementId> = [
    'history-clarity',
    'history-depth',
    'map-spatial-relations',
    'tour-guidance',
    'movement-touch',
    'scene-navigation',
    'magnifier-fragments',
    'visual-readability',
    'performance',
    'none',
    'other',
];

/** 完整提交的 15 题答案；字段只包含问卷本身，不包含任何设备或玩家资料。 */
export interface SurveyAnswersV1 {
    consent: SurveyConsent;
    participationMode: SurveyParticipationMode;
    experiencedModules: SurveyModuleId[];
    ageGroup?: SurveyAgeGroup;
    priorKnowledge: SurveyRating;
    knowledgeCardClarity?: SurveyAgreement;
    spatialRelationshipUnderstanding: SurveyAgreement;
    historicalMeaningUnderstanding: SurveyAgreement;
    furtherLearningInterest: SurveyAgreement;
    digitalDisplaySuitability: SurveyAgreement;
    visualThemeCoherence: SurveyAgreement;
    overallSatisfaction: SurveyRating;
    recommendationWillingness: SurveyRating;
    improvementPriorities: SurveyImprovementId[];
    improvementOther?: string;
    memorableContent?: string;
}

/** 填写中的答案允许缺项；declined 仅作为 UI 输入信号，绝不会被写入存储。 */
export interface SurveyAnswerDraftV1 {
    consent?: SurveyConsent | 'declined';
    participationMode?: SurveyParticipationMode;
    experiencedModules?: SurveyModuleId[];
    ageGroup?: SurveyAgeGroup;
    priorKnowledge?: SurveyRating;
    knowledgeCardClarity?: SurveyAgreement;
    spatialRelationshipUnderstanding?: SurveyAgreement;
    historicalMeaningUnderstanding?: SurveyAgreement;
    furtherLearningInterest?: SurveyAgreement;
    digitalDisplaySuitability?: SurveyAgreement;
    visualThemeCoherence?: SurveyAgreement;
    overallSatisfaction?: SurveyRating;
    recommendationWillingness?: SurveyRating;
    improvementPriorities?: SurveyImprovementId[];
    improvementOther?: string;
    memorableContent?: string;
}

export interface SurveyDraftV1 {
    version: 1;
    surveyVersion: '1.1';
    sessionId: string;
    answers: SurveyAnswerDraftV1;
    updatedAt: number;
}

export interface SurveySubmissionV1 {
    version: 1;
    surveyVersion: '1.1';
    responseId: string;
    sessionId: string;
    /** 仅保留本地日期用于现场批次核对，不记录精确时间。 */
    submittedDate: string;
    answers: SurveyAnswersV1;
}

export interface SurveyStoreStateV1 {
    version: 1;
    activeDraft: SurveyDraftV1 | null;
    submissions: SurveySubmissionV1[];
}

export interface SurveyValidationError {
    field: string;
    code: string;
    message: string;
}

export type SurveyValidationResult =
    | { valid: true; answers: SurveyAnswersV1; errors: [] }
    | { valid: false; errors: SurveyValidationError[] };

export type SurveyDraftFailureReason =
    | 'already-submitted'
    | 'session-mismatch'
    | 'storage-failed';

export type SurveyDraftMutationResult =
    | { ok: true; draft: SurveyDraftV1 | null }
    | { ok: false; reason: SurveyDraftFailureReason; draft?: SurveyDraftV1 };

export type SurveySubmitFailureReason =
    | 'declined'
    | 'draft-missing'
    | 'session-mismatch'
    | 'validation-failed'
    | 'storage-failed';

export type SurveySubmitResult =
    | { ok: true; submission: SurveySubmissionV1; duplicate: boolean }
    | {
        ok: false;
        reason: SurveySubmitFailureReason;
        errors: SurveyValidationError[];
        draft?: SurveyDraftV1;
    };

type WxStorage = {
    getStorageSync?: (key: string) => unknown;
    setStorageSync?: (key: string, value: string) => void;
};

const MAX_IMPROVEMENT_OTHER_LENGTH = 120;
const MAX_MEMORABLE_CONTENT_LENGTH = 300;

function getWxStorage(): WxStorage | null {
    return (globalThis as unknown as { wx?: WxStorage }).wx ?? null;
}

function readStorage(): string | null {
    const wx = getWxStorage();
    if (typeof wx?.getStorageSync === 'function') {
        const value = wx.getStorageSync(SURVEY_STORAGE_KEY);
        return typeof value === 'string' && value.length > 0 ? value : null;
    }
    return sys.localStorage.getItem(SURVEY_STORAGE_KEY);
}

function writeStorage(state: SurveyStoreStateV1): void {
    const value = JSON.stringify(state);
    const wx = getWxStorage();
    if (typeof wx?.setStorageSync === 'function') {
        wx.setStorageSync(SURVEY_STORAGE_KEY, value);
        return;
    }
    if (!sys.localStorage || typeof sys.localStorage.setItem !== 'function') {
        throw new Error('当前环境不支持本地存储。');
    }
    sys.localStorage.setItem(SURVEY_STORAGE_KEY, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function optionValue<T extends string>(value: unknown, options: ReadonlyArray<T>): T | undefined {
    if (typeof value !== 'string') return undefined;
    return (options as ReadonlyArray<string>).indexOf(value) >= 0 ? value as T : undefined;
}

function normalizeOptionArray<T extends string>(value: unknown, options: ReadonlyArray<T>): T[] {
    if (!Array.isArray(value)) return [];
    const normalized: T[] = [];
    value.forEach((item) => {
        const option = optionValue(item, options);
        if (option !== undefined && normalized.indexOf(option) < 0) normalized.push(option);
    });
    return normalized;
}

function hasOnlyOptions<T extends string>(value: unknown, options: ReadonlyArray<T>): boolean {
    return Array.isArray(value) && value.every((item) => optionValue(item, options) !== undefined);
}

function ratingValue(value: unknown): SurveyRating | undefined {
    return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5
        ? value as SurveyRating
        : undefined;
}

function agreementValue(value: unknown): SurveyAgreement | undefined {
    return value === 'na' ? 'na' : ratingValue(value);
}

function normalizedText(value: unknown, maximumLength: number): string | undefined {
    if (typeof value !== 'string') return undefined;
    const text = value.trim();
    return text.length > 0 ? text.slice(0, maximumLength) : undefined;
}

function normalizeDraftAnswers(value: unknown): SurveyAnswerDraftV1 {
    if (!isRecord(value)) return {};
    const answers: SurveyAnswerDraftV1 = {};
    const consent = optionValue(value.consent, SURVEY_CONSENT_OPTIONS);
    const participationMode = optionValue(value.participationMode, SURVEY_PARTICIPATION_MODES);
    const ageGroup = optionValue(value.ageGroup, SURVEY_AGE_GROUPS);
    const priorKnowledge = ratingValue(value.priorKnowledge);
    const spatialRelationshipUnderstanding = agreementValue(value.spatialRelationshipUnderstanding);
    const historicalMeaningUnderstanding = agreementValue(value.historicalMeaningUnderstanding);
    const furtherLearningInterest = agreementValue(value.furtherLearningInterest);
    const digitalDisplaySuitability = agreementValue(value.digitalDisplaySuitability);
    const visualThemeCoherence = agreementValue(value.visualThemeCoherence);
    const overallSatisfaction = ratingValue(value.overallSatisfaction);
    const recommendationWillingness = ratingValue(value.recommendationWillingness);

    if (consent !== undefined) answers.consent = consent;
    if (participationMode !== undefined) answers.participationMode = participationMode;
    if (Array.isArray(value.experiencedModules)) {
        answers.experiencedModules = normalizeOptionArray(value.experiencedModules, SURVEY_MODULE_IDS);
    }
    if (ageGroup !== undefined) answers.ageGroup = ageGroup;
    if (priorKnowledge !== undefined) answers.priorKnowledge = priorKnowledge;
    if (answers.experiencedModules?.indexOf('knowledge-cards') !== -1) {
        const knowledgeCardClarity = agreementValue(value.knowledgeCardClarity);
        if (knowledgeCardClarity !== undefined) answers.knowledgeCardClarity = knowledgeCardClarity;
    }
    if (spatialRelationshipUnderstanding !== undefined) {
        answers.spatialRelationshipUnderstanding = spatialRelationshipUnderstanding;
    }
    if (historicalMeaningUnderstanding !== undefined) {
        answers.historicalMeaningUnderstanding = historicalMeaningUnderstanding;
    }
    if (furtherLearningInterest !== undefined) answers.furtherLearningInterest = furtherLearningInterest;
    if (digitalDisplaySuitability !== undefined) answers.digitalDisplaySuitability = digitalDisplaySuitability;
    if (visualThemeCoherence !== undefined) answers.visualThemeCoherence = visualThemeCoherence;
    if (overallSatisfaction !== undefined) answers.overallSatisfaction = overallSatisfaction;
    if (recommendationWillingness !== undefined) answers.recommendationWillingness = recommendationWillingness;

    if (Array.isArray(value.improvementPriorities)) {
        answers.improvementPriorities = normalizeOptionArray(
            value.improvementPriorities,
            SURVEY_IMPROVEMENT_IDS,
        );
    }
    if (answers.improvementPriorities?.indexOf('other') !== -1) {
        const improvementOther = normalizedText(value.improvementOther, MAX_IMPROVEMENT_OTHER_LENGTH);
        if (improvementOther !== undefined) answers.improvementOther = improvementOther;
    }
    const memorableContent = normalizedText(value.memorableContent, MAX_MEMORABLE_CONTENT_LENGTH);
    if (memorableContent !== undefined) answers.memorableContent = memorableContent;
    return answers;
}

function cloneAnswers<T extends SurveyAnswerDraftV1 | SurveyAnswersV1>(answers: T): T {
    return {
        ...answers,
        experiencedModules: answers.experiencedModules ? [...answers.experiencedModules] : undefined,
        improvementPriorities: answers.improvementPriorities ? [...answers.improvementPriorities] : undefined,
    } as T;
}

function cloneDraft(draft: SurveyDraftV1): SurveyDraftV1 {
    return { ...draft, answers: cloneAnswers(draft.answers) };
}

function cloneSubmission(submission: SurveySubmissionV1): SurveySubmissionV1 {
    return { ...submission, answers: cloneAnswers(submission.answers) };
}

function cloneState(state: SurveyStoreStateV1): SurveyStoreStateV1 {
    return {
        version: 1,
        activeDraft: state.activeDraft ? cloneDraft(state.activeDraft) : null,
        submissions: state.submissions.map(cloneSubmission),
    };
}

function emptyState(): SurveyStoreStateV1 {
    return { version: 1, activeDraft: null, submissions: [] };
}

function createId(prefix: 'session' | 'response'): string {
    const randomPart = (): string => (`0000000${Math.floor(Math.random() * 0x100000000).toString(36)}`)
        .slice(-7);
    return `${prefix}-${Date.now().toString(36)}-${randomPart()}${randomPart()}`;
}

function localDateString(date = new Date()): string {
    const pad = (value: number): string => (`0${value}`).slice(-2);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function makeDraft(): SurveyDraftV1 {
    return {
        version: 1,
        surveyVersion: SURVEY_QUESTIONNAIRE_VERSION,
        sessionId: createId('session'),
        answers: {},
        updatedAt: Date.now(),
    };
}

function validationError(field: string, code: string, message: string): SurveyValidationError {
    return { field, code, message };
}

function validateAnswers(value: unknown): SurveyValidationResult {
    if (!isRecord(value)) {
        return {
            valid: false,
            errors: [validationError('answers', 'invalid-object', '问卷答案格式无效。')],
        };
    }

    const errors: SurveyValidationError[] = [];
    const normalized = normalizeDraftAnswers(value);
    const addRequired = (field: string, message: string): void => {
        errors.push(validationError(field, 'required', message));
    };

    if (value.consent === 'declined') {
        errors.push(validationError('consent', 'declined', '参与者未同意本次调查。'));
    } else if (!optionValue(value.consent, SURVEY_CONSENT_OPTIONS)) {
        addRequired('consent', '请确认自愿参加，未成年人须已取得监护人同意。');
    }
    if (!optionValue(value.participationMode, SURVEY_PARTICIPATION_MODES)) {
        addRequired('participationMode', '请选择本次了解应用的方式。');
    }

    if (!Array.isArray(value.experiencedModules) || value.experiencedModules.length === 0) {
        addRequired('experiencedModules', '请至少选择一项实际看到或体验的内容。');
    } else if (!hasOnlyOptions(value.experiencedModules, SURVEY_MODULE_IDS)) {
        errors.push(validationError('experiencedModules', 'invalid-option', '体验内容包含无效选项。'));
    }

    if (value.ageGroup !== undefined && !optionValue(value.ageGroup, SURVEY_AGE_GROUPS)) {
        errors.push(validationError('ageGroup', 'invalid-option', '年龄段选项无效。'));
    }
    if (ratingValue(value.priorKnowledge) === undefined) {
        addRequired('priorKnowledge', '请选择体验前对明中都的了解程度。');
    }

    const modules = normalizeOptionArray(value.experiencedModules, SURVEY_MODULE_IDS);
    if (modules.indexOf('knowledge-cards') >= 0 && agreementValue(value.knowledgeCardClarity) === undefined) {
        addRequired('knowledgeCardClarity', '请评价知识卡中的历史信息是否容易理解。');
    }

    const requiredAgreements: Array<[keyof SurveyAnswerDraftV1, string]> = [
        ['spatialRelationshipUnderstanding', '请评价应用是否帮助理解遗址空间关系。'],
        ['historicalMeaningUnderstanding', '请评价应用是否帮助理解遗迹的历史意义。'],
        ['furtherLearningInterest', '请评价体验后进一步了解明中都的兴趣。'],
        ['digitalDisplaySuitability', '请评价数字互动方式是否适合遗址文化展示。'],
        ['visualThemeCoherence', '请评价视觉风格与明中都主题的协调程度。'],
    ];
    requiredAgreements.forEach(([field, message]) => {
        if (agreementValue(value[field]) === undefined) addRequired(field, message);
    });

    if (ratingValue(value.overallSatisfaction) === undefined) {
        addRequired('overallSatisfaction', '请选择对应用体验或展示效果的总体满意度。');
    }
    if (ratingValue(value.recommendationWillingness) === undefined) {
        addRequired('recommendationWillingness', '请选择向同行者推荐该应用的意愿。');
    }

    if (!Array.isArray(value.improvementPriorities)) {
        addRequired('improvementPriorities', '请选择一至三项优先改进内容。');
    } else {
        if (!hasOnlyOptions(value.improvementPriorities, SURVEY_IMPROVEMENT_IDS)) {
            errors.push(validationError('improvementPriorities', 'invalid-option', '改进项包含无效选项。'));
        }
        const improvements = normalizeOptionArray(value.improvementPriorities, SURVEY_IMPROVEMENT_IDS);
        if (improvements.length < 1 || improvements.length > 3) {
            errors.push(validationError('improvementPriorities', 'selection-count', '请选择一至三项优先改进内容。'));
        }
        if (improvements.indexOf('none') >= 0 && improvements.length > 1) {
            errors.push(validationError('improvementPriorities', 'none-exclusive', '“暂无明显问题”不能与其他改进项同时选择。'));
        }
        if (improvements.indexOf('other') >= 0) {
            if (typeof value.improvementOther !== 'string' || value.improvementOther.trim().length === 0) {
                errors.push(validationError('improvementOther', 'required', '选择“其他”后请填写具体内容。'));
            } else if (value.improvementOther.trim().length > MAX_IMPROVEMENT_OTHER_LENGTH) {
                errors.push(validationError('improvementOther', 'too-long', `其他改进内容不能超过${MAX_IMPROVEMENT_OTHER_LENGTH}字。`));
            }
        }
    }

    if (
        value.memorableContent !== undefined
        && value.memorableContent !== null
        && typeof value.memorableContent !== 'string'
    ) {
        errors.push(validationError('memorableContent', 'invalid-text', '印象最深内容的格式无效。'));
    } else if (
        typeof value.memorableContent === 'string'
        && value.memorableContent.trim().length > MAX_MEMORABLE_CONTENT_LENGTH
    ) {
        errors.push(validationError('memorableContent', 'too-long', `印象最深内容不能超过${MAX_MEMORABLE_CONTENT_LENGTH}字。`));
    }

    if (errors.length > 0) return { valid: false, errors };
    return { valid: true, answers: normalized as SurveyAnswersV1, errors: [] };
}

function normalizeStoredDraft(value: unknown): SurveyDraftV1 | null {
    if (!isRecord(value) || value.version !== 1 || value.surveyVersion !== SURVEY_QUESTIONNAIRE_VERSION) {
        return null;
    }
    if (typeof value.sessionId !== 'string' || value.sessionId.length === 0) return null;
    return {
        version: 1,
        surveyVersion: SURVEY_QUESTIONNAIRE_VERSION,
        sessionId: value.sessionId,
        answers: normalizeDraftAnswers(value.answers),
        updatedAt: Number.isFinite(value.updatedAt) ? Number(value.updatedAt) : Date.now(),
    };
}

function normalizeStoredSubmission(value: unknown): SurveySubmissionV1 | null {
    if (!isRecord(value) || value.version !== 1 || value.surveyVersion !== SURVEY_QUESTIONNAIRE_VERSION) {
        return null;
    }
    if (
        typeof value.responseId !== 'string'
        || value.responseId.length === 0
        || typeof value.sessionId !== 'string'
        || value.sessionId.length === 0
        || typeof value.submittedDate !== 'string'
        || !/^\d{4}-\d{2}-\d{2}$/.test(value.submittedDate)
    ) {
        return null;
    }
    const validation = validateAnswers(value.answers);
    if (!validation.valid) return null;
    return {
        version: 1,
        surveyVersion: SURVEY_QUESTIONNAIRE_VERSION,
        responseId: value.responseId,
        sessionId: value.sessionId,
        submittedDate: value.submittedDate,
        answers: validation.answers,
    };
}

function normalizeStoredState(value: unknown): SurveyStoreStateV1 {
    if (!isRecord(value) || value.version !== 1) throw new Error('问卷存储版本无效。');
    const submissions: SurveySubmissionV1[] = [];
    const sessionIds = new Set<string>();
    const responseIds = new Set<string>();
    if (Array.isArray(value.submissions)) {
        value.submissions.forEach((item) => {
            const submission = normalizeStoredSubmission(item);
            if (
                submission
                && !sessionIds.has(submission.sessionId)
                && !responseIds.has(submission.responseId)
            ) {
                submissions.push(submission);
                sessionIds.add(submission.sessionId);
                responseIds.add(submission.responseId);
            }
        });
    }
    const activeDraft = normalizeStoredDraft(value.activeDraft);
    return {
        version: 1,
        activeDraft: activeDraft && !sessionIds.has(activeDraft.sessionId) ? activeDraft : null,
        submissions,
    };
}

export class SurveyResponseStore {
    private static cachedState: SurveyStoreStateV1 | null = null;

    static loadDraft(): SurveyDraftV1 | null {
        const draft = this.getState().activeDraft;
        return draft ? cloneDraft(draft) : null;
    }

    /** 首次开始或继续草稿；已有提交时须显式调用 startNextRespondent。 */
    static startDraft(): SurveyDraftMutationResult {
        const state = cloneState(this.getState());
        if (state.activeDraft) return { ok: true, draft: cloneDraft(state.activeDraft) };
        if (state.submissions.length > 0) return { ok: false, reason: 'already-submitted' };
        state.activeDraft = makeDraft();
        return this.persistDraftState(state);
    }

    /** 现场共用设备交给下一位参与者时调用；不会覆盖历史提交。 */
    static startNextRespondent(): SurveyDraftMutationResult {
        const state = cloneState(this.getState());
        if (state.activeDraft) return { ok: true, draft: cloneDraft(state.activeDraft) };
        state.activeDraft = makeDraft();
        return this.persistDraftState(state);
    }

    /** 保存完整答案快照或增量字段；未知字段和非法枚举不会进入存储。 */
    static saveDraft(answers: SurveyAnswerDraftV1, sessionId?: string): SurveyDraftMutationResult {
        if (answers.consent === 'declined') return this.declineParticipation();
        const state = cloneState(this.getState());
        if (!state.activeDraft) {
            if (state.submissions.length > 0) return { ok: false, reason: 'already-submitted' };
            state.activeDraft = makeDraft();
        }
        if (sessionId && state.activeDraft.sessionId !== sessionId) {
            return { ok: false, reason: 'session-mismatch', draft: cloneDraft(state.activeDraft) };
        }
        state.activeDraft.answers = normalizeDraftAnswers({ ...state.activeDraft.answers, ...answers });
        state.activeDraft.updatedAt = Date.now();
        return this.persistDraftState(state);
    }

    /** 拒绝参与时只清除未完成草稿，不写入拒绝选项或拒绝事件。 */
    static declineParticipation(): SurveyDraftMutationResult {
        const state = cloneState(this.getState());
        state.activeDraft = null;
        if (this.persist(state)) return { ok: true, draft: null };
        this.cachedState = cloneState(state);
        return { ok: false, reason: 'storage-failed' };
    }

    static validate(answers: unknown): SurveyValidationResult {
        return validateAnswers(answers);
    }

    static submit(answers?: SurveyAnswerDraftV1, sessionId?: string): SurveySubmitResult {
        if (answers?.consent === 'declined') {
            const result = this.declineParticipation();
            return result.ok
                ? { ok: false, reason: 'declined', errors: [] }
                : { ok: false, reason: 'storage-failed', errors: [] };
        }

        const state = cloneState(this.getState());
        if (sessionId) {
            const prior = state.submissions.find((item) => item.sessionId === sessionId);
            if (prior) return { ok: true, submission: cloneSubmission(prior), duplicate: true };
        }
        if (!state.activeDraft) {
            return {
                ok: false,
                reason: 'draft-missing',
                errors: [validationError('draft', 'missing', '未找到可提交的问卷草稿。')],
            };
        }
        if (sessionId && state.activeDraft.sessionId !== sessionId) {
            return {
                ok: false,
                reason: 'session-mismatch',
                errors: [validationError('draft', 'session-mismatch', '问卷会话已变化，请重新打开问卷。')],
                draft: cloneDraft(state.activeDraft),
            };
        }

        const mergedAnswers = answers
            ? { ...state.activeDraft.answers, ...answers }
            : state.activeDraft.answers;
        const validation = validateAnswers(mergedAnswers);
        if (!validation.valid) {
            return {
                ok: false,
                reason: 'validation-failed',
                errors: validation.errors,
                draft: cloneDraft({
                    ...state.activeDraft,
                    answers: normalizeDraftAnswers(mergedAnswers),
                    updatedAt: Date.now(),
                }),
            };
        }

        const completedDraft: SurveyDraftV1 = {
            ...state.activeDraft,
            answers: cloneAnswers(validation.answers),
            updatedAt: Date.now(),
        };
        const duplicate = state.submissions.find((item) => item.sessionId === completedDraft.sessionId);
        if (duplicate) return { ok: true, submission: cloneSubmission(duplicate), duplicate: true };

        const submission: SurveySubmissionV1 = {
            version: 1,
            surveyVersion: SURVEY_QUESTIONNAIRE_VERSION,
            responseId: createId('response'),
            sessionId: completedDraft.sessionId,
            submittedDate: localDateString(),
            answers: cloneAnswers(validation.answers),
        };
        const submittedState: SurveyStoreStateV1 = {
            version: 1,
            activeDraft: null,
            submissions: [...state.submissions, submission],
        };
        if (this.persist(submittedState)) {
            return { ok: true, submission: cloneSubmission(submission), duplicate: false };
        }

        // 研究数据不能把内存成功误报成已提交；保留完整草稿供再次尝试。
        state.activeDraft = completedDraft;
        this.cachedState = cloneState(state);
        return {
            ok: false,
            reason: 'storage-failed',
            errors: [validationError('storage', 'write-failed', '答案未能保存，请稍后重试。')],
            draft: cloneDraft(completedDraft),
        };
    }

    private static getState(): SurveyStoreStateV1 {
        if (this.cachedState) return this.cachedState;
        try {
            const raw = readStorage();
            this.cachedState = raw ? normalizeStoredState(JSON.parse(raw)) : emptyState();
        } catch (error) {
            console.warn('[SurveyResponseStore] 问卷数据读取失败，已使用空状态。', error);
            this.cachedState = emptyState();
        }
        return this.cachedState;
    }

    private static persistDraftState(state: SurveyStoreStateV1): SurveyDraftMutationResult {
        const draft = state.activeDraft ? cloneDraft(state.activeDraft) : null;
        if (this.persist(state)) return { ok: true, draft };
        this.cachedState = cloneState(state);
        return { ok: false, reason: 'storage-failed', draft: draft ?? undefined };
    }

    private static persist(state: SurveyStoreStateV1): boolean {
        try {
            writeStorage(state);
            this.cachedState = cloneState(state);
            return true;
        } catch (error) {
            console.warn('[SurveyResponseStore] 问卷数据保存失败。', error);
            return false;
        }
    }
}
