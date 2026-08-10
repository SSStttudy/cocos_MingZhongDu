import {
    _decorator,
    Color,
    Component,
    Graphics,
    Layers,
    Node,
    Size,
    UITransform,
    Vec2,
} from 'cc';
import { LocationSceneConfig, LocationTransition } from '../location/LocationConfig';
import { TourStep } from '../tour/TourConfig';

const { ccclass } = _decorator;

type SceneEdge = { a: string; b: string; key: string };
type DirectedEdge = {
    from: string;
    to: string;
    key: string;
    direction: Vec2;
    targetDirection: Vec2;
};
type ExitMark = { sceneId: string; entryId: string; key: string; direction: Vec2 };
type HighlightState = {
    targetSceneId: string;
    recommendedEdgeKey: string;
    targetExitId: string;
};

const NODE_WIDTH = 46;
const NODE_HEIGHT = 24;
const COLUMN_GAP = 66;
const ROW_GAP = 42;
const COMPONENT_GAP = 52;

@ccclass('LocationMinimap')
export class LocationMinimap extends Component {
    private config: LocationSceneConfig | null = null;
    private getTourStep: (() => TourStep | null) | null = null;
    private currentSceneId = '';
    private root: Node | null = null;
    private content: Node | null = null;
    private graphGraphics: Graphics | null = null;
    private sceneEdges: SceneEdge[] = [];
    private directedEdges: DirectedEdge[] = [];
    private exits: ExitMark[] = [];
    private positions = new Map<string, Vec2>();
    private panelWidth = 0;
    private panelHeight = 0;
    private elapsed = 0;
    private lastStateKey = '';
    private warnedMissingTargets = new Set<string>();

    initialize(
        config: LocationSceneConfig,
        currentSceneId: string,
        getTourStep: () => TourStep | null,
    ): void {
        this.config = config;
        this.currentSceneId = currentSceneId;
        this.getTourStep = getTourStep;
        this.buildGraph();
        if (this.positions.size === 0) {
            console.warn(`[LocationMinimap] ${config.id} 没有可显示的分镜，已隐藏小地图。`);
            return;
        }
        this.createUi();
        this.lastStateKey = this.getStateKey();
        this.redraw();
    }

    setCurrentScene(sceneId: string): void {
        if (sceneId === this.currentSceneId) return;
        this.currentSceneId = sceneId;
        this.lastStateKey = this.getStateKey();
        this.redraw();
    }

    layout(visibleSize: Size): void {
        if (!this.root) return;
        const width = Math.max(250, Math.min(350, visibleSize.width * 0.3));
        const height = Math.max(120, Math.min(185, visibleSize.height * 0.27));
        const sizeChanged = Math.abs(width - this.panelWidth) > 0.5
            || Math.abs(height - this.panelHeight) > 0.5;
        this.panelWidth = width;
        this.panelHeight = height;
        this.root.getComponent(UITransform)?.setContentSize(width, height);
        this.root.setPosition(
            visibleSize.width * 0.5 - width * 0.5 - 8,
            visibleSize.height * 0.5 - height * 0.5 - 8,
            0,
        );
        if (sizeChanged) this.redraw();
    }

    shutdown(): void {
        this.root?.destroy();
        this.root = null;
        this.content = null;
        this.graphGraphics = null;
    }

    update(deltaTime: number): void {
        if (!this.root) return;
        this.elapsed += deltaTime;
        if (this.elapsed < 0.15) return;
        this.elapsed = 0;
        const stateKey = this.getStateKey();
        if (stateKey === this.lastStateKey) return;
        this.lastStateKey = stateKey;
        this.redraw();
    }

    onDestroy(): void {
        this.shutdown();
    }

