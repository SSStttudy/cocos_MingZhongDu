import { Size, Vec2 } from 'cc';

export type LocationPolygon = {
    id: string;
    points: Vec2[];
};

export type LocationTransition = {
    id: string;
    title: string;
    polygon: Vec2[];
    targetSceneId?: string;
    targetSpawnId?: string;
    targetSpawn?: Vec2;
    overworldEntryId?: string;
};

export type LocationSpawn = {
    id: string;
    position: Vec2;
};

export type PerspectiveSceneConfig = {
    id: string;
    title: string;
    backgroundAsset: string;
    worldSize: Size;
    playerStart: Vec2;
    spawns: LocationSpawn[];
    walkAreas: Vec2[][];
    obstacles: LocationPolygon[];
    transitions: LocationTransition[];
    farY: number;
    nearY: number;
    farScale: number;
    nearScale: number;
    perspective?: {
        nearY: number;
        nearVisualHeight: number;
        horizonY: number;
        /** Above this world Y, keep the character at the boundary scale. */
        keepY?: number;
    };
};

export type LocationSceneConfig = {
    id: string;
    title: string;
    initialSceneId: string;
    scenes: Record<string, PerspectiveSceneConfig>;
};

const WORLD_SIZE = new Size(1365, 1024);
const DEFAULT_WALK_AREA = [[
    new Vec2(-650, -495),
    new Vec2(650, -495),
    new Vec2(610, -90),
    new Vec2(-610, -90),
]];

function createPhotoScene(
    id: string,
    title: string,
    spawnIds: string[],
    playerStart = new Vec2(0, -330),
): PerspectiveSceneConfig {
    return {
        id,
        title,
        backgroundAsset: id,
        worldSize: WORLD_SIZE,
        playerStart,
        spawns: spawnIds.map((spawnId) => ({ id: spawnId, position: playerStart.clone() })),
        walkAreas: DEFAULT_WALK_AREA.map((area) => area.map((point) => point.clone())),
        obstacles: [],
        transitions: [],
        farY: -70,
        nearY: -485,
        farScale: 0.48,
        nearScale: 1,
    };
}

export const LOCATION_CONFIGS: Record<string, LocationSceneConfig> = {
    'visitor-center': {
        id: 'visitor-center',
        title: '游客中心',
        initialSceneId: 'entrance-gate',
        scenes: {
            'entrance-gate': createPhotoScene('entrance-gate', '游客中心 · 入口桥', ['spawn-road']),
            'main-road': createPhotoScene('main-road', '游客中心 · 中轴道路', [
                'spawn-gate',
                'spawn-cafe',
                'spawn-visitor',
            ]),
            'cafe-garden': createPhotoScene('cafe-garden', '游客中心 · 咖啡庭院', [
                'spawn-road',
                'spawn-leisure',
            ]),
            'leisure-plaza': createPhotoScene('leisure-plaza', '游客中心 · 休闲广场', [
                'spawn-cafe',
                'spawn-visitor',
            ]),
            'visitor-building': createPhotoScene('visitor-building', '游客中心 · 展馆外院', [
                'spawn-leisure',
                'spawn-exterior',
                'spawn-road',
            ]),
            exterior: {
                id: 'exterior',
                title: '游客中心 · 王英雕像院落',
                backgroundAsset: 'exterior',
                worldSize: WORLD_SIZE,
                playerStart: new Vec2(360, -330),
                spawns: [
                    { id: 'spawn-visitor', position: new Vec2(360, -330) },
                    { id: 'spawn-interior', position: new Vec2(-500, -165) },
                ],
                // 对应院落地砖区域；照片上方建筑与草地不允许穿行。
                walkAreas: [[
                    new Vec2(-650, -485),
                    new Vec2(650, -485),
                    new Vec2(590, -185),
                    new Vec2(480, -55),
                    new Vec2(270, -45),
                    new Vec2(60, -75),
                    new Vec2(-165, -65),
                    new Vec2(-405, -45),
                    new Vec2(-610, -105),
                ]],
                obstacles: [
                    {
                        id: 'wang-ying-statue',
                        points: [
                            new Vec2(-620, -115),
                            new Vec2(-395, -115),
                            new Vec2(-405, 65),
                            new Vec2(-600, 85),
                        ],
                    },
                    {
                        id: 'tree-lawn',
                        points: [
                            new Vec2(40, -180),
                            new Vec2(365, -190),
                            new Vec2(335, 45),
                            new Vec2(125, 70),
                        ],
                    },
                ],
                transitions: [
                    {
                        id: 'to-interior',
                        title: '进入雕像左侧展厅',
                        polygon: [
                            new Vec2(-650, -180),
                            new Vec2(-535, -180),
                            new Vec2(-535, -125),
                            new Vec2(-650, -125),
                        ],
                        targetSceneId: 'interior',
                        targetSpawnId: 'spawn-exterior',
                        targetSpawn: new Vec2(455, -185),
                    },
                    {
                        id: 'to-overworld',
                        title: '返回大地图',
                        polygon: [
                            new Vec2(180, -500),
                            new Vec2(550, -500),
                            new Vec2(550, -430),
                            new Vec2(180, -430),
                        ],
                        overworldEntryId: 'location-1-east-01',
                    },
                ],
                farY: -70,
                nearY: -470,
                farScale: 0.48,
                nearScale: 1,
            },
            interior: {
                id: 'interior',
                title: '游客中心 · 室内展厅',
                backgroundAsset: 'interior',
                worldSize: WORLD_SIZE,
                playerStart: new Vec2(455, -185),
                spawns: [{ id: 'spawn-exterior', position: new Vec2(455, -185) }],
                // 室内地面形成梯形透视，中央沙盘单独作为障碍。
                walkAreas: [[
                    new Vec2(-650, -495),
                    new Vec2(650, -495),
                    new Vec2(620, -90),
                    new Vec2(315, 35),
                    new Vec2(-285, 25),
                    new Vec2(-610, -115),
                ]],
                obstacles: [
                    {
                        id: 'central-model',
                        points: [
                            new Vec2(-535, -115),
                            new Vec2(145, -95),
                            new Vec2(145, -395),
                            new Vec2(-390, -455),
                        ],
                    },
                ],
                transitions: [
                    {
                        id: 'to-exterior',
                        title: '返回雕像院落',
                        polygon: [
                            new Vec2(500, -250),
                            new Vec2(650, -250),
                            new Vec2(650, -80),
                            new Vec2(520, -85),
                        ],
                        targetSceneId: 'exterior',
                        targetSpawnId: 'spawn-interior',
                        targetSpawn: new Vec2(-500, -165),
                    },
                ],
                farY: 20,
                nearY: -485,
                farScale: 0.46,
                nearScale: 1,
            },
        },
    },
};

