import {
    _decorator,
    Color,
    Component,
    Graphics,
    Layers,
    Node,
    UITransform,
    Vec2,
} from 'cc';

const { ccclass, executeInEditMode, property } = _decorator;

@ccclass('OcclusionLineShape')
@executeInEditMode
export class OcclusionLineShape extends Component {
    @property
    lineId = 'occlusion-line';

    @property
    enabledLine = true;

    @property({ tooltip: '前景图片在 resources 中的文件名（不含扩展名）' })
    foregroundAsset = '';

    private lastHash = '';

    onLoad(): void {
        this.ensureDrawingComponents();
        this.redraw();
    }

    update(): void {
        const [start, end] = this.getPointNodes();
        const hash = start && end
            ? `${start.position.x.toFixed(2)}|${start.position.y.toFixed(2)}|${end.position.x.toFixed(2)}|${end.position.y.toFixed(2)}`
            : '';
        if (hash === this.lastHash) return;
        this.lastHash = hash;
        this.redraw();
    }

    getPoints(): Vec2[] {
        return this.getPointNodes().map((node) => new Vec2(node.position.x, node.position.y));
    }

    redraw(): void {
        this.ensureDrawingComponents();
        const graphics = this.getComponent(Graphics)!;
        const points = this.getPoints();
        graphics.clear();
        if (points.length !== 2) return;
        graphics.strokeColor = new Color(255, 207, 48, 255);
        graphics.lineWidth = 6;
        graphics.moveTo(points[0].x, points[0].y);
        graphics.lineTo(points[1].x, points[1].y);
        graphics.stroke();
        this.drawPointMarkers();
    }

    private ensureDrawingComponents(): void {
        this.node.layer = Layers.Enum.UI_2D;
        if (!this.getComponent(UITransform)) this.node.addComponent(UITransform).setContentSize(1365, 1024);
        if (!this.getComponent(Graphics)) this.node.addComponent(Graphics);
    }

    private getPointNodes(): Node[] {
        return this.node.children
            .filter((child) => child.name === 'Point-A' || child.name === 'Point-B')
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    private drawPointMarkers(): void {
        for (const point of this.getPointNodes()) {
            point.layer = Layers.Enum.UI_2D;
            if (!point.getComponent(UITransform)) point.addComponent(UITransform).setContentSize(28, 28);
            let graphics = point.getComponent(Graphics);
            if (!graphics) graphics = point.addComponent(Graphics);
            graphics.clear();
            graphics.fillColor = new Color(255, 250, 225, 255);
            graphics.strokeColor = new Color(255, 207, 48, 255);
            graphics.lineWidth = 4;
            graphics.circle(0, 0, 9);
            graphics.fill();
            graphics.stroke();
        }
    }
}
