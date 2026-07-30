import {
    _decorator,
    Camera,
    Color,
    Component,
    director,
    EventKeyboard,
    EventTouch,
    Graphics,
    input,
    Input,
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
    OVERWORLD_ENTRANCES,
    OVERWORLD_MAP_SIZE,
    OVERWORLD_OBSTACLES,
    OVERWORLD_PLAYER_START,
    OVERWORLD_ROUTE_EDGES,
    OVERWORLD_ROUTE_POINTS,
    OverworldEntrance,
    OverworldRouteSegment,
} from './OverworldConfig';
import { LocationTransitionState } from '../location/LocationTransitionState';
import { DirectionalWalkAnimator } from '../player/DirectionalWalkAnimator';
import {
    OverworldTourEntranceContext,
    OverworldTourGuide,
    OverworldTourHost,
} from '../tour/OverworldTourGuide';

const { ccclass, executeInEditMode, property } = _decorator;

type ResolvedEntryPoint = {
    id: string;
    imageKey: string;
    entrance: OverworldEntrance;
    position: Vec2;
    triggerRadius: number;
};

@ccclass('OverworldBootstrap')
@executeInEditMode
export class OverworldBootstrap extends Component implements OverworldTourHost {
    @property({ type: SpriteFrame, tooltip: '编辑器与运行时使用的大地图底图' })
    mapSpriteFrame: SpriteFrame | null = null;

    private readonly moveSpeed = 110;
    private readonly playerRadius = 22;
    private readonly joystickRadius = 72;

    private world!: Node;
    private playerShadow!: Node;
    private player!: Node;
    private playerAnimator!: DirectionalWalkAnimator;
    private joystick!: Node;
    private joystickKnob!: Node;
    private entryPanel!: Node;
    private hintLabel!: Label;
    private playerPosition = new Vec2(OVERWORLD_PLAYER_START.x, OVERWORLD_PLAYER_START.y);
    private moveInput = new Vec2();
    private keyboardInput = new Vec2();
    private joystickInput = new Vec2();
    private pressedKeys = new Set<KeyCode>();
    private activeTouchId: number | null = null;
    private pausedByEntrance = false;
    private entrancePositions = new Map<string, Vec2>();
    private entranceTitles = new Map<string, string>();
    private entranceRadii = new Map<string, number>();
    private routePointPositions = new Map<string, Vec2>();
    private routeSegments: OverworldRouteSegment[] = [];
    private entryPoints: ResolvedEntryPoint[] = [];
    private activeEntryPoint: ResolvedEntryPoint | null = null;
    private activeEntryIds = new Set<string>();
    private tourGuide: OverworldTourGuide | null = null;
    private lastEditorCalibrationHash = '';
    private lastCanvasWidth = 0;
    private lastCanvasHeight = 0;

    onLoad(): void {
        if (EDITOR) {
            this.createEditorCalibration();
            return;
        }

        this.readEditorCalibration();
        this.rebuildRouteSegments();
        this.rebuildEntryPoints();
        if (!this.restorePlayerFromLocation()) this.snapPlayerToWalkableRoute();
        this.ensureCanvasCamera();
        this.createWorld();
        this.createHud();
        this.createJoystick();
        this.createEntryPanel();
        this.tourGuide = this.node.addComponent(OverworldTourGuide);
        this.tourGuide.initialize(this);
        this.bindInput();
        this.layoutScreenUi(true);
    }

    onDestroy(): void {
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
    }

    update(deltaTime: number): void {
        if (EDITOR) {
            this.updateEditorCalibrationIfNeeded();
            return;
        }
        this.layoutScreenUi(false);
        this.updateMovement(deltaTime);
        this.updateCamera(deltaTime);
    }

    private updateEditorCalibrationIfNeeded(): void {
        const calibration = this.node.getChildByName('MapCalibration');
        if (!calibration) return;

        const backgroundSprite = calibration.getChildByName('MapBackground')?.getComponent(Sprite);
        if (backgroundSprite && !backgroundSprite.spriteFrame && this.mapSpriteFrame) {
            backgroundSprite.spriteFrame = this.mapSpriteFrame;
        }

        const routePoints = calibration.getChildByName('RoutePoints');
        if (routePoints) this.removeObsoleteEditorRoutePoints(routePoints);
        const entrances = calibration.getChildByName('Entrances');
        const values: number[] = [];
        for (const point of OVERWORLD_ROUTE_POINTS) {
            const node = routePoints?.getChildByName(`RoutePoint-${point.id}`);
            values.push(node?.position.x ?? point.position.x, node?.position.y ?? point.position.y);
        }
        for (const entrance of OVERWORLD_ENTRANCES) {
            const node = entrances?.getChildByName(`Entrance-${entrance.id}`);
            if (node) values.push(node.position.x, node.position.y, node.scale.x, node.scale.y);
        }
        const hash = values.map((value) => value.toFixed(2)).join('|');
        if (hash === this.lastEditorCalibrationHash) return;
        this.lastEditorCalibrationHash = hash;

        this.captureCalibrationValues(calibration);
        this.rebuildRouteSegments();
        this.rebuildEntryPoints();
        this.drawEditorRoutePreview(calibration);
        this.drawEditorEntryPoints(calibration);
    }

    private ensureCanvasCamera(): void {
        const cameraNode = this.node.getChildByName('Camera');
        const camera = cameraNode?.getComponent(Camera);
        if (camera) {
            camera.visibility |= Layers.Enum.UI_2D;
        }
    }

    private createWorld(): void {
        this.world = new Node('Overworld');
        this.world.layer = Layers.Enum.UI_2D;
        this.world.addComponent(UITransform).setContentSize(OVERWORLD_MAP_SIZE);
        this.node.addChild(this.world);
        this.world.setSiblingIndex(0);

        const background = new Node('MapBackground');
        background.layer = Layers.Enum.UI_2D;
        const backgroundTransform = background.addComponent(UITransform);
        backgroundTransform.setContentSize(OVERWORLD_MAP_SIZE);
        const sprite = background.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this.world.addChild(background);
        background.setSiblingIndex(0);

        if (this.mapSpriteFrame) {
            sprite.spriteFrame = this.mapSpriteFrame;
            backgroundTransform.setContentSize(OVERWORLD_MAP_SIZE);
        } else resources.load('map/overworld/spriteFrame', SpriteFrame, (error, spriteFrame) => {
            if (error) {
                console.error('[Overworld] 大地图加载失败', error);
                return;
            }
            sprite.spriteFrame = spriteFrame;
            backgroundTransform.setContentSize(OVERWORLD_MAP_SIZE);
        });

        this.createMapOverlay();
        this.createPlayer();
        this.world.getChildByName('MapMarkers')?.setSiblingIndex(1);
        this.playerShadow.setSiblingIndex(2);
        this.player.setSiblingIndex(3);
        this.world.setPosition(-this.playerPosition.x, -this.playerPosition.y, 0);
    }