function createRemainingPhotoScene(
    id: string,
    title: string,
    spawnIds: string[],
    worldWidth = 1365,
): PerspectiveSceneConfig {
    const worldSize = new Size(worldWidth, 1024);
    const halfWidth = worldWidth * 0.5;
    const playerStart = new Vec2(0, -340);
    return {
        id,
        title,
        backgroundAsset: id,
        worldSize,
        playerStart,
        spawns: spawnIds.map((spawnId) => ({
            id: spawnId,
            position: playerStart.clone(),
        })),
        // regions.json contains the photo-specific first-pass polygons. This
        // fallback keeps a scene usable while the editor asset is refreshing.
        walkAreas: [[
            new Vec2(-halfWidth, -500),
            new Vec2(halfWidth, -500),
            new Vec2(halfWidth * 0.82, -20),
            new Vec2(-halfWidth * 0.82, -20),
        ]],
        obstacles: [],
        transitions: [],
        farY: -20,
        nearY: -490,
        farScale: 0.34,
        nearScale: 1,
        perspective: {
            nearY: -490,
            nearVisualHeight: 400,
            horizonY: 105,
        },
    };
}

Object.assign(LOCATION_CONFIGS, {
    'location-2': {
        id: 'location-2',
        title: '石础遗址',
        initialSceneId: '1',
        scenes: {
            '1': createRemainingPhotoScene('1', '石础遗址 · 分镜 1', [
                'spawn-from-2',
                'spawn-overworld-north-01',
                'spawn-overworld-north-02',
            ]),
            '2': createRemainingPhotoScene('2', '石础遗址 · 分镜 2', ['spawn-from-1']),
            '3': createRemainingPhotoScene('3', '石础遗址 · 分镜 3', [
                'spawn-from-4',
                'spawn-overworld-east-01',
                'spawn-overworld-east-02',
            ]),
            '4': createRemainingPhotoScene('4', '石础遗址 · 分镜 4', [
                'spawn-from-3',
                'spawn-from-4-5',
            ]),
            '4-5': createRemainingPhotoScene('4-5', '石础遗址 · 分镜 4.5', [
                'spawn-from-4',
                'spawn-from-5',
                'spawn-from-6',
            ]),
            '5': createRemainingPhotoScene('5', '石础遗址 · 分镜 5', ['spawn-from-4-5']),
            '6': createRemainingPhotoScene('6', '石础遗址 · 分镜 6', ['spawn-from-4-5']),
        },
    },
    'location-2-5': {
        id: 'location-2-5',
        title: '古井遗址',
        initialSceneId: '1',
        scenes: {
            '1': createRemainingPhotoScene('1', '古井遗址 · 分镜 1', [
                'spawn-from-2',
                'spawn-overworld-west-01',
                'spawn-overworld-east-01',
            ]),
            '2': createRemainingPhotoScene('2', '古井遗址 · 分镜 2', ['spawn-from-1']),
        },
    },
    'location-3': {
        id: 'location-3',
        title: '午门遗址',
        initialSceneId: '1',
        scenes: {
            '1': createRemainingPhotoScene('1', '午门遗址 · 分镜 1', [
                'spawn-from-2',
                'spawn-overworld-north-01',
            ]),
            '2': createRemainingPhotoScene('2', '午门遗址 · 分镜 2', ['spawn-from-1', 'spawn-from-3']),
            '3': createRemainingPhotoScene('3', '午门遗址 · 分镜 3', ['spawn-from-2', 'spawn-from-4']),
            '4': createRemainingPhotoScene('4', '午门遗址 · 分镜 4', ['spawn-from-3', 'spawn-from-5']),
            '5': createRemainingPhotoScene('5', '午门遗址 · 分镜 5', ['spawn-from-4', 'spawn-from-6']),
            '6': createRemainingPhotoScene('6', '午门遗址 · 宽幅分镜 6', ['spawn-from-5', 'spawn-from-7'], 2464),
            '7': createRemainingPhotoScene('7', '午门遗址 · 分镜 7', ['spawn-from-6', 'spawn-from-8']),
            '8': createRemainingPhotoScene('8', '午门遗址 · 分镜 8', ['spawn-from-7']),
        },
    },
    'location-4': {
        id: 'location-4',
        title: '西门遗址',
        initialSceneId: 'main',
        scenes: {
            main: createRemainingPhotoScene('main', '西门遗址 · 全景', [
                'spawn-overworld-west-01',
                'spawn-overworld-east-01',
            ], 2208),
        },
    },
} satisfies Record<string, LocationSceneConfig>);

export function getLocationConfig(id: string): LocationSceneConfig {
    return LOCATION_CONFIGS[id] ?? LOCATION_CONFIGS['visitor-center'];
}
