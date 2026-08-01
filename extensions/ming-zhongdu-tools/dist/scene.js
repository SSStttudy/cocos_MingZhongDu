'use strict';

const fs = require('fs');
const path = require('path');

const REGION_TYPES = ['Walkable', 'Obstacle', 'Interaction', 'Transition', 'Occlusion', 'Spawn'];
const REFERENCE_WIDTH = 1365;
const REFERENCE_HEIGHT = 1024;
const PERSPECTIVE_NEAR_NAME = 'PerspectiveNear';
const PERSPECTIVE_HORIZON_NAME = 'PerspectiveHorizon';
const PERSPECTIVE_KEEP_NAME = 'PerspectiveKeep';
const SCENE_FILE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const SCENE_ORDER = [
    'entrance-gate',
    'main-road',
    'cafe-garden',
    'leisure-plaza',
    'visitor-building',
    'exterior',
    'interior',
];

function getReferenceSize(sceneId) {
    const id = getCurrentSceneId(sceneId);
    const size = tryGetLocationBootstrap()?.config?.scenes?.[id]?.worldSize;
    const width = Number(size?.width);
    const height = Number(size?.height);
    return {
        width: Number.isFinite(width) && width > 0 ? width : REFERENCE_WIDTH,
        height: Number.isFinite(height) && height > 0 ? height : REFERENCE_HEIGHT,
    };
}

function getEngine() {
    return require('cc');
}

function findNode(root, name) {
    if (!root) return null;
    if (root.name === name) return root;
    for (const child of root.children) {
        const found = findNode(child, name);
        if (found) return found;
    }
    return null;
}

function getCanvas() {
    const { director } = getEngine();
    const canvas = findNode(director.getScene(), 'Canvas');
    if (!canvas) throw new Error('当前场景未找到 Canvas');
    return canvas;
}

function getLocationBootstrap() {
    return getCanvas().getComponent('LocationBootstrap');
}

function tryGetLocationBootstrap() {
    try {
        return getLocationBootstrap();
    } catch (_) {
        return null;
    }
}

function getCurrentSceneId(requested) {
    return String(requested || tryGetLocationBootstrap()?.previewSceneId || 'exterior');
}

