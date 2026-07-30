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
import { TourGuideOverlay } from './TourGuideOverlay';
import { TourProgressStore } from './TourProgressStore';

const { ccclass } = _decorator;

const LOCATION_MARKER_SCALE = 1.3;
const LOCATION_MARKER_MIN_PERSPECTIVE_SCALE = 0.1;
const LOCATION_MARKER_PULSE_PERIOD = 5;
const LOCATION_MARKER_PULSE_DURATION = 0.4;
const LOCATION_MARKER_PULSE_AMOUNT = 0.16;

export type LocationTourTarget = {
    id: string;
    polygon: Vec2[];
    kind: 'location' | 'interaction' | 'transition';
};

export interface LocationTourHost {
    readonly node: Node;
    getTourWorld(): Node;
    getTourLocationId(): string;
    getTourSceneId(): string;
    getTourPlayerPosition(): Vec2;
    getTourPerspectiveScale(y: number): number;
    getTourApproachPoint(polygon: Vec2[], distance: number): Vec2;
    getTourRegion(sceneId: string, regionId: string): LocationTourTarget | null;
    getTourTransitionToward(targetSceneId?: string, overworldEntryId?: string): LocationTourTarget | null;
    setTourPaused(paused: boolean): void;
}

@ccclass('LocationTourGuide')
export class LocationTourGuide extends Component {
    private host: LocationTourHost | null = null;
    private overlay: TourGuideOverlay | null = null;
    private marker: Node | null = null;
    private markerGraphics: Graphics | null = null;
    private routeDots: Node | null = null;
    private routeGraphics: Graphics | null = null;
    private elapsed = 0;
    private markerAnimationTime = 0;
    private missingWarnings = new Set<string>();
    private lastStepId = '';
    private completing = false;

    initialize(host: LocationTourHost): void {
        this.host = host;
        const initialStep = TourProgressStore.getCurrentStep();
        // Directly previewing LocationTemplate bypasses the overworld entrance.
        // Treat the visitor-center arrival as complete so testing starts at Wang.
        if (
            initialStep?.id === 'visitor-center-enter'
            && host.getTourLocationId() === 'visitor-center'
        ) {
            TourProgressStore.markVisited(initialStep.id, initialStep.resumeAfter);
        }
        this.overlay = new TourGuideOverlay(host.node);
        this.overlay.root.setSiblingIndex(host.node.children.length - 1);
        this.refreshObjective(true);
        this.updateTarget();
    }

    update(deltaTime: number): void {
        if (!this.host || !this.overlay) return;
        this.overlay.layout();
        this.markerAnimationTime += deltaTime;
        this.elapsed += deltaTime;
        if (this.elapsed < 0.12) return;
        this.elapsed = 0;
        this.updateTarget();
    }

    onDestroy(): void {
        this.overlay?.destroy();
        this.overlay = null;
    }

    handleOverworldTransition(entryId: string): void {
        const step = TourProgressStore.getCurrentStep();
        if (
            step?.kind !== 'return-overworld'
            || step.overworldEntryId !== entryId
        ) return;
        TourProgressStore.markVisited(step.id, step.resumeAfter);
    }

    private updateTarget(): void {
        if (!this.host || !this.overlay || this.completing) return;
        const step = TourProgressStore.getCurrentStep();
        if (!step) {
            this.clearMarker();
            this.refreshObjective(false);
            return;
        }
        if (step.id !== this.lastStepId) this.refreshObjective(false);
        if (
            step.kind === 'overworld-entrance'
            && this.host.getTourLocationId() === 'visitor-center'
        ) {
            const transition = this.host.getTourTransitionToward(
                undefined,
                'location-1-east-01',
            );
            this.drawMarker(transition);
            return;
        }
        if (step.locationId !== this.host.getTourLocationId()) {
            this.clearMarker();
            return;
        }

        if (step.kind === 'location-region') {
            if (this.host.getTourSceneId() !== step.sceneId) {
                const transition = this.host.getTourTransitionToward(step.sceneId);
                this.drawMarker(transition);
                return;
            }
            const region = this.host.getTourRegion(step.sceneId!, step.regionId!);
            if (!region) {
                const warningKey = `${step.sceneId}/${step.regionId}`;
                if (!this.missingWarnings.has(warningKey)) {
                    this.missingWarnings.add(warningKey);
                    console.warn(`[TourGuide] 目标区域 ${warningKey} 不存在，已按进入分镜完成。`);
                }
                this.completeLookTarget(step.id, step.title, step.speech, step.resumeAfter);
                return;
            }
            this.drawMarker(
                { ...region, kind: step.targetKind ?? region.kind },
                step.proximity ?? 64,
            );
            if (this.distanceToPolygon(this.host.getTourPlayerPosition(), region.polygon) <= (step.proximity ?? 64)) {
                this.completeLookTarget(step.id, step.title, step.speech, step.resumeAfter);
            }
            return;
        }

        if (step.kind === 'return-overworld') {
            const transition = this.host.getTourTransitionToward(undefined, step.overworldEntryId);
            this.drawMarker(transition);
            return;
        }

        this.clearMarker();
    }

