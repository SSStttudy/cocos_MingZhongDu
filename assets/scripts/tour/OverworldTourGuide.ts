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
import { getTourStepDisplayTitle, TOUR_STEPS } from './TourConfig';
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
    getTourPathToEntrance(entranceId: string, entryPointId?: string): Vec2[];
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
        this.overlay.update(deltaTime);
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
        const discovered = TOUR_STEPS.find((step) => (
            step.kind === 'overworld-entrance' && step.entranceId === source.entranceId
        ));
        if (discovered) TourProgressStore.markDiscovered(discovered.id);

        const current = TourProgressStore.getCurrentStep();
        if (
            current?.kind === 'overworld-entrance'
            && current.entranceId === source.entranceId
            && (!current.entryPointId || current.entryPointId === source.id)
        ) {
            TourProgressStore.markVisited(current.id, current.resumeAfter);
            this.refreshObjective(false);
            this.redrawRouteDots(true);
        }
        // 进入地点仍交给 OverworldBootstrap，导览只记录当前“到达”步骤。
        return false;
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
        this.overlay.setObjective(getTourStepDisplayTitle(step), step.objective);
        this.overlay.setSpeech(step.speech, initial ? 'welcome' : 'pointing');
    }

    private getTargetEntranceId(): string {
        const step = TourProgressStore.getCurrentStep();
        if (!step) return '';
        if (step.kind === 'overworld-entrance') return step.entranceId ?? '';
        if (step.kind === 'return-overworld') {
            return ({
                'visitor-center': 'location-1',
                'location-2': 'location-2',
                'location-2-5': 'location-2-5',
                'location-3': 'location-3',
                'location-4': 'location-4',
            } as Record<string, string>)[step.locationId ?? ''] ?? '';
        }
        return '';
    }

    private getTargetEntryPointId(): string {
        const step = TourProgressStore.getCurrentStep();
        if (step?.kind === 'overworld-entrance') return step.entryPointId ?? '';
        if (step?.kind === 'return-overworld') return step.overworldEntryId ?? '';
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

        const path = this.host.getTourPathToEntrance(
            targetEntranceId,
            this.getTargetEntryPointId(),
        );
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
