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
    actionHint?: string;
    tutorialId?: string;
    overworldEntryId?: string;
    resumeAfter: TourResumeAnchor;
};

export type TourNarrationPoint = {
    id: string;
    locationId: string;
    sceneId: string;
    regionId: string;
    speech: string;
    proximity?: number;
    priority?: number;
};

export const TOUR_STEPS: TourStep[] = [
    {
        id: 'visitor-center-enter', kind: 'overworld-entrance', title: '循路识中都',
        objective: '沿路标前往游客中心，先看清整座城址',
        speech: '这片城址很大，咱先去游客中心看清全貌。',
        entranceId: 'location-1', entryPointId: 'location-1-west-01',
        resumeAfter: { kind: 'location', locationId: 'visitor-center', sceneId: 'exterior', spawnId: 'spawn-visitor' },
    },
    {
        id: 'visitor-center-wang', kind: 'location-region', title: '历史的发掘者',
        objective: '前往外院，靠近王剑英雕像并点击查看',
        speech: '城址沉默了很久，先认识让它重新进入公众视野的研究者。',
        actionHint: '已经靠近了，点击右下角“查看”试试。',
        tutorialId: 'interaction-button',
        knowledgeText: '王剑英长期开展明中都田野调查与研究，为辨识遗址范围、梳理城址格局和推动保护工作提供了重要基础。雕像记录的不只是一个人，也是一代研究者重新认识明中都的过程。',
        locationId: 'visitor-center', sceneId: 'exterior', regionId: 'obstacle-wang',
        proximity: 68, targetKind: 'interaction', completionMode: 'action',
        resumeAfter: { kind: 'location', locationId: 'visitor-center', sceneId: 'exterior', spawnId: 'spawn-visitor' },
    },
    {
        id: 'visitor-center-map', kind: 'location-region', title: '一城缩影',
        objective: '进入展厅，靠近中央沙盘并点击查看',
        speech: '先别急着记每座建筑，找出贯穿南北的那条主线。',
        actionHint: '沙盘就在眼前，点击“查看”认识城址格局。',
        tutorialId: 'interaction-button',
        knowledgeText: '明中都以南北中轴组织主要城门、桥梁、宫殿和苑囿，重要空间沿轴线层层展开。沙盘把宫城、皇城与外城重新放回同一空间关系中，便于理解遗址之间原本的联系。',
        locationId: 'visitor-center', sceneId: 'interior', regionId: 'obstacle-map',
        proximity: 72, targetKind: 'interaction', completionMode: 'action',
        resumeAfter: { kind: 'location', locationId: 'visitor-center', sceneId: 'interior', spawnId: 'spawn-exterior' },
    },
    {
        id: 'visitor-center-return', kind: 'return-overworld', title: '从全貌回到遗址',
        objective: '经主路东侧出口返回大地图',
        speech: '游客中心看完了。咱们回到城址，下一站去西侧城垣。',
        locationId: 'visitor-center', overworldEntryId: 'location-1-east-01',
        resumeAfter: { kind: 'overworld', entryId: 'location-1-east-01' },
    },
    {
        id: 'west-gate-enter', kind: 'overworld-entrance', title: '越过都城边界',
        objective: '沿道路前往西侧城垣入口',
        speech: '先从西侧入口进入，看看城垣遗存。',
        entranceId: 'location-4', entryPointId: 'location-4-west-01',
        resumeAfter: { kind: 'location', locationId: 'location-4', sceneId: 'main', spawnId: 'spawn-overworld-west-01' },
    },
    {
        id: 'west-gate-observe', kind: 'location-region', title: '城垣留下的尺度',
        objective: '沿步道靠近西华门城垣，点击查看遗存',
        speech: '城墙划出都城的内外，顺着砖石看看这道边界。',
        actionHint: '靠近城垣后，点击“查看”读一读砖石留下的信息。',
        tutorialId: 'interaction-button',
        knowledgeText: '西华门位于明中都皇城西侧，现存门台及相连城墙仍能显示皇城边界与入口尺度。现有考古认识认为，门台建成后门楼可能未及完工，因此遗址也保留了工程停建阶段的信息。',
        locationId: 'location-4', sceneId: 'main', regionId: 'interaction-west-gate',
        proximity: 90, targetKind: 'interaction', completionMode: 'action',
        resumeAfter: { kind: 'location', locationId: 'location-4', sceneId: 'main', spawnId: 'spawn-overworld-west-01' },
    },
    {
        id: 'west-gate-return', kind: 'return-overworld', title: '向宫殿遗迹进发',
        objective: '从东侧出口返回大地图',
        speech: '城垣看过了，从东侧出去，下一站去看石础。',
        locationId: 'location-4', overworldEntryId: 'location-4-east-01',
        resumeAfter: { kind: 'overworld', entryId: 'location-4-east-01' },
    },
    {
        id: 'stone-base-enter', kind: 'overworld-entrance', title: '寻找宫殿的足迹',
        objective: '沿道路前往石础北侧入口',
        speech: '前面的石础，留下了建筑柱网的线索。',
        entranceId: 'location-2', entryPointId: 'location-2-north-01',
        resumeAfter: { kind: 'location', locationId: 'location-2', sceneId: '1', spawnId: 'spawn-overworld-north-01' },
    },
    {
        id: 'stone-base-observe', kind: 'location-region', title: '石头里的宫殿',
        objective: '进入分镜 2，靠近蟠龙石础并点击查看',
        speech: '殿宇不在了，柱子落脚的位置还在。',
        actionHint: '石础近在眼前，点击“查看”观察柱槽和蟠龙纹饰。',
        tutorialId: 'interaction-button',
        knowledgeText: '石础用于承托木柱，成组分布的位置能帮助考古工作者判断建筑柱网、开间和尺度。蟠龙、祥云等雕刻还反映出宫殿建筑的等级与装饰特征，是从地面遗存理解消失建筑的重要线索。',
        locationId: 'location-2', sceneId: '2', regionId: 'interaction-stone-base',
        proximity: 74, targetKind: 'interaction', completionMode: 'action',
        resumeAfter: { kind: 'location', locationId: 'location-2', sceneId: '2', spawnId: 'spawn-from-1' },
    },
    {
        id: 'stone-base-return', kind: 'return-overworld', title: '从宫殿走向日常',
        objective: '原路返回北侧入口',
        speech: '石础看完了，原路返回，接着去古井。',
        locationId: 'location-2', overworldEntryId: 'location-2-north-01',
        resumeAfter: { kind: 'overworld', entryId: 'location-2-north-01' },
    },
    {
        id: 'ancient-well-enter', kind: 'overworld-entrance', title: '寻找都城水脉',
        objective: '沿道路前往古井西侧入口',
        speech: '下一站是古井，从西侧入口进去。',
        entranceId: 'location-2-5', entryPointId: 'location-2-5-west-01',
        resumeAfter: { kind: 'location', locationId: 'location-2-5', sceneId: '1', spawnId: 'spawn-overworld-west-01' },
    },
    {
        id: 'ancient-well-observe', kind: 'location-region', title: '井边的人间烟火',
        objective: '进入分镜 2，在井外安全位置点击查看',
        speech: '都城不只有宫殿，水从哪里来也是生活能否运转的关键。',
        actionHint: '别踏进井区，在外围停下后点击“查看”。',
        tutorialId: 'interaction-button',
        knowledgeText: '井状遗存把宏大的都城叙事拉回日常生活。它提示人们，考古关注的不只是宫殿和城门，也包括供水、排水及日常使用空间。在取得更明确的考古材料前，不对其年代、深度和服务对象作确定判断。',
        locationId: 'location-2-5', sceneId: '2', regionId: 'interaction-ancient-well',
        proximity: 72, targetKind: 'interaction', completionMode: 'action',
        resumeAfter: { kind: 'location', locationId: 'location-2-5', sceneId: '2', spawnId: 'spawn-from-1' },
    },
    {
        id: 'ancient-well-return', kind: 'return-overworld', title: '向中轴正门进发',
        objective: '原路返回西侧入口',
        speech: '古井看完了。返回主路，最后去午门。',
        locationId: 'location-2-5', overworldEntryId: 'location-2-5-west-01',
        resumeAfter: { kind: 'overworld', entryId: 'location-2-5-west-01' },
    },
    {
        id: 'wumen-enter', kind: 'overworld-entrance', title: '午门在望',
        objective: '沿道路前往午门北侧入口',
        speech: '午门在前面。这一站要穿过门洞，再登上城台。',
        entranceId: 'location-3', entryPointId: 'location-3-north-01',
        resumeAfter: { kind: 'location', locationId: 'location-3', sceneId: '1', spawnId: 'spawn-overworld-north-01' },
    },
    {
        id: 'wumen-passage', kind: 'location-region', title: '门洞之下',
        objective: '依次前行至分镜 5，靠近门洞并点击查看',
        speech: '穿过门洞时，留意城门空间的纵深。',
        actionHint: '抬头看看砖拱，点击“查看”了解门洞怎样托住城台。',
        tutorialId: 'interaction-button',
        knowledgeText: '午门是明中都皇城南向的重要入口。现存城台和砖拱门洞仍能显示入口的尺度与纵深；门洞路面等遗迹也为判断工程营建状况提供了线索。继续前行，可以从城台重新观察午门与中轴空间。',
        locationId: 'location-3', sceneId: '5', regionId: 'interaction-wumen-passage',
        proximity: 82, targetKind: 'interaction', completionMode: 'action',
        resumeAfter: { kind: 'location', locationId: 'location-3', sceneId: '5', spawnId: 'spawn-from-4' },
    },
    {
        id: 'wumen-platform', kind: 'location-region', title: '登城回望',
        objective: '继续前行至分镜 8，靠近城台观察点并点击查看',
        speech: '登临城台，这条从遗迹认识都城的主线就走完了。',
        actionHint: '最后再点击一次“查看”，把一路见到的遗迹连回整座都城。',
        tutorialId: 'interaction-button',
        knowledgeText: '从午门城台回望，城门、道路、城垣和宫殿遗迹重新联系到南北中轴之中。今天看到的是不同类型、不同保存状态的遗存；把它们放回城市格局，才能从孤立的石砖与台基读出都城秩序。',
        locationId: 'location-3', sceneId: '8', regionId: 'interaction-wumen-platform',
        proximity: 72, targetKind: 'interaction', completionMode: 'action',
        resumeAfter: { kind: 'location', locationId: 'location-3', sceneId: '8', spawnId: 'spawn-from-7' },
    },
];

