import { sys } from 'cc';

export interface GameSettings {
    musicEnabled: boolean;
    soundEnabled: boolean;
}

export const GAME_SETTINGS_STORAGE_KEY = 'ming-zhongdu.settings.v1';

export const DEFAULT_GAME_SETTINGS: Readonly<GameSettings> = Object.freeze({
    musicEnabled: true,
    soundEnabled: true,
});

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
    };
}

export function loadSettings(): GameSettings {
    try {
        const raw = sys.localStorage.getItem(GAME_SETTINGS_STORAGE_KEY);
        if (!raw) return { ...DEFAULT_GAME_SETTINGS };
        return normalizeSettings(JSON.parse(raw));
    } catch (error) {
        console.warn('[GameSettings] 设置读取失败，已恢复默认值。', error);
        return { ...DEFAULT_GAME_SETTINGS };
    }
}

export function saveSettings(settings: GameSettings): GameSettings {
    const normalized = normalizeSettings(settings);
    try {
        sys.localStorage.setItem(GAME_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
    } catch (error) {
        console.warn('[GameSettings] 设置保存失败，本次设置仍会临时生效。', error);
    }
    return normalized;
}
