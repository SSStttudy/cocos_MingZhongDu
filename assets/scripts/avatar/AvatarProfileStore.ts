import {
    assetManager,
    ImageAsset,
    resources,
    SpriteFrame,
    Texture2D,
} from 'cc';

export type AvatarDirection = 'down' | 'up' | 'left' | 'right';
export type AvatarFrameMap = Record<AvatarDirection, string[]>;

/**
 * 角色生成服务与游戏之间的稳定资源协议。
 *
 * 定位器支持两种形式：
 * - resource://characters/.../spriteFrame：随游戏打包的默认/演示资源；
 * - https://.../frame.png：生成服务返回的透明 PNG。
 */
export type AvatarManifest = {
    version: 1 | 2;
    avatarId: string;
    displayName: string;
    createdAt: string;
    provider?: string;
    stylePreset?: string;
    canvas: { width: number; height: number; feetY: number };
    previewUrl: string;
    idle: Record<AvatarDirection, string>;
    walk: AvatarFrameMap;
    /** v1 兼容清单可以没有跑步帧，此时游戏自动复用行走帧。 */
    run?: AvatarFrameMap;
};

const STORAGE_KEY = 'mingzhongdu.avatar.profile.v2';
const LEGACY_STORAGE_KEY = 'mingzhongdu.avatar.profile.v1';
const DIRECTIONS: AvatarDirection[] = ['down', 'up', 'left', 'right'];
const frameCache = new Map<string, Promise<SpriteFrame>>();

type WxStorage = {
    getStorageSync?: (key: string) => unknown;
    setStorageSync?: (key: string, value: string) => void;
    removeStorageSync?: (key: string) => void;
};

function wxStorage(): WxStorage | null {
    return (globalThis as unknown as { wx?: WxStorage }).wx ?? null;
}

function readStorage(key: string): string | null {
    try {
        const wx = wxStorage();
        if (typeof wx?.getStorageSync === 'function') {
            const value = wx.getStorageSync(key);
            return typeof value === 'string' && value.length > 0 ? value : null;
        }
        return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
        return null;
    }
}

function writeStorage(key: string, value: string | null): void {
    try {
        const wx = wxStorage();
        if (value === null) {
            if (typeof wx?.removeStorageSync === 'function') wx.removeStorageSync(key);
            else globalThis.localStorage?.removeItem(key);
            return;
        }
        if (typeof wx?.setStorageSync === 'function') wx.setStorageSync(key, value);
        else globalThis.localStorage?.setItem(key, value);
    } catch (error) {
        console.warn('[AvatarProfileStore] 无法写入角色资料。', error);
    }
}

function isFrameMap(value: unknown, minimumFrames: number): value is AvatarFrameMap {
    if (!value || typeof value !== 'object') return false;
    const map = value as Partial<AvatarFrameMap>;
    return DIRECTIONS.every((direction) => Array.isArray(map[direction])
        && map[direction]!.length >= minimumFrames
        && map[direction]!.every((item) => typeof item === 'string' && item.length > 0));
}

export function validateAvatarManifest(value: unknown): value is AvatarManifest {
    if (!value || typeof value !== 'object') return false;
    const manifest = value as Partial<AvatarManifest>;
    const baseValid = (manifest.version === 1 || manifest.version === 2)
        && typeof manifest.avatarId === 'string'
        && manifest.avatarId.length > 0
        && typeof manifest.displayName === 'string'
        && typeof manifest.previewUrl === 'string'
        && manifest.previewUrl.length > 0
        && !!manifest.canvas
        && Number.isFinite(manifest.canvas.width)
        && Number.isFinite(manifest.canvas.height)
        && Number.isFinite(manifest.canvas.feetY)
        && manifest.canvas.width > 0
        && manifest.canvas.height > 0
        && manifest.canvas.feetY > 0
        && manifest.canvas.feetY <= manifest.canvas.height
        && !!manifest.idle
        && DIRECTIONS.every((direction) => typeof manifest.idle?.[direction] === 'string'
            && manifest.idle[direction].length > 0)
        && isFrameMap(manifest.walk, 4);
    if (!baseValid) return false;
    return manifest.version === 1 || isFrameMap(manifest.run, 4);
}

export function loadAvatarProfile(): AvatarManifest | null {
    const raw = readStorage(STORAGE_KEY) ?? readStorage(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!validateAvatarManifest(parsed)) return null;
        const migrated = migrateLegacyStaticPreset(parsed);
        if (!readStorage(STORAGE_KEY) || migrated !== parsed) {
            writeStorage(STORAGE_KEY, JSON.stringify(migrated));
        }
        return migrated;
    } catch {
        return null;
    }
}

