import { sys } from 'cc';

// V1 数据保留在旧键下；不同题目的答卷不可迁移或混合统计。
export const SURVEY_STORAGE_KEY = 'ming-zhongdu.survey.v2';
export const SURVEY_SYNC_STORAGE_KEY = 'ming-zhongdu.survey-sync.v2';
export const SURVEY_QUESTIONNAIRE_VERSION = '2.3' as const;
export const SURVEY_ENDPOINT = 'https://nyasd.net/api/mingzhongdu/feedback';
export const GAME_RELEASE_VERSION = '0.2.2';

export type SurveyRating = 1 | 2 | 3 | 4 | 5;
export type SurveyImpressionId = 'map' | 'knowledge-cards' | 'site-scenes' | 'interaction';
export type SurveyImprovementId =
    | 'history-depth' | 'map-expansion' | 'movement-touch' | 'scene-interaction'
    | 'visual-readability' | 'performance' | 'none' | 'other';

export const SURVEY_IMPRESSION_IDS: ReadonlyArray<SurveyImpressionId> = [
    'map', 'knowledge-cards', 'site-scenes', 'interaction',
];
export const SURVEY_IMPROVEMENT_IDS: ReadonlyArray<SurveyImprovementId> = [
    'history-depth', 'map-expansion', 'movement-touch', 'scene-interaction',
    'visual-readability', 'performance', 'none', 'other',
];

/** 七题简版，仅记录问卷答案，不收集年龄、体验覆盖或玩家资料。 */
export interface SurveyAnswersV2 {
    priorKnowledge: SurveyRating;
    deepestImpression: SurveyImpressionId;
    improvementPriorities: SurveyImprovementId[];
    improvementOther?: string;
    postKnowledge: SurveyRating;
    furtherLearningInterest: SurveyRating;
    overallSatisfaction: SurveyRating;
    suggestions?: string;
}

export type SurveyAnswerDraftV2 = Partial<SurveyAnswersV2>;

export interface SurveyDraftV2 {
    version: 2;
    surveyVersion: '2.3';
    sessionId: string;
    answers: SurveyAnswerDraftV2;
    updatedAt: number;
}

export interface SurveySubmissionV2 {
    version: 2;
    surveyVersion: '2.3';
    responseId: string;
    sessionId: string;
    /** 仅保留本地日期用于现场批次核对，不记录精确时间。 */
    submittedDate: string;
    answers: SurveyAnswersV2;
}

export interface SurveyStoreStateV2 {
    version: 2;
    activeDraft: SurveyDraftV2 | null;
    submissions: SurveySubmissionV2[];
}

export interface SurveyValidationError {
    field: string;
    code: string;
    message: string;
}

export type SurveyValidationResult =
    | { valid: true; answers: SurveyAnswersV2; errors: [] }
    | { valid: false; errors: SurveyValidationError[] };

export type SurveyDraftFailureReason =
    | 'already-submitted'
    | 'session-mismatch'
    | 'storage-failed';

export type SurveyDraftMutationResult =
    | { ok: true; draft: SurveyDraftV2 | null }
    | { ok: false; reason: SurveyDraftFailureReason; draft?: SurveyDraftV2 };

export type SurveySubmitFailureReason =
    | 'draft-missing'
    | 'session-mismatch'
    | 'validation-failed'
    | 'storage-failed';

export type SurveySubmitResult =
    | { ok: true; submission: SurveySubmissionV2; duplicate: boolean }
    | {
        ok: false;
        reason: SurveySubmitFailureReason;
        errors: SurveyValidationError[];
        draft?: SurveyDraftV2;
    };

type WxStorage = {
    getStorageSync?: (key: string) => unknown;
    setStorageSync?: (key: string, value: string) => void;
    request?: (options: {
        url: string;
        method: 'POST';
        data: unknown;
        header: Record<string, string>;
        timeout: number;
        success: (response: { statusCode?: number }) => void;
        fail: (error: unknown) => void;
    }) => void;
};

type FetchLike = (
    input: string,
    init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number }>;

const MAX_IMPROVEMENT_OTHER_LENGTH = 120;
const MAX_SUGGESTIONS_LENGTH = 300;

