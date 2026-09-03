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
import { getTourStepDisplayTitle, TOUR_NARRATION_POINTS, TourStep } from './TourConfig';
import {
    TOUR_FEATURE_EVENTS,
    TourFeatureBridge,
    TourFragmentEvent,
} from './TourFeatureBridge';
import { loadSettings, onSettingsChanged } from '../start/GameSettings';

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
    activateTourInteraction(regionId: string): boolean;
    getTourTransitionToward(targetSceneId?: string, overworldEntryId?: string): LocationTourTarget | null;
    setTourPaused(paused: boolean): void;
    returnTourToOverworld(entryId: string): void;
}

@ccclass('LocationTourGuide')
export class LocationTourGuide extends Component {
    private host: LocationTourHost | null = null;
    private eventNode: Node | null = null;
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
    private transientSpeechPriority = 0;
    private transientSpeechUntil = 0;
    private transientSpeechKey = '';
    private lastActionHintStepId = '';
    private missingPromptedSteps = new Set<string>();
    private hintsVisible = true;
    private suspended = false;
    private unsubscribeSettings: (() => void) | null = null;

    initialize(host: LocationTourHost): void {
        this.host = host;
        this.eventNode = host.node;
        this.overlay = new TourGuideOverlay(host.node);
        this.overlay.root.setSiblingIndex(host.node.children.length - 1);
        this.applyHintsVisible(loadSettings().tourHintsEnabled);
        this.unsubscribeSettings = onSettingsChanged((settings) => {
            this.applyHintsVisible(settings.tourHintsEnabled);
        });
        host.node.on(TOUR_FEATURE_EVENTS.fragmentDiscovered, this.onFragmentDiscovered, this);
        host.node.on(TOUR_FEATURE_EVENTS.fragmentCollected, this.onFragmentCollected, this);
        host.node.on(TOUR_FEATURE_EVENTS.fragmentSceneCompleted, this.onFragmentSceneCompleted, this);
        host.node.on(TOUR_FEATURE_EVENTS.magnifierExpanded, this.onMagnifierExpanded, this);
        this.recoverCompletedArrivalStep();
        this.refreshObjective(true);
        this.updateTarget();
        // 场景首次启用时，远程资源包与脚本组件可能在同一帧完成挂载。
        // 下一帧再同步一次，覆盖入口回调和地点组件初始化之间的时序差。
        this.scheduleOnce(() => {
            if (!this.host || !this.recoverCompletedArrivalStep()) return;
            this.refreshObjective(false);
            this.updateTarget();
        }, 0);
    }

    /**
     * 场景切换与进度写入并非同一事务。若玩家已经进入目标地点，但大地图
     * 的入口回调因触发点编号不同或中途关闭游戏而没有落盘，就在地点场景
     * 初始化时补记“到达”步骤，避免导览永久停在上一阶段。
     */
    private recoverCompletedArrivalStep(): boolean {
        if (!this.host) return false;
        const step = TourProgressStore.getCurrentStep();
        if (step?.kind !== 'overworld-entrance') return false;
        const destination = step.resumeAfter;
        if (
            destination.kind !== 'location'
            || destination.locationId !== this.host.getTourLocationId()
        ) return false;
        TourProgressStore.markVisited(step.id, destination);
        return true;
    }

    update(deltaTime: number): void {
        if (!this.host || !this.overlay) return;
        this.overlay.layout();
        if (this.suspended) return;
        this.overlay.update(deltaTime);
        this.markerAnimationTime += deltaTime;
        this.elapsed += deltaTime;
        if (this.elapsed < 0.12) return;
        this.elapsed = 0;
        this.updateTarget();
        this.updateFragmentHint();
        this.updateNarrationPoint();
        this.expireTransientSpeech();
    }

    onDestroy(): void {
        this.unsubscribeSettings?.();
        this.unsubscribeSettings = null;
        this.eventNode?.off(TOUR_FEATURE_EVENTS.fragmentDiscovered, this.onFragmentDiscovered, this);
        this.eventNode?.off(TOUR_FEATURE_EVENTS.fragmentCollected, this.onFragmentCollected, this);
        this.eventNode?.off(TOUR_FEATURE_EVENTS.fragmentSceneCompleted, this.onFragmentSceneCompleted, this);
        this.eventNode?.off(TOUR_FEATURE_EVENTS.magnifierExpanded, this.onMagnifierExpanded, this);
        this.eventNode = null;
        this.host = null;
        this.overlay?.destroy();
        this.overlay = null;
    }

