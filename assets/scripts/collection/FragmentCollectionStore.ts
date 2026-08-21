export type FragmentDefinition = {
    id: string;
    title: string;
    location: string;
};

export const FRAGMENT_DEFINITIONS: FragmentDefinition[] = [
    { id: 'visitor-gate', title: '皇城方位碎片', location: '游客中心入口' },
    { id: 'stone-base', title: '宫殿基址碎片', location: '蟠龙石础' },
    { id: 'ancient-well', title: '营造水脉碎片', location: '古井遗址' },
    { id: 'wumen', title: '中轴礼制碎片', location: '午门遗址' },
    { id: 'west-gate', title: '城垣门户碎片', location: '西华门遗址' },
];

export type FragmentCollectionState = {
    version: 1;
    collected: string[];
    assembled: boolean;
    achievementUnlockedAt?: string;
};

const STORAGE_KEY = 'mingzhongdu.fragments.v1';

type WxStorage = {
    getStorageSync?: (key: string) => unknown;
    setStorageSync?: (key: string, value: string) => void;
    removeStorageSync?: (key: string) => void;
};

function storage(): WxStorage | null {
    return (globalThis as unknown as { wx?: WxStorage }).wx ?? null;
}

function defaultState(): FragmentCollectionState {
    return { version: 1, collected: [], assembled: false };
}

function validFragmentIds(values: unknown): string[] {
    if (!Array.isArray(values)) return [];
    const validIds = new Set(FRAGMENT_DEFINITIONS.map((item) => item.id));
    return [...new Set(values.filter((item): item is string => (
        typeof item === 'string' && validIds.has(item)
    )))];
}

export class FragmentCollectionStore {
    static load(): FragmentCollectionState {
        try {
            const wx = storage();
            const raw = typeof wx?.getStorageSync === 'function'
                ? wx.getStorageSync(STORAGE_KEY)
                : globalThis.localStorage?.getItem(STORAGE_KEY);
            if (typeof raw !== 'string' || !raw) return defaultState();
            const parsed = JSON.parse(raw) as Partial<FragmentCollectionState>;
            const collected = validFragmentIds(parsed.collected);
            const allCollected = collected.length === FRAGMENT_DEFINITIONS.length;
            return {
                version: 1,
                collected,
                assembled: allCollected && parsed.assembled === true,
                achievementUnlockedAt: typeof parsed.achievementUnlockedAt === 'string'
                    ? parsed.achievementUnlockedAt
                    : undefined,
            };
        } catch {
            return defaultState();
        }
    }

    static collect(fragmentId: string): { state: FragmentCollectionState; firstTime: boolean } {
        const state = this.load();
        if (!FRAGMENT_DEFINITIONS.some((item) => item.id === fragmentId)) {
            return { state, firstTime: false };
        }
        if (state.collected.indexOf(fragmentId) >= 0) return { state, firstTime: false };
        state.collected.push(fragmentId);
        this.save(state);
        return { state, firstTime: true };
    }

    static assemble(): { state: FragmentCollectionState; unlockedNow: boolean } {
        const state = this.load();
        if (state.collected.length < FRAGMENT_DEFINITIONS.length) {
            return { state, unlockedNow: false };
        }
        const unlockedNow = !state.assembled;
        state.assembled = true;
        state.achievementUnlockedAt ??= new Date().toISOString();
        this.save(state);
        return { state, unlockedNow };
    }

    static save(state: FragmentCollectionState): void {
        const value = JSON.stringify(state);
        try {
            const wx = storage();
            if (typeof wx?.setStorageSync === 'function') wx.setStorageSync(STORAGE_KEY, value);
            else globalThis.localStorage?.setItem(STORAGE_KEY, value);
        } catch (error) {
            console.warn('[FragmentCollectionStore] 保存碎片进度失败。', error);
        }
    }

    static reset(): FragmentCollectionState {
        const state = defaultState();
        try {
            const wx = storage();
            if (typeof wx?.removeStorageSync === 'function') wx.removeStorageSync(STORAGE_KEY);
            else if (typeof wx?.setStorageSync === 'function') {
                wx.setStorageSync(STORAGE_KEY, JSON.stringify(state));
            }
            else globalThis.localStorage?.removeItem(STORAGE_KEY);
        } catch (error) {
            console.warn('[FragmentCollectionStore] 清除碎片进度失败。', error);
        }
        return state;
    }
}