function getWxStorage(): WxStorage | null {
    return (globalThis as unknown as { wx?: WxStorage }).wx ?? null;
}

function readStorageKey(key: string): string | null {
    const wx = getWxStorage();
    if (typeof wx?.getStorageSync === 'function') {
        const value = wx.getStorageSync(key);
        return typeof value === 'string' && value.length > 0 ? value : null;
    }
    return sys.localStorage.getItem(key);
}

function writeStorageKey(key: string, value: string): void {
    const wx = getWxStorage();
    if (typeof wx?.setStorageSync === 'function') {
        wx.setStorageSync(key, value);
        return;
    }
    if (!sys.localStorage || typeof sys.localStorage.setItem !== 'function') {
        throw new Error('当前环境不支持本地存储。');
    }
    sys.localStorage.setItem(key, value);
}

function readStorage(): string | null {
    return readStorageKey(SURVEY_STORAGE_KEY);
}

function writeStorage(state: SurveyStoreStateV2): void {
    writeStorageKey(SURVEY_STORAGE_KEY, JSON.stringify(state));
}

function readSyncedResponseIds(): Set<string> {
    try {
        const raw = readStorageKey(SURVEY_SYNC_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []);
    } catch {
        return new Set<string>();
    }
}

function writeSyncedResponseIds(ids: Set<string>): void {
    writeStorageKey(SURVEY_SYNC_STORAGE_KEY, JSON.stringify([...ids].slice(-500)));
}

function getPlatformName(): 'wechatgame' | 'web' {
    return typeof getWxStorage()?.request === 'function' ? 'wechatgame' : 'web';
}

function uploadSubmission(submission: SurveySubmissionV2): Promise<void> {
    const payload = {
        version: 2,
        gameVersion: GAME_RELEASE_VERSION,
        platform: getPlatformName(),
        submission,
    };
    const wx = getWxStorage();
    if (typeof wx?.request === 'function') {
        return new Promise((resolve, reject) => {
            wx.request!({
                url: SURVEY_ENDPOINT,
                method: 'POST',
                data: payload,
                header: { 'content-type': 'application/json' },
                timeout: 12000,
                success: (response) => {
                    const status = Number(response.statusCode || 0);
                    if (status >= 200 && status < 300) resolve();
                    else reject(new Error(`HTTP_${status}`));
                },
                fail: reject,
            });
        });
    }
    const fetcher = (globalThis as unknown as { fetch?: FetchLike }).fetch;
    if (typeof fetcher !== 'function') return Promise.reject(new Error('NETWORK_UNAVAILABLE'));
    return fetcher(SURVEY_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
    }).then((response) => {
        if (!response.ok) throw new Error(`HTTP_${response.status}`);
    });
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

function normalizedText(value: unknown, maximumLength: number): string | undefined {
    if (typeof value !== 'string') return undefined;
    const text = value.trim();
    return text.length > 0 ? text.slice(0, maximumLength) : undefined;
}

function normalizeDraftAnswers(value: unknown): SurveyAnswerDraftV2 {
    if (!isRecord(value)) return {};
    const answers: SurveyAnswerDraftV2 = {};
    const fields = ['priorKnowledge', 'postKnowledge', 'furtherLearningInterest', 'overallSatisfaction'] as const;
    fields.forEach((field) => {
        const rating = ratingValue(value[field]);
        if (rating !== undefined) answers[field] = rating;
    });
    const impression = optionValue(value.deepestImpression, SURVEY_IMPRESSION_IDS);
    if (impression !== undefined) answers.deepestImpression = impression;
    if (Array.isArray(value.improvementPriorities)) {
        answers.improvementPriorities = normalizeOptionArray(value.improvementPriorities, SURVEY_IMPROVEMENT_IDS);
    }
    if ((answers.improvementPriorities?.indexOf('other') ?? -1) >= 0) {
        const text = normalizedText(value.improvementOther, MAX_IMPROVEMENT_OTHER_LENGTH);
        if (text !== undefined) answers.improvementOther = text;
    }
    const suggestions = normalizedText(value.suggestions, MAX_SUGGESTIONS_LENGTH);
    if (suggestions !== undefined) answers.suggestions = suggestions;
    return answers;
}

