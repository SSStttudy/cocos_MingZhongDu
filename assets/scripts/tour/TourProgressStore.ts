import { sys } from 'cc';
import { getNextTourStep, getTourStep, TourResumeAnchor, TourStep } from './TourConfig';

export const TOUR_PROGRESS_STORAGE_KEY = 'ming-zhongdu.tour.v2';
const LEGACY_STORAGE_KEY = 'ming-zhongdu.tour.v1';

export type TourProgressV2 = {
    version: 2;
    discoveredStepIds: string[];
    completedStepIds: string[];
    shownNarrationIds: string[];
    completedTutorialIds: string[];
    currentStepId: string;
    resumeAnchor: TourResumeAnchor;
    completed: boolean;
    updatedAt: number;
};

const DEFAULT_ANCHOR: TourResumeAnchor = { kind: 'overworld', entryId: '' };

function createDefaultProgress(): TourProgressV2 {
    return {
        version: 2,
        discoveredStepIds: [],
        completedStepIds: [],
        shownNarrationIds: [],
        completedTutorialIds: [],
        currentStepId: 'visitor-center-enter',
        resumeAnchor: DEFAULT_ANCHOR,
        completed: false,
        updatedAt: Date.now(),
    };
}

function cloneAnchor(anchor: TourResumeAnchor): TourResumeAnchor {
    return anchor.kind === 'location'
        ? { kind: 'location', locationId: anchor.locationId, sceneId: anchor.sceneId, spawnId: anchor.spawnId }
        : { kind: 'overworld', entryId: anchor.entryId };
}

function validIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    // Cocos 的 Babel 构建会把 `[...new Set(values)]` 降级成
    // `[].concat(new Set(values))`，最终存成 `[{}]`。显式使用 Array.from
    // 才能在 Web 与微信小游戏运行时得到真正的字符串数组。
    return Array.from(new Set(
        value.filter((id): id is string => typeof id === 'string' && getTourStep(id) !== null),
    ));
}

function validStringIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(
        value.filter((id): id is string => typeof id === 'string' && id.length > 0),
    ));
}

function normalizeAnchor(value: unknown): TourResumeAnchor {
    if (!value || typeof value !== 'object') return DEFAULT_ANCHOR;
    const raw = value as Record<string, unknown>;
    if (raw.kind === 'overworld') {
        return { kind: 'overworld', entryId: typeof raw.entryId === 'string' ? raw.entryId : '' };
    }
    if (
        raw.kind === 'location'
        && typeof raw.locationId === 'string'
        && typeof raw.sceneId === 'string'
        && typeof raw.spawnId === 'string'
    ) {
        return { kind: 'location', locationId: raw.locationId, sceneId: raw.sceneId, spawnId: raw.spawnId };
    }
    return DEFAULT_ANCHOR;
}

function migrateLegacy(value: unknown): TourProgressV2 {
    if (!value || typeof value !== 'object') return createDefaultProgress();
    const raw = value as Record<string, unknown>;
    const legacy = Array.isArray(raw.visitedStepIds) ? raw.visitedStepIds : [];
    const idMap: Record<string, string> = {
        'west-gate': 'west-gate-enter',
        'stone-pier': 'stone-base-enter',
        'ancient-well': 'ancient-well-enter',
        wumen: 'wumen-enter',
    };
    const completed = validIds(legacy.map((id) => idMap[String(id)] ?? id));
    const next = getNextTourStep(new Set(completed));
    return {
        version: 2,
        discoveredStepIds: [...completed],
        completedStepIds: completed,
        shownNarrationIds: [],
        completedTutorialIds: [],
        currentStepId: next?.id ?? '',
        resumeAnchor: normalizeAnchor(raw.resumeAnchor),
        completed: next === null,
        updatedAt: Date.now(),
    };
}

function normalize(value: unknown): TourProgressV2 {
    if (!value || typeof value !== 'object') return createDefaultProgress();
    const raw = value as Partial<TourProgressV2>;
    if (raw.version !== 2) return migrateLegacy(value);
    const completed = validIds(raw.completedStepIds);
    const discovered = validIds([...(raw.discoveredStepIds ?? []), ...completed]);
    const next = getNextTourStep(new Set(completed));
    return {
        version: 2,
        discoveredStepIds: discovered,
        completedStepIds: completed,
        shownNarrationIds: validStringIds(raw.shownNarrationIds),
        completedTutorialIds: validStringIds(raw.completedTutorialIds),
        currentStepId: next?.id ?? '',
        resumeAnchor: cloneAnchor(normalizeAnchor(raw.resumeAnchor)),
        completed: next === null,
        updatedAt: Number.isFinite(raw.updatedAt) ? Number(raw.updatedAt) : Date.now(),
    };
}

