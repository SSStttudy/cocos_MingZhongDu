import { readFile } from 'node:fs/promises';

const DIRECTIONS = ['down', 'up', 'left', 'right'];

function repeated(locator) {
  return Array.from({ length: 8 }, () => locator);
}

function demoManifest(stylePreset) {
  const presetByStyle = {
    'ming-zhongdu-traveler': 'preset-blue',
    'ming-zhongdu-guard': 'preset-red',
    'ming-zhongdu-scholar': 'preset-green',
  };
  const preset = presetByStyle[stylePreset] ?? 'preset-blue';
  const locator = `resource://characters/default-presets/${preset}/spriteFrame`;
  return {
    version: 2,
    avatarId: `mock-${crypto.randomUUID()}`,
    displayName: 'AI 演示角色',
    createdAt: new Date().toISOString(),
    provider: 'mock-server',
    stylePreset,
    canvas: { width: 384, height: 512, feetY: 480 },
    previewUrl: locator,
    idle: Object.fromEntries(DIRECTIONS.map((direction) => [direction, locator])),
    walk: Object.fromEntries(DIRECTIONS.map((direction) => [direction, repeated(locator)])),
    run: Object.fromEntries(DIRECTIONS.map((direction) => [direction, repeated(locator)])),
  };
}

export class MockAvatarProvider {
  async generate({ stylePreset, onProgress }) {
    onProgress(25, '正在分析人物比例与服装轮廓');
    await new Promise((resolve) => setTimeout(resolve, 600));
    onProgress(60, '正在生成明中都主题四方向造型');
    await new Promise((resolve) => setTimeout(resolve, 800));
    onProgress(88, '正在整理待机、行走与奔跑动画');
    await new Promise((resolve) => setTimeout(resolve, 650));
    return demoManifest(stylePreset);
  }
}

/**
 * 对接商业 API、自建 ComfyUI 或工作室内部生成服务的适配器。
 * 上游只需接收一张照片，并返回 docs/AI_AVATAR_SETUP.md 定义的 v2 manifest。
 */
export class HttpManifestAvatarProvider {
  constructor({ baseUrl, apiKey }) {
    if (!baseUrl) throw new Error('缺少 AVATAR_PROVIDER_URL。');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  async generate({ photoPath, mimeType, displayName, stylePreset, onProgress }) {
    onProgress(15, '已收到照片，正在提交生成流水线');
    const photo = await readFile(photoPath);
    const form = new FormData();
    form.append('photo', new Blob([photo], { type: mimeType }), 'full-body-photo');
    form.append('displayName', displayName);
    form.append('stylePreset', stylePreset);
    form.append('manifestVersion', '2');
    const response = await fetch(`${this.baseUrl}/generate`, {
      method: 'POST',
      headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
      body: form,
    });
    if (!response.ok) throw new Error(`上游生成服务失败（HTTP ${response.status}）。`);
    const manifest = await response.json();
    onProgress(95, '动画资源已生成，正在校验清单');
    return manifest;
  }
}

export function createProvider(env) {
  if ((env.AVATAR_PROVIDER ?? 'mock') === 'http-manifest') {
    return new HttpManifestAvatarProvider({
      baseUrl: env.AVATAR_PROVIDER_URL,
      apiKey: env.AVATAR_PROVIDER_API_KEY,
    });
  }
  return new MockAvatarProvider();
}
