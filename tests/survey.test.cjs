// node tests/survey.test.cjs <path-to-typescript-module>
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(process.argv[2] || 'typescript');

function harness({ initial = {}, wx = false, failRead = false, failWrite = false } = {}) {
    const data = new Map(Object.entries(initial));
    const reads = [];
    const warnings = [];
    const control = { failWrite };
    const storage = {
        getItem(key) { reads.push(key); if (failRead) throw Error('read'); return data.get(key) ?? null; },
        setItem(key, value) { if (control.failWrite) throw Error('write'); data.set(key, value); },
    };
    class Component {}
    class UITransform {
        setContentSize(width, height) { this.width = width; this.height = height; }
        setAnchorPoint() {}
    }
    class Graphics {
        clear() {} rect() {} roundRect() {} fill() {} stroke() {} moveTo() {} lineTo() {}
    }
    class Label {}
    Label.HorizontalAlign = { LEFT: 0, CENTER: 1 };
    Label.VerticalAlign = { TOP: 0, CENTER: 1 };
    Label.Overflow = { SHRINK: 0, CLAMP: 1 };
    class EditBox {}
    EditBox.InputMode = { ANY: 0 };
    EditBox.InputFlag = { DEFAULT: 0 };
    EditBox.KeyboardReturnType = { DONE: 0 };
    EditBox.EventType = { TEXT_CHANGED: 'text-changed' };
    class Node {
        static EventType = { TOUCH_END: 'touch-end' };
        constructor(name) { this.name = name; this.children = []; this.components = new Map(); this.events = new Map(); this.active = true; }
        addChild(node) { this.children.push(node); node.parent = this; }
        addComponent(Type) { const c = new Type(); c.node = this; this.components.set(Type, c); return c; }
        getComponent(Type) { return this.components.get(Type) ?? null; }
        getChildByName(name) { return this.children.find(n => n.name === name); }
        setPosition(x, y) { this.position = { x, y }; }
        setScale(x, y) { this.scale = { x, y }; }
        setSiblingIndex() {}
        removeAllChildren() { this.children = []; }
        destroy() { this.destroyed = true; }
        on(event, fn, target) { this.events.set(event, (...args) => fn.apply(target, args)); }
        emit(event, ...args) { this.events.get(event)?.(...args); }
    }
    const cc = {
        Component, Node, UITransform, Graphics, Label, EditBox,
        BlockInputEvents: class {}, Color: class { constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); } },
        Rect: class {}, Layers: { Enum: { UI_2D: 1 } },
        _decorator: { ccclass: () => cls => cls },
        view: { getVisibleSize: () => ({ width: 1280, height: 720 }) },
        sys: { localStorage: wx ? { getItem() { throw Error('Web fallback used'); }, setItem() { throw Error('Web fallback used'); } } : storage },
    };
    const modules = {};
    function load(name) {
        const source = fs.readFileSync(path.join(__dirname, '../assets/scripts/start', name + '.ts'), 'utf8');
        const code = ts.transpileModule(source, { compilerOptions: {
            target: ts.ScriptTarget.ES2015, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
        } }).outputText;
        const exports = {};
        vm.runInNewContext(code, {
            exports, require: name => name === 'cc' ? cc : modules[name],
            console: { warn: (...args) => warnings.push(args) },
            ...(wx ? { wx: { getStorageSync: storage.getItem, setStorageSync: storage.setItem } } : {}),
        });
        modules['./' + name] = exports;
        return exports;
    }
    const store = load('SurveyResponseStore');
    const { SurveyQuestionnaire } = load('SurveyQuestionnaire');
    return { ...store, SurveyQuestionnaire, cc, data, reads, control, warnings };
}

const valid = {
    priorKnowledge: 2, deepestImpression: 'knowledge-cards', improvementPriorities: ['history-depth'],
    postKnowledge: 4, furtherLearningInterest: 5, overallSatisfaction: 4,
};
let checks = 0;
function test(name, run) { run(); checks++; console.log('PASS ' + name); }

test('seven-question validation, optional suggestions and unknown-field removal', () => {
    const h = harness();
    const result = h.SurveyResponseStore.validate({ ...valid, ageGroup: '18-25', experiencedModules: ['settings'] });
    assert.equal(result.valid, true);
    assert.equal(result.answers.ageGroup, undefined);
    assert.equal(result.answers.experiencedModules, undefined);
    for (const field of Object.keys(valid)) {
        const answers = { ...valid }; delete answers[field];
        assert.equal(h.SurveyResponseStore.validate(answers).valid, false, field);
    }
    for (const field of ['priorKnowledge', 'postKnowledge', 'furtherLearningInterest', 'overallSatisfaction']) {
        for (const value of [0, 6, 'na', '3']) assert.equal(h.SurveyResponseStore.validate({ ...valid, [field]: value }).valid, false);
    }
});

test('two-selection limit, exclusive none, and other text validation', () => {
    const store = harness().SurveyResponseStore;
    for (const priorities of [[], ['none', 'history-depth'], ['history-depth', 'map-expansion', 'performance'], ['bogus']]) {
        assert.equal(store.validate({ ...valid, improvementPriorities: priorities }).valid, false);
    }
    assert.equal(store.validate({ ...valid, improvementPriorities: ['none'] }).valid, true);
    assert.equal(store.validate({ ...valid, improvementPriorities: ['other'] }).valid, false);
    assert.equal(store.validate({ ...valid, improvementPriorities: ['other'], improvementOther: '扩展地图' }).valid, true);
    assert.equal(store.validate({ ...valid, suggestions: '字'.repeat(301) }).valid, false);
});