export const TOUR_NARRATION_POINTS: TourNarrationPoint[] = [
    {
        id: 'visitor-researcher', locationId: 'visitor-center', sceneId: 'exterior',
        regionId: 'obstacle-wang', proximity: 88,
        speech: '基座上的名字，连接着遗址从田野调查走向公众认知的过程。',
    },
    {
        id: 'visitor-axis', locationId: 'visitor-center', sceneId: 'interior',
        regionId: 'obstacle-map', proximity: 92,
        speech: '从沙盘上看，中轴把城门、宫殿和苑囿一层层串了起来。',
    },
    {
        id: 'west-wall-bricks', locationId: 'location-4', sceneId: 'main',
        regionId: 'interaction-west-gate', proximity: 118,
        speech: '留意墙体的砖缝与收分，城垣的尺度就藏在这些细节里。',
    },
    {
        id: 'stone-base-columns', locationId: 'location-2', sceneId: '2',
        regionId: 'interaction-stone-base', proximity: 104,
        speech: '一块石础对应一根木柱，成组的位置能拼回消失的柱网。',
    },
    {
        id: 'well-daily-life', locationId: 'location-2-5', sceneId: '2',
        regionId: 'interaction-ancient-well', proximity: 108,
        speech: '一口井把视线从宫殿拉回日常，也提醒我们留意都城如何运转。',
    },
    {
        id: 'wumen-xumizuo', locationId: 'location-3', sceneId: '3',
        regionId: 'interaction-wumen-xumizuo', proximity: 105,
        speech: '靠近些看，须弥座上的连续纹样既收束结构，也标示礼制等级。',
    },
    {
        id: 'wumen-brick-arch', locationId: 'location-3', sceneId: '5',
        regionId: 'interaction-wumen-passage', proximity: 110,
        speech: '门洞里的砖券一层层传递重量，托起了上方宽阔的城台。',
    },
    {
        id: 'wumen-axis-view', locationId: 'location-3', sceneId: '8',
        regionId: 'interaction-wumen-platform', proximity: 112,
        speech: '站到高处再回望，沿途的城墙、道路和宫殿遗迹便有了关系。',
    },
];

export function getTourStep(id: string): TourStep | null {
    return TOUR_STEPS.find((step) => step.id === id) ?? null;
}

export function getNextTourStep(completed: ReadonlySet<string>): TourStep | null {
    return TOUR_STEPS.find((step) => !completed.has(step.id)) ?? null;
}

export function getTourStepDisplayTitle(step: TourStep): string {
    const index = TOUR_STEPS.findIndex((item) => item.id === step.id);
    return index >= 0 ? `${step.title} · ${index + 1}/${TOUR_STEPS.length}` : step.title;
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
