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
    entranceId?: string;
    locationId?: string;
    sceneId?: string;
    regionId?: string;
    proximity?: number;
    targetKind?: 'location' | 'interaction';
    overworldEntryId?: string;
    resumeAfter: TourResumeAnchor;
};

export const TOUR_STEPS: TourStep[] = [
    {
        id: 'visitor-center-enter',
        kind: 'overworld-entrance',
        title: '游客中心',
        objective: '沿路标前往游客中心',
        speech: '咱带你沿着中都城的脉络走一趟。先去游客中心。',
        entranceId: 'location-1',
        resumeAfter: {
            kind: 'location',
            locationId: 'visitor-center',
            sceneId: 'exterior',
            spawnId: 'spawn-visitor',
        },
    },
    {
        id: 'visitor-center-wang',
        kind: 'location-region',
        title: '王英雕像',
        objective: '前往外院，靠近王英雕像',
        speech: '先在王英雕像前停一停，再进展厅看看明中都沙盘。',
        locationId: 'visitor-center',
        sceneId: 'exterior',
        regionId: 'obstacle-wang',
        proximity: 68,
        targetKind: 'interaction',
        resumeAfter: {
            kind: 'location',
            locationId: 'visitor-center',
            sceneId: 'interior',
            spawnId: 'spawn-exterior',
        },
    },
    {
        id: 'visitor-center-map',
        kind: 'location-region',
        title: '明中都沙盘',
        objective: '进入室内展厅，靠近中央沙盘',
        speech: '从沙盘看清整体格局，接下来回到城址，沿路去西门。',
        locationId: 'visitor-center',
        sceneId: 'interior',
        regionId: 'obstacle-map',
        proximity: 72,
        targetKind: 'interaction',
        resumeAfter: {
            kind: 'location',
            locationId: 'visitor-center',
            sceneId: 'main-road',
            spawnId: 'spawn-visitor',
        },
    },
    {
        id: 'visitor-center-return',
        kind: 'return-overworld',
        title: '返回城址',
        objective: '从游客中心东侧出口返回大地图',
        speech: '游客中心看完了。咱们回到城址，下一站去西门。',
        locationId: 'visitor-center',
        overworldEntryId: 'location-1-east-01',
        resumeAfter: { kind: 'overworld', entryId: 'location-1-east-01' },
    },
    {
        id: 'west-gate',
        kind: 'overworld-entrance',
        title: '西门',
        objective: '沿道路前往西门',
        speech: '西门到了。记下这一站，我们继续去石础。',
        entranceId: 'location-4',
        resumeAfter: { kind: 'overworld', entryId: '' },
    },
    {
        id: 'stone-pier',
        kind: 'overworld-entrance',
        title: '石础',
        objective: '沿道路北上，前往石础',
        speech: '石础到了。记下这一站，我们继续去古井。',
        entranceId: 'location-2',
        resumeAfter: { kind: 'overworld', entryId: '' },
    },
    {
        id: 'ancient-well',
        kind: 'overworld-entrance',
        title: '古井',
        objective: '沿道路南下，前往古井',
        speech: '古井到了。记下这一站，我们继续去午门。',
        entranceId: 'location-2-5',
        resumeAfter: { kind: 'overworld', entryId: '' },
    },
    {
        id: 'wumen',
        kind: 'overworld-entrance',
        title: '午门',
        objective: '沿道路前往午门',
        speech: '这条主线走完了。接下来可以自由看看，也可以重新开始导览。',
        entranceId: 'location-3',
        resumeAfter: { kind: 'overworld', entryId: '' },
    },
];

export function getTourStep(id: string): TourStep | null {
    return TOUR_STEPS.find((step) => step.id === id) ?? null;
}

export function getNextTourStep(visited: ReadonlySet<string>): TourStep | null {
    return TOUR_STEPS.find((step) => !visited.has(step.id)) ?? null;
}

export function getStepForEntrance(entranceId: string): TourStep | null {
    return TOUR_STEPS.find((step) => (
        step.kind === 'overworld-entrance' && step.entranceId === entranceId
    )) ?? null;
}
