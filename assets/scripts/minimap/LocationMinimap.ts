import {
    _decorator,
    Color,
    Component,
    EventTouch,
    Graphics,
    Label,
    Layers,
    Node,
    Size,
    UITransform,
    Vec2,
} from 'cc';
import { LocationSceneConfig } from '../location/LocationConfig';
import { TourStep } from '../tour/TourConfig';

const { ccclass } = _decorator;

type SceneEdge = { a: string; b: string; key: string };
type DirectedEdge = { from: string; to: string; key: string };
type ExitMark = { sceneId: string; entryId: string; key: string };
type HighlightState = {
    targetSceneId: string;
    recommendedEdgeKey: string;
    targetExitId: string;
};

const NODE_WIDTH = 52;
const NODE_HEIGHT = 30;
const COLUMN_GAP = 70;
const ROW_GAP = 48;
const COMPONENT_GAP = 58;

@ccclass('LocationMinimap')
export class LocationMinimap extends Component {
    private config: LocationSceneConfig | null = null;
    private getTourStep: (() => TourStep | null) | null = null;
    private currentSceneId = '';
    private root: Node | null = null;
    private content: Node | null = null;
    private panelGraphics: Graphics | null = null;
    private graphGraphics: Graphics | null = null;
    private titleLabel: Label | null = null;
    private toggleLabel: Label | null = null;
    private sceneEdges: SceneEdge[] = [];
    private directedEdges: DirectedEdge[] = [];
    private exits: ExitMark[] = [];
    private positions = new Map<string, Vec2>();
    private collapsed = false;
    private panelWidth = 0;
    private panelHeight = 0;
    private visibleSize = new Size();
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
        this.visibleSize.set(visibleSize.width, visibleSize.height);
        const width = this.collapsed
            ? 84
            : Math.max(270, Math.min(390, visibleSize.width * 0.34));
        const height = this.collapsed
            ? 42
            : Math.max(145, Math.min(220, visibleSize.height * 0.3));
        const sizeChanged = Math.abs(width - this.panelWidth) > 0.5
            || Math.abs(height - this.panelHeight) > 0.5;
        this.panelWidth = width;
        this.panelHeight = height;
        this.root.getComponent(UITransform)?.setContentSize(width, height);
        this.root.setPosition(
            visibleSize.width * 0.5 - width * 0.5 - 24,
            visibleSize.height * 0.5 - height * 0.5 - 74,
            0,
        );
        if (sizeChanged) this.redraw();
    }

    shutdown(): void {
        this.root?.destroy();
        this.root = null;
        this.content = null;
        this.panelGraphics = null;
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
        const adjacency = new Map(sceneIds.map((id) => [id, new Set<string>()]));
        const edgeKeys = new Set<string>();
        for (const sceneId of sceneIds) {
            for (const transition of this.config.scenes[sceneId].transitions) {
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
                    adjacency.get(sceneId)?.add(transition.targetSceneId);
                    adjacency.get(transition.targetSceneId)?.add(sceneId);
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
                    });
                }
            }
        }
        this.positions = this.layoutGraph(sceneIds, adjacency);
    }

    private layoutGraph(
        sceneIds: string[],
        adjacency: Map<string, Set<string>>,
    ): Map<string, Vec2> {
        const positions = new Map<string, Vec2>();
        const unvisited = new Set(sceneIds);
        const roots = [this.config?.initialSceneId ?? '', ...sceneIds]
            .filter((id, index, all) => id && all.indexOf(id) === index);
        let componentTop = 0;

        for (const requestedRoot of roots) {
            if (!unvisited.has(requestedRoot)) continue;
            const component: string[] = [];
            const discover = [requestedRoot];
            unvisited.delete(requestedRoot);
            while (discover.length > 0) {
                const sceneId = discover.shift()!;
                component.push(sceneId);
                const neighbors = [...(adjacency.get(sceneId) ?? [])].sort(this.compareSceneIds);
                for (const neighbor of neighbors) {
                    if (!unvisited.has(neighbor)) continue;
                    unvisited.delete(neighbor);
                    discover.push(neighbor);
                }
            }

            const levels = new Map<string, number>([[requestedRoot, 0]]);
            const queue = [requestedRoot];
            while (queue.length > 0) {
                const sceneId = queue.shift()!;
                const nextLevel = (levels.get(sceneId) ?? 0) + 1;
                const neighbors = [...(adjacency.get(sceneId) ?? [])].sort(this.compareSceneIds);
                for (const neighbor of neighbors) {
                    if (levels.has(neighbor)) continue;
                    levels.set(neighbor, nextLevel);
                    queue.push(neighbor);
                }
            }

            const grouped = new Map<number, string[]>();
            for (const sceneId of component) {
                const level = levels.get(sceneId) ?? 0;
                const group = grouped.get(level) ?? [];
                group.push(sceneId);
                grouped.set(level, group);
            }
            const maxRows = Math.max(1, ...[...grouped.values()].map((group) => group.length));
            const componentHeight = Math.max(NODE_HEIGHT, (maxRows - 1) * ROW_GAP + NODE_HEIGHT);
            const centerY = componentTop - componentHeight * 0.5;
            for (const [level, group] of [...grouped.entries()].sort((a, b) => a[0] - b[0])) {
                group.sort(this.compareSceneIds);
                group.forEach((sceneId, index) => {
                    positions.set(sceneId, new Vec2(
                        level * COLUMN_GAP,
                        centerY + ((group.length - 1) * 0.5 - index) * ROW_GAP,
                    ));
                });
            }
            componentTop -= componentHeight + COMPONENT_GAP;
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

    private createUi(): void {
        this.root = new Node('LocationMinimap');
        this.root.layer = Layers.Enum.UI_2D;
        this.root.addComponent(UITransform);
        this.panelGraphics = this.root.addComponent(Graphics);
        this.node.addChild(this.root);
        const tourUiIndex = this.node.children.findIndex((child) => child.name === 'TourGuideUI');
        if (tourUiIndex >= 0) this.root.setSiblingIndex(tourUiIndex);

        const title = new Node('MinimapTitle');
        title.layer = Layers.Enum.UI_2D;
        title.addComponent(UITransform).setContentSize(180, 30);
        this.titleLabel = title.addComponent(Label);
        this.titleLabel.string = '分镜导览';
        this.titleLabel.fontSize = 18;
        this.titleLabel.lineHeight = 24;
        this.titleLabel.color = new Color(246, 235, 198, 255);
        this.root.addChild(title);

        const toggle = new Node('MinimapToggle');
        toggle.layer = Layers.Enum.UI_2D;
        toggle.addComponent(UITransform).setContentSize(64, 32);
        const toggleGraphics = toggle.addComponent(Graphics);
        toggleGraphics.fillColor = new Color(62, 76, 76, 225);
        toggleGraphics.strokeColor = new Color(232, 220, 178, 210);
        toggleGraphics.lineWidth = 2;
        toggleGraphics.roundRect(-32, -16, 64, 32, 10);
        toggleGraphics.fill();
        toggleGraphics.stroke();
        const toggleText = new Node('ToggleLabel');
        toggleText.layer = Layers.Enum.UI_2D;
        toggleText.addComponent(UITransform).setContentSize(60, 28);
        this.toggleLabel = toggleText.addComponent(Label);
        this.toggleLabel.fontSize = 15;
        this.toggleLabel.lineHeight = 22;
        this.toggleLabel.color = new Color(255, 248, 220, 255);
        toggle.addChild(toggleText);
        toggle.on(Node.EventType.TOUCH_END, this.toggleCollapsed, this);
        this.root.addChild(toggle);

        this.content = new Node('MinimapGraph');
        this.content.layer = Layers.Enum.UI_2D;
        this.content.addComponent(UITransform);
        this.graphGraphics = this.content.addComponent(Graphics);
        this.root.addChild(this.content);
    }

    private redraw(): void {
        if (!this.root || !this.content || !this.panelGraphics || !this.graphGraphics) return;
        this.drawPanel();
        for (const child of [...this.content.children]) child.destroy();
        this.graphGraphics.clear();
        this.titleLabel!.node.active = !this.collapsed;
        this.content.active = !this.collapsed;
        const toggle = this.root.getChildByName('MinimapToggle');
        if (toggle) {
            toggle.setPosition(
                this.collapsed ? 0 : this.panelWidth * 0.5 - 46,
                this.collapsed ? 0 : this.panelHeight * 0.5 - 24,
                0,
            );
        }
        if (this.toggleLabel) this.toggleLabel.string = this.collapsed ? '地图' : '收起';
        if (this.collapsed) return;
        this.titleLabel!.node.setPosition(
            -this.panelWidth * 0.5 + 105,
            this.panelHeight * 0.5 - 25,
            0,
        );
        this.drawGraph();
    }

    private drawPanel(): void {
        const graphics = this.panelGraphics!;
        graphics.clear();
        graphics.fillColor = new Color(25, 38, 41, 205);
        graphics.strokeColor = new Color(235, 224, 183, 205);
        graphics.lineWidth = 2;
        graphics.roundRect(
            -this.panelWidth * 0.5,
            -this.panelHeight * 0.5,
            this.panelWidth,
            this.panelHeight,
            this.collapsed ? 12 : 16,
        );
        graphics.fill();
        graphics.stroke();
    }

    private drawGraph(): void {
        if (!this.content || !this.graphGraphics || this.positions.size === 0) return;
        const graph = this.graphGraphics;
        const highlight = this.getHighlightState();
        const exitPositions = this.getExitPositions();
        const bounds = this.getGraphBounds(exitPositions);
        const graphWidth = Math.max(1, bounds.maxX - bounds.minX);
        const graphHeight = Math.max(1, bounds.maxY - bounds.minY);
        const availableWidth = Math.max(1, this.panelWidth - 28);
        const availableHeight = Math.max(1, this.panelHeight - 60);
        const scale = Math.min(1, availableWidth / graphWidth, availableHeight / graphHeight);
        const centerX = (bounds.minX + bounds.maxX) * 0.5;
        const centerY = (bounds.minY + bounds.maxY) * 0.5;
        this.content.setPosition(0, -16, 0);
        this.content.setScale(scale, scale, 1);

        for (const edge of this.sceneEdges) {
            const a = this.positions.get(edge.a);
            const b = this.positions.get(edge.b);
            if (!a || !b) continue;
            graph.strokeColor = edge.key === highlight.recommendedEdgeKey
                ? new Color(239, 178, 67, 255)
                : new Color(143, 164, 160, 185);
            graph.lineWidth = edge.key === highlight.recommendedEdgeKey ? 6 : 3;
            graph.moveTo(a.x - centerX, a.y - centerY);
            graph.lineTo(b.x - centerX, b.y - centerY);
            graph.stroke();
        }

        for (const exit of this.exits) {
            const scene = this.positions.get(exit.sceneId);
            const exitPosition = exitPositions.get(exit.key);
            if (!scene || !exitPosition) continue;
            const active = exit.entryId === highlight.targetExitId;
            graph.strokeColor = active
                ? new Color(239, 178, 67, 255)
                : new Color(143, 164, 160, 160);
            graph.lineWidth = active ? 5 : 2;
            graph.moveTo(scene.x - centerX, scene.y - centerY);
            graph.lineTo(exitPosition.x - centerX, exitPosition.y - centerY);
            graph.stroke();
            graph.fillColor = active
                ? new Color(239, 178, 67, 255)
                : new Color(116, 139, 136, 235);
            const x = exitPosition.x - centerX;
            const y = exitPosition.y - centerY;
            graph.moveTo(x, y + 8);
            graph.lineTo(x + 8, y);
            graph.lineTo(x, y - 8);
            graph.lineTo(x - 8, y);
            graph.close();
            graph.fill();
            this.createGraphLabel(this.exitLabel(exit.entryId), x, y - 17, 12, 54);
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
            ? new Color(174, 117, 39, 245)
            : current
                ? new Color(48, 115, 116, 245)
                : new Color(65, 82, 83, 235);
        graphics.strokeColor = current && target
            ? new Color(158, 232, 222, 255)
            : target
                ? new Color(255, 224, 142, 255)
                : current
                    ? new Color(170, 239, 229, 255)
                    : new Color(188, 198, 184, 205);
        graphics.lineWidth = current || target ? 4 : 2;
        graphics.roundRect(-NODE_WIDTH * 0.5, -NODE_HEIGHT * 0.5, NODE_WIDTH, NODE_HEIGHT, 8);
        graphics.fill();
        graphics.stroke();
        node.setPosition(x, y, 0);
        this.content!.addChild(node);

        const labelNode = new Node('SceneLabel');
        labelNode.layer = Layers.Enum.UI_2D;
        labelNode.addComponent(UITransform).setContentSize(NODE_WIDTH - 4, NODE_HEIGHT - 2);
        const label = labelNode.addComponent(Label);
        label.string = this.sceneLabel(sceneId);
        label.fontSize = 15;
        label.lineHeight = 20;
        label.color = new Color(255, 249, 226, 255);
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        node.addChild(labelNode);
    }

    private createGraphLabel(text: string, x: number, y: number, fontSize: number, width: number): void {
        const node = new Node('ExitLabel');
        node.layer = Layers.Enum.UI_2D;
        node.addComponent(UITransform).setContentSize(width, 18);
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = fontSize;
        label.lineHeight = 16;
        label.color = new Color(218, 224, 208, 245);
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
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
        const byScene = new Map<string, ExitMark[]>();
        for (const exit of this.exits) {
            const list = byScene.get(exit.sceneId) ?? [];
            list.push(exit);
            byScene.set(exit.sceneId, list);
        }
        for (const [sceneId, exits] of byScene) {
            const scene = this.positions.get(sceneId);
            if (!scene) continue;
            exits.sort((a, b) => a.entryId.localeCompare(b.entryId));
            exits.forEach((exit, index) => positions.set(
                exit.key,
                new Vec2(
                    scene.x + (index - (exits.length - 1) * 0.5) * 34,
                    scene.y - 48,
                ),
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
            minX: Math.min(...all.map((point) => point.x)) - NODE_WIDTH * 0.5 - 8,
            maxX: Math.max(...all.map((point) => point.x)) + NODE_WIDTH * 0.5 + 8,
            minY: Math.min(...all.map((point) => point.y)) - 32,
            maxY: Math.max(...all.map((point) => point.y)) + NODE_HEIGHT * 0.5 + 8,
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

    private toggleCollapsed(event?: EventTouch): void {
        if (event) event.propagationStopped = true;
        this.collapsed = !this.collapsed;
        this.panelWidth = 0;
        this.panelHeight = 0;
        this.layout(this.visibleSize);
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

    private sceneLabel(sceneId: string): string {
        return ({
            'entrance-gate': '入口',
            'main-road': '主路',
            'cafe-garden': '庭院',
            'leisure-plaza': '广场',
            'visitor-building': '展馆',
            exterior: '外院',
            interior: '室内',
            main: '全景',
        } as Record<string, string>)[sceneId] ?? sceneId;
    }

    private exitLabel(entryId: string): string {
        if (entryId.includes('-west-')) return '西出口';
        if (entryId.includes('-east-')) return '东出口';
        if (entryId.includes('-north-')) return '北出口';
        if (entryId.includes('-south-')) return '南出口';
        return '出口';
    }

    private compareSceneIds = (a: string, b: string): number => (
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    );
}