    private completeLookTarget(
        stepId: string,
        title: string,
        speech: string,
        resumeAnchor: Parameters<typeof TourProgressStore.markVisited>[1],
    ): void {
        if (!this.host || !this.overlay || this.completing) return;
        this.completing = true;
        TourProgressStore.markVisited(stepId, resumeAnchor);
        this.host.setTourPaused(true);
        this.clearMarker();
        this.overlay.setSpeech(speech, 'explain');
        this.overlay.showCheckpoint(title, speech, () => {
            if (!this.host) return;
            this.host.setTourPaused(false);
            this.completing = false;
            this.refreshObjective(false);
            this.updateTarget();
        });
    }

    private refreshObjective(initial: boolean): void {
        if (!this.overlay) return;
        const step = TourProgressStore.getCurrentStep();
        this.lastStepId = step?.id ?? '';
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

    private drawMarker(target: LocationTourTarget | null, approachDistance = 64): void {
        if (!this.host || !target || target.polygon.length === 0) {
            this.clearMarker();
            return;
        }
        const polygon = target.polygon;
        this.ensureMarker();
        const player = this.host.getTourPlayerPosition();
        const ground = this.polygonCenter(polygon);
        this.marker!.setPosition(ground.x, ground.y, 0);
        const scale = target.kind === 'interaction'
            ? 1
            : this.getLocationMarkerScale(ground.y);
        this.marker!.setScale(scale, scale, 1);
        this.markerGraphics!.clear();
        if (target.kind === 'interaction') this.drawInteractionMarker();
        else this.drawLocationMarker();
        const routeTarget = target.kind === 'interaction'
            ? this.host.getTourApproachPoint(polygon, approachDistance)
            : this.nearestPointOnPolygon(player, polygon);
        this.drawRouteDots(routeTarget);
    }

    private drawLocationMarker(): void {
        const graphics = this.markerGraphics!;
        graphics.fillColor = new Color(20, 18, 14, 105);
        graphics.ellipse(0, 0, 48, 16.5);
        graphics.fill();
        graphics.fillColor = new Color(211, 160, 66, 238);
        graphics.strokeColor = new Color(255, 240, 183, 250);
        graphics.lineWidth = 5;
        graphics.circle(0, 118, 47.5);
        graphics.fill();
        graphics.stroke();
        graphics.moveTo(-28, 82);
        graphics.lineTo(0, 54);
        graphics.lineTo(28, 82);
        graphics.close();
        graphics.fill();
        graphics.stroke();
        graphics.fillColor = new Color(255, 248, 220, 255);
        graphics.circle(0, 118, 15);
        graphics.fill();
    }

    private drawInteractionMarker(): void {
        const graphics = this.markerGraphics!;
        graphics.strokeColor = new Color(255, 248, 220, 250);
        graphics.lineWidth = 5;
        graphics.circle(0, 0, 32);
        graphics.stroke();
        graphics.moveTo(-15, 10);
        graphics.lineTo(0, -11);
        graphics.lineTo(15, 10);
        graphics.stroke();
    }

    private ensureMarker(): void {
        if (!this.host) return;
        const world = this.host.getTourWorld();
        if (this.marker?.isValid && this.marker.parent === world) return;
        this.marker?.destroy();
        this.marker = new Node('TourTargetMarker');
        this.marker.layer = Layers.Enum.UI_2D;
        this.marker.addComponent(UITransform).setContentSize(180, 220);
        this.markerGraphics = this.marker.addComponent(Graphics);
        world.addChild(this.marker);
        this.placeMarkerBehindPlayer(world);
    }

    private placeMarkerBehindPlayer(world: Node): void {
        if (!this.marker) return;
        const playerShadowIndex = world.children.findIndex(
            (child) => child.name === 'PlayerShadow',
        );
        if (playerShadowIndex >= 0) {
            this.marker.setSiblingIndex(playerShadowIndex);
            return;
        }
        const playerIndex = world.children.findIndex(
            (child) => child.name === 'Player',
        );
        this.marker.setSiblingIndex(
            playerIndex >= 0 ? playerIndex : Math.max(1, world.children.length - 1),
        );
    }

    private getLocationMarkerScale(y: number): number {
        const perspectiveScale = Math.max(
            LOCATION_MARKER_MIN_PERSPECTIVE_SCALE,
            this.host?.getTourPerspectiveScale(y) ?? 1,
        );
        const phase = this.markerAnimationTime % LOCATION_MARKER_PULSE_PERIOD;
        const pulse = phase < LOCATION_MARKER_PULSE_DURATION
            ? Math.sin(Math.PI * phase / LOCATION_MARKER_PULSE_DURATION)
            : 0;
        return perspectiveScale
            * LOCATION_MARKER_SCALE
            * (1 + LOCATION_MARKER_PULSE_AMOUNT * pulse);
    }

    private clearMarker(): void {
        this.markerGraphics?.clear();
        this.routeGraphics?.clear();
    }

    private drawRouteDots(target: Vec2): void {
        if (!this.host) return;
        this.ensureRouteDots();
        const start = this.host.getTourPlayerPosition();
        const distance = Vec2.distance(start, target);
        if (distance < 42) {
            this.routeGraphics!.clear();
            return;
        }
        this.routeGraphics!.clear();
        const spacing = 46;
        const count = Math.min(22, Math.floor(distance / spacing));
        for (let index = 1; index <= count; index += 1) {
            const t = Math.min(0.92, (index * spacing) / distance);
            const x = start.x + (target.x - start.x) * t;
            const y = start.y + (target.y - start.y) * t;
            const radius = index % 3 === 0 ? 6 : 4;
            this.routeGraphics!.fillColor = index % 3 === 0
                ? new Color(247, 205, 105, 220)
                : new Color(255, 244, 196, 180);
            this.routeGraphics!.circle(x, y, radius);
            this.routeGraphics!.fill();
        }
    }

    private ensureRouteDots(): void {
        if (!this.host) return;
        const world = this.host.getTourWorld();
        if (this.routeDots?.isValid && this.routeDots.parent === world) return;
        this.routeDots?.destroy();
        this.routeDots = new Node('TourRouteDots');
        this.routeDots.layer = Layers.Enum.UI_2D;
        this.routeDots.addComponent(UITransform);
        this.routeGraphics = this.routeDots.addComponent(Graphics);
        world.addChild(this.routeDots);
        this.routeDots.setSiblingIndex(Math.min(2, world.children.length - 1));
    }

    private nearestPointOnPolygon(point: Vec2, polygon: Vec2[]): Vec2 {
        let best = polygon[0]?.clone() ?? point.clone();
        let bestDistance = Number.POSITIVE_INFINITY;
        for (let index = 0; index < polygon.length; index += 1) {
            const start = polygon[index];
            const end = polygon[(index + 1) % polygon.length];
            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const lengthSqr = dx * dx + dy * dy;
            const t = lengthSqr < 0.0001
                ? 0
                : Math.max(0, Math.min(1, (
                    (point.x - start.x) * dx + (point.y - start.y) * dy
                ) / lengthSqr));
            const candidate = new Vec2(start.x + dx * t, start.y + dy * t);
            const distance = Vec2.distance(point, candidate);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = candidate;
            }
        }
        return best;
    }

    private polygonCenter(points: Vec2[]): Vec2 {
        const result = new Vec2();
        for (const point of points) result.add(point);
        if (points.length > 0) result.multiplyScalar(1 / points.length);
        return result;
    }

    private distanceToPolygon(point: Vec2, polygon: Vec2[]): number {
        let best = Number.POSITIVE_INFINITY;
        for (let index = 0; index < polygon.length; index += 1) {
            const start = polygon[index];
            const end = polygon[(index + 1) % polygon.length];
            best = Math.min(best, this.distanceToSegment(point, start, end));
        }
        return best;
    }

    private distanceToSegment(point: Vec2, start: Vec2, end: Vec2): number {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const lengthSqr = dx * dx + dy * dy;
        if (lengthSqr < 0.0001) return Vec2.distance(point, start);
        const t = Math.max(0, Math.min(1, (
            (point.x - start.x) * dx + (point.y - start.y) * dy
        ) / lengthSqr));
        return Vec2.distance(point, new Vec2(start.x + dx * t, start.y + dy * t));
    }
}