    /**
     * 编辑器里保留一套只用于校准的数据节点。
     * 入口和出生点可以直接拖动；运行时读取它们的位置后隐藏该节点。
     */
    private createEditorCalibration(): void {
        let calibration = this.node.getChildByName('MapCalibration');
        if (!calibration) {
            calibration = new Node('MapCalibration');
            calibration.layer = Layers.Enum.UI_2D;
            calibration.addComponent(UITransform).setContentSize(OVERWORLD_MAP_SIZE);
            this.node.addChild(calibration);
            calibration.setSiblingIndex(0);
        }

        let background = calibration.getChildByName('MapBackground');
        let backgroundCreated = false;
        if (!background) {
            backgroundCreated = true;
            background = new Node('MapBackground');
            background.layer = Layers.Enum.UI_2D;
            background.addComponent(UITransform).setContentSize(OVERWORLD_MAP_SIZE);
            const sprite = background.addComponent(Sprite);
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            calibration.addChild(background);
        }
        const backgroundTransform = background.getComponent(UITransform)!;
        if (backgroundCreated) backgroundTransform.setContentSize(OVERWORLD_MAP_SIZE);
        const backgroundSprite = background.getComponent(Sprite)!;
        // 编辑模式不再异步刷新或覆盖已有 SpriteFrame，避免拖动校准节点时底图闪回原点/变空。
        if (!backgroundSprite.spriteFrame && this.mapSpriteFrame) {
            backgroundSprite.spriteFrame = this.mapSpriteFrame;
        } else if (!this.mapSpriteFrame && backgroundSprite.spriteFrame) {
            this.mapSpriteFrame = backgroundSprite.spriteFrame;
        }

        let entrances = calibration.getChildByName('Entrances');
        if (!entrances) {
            entrances = new Node('Entrances');
            entrances.layer = Layers.Enum.UI_2D;
            entrances.addComponent(UITransform).setContentSize(OVERWORLD_MAP_SIZE);
            calibration.addChild(entrances);
        }

        let groundDecorations = calibration.getChildByName('GroundDecorations');
        if (!groundDecorations) {
            groundDecorations = new Node('GroundDecorations');
            groundDecorations.layer = Layers.Enum.UI_2D;
            groundDecorations.addComponent(UITransform).setContentSize(OVERWORLD_MAP_SIZE);
            calibration.addChild(groundDecorations);
        }

        let foreground = calibration.getChildByName('Foreground');
        if (!foreground) {
            foreground = new Node('Foreground');
            foreground.layer = Layers.Enum.UI_2D;
            foreground.addComponent(UITransform).setContentSize(OVERWORLD_MAP_SIZE);
            calibration.addChild(foreground);
        }

        for (const entrance of OVERWORLD_ENTRANCES) {
            const nodeName = `Entrance-${entrance.id}`;
            let marker = entrances.getChildByName(nodeName);
            if (!marker) {
                marker = new Node(nodeName);
                marker.layer = Layers.Enum.UI_2D;
                marker.addComponent(UITransform).setContentSize(entrance.triggerRadius * 2, entrance.triggerRadius * 2);
                marker.addComponent(Graphics);
                const initialPosition = this.normalizedToWorld(entrance.normalizedPosition);
                marker.setPosition(initialPosition.x, initialPosition.y, 0);
                entrances.addChild(marker);

                const label = this.createLabel(entrance.title, 24, new Color(61, 48, 31, 255));
                label.node.name = 'Title';
                label.node.getComponent(UITransform)!.setContentSize(240, 48);
                label.enableOutline = true;
                label.outlineColor = new Color(255, 246, 211, 235);
                label.outlineWidth = 5;
                label.node.setPosition(0, entrance.triggerRadius + 28, 0);
                marker.addChild(label.node);
            }

            const graphics = marker.getComponent(Graphics)!;
            graphics.clear();
            graphics.lineWidth = 6;
            graphics.strokeColor = new Color().fromHEX(entrance.accent);
            graphics.fillColor = new Color(255, 248, 219, 90);
            graphics.circle(0, 0, entrance.triggerRadius);
            graphics.fill();
            graphics.stroke();

            // 圆环缩放时抵消父节点缩放，使所有地点标题始终保持相同显示大小。
            const titleNode = marker.getChildByName('Title');
            if (titleNode) {
                const scaleX = Math.max(0.001, Math.abs(marker.scale.x));
                const scaleY = Math.max(0.001, Math.abs(marker.scale.y));
                titleNode.setScale(1 / scaleX, 1 / scaleY, 1);
                titleNode.setPosition(0, entrance.triggerRadius + 28 / scaleY, 0);
            }
        }

        let playerStart = calibration.getChildByName('PlayerStart');
        if (!playerStart) {
            playerStart = new Node('PlayerStart');
            playerStart.layer = Layers.Enum.UI_2D;
            playerStart.addComponent(UITransform).setContentSize(70, 90);
            const graphics = playerStart.addComponent(Graphics);
            graphics.fillColor = new Color(244, 207, 111, 255);
            graphics.strokeColor = new Color(63, 86, 82, 255);
            graphics.lineWidth = 6;
            graphics.circle(0, 0, 26);
            graphics.fill();
            graphics.stroke();
            playerStart.setPosition(OVERWORLD_PLAYER_START.x, OVERWORLD_PLAYER_START.y, 0);
            calibration.addChild(playerStart);
        }

        const routePoints = this.ensureEditorRoutePoints(calibration);
        this.captureCalibrationValues(calibration);
        this.rebuildRouteSegments();
        this.rebuildEntryPoints();
        const routePreview = this.drawEditorRoutePreview(calibration);
        const entryPointPreview = this.drawEditorEntryPoints(calibration);

        // Cocos 2D UI 按同级节点顺序绘制：越靠后越在上层。
        background.setSiblingIndex(0);
        routePreview.setSiblingIndex(1);
        groundDecorations.setSiblingIndex(2);
        entrances.setSiblingIndex(3);
        entryPointPreview.setSiblingIndex(4);
        routePoints.setSiblingIndex(5);
        playerStart.setSiblingIndex(6);
        foreground.setSiblingIndex(7);
    }

