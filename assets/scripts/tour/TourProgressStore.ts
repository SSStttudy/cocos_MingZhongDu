import { sys } from 'cc';
import {
    getNextTourStep,
    getTourStep,
    TourResumeAnchor,
    TourStep,
} from './TourConfig';

export const TOUR_PROGRESS_STORAGE_KEY = 'ming-zhongdu.tour.v1';
// Testing phase: keep progress across scene changes, but start fresh after
// restarting preview. Switch to true when the tour flow is ready for release.
const PERSIST_PROGRESS_BETWEEN_SESSIONS = false;

export type TourProgressV1 = {
    version: 1;
    visitedStepIds: string[];
    currentStepId: string;
    resumeAnchor: TourResumeAnchor;
    completed: boolean;
    updatedAt: number;
};

const DEFAULT_ANCHOR: TourResumeAnchor = { kind: 'overworld', entryId: '' };

function createDefaultProgress(): TourProgressV1 {
    return {
        version: 1,
        visitedStepIds: [],
        currentStepId: 'visitor-center-enter',
        resumeAnchor: DEFAULT_ANCHOR,
        completed: false,
        updatedAt: Date.now(),
    };
}

function cloneAnchor(anchor: TourResumeAnchor): TourResumeAnchor {
    return anchor.kind === 'location'
        ? {
            kind: 'location',
            locationId: anchor.locationId,
            sceneId: anchor.sceneId,
            spawnId: anchor.spawnId,
        }
        : { kind: 'overworld', entryId: anchor.entryId };
}

function normalize(value: unknown): TourProgressV1 {
    if (!value || typeof value !== 'object') return createDefaultProgress();
    const raw = value as Partial<TourProgressV1>;
    if (raw.version !== 1 || !Array.isArray(raw.visitedStepIds)) return createDefaultProgress();

    const visited = new Set(
        raw.visitedStepIds.filter((id): id is string => (
            typeof id === 'string' && getTourStep(id) !== null
        )),
    );
    const next = getNextTourStep(visited);
    const rawAnchor = raw.resumeAnchor as Partial<TourResumeAnchor> | undefined;
    let resumeAnchor: TourResumeAnchor = DEFAULT_ANCHOR;
    if (rawAnchor?.kind === 'overworld') {
        resumeAnchor = {
            kind: 'overworld',
            entryId: typeof rawAnchor.entryId === 'string' ? rawAnchor.entryId : '',
        };
    } else if (
        rawAnchor?.kind === 'location'
        && typeof rawAnchor.locationId === 'string'
        && typeof rawAnchor.sceneId === 'string'
        && typeof rawAnchor.spawnId === 'string'
    ) {
        resumeAnchor = {
            kind: 'location',
            locationId: rawAnchor.locationId,
            sceneId: rawAnchor.sceneId,
            spawnId: rawAnchor.spawnId,
        };
    }

    return {
        version: 1,
        visitedStepIds: [...visited],
        currentStepId: next?.id ?? '',
        resumeAnchor: cloneAnchor(resumeAnchor),
        completed: next === null,
        updatedAt: Number.isFinite(raw.updatedAt) ? Number(raw.updatedAt) : Date.now(),
    };
}

export class TourProgressStore {
    private static cached: TourProgressV1 | null = null;

    static load(): TourProgressV1 {
        if (this.cached) return this.copy(this.cached);
        if (!PERSIST_PROGRESS_BETWEEN_SESSIONS) {
            try {
                sys.localStorage.removeItem(TOUR_PROGRESS_STORAGE_KEY);
            } catch (_) {
                // Storage may be unavailable in editor preview.
            }
            this.cached = createDefaultProgress();
            return this.copy(this.cached);
        }
        try {
            const raw = sys.localStorage.getItem(TOUR_PROGRESS_STORAGE_KEY);
            this.cached = raw ? normalize(JSON.parse(raw)) : createDefaultProgress();
        } catch (error) {
            console.warn('[TourProgress] 导览进度损坏，已恢复默认值。', error);
            this.cached = createDefaultProgress();
        }
        return this.copy(this.cached);
    }

    static hasStarted(): boolean {
        const progress = this.load();
        return progress.visitedStepIds.length > 0 || progress.completed;
    }

    static getCurrentStep(): TourStep | null {
        const progress = this.load();
        return progress.currentStepId ? getTourStep(progress.currentStepId) : null;
    }

    static getVisited(): Set<string> {
        return new Set(this.load().visitedStepIds);
    }

    static isVisited(stepId: string): boolean {
        return this.load().visitedStepIds.indexOf(stepId) >= 0;
    }

    static markVisited(stepId: string, resumeAnchor?: TourResumeAnchor): TourProgressV1 {
        const progress = this.load();
        if (getTourStep(stepId) && progress.visitedStepIds.indexOf(stepId) < 0) {
            progress.visitedStepIds.push(stepId);
        }
        if (resumeAnchor) progress.resumeAnchor = cloneAnchor(resumeAnchor);
        const next = getNextTourStep(new Set(progress.visitedStepIds));
        progress.currentStepId = next?.id ?? '';
        progress.completed = next === null;
        progress.updatedAt = Date.now();
        return this.save(progress);
    }

    static setResumeAnchor(anchor: TourResumeAnchor): TourProgressV1 {
        const progress = this.load();
        progress.resumeAnchor = cloneAnchor(anchor);
        progress.updatedAt = Date.now();
        return this.save(progress);
    }

    static reset(): TourProgressV1 {
        this.cached = createDefaultProgress();
        try {
            sys.localStorage.removeItem(TOUR_PROGRESS_STORAGE_KEY);
        } catch (error) {
            console.warn('[TourProgress] 无法清理旧导览进度。', error);
        }
        return this.copy(this.cached);
    }

    private static save(progress: TourProgressV1): TourProgressV1 {
        this.cached = normalize(progress);
        if (!PERSIST_PROGRESS_BETWEEN_SESSIONS) return this.copy(this.cached);
        try {
            sys.localStorage.setItem(TOUR_PROGRESS_STORAGE_KEY, JSON.stringify(this.cached));
        } catch (error) {
            console.warn('[TourProgress] 无法保存导览进度。', error);
        }
        return this.copy(this.cached);
    }

    private static copy(progress: TourProgressV1): TourProgressV1 {
        return {
            ...progress,
            visitedStepIds: [...progress.visitedStepIds],
            resumeAnchor: cloneAnchor(progress.resumeAnchor),
        };
    }
}