function cloneAnswers<T extends SurveyAnswerDraftV2 | SurveyAnswersV2>(answers: T): T {
    return {
        ...answers,
        improvementPriorities: answers.improvementPriorities ? [...answers.improvementPriorities] : undefined,
    } as T;
}

function cloneDraft(draft: SurveyDraftV2): SurveyDraftV2 {
    return { ...draft, answers: cloneAnswers(draft.answers) };
}

function cloneSubmission(submission: SurveySubmissionV2): SurveySubmissionV2 {
    return { ...submission, answers: cloneAnswers(submission.answers) };
}

function cloneState(state: SurveyStoreStateV2): SurveyStoreStateV2 {
    return {
        version: 2,
        activeDraft: state.activeDraft ? cloneDraft(state.activeDraft) : null,
        submissions: state.submissions.map(cloneSubmission),
    };
}

function emptyState(): SurveyStoreStateV2 {
    return { version: 2, activeDraft: null, submissions: [] };
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

function makeDraft(): SurveyDraftV2 {
    return {
        version: 2,
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
        return { valid: false, errors: [validationError('answers', 'invalid', '问卷答案格式无效。')] };
    }
    const errors: SurveyValidationError[] = [];
    const requiredRatings = ['priorKnowledge', 'postKnowledge', 'furtherLearningInterest', 'overallSatisfaction'] as const;
    requiredRatings.forEach((field) => {
        if (ratingValue(value[field]) === undefined) {
            errors.push(validationError(field, 'required', '请完成了解程度、参观意愿和满意度评价。'));
        }
    });
    if (!optionValue(value.deepestImpression, SURVEY_IMPRESSION_IDS)) {
        errors.push(validationError('deepestImpression', 'required', '请选择印象最深的部分。'));
    }
    const selected = normalizeOptionArray(value.improvementPriorities, SURVEY_IMPROVEMENT_IDS);
    if (!hasOnlyOptions(value.improvementPriorities, SURVEY_IMPROVEMENT_IDS)) {
        errors.push(validationError('improvementPriorities', 'invalid-option', '改进项包含无效选项。'));
    }
    if (selected.length < 1 || selected.length > 2) {
        errors.push(validationError('improvementPriorities', 'selection-count', '请选择一至两项改进内容。'));
    }
    if (selected.indexOf('none') >= 0 && selected.length > 1) {
        errors.push(validationError('improvementPriorities', 'none-exclusive', '“暂无明显需要改进的地方”不能与其他选项同时选择。'));
    }
    if (selected.indexOf('other') >= 0) {
        if (typeof value.improvementOther !== 'string' || !value.improvementOther.trim()) {
            errors.push(validationError('improvementOther', 'required', '请填写“其他”改进内容。'));
        } else if (value.improvementOther.trim().length > MAX_IMPROVEMENT_OTHER_LENGTH) {
            errors.push(validationError('improvementOther', 'too-long', '其他改进内容不能超过120字。'));
        }
    }
    if (value.suggestions !== undefined && typeof value.suggestions !== 'string') {
        errors.push(validationError('suggestions', 'invalid-text', '建议的格式无效。'));
    } else if (typeof value.suggestions === 'string' && value.suggestions.trim().length > MAX_SUGGESTIONS_LENGTH) {
        errors.push(validationError('suggestions', 'too-long', '建议不能超过300字。'));
    }
    return errors.length
        ? { valid: false, errors }
        : { valid: true, answers: normalizeDraftAnswers(value) as SurveyAnswersV2, errors: [] };
}

function normalizeStoredDraft(value: unknown): SurveyDraftV2 | null {
    if (!isRecord(value) || value.version !== 2 || value.surveyVersion !== SURVEY_QUESTIONNAIRE_VERSION) {
        return null;
    }
    if (typeof value.sessionId !== 'string' || value.sessionId.length === 0) return null;
    return {
        version: 2,
        surveyVersion: SURVEY_QUESTIONNAIRE_VERSION,
        sessionId: value.sessionId,
        answers: normalizeDraftAnswers(value.answers),
        updatedAt: Number.isFinite(value.updatedAt) ? Number(value.updatedAt) : Date.now(),
    };
}

function normalizeStoredSubmission(value: unknown): SurveySubmissionV2 | null {
    if (!isRecord(value) || value.version !== 2 || value.surveyVersion !== SURVEY_QUESTIONNAIRE_VERSION) {
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
        version: 2,
        surveyVersion: SURVEY_QUESTIONNAIRE_VERSION,
        responseId: value.responseId,
        sessionId: value.sessionId,
        submittedDate: value.submittedDate,
        answers: validation.answers,
    };
}

function normalizeStoredState(value: unknown): SurveyStoreStateV2 {
    if (!isRecord(value) || value.version !== 2) throw new Error('问卷存储版本无效。');
    const submissions: SurveySubmissionV2[] = [];
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
        version: 2,
        activeDraft: activeDraft && !sessionIds.has(activeDraft.sessionId) ? activeDraft : null,
        submissions,
    };
}