    private readEditorCalibration(): void {
        const calibration = this.node.getChildByName('MapCalibration');
        if (!calibration) return;

        this.captureCalibrationValues(calibration);
        calibration.active = false;
    }

    private captureCalibrationValues(calibration: Node): void {
        this.entrancePositions.clear();
        this.entranceTitles.clear();
        this.entranceRadii.clear();

        const entrances = calibration.getChildByName('Entrances');
        for (const entrance of OVERWORLD_ENTRANCES) {
            const marker = entrances?.getChildByName(`Entrance-${entrance.id}`);
            if (marker) {
                this.entrancePositions.set(entrance.id, new Vec2(marker.position.x, marker.position.y));
                const transform = marker.getComponent(UITransform);
                const baseRadius = transform ? Math.min(transform.width, transform.height) * 0.5 : entrance.triggerRadius;
                const scale = Math.max(Math.abs(marker.scale.x), Math.abs(marker.scale.y));
                this.entranceRadii.set(entrance.id, Math.max(8, baseRadius * scale));
                const title = marker.getChildByName('Title')?.getComponent(Label)?.string.trim();
                if (title) this.entranceTitles.set(entrance.id, title);
            }
        }

        const playerStart = calibration.getChildByName('PlayerStart');
        if (playerStart) this.playerPosition.set(playerStart.position.x, playerStart.position.y);

        this.routePointPositions.clear();
        const routePoints = calibration.getChildByName('RoutePoints');
        for (const point of OVERWORLD_ROUTE_POINTS) {
            const node = routePoints?.getChildByName(`RoutePoint-${point.id}`);
            const position = node ? new Vec2(node.position.x, node.position.y) : point.position.clone();
            this.routePointPositions.set(point.id, position);
        }
    }

    private ensureEditorRoutePoints(calibration: Node): Node {
        let parent = calibration.getChildByName('RoutePoints');
        if (!parent) {
            parent = new Node('RoutePoints');
            parent.layer = Layers.Enum.UI_2D;
            parent.addComponent(UITransform).setContentSize(OVERWORLD_MAP_SIZE);
            calibration.addChild(parent);
        }

        for (const point of OVERWORLD_ROUTE_POINTS) {
            const nodeName = `RoutePoint-${point.id}`;
            let marker = parent.getChildByName(nodeName);
            if (!marker) {
                marker = new Node(nodeName);
                marker.layer = Layers.Enum.UI_2D;
                marker.addComponent(UITransform).setContentSize(22, 22);
                marker.addComponent(Graphics);
                marker.setPosition(point.position.x, point.position.y, 0);
                parent.addChild(marker);

                const label = this.createLabel(point.id, 13, new Color(53, 40, 92, 255));
                label.node.name = 'PointName';
                label.node.getComponent(UITransform)!.setContentSize(180, 26);
                label.node.setPosition(0, 20, 0);
                marker.addChild(label.node);
            }

            const graphics = marker.getComponent(Graphics)!;
            graphics.clear();
            graphics.fillColor = new Color(145, 104, 214, 230);
            graphics.strokeColor = new Color(70, 43, 119, 255);
            graphics.lineWidth = 3;
            graphics.circle(0, 0, 8);
            graphics.fill();
            graphics.stroke();
        }
        this.removeObsoleteEditorRoutePoints(parent);
        return parent;
    }

    private removeObsoleteEditorRoutePoints(parent: Node): void {
        const activeNames = new Set(
            OVERWORLD_ROUTE_POINTS.map((point) => `RoutePoint-${point.id}`),
        );
        for (const child of [...parent.children]) {
            if (child.name.startsWith('RoutePoint-') && !activeNames.has(child.name)) {
                child.destroy();
            }
        }
    }

    private drawEditorRoutePreview(calibration: Node): Node {
        let preview = calibration.getChildByName('WalkableRoutes');
        if (!preview) {
            preview = new Node('WalkableRoutes');
            preview.layer = Layers.Enum.UI_2D;
            preview.addComponent(UITransform).setContentSize(OVERWORLD_MAP_SIZE);
            preview.addComponent(Graphics);
            calibration.addChild(preview);
        }

        const graphics = preview.getComponent(Graphics)!;
        graphics.clear();
        for (const route of this.routeSegments) {
            graphics.lineWidth = route.halfWidth * 2;
            graphics.strokeColor = new Color(63, 139, 120, 48);
            graphics.moveTo(route.start.x, route.start.y);
            graphics.lineTo(route.end.x, route.end.y);
            graphics.stroke();

            graphics.lineWidth = 3;
            graphics.strokeColor = new Color(39, 105, 91, 210);
            graphics.moveTo(route.start.x, route.start.y);
            graphics.lineTo(route.end.x, route.end.y);
            graphics.stroke();
        }
        return preview;
    }

    private drawEditorEntryPoints(calibration: Node): Node {
        let parent = calibration.getChildByName('EntryPoints');
        if (!parent) {
            parent = new Node('EntryPoints');
            parent.layer = Layers.Enum.UI_2D;
            parent.addComponent(UITransform).setContentSize(OVERWORLD_MAP_SIZE);
            calibration.addChild(parent);
        }

        const activeNames = new Set<string>();
        for (const point of this.entryPoints) {
            const nodeName = `Entry-${point.id}`;
            activeNames.add(nodeName);
            let marker = parent.getChildByName(nodeName);
            if (!marker) {
                marker = new Node(nodeName);
                marker.layer = Layers.Enum.UI_2D;
                marker.addComponent(UITransform).setContentSize(point.triggerRadius * 2, point.triggerRadius * 2);
                marker.addComponent(Graphics);
                parent.addChild(marker);

                const label = this.createLabel(point.imageKey, 14, new Color(22, 76, 73, 255));
                label.node.name = 'ImageKey';
                label.node.getComponent(UITransform)!.setContentSize(190, 30);
                label.node.setPosition(0, point.triggerRadius + 16, 0);
                marker.addChild(label.node);
            }

            marker.active = true;
            marker.setPosition(point.position.x, point.position.y, 0);
            marker.getComponent(UITransform)!.setContentSize(point.triggerRadius * 2, point.triggerRadius * 2);
            const graphics = marker.getComponent(Graphics)!;
            graphics.clear();
            graphics.lineWidth = 4;
            graphics.fillColor = new Color(80, 221, 203, 105);
            graphics.strokeColor = new Color(22, 130, 120, 255);
            graphics.circle(0, 0, point.triggerRadius);
            graphics.fill();
            graphics.stroke();
            const imageLabel = marker.getChildByName('ImageKey')?.getComponent(Label);
            if (imageLabel) imageLabel.string = point.imageKey;
        }

        for (const child of [...parent.children]) {
            if (child.name.startsWith('Entry-') && !activeNames.has(child.name)) {
                child.destroy();
            }
        }
        return parent;
    }