    setSuspended(suspended: boolean): void {
        this.suspended = suspended;
        if (this.overlay) this.overlay.root.active = !suspended && this.hintsVisible;
        if (this.marker) this.marker.active = !suspended && this.hintsVisible;
        if (this.routeDots) this.routeDots.active = !suspended && this.hintsVisible;
        if (!suspended && this.hintsVisible) {
            this.refreshObjective(false);
            this.updateTarget();
        }
    }

    private applyHintsVisible(visible: boolean): void {
        this.hintsVisible = visible;
        if (this.overlay) this.overlay.root.active = visible && !this.suspended;
        this.overlay?.setHintsVisible(visible);
        if (this.marker) this.marker.active = visible && !this.suspended;
        if (this.routeDots) this.routeDots.active = visible && !this.suspended;
        if (visible && !this.suspended) {
            this.refreshObjective(false);
            this.updateTarget();
        } else {
            this.transientSpeechKey = '';
            this.transientSpeechPriority = 0;
            this.transientSpeechUntil = 0;
        }
    }

    handleOverworldTransition(entryId: string): void {
        const step = TourProgressStore.getCurrentStep();
        this.overlay?.setContextAction('查看', null);
        if (
            step?.kind !== 'return-overworld'
            || step.locationId !== this.host?.getTourLocationId()
        ) return;
        // The configured exit is a route recommendation, not a hard lock. A
        // player leaving through another valid gate has still completed this
        // stage; save the gate actually used so resume restores them correctly.
        TourProgressStore.markVisited(step.id, { kind: 'overworld', entryId });
    }

    activateCurrentTarget(): boolean {
        return this.overlay?.triggerContextAction() ?? false;
    }

    handleLocationInfoClosed(regionId: string): boolean {
        const step = TourProgressStore.getCurrentStep();
        if (
            !step
            || step.kind !== 'location-region'
            || step.locationId !== this.host?.getTourLocationId()
            || step.sceneId !== this.host?.getTourSceneId()
            || step.regionId !== regionId
        ) return false;
        this.completeLookTarget(step, false);
        return true;
    }

