export type TourStepKind = 'overworld-entrance' | 'location-region' | 'return-overworld';

export type TourResumeAnchor =
    | { kind: 'overworld'; entryId: string }
    | { kind: 'location'; locationId: string; sceneId: string; spawnId: string };

export type TourStep = {
    id: string;
    kind: TourStepKind;
    title: string;
    objective: string;
    speech: string;
    knowledgeText?: string;
    entranceId?: string;
    entryPointId?: string;
    locationId?: string;
    sceneId?: string;
    regionId?: string;
    proximity?: number;
    targetKind?: 'location' | 'interaction';
    completionMode?: 'proximity' | 'action';
    overworldEntryId?: string;
    resumeAfter: TourResumeAnchor;
};

export const TOUR_STEPS: TourStep[] = [
    {
        id: 'visitor-center-enter', kind: 'overworld-entrance', title: '游客中心',
        objective: '沿路标前往游客中心',
        speech: '咱带你沿着中都城的脉络走一趟。先去游客中心。',
        entranceId: 'location-1', entryPointId: 'location-1-west-01',
        resumeAfter: { kind: 'location', locationId: 'visitor-center', sceneId: 'exterior', spawnId: 'spawn-visitor' },
    },
    {
        id: 'visitor-center-wang', kind: 'location-region', title: '王剑英雕像',
        objective: '走近外院的王剑英雕像并查看',
        speech: '先在王剑英雕像前停一停。',
        knowledgeText: '王剑英长期参与明中都遗址保护与研究。看完雕像，再进展厅从沙盘认识城址整体格局。',
        locationId: 'visitor-center', sceneId: 'exterior', regionId: 'obstacle-wang',
        proximity: 68, targetKind: 'interaction', completionMode: 'action',
        resumeAfter: { kind: 'location', locationId: 'visitor-center', sceneId: 'exterior', spawnId: 'spawn-visitor' },
    },
    {
        id: 'visitor-center-map', kind: 'location-region', title: '明中都沙盘',
        objective: '进入展厅，走近中央沙盘并查看',
        speech: '从沙盘看清中都城的整体格局。',
        knowledgeText: '沙盘把宫城、皇城和城垣放回同一空间关系中。接下来回到遗址，沿着西侧城垣继续游览。',
        locationId: 'visitor-center', sceneId: 'interior', regionId: 'obstacle-map',
        proximity: 72, targetKind: 'interaction', completionMode: 'action',
        resumeAfter: { kind: 'location', locationId: 'visitor-center', sceneId: 'interior', spawnId: 'spawn-exterior' },
    },
    {
        id: 'visitor-center-return', kind: 'return-overworld', title: '返回城址',
        objective: '经主路东侧出口返回大地图',
        speech: '游客中心看完了。咱们回到城址，下一站去西侧城垣。',
        locationId: 'visitor-center', overworldEntryId: 'location-1-east-01',
        resumeAfter: { kind: 'overworld', entryId: 'location-1-east-01' },
    },
    {
        id: 'west-gate-enter', kind: 'overworld-entrance', title: '西侧城垣',
        objective: '沿道路前往西侧城垣入口',
        speech: '先从西侧入口进入，看看城垣遗存。',
        entranceId: 'location-4', entryPointId: 'location-4-west-01',
        resumeAfter: { kind: 'location', locationId: 'location-4', sceneId: 'main', spawnId: 'spawn-overworld-west-01' },
    },
    {
        id: 'west-gate-observe', kind: 'location-region', title: '西侧城垣',
        objective: '沿步道靠近城垣并查看',
        speech: '顺着城垣看一看它与道路的关系。',
        knowledgeText: '今天能看到的遗存只是都城空间的一部分。沿着城垣辨认方向，是理解明中都尺度的第一步。',
        locationId: 'location-4', sceneId: 'main', regionId: 'interaction-west-gate',
        proximity: 90, targetKind: 'interaction', completionMode: 'action',
        resumeAfter: { kind: 'location', locationId: 'location-4', sceneId: 'main', spawnId: 'spawn-overworld-west-01' },
    },
    {
        id: 'west-gate-return', kind: 'return-overworld', title: '前往石础',
        objective: '从东侧出口返回大地图',
        speech: '城垣看过了，从东侧出去，下一站去看石础。',
        locationId: 'location-4', overworldEntryId: 'location-4-east-01',
        resumeAfter: { kind: 'overworld', entryId: 'location-4-east-01' },
    },
    {
        id: 'stone-base-enter', kind: 'overworld-entrance', title: '石础遗存',
        objective: '沿道路前往石础北侧入口',
        speech: '前面的石础，留下了建筑柱网的线索。',
        entranceId: 'location-2', entryPointId: 'location-2-north-01',
        resumeAfter: { kind: 'location', locationId: 'location-2', sceneId: '1', spawnId: 'spawn-overworld-north-01' },
    },
    {
        id: 'stone-base-observe', kind: 'location-region', title: '石础遗存',
        objective: '进入分镜 2，靠近石础并查看',
        speech: '走近些，看看这些石础的位置。',
        knowledgeText: '石础承托木柱。成组分布的石础能帮助我们判断曾经的柱网、开间与建筑尺度。',
        locationId: 'location-2', sceneId: '2', regionId: 'interaction-stone-base',
        proximity: 74, targetKind: 'interaction', completionMode: 'action',
        resumeAfter: { kind: 'location', locationId: 'location-2', sceneId: '2', spawnId: 'spawn-from-1' },
    },
    {
        id: 'stone-base-return', kind: 'return-overworld', title: '前往古井',
        objective: '原路返回北侧入口',
        speech: '石础看完了，原路返回，接着去古井。',
        locationId: 'location-2', overworldEntryId: 'location-2-north-01',
        resumeAfter: { kind: 'overworld', entryId: 'location-2-north-01' },
    },
    {
        id: 'ancient-well-enter', kind: 'overworld-entrance', title: '古井',
        objective: '沿道路前往古井西侧入口',
        speech: '下一站是古井，从西侧入口进去。',
        entranceId: 'location-2-5', entryPointId: 'location-2-5-west-01',
        resumeAfter: { kind: 'location', locationId: 'location-2-5', sceneId: '1', spawnId: 'spawn-overworld-west-01' },
    },
    {
        id: 'ancient-well-observe', kind: 'location-region', title: '古井',
        objective: '进入分镜 2，靠近井址并查看',
        speech: '到井边停一停，看看生活如何留在城址里。',
        knowledgeText: '井址把宏大的都城叙事拉回日常生活。它提示我们，这里不仅有宫阙和城门，也有人群长期活动的痕迹。',
        locationId: 'location-2-5', sceneId: '2', regionId: 'interaction-ancient-well',
        proximity: 72, targetKind: 'interaction', completionMode: 'action',
        resumeAfter: { kind: 'location', locationId: 'location-2-5', sceneId: '2', spawnId: 'spawn-from-1' },
    },
    {
        id: 'ancient-well-return', kind: 'return-overworld', title: '前往午门',
        objective: '原路返回西侧入口',
        speech: '古井看完了。返回主路，最后去午门。',
        locationId: 'location-2-5', overworldEntryId: 'location-2-5-west-01',
        resumeAfter: { kind: 'overworld', entryId: 'location-2-5-west-01' },
    },
    {
        id: 'wumen-enter', kind: 'overworld-entrance', title: '午门',
        objective: '沿道路前往午门北侧入口',
        speech: '午门在前面。这一站要穿过门洞，再登上城台。',
        entranceId: 'location-3', entryPointId: 'location-3-north-01',
        resumeAfter: { kind: 'location', locationId: 'location-3', sceneId: '1', spawnId: 'spawn-overworld-north-01' },
    },
    {
        id: 'wumen-passage', kind: 'location-region', title: '午门门洞',
        objective: '依次前行至分镜 5，查看门洞',
        speech: '穿过门洞时，留意城门空间的纵深。',
        knowledgeText: '门洞把城内外的道路、门制与防御空间连接起来。继续前行，从更高处观察午门与城址。',
        locationId: 'location-3', sceneId: '5', regionId: 'interaction-wumen-passage',
        proximity: 82, targetKind: 'interaction', completionMode: 'action',
        resumeAfter: { kind: 'location', locationId: 'location-3', sceneId: '5', spawnId: 'spawn-from-4' },
    },
    {
        id: 'wumen-platform', kind: 'location-region', title: '午门城台',
        objective: '继续前行至分镜 8，抵达城台观察点',
        speech: '登临城台，这条从遗迹认识都城的主线就走完了。',
        knowledgeText: '从城台回望，城门、道路、城垣与前面看到的建筑遗迹被重新联系起来。主线完成，接下来可以自由探索。',
        locationId: 'location-3', sceneId: '8', regionId: 'location-wumen-platform',
        proximity: 58, targetKind: 'location', completionMode: 'proximity',
        resumeAfter: { kind: 'location', locationId: 'location-3', sceneId: '8', spawnId: 'spawn-from-7' },
    },
];

export function getTourStep(id: string): TourStep | null {
    return TOUR_STEPS.find((step) => step.id === id) ?? null;
}

export function getNextTourStep(completed: ReadonlySet<string>): TourStep | null {
    return TOUR_STEPS.find((step) => !completed.has(step.id)) ?? null;
}

export function getStepForEntrance(entranceId: string, entryPointId?: string): TourStep | null {
    return TOUR_STEPS.find((step) => (
        step.kind === 'overworld-entrance'
        && step.entranceId === entranceId
        && (!entryPointId || !step.entryPointId || step.entryPointId === entryPointId)
    )) ?? null;
}

export function getLocationCocosSceneName(locationId: string): string {
    return ({
        'visitor-center': 'LocationTemplate',
        'location-2': 'Location2',
        'location-2-5': 'Location2_5',
        'location-3': 'Location3',
        'location-4': 'Location4',
    } as Record<string, string>)[locationId] ?? 'LocationTemplate';
}