    private buildGraph(): void {
        if (!this.config) return;
        const sceneIds = Object.keys(this.config.scenes).sort(this.compareSceneIds);
        const edgeKeys = new Set<string>();
        for (const sceneId of sceneIds) {
            const scene = this.config.scenes[sceneId];
            for (const transition of scene.transitions) {
                const direction = this.getTransitionDirection(sceneId, transition);
                if (transition.targetSceneId) {
                    if (!this.config.scenes[transition.targetSceneId]) {
                        const warningKey = `${sceneId}/${transition.id}/${transition.targetSceneId}`;
                        if (!this.warnedMissingTargets.has(warningKey)) {
                            this.warnedMissingTargets.add(warningKey);
                            console.warn(`[LocationMinimap] 忽略悬空切景 ${warningKey}。`);
                        }
                        continue;
                    }
                    const key = this.edgeKey(sceneId, transition.targetSceneId);
                    this.directedEdges.push({
                        from: sceneId,
                        to: transition.targetSceneId,
                        key,
                        direction,
                        targetDirection: this.getSpawnDirection(
                            transition.targetSceneId,
                            transition.targetSpawnId,
                            direction.clone().multiplyScalar(-1),
                        ),
                    });
                    if (!edgeKeys.has(key)) {
                        edgeKeys.add(key);
                        this.sceneEdges.push({ a: sceneId, b: transition.targetSceneId, key });
                    }
                }
                if (transition.overworldEntryId) {
                    this.exits.push({
                        sceneId,
                        entryId: transition.overworldEntryId,
                        key: `${sceneId}/${transition.id}`,
                        direction,
                    });
                }
            }
        }
        this.positions = this.layoutGraph(sceneIds);
    }

    /** Place connected scenes on the same side as their transition in the source photograph. */
    private layoutGraph(sceneIds: string[]): Map<string, Vec2> {
        const positions = new Map<string, Vec2>();
        const unvisited = new Set(sceneIds);
        const roots = [this.config?.initialSceneId ?? '', ...sceneIds]
            .filter((id, index, all) => id && all.indexOf(id) === index);
        let nextComponentY = 0;

        for (const root of roots) {
            if (!unvisited.has(root)) continue;
            const componentIds: string[] = [root];
            positions.set(root, new Vec2(0, nextComponentY));
            unvisited.delete(root);
            const queue = [root];
            while (queue.length > 0) {
                const sceneId = queue.shift()!;
                const origin = positions.get(sceneId)!;
                for (const neighbor of this.getNeighbors(sceneId)) {
                    if (!unvisited.has(neighbor)) continue;
                    const direction = this.getRelationDirection(sceneId, neighbor);
                    const desired = new Vec2(
                        origin.x + direction.x * COLUMN_GAP,
                        origin.y + direction.y * ROW_GAP,
                    );
                    const position = this.findFreePosition(desired, direction, positions);
                    positions.set(neighbor, position);
                    componentIds.push(neighbor);
                    unvisited.delete(neighbor);
                    queue.push(neighbor);
                }
            }
            const componentBottom = Math.min(...componentIds.map((id) => positions.get(id)!.y));
            nextComponentY = componentBottom - COMPONENT_GAP;
        }

        if (positions.size > 0) {
            const bounds = this.getPositionBounds(positions);
            const centerX = (bounds.minX + bounds.maxX) * 0.5;
            const centerY = (bounds.minY + bounds.maxY) * 0.5;
            for (const point of positions.values()) {
                point.x -= centerX;
                point.y -= centerY;
            }
        }
        return positions;
    }

    private getNeighbors(sceneId: string): string[] {
        const neighbors = new Set<string>();
        for (const edge of this.directedEdges) {
            if (edge.from === sceneId) neighbors.add(edge.to);
            if (edge.to === sceneId) neighbors.add(edge.from);
        }
        return [...neighbors].sort(this.compareSceneIds);
    }

    private getRelationDirection(from: string, to: string): Vec2 {
        const direct = this.directedEdges.find((edge) => edge.from === from && edge.to === to);
        if (direct) return direct.direction.clone();
        const reverse = this.directedEdges.find((edge) => edge.from === to && edge.to === from);
        if (reverse) return reverse.direction.clone().multiplyScalar(-1);
        return new Vec2(1, 0);
    }

    private findFreePosition(
        desired: Vec2,
        direction: Vec2,
        positions: Map<string, Vec2>,
    ): Vec2 {
        const offsets = [0, 1, -1, 2, -2, 3, -3];
        for (const offset of offsets) {
            const candidate = desired.clone();
            if (Math.abs(direction.x) >= Math.abs(direction.y)) candidate.y += offset * ROW_GAP;
            else candidate.x += offset * COLUMN_GAP;
            if (this.isPositionFree(candidate, positions)) return candidate;
        }
        return new Vec2(desired.x, desired.y - ROW_GAP * 4);
    }