    private createMapOverlay(): void {
        const overlay = new Node('MapMarkers');
        overlay.layer = Layers.Enum.UI_2D;
        overlay.addComponent(UITransform).setContentSize(OVERWORLD_MAP_SIZE);
        const graphics = overlay.addComponent(Graphics);
        this.world.addChild(overlay);

        graphics.lineWidth = 5;
        for (const entrance of OVERWORLD_ENTRANCES) {
            const position = this.getEntrancePosition(entrance);
            const radius = this.getEntranceRadius(entrance);
            graphics.strokeColor = new Color().fromHEX(entrance.accent);
            graphics.fillColor = new Color(255, 248, 219, 90);
            graphics.circle(position.x, position.y, radius);
            graphics.fill();
            graphics.stroke();
            this.createEntranceLabel(overlay, entrance, position, radius);
        }

        graphics.fillColor = new Color(120, 50, 40, 80);
        for (const obstacle of OVERWORLD_OBSTACLES) {
            graphics.rect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
            graphics.fill();
        }
    }

    private createEntranceLabel(parent: Node, entrance: OverworldEntrance, position: Vec2, radius: number): void {
        const labelNode = new Node(`Label-${entrance.id}`);
        labelNode.layer = Layers.Enum.UI_2D;
        labelNode.addComponent(UITransform).setContentSize(210, 46);
        const label = labelNode.addComponent(Label);
        label.string = this.getEntranceTitle(entrance);
        label.fontSize = 24;
        label.lineHeight = 30;
        label.color = new Color(61, 48, 31, 255);
        label.enableOutline = true;
        label.outlineColor = new Color(255, 246, 211, 235);
        label.outlineWidth = 5;
        labelNode.setPosition(position.x, position.y + radius + 28, 0);
        parent.addChild(labelNode);
    }

    private createPlayer(): void {
        this.playerShadow = new Node('PlayerShadow');
        this.playerShadow.layer = Layers.Enum.UI_2D;
        this.playerShadow.addComponent(UITransform).setContentSize(40, 14);
        const shadow = this.playerShadow.addComponent(Graphics);
        shadow.fillColor = new Color(30, 25, 20, 56);
        shadow.ellipse(0, 1, 18, 5);
        shadow.fill();
        this.playerShadow.setPosition(this.playerPosition.x, this.playerPosition.y + 1, 0);
        this.world.addChild(this.playerShadow);

        this.player = new Node('Player');
        this.player.layer = Layers.Enum.UI_2D;
        this.player.addComponent(UITransform);
        this.player.addComponent(Sprite);
        this.playerAnimator = this.player.addComponent(DirectionalWalkAnimator);
        this.playerAnimator.setDisplaySize(66, 88);
        this.player.setPosition(this.playerPosition.x, this.playerPosition.y, 0);
        this.world.addChild(this.player);
    }

    private createHud(): void {
        const title = this.createLabel('明中都遗址 · 俯瞰大地图', 30, new Color(255, 246, 218, 255));
        title.node.name = 'MapTitle';
        title.node.getComponent(UITransform)!.setContentSize(560, 54);
        this.node.addChild(title.node);

        this.hintLabel = this.createLabel('左下摇杆移动 · 进入彩色圆环自动到达地点', 22, new Color(245, 235, 206, 255));
        this.hintLabel.node.name = 'ControlHint';
        this.hintLabel.node.getComponent(UITransform)!.setContentSize(620, 44);
        this.node.addChild(this.hintLabel.node);
    }

    private createJoystick(): void {
        this.joystick = new Node('VirtualJoystick');
        this.joystick.layer = Layers.Enum.UI_2D;
        this.joystick.addComponent(UITransform).setContentSize(210, 210);
        const base = this.joystick.addComponent(Graphics);
        base.fillColor = new Color(25, 35, 31, 125);
        base.strokeColor = new Color(255, 241, 193, 190);
        base.lineWidth = 5;
        base.circle(0, 0, this.joystickRadius + 16);
        base.fill();
        base.stroke();
        this.node.addChild(this.joystick);

        this.joystickKnob = new Node('JoystickKnob');
        this.joystickKnob.layer = Layers.Enum.UI_2D;
        this.joystickKnob.addComponent(UITransform).setContentSize(84, 84);
        const knob = this.joystickKnob.addComponent(Graphics);
        knob.fillColor = new Color(234, 197, 103, 230);
        knob.strokeColor = new Color(72, 69, 48, 255);
        knob.lineWidth = 4;
        knob.circle(0, 0, 39);
        knob.fill();
        knob.stroke();
        this.joystick.addChild(this.joystickKnob);

        this.joystick.on(Node.EventType.TOUCH_START, this.onJoystickStart, this);
        this.joystick.on(Node.EventType.TOUCH_MOVE, this.onJoystickMove, this);
        this.joystick.on(Node.EventType.TOUCH_END, this.onJoystickEnd, this);
        this.joystick.on(Node.EventType.TOUCH_CANCEL, this.onJoystickEnd, this);
    }

    private createEntryPanel(): void {
        this.entryPanel = new Node('EntryPlaceholder');
        this.entryPanel.layer = Layers.Enum.UI_2D;
        this.entryPanel.addComponent(UITransform).setContentSize(570, 270);
        const card = this.entryPanel.addComponent(Graphics);
        card.fillColor = new Color(35, 45, 38, 242);
        card.strokeColor = new Color(234, 197, 103, 255);
        card.lineWidth = 5;
        card.roundRect(-285, -135, 570, 270, 24);
        card.fill();
        card.stroke();

        const title = this.createLabel('', 34, new Color(255, 237, 181, 255));
        title.node.name = 'EntryTitle';
        title.node.getComponent(UITransform)!.setContentSize(510, 80);
        title.node.setPosition(0, 48, 0);
        this.entryPanel.addChild(title.node);

        const detail = this.createLabel('已自动进入地点场景\n当前为地图阶段的占位层', 23, new Color(223, 226, 210, 255));
        detail.node.name = 'EntryDetail';
        detail.node.getComponent(UITransform)!.setContentSize(500, 76);
        detail.node.setPosition(0, -20, 0);
        this.entryPanel.addChild(detail.node);

        const backButton = new Node('BackButton');
        backButton.layer = Layers.Enum.UI_2D;
        backButton.addComponent(UITransform).setContentSize(320, 54);
        backButton.setPosition(0, -91, 0);
        const backBg = backButton.addComponent(Graphics);
        backBg.fillColor = new Color(236, 199, 105, 255);
        backBg.roundRect(-160, -27, 320, 54, 14);
        backBg.fill();
        const back = this.createLabel('点击此处返回大地图', 24, new Color(79, 72, 45, 255));
        back.node.getComponent(UITransform)!.setContentSize(320, 54);
        backButton.addChild(back.node);
        this.entryPanel.addChild(backButton);
        backButton.on(Node.EventType.TOUCH_END, this.closeEntryPanel, this);

        this.entryPanel.active = false;
        this.node.addChild(this.entryPanel);
    }