export class SurveyResponseStore {
    private static cachedState: SurveyStoreStateV2 | null = null;
    private static syncInFlight: Promise<{ uploaded: number; pending: number }> | null = null;

    static loadDraft(): SurveyDraftV2 | null {
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
    static saveDraft(answers: SurveyAnswerDraftV2, sessionId?: string): SurveyDraftMutationResult {
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

    static validate(answers: unknown): SurveyValidationResult {
        return validateAnswers(answers);
    }

    static submit(answers?: SurveyAnswerDraftV2, sessionId?: string): SurveySubmitResult {
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

        const completedDraft: SurveyDraftV2 = {
            ...state.activeDraft,
            answers: cloneAnswers(validation.answers),
            updatedAt: Date.now(),
        };
        const duplicate = state.submissions.find((item) => item.sessionId === completedDraft.sessionId);
        if (duplicate) return { ok: true, submission: cloneSubmission(duplicate), duplicate: true };

        const submission: SurveySubmissionV2 = {
            version: 2,
            surveyVersion: SURVEY_QUESTIONNAIRE_VERSION,
            responseId: createId('response'),
            sessionId: completedDraft.sessionId,
            submittedDate: localDateString(),
            answers: cloneAnswers(validation.answers),
        };
        const submittedState: SurveyStoreStateV2 = {
            version: 2,
            activeDraft: null,
            submissions: [...state.submissions, submission],
        };
        if (this.persist(submittedState)) {
            // 放到微任务中执行，确保本地提交先稳定落盘；断网时下次启动仍会重试。
            void Promise.resolve().then(() => this.syncPending());
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

    /**
     * 将网页与微信小游戏的本地答卷汇总到同一服务器。
     * 失败的答卷继续留在设备中，下次打开问卷时会自动重试。
     */
    static syncPending(): Promise<{ uploaded: number; pending: number }> {
        if (this.syncInFlight) return this.syncInFlight;
        const operation = (async () => {
            const submissions = cloneState(this.getState()).submissions;
            const synced = readSyncedResponseIds();
            let uploaded = 0;
            for (const submission of submissions) {
                if (synced.has(submission.responseId)) continue;
                try {
                    await uploadSubmission(submission);
                    synced.add(submission.responseId);
                    writeSyncedResponseIds(synced);
                    uploaded += 1;
                } catch (error) {
                    console.warn('[SurveyResponseStore] 答卷暂未同步，稍后会自动重试。', error);
                    break;
                }
            }
            const pending = submissions.filter((item) => !synced.has(item.responseId)).length;
            return { uploaded, pending };
        })();
        this.syncInFlight = operation.then(
            (result) => {
                this.syncInFlight = null;
                return result;
            },
            (error) => {
                this.syncInFlight = null;
                throw error;
            },
        );
        return this.syncInFlight;
    }

    private static getState(): SurveyStoreStateV2 {
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

    private static persistDraftState(state: SurveyStoreStateV2): SurveyDraftMutationResult {
        const draft = state.activeDraft ? cloneDraft(state.activeDraft) : null;
        if (this.persist(state)) return { ok: true, draft };
        this.cachedState = cloneState(state);
        return { ok: false, reason: 'storage-failed', draft: draft ?? undefined };
    }

    private static persist(state: SurveyStoreStateV2): boolean {
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