function listSceneIdsFromAssets() {
    const locationId = tryGetLocationBootstrap()?.locationId || 'visitor-center';
    const directory = path.join(
        Editor.Project.path,
        'assets',
        'resources',
        'locations',
        locationId,
        'scenes',
    );
    if (!fs.existsSync(directory)) return [];
    const ids = [...new Set(
        fs.readdirSync(directory, { withFileTypes: true })
            .filter((entry) => entry.isFile() && SCENE_FILE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
            .map((entry) => path.basename(entry.name, path.extname(entry.name))),
    )];
    const order = new Map(SCENE_ORDER.map((id, index) => [id, index]));
    return ids.sort((left, right) => (
        (order.get(left) ?? Number.MAX_SAFE_INTEGER) - (order.get(right) ?? Number.MAX_SAFE_INTEGER)
        || left.localeCompare(right)
    ));
}

function listAvailableSceneIds() {
    const assetIds = listSceneIdsFromAssets();
    if (assetIds.length) return assetIds;
    const bootstrap = tryGetLocationBootstrap();
    const configuredIds = Object.keys(bootstrap?.config?.scenes || {});
    return configuredIds.length ? configuredIds : ['exterior', 'interior'];
}

function getRegionShapeClass() {
    const { js } = getEngine();
    const klass = js.getClassByName('RegionShape');
    if (!klass) throw new Error('RegionShape 尚未编译，请等待 Creator 完成脚本刷新');
    return klass;
}

function ensureRegionEditor() {
    const { Node, UITransform, Layers } = getEngine();
    const canvas = getCanvas();
    let root = canvas.getChildByName('RegionEditor');
    if (!root) {
        root = new Node('RegionEditor');
        root.layer = Layers.Enum.UI_2D;
        const size = getReferenceSize();
        root.addComponent(UITransform).setContentSize(size.width, size.height);
        canvas.addChild(root);
    }
    const size = getReferenceSize();
    (root.getComponent(UITransform) || root.addComponent(UITransform))
        .setContentSize(size.width, size.height);
    root.active = true;
    return root;
}

function ensureSceneGroup(sceneId) {
    const { Node, UITransform, Layers } = getEngine();
    const root = ensureRegionEditor();
    const id = getCurrentSceneId(sceneId);
    let group = root.getChildByName(`Scene-${id}`);
    if (!group) {
        group = new Node(`Scene-${id}`);
        group.layer = Layers.Enum.UI_2D;
        const size = getReferenceSize(id);
        group.addComponent(UITransform).setContentSize(size.width, size.height);
        root.addChild(group);
    }
    const size = getReferenceSize(id);
    (group.getComponent(UITransform) || group.addComponent(UITransform))
        .setContentSize(size.width, size.height);

    // 兼容旧版本：以前 Region-* 直接放在 RegionEditor 下。
    for (const child of [...root.children]) {
        if (child !== group && getRegionComponent(child)) group.addChild(child);
    }
    for (const child of root.children) {
        if (child.name.startsWith('Scene-')) child.active = child === group;
    }
    hydrateSceneGroup(group, id);
    ensureConfiguredSpawns(group, id);
    return group;
}

function hydrateSceneGroup(group, sceneId) {
    if (normalizeRegionNodes(group).length > 0) return;
    const locationId = tryGetLocationBootstrap()?.locationId || 'visitor-center';
    const sourcePath = path.join(
        Editor.Project.path,
        'assets',
        'resources',
        'locations',
        locationId,
        'regions.json',
    );
    if (!fs.existsSync(sourcePath)) return;
    let document;
    try {
        document = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    } catch (_) {
        return;
    }
    const sourceScene = document?.scenes?.[sceneId];
    if (!sourceScene) return;
    const { Node, UITransform, Graphics, Layers } = getEngine();
    const size = getReferenceSize(sceneId);
    for (const item of sourceScene.regions || []) {
        const regionNode = new Node(`Region-${sanitizeId(item.id)}`);
        regionNode.layer = Layers.Enum.UI_2D;
        regionNode.addComponent(UITransform).setContentSize(size.width, size.height);
        regionNode.addComponent(Graphics);
        const shape = regionNode.addComponent(getRegionShapeClass());
        shape.regionId = sanitizeId(item.id);
        shape.regionType = Number(item.type) || 0;
        shape.enabledRegion = item.enabled !== false;
        shape.priority = Number(item.priority) || 0;
        shape.handlerId = String(item.handlerId || '');
        shape.prompt = String(item.prompt || '');
        shape.triggerMode = String(item.triggerMode || 'button');
        shape.payload = String(item.payload || '{}');
        shape.targetSceneId = String(item.targetSceneId || '');
        shape.targetSpawnId = String(item.targetSpawnId || '');
        shape.overworldEntryId = String(item.overworldEntryId || '');
        group.addChild(regionNode);
        for (let index = 0; index < (item.points || []).length; index += 1) {
            const normalized = item.points[index];
            createVertex(
                regionNode,
                index,
                (Number(normalized.x) - 0.5) * size.width,
                (0.5 - Number(normalized.y)) * size.height,
            );
        }
        shape.redraw();
    }
    if (sourceScene.perspective) {
        const calibration = ensurePerspectiveCalibration(sceneId);
        const near = group.getChildByName(PERSPECTIVE_NEAR_NAME);
        const horizon = group.getChildByName(PERSPECTIVE_HORIZON_NAME);
        if (near) {
            const visualHeight = Number(sourceScene.perspective.nearVisualHeight) || 400;
            near.setScale(1, visualHeight / 400, 1);
            near.setPosition(
                0,
                Number(sourceScene.perspective.nearY) + visualHeight * 0.5,
                0,
            );
        }
        if (horizon) horizon.setPosition(0, Number(sourceScene.perspective.horizonY) || 80, 0);
        const keepY = Number(sourceScene.perspective.keepY);
        if (Number.isFinite(keepY)) {
            let keep = group.getChildByName(PERSPECTIVE_KEEP_NAME);
            if (!keep) {
                const { Node, Layers } = getEngine();
                keep = new Node(PERSPECTIVE_KEEP_NAME);
                keep.layer = Layers.Enum.UI_2D;
                group.addChild(keep);
            }
            keep.setPosition(0, keepY, 0);
            drawPerspectiveKeep(keep, sceneId);
        }
        void calibration;
    }
}

function drawPerspectiveNear(node) {
    const { UITransform, Graphics, Color } = getEngine();
    const transform = node.getComponent(UITransform) || node.addComponent(UITransform);
    transform.setContentSize(200, 400);
    const graphics = node.getComponent(Graphics) || node.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = new Color(42, 180, 125, 42);
    graphics.strokeColor = new Color(42, 180, 125, 255);
    graphics.lineWidth = 4;
    graphics.rect(-100, -200, 200, 400);
    graphics.fill();
    graphics.stroke();
}

function drawPerspectiveHorizon(node, sceneId) {
    const { UITransform, Graphics, Color } = getEngine();
    const size = getReferenceSize(sceneId);
    const transform = node.getComponent(UITransform) || node.addComponent(UITransform);
    transform.setContentSize(size.width, 24);
    const graphics = node.getComponent(Graphics) || node.addComponent(Graphics);
    graphics.clear();
    graphics.strokeColor = new Color(229, 72, 72, 255);
    graphics.lineWidth = 4;
    graphics.moveTo(-size.width * 0.5, 0);
    graphics.lineTo(size.width * 0.5, 0);
    graphics.stroke();
}

function drawPerspectiveKeep(node, sceneId) {
    const { UITransform, Graphics, Color } = getEngine();
    const size = getReferenceSize(sceneId);
    const transform = node.getComponent(UITransform) || node.addComponent(UITransform);
    transform.setContentSize(size.width, 24);
    const graphics = node.getComponent(Graphics) || node.addComponent(Graphics);
    graphics.clear();
    graphics.strokeColor = new Color(255, 196, 64, 255);
    graphics.lineWidth = 4;
    graphics.moveTo(-size.width * 0.5, 0);
    graphics.lineTo(size.width * 0.5, 0);
    graphics.stroke();
}

function readPerspectiveCalibration(group) {
    const { UITransform } = getEngine();
    const near = group.getChildByName(PERSPECTIVE_NEAR_NAME);
    const horizon = group.getChildByName(PERSPECTIVE_HORIZON_NAME);
    const keep = group.getChildByName(PERSPECTIVE_KEEP_NAME);
    if (!near || !horizon) return null;

    near.setPosition(0, near.position.y, 0);
    horizon.setPosition(0, horizon.position.y, 0);
    if (keep) keep.setPosition(0, keep.position.y, 0);
    const transform = near.getComponent(UITransform);
    if (!transform) return null;
    const nearVisualHeight = transform.contentSize.height * Math.abs(near.scale.y);
    const lowerAnchor = near.scale.y >= 0
        ? transform.anchorPoint.y
        : 1 - transform.anchorPoint.y;
    const calibration = {
        nearY: Number((near.position.y - nearVisualHeight * lowerAnchor).toFixed(3)),
        nearVisualHeight: Number(nearVisualHeight.toFixed(3)),
        horizonY: Number(horizon.position.y.toFixed(3)),
    };
    if (keep) calibration.keepY = Number(keep.position.y.toFixed(3));
    return calibration;
}

function ensurePerspectiveCalibration(sceneId) {
    const { Node, Layers } = getEngine();
    const group = ensureSceneGroup(sceneId);
    let near = group.getChildByName(PERSPECTIVE_NEAR_NAME);
    if (!near) {
        near = new Node(PERSPECTIVE_NEAR_NAME);
        near.layer = Layers.Enum.UI_2D;
        near.setPosition(0, -280, 0);
        group.addChild(near);
    }
    drawPerspectiveNear(near);

    let horizon = group.getChildByName(PERSPECTIVE_HORIZON_NAME);
    if (!horizon) {
        horizon = new Node(PERSPECTIVE_HORIZON_NAME);
        horizon.layer = Layers.Enum.UI_2D;
        horizon.setPosition(0, 80, 0);
        group.addChild(horizon);
    }
    drawPerspectiveHorizon(horizon, sceneId);
    return {
        sceneId: getCurrentSceneId(sceneId),
        names: {
            near: PERSPECTIVE_NEAR_NAME,
            horizon: PERSPECTIVE_HORIZON_NAME,
        },
        ...readPerspectiveCalibration(group),
    };
}

function getRegionNodes(sceneId) {
    return normalizeRegionNodes(ensureSceneGroup(sceneId));
}

function getRegionComponent(node) {
    return node.getComponent(getRegionShapeClass());
}

function sanitizeId(value) {
    const id = String(value || 'region').trim().toLowerCase()
        .replace(/[^a-z0-9\-_]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return id || 'region';
}

function normalizeRegionNodes(group) {
    const nodes = group.children.filter((child) => Boolean(getRegionComponent(child)));
    const used = new Set();
    for (const node of nodes) {
        const shape = getRegionComponent(node);
        const nodeId = node.name.startsWith('Region-')
            ? node.name.slice('Region-'.length)
            : node.name;
        const base = sanitizeId(nodeId || shape.regionId);
        let id = base;
        let suffix = 2;
        while (used.has(id)) {
            id = `${base}-${suffix}`;
            suffix += 1;
        }
        used.add(id);
        shape.regionId = id;
        node.name = `Region-${id}`;
    }
    return nodes;
}

function uniqueRegionId(requested, sceneId) {
    const base = sanitizeId(requested);
    const used = new Set(getRegionNodes(sceneId).map((node) => getRegionComponent(node)?.regionId));
    if (!used.has(base)) return base;
    let index = 2;
    while (used.has(`${base}-${index}`)) index += 1;
    return `${base}-${index}`;
}

function createVertex(parent, index, x, y) {
    const { Node, UITransform, Graphics, Layers, Color } = getEngine();
    const vertex = new Node(`Vertex-${String(index).padStart(2, '0')}`);
    vertex.layer = Layers.Enum.UI_2D;
    vertex.addComponent(UITransform).setContentSize(24, 24);
    const graphics = vertex.addComponent(Graphics);
    graphics.fillColor = new Color(255, 250, 225, 255);
    graphics.strokeColor = new Color(58, 43, 110, 255);
    graphics.lineWidth = 4;
    graphics.circle(0, 0, 8);
    graphics.fill();
    graphics.stroke();
    vertex.setPosition(x, y, 0);
    parent.addChild(vertex);
    return vertex;
}

function createRegionInGroup(parent, id, type, sides, radius, center = { x: 0, y: 0 }) {
    const { Node, UITransform, Graphics, Layers } = getEngine();
    const region = new Node(`Region-${id}`);
    region.layer = Layers.Enum.UI_2D;
    const sceneId = parent.name.startsWith('Scene-')
        ? parent.name.slice('Scene-'.length)
        : getCurrentSceneId();
    const size = getReferenceSize(sceneId);
    region.addComponent(UITransform).setContentSize(size.width, size.height);
    region.addComponent(Graphics);
    const shape = region.addComponent(getRegionShapeClass());
    shape.regionId = id;
    shape.regionType = type;
    region.setPosition(center.x, center.y, 0);
    parent.addChild(region);
    const startAngle = -Math.PI * 0.5;
    for (let index = 0; index < sides; index += 1) {
        const angle = startAngle + (Math.PI * 2 * index) / sides;
        createVertex(region, index, Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    shape.redraw();
    return region;
}

function ensureConfiguredSpawns(group, sceneId) {
    const existingSpawns = normalizeRegionNodes(group)
        .map((child) => getRegionComponent(child))
        .filter((shape) => Number(shape?.regionType) === 5);
    // Once a scene has manually named spawn regions, they are authoritative.
    // Filling every configured spawn here used to resurrect legacy
    // spawn-default nodes whenever the editor refreshed.
    if (existingSpawns.length > 0) return;

    const config = getLocationBootstrap()?.config?.scenes?.[sceneId];
    const configured = config?.spawns?.length
        ? config.spawns
        : [{ id: 'spawn-default', position: config?.playerStart || { x: 0, y: -330 } }];
    for (const spawn of configured) {
        createRegionInGroup(group, spawn.id, 5, 4, 18, spawn.position);
    }
}

function serializeRegion(node) {
    const shape = getRegionComponent(node);
    const position = node.position;
    const scale = node.scale;
    const points = shape.getPoints().map((point) => ({
        x: position.x + point.x * scale.x,
        y: position.y + point.y * scale.y,
    }));
    return {
        id: shape.regionId,
        type: Number(shape.regionType),
        typeName: REGION_TYPES[Number(shape.regionType)] || 'Walkable',
        enabled: Boolean(shape.enabledRegion),
        priority: Number(shape.priority) || 0,
        handlerId: shape.handlerId || '',
        prompt: shape.prompt || '',
        triggerMode: shape.triggerMode || 'button',
        payload: shape.payload || '{}',
        targetSceneId: shape.targetSceneId || '',
        targetSpawnId: shape.targetSpawnId || '',
        overworldEntryId: shape.overworldEntryId || '',
        points,
    };
}

function createRegularRegion(options = {}) {
    const sceneId = getCurrentSceneId(options.sceneId);
    const parent = ensureSceneGroup(sceneId);
    const id = uniqueRegionId(options.id, sceneId);
    const sides = Math.max(3, Math.min(32, Math.round(Number(options.sides) || 4)));
    const radius = Math.max(20, Math.min(600, Number(options.radius) || 120));
    const type = Math.max(0, Math.min(REGION_TYPES.length - 1, Number(options.type) || 0));
    const region = createRegionInGroup(parent, id, type, sides, radius);
    return serializeRegion(region);
}

function findRegion(id, sceneId) {
    return getRegionNodes(sceneId).find((node) => getRegionComponent(node)?.regionId === id) || null;
}

function setRegionProperties(values = {}) {
    const sceneId = getCurrentSceneId(values.sceneId);
    const node = findRegion(values.id, sceneId);
    if (!node) throw new Error(`未找到区域：${values.id}`);
    const shape = getRegionComponent(node);
    if (values.newId !== undefined) {
        const nextId = sanitizeId(values.newId);
        const duplicate = getRegionNodes(sceneId)
            .some((candidate) => candidate !== node && getRegionComponent(candidate)?.regionId === nextId);
        if (duplicate) throw new Error(`区域 ID 已存在：${nextId}`);
        shape.regionId = nextId;
        node.name = `Region-${nextId}`;
    }
    if (values.type !== undefined) shape.regionType = Number(values.type);
    if (values.enabled !== undefined) shape.enabledRegion = Boolean(values.enabled);
    if (values.priority !== undefined) shape.priority = Number(values.priority) || 0;
    for (const key of ['handlerId', 'prompt', 'triggerMode', 'payload', 'targetSceneId', 'targetSpawnId', 'overworldEntryId']) {
        if (values[key] !== undefined) shape[key] = String(values[key]);
    }
    shape.redraw();
    return serializeRegion(node);
}

const REQUIRED_SPAWNS = {
    'entrance-gate': ['spawn-road'],
    'main-road': ['spawn-gate', 'spawn-cafe', 'spawn-visitor'],
    'cafe-garden': ['spawn-road', 'spawn-leisure'],
    'leisure-plaza': ['spawn-cafe', 'spawn-visitor'],
    'visitor-building': ['spawn-leisure', 'spawn-exterior', 'spawn-road'],
    exterior: ['spawn-visitor', 'spawn-interior'],
    interior: ['spawn-exterior'],
};

function cleanupObsoleteSpawns() {
    const removed = [];
    for (const [sceneId, requiredIds] of Object.entries(REQUIRED_SPAWNS)) {
        const allowed = new Set(requiredIds);
        const group = ensureSceneGroup(sceneId);
        for (const node of [...normalizeRegionNodes(group)]) {
            const shape = getRegionComponent(node);
            if (Number(shape?.regionType) !== 5 || allowed.has(shape.regionId)) continue;
            removed.push(`${sceneId}/${shape.regionId}`);
            node.removeFromParent();
            node.destroy();
        }
    }
    return removed;
}

function buildNamedTransitions() {
    const links = [
        ['entrance-gate', 'spawn-road', 'main-road', 'spawn-gate'],
        ['main-road', 'spawn-gate', 'entrance-gate', 'spawn-road'],
        ['main-road', 'spawn-cafe', 'cafe-garden', 'spawn-road'],
        ['main-road', 'spawn-visitor', 'visitor-building', 'spawn-road'],
        ['cafe-garden', 'spawn-road', 'main-road', 'spawn-cafe'],
        ['cafe-garden', 'spawn-leisure', 'leisure-plaza', 'spawn-cafe'],
        ['leisure-plaza', 'spawn-cafe', 'cafe-garden', 'spawn-leisure'],
        ['leisure-plaza', 'spawn-visitor', 'visitor-building', 'spawn-leisure'],
        ['visitor-building', 'spawn-leisure', 'leisure-plaza', 'spawn-visitor'],
        ['visitor-building', 'spawn-exterior', 'exterior', 'spawn-visitor'],
        ['visitor-building', 'spawn-road', 'main-road', 'spawn-visitor'],
        ['exterior', 'spawn-visitor', 'visitor-building', 'spawn-exterior'],
        ['exterior', 'spawn-interior', 'interior', 'spawn-exterior'],
        ['interior', 'spawn-exterior', 'exterior', 'spawn-interior'],
    ];
    const originalSceneId = getCurrentSceneId();
    const removedSpawns = cleanupObsoleteSpawns();
    const created = [];
    const updated = [];
    const missing = [];

    for (const [sceneId, spawnId, targetSceneId, targetSpawnId] of links) {
        const spawnNode = findRegion(spawnId, sceneId);
        if (!spawnNode || Number(getRegionComponent(spawnNode)?.regionType) !== 5) {
            missing.push(`${sceneId}/${spawnId}`);
            continue;
        }
        const transitionId = `to-${targetSceneId}`;
        let transitionNode = findRegion(transitionId, sceneId);
        if (!transitionNode) {
            const position = spawnNode.position;
            const length = Math.hypot(position.x, position.y) || 1;
            const offset = 72;
            const center = {
                x: Math.max(-630, Math.min(630, position.x + position.x / length * offset)),
                y: Math.max(-470, Math.min(470, position.y + position.y / length * offset)),
            };
            transitionNode = createRegionInGroup(
                ensureSceneGroup(sceneId),
                transitionId,
                3,
                4,
                52,
                center,
            );
            created.push(`${sceneId}/${transitionId}`);
        } else {
            updated.push(`${sceneId}/${transitionId}`);
        }
        const shape = getRegionComponent(transitionNode);
        shape.regionType = 3;
        shape.targetSceneId = targetSceneId;
        shape.targetSpawnId = targetSpawnId;
        shape.overworldEntryId = '';
        shape.redraw();
    }

    ensureSceneGroup(originalSceneId);
    const exported = exportRegions();
    return { removedSpawns, created, updated, missing, exported };
}

function addVertex(id, sceneId) {
    const node = findRegion(id, sceneId);
    if (!node) throw new Error(`未找到区域：${id}`);
    const shape = getRegionComponent(node);
    const points = shape.getPoints();
    if (points.length < 2) throw new Error('至少需要两个现有顶点');
    let edgeIndex = 0;
    let maxLength = -1;
    for (let index = 0; index < points.length; index += 1) {
        const next = (index + 1) % points.length;
        const dx = points[next].x - points[index].x;
        const dy = points[next].y - points[index].y;
        const length = dx * dx + dy * dy;
        if (length > maxLength) { maxLength = length; edgeIndex = index; }
    }
    const insertAt = edgeIndex + 1;
    const nextIndex = insertAt % points.length;
    const midpoint = {
        x: (points[edgeIndex].x + points[nextIndex].x) * 0.5,
        y: (points[edgeIndex].y + points[nextIndex].y) * 0.5,
    };
    const vertices = node.children.filter((child) => child.name.startsWith('Vertex-'));
    for (let index = vertices.length - 1; index >= insertAt; index -= 1) {
        vertices[index].name = `Vertex-${String(index + 1).padStart(2, '0')}`;
    }
    createVertex(node, insertAt, midpoint.x, midpoint.y);
    shape.redraw();
    return serializeRegion(node);
}

function removeVertex(id, sceneId) {
    const node = findRegion(id, sceneId);
    if (!node) throw new Error(`未找到区域：${id}`);
    const vertices = node.children.filter((child) => child.name.startsWith('Vertex-'))
        .sort((a, b) => a.name.localeCompare(b.name));
    if (vertices.length <= 3) throw new Error('多边形至少需要三个顶点');
    vertices[vertices.length - 1].removeFromParent();
    vertices[vertices.length - 1].destroy();
    getRegionComponent(node).redraw();
    return true;
}

function segmentsIntersect(a, b, c, d) {
    const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
}

function validateRegions(sceneId) {
    const errors = [];
    const warnings = [];
    const regions = getRegionNodes(sceneId).map(serializeRegion);
    const ids = new Set();
    let walkableCount = 0;
    for (const region of regions) {
        if (ids.has(region.id)) errors.push(`区域 ID 重复：${region.id}`);
        ids.add(region.id);
        if (region.type === 0) walkableCount += 1;
        if (region.points.length < 3) errors.push(`${region.id} 少于三个顶点`);
        for (let i = 0; i < region.points.length; i += 1) {
            const a = region.points[i];
            const b = region.points[(i + 1) % region.points.length];
            for (let j = i + 2; j < region.points.length; j += 1) {
                if ((j + 1) % region.points.length === i) continue;
                if (segmentsIntersect(a, b, region.points[j], region.points[(j + 1) % region.points.length])) {
                    errors.push(`${region.id} 存在自相交边`);
                    i = region.points.length;
                    break;
                }
            }
        }
        if (region.type === 2) {
            if (!region.handlerId) warnings.push(`${region.id} 尚未设置 handlerId`);
            try { JSON.parse(region.payload || '{}'); } catch (_) { errors.push(`${region.id} 的 payload 不是有效 JSON`); }
        }
        if (region.type === 3 && (!region.targetSceneId || !region.targetSpawnId) && !region.overworldEntryId) {
            warnings.push(`${region.id} 尚未设置切景目标`);
        }
    }
    if (walkableCount === 0) warnings.push('当前没有 Walkable 区域');
    return { ok: errors.length === 0, sceneId: getCurrentSceneId(sceneId), errors, warnings, count: regions.length };
}

function toExportRegion(node, sceneId) {
    const region = serializeRegion(node);
    const size = getReferenceSize(sceneId);
    return {
        ...region,
        points: region.points.map((point) => ({
            x: Number((point.x / size.width + 0.5).toFixed(6)),
            y: Number((0.5 - point.y / size.height).toFixed(6)),
        })),
    };
}

function exportRegions() {
    const bootstrap = getLocationBootstrap();
    const locationId = bootstrap?.locationId || 'visitor-center';
    const root = ensureRegionEditor();
    ensureSceneGroup(getCurrentSceneId());
    const outputPath = path.join(Editor.Project.path, 'assets', 'resources', 'locations', locationId, 'regions.json');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    let document = { version: 1, locationId, referenceSize: {}, scenes: {} };
    if (fs.existsSync(outputPath)) {
        try { document = JSON.parse(fs.readFileSync(outputPath, 'utf8')); } catch (_) { /* replace invalid JSON */ }
    }
    document.version = 1;
    document.locationId = locationId;
    const currentSize = getReferenceSize();
    document.referenceSize = { width: currentSize.width, height: currentSize.height };
    document.scenes = document.scenes || {};
    const counts = {};
    for (const group of root.children.filter((child) => child.name.startsWith('Scene-'))) {
        const sceneId = group.name.slice('Scene-'.length);
        const regions = normalizeRegionNodes(group).map((node) => toExportRegion(node, sceneId));
        const perspective = readPerspectiveCalibration(group);
        const worldSize = getReferenceSize(sceneId);
        document.scenes[sceneId] = perspective
            ? { regions, perspective, worldSize }
            : { regions, worldSize };
        counts[sceneId] = regions.length;
    }
    fs.writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    return { outputPath, counts };
}

function setPreviewScene(sceneId) {
    const id = getCurrentSceneId(sceneId);
    const bootstrap = getLocationBootstrap();
    if (bootstrap) bootstrap.previewSceneId = id;
    ensureSceneGroup(id);
    return { sceneId: id };
}

exports.load = function load() {};
exports.unload = function unload() {};

exports.methods = {
    listSceneIds() {
        return listAvailableSceneIds();
    },
    listSpawnTargets(currentSceneId) {
        const sceneIds = listAvailableSceneIds();
        const targets = [];
        for (const sceneId of sceneIds) {
            const group = ensureSceneGroup(sceneId);
            for (const node of normalizeRegionNodes(group)) {
                const shape = getRegionComponent(node);
                if (Number(shape?.regionType) !== 5 || shape.enabledRegion === false) continue;
                targets.push({
                    sceneId,
                    spawnId: shape.regionId,
                    label: `${sceneId === currentSceneId ? '当前分镜 · ' : ''}${sceneId} / ${shape.regionId}`,
                });
            }
        }
        ensureSceneGroup(currentSceneId);
        return targets;
    },
    setPreviewScene,
    ensurePerspectiveCalibration,
    createRegularRegion,
    cleanupObsoleteSpawns,
    buildNamedTransitions,
    listRegions(sceneId) {
        return getRegionNodes(sceneId).map((node) => ({
            ...serializeRegion(node),
            nodeUuid: node.uuid,
        }));
    },
    setRegionProperties,
    addVertex,
    removeVertex,
    deleteRegion(id, sceneId) {
        const node = findRegion(id, sceneId);
        if (!node) return false;
        node.removeFromParent();
        node.destroy();
        return true;
    },
    validateRegions,
    exportRegions,
};
