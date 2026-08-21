import { sys } from 'cc';

export interface GameSettings {
    musicEnabled: boolean;
    soundEnabled: boolean;
    tourHintsEnabled: boolean;
}

export const GAME_SETTINGS_STORAGE_KEY = 'ming-zhongdu.settings.v2';
export const LEGACY_GAME_SETTINGS_STORAGE_KEY = 'ming-zhongdu.settings.v1';

export const DEFAULT_GAME_SETTINGS: Readonly<GameSettings> = Object.freeze({
    musicEnabled: true,
    soundEnabled: true,
    tourHintsEnabled: true,
});

export type GameSettingsListener = (settings: Readonly<GameSettings>) => void;

type WxStorage = {
    getStorageSync?: (key: string) => unknown;
    setStorageSync?: (key: string, value: string) => void;
};

const listeners = new Set<GameSettingsListener>();
let cachedSettings: GameSettings | null = null;

function getWxStorage(): WxStorage | null {
    return (globalThis as unknown as { wx?: WxStorage }).wx ?? null;
}

function readStorage(key: string): string | null {
    const wx = getWxStorage();
    if (typeof wx?.getStorageSync === 'function') {
        const value = wx.getStorageSync(key);
        return typeof value === 'string' && value.length > 0 ? value : null;
    }
    return sys.localStorage.getItem(key);
}

function writeStorage(key: string, value: string): void {
    const wx = getWxStorage();
    if (typeof wx?.setStorageSync === 'function') wx.setStorageSync(key, value);
    else sys.localStorage.setItem(key, value);
}

function normalizeSettings(value: unknown): GameSettings {
    if (!value || typeof value !== 'object') {
        return { ...DEFAULT_GAME_SETTINGS };
    }

    const candidate = value as Partial<GameSettings>;
    return {
        musicEnabled: typeof candidate.musicEnabled === 'boolean'
            ? candidate.musicEnabled
            : DEFAULT_GAME_SETTINGS.musicEnabled,
        soundEnabled: typeof candidate.soundEnabled === 'boolean'
            ? candidate.soundEnabled
            : DEFAULT_GAME_SETTINGS.soundEnabled,
        tourHintsEnabled: typeof candidate.tourHintsEnabled === 'boolean'
            ? candidate.tourHintsEnabled
            : DEFAULT_GAME_SETTINGS.tourHintsEnabled,
    };
}

function cloneSettings(settings: Readonly<GameSettings>): GameSettings {
    return { ...settings };
}

function notifyListeners(settings: Readonly<GameSettings>): void {
    const snapshot = cloneSettings(settings);
    listeners.forEach((listener) => {
        try {
            listener(snapshot);
        } catch (error) {
            console.warn('[GameSettings] 设置监听器执行失败。', error);
        }
    });
}

export function loadSettings(): GameSettings {
    if (cachedSettings) return cloneSettings(cachedSettings);
    try {
        const current = readStorage(GAME_SETTINGS_STORAGE_KEY);
        if (current) {
            cachedSettings = normalizeSettings(JSON.parse(current));
            return cloneSettings(cachedSettings);
        }

        const legacy = readStorage(LEGACY_GAME_SETTINGS_STORAGE_KEY);
        cachedSettings = legacy
            ? normalizeSettings(JSON.parse(legacy))
            : cloneSettings(DEFAULT_GAME_SETTINGS);
        if (legacy) {
            try {
                writeStorage(GAME_SETTINGS_STORAGE_KEY, JSON.stringify(cachedSettings));
            } catch (error) {
                console.warn('[GameSettings] 旧设置已载入，但迁移保存失败。', error);
            }
        }
    } catch (error) {
        console.warn('[GameSettings] 设置读取失败，已恢复默认值。', error);
        cachedSettings = cloneSettings(DEFAULT_GAME_SETTINGS);
    }
    return cloneSettings(cachedSettings);
}

export function saveSettings(settings: GameSettings): GameSettings {
    cachedSettings = normalizeSettings(settings);
    try {
        writeStorage(GAME_SETTINGS_STORAGE_KEY, JSON.stringify(cachedSettings));
    } catch (error) {
        console.warn('[GameSettings] 设置保存失败，本次设置仍会临时生效。', error);
    }
    notifyListeners(cachedSettings);
    return cloneSettings(cachedSettings);
}

export function resetSettings(): GameSettings {
    return saveSettings(cloneSettings(DEFAULT_GAME_SETTINGS));
}

export function onSettingsChanged(listener: GameSettingsListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