function migrateLegacyStaticPreset(profile: AvatarManifest): AvatarManifest {
    const legacyPath = profile.previewUrl.startsWith('resource://characters/default-presets/')
        ? profile.previewUrl.slice('resource://characters/default-presets/'.length)
        : '';
    const root = legacyPath.startsWith('preset-red')
        ? 'characters/vermillion-explorer'
        : legacyPath.startsWith('preset-green')
            ? 'characters/jade-explorer'
            : legacyPath.startsWith('preset-blue')
                ? 'characters/modern-explorer'
                : '';
    if (!root) return profile;
    return createPackagedAnimatedPresetManifest(root, profile.displayName, profile.provider ?? 'packaged-preset');
}

export function saveAvatarProfile(profile: AvatarManifest): void {
    if (!validateAvatarManifest(profile)) {
        throw new Error('角色服务返回的动画资源清单不完整。');
    }
    writeStorage(STORAGE_KEY, JSON.stringify(profile));
}

export function clearAvatarProfile(): void {
    writeStorage(STORAGE_KEY, null);
    writeStorage(LEGACY_STORAGE_KEY, null);
    frameCache.clear();
}

export function createPackagedPresetManifest(
    resourcePath: string,
    displayName: string,
    provider = 'packaged-preset',
): AvatarManifest {
    const locator = `resource://${resourcePath}`;
    const repeated = (): string[] => Array.from({ length: 8 }, () => locator);
    return {
        version: 2,
        avatarId: `${provider}-${resourcePath.split('/').slice(-2, -1)[0] ?? 'avatar'}`,
        displayName,
        createdAt: new Date().toISOString(),
        provider,
        stylePreset: 'ming-zhongdu-traveler',
        canvas: { width: 384, height: 512, feetY: 480 },
        previewUrl: locator,
        idle: { down: locator, up: locator, left: locator, right: locator },
        walk: { down: repeated(), up: repeated(), left: repeated(), right: repeated() },
        run: { down: repeated(), up: repeated(), left: repeated(), right: repeated() },
    };
}

/** 为随包角色创建四方向待机、行走、奔跑的完整动画清单。 */
export function createPackagedAnimatedPresetManifest(
    resourceRoot: string,
    displayName: string,
    provider = 'packaged-animated-preset',
): AvatarManifest {
    const locator = (path: string): string => `resource://${resourceRoot}/${path}/spriteFrame`;
    const sequence = (state: 'walk' | 'run', direction: AvatarDirection): string[] => (
        Array.from({ length: 8 }, (_, index) => {
            const frameNumber = index < 10 ? `0${index}` : String(index);
            return locator(`${state}/${direction}/${direction}-${frameNumber}`);
        })
    );
    const idleNames: Record<AvatarDirection, string> = {
        down: 'down-idle-v2',
        up: 'up-idle-v2',
        left: 'left-idle',
        right: 'right-idle',
    };
    const idle = {} as Record<AvatarDirection, string>;
    const walk = {} as AvatarFrameMap;
    const run = {} as AvatarFrameMap;
    DIRECTIONS.forEach((direction) => {
        idle[direction] = locator(`idle/${idleNames[direction]}`);
        walk[direction] = sequence('walk', direction);
        run[direction] = sequence('run', direction);
    });
    return {
        version: 2,
        avatarId: `${provider}-${resourceRoot.split('/').slice(-1)[0] ?? 'avatar'}`,
        displayName,
        createdAt: new Date().toISOString(),
        provider,
        stylePreset: 'ming-zhongdu-traveler',
        canvas: { width: 384, height: 512, feetY: 480 },
        previewUrl: locator('idle/down-idle-v2'),
        idle,
        walk,
        run,
    };
}

/** 加载清单中的打包资源或远程透明 PNG，并在本次运行期间复用缓存。 */
export function loadAvatarFrame(locator: string): Promise<SpriteFrame> {
    const cached = frameCache.get(locator);
    if (cached) return cached;

    const promise = locator.startsWith('resource://')
        ? loadPackagedFrame(locator.slice('resource://'.length))
        : loadRemoteFrame(locator);
    frameCache.set(locator, promise);
    promise.catch(() => frameCache.delete(locator));
    return promise;
}

function loadPackagedFrame(path: string): Promise<SpriteFrame> {
    return new Promise((resolve, reject) => {
        resources.load(path, SpriteFrame, (error, frame) => {
            if (error || !frame) reject(error ?? new Error(`无法加载角色资源：${path}`));
            else resolve(frame);
        });
    });
}

function loadRemoteFrame(url: string): Promise<SpriteFrame> {
    return new Promise((resolve, reject) => {
        assetManager.loadRemote<ImageAsset>(url, { ext: '.png' }, (error, image) => {
            if (error || !image) {
                reject(error ?? new Error(`无法下载角色帧：${url}`));
                return;
            }
            const texture = new Texture2D();
            texture.image = image;
            const frame = new SpriteFrame();
            frame.texture = texture;
            resolve(frame);
        });
    });
}
