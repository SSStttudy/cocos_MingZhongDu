import {
    _decorator,
    Color,
    Component,
    Enum,
    Graphics,
    Layers,
    Node,
    UITransform,
    Vec2,
} from 'cc';

const { ccclass, executeInEditMode, property } = _decorator;

export enum RegionType {
    Walkable = 0,
    Obstacle = 1,
    Interaction = 2,
    Transition = 3,
    Occlusion = 4,
    Spawn = 5,
}

Enum(RegionType);

@ccclass('RegionShape')
@executeInEditMode
export class RegionShape extends Component {
    @property
    regionId = 'region';

    @property({ type: Enum(RegionType) })
    regionType = RegionType.Walkable;

    @property
    enabledRegion = true;

    @property
    priority = 0;

    @property({ tooltip: 'Interaction：运行时处理器 ID' })
    handlerId = '';

    @property({ tooltip: 'Interaction：靠近时显示的提示' })
    prompt = '';

    @property({ tooltip: 'Interaction：enter 或 button' })
    triggerMode = 'button';

    @property({ tooltip: 'Interaction：附加 JSON 字符串' })
    payload = '{}';

    @property({ tooltip: 'Transition：目标分镜 ID' })
    targetSceneId = '';

    @property({ tooltip: 'Transition：目标出生点 ID' })
    targetSpawnId = '';

    @property({ tooltip: 'Transition：返回大地图入口 ID' })
    overworldEntryId = '';

    private lastHash = '';

    onLoad(): void {
        this.ensureDrawingComponents();
        this.redraw();
    }

    update(): void {
        const positionValues: string[] = [];
        for (const vertex of this.getVertexNodes()) {
            positionValues.push(vertex.position.x.toFixed(2), vertex.position.y.toFixed(2));
        }
        const hash = [
            this.regionType,
            this.enabledRegion ? 1 : 0,
            ...positionValues,
        ].join('|');
        if (hash === this.lastHash) return;
        this.lastHash = hash;
        this.redraw();
    }

    getPoints(): Vec2[] {
        return this.getVertexNodes().map((node) => new Vec2(node.position.x, node.position.y));
    }

    redraw(): void {
        this.ensureDrawingComponents();
        const graphics = this.getComponent(Graphics)!;
        const points = this.getPoints();
        graphics.clear();
        if (points.length < 3) return;

        const colors = this.getColors();
        graphics.fillColor = colors.fill;
        graphics.strokeColor = colors.stroke;
        graphics.lineWidth = 4;
        graphics.moveTo(points[0].x, points[0].y);
        for (let index = 1; index < points.length; index += 1) {
            graphics.lineTo(points[index].x, points[index].y);
        }
        graphics.close();
        graphics.fill();
        graphics.stroke();
        this.drawVertexMarkers(colors.stroke);
    }

    private ensureDrawingComponents(): void {
        this.node.layer = Layers.Enum.UI_2D;
        if (!this.getComponent(UITransform)) this.node.addComponent(UITransform).setContentSize(1365, 1024);
        if (!this.getComponent(Graphics)) this.node.addComponent(Graphics);
    }

    private getVertexNodes(): Node[] {
        return this.node.children
            .filter((child) => child.name.startsWith('Vertex-'))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    private drawVertexMarkers(color: Color): void {
        for (const vertex of this.getVertexNodes()) {
            vertex.layer = Layers.Enum.UI_2D;
            if (!vertex.getComponent(UITransform)) vertex.addComponent(UITransform).setContentSize(24, 24);
            let graphics = vertex.getComponent(Graphics);
            if (!graphics) graphics = vertex.addComponent(Graphics);
            graphics.clear();
            graphics.fillColor = new Color(255, 250, 225, 255);
            graphics.strokeColor = color;
            graphics.lineWidth = 4;
            graphics.circle(0, 0, 8);
            graphics.fill();
            graphics.stroke();
        }
    }

    private getColors(): { fill: Color; stroke: Color } {
        switch (this.regionType) {
            case RegionType.Obstacle:
                return { fill: new Color(206, 69, 56, 72), stroke: new Color(150, 42, 34, 245) };
            case RegionType.Interaction:
                return { fill: new Color(238, 191, 55, 82), stroke: new Color(169, 119, 19, 245) };
            case RegionType.Transition:
                return { fill: new Color(56, 148, 222, 82), stroke: new Color(28, 91, 153, 245) };
            case RegionType.Occlusion:
                return { fill: new Color(151, 90, 203, 72), stroke: new Color(99, 50, 147, 245) };
            case RegionType.Spawn:
                return { fill: new Color(71, 176, 231, 105), stroke: new Color(20, 105, 155, 255) };
            default:
                return { fill: new Color(63, 188, 146, 62), stroke: new Color(27, 123, 91, 245) };
        }
    }
}