test('legacy data preserved; current submissions persist and deduplicate', () => {
    const legacy = '{"version":1,"submissions":[{"legacy":true}]}';
    const h = harness({ initial: { 'ming-zhongdu.survey.v1': legacy, 'ming-zhongdu.settings.v2': 'settings' } });
    const draft = h.SurveyResponseStore.startDraft().draft;
    assert.equal(h.SurveyResponseStore.submit(valid, draft.sessionId).ok, true);
    assert.equal(h.SurveyResponseStore.submit(valid, draft.sessionId).duplicate, true);
    assert.equal(JSON.parse(h.data.get(h.SURVEY_STORAGE_KEY)).submissions.length, 1);
    assert.equal(h.data.get('ming-zhongdu.survey.v1'), legacy);
    assert.equal(h.data.get('ming-zhongdu.settings.v2'), 'settings');
    const reloaded = harness({ initial: Object.fromEntries(h.data) });
    assert.equal(reloaded.SurveyResponseStore.startDraft().reason, 'already-submitted');
    const next = reloaded.SurveyResponseStore.startNextRespondent().draft;
    assert.notEqual(next.sessionId, draft.sessionId);
    assert.equal(reloaded.SurveyResponseStore.submit(valid, next.sessionId).ok, true);
    assert.equal(JSON.parse(reloaded.data.get(h.SURVEY_STORAGE_KEY)).submissions.length, 2);
    assert.deepEqual(h.reads, [h.SURVEY_STORAGE_KEY]);
});

test('storage failures retain draft without reporting submission success', () => {
    const h = harness({ failRead: true, failWrite: true });
    const draft = h.SurveyResponseStore.startDraft().draft;
    assert.equal(h.SurveyResponseStore.submit(valid, draft.sessionId).reason, 'storage-failed');
    assert.equal(h.SurveyResponseStore.loadDraft().answers.postKnowledge, 4);
    h.control.failWrite = false;
    assert.equal(h.SurveyResponseStore.submit(undefined, draft.sessionId).ok, true);
    assert.ok(h.warnings.length);
    assert.ok(harness({ initial: { 'ming-zhongdu.survey.v2': '{bad' } }).SurveyResponseStore.startDraft().draft);
});

test('WeChat synchronous storage is preferred', () => {
    const h = harness({ wx: true });
    const draft = h.SurveyResponseStore.startDraft().draft;
    assert.equal(h.SurveyResponseStore.submit(valid, draft.sessionId).ok, true);
    assert.ok(h.data.has(h.SURVEY_STORAGE_KEY));
});

test('question navigation, selection limits, resume, submission and next respondent', () => {
    const h = harness();
    const ui = new h.SurveyQuestionnaire();
    ui.initialize(new h.cc.Node('Host')); ui.open();
    const session = ui.sessionId;
    const choose = text => {
        const node = ui.content.children.find(n => n.children.some(c => c.getComponent(h.cc.Label)?.string === text));
        assert.ok(node, text); node.emit(h.cc.Node.EventType.TOUCH_END, {});
    };
    ui.goNext(); assert.equal(ui.pageIndex, 0); assert.ok(ui.errorLabel.string);
    choose('2\n不太了解'); ui.goNext();
    choose('历史知识卡'); ui.goNext();
    choose('知识内容更加丰富'); choose('操作手感更加顺畅'); choose('地图和地点进一步拓展');
    assert.equal(ui.answers.improvementPriorities.length, 2);
    assert.equal(ui.errorLabel.string, '最多选择两项。');
    choose('暂无明显需要改进的地方'); assert.equal(ui.answers.improvementPriorities.length, 1);
    choose('其他'); ui.goNext(); assert.equal(ui.pageIndex, 2);
    const edit = ui.content.getChildByName('SurveyImprovementOther').getComponent(h.cc.EditBox);
    edit.string = '补充地图'; edit.node.emit(h.cc.EditBox.EventType.TEXT_CHANGED, edit);
    ui.goNext(); assert.equal(ui.pageIndex, 3);
    choose('4\n比较了解'); ui.goNext();
    choose('5\n完全同意'); ui.goNext();
    choose('4\n比较满意'); ui.goNext();
    assert.equal(ui.pageIndex, 6);
    ui.close(); ui.open(); assert.equal(ui.answers.postKnowledge, 4); assert.equal(ui.sessionId, session);
    for (let i = 0; i < 7; i++) ui.goNext();
    assert.equal(ui.completion, 'submitted');
    ui.goNext(); assert.equal(JSON.parse(h.data.get(h.SURVEY_STORAGE_KEY)).submissions.length, 1);
    ui.close(); ui.open(); assert.equal(Object.keys(ui.answers).filter(k => ui.answers[k] !== undefined).length, 0);
    assert.notEqual(ui.sessionId, session);
});

test('landscape layouts keep choices and other input inside the card content', () => {
    const h = harness(); const ui = new h.SurveyQuestionnaire();
    ui.initialize(new h.cc.Node('Host')); ui.open();
    for (const [width, height] of [[1280, 720], [2340, 1080], [800, 450], [640, 360]]) {
        ui.pageIndex = 2; ui.answers.improvementPriorities = ['other']; ui.layout(width, height);
        for (const child of ui.content.children) {
            const t = child.getComponent(h.cc.UITransform);
            assert.ok(Math.abs(child.position.y) + t.height / 2 <= ui.contentHeight / 2 + 0.01, `${width}x${height} ${child.name}`);
        }
        assert.ok(ui.cardWidth * ui.card.scale.x <= width);
        assert.ok(ui.cardHeight * ui.card.scale.y <= height);
    }
});
console.log(`${checks} survey checks passed.`);
