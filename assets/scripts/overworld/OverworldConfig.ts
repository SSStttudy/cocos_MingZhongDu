import { Rect, Size, Vec2 } from 'cc';

export type OverworldEntrance = {
    id: string;
    title: string;
    normalizedPosition: Vec2;
    triggerRadius: number;
    accent: string;
};

export type OverworldRoutePoint = {
    id: string;
    position: Vec2;
};

export type OverworldRouteEdge = {
    id: string;
    from: string;
    to: string;
    halfWidth: number;
};

export type OverworldRouteSegment = {
    id: string;
    start: Vec2;
    end: Vec2;
    halfWidth: number;
};

export const OVERWORLD_MAP_SIZE = new Size(2200, 1272);
export const OVERWORLD_PLAYER_START = new Vec2(-720, -65);

// 障碍使用地图中心为原点的世界坐标。后续每个地图模板只需修改此数组。
// 第一版先保证整张大地图可自由测试，水系与建筑碰撞待路线确认后再精修。
export const OVERWORLD_OBSTACLES: Rect[] = [];

// 路线先标记拐点和交叉点，再由 OVERWORLD_ROUTE_EDGES 连线。
// RoutePoint 节点会在 Creator 的 MapCalibration/RoutePoints 下显示，可直接拖动。
export const OVERWORLD_ROUTE_POINTS: OverworldRoutePoint[] = [
    { id: 'west-start', position: new Vec2(-736.638, -185.983) },
    { id: 'west-junction', position: new Vec2(-299.093, -185.983) },
    { id: 'northwest-corner', position: new Vec2(-299.093, 400.362) },
    { id: 'northeast-corner', position: new Vec2(-88.88, 400.362) },
    { id: 'west-upper-cross', position: new Vec2(-299.093, 222.506) },
    { id: 'east-upper-cross', position: new Vec2(-88.88, 222.506) },
    { id: 'west-lower-cross', position: new Vec2(-299.093, -23.886) },
    { id: 'east-lower-cross', position: new Vec2(-88.88, -23.886) },
    { id: 'east-turn', position: new Vec2(-88.88, -120.259) },
    { id: 'diagonal-mid', position: new Vec2(-206.34, -185.983) },
    { id: 'well-west', position: new Vec2(-206.34, -252.355) },
    { id: 'well-east', position: new Vec2(-118.979, -252.355) },
    { id: 'south-turn', position: new Vec2(-118.979, -307.013) },
    { id: 'south-corner', position: new Vec2(-118.979, -346.565) },
    { id: 'wumen-road', position: new Vec2(-6.997, -346.565) },
];

// halfWidth 控制玩家中心偏离道路中心线的最大幅度；按最新反馈收窄到 8~9。
export const OVERWORLD_ROUTE_EDGES: OverworldRouteEdge[] = [
    { id: 'west-main-a', from: 'west-start', to: 'west-junction', halfWidth: 9 },
    { id: 'west-to-diagonal', from: 'west-junction', to: 'diagonal-mid', halfWidth: 8 },
    { id: 'west-north-a', from: 'west-junction', to: 'west-lower-cross', halfWidth: 8 },
    { id: 'west-north-b', from: 'west-lower-cross', to: 'west-upper-cross', halfWidth: 8 },
    { id: 'west-north-c', from: 'west-upper-cross', to: 'northwest-corner', halfWidth: 8 },
    { id: 'north-edge', from: 'northwest-corner', to: 'northeast-corner', halfWidth: 8 },
    { id: 'east-north-a', from: 'northeast-corner', to: 'east-upper-cross', halfWidth: 8 },
    { id: 'east-north-b', from: 'east-upper-cross', to: 'east-lower-cross', halfWidth: 8 },
    { id: 'east-north-c', from: 'east-lower-cross', to: 'east-turn', halfWidth: 8 },
    { id: 'site-upper-cross', from: 'west-upper-cross', to: 'east-upper-cross', halfWidth: 8 },
    { id: 'site-lower-cross', from: 'west-lower-cross', to: 'east-lower-cross', halfWidth: 8 },
    { id: 'well-diagonal-a', from: 'east-turn', to: 'diagonal-mid', halfWidth: 8 },
    { id: 'well-diagonal-b', from: 'diagonal-mid', to: 'well-west', halfWidth: 8 },
    { id: 'well-cross', from: 'well-west', to: 'well-east', halfWidth: 9 },
    { id: 'well-south-a', from: 'well-east', to: 'south-turn', halfWidth: 9 },
    { id: 'well-south-b', from: 'south-turn', to: 'south-corner', halfWidth: 9 },
    { id: 'south-to-wumen', from: 'south-corner', to: 'wumen-road', halfWidth: 9 },
];

// normalizedPosition：左上为 (0, 0)，右下为 (1, 1)。
export const OVERWORLD_ENTRANCES: OverworldEntrance[] = [
    { id: 'location-1', title: '地点 1 · 西侧入口', normalizedPosition: new Vec2(0.13, 0.58), triggerRadius: 72, accent: '#d77a4a' },
    { id: 'location-4', title: '地点 4 · 西门', normalizedPosition: new Vec2(0.335, 0.585), triggerRadius: 72, accent: '#d5a33f' },
    { id: 'location-2', title: '地点 2 · 北部遗址', normalizedPosition: new Vec2(0.43, 0.26), triggerRadius: 72, accent: '#758f50' },
    { id: 'location-2-5', title: '地点 2.5 · 中部节点', normalizedPosition: new Vec2(0.49, 0.60), triggerRadius: 72, accent: '#4d8790' },
    { id: 'location-3', title: '地点 3 · 南门', normalizedPosition: new Vec2(0.57, 0.77), triggerRadius: 72, accent: '#9b6754' },
];