    private createLabel(text: string, fontSize: number, color: Color): Label {
        const node = new Node('Label');
        node.layer = Layers.Enum.UI_2D;
        node.addComponent(UITransform).setContentSize(400, 48);
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = fontSize;
        label.lineHeight = fontSize + 8;
        label.color = color;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.enableWrapText = true;
        return label;
    }

    private bindInput(): void {
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
    }

    private onKeyDown(event: EventKeyboard): void {
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
        if (this.activeTouchId !== null || this.pausedByEntrance) return;
        this.activeTouchId = event.getID();
        this.updateJoystick(event);
    }

    private onJoystickMove(event: EventTouch): void {
        if (event.getID() !== this.activeTouchId) return;
        this.updateJoystick(event);
    }

    private onJoystickEnd(event: EventTouch): void {
        if (event.getID() !== this.activeTouchId) return;
        this.activeTouchId = null;
        this.joystickInput.set(0, 0);
        this.joystickKnob.setPosition(0, 0, 0);
    }

    private updateJoystick(event: EventTouch): void {
        const location = event.getUILocation();
        const transform = this.joystick.getComponent(UITransform)!;
        const local = transform.convertToNodeSpaceAR(new Vec3(location.x, location.y, 0));
        const delta = new Vec2(local.x, local.y);
        const length = delta.length();
        if (length > this.joystickRadius) delta.multiplyScalar(this.joystickRadius / length);
        this.joystickKnob.setPosition(delta.x, delta.y, 0);
        this.joystickInput.set(delta.x / this.joystickRadius, delta.y / this.joystickRadius);
    }

    private updateMovement(deltaTime: number): void {
        if (this.pausedByEntrance) {
            this.playerAnimator?.stop();
            return;
        }
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
        const step = this.moveInput.clone().multiplyScalar(this.moveSpeed * deltaTime);
        const nextX = new Vec2(this.playerPosition.x + step.x, this.playerPosition.y);
        if (this.canStandAt(nextX)) this.playerPosition.x = nextX.x;
        const nextY = new Vec2(this.playerPosition.x, this.playerPosition.y + step.y);
        if (this.canStandAt(nextY)) this.playerPosition.y = nextY.y;
        const moved = Vec2.distance(previousPosition, this.playerPosition) > 0.01;
        this.playerAnimator?.setMovement(this.moveInput, moved);
        this.player.setPosition(this.playerPosition.x, this.playerPosition.y, 0);
        this.playerShadow.setPosition(this.playerPosition.x, this.playerPosition.y + 1, 0);
        this.checkEntrance(previousPosition);
    }

    private canStandAt(position: Vec2): boolean {
        const halfWidth = OVERWORLD_MAP_SIZE.width * 0.5 - this.playerRadius;
        const halfHeight = OVERWORLD_MAP_SIZE.height * 0.5 - this.playerRadius;
        if (Math.abs(position.x) > halfWidth || Math.abs(position.y) > halfHeight) return false;

        const onRoad = this.routeSegments.some((route) => (
            Vec2.distance(position, this.closestPointOnSegment(position, route)) <= route.halfWidth
        ));
        if (!onRoad) return false;

        for (const obstacle of OVERWORLD_OBSTACLES) {
            const nearestX = this.clamp(position.x, obstacle.x, obstacle.x + obstacle.width);
            const nearestY = this.clamp(position.y, obstacle.y, obstacle.y + obstacle.height);
            const dx = position.x - nearestX;
            const dy = position.y - nearestY;
            if (dx * dx + dy * dy < this.playerRadius * this.playerRadius) return false;
        }
        return true;
    }

    private checkEntrance(previousPosition?: Vec2): void {
        const nextActiveIds = new Set<string>();
        for (const point of this.entryPoints) {
            const currentDistance = Vec2.distance(this.playerPosition, point.position);
            if (currentDistance <= point.triggerRadius) nextActiveIds.add(point.id);
            const sweptDistance = previousPosition
                ? this.distanceToSegment(point.position, previousPosition, this.playerPosition)
                : currentDistance;
            const crossed = Math.min(currentDistance, sweptDistance) <= point.triggerRadius;
            if (crossed && !this.activeEntryIds.has(point.id)) {
                nextActiveIds.add(point.id);
                this.activeEntryIds = nextActiveIds;
                this.traverseLocation(point);
                return;
            }
        }
        this.activeEntryIds = nextActiveIds;
    }

    private distanceToSegment(point: Vec2, start: Vec2, end: Vec2): number {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const lengthSqr = dx * dx + dy * dy;
        if (lengthSqr < 0.0001) return Vec2.distance(point, start);
        const t = this.clamp(
            ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSqr,
            0,
            1,
        );
        return Vec2.distance(point, new Vec2(start.x + dx * t, start.y + dy * t));
    }