    private isPositionFree(candidate: Vec2, positions: Map<string, Vec2>): boolean {
        for (const point of positions.values()) {
            if (
                Math.abs(candidate.x - point.x) < NODE_WIDTH + 10
                && Math.abs(candidate.y - point.y) < NODE_HEIGHT + 10
            ) return false;
        }
        return true;
    }

    private getTransitionDirection(sceneId: string, transition: LocationTransition): Vec2 {
        const scene = this.config?.scenes[sceneId];
        if (!scene || transition.polygon.length === 0) return new Vec2(1, 0);
        const center = new Vec2();
        for (const point of transition.polygon) center.add(point);
        center.multiplyScalar(1 / transition.polygon.length);
        const normalizedX = center.x / Math.max(1, scene.worldSize.width * 0.5);
        const normalizedY = center.y / Math.max(1, scene.worldSize.height * 0.5);
        // Horizontal placement is the primary cue in the panoramic photographs.
        if (Math.abs(normalizedX) >= 0.12) return new Vec2(Math.sign(normalizedX), 0);
        if (Math.abs(normalizedY) >= 0.12) return new Vec2(0, Math.sign(normalizedY));
        return new Vec2(1, 0);
    }

    private getSpawnDirection(sceneId: string, spawnId: string | undefined, fallback: Vec2): Vec2 {
        const scene = this.config?.scenes[sceneId];
        const spawn = scene?.spawns.find((item) => item.id === spawnId);
        if (!scene || !spawn) return fallback;
        const normalizedX = spawn.position.x / Math.max(1, scene.worldSize.width * 0.5);
        const normalizedY = spawn.position.y / Math.max(1, scene.worldSize.height * 0.5);
        if (Math.abs(normalizedX) >= 0.12) return new Vec2(Math.sign(normalizedX), 0);
        if (Math.abs(normalizedY) >= 0.12) return new Vec2(0, Math.sign(normalizedY));
        return fallback;
    }

    private createUi(): void {
        this.root = new Node('LocationMinimap');
        this.root.layer = Layers.Enum.UI_2D;
        this.root.addComponent(UITransform);
        this.node.addChild(this.root);
        const tourUiIndex = this.node.children.findIndex((child) => child.name === 'TourGuideUI');
        if (tourUiIndex >= 0) this.root.setSiblingIndex(tourUiIndex);

        this.content = new Node('MinimapGraph');
        this.content.layer = Layers.Enum.UI_2D;
        this.content.addComponent(UITransform);
        this.graphGraphics = this.content.addComponent(Graphics);
        this.root.addChild(this.content);
    }

    private redraw(): void {
        if (!this.content || !this.graphGraphics) return;
        for (const child of [...this.content.children]) child.destroy();
        this.graphGraphics.clear();
        this.drawGraph();
    }

