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

export function getLocationConfig(id: string): LocationSceneConfig {
    return LOCATION_CONFIGS[id] ?? LOCATION_CONFIGS['visitor-center'];
}