    private traverseLocation(source: ResolvedEntryPoint): void {
        const tourSource: OverworldTourEntranceContext = {
            id: source.id,
            entranceId: source.entrance.id,
            title: this.getEntranceTitle(source.entrance),
            position: source.position.clone(),
            triggerRadius: source.triggerRadius,
        };
        if (this.tourGuide?.handleEntrance(tourSource)) return;

        if (source.entrance.id === 'location-1') {
            const localEntryId = source.id.replace(/^location-/, '');
            const entersFromWest = /-west-\d+$/.test(source.id);
            LocationTransitionState.enterLocation(
                'visitor-center',
                entersFromWest ? 'entrance-gate' : 'main-road',
                `spawn-${localEntryId}`,
            );
            director.loadScene('LocationTemplate');
            return;
        }

        const alternatives = this.entryPoints.filter((point) => (
            point.entrance.id === source.entrance.id && point.id !== source.id
        ));
        const destination = alternatives.length > 0
            ? alternatives[Math.floor(Math.random() * alternatives.length)]
            : source;

        const center = this.getEntrancePosition(destination.entrance);
        let nearestRoute: OverworldRouteSegment | null = null;
        let nearestDistance = Number.POSITIVE_INFINITY;
        for (const route of this.routeSegments) {
            const distance = Vec2.distance(destination.position, this.closestPointOnSegment(destination.position, route));
            if (distance < nearestDistance) {
                nearestRoute = route;
                nearestDistance = distance;
            }
        }

        if (nearestRoute) {
            const tangent = nearestRoute.end.clone().subtract(nearestRoute.start);
            if (tangent.lengthSqr() > 0.001) {
                tangent.normalize();
                const offset = destination.triggerRadius + this.playerRadius + 18;
                const forward = destination.position.clone().add(tangent.clone().multiplyScalar(offset));
                const backward = destination.position.clone().subtract(tangent.clone().multiplyScalar(offset));
                this.playerPosition.set(
                    Vec2.distance(forward, center) >= Vec2.distance(backward, center) ? forward : backward,
                );
            } else {
                this.playerPosition.set(destination.position);
            }
        } else {
            this.playerPosition.set(destination.position);
        }

        this.snapPlayerToWalkableRoute();
        this.player.setPosition(this.playerPosition.x, this.playerPosition.y, 0);
        this.playerShadow.setPosition(this.playerPosition.x, this.playerPosition.y + 1, 0);
        this.node.emit('overworld-location-traverse', {
            locationId: source.entrance.id,
            entryId: source.id,
            entryImageKey: source.imageKey,
            exitId: destination.id,
            exitImageKey: destination.imageKey,
        });
        console.log(
            `[Overworld] ${source.entrance.id}: ${source.imageKey} -> ${destination.imageKey}`,
        );
    }

    private openEntryPanel(point: ResolvedEntryPoint): void {
        this.activeEntryPoint = point;
        this.pausedByEntrance = true;
        this.joystickInput.set(0, 0);
        this.joystickKnob.setPosition(0, 0, 0);
        const title = this.entryPanel.getChildByName('EntryTitle')!.getComponent(Label)!;
        title.string = this.getEntranceTitle(point.entrance);
        const detail = this.entryPanel.getChildByName('EntryDetail')?.getComponent(Label);
        if (detail) detail.string = `从 ${this.getEntryDirectionName(point)} 进入\n图片：${point.imageKey}`;
        this.entryPanel.active = true;
        this.entryPanel.setSiblingIndex(this.node.children.length - 1);
    }

    private closeEntryPanel(): void {
        this.entryPanel.active = false;
        this.pausedByEntrance = false;
        // 将玩家推出当前入口碰撞点，避免返回后立即再次进入。
        const point = this.activeEntryPoint;
        this.activeEntryPoint = null;
        if (!point) return;
        const direction = this.playerPosition.clone().subtract(point.position);
        if (direction.lengthSqr() < 0.01) direction.set(0, -1);
        direction.normalize().multiplyScalar(point.triggerRadius + this.playerRadius + 12);
        this.playerPosition.add(direction);
        this.snapPlayerToWalkableRoute();
        this.player.setPosition(this.playerPosition.x, this.playerPosition.y, 0);
        this.playerShadow.setPosition(this.playerPosition.x, this.playerPosition.y + 1, 0);
    }

    private updateCamera(deltaTime: number): void {
        const visible = view.getVisibleSize();
        const maxCameraX = Math.max(0, (OVERWORLD_MAP_SIZE.width - visible.width) * 0.5);
        const maxCameraY = Math.max(0, (OVERWORLD_MAP_SIZE.height - visible.height) * 0.5);
        const targetX = -this.clamp(this.playerPosition.x, -maxCameraX, maxCameraX);
        const targetY = -this.clamp(this.playerPosition.y, -maxCameraY, maxCameraY);
        const current = this.world.position;
        const smooth = 1 - Math.pow(0.001, deltaTime);
        this.world.setPosition(
            current.x + (targetX - current.x) * smooth,
            current.y + (targetY - current.y) * smooth,
            0,
        );
    }

    private layoutScreenUi(force: boolean): void {
        const visible = view.getVisibleSize();
        if (!force && visible.width === this.lastCanvasWidth && visible.height === this.lastCanvasHeight) return;
        this.lastCanvasWidth = visible.width;
        this.lastCanvasHeight = visible.height;
        this.node.getChildByName('MapTitle')?.setPosition(-visible.width * 0.5 + 300, visible.height * 0.5 - 48, 0);
        this.node.getChildByName('ControlHint')?.setPosition(-visible.width * 0.5 + 330, visible.height * 0.5 - 94, 0);
        this.joystick?.setPosition(-visible.width * 0.5 + 132, -visible.height * 0.5 + 132, 0);
        this.entryPanel?.setPosition(0, 0, 0);
    }

    private rebuildRouteSegments(): void {
        this.routeSegments = [];
        for (const edge of OVERWORLD_ROUTE_EDGES) {
            const start = this.routePointPositions.get(edge.from)
                ?? OVERWORLD_ROUTE_POINTS.find((point) => point.id === edge.from)?.position;
            const end = this.routePointPositions.get(edge.to)
                ?? OVERWORLD_ROUTE_POINTS.find((point) => point.id === edge.to)?.position;
            if (!start || !end) continue;
            this.routeSegments.push({
                id: edge.id,
                start: start.clone(),
                end: end.clone(),
                halfWidth: edge.halfWidth,
            });
        }
    }

    private rebuildEntryPoints(): void {
        this.entryPoints = [];

        for (const entrance of OVERWORLD_ENTRANCES) {
            const center = this.getEntrancePosition(entrance);
            const radius = this.getEntranceRadius(entrance);
            const intersections: Vec2[] = [];

            for (const route of this.routeSegments) {
                for (const point of this.segmentCircleIntersections(route, center, radius)) {
                    if (!intersections.some((existing) => Vec2.distance(existing, point) < 18)) {
                        intersections.push(point);
                    }
                }
            }

            // 标注线没有精确穿过圆时，仍用最近道路点提供一个可进入口。
            if (intersections.length === 0) {
                let nearest: Vec2 | null = null;
                let nearestDistance = Number.POSITIVE_INFINITY;
                for (const route of this.routeSegments) {
                    const point = this.closestPointOnSegment(center, route);
                    const distance = Vec2.distance(center, point);
                    if (distance < nearestDistance) {
                        nearest = point;
                        nearestDistance = distance;
                    }
                }
                if (nearest) intersections.push(nearest);
            }

            intersections.sort((a, b) => (
                Math.atan2(a.y - center.y, a.x - center.x)
                - Math.atan2(b.y - center.y, b.x - center.x)
            ));

            const directionCounts = new Map<string, number>();
            for (const position of intersections) {
                const direction = this.getDirectionKey(center, position);
                const index = (directionCounts.get(direction) ?? 0) + 1;
                directionCounts.set(direction, index);
                const suffix = index < 10 ? `0${index}` : String(index);
                this.entryPoints.push({
                    id: `${entrance.id}-${direction}-${suffix}`,
                    imageKey: `locations/${entrance.id}/${direction}-${suffix}`,
                    entrance,
                    position,
                    triggerRadius: Math.max(10, Math.min(16, radius * 0.25)),
                });
            }
        }

        this.mergeStonePierNortheastEntry();
    }