    private drawGraph(): void {
        if (!this.content || !this.graphGraphics || this.positions.size === 0) return;
        const graph = this.graphGraphics;
        const highlight = this.getHighlightState();
        const exitPositions = this.getExitPositions();
        const bounds = this.getGraphBounds(exitPositions);
        const graphWidth = Math.max(1, bounds.maxX - bounds.minX);
        const graphHeight = Math.max(1, bounds.maxY - bounds.minY);
        const scale = Math.min(
            1,
            Math.max(1, this.panelWidth - 10) / graphWidth,
            Math.max(1, this.panelHeight - 10) / graphHeight,
        );
        const centerX = (bounds.minX + bounds.maxX) * 0.5;
        const centerY = (bounds.minY + bounds.maxY) * 0.5;
        this.content.setPosition(0, 0, 0);
        this.content.setScale(scale, scale, 1);

        for (const edge of this.sceneEdges) {
            const a = this.positions.get(edge.a);
            const b = this.positions.get(edge.b);
            if (!a || !b) continue;
            const directions = this.getEdgePortDirections(edge, a, b);
            const directionA = directions.a;
            const directionB = directions.b;
            const start = this.getPort(a, directionA);
            const end = this.getPort(b, directionB);
            const active = edge.key === highlight.recommendedEdgeKey;
            graph.strokeColor = active
                ? new Color(245, 184, 70, 255)
                : new Color(220, 231, 218, 205);
            graph.lineWidth = active ? 5 : 3;
            graph.moveTo(start.x - centerX, start.y - centerY);
            graph.bezierCurveTo(
                start.x + directionA.x * 18 - centerX,
                start.y + directionA.y * 18 - centerY,
                end.x + directionB.x * 18 - centerX,
                end.y + directionB.y * 18 - centerY,
                end.x - centerX,
                end.y - centerY,
            );
            graph.stroke();
        }

        for (const exit of this.exits) {
            const scene = this.positions.get(exit.sceneId);
            const exitPosition = exitPositions.get(exit.key);
            if (!scene || !exitPosition) continue;
            const active = exit.entryId === highlight.targetExitId;
            const port = this.getPort(scene, exit.direction);
            graph.strokeColor = active
                ? new Color(245, 184, 70, 255)
                : new Color(220, 231, 218, 185);
            graph.lineWidth = active ? 5 : 2;
            graph.moveTo(port.x - centerX, port.y - centerY);
            graph.lineTo(exitPosition.x - centerX, exitPosition.y - centerY);
            graph.stroke();
            graph.fillColor = active
                ? new Color(245, 184, 70, 255)
                : new Color(190, 205, 194, 235);
            const x = exitPosition.x - centerX;
            const y = exitPosition.y - centerY;
            graph.moveTo(x, y + 7);
            graph.lineTo(x + 7, y);
            graph.lineTo(x, y - 7);
            graph.lineTo(x - 7, y);
            graph.close();
            graph.fill();
        }

        for (const [sceneId, position] of this.positions) {
            this.createSceneNode(
                sceneId,
                position.x - centerX,
                position.y - centerY,
                sceneId === this.currentSceneId,
                sceneId === highlight.targetSceneId,
            );
        }
    }

    private getEdgePortDirections(edge: SceneEdge, a: Vec2, b: Vec2): { a: Vec2; b: Vec2 } {
        const forward = this.directedEdges.find(
            (item) => item.from === edge.a && item.to === edge.b,
        );
        if (forward) return { a: forward.direction, b: forward.targetDirection };
        const reverse = this.directedEdges.find(
            (item) => item.from === edge.b && item.to === edge.a,
        );
        if (reverse) return { a: reverse.targetDirection, b: reverse.direction };
        const delta = b.clone().subtract(a);
        if (Math.abs(delta.x) >= Math.abs(delta.y)) {
            const sign = Math.sign(delta.x) || 1;
            return { a: new Vec2(sign, 0), b: new Vec2(-sign, 0) };
        }
        const sign = Math.sign(delta.y) || 1;
        return { a: new Vec2(0, sign), b: new Vec2(0, -sign) };
    }

    private getPort(center: Vec2, direction: Vec2): Vec2 {
        return new Vec2(
            center.x + direction.x * NODE_WIDTH * 0.5,
            center.y + direction.y * NODE_HEIGHT * 0.5,
        );
    }

    private createSceneNode(
        sceneId: string,
        x: number,
        y: number,
        current: boolean,
        target: boolean,
    ): void {
        const node = new Node(`MinimapScene-${sceneId}`);
        node.layer = Layers.Enum.UI_2D;
        node.addComponent(UITransform).setContentSize(NODE_WIDTH, NODE_HEIGHT);
        const graphics = node.addComponent(Graphics);
        graphics.fillColor = target
            ? new Color(177, 119, 39, 225)
            : current
                ? new Color(43, 112, 114, 235)
                : new Color(42, 56, 57, 180);
        graphics.strokeColor = current && target
            ? new Color(157, 239, 226, 255)
            : target
                ? new Color(255, 226, 145, 255)
                : current
                    ? new Color(166, 244, 231, 255)
                    : new Color(218, 228, 215, 220);
        graphics.lineWidth = current || target ? 4 : 2;
        graphics.roundRect(-NODE_WIDTH * 0.5, -NODE_HEIGHT * 0.5, NODE_WIDTH, NODE_HEIGHT, 7);
        graphics.fill();
        graphics.stroke();
        node.setPosition(x, y, 0);
        this.content!.addChild(node);
    }

