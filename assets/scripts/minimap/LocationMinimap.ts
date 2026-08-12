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
import { LocationSceneConfig } from '../location/LocationConfig';
import { TourStep } from '../tour/TourConfig';
import {
    LOCATION_MINIMAP_LAYOUTS,
    MinimapNodeLayout,
} from './LocationMinimapLayout';

const { ccclass } = _decorator;

type SceneEdge = { a: string; b: string; key: string };
type DirectedEdge = { from: string; to: string; key: string };
type ExitMark = {
    sceneId: string;
    entryId: string;
    key: string;
    position: Vec2;
};
type HighlightState = {
    targetSceneId: string;
    recommendedEdgeKey: string;
    targetExitId: string;
};

const DEFAULT_NODE_SIZE = 30;

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
    private nodeLayouts = new Map<string, MinimapNodeLayout>();
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
        if (this.nodeLayouts.size === 0) {
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
        const width = Math.max(240, Math.min(350, visibleSize.width * 0.3));
        const height = Math.max(140, Math.min(230, visibleSize.height * 0.33));
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
        const layout = LOCATION_MINIMAP_LAYOUTS[this.config.id];
        sceneIds.forEach((sceneId, index) => {
            const node = layout?.nodes[sceneId];
            this.nodeLayouts.set(sceneId, node ?? {
                x: index * 48,
                y: 0,
                width: DEFAULT_NODE_SIZE,
                height: DEFAULT_NODE_SIZE,
                radius: DEFAULT_NODE_SIZE * 0.5,
            });
        });

        const edgeKeys = new Set<string>();
        for (const sceneId of sceneIds) {
            const scene = this.config.scenes[sceneId];
            for (const transition of scene.transitions) {
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
                    this.directedEdges.push({ from: sceneId, to: transition.targetSceneId, key });
                    if (!edgeKeys.has(key)) {
                        edgeKeys.add(key);
                        this.sceneEdges.push({ a: sceneId, b: transition.targetSceneId, key });
                    }
                }
                if (transition.overworldEntryId) {
                    const configured = layout?.exits.find((item) => (
                        item.sceneId === sceneId
                        && item.entryId === transition.overworldEntryId
                    ));
                    const node = this.nodeLayouts.get(sceneId)!;
                    this.exits.push({
                        sceneId,
                        entryId: transition.overworldEntryId,
                        key: `${sceneId}/${transition.id}`,
                        position: configured
                            ? new Vec2(configured.x, configured.y)
                            : new Vec2(node.x, node.y - 55),
                    });
                }
            }
        }
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
        if (!this.content || !this.graphGraphics || this.nodeLayouts.size === 0) return;
        const graph = this.graphGraphics;
        const highlight = this.getHighlightState();
        const bounds = this.getGraphBounds();
        const graphWidth = Math.max(1, bounds.maxX - bounds.minX);
        const graphHeight = Math.max(1, bounds.maxY - bounds.minY);
        const scale = Math.min(
            1,
            Math.max(1, this.panelWidth - 10) / graphWidth,
            Math.max(1, this.panelHeight - 10) / graphHeight,
        );
        const center = new Vec2(
            (bounds.minX + bounds.maxX) * 0.5,
            (bounds.minY + bounds.maxY) * 0.5,
        );
        this.content.setPosition(0, 0, 0);
        this.content.setScale(scale, scale, 1);

        for (const edge of this.sceneEdges) {
            const a = this.nodeLayouts.get(edge.a);
            const b = this.nodeLayouts.get(edge.b);
            if (!a || !b) continue;
            const start = this.getBoundaryPoint(a, new Vec2(b.x, b.y));
            const end = this.getBoundaryPoint(b, new Vec2(a.x, a.y));
            const active = edge.key === highlight.recommendedEdgeKey;
            graph.strokeColor = active
                ? new Color(245, 184, 70, 255)
                : new Color(220, 231, 218, 215);
            graph.lineWidth = active ? 5 : 3;
            graph.moveTo(start.x - center.x, start.y - center.y);
            graph.lineTo(end.x - center.x, end.y - center.y);
            graph.stroke();
        }

        for (const exit of this.exits) {
            const node = this.nodeLayouts.get(exit.sceneId);
            if (!node) continue;
            const start = this.getBoundaryPoint(node, exit.position);
            const active = exit.entryId === highlight.targetExitId;
            graph.strokeColor = active
                ? new Color(245, 184, 70, 255)
                : new Color(220, 231, 218, 195);
            graph.lineWidth = active ? 5 : 2;
            graph.moveTo(start.x - center.x, start.y - center.y);
            graph.lineTo(exit.position.x - center.x, exit.position.y - center.y);
            graph.stroke();
            graph.fillColor = active
                ? new Color(245, 184, 70, 255)
                : new Color(190, 205, 194, 235);
            const x = exit.position.x - center.x;
            const y = exit.position.y - center.y;
            graph.moveTo(x, y + 7);
            graph.lineTo(x + 7, y);
            graph.lineTo(x, y - 7);
            graph.lineTo(x - 7, y);
            graph.close();
            graph.fill();
        }

        for (const [sceneId, nodeLayout] of this.nodeLayouts) {
            this.createSceneNode(
                sceneId,
                nodeLayout,
                center,
                sceneId === this.currentSceneId,
                sceneId === highlight.targetSceneId,
            );
        }
    }

    private getBoundaryPoint(node: MinimapNodeLayout, toward: Vec2): Vec2 {
        const dx = toward.x - node.x;
        const dy = toward.y - node.y;
        const halfWidth = Math.max(1, (node.width ?? DEFAULT_NODE_SIZE) * 0.5);
        const halfHeight = Math.max(1, (node.height ?? DEFAULT_NODE_SIZE) * 0.5);
        const divisor = Math.max(Math.abs(dx) / halfWidth, Math.abs(dy) / halfHeight, 0.001);
        return new Vec2(node.x + dx / divisor, node.y + dy / divisor);
    }

    private createSceneNode(
        sceneId: string,
        layout: MinimapNodeLayout,
        center: Vec2,
        current: boolean,
        target: boolean,
    ): void {
        const width = layout.width ?? DEFAULT_NODE_SIZE;
        const height = layout.height ?? DEFAULT_NODE_SIZE;
        const radius = Math.min(layout.radius ?? Math.min(width, height) * 0.5, width * 0.5, height * 0.5);
        const node = new Node(`MinimapScene-${sceneId}`);
        node.layer = Layers.Enum.UI_2D;
        node.addComponent(UITransform).setContentSize(width, height);
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
        graphics.roundRect(-width * 0.5, -height * 0.5, width, height, radius);
        graphics.fill();
        graphics.stroke();
        node.setPosition(layout.x - center.x, layout.y - center.y, 0);
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

    private getGraphBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
        const minX: number[] = [];
        const maxX: number[] = [];
        const minY: number[] = [];
        const maxY: number[] = [];
        for (const layout of this.nodeLayouts.values()) {
            const halfWidth = (layout.width ?? DEFAULT_NODE_SIZE) * 0.5;
            const halfHeight = (layout.height ?? DEFAULT_NODE_SIZE) * 0.5;
            minX.push(layout.x - halfWidth);
            maxX.push(layout.x + halfWidth);
            minY.push(layout.y - halfHeight);
            maxY.push(layout.y + halfHeight);
        }
        for (const exit of this.exits) {
            minX.push(exit.position.x - 8);
            maxX.push(exit.position.x + 8);
            minY.push(exit.position.y - 8);
            maxY.push(exit.position.y + 8);
        }
        return {
            minX: Math.min(...minX) - 5,
            maxX: Math.max(...maxX) + 5,
            minY: Math.min(...minY) - 5,
            maxY: Math.max(...maxY) + 5,
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
