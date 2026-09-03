// node tests/tour.test.cjs <path-to-typescript-module>
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(process.argv[2] || 'typescript');

const projectRoot = path.join(__dirname, '..');
const storageData = new Map();
const cc = {
    sys: {
        localStorage: {
            getItem: key => storageData.get(key) ?? null,
            setItem: (key, value) => storageData.set(key, value),
            removeItem: key => storageData.delete(key),
        },
    },
};
const modules = {};

function loadTourModule(name) {
    const source = fs.readFileSync(path.join(projectRoot, 'assets/scripts/tour', `${name}.ts`), 'utf8');
    const code = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const exports = {};
    vm.runInNewContext(code, {
        exports,
        require: request => request === 'cc' ? cc : modules[request],
        console,
    }, { filename: `${name}.ts` });
    modules[`./${name}`] = exports;
    return exports;
}

const config = loadTourModule('TourConfig');
const progressModule = loadTourModule('TourProgressStore');
const { TOUR_STEPS } = config;
const { TourProgressStore } = progressModule;

function loadLocations() {
    const root = path.join(projectRoot, 'assets/resources/locations');
    return Object.fromEntries(fs.readdirSync(root, { withFileTypes: true })
        .filter(item => item.isDirectory())
        .map(item => {
            const regions = path.join(root, item.name, 'regions.json');
            return fs.existsSync(regions)
                ? [item.name, JSON.parse(fs.readFileSync(regions, 'utf8'))]
                : null;
        })
        .filter(Boolean));
}

function parseEntryMap() {
    const source = fs.readFileSync(
        path.join(projectRoot, 'assets/scripts/overworld/OverworldBootstrap.ts'),
        'utf8',
    );
    const result = new Map();
    const pattern = /'([^']+)':\s*\{\s*locationId:\s*'([^']+)',\s*cocosScene:\s*'[^']+',\s*sceneId:\s*'([^']+)',\s*spawnId:\s*'([^']+)'\s*\}/g;
    for (const match of source.matchAll(pattern)) {
        result.set(match[1], { locationId: match[2], sceneId: match[3], spawnId: match[4] });
    }
    return result;
}

function enabledRegions(scene, type) {
    return (scene?.regions ?? []).filter(region => region.enabled !== false && Number(region.type) === type);
}

function canReach(document, start, target) {
    if (start === target) return true;
    const queue = [start];
    const visited = new Set(queue);
    while (queue.length) {
        const sceneId = queue.shift();
        for (const transition of enabledRegions(document.scenes[sceneId], 3)) {
            const next = String(transition.targetSceneId || '');
            if (!next || visited.has(next)) continue;
            if (next === target) return true;
            visited.add(next);
            queue.push(next);
        }
    }
    return false;
}

let checks = 0;
function test(name, run) { run(); checks++; console.log(`PASS ${name}`); }

test('tour has one deterministic 16-step sequence', () => {
    assert.equal(TOUR_STEPS.length, 16);
    assert.equal(new Set(TOUR_STEPS.map(step => step.id)).size, 16);
    assert.equal(TOUR_STEPS[0].id, 'visitor-center-enter');
    assert.equal(TOUR_STEPS.at(-1).id, 'wumen-platform');
});

test('every tour entrance, target, spawn and exit exists', () => {
    const locations = loadLocations();
    const entries = parseEntryMap();
    for (const step of TOUR_STEPS) {
        if (step.kind === 'overworld-entrance') {
            const entry = entries.get(step.entryPointId);
            assert.ok(entry, `${step.id}: missing overworld entry ${step.entryPointId}`);
            assert.equal(entry.locationId, step.resumeAfter.locationId, `${step.id}: destination location`);
            const scene = locations[entry.locationId]?.scenes?.[entry.sceneId];
            assert.ok(scene, `${step.id}: missing destination scene`);
            assert.ok(
                enabledRegions(scene, 5).some(region => region.id === entry.spawnId),
                `${step.id}: missing destination spawn ${entry.spawnId}`,
            );
        } else if (step.kind === 'location-region') {
            const scene = locations[step.locationId]?.scenes?.[step.sceneId];
            assert.ok(scene, `${step.id}: missing ${step.locationId}/${step.sceneId}`);
            const region = enabledRegions(scene, 2).find(item => item.id === step.regionId);
            assert.ok(region, `${step.id}: missing interaction ${step.regionId}`);
            assert.equal(region.handlerId, 'location-info', `${step.id}: wrong interaction handler`);
            assert.ok(
                enabledRegions(scene, 5).some(item => item.id === step.resumeAfter.spawnId),
                `${step.id}: missing resume spawn ${step.resumeAfter.spawnId}`,
            );
        } else {
            const document = locations[step.locationId];
            assert.ok(document, `${step.id}: missing location`);
            assert.ok(Object.values(document.scenes).some(scene => (
                enabledRegions(scene, 3).some(item => item.overworldEntryId === step.overworldEntryId)
            )), `${step.id}: missing exit ${step.overworldEntryId}`);
        }
    }
});

test('all guided targets and recommended exits are reachable in scene graphs', () => {
    const locations = loadLocations();
    const entries = parseEntryMap();
    let locationId = '';
    let sceneId = '';
    for (const step of TOUR_STEPS) {
        if (step.kind === 'overworld-entrance') {
            const entry = entries.get(step.entryPointId);
            locationId = entry.locationId;
            sceneId = entry.sceneId;
            continue;
        }
        const document = locations[locationId];
        if (step.kind === 'location-region') {
            assert.equal(step.locationId, locationId, `${step.id}: unexpected location ordering`);
            assert.ok(canReach(document, sceneId, step.sceneId), `${step.id}: unreachable from ${sceneId}`);
            sceneId = step.sceneId;
            continue;
        }
        const exitScene = Object.entries(document.scenes).find(([, scene]) => (
            enabledRegions(scene, 3).some(item => item.overworldEntryId === step.overworldEntryId)
        ))?.[0];
        assert.ok(exitScene && canReach(document, sceneId, exitScene), `${step.id}: exit unreachable from ${sceneId}`);
        locationId = '';
        sceneId = '';
    }
});

test('progress store advances through all 16 steps and persists', () => {
    TourProgressStore.reset();
    for (const step of TOUR_STEPS) {
        assert.equal(TourProgressStore.getCurrentStep().id, step.id);
        TourProgressStore.markVisited(step.id, step.resumeAfter);
    }
    assert.equal(TourProgressStore.getCurrentStep(), null);
    assert.equal(TourProgressStore.load().completed, true);
    assert.equal(TourProgressStore.load().completedStepIds.length, 16);
});

test('persistent arrays avoid Set spread broken by Cocos Babel', () => {
    for (const file of [
        'assets/scripts/tour/TourProgressStore.ts',
        'assets/scripts/collection/FragmentCollectionStore.ts',
    ]) {
        const source = fs.readFileSync(path.join(projectRoot, file), 'utf8');
        const executableSource = source.replace(/\/\/.*$/gm, '');
        assert.doesNotMatch(executableSource, /\.\.\.new\s+Set\s*\(/, `${file}: use Array.from(new Set(...))`);
    }
});

console.log(`Tour tests passed: ${checks}`);