    private getHighlightState(): HighlightState {
        const result: HighlightState = {
            targetSceneId: '',
            recommendedEdgeKey: '',
            targetExitId: '',
        };
        const step = this.getTourStep?.();
        if (!step || !this.config || step.locationId !== this.config.id) return result;
        if (step.kind === 'location-region' && step.sceneId && this.config.scenes[step.sceneId]) {
            result.targetSceneId = step.sceneId;
            if (step.sceneId !== this.currentSceneId) {
                result.recommendedEdgeKey = this.findFirstPathEdge(this.currentSceneId, step.sceneId);
            }
        } else if (step.kind === 'return-overworld' && step.overworldEntryId) {
            result.targetExitId = step.overworldEntryId;
        }
        return result;
    }

    private findFirstPathEdge(start: string, target: string): string {
        if (start === target) return '';
        const queue: Array<{ sceneId: string; firstEdge: string }> = [{ sceneId: start, firstEdge: '' }];
        const visited = new Set<string>([start]);
        while (queue.length > 0) {
            const current = queue.shift()!;
            for (const edge of this.directedEdges) {
                if (edge.from !== current.sceneId || visited.has(edge.to)) continue;
                const firstEdge = current.firstEdge || edge.key;
                if (edge.to === target) return firstEdge;
                visited.add(edge.to);
                queue.push({ sceneId: edge.to, firstEdge });
            }
        }
        return '';
    }

    private getExitPositions(): Map<string, Vec2> {
        const positions = new Map<string, Vec2>();
        const sideCounts = new Map<string, number>();
        for (const exit of this.exits) {
            const scene = this.positions.get(exit.sceneId);
            if (!scene) continue;
            const side = `${exit.sceneId}/${exit.direction.x}/${exit.direction.y}`;
            const index = sideCounts.get(side) ?? 0;
            sideCounts.set(side, index + 1);
            const perpendicular = new Vec2(-exit.direction.y, exit.direction.x);
            positions.set(exit.key, new Vec2(
                scene.x + exit.direction.x * (NODE_WIDTH * 0.5 + 22) + perpendicular.x * index * 18,
                scene.y + exit.direction.y * (NODE_HEIGHT * 0.5 + 22) + perpendicular.y * index * 18,
            ));
        }
        return positions;
    }

    private getGraphBounds(exitPositions: Map<string, Vec2>): {
        minX: number; maxX: number; minY: number; maxY: number;
    } {
        const all = [...this.positions.values(), ...exitPositions.values()];
        if (all.length === 0) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
        return {
            minX: Math.min(...all.map((point) => point.x)) - NODE_WIDTH * 0.5 - 7,
            maxX: Math.max(...all.map((point) => point.x)) + NODE_WIDTH * 0.5 + 7,
            minY: Math.min(...all.map((point) => point.y)) - NODE_HEIGHT * 0.5 - 7,
            maxY: Math.max(...all.map((point) => point.y)) + NODE_HEIGHT * 0.5 + 7,
        };
    }

    private getPositionBounds(positions: Map<string, Vec2>): {
        minX: number; maxX: number; minY: number; maxY: number;
    } {
        const points = [...positions.values()];
        return {
            minX: Math.min(...points.map((point) => point.x)),
            maxX: Math.max(...points.map((point) => point.x)),
            minY: Math.min(...points.map((point) => point.y)),
            maxY: Math.max(...points.map((point) => point.y)),
        };
    }

    private getStateKey(): string {
        const step = this.getTourStep?.();
        return [
            this.currentSceneId,
            step?.id ?? '',
            step?.locationId ?? '',
            step?.sceneId ?? '',
            step?.overworldEntryId ?? '',
        ].join('|');
    }

    private edgeKey(a: string, b: string): string {
        return [a, b].sort(this.compareSceneIds).join('|');
    }

    private compareSceneIds = (a: string, b: string): number => (
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    );
}
