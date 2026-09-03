import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

// Exercise the real extension entry points with a minimal Cocos scene model.
const source = readFileSync('extensions/ming-zhongdu-tools/dist/scene.js', 'utf8');
class Node {
    constructor(name) {
        this.name = name;
        this.children = [];
        this.components = new Map();
        this.position = { x: 0, y: 0, z: 0 };
        this.scale = { x: 1, y: 1, z: 1 };
    }
    addChild(child) { this.children.push(child); }
    getChildByName(name) { return this.children.find((child) => child.name === name); }
    getComponent(type) { return this.components.get(type) || null; }
    addComponent(type) {
        const component = new type();
        component.node = this;
        this.components.set(type, component);
        return component;
    }
    setPosition(x, y, z) { this.position = { x, y, z }; }
    setScale(x, y, z) { this.scale = { x, y, z }; }
}
class UITransform {
    anchorPoint = { x: 0.5, y: 0.5 };
    setContentSize(width, height) { this.contentSize = { width, height }; }
}
class Graphics {
    clear() {} rect() {} fill() {} stroke() {} moveTo() {} lineTo() {} circle() {}
}
class RegionShape {
    redraw() {}
    getPoints() { return this.node.children.map((child) => child.position); }
}
class OcclusionLineShape {}

function fixture(perspective = { nearY: -300, nearVisualHeight: 480, horizonY: 0, keepY: 200 }) {
    const scene = new Node('TestScene');
    const canvas = new Node('Canvas');
    scene.addChild(canvas);
    canvas.components.set('LocationBootstrap', {
        locationId: 'test-location', previewSceneId: 'main',
        config: { scenes: { main: { worldSize: { width: 2400, height: 1024 } } } },
    });
    const document = { scenes: { main: {
        perspective,
        regions: [{ id: 'spawn-test', type: 5, points: [{ x: 0.5, y: 0.6 }] }],
    } } };
    const cc = {
        Node, UITransform, Graphics, Color: class {}, Layers: { Enum: { UI_2D: 1 } },
        director: { getScene: () => scene },
        js: { getClassByName: (name) => ({ RegionShape, OcclusionLineShape })[name] },
    };
    const context = {
        exports: {}, Editor: { Project: { path: '/virtual-project' } },
        require(name) {
            if (name === 'cc') return cc;
            if (name === 'path') return path;
            if (name === 'fs') return {
                existsSync: (file) => file.endsWith('regions.json'),
                readFileSync: () => JSON.stringify(document),
            };
            throw new Error(`Unexpected module ${name}`);
        },
    };
    vm.runInNewContext(source, context);
    return {
        api: context.exports.methods,
        group: () => canvas.getChildByName('RegionEditor').getChildByName('Scene-main'),
    };
}

test('loading regions with perspective terminates and restores JSON values including zero', () => {
    const { api, group } = fixture();
    assert.equal(api.listRegions('main').length, 1);
    const calibration = api.ensurePerspectiveCalibration('main');
    assert.equal(calibration.nearY, -300);
    assert.equal(calibration.nearVisualHeight, 480);
    assert.equal(calibration.horizonY, 0);
    assert.equal(calibration.keepY, 200);
    assert.equal(group().getChildByName('PerspectiveHorizon').getComponent(UITransform).contentSize.width, 2400);
});

test('repeated panel refresh preserves manually adjusted calibration and vertices', () => {
    const { api, group } = fixture();
    api.listRegions('main');
    group().getChildByName('PerspectiveNear').setPosition(0, -100, 0);
    group().getChildByName('PerspectiveNear').setScale(1, 1.5, 1);
    group().getChildByName('PerspectiveHorizon').setPosition(0, 125, 0);
    group().getChildByName('PerspectiveKeep').setPosition(0, 275, 0);
    group().getChildByName('Region-spawn-test').children[0].setPosition(25, -75, 0);
    const count = group().children.length;
    for (let i = 0; i < 20; i += 1) api.listRegions('main');
    const calibration = api.ensurePerspectiveCalibration('main');
    assert.equal(calibration.nearY, -400);
    assert.equal(calibration.nearVisualHeight, 600);
    assert.equal(calibration.horizonY, 125);
    assert.equal(calibration.keepY, 275);
    assert.equal(group().children.length, count);
    assert.equal(api.listRegions('main')[0].points[0].x, 25);
});

test('scenes without perspective still support explicit calibration creation', () => {
    const { api } = fixture(null);
    api.listRegions('main');
    const calibration = api.ensurePerspectiveCalibration('main');
    assert.equal(calibration.nearVisualHeight, 400);
    assert.equal(calibration.horizonY, 80);
});
