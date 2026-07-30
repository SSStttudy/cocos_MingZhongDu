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
import { getStepForEntrance, TourStep } from './TourConfig';
import { TourGuideOverlay } from './TourGuideOverlay';
import { TourProgressStore } from './TourProgressStore';

const { ccclass } = _decorator;

export type OverworldTourEntranceContext = {
    id: string;
    entranceId: string;
    title: string;
    position: Vec2;
    triggerRadius: number;
};

export interface OverworldTourHost {
    readonly node: Node;
    getTourWorld(): Node;
    getTourPlayerPosition(): Vec2;
    getTourPathToEntrance(entranceId: string): Vec2[];
    setTourPaused(paused: boolean): void;
    finishTourCheckpoint(source: OverworldTourEntranceContext, targetEntranceId: string): void;
}
@ccclass('OverworldTourGuide')
export class OverworldTourGuide extends Component {
    private host: OverworldTourHost | null = null;
    private overlay: TourGuideOverlay | null = null;
    private dotsNode: Node | null = null;
    private dotsGraphics: Graphics | null = null;
    private elapsed = 0;
    private lastTargetEntranceId = '';
    private lastPathOrigin = new Vec2(Number.NaN, Number.NaN);

    initialize(host: OverworldTourHost): void {
        this.host = host;
        this.overlay = new TourGuideOverlay(host.node);
        this.overlay.root.setSiblingIndex(host.node.children.length - 1);
        this.refreshObjective(true);
        this.redrawRouteDots(true);
    }

    update(deltaTime: number): void {
        if (!this.host || !this.overlay) return;
        this.overlay.layout();
        this.elapsed += deltaTime;
        if (this.elapsed < 0.3) return;
        this.elapsed = 0;
        this.redrawRouteDots(false);
    }

    onDestroy(): void {
        this.overlay?.destroy();
        this.overlay = null;
    }

    handleEntrance(source: OverworldTourEntranceContext): boolean {
        if (!this.host || !this.overlay) return false;
        const arrivalStep = getStepForEntrance(source.entranceId);
        if (!arrivalStep) return false;

        const wasVisited = TourProgressStore.isVisited(arrivalStep.id);
        const anchor = arrivalStep.resumeAfter.kind === 'overworld'
            ? { kind: 'overworld' as const, entryId: source.id }
            : arrivalStep.resumeAfter;
        TourProgressStore.markVisited(arrivalStep.id, anchor);

        if (source.entranceId === 'location-1') {
            this.refreshObjective(true);
            return false;
        }

        this.host.setTourPaused(true);
        const nextTarget = this.getTargetEntranceId();
        if (wasVisited) {
            this.host.finishTourCheckpoint(source, nextTarget);
            this.host.setTourPaused(false);
            this.refreshObjective(false);
            return true;
        }

        this.overlay.setSpeech(arrivalStep.speech, 'explain');
        this.overlay.showCheckpoint(
            arrivalStep.title,
            arrivalStep.speech,
            () => {
                if (!this.host) return;
                this.host.finishTourCheckpoint(source, this.getTargetEntranceId());
                this.host.setTourPaused(false);
                this.refreshObjective(false);
                this.redrawRouteDots(true);
            },
        );
        this.refreshObjective(false);
        return true;
    }

    private refreshObjective(initial: boolean): void {
        if (!this.overlay) return;
        const step = TourProgressStore.getCurrentStep();
        if (!step) {
            this.overlay.setObjective('主线完成', '可自由游览各处遗址');
            this.overlay.setSpeech(
                '这条主线走完了。接下来可以自由看看，也可以重新开始导览。',
                'complete',
            );
            return;
        }
        this.overlay.setObjective(step.title, step.objective);
        this.overlay.setSpeech(step.speech, initial ? 'welcome' : 'pointing');
    }

    private getTargetEntranceId(): string {
        const step = TourProgressStore.getCurrentStep();
        if (!step) return '';
        if (step.kind === 'overworld-entrance') return step.entranceId ?? '';
        if (step.locationId === 'visitor-center') return 'location-1';
        return '';
    }

    private redrawRouteDots(force: boolean): void {
        if (!this.host) return;
        const targetEntranceId = this.getTargetEntranceId();
        const player = this.host.getTourPlayerPosition();
        if (
            !force
            && targetEntranceId === this.lastTargetEntranceId
            && Vec2.distance(player, this.lastPathOrigin) < 48
        ) return;
        this.lastTargetEntranceId = targetEntranceId;
        this.lastPathOrigin.set(player);
        this.ensureDotsLayer();
        this.dotsGraphics!.clear();
        if (!targetEntranceId) return;

        const path = this.host.getTourPathToEntrance(targetEntranceId);
        if (path.length < 2) return;
        const samples = this.samplePolyline(path, 54);
        for (let index = 0; index < samples.length; index += 1) {
            const point = samples[index];
            if (Vec2.distance(point, player) < 38) continue;
            const radius = index % 3 === 0 ? 7 : 5;
            this.dotsGraphics!.fillColor = index % 3 === 0
                ? new Color(247, 205, 105, 225)
                : new Color(255, 244, 196, 190);
            this.dotsGraphics!.circle(point.x, point.y, radius);
            this.dotsGraphics!.fill();
        }
    }

    private ensureDotsLayer(): void {
        if (!this.host) return;
        const world = this.host.getTourWorld();
        if (this.dotsNode?.isValid && this.dotsNode.parent === world) return;
        this.dotsNode?.destroy();
        this.dotsNode = new Node('TourRouteDots');
        this.dotsNode.layer = Layers.Enum.UI_2D;
        this.dotsNode.addComponent(UITransform);
        this.dotsGraphics = this.dotsNode.addComponent(Graphics);
        world.addChild(this.dotsNode);
        this.dotsNode.setSiblingIndex(Math.min(2, world.children.length - 1));
    }

    private samplePolyline(path: Vec2[], spacing: number): Vec2[] {
        const result: Vec2[] = [];
        let carry = 0;
        for (let index = 1; index < path.length; index += 1) {
            const start = path[index - 1];
            const end = path[index];
            const length = Vec2.distance(start, end);
            if (length < 0.001) continue;
            let distance = spacing - carry;
            while (distance <= length) {
                const t = distance / length;
                result.push(new Vec2(
                    start.x + (end.x - start.x) * t,
                    start.y + (end.y - start.y) * t,
                ));
                distance += spacing;
            }
            carry = Math.max(0, length - (distance - spacing));
        }
        return result.slice(0, 40);
    }
}