    private updateTarget(): void {
        if (!this.host || !this.overlay || this.completing) return;
        this.overlay.setContextAction('查看', null);
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
                this.handleMissingTarget(step);
                return;
            }
            this.drawMarker(
                { ...region, kind: step.targetKind ?? region.kind },
                step.proximity ?? 64,
            );
            if (this.distanceToPolygon(this.host.getTourPlayerPosition(), region.polygon) <= (step.proximity ?? 64)) {
                if (step.completionMode === 'action' || step.targetKind === 'interaction') {
                    // Editor-authored interaction regions use the shared rich
                    // location card. The tour only falls back to its compact
                    // checkpoint for legacy obstacle-backed targets.
                    if (region.id.startsWith('interaction-')) {
                        this.overlay.setContextAction(
                            '查看',
                            () => this.host?.activateTourInteraction(region.id),
                        );
                    } else {
                        this.overlay.setContextAction('查看', () => this.completeLookTarget(step));
                    }
                    this.showActionHint(step);
                } else {
                    this.completeLookTarget(step);
                }
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

    private completeLookTarget(step: TourStep, showKnowledgeCard = true): void {
        if (!this.host || !this.overlay || this.completing) return;
        this.completing = true;
        TourProgressStore.markVisited(step.id, step.resumeAfter);
        if (step.tutorialId) TourProgressStore.markTutorialCompleted(step.tutorialId);
        this.lastActionHintStepId = '';
        this.host.setTourPaused(true);
        this.clearMarker();
        this.overlay.setContextAction('查看', null);
        this.overlay.setSpeech(step.speech, 'explain');
        const finished = TourProgressStore.load().completed;
        const continueAction = () => {
            if (!this.host) return;
            this.host.setTourPaused(false);
            this.completing = false;
            this.refreshObjective(false);
            this.updateTarget();
        };
        if (!showKnowledgeCard) {
            this.host.setTourPaused(false);
            this.completing = false;
            this.refreshObjective(false);
            this.updateTarget();
            return;
        }
        this.overlay.showCheckpoint(
            step.title,
            step.knowledgeText ?? step.speech,
            continueAction,
            finished ? '留在午门自由探索' : '继续游览',
            finished
                ? {
                    label: '返回大地图',
                    action: () => {
                        this.host?.setTourPaused(false);
                        this.completing = false;
                        this.host?.returnTourToOverworld('location-3-north-01');
                    },
                }
                : undefined,
        );
    }

    private refreshObjective(initial: boolean): void {
        if (!this.overlay) return;
        const step = TourProgressStore.getCurrentStep();
        this.lastStepId = step?.id ?? '';
        this.transientSpeechPriority = 0;
        this.transientSpeechUntil = 0;
        this.transientSpeechKey = '';
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

    private showActionHint(step: TourStep): void {
        if (
            !step.actionHint
            || !step.tutorialId
            || TourProgressStore.hasCompletedTutorial(step.tutorialId)
            || this.lastActionHintStepId === step.id
        ) return;
        if (this.showTransientSpeech(`action:${step.id}`, step.actionHint, 30, 5.5)) {
            this.lastActionHintStepId = step.id;
        }
    }

    private updateNarrationPoint(): void {
        if (!this.host || !this.overlay || this.completing || this.overlay.isCheckpointOpen()) return;
        const locationId = this.host.getTourLocationId();
        const sceneId = this.host.getTourSceneId();
        const current = TourProgressStore.getCurrentStep();
        const candidates = TOUR_NARRATION_POINTS
            .filter((point) => (
                point.locationId === locationId
                && point.sceneId === sceneId
                && !TourProgressStore.hasShownNarration(point.id)
                && !(current?.kind === 'location-region' && current.regionId === point.regionId)
            ))
            .sort((a, b) => (b.priority ?? 10) - (a.priority ?? 10));
        for (const point of candidates) {
            const region = this.host.getTourRegion(sceneId, point.regionId);
            if (!region) continue;
            const distance = this.distanceToPolygon(this.host.getTourPlayerPosition(), region.polygon);
            if (distance > (point.proximity ?? 88)) continue;
            if (this.showTransientSpeech(`narration:${point.id}`, point.speech, point.priority ?? 10, 5.5)) {
                TourProgressStore.markNarrationShown(point.id);
            }
            return;
        }
    }

    private updateFragmentHint(): void {
        if (!this.host || !this.overlay || this.completing || this.overlay.isCheckpointOpen()) return;
        const locationId = this.host.getTourLocationId();
        const sceneId = this.host.getTourSceneId();
        const progress = TourFeatureBridge.getFragmentProgress(locationId, sceneId);
        this.overlay.setObjectiveSupplement(
            progress && progress.total > 0
                ? `碎片任务 · 这里有碎片，用放大镜找找  ${progress.collected}/${progress.total}`
                : '',
        );
        const sceneKey = `${locationId}/${sceneId}`;
        const narrationId = `fragment-hint:${sceneKey}`;
        if (TourProgressStore.hasShownNarration(narrationId)) return;
        if (!progress || progress.total <= 0 || progress.collected >= progress.total) return;
        if (this.showTransientSpeech(
            narrationId,
            '这里有碎片，用放大镜找找。拖住右侧放大镜的木柄，在画面中慢慢移动。',
            20,
            6,
        )) {
            TourProgressStore.markNarrationShown(narrationId);
        }
    }

    private handleMissingTarget(step: TourStep): void {
        if (!this.host || !this.overlay || this.missingPromptedSteps.has(step.id)) return;
        const warningKey = `${step.sceneId}/${step.regionId}`;
        this.missingPromptedSteps.add(step.id);
        if (!this.missingWarnings.has(warningKey)) {
            this.missingWarnings.add(warningKey);
            console.warn(`[TourGuide] 目标区域 ${warningKey} 不存在，等待玩家确认跳过。`);
        }
        this.completing = true;
        this.host.setTourPaused(true);
        this.clearMarker();
        this.overlay.showCheckpoint(
            '目标暂不可用',
            '这一处导览标记没有正确载入。为避免流程卡住，可以跳过本目标并继续游览。',
            () => {
                if (!this.host) return;
                TourProgressStore.markVisited(step.id, step.resumeAfter);
                this.host.setTourPaused(false);
                this.completing = false;
                this.refreshObjective(false);
                this.updateTarget();
            },
            '跳过本目标',
        );
    }

    private showTransientSpeech(key: string, text: string, priority: number, duration: number): boolean {
        if (!this.overlay) return false;
        if (!this.hintsVisible || this.suspended) return true;
        if (
            this.markerAnimationTime < this.transientSpeechUntil
            && this.transientSpeechKey !== key
            && priority < this.transientSpeechPriority
        ) return false;
        if (this.transientSpeechKey === key && this.markerAnimationTime < this.transientSpeechUntil) return true;
        this.transientSpeechKey = key;
        this.transientSpeechPriority = priority;
        this.transientSpeechUntil = this.markerAnimationTime + duration;
        this.overlay.setSpeech(text, 'pointing');
        return true;
    }

    private expireTransientSpeech(): void {
        if (!this.overlay || !this.transientSpeechKey || this.markerAnimationTime < this.transientSpeechUntil) return;
        this.transientSpeechKey = '';
        this.transientSpeechPriority = 0;
        this.transientSpeechUntil = 0;
        const step = TourProgressStore.getCurrentStep();
        if (step) this.overlay.setSpeech(step.speech, 'pointing', false);
    }

    private readonly onFragmentDiscovered = (event: TourFragmentEvent): void => {
        if (!this.matchesCurrentScene(event)) return;
        const id = `fragment-discovered:${event.locationId}/${event.sceneId}`;
        if (TourProgressStore.hasShownNarration(id)) return;
        if (this.showTransientSpeech(id, '这里有碎片，用放大镜找找。拖住右侧放大镜的木柄，在画面中慢慢移动。', 20, 6)) {
            TourProgressStore.markNarrationShown(id);
        }
    };

    private readonly onFragmentCollected = (event: TourFragmentEvent): void => {
        if (!this.matchesCurrentScene(event)) return;
        this.updateFragmentHint();
        TourProgressStore.markTutorialCompleted('fragment-search');
        const progress = TourFeatureBridge.getFragmentProgress(event.locationId, event.sceneId);
        const collected = event.collected ?? progress?.collected;
        const total = event.total ?? progress?.total;
        const name = event.fragmentName ? `“${event.fragmentName}”` : '一枚遗迹碎片';
        const count = Number.isFinite(collected) && Number.isFinite(total) ? ` · ${collected}/${total}` : '';
        const id = `fragment-collected:${event.fragmentId ?? `${event.locationId}/${event.sceneId}/${collected ?? name}`}`;
        if (TourProgressStore.hasShownNarration(id)) return;
        if (this.showTransientSpeech(id, `找到${name}${count}`, 20, 4.5)) {
            TourProgressStore.markNarrationShown(id);
        }
    };

    private readonly onFragmentSceneCompleted = (event: TourFragmentEvent): void => {
        if (!this.matchesCurrentScene(event)) return;
        const id = `fragment-complete:${event.locationId}/${event.sceneId}`;
        if (TourProgressStore.hasShownNarration(id)) return;
        if (this.showTransientSpeech(id, '这一带的遗迹碎片已经找齐，可以继续游览了。', 20, 5)) {
            TourProgressStore.markNarrationShown(id);
        }
    };

    private readonly onMagnifierExpanded = (event?: { locationId?: string; sceneId?: string }): void => {
        if (event?.locationId && !this.matchesCurrentScene(event as TourFragmentEvent)) return;
        if (TourProgressStore.hasCompletedTutorial('magnifier-basic')) return;
        TourProgressStore.markTutorialCompleted('magnifier-basic');
        this.showTransientSpeech('magnifier-complete', '就是这样，拖动放大镜，让容易忽略的细节显出来。', 20, 4.5);
    };

    private matchesCurrentScene(event: TourFragmentEvent): boolean {
        return Boolean(
            this.host
            && event.locationId === this.host.getTourLocationId()
            && event.sceneId === this.host.getTourSceneId()
        );
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
        this.marker.active = this.hintsVisible;
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
        this.overlay?.setContextAction('查看', null);
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
        this.routeDots.active = this.hintsVisible;
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