export class TourProgressStore {
    private static cached: TourProgressV2 | null = null;

    static load(): TourProgressV2 {
        if (this.cached) return this.copy(this.cached);
        try {
            const raw = sys.localStorage.getItem(TOUR_PROGRESS_STORAGE_KEY);
            if (raw) {
                this.cached = normalize(JSON.parse(raw));
            } else {
                const legacy = sys.localStorage.getItem(LEGACY_STORAGE_KEY);
                this.cached = legacy ? migrateLegacy(JSON.parse(legacy)) : createDefaultProgress();
                if (legacy) this.persist(this.cached);
            }
        } catch (error) {
            console.warn('[TourProgress] 导览进度损坏，已恢复默认值。', error);
            this.cached = createDefaultProgress();
        }
        return this.copy(this.cached);
    }

    static hasStarted(): boolean {
        const progress = this.load();
        return progress.discoveredStepIds.length > 0 || progress.completedStepIds.length > 0 || progress.completed;
    }

    static getCurrentStep(): TourStep | null {
        const progress = this.load();
        return progress.currentStepId ? getTourStep(progress.currentStepId) : null;
    }

    static getVisited(): Set<string> {
        return new Set(this.load().completedStepIds);
    }

    static isVisited(stepId: string): boolean {
        return this.load().completedStepIds.indexOf(stepId) >= 0;
    }

    static hasShownNarration(narrationId: string): boolean {
        return this.load().shownNarrationIds.indexOf(narrationId) >= 0;
    }

    static markNarrationShown(narrationId: string): TourProgressV2 {
        const progress = this.load();
        if (narrationId && progress.shownNarrationIds.indexOf(narrationId) < 0) {
            progress.shownNarrationIds.push(narrationId);
            progress.updatedAt = Date.now();
        }
        return this.save(progress);
    }

    static hasCompletedTutorial(tutorialId: string): boolean {
        return this.load().completedTutorialIds.indexOf(tutorialId) >= 0;
    }

    static markTutorialCompleted(tutorialId: string): TourProgressV2 {
        const progress = this.load();
        if (tutorialId && progress.completedTutorialIds.indexOf(tutorialId) < 0) {
            progress.completedTutorialIds.push(tutorialId);
            progress.updatedAt = Date.now();
        }
        return this.save(progress);
    }

    static markDiscovered(stepId: string): TourProgressV2 {
        const progress = this.load();
        if (getTourStep(stepId) && progress.discoveredStepIds.indexOf(stepId) < 0) {
            progress.discoveredStepIds.push(stepId);
            progress.updatedAt = Date.now();
        }
        return this.save(progress);
    }

    static markVisited(stepId: string, resumeAnchor?: TourResumeAnchor): TourProgressV2 {
        const progress = this.load();
        if (getTourStep(stepId)) {
            if (progress.discoveredStepIds.indexOf(stepId) < 0) progress.discoveredStepIds.push(stepId);
            if (progress.completedStepIds.indexOf(stepId) < 0) progress.completedStepIds.push(stepId);
        }
        if (resumeAnchor) progress.resumeAnchor = cloneAnchor(resumeAnchor);
        const next = getNextTourStep(new Set(progress.completedStepIds));
        progress.currentStepId = next?.id ?? '';
        progress.completed = next === null;
        progress.updatedAt = Date.now();
        return this.save(progress);
    }

    static setResumeAnchor(anchor: TourResumeAnchor): TourProgressV2 {
        const progress = this.load();
        progress.resumeAnchor = cloneAnchor(anchor);
        progress.updatedAt = Date.now();
        return this.save(progress);
    }

    static reset(): TourProgressV2 {
        this.cached = createDefaultProgress();
        try {
            sys.localStorage.removeItem(TOUR_PROGRESS_STORAGE_KEY);
            sys.localStorage.removeItem(LEGACY_STORAGE_KEY);
        } catch (error) {
            console.warn('[TourProgress] 无法清理旧导览进度。', error);
        }
        return this.copy(this.cached);
    }

    private static save(progress: TourProgressV2): TourProgressV2 {
        this.cached = normalize(progress);
        this.persist(this.cached);
        return this.copy(this.cached);
    }

    private static persist(progress: TourProgressV2): void {
        try {
            sys.localStorage.setItem(TOUR_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
        } catch (error) {
            console.warn('[TourProgress] 无法保存导览进度。', error);
        }
    }

    private static copy(progress: TourProgressV2): TourProgressV2 {
        return {
            ...progress,
            discoveredStepIds: [...progress.discoveredStepIds],
            completedStepIds: [...progress.completedStepIds],
            shownNarrationIds: [...progress.shownNarrationIds],
            completedTutorialIds: [...progress.completedTutorialIds],
            resumeAnchor: cloneAnchor(progress.resumeAnchor),
        };
    }
}
