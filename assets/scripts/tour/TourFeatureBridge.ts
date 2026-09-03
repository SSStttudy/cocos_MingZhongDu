export type TourFragmentSceneProgress = {
    total: number;
    collected: number;
};

export type TourFragmentEvent = {
    locationId: string;
    sceneId: string;
    fragmentId?: string;
    fragmentName?: string;
    total?: number;
    collected?: number;
};

export interface TourFragmentProvider {
    getSceneProgress(locationId: string, sceneId: string): TourFragmentSceneProgress | null;
}

export const TOUR_FEATURE_EVENTS = {
    fragmentDiscovered: 'tour-fragment-discovered',
    fragmentCollected: 'tour-fragment-collected',
    fragmentSceneCompleted: 'tour-fragment-scene-completed',
    magnifierExpanded: 'tour-magnifier-expanded',
    magnifierMoved: 'tour-magnifier-moved',
    magnifierCollapsed: 'tour-magnifier-collapsed',
} as const;

/** Optional bridge: the tour never owns fragment data or collection rules. */
export class TourFeatureBridge {
    private static fragmentProvider: TourFragmentProvider | null = null;

    static registerFragmentProvider(provider: TourFragmentProvider): void {
        this.fragmentProvider = provider;
    }

    static unregisterFragmentProvider(provider: TourFragmentProvider): void {
        if (this.fragmentProvider === provider) this.fragmentProvider = null;
    }

    static getFragmentProgress(locationId: string, sceneId: string): TourFragmentSceneProgress | null {
        try {
            const progress = this.fragmentProvider?.getSceneProgress(locationId, sceneId) ?? null;
            if (!progress) return null;
            const total = Math.max(0, Math.floor(Number(progress.total) || 0));
            const collected = Math.max(0, Math.min(total, Math.floor(Number(progress.collected) || 0)));
            return { total, collected };
        } catch (error) {
            console.warn('[TourFeatureBridge] 无法读取碎片进度，已隐藏碎片提示。', error);
            return null;
        }
    }
}