    private restorePlayerFromLocation(): boolean {
        const entryId = LocationTransitionState.consumeOverworldEntryId();
        if (!entryId) return false;
        const point = this.entryPoints.find((entry) => entry.id === entryId);
        if (!point) return false;

        const center = this.getEntrancePosition(point.entrance);
        const outward = point.position.clone().subtract(center);
        if (outward.lengthSqr() < 0.0001) outward.set(1, 0);
        outward.normalize().multiplyScalar(point.triggerRadius + this.playerRadius + 8);
        this.playerPosition.set(point.position).add(outward);
        this.snapPlayerToWalkableRoute();
        return true;
    }

    private mergeStonePierNortheastEntry(): void {
        const stoneEntries = this.entryPoints.filter((point) => point.entrance.id === 'location-2');
        const center = stoneEntries.length > 0
            ? this.getEntrancePosition(stoneEntries[0].entrance)
            : null;
        const upperEntries = center
            ? stoneEntries
                .filter((point) => point.position.y >= center.y)
                .sort((a, b) => b.position.y - a.position.y)
            : [];

        // 正交化后右上角的两条道路交点会先被几何去重，此时已经只有 3 个入口。
        // 只把最靠右的上方入口改名为 northeast，不能再次合并，否则会误删为 2 个。
        if (stoneEntries.length === 3) {
            const northeast = [...upperEntries].sort((a, b) => b.position.x - a.position.x)[0];
            if (!northeast) return;
            this.entryPoints = this.entryPoints.filter((point) => point !== northeast);
            this.entryPoints.push({
                ...northeast,
                id: 'location-2-northeast-01',
                imageKey: 'locations/location-2/northeast-01',
            });
            return;
        }

        const legacyEast = this.entryPoints.find((point) => point.id === 'location-2-east-02');
        const legacyNorth = this.entryPoints.find((point) => point.id === 'location-2-north-01');
        const east = legacyEast;
        const north = legacyNorth;
        if (!east || !north || east === north) return;

        this.entryPoints = this.entryPoints.filter((point) => point !== east && point !== north);
        this.entryPoints.push({
            id: 'location-2-northeast-01',
            imageKey: 'locations/location-2/northeast-01',
            entrance: east.entrance,
            position: new Vec2(
                (east.position.x + north.position.x) * 0.5,
                (east.position.y + north.position.y) * 0.5,
            ),
            triggerRadius: Math.max(east.triggerRadius, north.triggerRadius),
        });
    }

    private segmentCircleIntersections(route: OverworldRouteSegment, center: Vec2, radius: number): Vec2[] {
        const dx = route.end.x - route.start.x;
        const dy = route.end.y - route.start.y;
        const fx = route.start.x - center.x;
        const fy = route.start.y - center.y;
        const a = dx * dx + dy * dy;
        if (a < 0.0001) return [];
        const b = 2 * (fx * dx + fy * dy);
        const c = fx * fx + fy * fy - radius * radius;
        const discriminant = b * b - 4 * a * c;
        if (discriminant < 0) return [];

        const root = Math.sqrt(discriminant);
        const results: Vec2[] = [];
        for (const t of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
            if (t >= 0 && t <= 1) {
                results.push(new Vec2(route.start.x + dx * t, route.start.y + dy * t));
            }
        }
        return results;
    }

    private closestPointOnSegment(point: Vec2, route: OverworldRouteSegment): Vec2 {
        const dx = route.end.x - route.start.x;
        const dy = route.end.y - route.start.y;
        const lengthSqr = dx * dx + dy * dy;
        if (lengthSqr < 0.0001) return route.start.clone();
        const t = this.clamp(
            ((point.x - route.start.x) * dx + (point.y - route.start.y) * dy) / lengthSqr,
            0,
            1,
        );
        return new Vec2(route.start.x + dx * t, route.start.y + dy * t);
    }

    private snapPlayerToWalkableRoute(): void {
        let nearest = this.playerPosition.clone();
        let nearestDistance = Number.POSITIVE_INFINITY;
        for (const route of this.routeSegments) {
            const point = this.closestPointOnSegment(this.playerPosition, route);
            const distance = Vec2.distance(this.playerPosition, point);
            if (distance < nearestDistance) {
                nearest = point;
                nearestDistance = distance;
            }
            if (distance <= route.halfWidth) return;
        }
        this.playerPosition.set(nearest);
    }

    private getDirectionKey(center: Vec2, point: Vec2): string {
        const dx = point.x - center.x;
        const dy = point.y - center.y;
        if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'east' : 'west';
        return dy >= 0 ? 'north' : 'south';
    }

    private getEntryDirectionName(point: ResolvedEntryPoint): string {
        if (point.id.includes('-northeast-')) return '东北侧入口';
        const direction = this.getDirectionKey(this.getEntrancePosition(point.entrance), point.position);
        return ({ north: '北侧入口', south: '南侧入口', east: '东侧入口', west: '西侧入口' })[direction];
    }

    private normalizedToWorld(normalized: Vec2): Vec2 {
        return new Vec2(
            (normalized.x - 0.5) * OVERWORLD_MAP_SIZE.width,
            (0.5 - normalized.y) * OVERWORLD_MAP_SIZE.height,
        );
    }

    private getEntrancePosition(entrance: OverworldEntrance): Vec2 {
        return this.entrancePositions.get(entrance.id) ?? this.normalizedToWorld(entrance.normalizedPosition);
    }

    private getEntranceTitle(entrance: OverworldEntrance): string {
        return this.entranceTitles.get(entrance.id) ?? entrance.title;
    }

    private getEntranceRadius(entrance: OverworldEntrance): number {
        return this.entranceRadii.get(entrance.id) ?? entrance.triggerRadius;
    }

    getTourWorld(): Node {
        return this.world;
    }

    getTourPlayerPosition(): Vec2 {
        return this.playerPosition.clone();
    }

