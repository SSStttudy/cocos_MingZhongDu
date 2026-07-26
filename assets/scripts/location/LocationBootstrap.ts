import {
    _decorator,
    Color,
    Component,
    director,
    EventKeyboard,
    EventTouch,
    Graphics,
    input,
    Input,
    JsonAsset,
    KeyCode,
    Label,
    Layers,
    Node,
    resources,
    Sprite,
    SpriteFrame,
    UITransform,
    Vec2,
    Vec3,
    view,
} from 'cc';
import { EDITOR } from 'cc/env';
import {
    getLocationConfig,
    LocationPolygon,
    LocationSceneConfig,
    LocationTransition,
    PerspectiveSceneConfig,
} from './LocationConfig';
import { LocationTransitionState } from './LocationTransitionState';
import {
    LocationInteractionContext,
    LocationInteractionRegistry,
} from './LocationInteractionRegistry';
import { DirectionalWalkAnimator } from '../player/DirectionalWalkAnimator';

const { ccclass, executeInEditMode, property } = _decorator;

@ccclass('LocationBootstrap')
@executeInEditMode
export class LocationBootstrap extends Component {
    @property({ tooltip: '地点配置 ID' })
    locationId = 'visitor-center';

    @property({ type: SpriteFrame, tooltip: '入口桥分镜背景' })
    entranceGateCurrent: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '中轴道路分镜背景' })
    mainRoadCurrent: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '咖啡庭院分镜背景' })
    cafeGardenCurrent: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '休闲广场分镜背景' })
    leisurePlazaCurrent: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '展馆外院分镜背景' })
    visitorBuildingCurrent: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '游客中心外景原图/风格图' })
    exteriorCurrent: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '游客中心内景原图/风格图' })
    interiorCurrent: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '外景历史复原图（待制作）' })
    exteriorRestored: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '内景历史复原图（待制作）' })
    interiorRestored: SpriteFrame | null = null;

    @property({ tooltip: '运行时显示可行走区、障碍和切景区' })
    showDebugRegions = false;

    @property({ tooltip: '编辑器预览分镜：exterior 或 interior' })
    previewSceneId = 'exterior';

    @property({ type: JsonAsset, tooltip: '区域编辑器导出的 regions.json' })
    regionData: JsonAsset | null = null;

    private readonly defaultMoveSpeed = 230;
    private readonly playerRadius = 18;
    private readonly joystickRadius = 68;
    private readonly exportedCharacterHeight = 440;
    private readonly exportedCanvasHeight = 512;
    private readonly exportedCanvasAspect = 384 / 512;

    private config!: LocationSceneConfig;
    private sceneConfig!: PerspectiveSceneConfig;
    private currentSceneId = '';
    private playerPosition = new Vec2();
    private world!: Node;
    private playerShadow!: Node;
    private player!: Node;
    private playerAnimator!: DirectionalWalkAnimator;
    private joystick!: Node;
    private joystickKnob!: Node;
    private titleLabel!: Label;
    private modeLabel!: Label;
    private moveInput = new Vec2();
    private keyboardInput = new Vec2();
    private joystickInput = new Vec2();
    private pressedKeys = new Set<KeyCode>();
    private activeTouchId: number | null = null;
    private transitionCooldown = 0.8;
    private restoredMode = false;
    private editorSceneId = '';
    private interactionRegions = new Map<string, Array<{
        id: string;
        points: Vec2[];
        handlerId: string;
        prompt: string;
        triggerMode: string;
        payload: unknown;
    }>>();
    private activeInteractionIds = new Set<string>();
    private spawnPoints = new Map<string, Map<string, Vec2>>();
    private perspectiveSamples: Array<{ y: number; visualHeight: number }> = [];
    private perspectiveProjection: {
        nearY: number;
        nearVisualHeight: number;
        horizonY: number;
    } | null = null;
    private referenceVisualHeight = 139;
    private cameraZoom = 1;
    private cameraPosition = new Vec2();
    private cameraInitialized = false;

    onLoad(): void {
        this.config = getLocationConfig(this.locationId);
        this.applyExportedRegionData();
        const locationEntry = EDITOR
            ? null
            : LocationTransitionState.consumeLocationEntry(this.locationId);
        this.currentSceneId = EDITOR && this.config.scenes[this.previewSceneId]
            ? this.previewSceneId
            : locationEntry && this.config.scenes[locationEntry.sceneId]
                ? locationEntry.sceneId
                : this.config.initialSceneId;
        this.sceneConfig = this.config.scenes[this.currentSceneId];
        if (EDITOR) {
            this.renderEditorPreview();
            return;
        }

        const regionEditor = this.node.getChildByName('RegionEditor');
        if (regionEditor) regionEditor.active = false;
        // RegionEditor 和碰撞轮廓只属于制作阶段，正式预览/微信运行不渲染。
        this.showDebugRegions = false;

        const entrySpawn = locationEntry
            ? this.spawnPoints.get(this.currentSceneId)?.get(locationEntry.spawnId)
            : undefined;
        this.renderRuntimeScene(this.currentSceneId, entrySpawn ?? this.sceneConfig.playerStart);
        this.createHud();
        this.createJoystick();
        this.bindInput();
        this.layoutUi();
    }

    onDestroy(): void {
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
    }

    update(deltaTime: number): void {
        if (EDITOR) {
            const requestedSceneId = this.config.scenes[this.previewSceneId]
                ? this.previewSceneId
                : this.config.initialSceneId;
            if (requestedSceneId !== this.currentSceneId) {
                this.currentSceneId = requestedSceneId;
                this.sceneConfig = this.config.scenes[requestedSceneId];
            }
            if (this.editorSceneId !== this.currentSceneId) this.renderEditorPreview();
            return;
        }
        this.transitionCooldown = Math.max(0, this.transitionCooldown - deltaTime);
        this.updateMovement(deltaTime);
        this.updateCamera(deltaTime);
        this.layoutUi();
    }

    private renderEditorPreview(): void {
        this.editorSceneId = this.currentSceneId;
        this.node.getChildByName('PerspectiveCalibration')?.destroy();
        const calibration = new Node('PerspectiveCalibration');
        calibration.layer = Layers.Enum.UI_2D;
        calibration.addComponent(UITransform).setContentSize(this.sceneConfig.worldSize);
        this.node.addChild(calibration);
        calibration.setSiblingIndex(0);

        const regionEditor = this.node.getChildByName('RegionEditor');
        if (regionEditor) {
            regionEditor.active = true;
            for (const child of regionEditor.children) {
                if (child.name.startsWith('Scene-')) {
                    child.active = child.name === `Scene-${this.currentSceneId}`;
                }
            }
        }

        this.createBackground(calibration, 'BackgroundCurrent', this.getCurrentSpriteFrame());
        this.createRegionLayer(calibration, true);
        this.createEditorPlayerMarker(calibration);
    }

    private renderRuntimeScene(sceneId: string, spawn?: Vec2): void {
        this.currentSceneId = sceneId;
        this.sceneConfig = this.config.scenes[sceneId];
        this.capturePlayerPerspectiveCalibration();
        this.cameraZoom = this.getTargetCameraZoom();
        this.cameraInitialized = false;
        this.activeInteractionIds.clear();
        this.playerPosition.set(spawn ?? this.sceneConfig.playerStart);
        const calibration = this.node.getChildByName('PerspectiveCalibration');
        if (calibration) calibration.active = false;
        this.world?.destroy();

        this.world = new Node('PerspectiveWorld');
        this.world.layer = Layers.Enum.UI_2D;
        this.world.addComponent(UITransform).setContentSize(this.sceneConfig.worldSize);
        this.node.addChild(this.world);
        this.world.setSiblingIndex(0);

        this.createBackground(this.world, 'BackgroundCurrent', this.getCurrentSpriteFrame());
        if (this.showDebugRegions) this.createRegionLayer(this.world, false);

        const behindPlayer = new Node('BehindPlayer');
        behindPlayer.layer = Layers.Enum.UI_2D;
        behindPlayer.addComponent(UITransform).setContentSize(this.sceneConfig.worldSize);
        this.world.addChild(behindPlayer);

        this.playerShadow = new Node('PlayerShadow');
        this.playerShadow.layer = Layers.Enum.UI_2D;
        this.playerShadow.addComponent(UITransform).setContentSize(124, 34);
        const shadow = this.playerShadow.addComponent(Graphics);
        shadow.fillColor = new Color(28, 24, 20, 72);
        shadow.ellipse(0, 2, 58, 13);
        shadow.fill();
        this.world.addChild(this.playerShadow);

        this.player = new Node('Player');
        this.player.layer = Layers.Enum.UI_2D;
        this.player.addComponent(UITransform);
        this.player.addComponent(Sprite);
        this.playerAnimator = this.player.addComponent(DirectionalWalkAnimator);
        const canvasHeight = this.referenceVisualHeight
            * this.exportedCanvasHeight / this.exportedCharacterHeight;
        this.playerAnimator.setDisplaySize(
            canvasHeight * this.exportedCanvasAspect,
            canvasHeight,
        );
        this.world.addChild(this.player);

        const foreground = new Node('ForegroundOcclusion');
        foreground.layer = Layers.Enum.UI_2D;
        foreground.addComponent(UITransform).setContentSize(this.sceneConfig.worldSize);
        this.world.addChild(foreground);

        this.updatePlayerVisual();
        this.updateHud();
    }

    private createBackground(parent: Node, name: string, frame: SpriteFrame | null): Node {
        const background = new Node(name);
        background.layer = Layers.Enum.UI_2D;
        background.addComponent(UITransform).setContentSize(this.sceneConfig.worldSize);
        if (frame) {
            const sprite = background.addComponent(Sprite);
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            sprite.spriteFrame = frame;
        } else if (!this.sceneConfig.backgroundAsset) {
            const graphics = background.addComponent(Graphics);
            graphics.fillColor = new Color(187, 174, 139, 255);
            graphics.rect(
                -this.sceneConfig.worldSize.width * 0.5,
                -this.sceneConfig.worldSize.height * 0.5,
                this.sceneConfig.worldSize.width,
                this.sceneConfig.worldSize.height,
            );
            graphics.fill();
        }
        parent.addChild(background);
        if (!frame) this.loadApprovedBackground(background);
        return background;
    }

    private loadApprovedBackground(background: Node): void {
        const sceneId = this.currentSceneId;
        const assetName = this.sceneConfig.backgroundAsset;
        if (!assetName) return;
        const resourcePath = `locations/${this.locationId}/scenes/${assetName}/spriteFrame`;
        resources.load(resourcePath, SpriteFrame, (error, frame) => {
            if (error || !frame) {
                console.warn(`[LocationBootstrap] 背景加载失败：${resourcePath}`, error);
                return;
            }
            if (!background.isValid || this.currentSceneId !== sceneId) return;
            let sprite = background.getComponent(Sprite);
            if (!sprite) sprite = background.addComponent(Sprite);
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            sprite.spriteFrame = frame;
        });
    }

    private createRegionLayer(parent: Node, editor: boolean): void {
        const layer = new Node(editor ? 'PerspectiveRegions' : 'DebugRegions');
        layer.layer = Layers.Enum.UI_2D;
        layer.addComponent(UITransform).setContentSize(this.sceneConfig.worldSize);
        const graphics = layer.addComponent(Graphics);
        parent.addChild(layer);

        graphics.fillColor = new Color(66, 185, 151, editor ? 52 : 25);
        graphics.strokeColor = new Color(31, 116, 96, 225);
        graphics.lineWidth = 4;
        for (const walkArea of this.sceneConfig.walkAreas) {
            this.drawPolygon(graphics, walkArea, true);
        }

        graphics.fillColor = new Color(192, 71, 57, editor ? 82 : 42);
        graphics.strokeColor = new Color(135, 45, 38, 235);
        for (const obstacle of this.sceneConfig.obstacles) {
            this.drawPolygon(graphics, obstacle.points, true);
            if (editor) this.createRegionLabel(layer, obstacle.id, this.polygonCenter(obstacle.points), new Color(122, 38, 32, 255));
        }

        graphics.fillColor = new Color(60, 147, 218, editor ? 100 : 55);
        graphics.strokeColor = new Color(32, 92, 151, 240);
        for (const transition of this.sceneConfig.transitions) {
            this.drawPolygon(graphics, transition.polygon, true);
            if (editor) this.createRegionLabel(layer, transition.title, this.polygonCenter(transition.polygon), new Color(24, 74, 129, 255));
        }
    }

    private createEditorPlayerMarker(parent: Node): void {
        const marker = new Node('PlayerStart');
        marker.layer = Layers.Enum.UI_2D;
        marker.addComponent(UITransform).setContentSize(42, 42);
        const graphics = marker.addComponent(Graphics);
        graphics.fillColor = new Color(88, 70, 181, 235);
        graphics.circle(0, 0, 15);
        graphics.fill();
        marker.setPosition(this.sceneConfig.playerStart.x, this.sceneConfig.playerStart.y, 0);
        parent.addChild(marker);
    }

    private createRegionLabel(parent: Node, text: string, position: Vec2, color: Color): void {
        const node = new Node(`Label-${text}`);
        node.layer = Layers.Enum.UI_2D;
        node.addComponent(UITransform).setContentSize(260, 32);
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = 17;
        label.lineHeight = 22;
        label.color = color;
        label.enableOutline = true;
        label.outlineColor = new Color(255, 250, 225, 225);
        label.outlineWidth = 3;
        node.setPosition(position.x, position.y, 0);
        parent.addChild(node);
    }

    private drawPolygon(graphics: Graphics, points: Vec2[], fill: boolean): void {
        if (points.length < 3) return;
        graphics.moveTo(points[0].x, points[0].y);
        for (let index = 1; index < points.length; index += 1) {
            graphics.lineTo(points[index].x, points[index].y);
        }
        graphics.close();
        if (fill) graphics.fill();
        graphics.stroke();
    }

    private polygonCenter(points: Vec2[]): Vec2 {
        const center = new Vec2();
        for (const point of points) center.add(point);
        if (points.length > 0) center.multiplyScalar(1 / points.length);
        return center;
    }

    private createHud(): void {
        const titleNode = new Node('LocationTitle');
        titleNode.layer = Layers.Enum.UI_2D;
        titleNode.addComponent(UITransform).setContentSize(620, 46);
        this.titleLabel = titleNode.addComponent(Label);
        this.titleLabel.fontSize = 24;
        this.titleLabel.lineHeight = 32;
        this.titleLabel.color = new Color(255, 249, 225, 255);
        this.titleLabel.enableOutline = true;
        this.titleLabel.outlineColor = new Color(54, 46, 35, 225);
        this.titleLabel.outlineWidth = 4;
        this.node.addChild(titleNode);

        const modeNode = new Node('ImageModeButton');
        modeNode.layer = Layers.Enum.UI_2D;
        modeNode.addComponent(UITransform).setContentSize(190, 54);
        const graphics = modeNode.addComponent(Graphics);
        graphics.fillColor = new Color(38, 49, 50, 190);
        graphics.strokeColor = new Color(255, 244, 205, 210);
        graphics.lineWidth = 3;
        graphics.roundRect(-95, -27, 190, 54, 14);
        graphics.fill();
        graphics.stroke();
        const modeText = new Node('ModeText');
        modeText.layer = Layers.Enum.UI_2D;
        modeText.addComponent(UITransform).setContentSize(180, 44);
        this.modeLabel = modeText.addComponent(Label);
        this.modeLabel.fontSize = 20;
        this.modeLabel.lineHeight = 28;
        this.modeLabel.color = new Color(255, 247, 215, 255);
        modeNode.addChild(modeText);
        modeNode.on(Node.EventType.TOUCH_END, this.toggleRestoredMode, this);
        this.node.addChild(modeNode);
        this.updateHud();
    }

    private createJoystick(): void {
        this.joystick = new Node('Joystick');
        this.joystick.layer = Layers.Enum.UI_2D;
        this.joystick.addComponent(UITransform).setContentSize(this.joystickRadius * 2, this.joystickRadius * 2);
        const base = this.joystick.addComponent(Graphics);
        base.fillColor = new Color(25, 41, 45, 90);
        base.strokeColor = new Color(255, 255, 255, 145);
        base.lineWidth = 3;
        base.circle(0, 0, this.joystickRadius);
        base.fill();
        base.stroke();
        this.node.addChild(this.joystick);

        this.joystickKnob = new Node('Knob');
        this.joystickKnob.layer = Layers.Enum.UI_2D;
        this.joystickKnob.addComponent(UITransform).setContentSize(66, 66);
        const knob = this.joystickKnob.addComponent(Graphics);
        knob.fillColor = new Color(246, 235, 188, 210);
        knob.circle(0, 0, 33);
        knob.fill();
        this.joystick.addChild(this.joystickKnob);

        this.joystick.on(Node.EventType.TOUCH_START, this.onJoystickStart, this);
        this.joystick.on(Node.EventType.TOUCH_MOVE, this.onJoystickMove, this);
        this.joystick.on(Node.EventType.TOUCH_END, this.onJoystickEnd, this);
        this.joystick.on(Node.EventType.TOUCH_CANCEL, this.onJoystickEnd, this);
    }

    private bindInput(): void {
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
    }

    private onKeyDown(event: EventKeyboard): void {
        if (event.keyCode === KeyCode.KEY_R) this.toggleRestoredMode();
        if (event.keyCode === KeyCode.KEY_E || event.keyCode === KeyCode.SPACE) {
            this.activateNearbyInteraction();
        }
        this.pressedKeys.add(event.keyCode);
        this.refreshKeyboardInput();
    }

    private onKeyUp(event: EventKeyboard): void {
        this.pressedKeys.delete(event.keyCode);
        this.refreshKeyboardInput();
    }

    private refreshKeyboardInput(): void {
        const left = this.isPressed(KeyCode.KEY_A, KeyCode.ARROW_LEFT) ? 1 : 0;
        const right = this.isPressed(KeyCode.KEY_D, KeyCode.ARROW_RIGHT) ? 1 : 0;
        const down = this.isPressed(KeyCode.KEY_S, KeyCode.ARROW_DOWN) ? 1 : 0;
        const up = this.isPressed(KeyCode.KEY_W, KeyCode.ARROW_UP) ? 1 : 0;
        this.keyboardInput.set(right - left, up - down);
        if (this.keyboardInput.lengthSqr() > 1) this.keyboardInput.normalize();
    }

    private isPressed(primary: KeyCode, secondary: KeyCode): boolean {
        return this.pressedKeys.has(primary) || this.pressedKeys.has(secondary);
    }

    private onJoystickStart(event: EventTouch): void {
        if (this.activeTouchId !== null) return;
        this.activeTouchId = event.getID();
        this.updateJoystick(event);
    }

    private onJoystickMove(event: EventTouch): void {
        if (event.getID() === this.activeTouchId) this.updateJoystick(event);
    }

    private onJoystickEnd(event: EventTouch): void {
        if (event.getID() !== this.activeTouchId) return;
        this.activeTouchId = null;
        this.joystickInput.set(0, 0);
        this.joystickKnob.setPosition(0, 0, 0);
    }

    private updateJoystick(event: EventTouch): void {
        const location = event.getUILocation();
        const local = this.joystick.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(location.x, location.y, 0));
        const delta = new Vec2(local.x, local.y);
        const length = delta.length();
        if (length > this.joystickRadius) delta.multiplyScalar(this.joystickRadius / length);
        this.joystickKnob.setPosition(delta.x, delta.y, 0);
        let inputX = delta.x / this.joystickRadius;
        let inputY = delta.y / this.joystickRadius;
        // Small finger wobble while aiming horizontally should not alter depth,
        // scale, or movement speed.
        if (Math.abs(inputX) > 0.35 && Math.abs(inputY) < 0.22) inputY = 0;
        if (Math.abs(inputY) > 0.35 && Math.abs(inputX) < 0.22) inputX = 0;
        this.joystickInput.set(inputX, inputY);
    }

    private updateMovement(deltaTime: number): void {
        this.moveInput.set(
            this.keyboardInput.x + this.joystickInput.x,
            this.keyboardInput.y + this.joystickInput.y,
        );
        if (this.moveInput.lengthSqr() > 1) this.moveInput.normalize();
        if (this.moveInput.lengthSqr() < 0.001) {
            this.playerAnimator?.setMovement(this.moveInput, false);
            return;
        }

        const previousPosition = this.playerPosition.clone();
        const perspectiveScale = this.getPerspectiveScale(this.playerPosition.y);
        const step = this.moveInput.clone().multiplyScalar(
            this.defaultMoveSpeed * perspectiveScale * deltaTime,
        );
        const nextX = new Vec2(this.playerPosition.x + step.x, this.playerPosition.y);
        if (this.canStandAt(nextX)) this.playerPosition.x = nextX.x;
        const nextY = new Vec2(this.playerPosition.x, this.playerPosition.y + step.y);
        if (this.canStandAt(nextY)) this.playerPosition.y = nextY.y;
        const moved = Vec2.distance(previousPosition, this.playerPosition) > 0.01;
        this.playerAnimator?.setMovement(this.moveInput, moved);
        this.updatePlayerVisual();
        this.checkInteractions();
        this.checkTransitions();
    }

    private canStandAt(position: Vec2): boolean {
        if (!this.sceneConfig.walkAreas.some((area) => this.pointInPolygon(position, area))) return false;
        return !this.sceneConfig.obstacles.some((obstacle) => this.pointInPolygon(position, obstacle.points));
    }

    private pointInPolygon(point: Vec2, polygon: Vec2[]): boolean {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
            const a = polygon[i];
            const b = polygon[j];
            const intersects = ((a.y > point.y) !== (b.y > point.y))
                && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
            if (intersects) inside = !inside;
        }
        return inside;
    }

    private applyExportedRegionData(): void {
        const document = this.regionData?.json as any;
        if (!document?.scenes) return;
        this.spawnPoints.clear();

        for (const sceneId of Object.keys(this.config.scenes)) {
            const sceneConfig = this.config.scenes[sceneId];
            const sceneSpawns = new Map<string, Vec2>();
            for (const spawn of sceneConfig.spawns) sceneSpawns.set(spawn.id, spawn.position.clone());
            this.spawnPoints.set(sceneId, sceneSpawns);
        }

        for (const sceneId of Object.keys(document.scenes)) {
            const sceneConfig = this.config.scenes[sceneId];
            if (!sceneConfig) continue;
            const exportedPerspective = document.scenes[sceneId]?.perspective;
            if (exportedPerspective) {
                const nearY = Number(exportedPerspective.nearY);
                const nearVisualHeight = Number(exportedPerspective.nearVisualHeight);
                const horizonY = Number(exportedPerspective.horizonY);
                if (
                    Number.isFinite(nearY)
                    && Number.isFinite(nearVisualHeight)
                    && nearVisualHeight > 0
                    && Number.isFinite(horizonY)
                    && horizonY > nearY
                ) {
                    sceneConfig.perspective = { nearY, nearVisualHeight, horizonY };
                }
            }
            const regions = (document.scenes[sceneId]?.regions ?? []).filter((region: any) => region.enabled !== false);
            const toWorld = (point: any) => new Vec2(
                (Number(point.x) - 0.5) * sceneConfig.worldSize.width,
                (0.5 - Number(point.y)) * sceneConfig.worldSize.height,
            );
            const exportedSpawns = regions
                .filter((region: any) => Number(region.type) === 5)
                .map((region: any) => ({
                    id: String(region.id),
                    position: this.polygonCenter(region.points.map(toWorld)),
                }));
            if (exportedSpawns.length > 0) {
                sceneConfig.spawns = exportedSpawns;
                this.spawnPoints.set(sceneId, new Map(
                    exportedSpawns.map((spawn) => [spawn.id, spawn.position.clone()]),
                ));
                const defaultSpawn = exportedSpawns.find((spawn) => spawn.id === 'spawn-default') ?? exportedSpawns[0];
                sceneConfig.playerStart = defaultSpawn.position.clone();
            }
        }

        for (const sceneId of Object.keys(document.scenes)) {
            const sceneConfig = this.config.scenes[sceneId];
            if (!sceneConfig) continue;
            const regions = (document.scenes[sceneId]?.regions ?? []).filter((region: any) => region.enabled !== false);
            const toWorld = (point: any) => new Vec2(
                (Number(point.x) - 0.5) * sceneConfig.worldSize.width,
                (0.5 - Number(point.y)) * sceneConfig.worldSize.height,
            );
            const walkAreas = regions
                .filter((region: any) => Number(region.type) === 0)
                .map((region: any) => region.points.map(toWorld));
            if (walkAreas.length > 0) sceneConfig.walkAreas = walkAreas;
            sceneConfig.obstacles = regions
                .filter((region: any) => Number(region.type) === 1)
                .map((region: any) => ({ id: region.id, points: region.points.map(toWorld) }));

            const existingTransitions = new Map(sceneConfig.transitions.map((transition) => [transition.id, transition]));
            const exportedTransitions = regions
                .filter((region: any) => Number(region.type) === 3)
                .map((region: any) => {
                    const existing = existingTransitions.get(region.id);
                    const namedOverworldEntry = /^\d+(?:-\d+)?-(?:north|south|east|west|northeast|northwest|southeast|southwest)-\d{2}$/.test(region.id)
                        ? `location-${region.id}`
                        : undefined;
                    return {
                        id: region.id,
                        title: existing?.title ?? region.id,
                        polygon: region.points.map(toWorld),
                        targetSceneId: region.targetSceneId || existing?.targetSceneId,
                        targetSpawnId: region.targetSpawnId || existing?.targetSpawnId,
                        targetSpawn: existing?.targetSpawn,
                        overworldEntryId: region.overworldEntryId
                            || existing?.overworldEntryId
                            || namedOverworldEntry,
                    };
                });
            if (exportedTransitions.length > 0) sceneConfig.transitions = exportedTransitions;

            this.interactionRegions.set(sceneId, regions
                .filter((region: any) => Number(region.type) === 2)
                .map((region: any) => ({
                    id: region.id,
                    points: region.points.map(toWorld),
                    handlerId: String(region.handlerId || ''),
                    prompt: String(region.prompt || '交互'),
                    triggerMode: String(region.triggerMode || 'button'),
                    payload: this.parsePayload(region.payload),
                })));
        }
    }

    private parsePayload(value: unknown): unknown {
        if (typeof value !== 'string') return value ?? {};
        try { return JSON.parse(value); } catch (_) { return {}; }
    }

    private getInteractionContext(region: {
        id: string;
        handlerId: string;
        prompt: string;
        payload: unknown;
    }): LocationInteractionContext {
        return {
            locationId: this.locationId,
            sceneId: this.currentSceneId,
            regionId: region.id,
            handlerId: region.handlerId,
            prompt: region.prompt,
            payload: region.payload,
        };
    }

    private checkInteractions(): void {
        const regions = this.interactionRegions.get(this.currentSceneId) ?? [];
        const nextActive = new Set<string>();
        for (const region of regions) {
            if (!this.pointInPolygon(this.playerPosition, region.points)) continue;
            nextActive.add(region.id);
            if (!this.activeInteractionIds.has(region.id)) {
                const context = this.getInteractionContext(region);
                this.node.emit('location-interaction-enter', context);
                if (region.triggerMode === 'enter') {
                    LocationInteractionRegistry.activate(context);
                    this.node.emit('location-interaction-activate', context);
                }
            }
        }
        for (const id of this.activeInteractionIds) {
            if (!nextActive.has(id)) this.node.emit('location-interaction-exit', id);
        }
        this.activeInteractionIds = nextActive;
    }

    private activateNearbyInteraction(): void {
        const regions = this.interactionRegions.get(this.currentSceneId) ?? [];
        const region = regions.find((item) => this.pointInPolygon(this.playerPosition, item.points));
        if (!region) return;
        const context = this.getInteractionContext(region);
        LocationInteractionRegistry.activate(context);
        this.node.emit('location-interaction-activate', context);
    }

    private checkTransitions(): void {
        if (this.transitionCooldown > 0) return;
        const transition = this.sceneConfig.transitions.find((item) => (
            this.pointInPolygon(this.playerPosition, item.polygon)
        ));
        if (!transition) return;

        if (transition.targetSceneId) {
            this.transitionCooldown = 0.8;
            const spawn = transition.targetSpawnId
                ? this.spawnPoints.get(transition.targetSceneId)?.get(transition.targetSpawnId)
                : undefined;
            this.renderRuntimeScene(transition.targetSceneId, spawn ?? transition.targetSpawn);
            return;
        }
        if (transition.overworldEntryId) {
            LocationTransitionState.returnToOverworld(transition.overworldEntryId);
            director.loadScene('Overworld');
        }
    }

    private updatePlayerVisual(): void {
        if (!this.player) return;
        const scale = this.getPerspectiveScale(this.playerPosition.y);
        this.playerShadow.setPosition(this.playerPosition.x, this.playerPosition.y + 2, 0);
        this.playerShadow.setScale(scale, scale, 1);
        this.player.setPosition(this.playerPosition.x, this.playerPosition.y, 0);
        this.player.setScale(scale, scale, 1);
    }

    private capturePlayerPerspectiveCalibration(): void {
        this.referenceVisualHeight = 139;
        this.perspectiveProjection = this.sceneConfig.perspective ?? null;
        if (this.perspectiveProjection) {
            this.referenceVisualHeight = this.perspectiveProjection.nearVisualHeight;
            this.perspectiveSamples = [];
            return;
        }

        this.perspectiveSamples = this.node.children
            .filter((child) => child.name.startsWith('SpriteSplash'))
            .map((child) => {
                const transform = child.getComponent(UITransform);
                const visualHeight = transform
                    ? transform.contentSize.height * Math.abs(child.scale.y)
                    : 0;
                const bottomOffset = transform
                    ? visualHeight * (child.scale.y >= 0
                        ? transform.anchorPoint.y
                        : 1 - transform.anchorPoint.y)
                    : 0;
                child.active = false;
                // SpriteSplash is placed as a full-height person ruler. Its
                // bottom edge is the foot/depth coordinate; the node position
                // itself is only the ruler's anchor (normally its center).
                return {
                    y: child.position.y - bottomOffset,
                    visualHeight,
                };
            })
            .filter((sample) => sample.visualHeight > 0)
            .sort((a, b) => b.y - a.y);

        if (this.perspectiveSamples.length >= 2) {
            this.referenceVisualHeight = Math.max(
                ...this.perspectiveSamples.map((sample) => sample.visualHeight),
            );
        }
    }

    private getPerspectiveScale(y: number): number {
        return this.getPerspectiveVisualHeight(y) / this.referenceVisualHeight;
    }

    private getPerspectiveVisualHeight(y: number): number {
        if (this.perspectiveProjection) {
            const { nearY, nearVisualHeight, horizonY } = this.perspectiveProjection;
            const denominator = horizonY - nearY;
            const projectedHeight = denominator <= 0
                ? nearVisualHeight
                : nearVisualHeight * (horizonY - y) / denominator;
            // At and beyond the visual horizon the character remains barely
            // visible and movable instead of becoming exactly zero-sized.
            return Math.max(nearVisualHeight * 0.04, projectedHeight);
        }

        if (this.perspectiveSamples.length < 2) {
            const range = this.sceneConfig.nearY - this.sceneConfig.farY;
            const t = range === 0
                ? 1
                : Math.max(0, Math.min(1, (y - this.sceneConfig.farY) / range));
            const scale = this.sceneConfig.farScale
                + (this.sceneConfig.nearScale - this.sceneConfig.farScale) * t;
            return this.referenceVisualHeight * scale;
        }

        const farthest = this.perspectiveSamples[0];
        const nearest = this.perspectiveSamples[this.perspectiveSamples.length - 1];
        if (y >= farthest.y) return farthest.visualHeight;
        if (y <= nearest.y) {
            // The closest SpriteSplash is a near-field calibration point, not
            // the end of the walkable foreground. Continue scaling toward the
            // configured front edge instead of clamping the whole foreground.
            const foregroundY = Math.min(this.sceneConfig.nearY, nearest.y - 1);
            const range = nearest.y - foregroundY;
            const t = range <= 0
                ? 0
                : Math.max(0, Math.min(1, (nearest.y - y) / range));
            return nearest.visualHeight * (1 + 0.5 * t);
        }

        for (let index = 0; index < this.perspectiveSamples.length - 1; index += 1) {
            const far = this.perspectiveSamples[index];
            const near = this.perspectiveSamples[index + 1];
            if (y > far.y || y < near.y) continue;
            const range = far.y - near.y;
            const t = range <= 0 ? 0 : (far.y - y) / range;
            const visualHeight = far.visualHeight
                + (near.visualHeight - far.visualHeight) * t;
            return visualHeight;
        }
        return this.referenceVisualHeight;
    }

    private getTargetCameraZoom(): number {
        const perspectiveScale = this.getPerspectiveScale(this.playerPosition.y);
        const distanceFactor = Math.max(0, Math.min(1, 1 - perspectiveScale));
        return 1 + distanceFactor * 0.35;
    }

    private updateCamera(deltaTime = 1 / 60): void {
        const visible = view.getVisibleSize();
        const targetZoom = this.getTargetCameraZoom();
        const zoomSmoothing = 1 - Math.exp(-4.5 * deltaTime);
        this.cameraZoom += (targetZoom - this.cameraZoom) * zoomSmoothing;
        this.world.setScale(this.cameraZoom, this.cameraZoom, 1);

        const maxX = Math.max(
            0,
            (this.sceneConfig.worldSize.width * this.cameraZoom - visible.width) * 0.5,
        );
        const maxY = Math.max(
            0,
            (this.sceneConfig.worldSize.height * this.cameraZoom - visible.height) * 0.5,
        );
        const desiredX = -this.playerPosition.x * this.cameraZoom;
        const visualHeight = this.getPerspectiveVisualHeight(this.playerPosition.y);
        // Keep the character's feet at one stable screen anchor. Only move the
        // anchor lower when a very large foreground character would otherwise
        // clip at the top; this avoids the previous competing Y offsets.
        const normalFootAnchorY = -visible.height * 0.18;
        const highestSafeFootAnchorY = visible.height * 0.5
            - 36
            - visualHeight * this.cameraZoom;
        const footAnchorY = Math.min(
            normalFootAnchorY,
            highestSafeFootAnchorY,
        );
        const desiredY = footAnchorY - this.playerPosition.y * this.cameraZoom;
        const targetX = Math.max(-maxX, Math.min(maxX, desiredX));
        const targetY = Math.max(-maxY, Math.min(maxY, desiredY));

        if (!this.cameraInitialized) {
            this.cameraPosition.set(targetX, targetY);
            this.cameraInitialized = true;
        } else {
            const positionSmoothing = 1 - Math.exp(-7 * deltaTime);
            this.cameraPosition.x += (targetX - this.cameraPosition.x) * positionSmoothing;
            this.cameraPosition.y += (targetY - this.cameraPosition.y) * positionSmoothing;
        }
        this.world.setPosition(this.cameraPosition.x, this.cameraPosition.y, 0);
    }

    private toggleRestoredMode(): void {
        if (EDITOR) return;
        const restored = this.getRestoredSpriteFrame();
        if (!restored) {
            this.restoredMode = false;
            this.updateHud('复原图待制作');
            return;
        }
        this.restoredMode = !this.restoredMode;
        const sprite = this.world.getChildByName('BackgroundCurrent')?.getComponent(Sprite);
        if (sprite) sprite.spriteFrame = this.getCurrentSpriteFrame();
        this.updateHud();
    }

    private getCurrentSpriteFrame(): SpriteFrame | null {
        if (this.restoredMode) return this.getRestoredSpriteFrame() ?? this.getPresentSpriteFrame();
        return this.getPresentSpriteFrame();
    }

    private getPresentSpriteFrame(): SpriteFrame | null {
        switch (this.currentSceneId) {
            case 'entrance-gate': return this.entranceGateCurrent;
            case 'main-road': return this.mainRoadCurrent;
            case 'cafe-garden': return this.cafeGardenCurrent;
            case 'leisure-plaza': return this.leisurePlazaCurrent;
            case 'visitor-building': return this.visitorBuildingCurrent;
            case 'exterior': return this.exteriorCurrent;
            case 'interior': return this.interiorCurrent;
            default: return null;
        }
    }

    private getRestoredSpriteFrame(): SpriteFrame | null {
        if (this.currentSceneId === 'exterior') return this.exteriorRestored;
        if (this.currentSceneId === 'interior') return this.interiorRestored;
        return null;
    }

    private updateHud(message = ''): void {
        if (!this.titleLabel || !this.modeLabel) return;
        this.titleLabel.string = this.sceneConfig.title;
        this.modeLabel.string = message || (this.restoredMode ? '切换：遗址现状' : '切换：历史复原');
    }

    private layoutUi(): void {
        if (!this.joystick) return;
        const visible = view.getVisibleSize();
        this.joystick.setPosition(-visible.width * 0.5 + 112, -visible.height * 0.5 + 112, 0);
        this.node.getChildByName('LocationTitle')?.setPosition(0, visible.height * 0.5 - 44, 0);
        this.node.getChildByName('ImageModeButton')?.setPosition(visible.width * 0.5 - 125, visible.height * 0.5 - 54, 0);
    }
}
