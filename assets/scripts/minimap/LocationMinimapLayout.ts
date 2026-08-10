export type MinimapNodeLayout = {
    x: number;
    y: number;
    width?: number;
    height?: number;
    radius?: number;
};

export type MinimapExitLayout = {
    sceneId: string;
    entryId: string;
    x: number;
    y: number;
};

export type LocationMinimapLayout = {
    nodes: Record<string, MinimapNodeLayout>;
    exits: MinimapExitLayout[];
};

const circle = (x: number, y: number): MinimapNodeLayout => ({
    x, y, width: 30, height: 30, radius: 15,
});

export const LOCATION_MINIMAP_LAYOUTS: Record<string, LocationMinimapLayout> = {
    'visitor-center': {
        nodes: {
            'entrance-gate': circle(105, -90),
            'main-road': { x: 105, y: 0, width: 30, height: 84, radius: 15 },
            'cafe-garden': circle(35, -60),
            'leisure-plaza': circle(35, 0),
            'visitor-building': circle(35, 60),
            exterior: circle(-35, 60),
            interior: circle(-105, 60),
        },
        exits: [
            { sceneId: 'entrance-gate', entryId: 'location-1-west-01', x: 105, y: -145 },
            { sceneId: 'main-road', entryId: 'location-1-east-01', x: 105, y: 70 },
        ],
    },
    'location-2': {
        nodes: {
            '1': { x: 165, y: 80, width: 30, height: 78, radius: 15 },
            '2': circle(95, 80),
            '3': circle(-165, -100),
            '4': circle(-120, -55),
            '4-5': circle(-75, -10),
            '5': circle(-15, -10),
            '6': circle(-75, 50),
        },
        exits: [
            { sceneId: '1', entryId: 'location-2-north-01', x: 165, y: 145 },
            { sceneId: '1', entryId: 'location-2-north-02', x: 165, y: 15 },
            { sceneId: '3', entryId: 'location-2-east-01', x: -210, y: -145 },
            { sceneId: '3', entryId: 'location-2-east-02', x: -120, y: -145 },
        ],
    },
    'location-2-5': {
        nodes: {
            '1': circle(-35, 0),
            '2': circle(35, 0),
        },
        exits: [
            { sceneId: '1', entryId: 'location-2-5-west-01', x: -75, y: -45 },
            { sceneId: '1', entryId: 'location-2-5-east-01', x: -25, y: 50 },
        ],
    },
    'location-3': {
        nodes: {
            '1': circle(-45, -70),
            '2': circle(-45, -25),
            '3': circle(-45, 20),
            '4': circle(0, 20),
            '5': circle(0, 65),
            '6': circle(45, 65),
            '7': circle(45, 110),
            '8': circle(0, 110),
        },
        exits: [
            { sceneId: '1', entryId: 'location-3-north-01', x: -45, y: -120 },
        ],
    },
    'location-4': {
        nodes: { main: circle(0, 0) },
        exits: [
            { sceneId: 'main', entryId: 'location-4-west-01', x: -65, y: 0 },
            { sceneId: 'main', entryId: 'location-4-east-01', x: 65, y: 0 },
        ],
    },
};