    setTourPaused(paused: boolean): void {
        this.pausedByEntrance = paused;
        if (paused) {
            this.joystickInput.set(0, 0);
            this.keyboardInput.set(0, 0);
            this.joystickKnob?.setPosition(0, 0, 0);
            this.playerAnimator?.stop();
        }
    }

    finishTourCheckpoint(source: OverworldTourEntranceContext, targetEntranceId: string): void {
        let nearestRoute: OverworldRouteSegment | null = null;
        let nearestDistance = Number.POSITIVE_INFINITY;
        for (const route of this.routeSegments) {
            const distance = Vec2.distance(source.position, this.closestPointOnSegment(source.position, route));
            if (distance < nearestDistance) {
                nearestRoute = route;
                nearestDistance = distance;
            }
        }
        if (!nearestRoute) return;

        const tangent = nearestRoute.end.clone().subtract(nearestRoute.start);
        if (tangent.lengthSqr() < 0.001) return;
        tangent.normalize();
        const offset = source.triggerRadius + this.playerRadius + 20;
        const forward = source.position.clone().add(tangent.clone().multiplyScalar(offset));
        const backward = source.position.clone().subtract(tangent.clone().multiplyScalar(offset));
        const targetEntrance = OVERWORLD_ENTRANCES.find((entrance) => entrance.id === targetEntranceId);
        const target = targetEntrance
            ? this.getEntrancePosition(targetEntrance)
            : this.playerPosition.clone().add(tangent);
        this.playerPosition.set(
            Vec2.distance(forward, target) <= Vec2.distance(backward, target) ? forward : backward,
        );
        this.snapPlayerToWalkableRoute();
        this.player.setPosition(this.playerPosition.x, this.playerPosition.y, 0);
        this.playerShadow.setPosition(this.playerPosition.x, this.playerPosition.y + 1, 0);
        this.activeEntryIds.clear();
    }

    getTourPathToEntrance(entranceId: string): Vec2[] {
        const targets = this.entryPoints.filter((point) => point.entrance.id === entranceId);
        if (targets.length === 0 || this.routeSegments.length === 0) return [];
        const target = targets.reduce((best, candidate) => (
            Vec2.distance(candidate.position, this.playerPosition)
                < Vec2.distance(best.position, this.playerPosition)
                ? candidate
                : best
        ));
        const startRoute = this.findNearestRoute(this.playerPosition);
        const targetRoute = this.findNearestRoute(target.position);
        if (!startRoute || !targetRoute) return [this.playerPosition.clone(), target.position.clone()];

        const startProjection = this.closestPointOnSegment(this.playerPosition, startRoute);
        const targetProjection = this.closestPointOnSegment(target.position, targetRoute);
        const graph = new Map<string, Array<{ id: string; weight: number }>>();
        const positions = new Map<string, Vec2>();
        const connect = (a: string, b: string, weight: number) => {
            if (!graph.has(a)) graph.set(a, []);
            if (!graph.has(b)) graph.set(b, []);
            graph.get(a)!.push({ id: b, weight });
            graph.get(b)!.push({ id: a, weight });
        };
        for (const point of OVERWORLD_ROUTE_POINTS) {
            positions.set(
                point.id,
                (this.routePointPositions.get(point.id) ?? point.position).clone(),
            );
        }
        for (const edge of OVERWORLD_ROUTE_EDGES) {
            const start = positions.get(edge.from);
            const end = positions.get(edge.to);
            if (start && end) connect(edge.from, edge.to, Vec2.distance(start, end));
        }
        positions.set('__tour-start', startProjection);
        positions.set('__tour-target', targetProjection);
        const startEdge = OVERWORLD_ROUTE_EDGES.find((edge) => edge.id === startRoute.id);
        const targetEdge = OVERWORLD_ROUTE_EDGES.find((edge) => edge.id === targetRoute.id);
        if (startEdge) {
            connect('__tour-start', startEdge.from, Vec2.distance(startProjection, positions.get(startEdge.from)!));
            connect('__tour-start', startEdge.to, Vec2.distance(startProjection, positions.get(startEdge.to)!));
        }
        if (targetEdge) {
            connect('__tour-target', targetEdge.from, Vec2.distance(targetProjection, positions.get(targetEdge.from)!));
            connect('__tour-target', targetEdge.to, Vec2.distance(targetProjection, positions.get(targetEdge.to)!));
        }
        if (startRoute.id === targetRoute.id) {
            connect('__tour-start', '__tour-target', Vec2.distance(startProjection, targetProjection));
        }

        const distances = new Map<string, number>([['__tour-start', 0]]);
        const previous = new Map<string, string>();
        const pending = new Set(graph.keys());
        while (pending.size > 0) {
            let current = '';
            let currentDistance = Number.POSITIVE_INFINITY;
            for (const id of pending) {
                const distance = distances.get(id) ?? Number.POSITIVE_INFINITY;
                if (distance < currentDistance) {
                    current = id;
                    currentDistance = distance;
                }
            }
            if (!current || !Number.isFinite(currentDistance)) break;
            pending.delete(current);
            if (current === '__tour-target') break;
            for (const neighbor of graph.get(current) ?? []) {
                const candidate = currentDistance + neighbor.weight;
                if (candidate < (distances.get(neighbor.id) ?? Number.POSITIVE_INFINITY)) {
                    distances.set(neighbor.id, candidate);
                    previous.set(neighbor.id, current);
                }
            }
        }

        const ids: string[] = [];
        let cursor = '__tour-target';
        while (cursor) {
            ids.push(cursor);
            if (cursor === '__tour-start') break;
            cursor = previous.get(cursor) ?? '';
        }
        if (ids[ids.length - 1] !== '__tour-start') {
            return [this.playerPosition.clone(), startProjection, targetProjection, target.position.clone()];
        }
        ids.reverse();
        const path = [this.playerPosition.clone()];
        for (const id of ids) {
            const position = positions.get(id);
            if (position && Vec2.distance(path[path.length - 1], position) > 1) path.push(position.clone());
        }
        if (Vec2.distance(path[path.length - 1], target.position) > 1) path.push(target.position.clone());
        return path;
    }

    private findNearestRoute(position: Vec2): OverworldRouteSegment | null {
        let nearest: OverworldRouteSegment | null = null;
        let distance = Number.POSITIVE_INFINITY;
        for (const route of this.routeSegments) {
            const candidate = Vec2.distance(position, this.closestPointOnSegment(position, route));
            if (candidate < distance) {
                nearest = route;
                distance = candidate;
            }
        }
        return nearest;
    }

    private clamp(value: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, value));
    }
}
