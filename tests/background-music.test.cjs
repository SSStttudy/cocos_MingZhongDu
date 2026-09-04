// node tests/background-music.test.cjs <path-to-typescript-module>
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require(process.argv[2] || 'typescript');

function harness({ enabled = true, editor = false } = {}) {
    let now = 1000;
    class Events {
        listeners = new Map();
        on(event, fn, target) { const list = this.listeners.get(event) || []; list.push([fn, target]); this.listeners.set(event, list); }
        off(event, fn, target) { this.listeners.set(event, (this.listeners.get(event) || []).filter(x => x[0] !== fn || x[1] !== target)); }
        emit(event, ...args) { for (const [fn, target] of [...(this.listeners.get(event) || [])]) fn.apply(target, args); }
    }
    class Component { isValid = true; }
    class AudioSource {
        static EventType = { STARTED: 'started' };
        playing = false; plays = 0; pauses = 0;
        play() { this.plays++; } // Native start resolves asynchronously.
        pause() { this.pauses++; this.playing = false; }
        stop() { this.playing = false; }
        resolvePlay() { this.playing = true; this.node.emit('started'); }
    }
    class Node extends Events {
        components = []; children = [];
        constructor(name) { super(); this.name = name; }
        addChild(n) { this.children.push(n); n.parent = this; }
        addComponent(Type) { const c = new Type(); c.node = this; this.components.push(c); c.onLoad?.(); return c; }
    }
    const game = new Events(), input = new Events(), scene = new Node('Scene');
    const persistent = []; game.addPersistRootNode = n => persistent.push(n);
    const callbacks = [], settingsListeners = new Set();
    const settings = { musicEnabled: enabled, soundEnabled: true, tourHintsEnabled: true };
    const storage = new Map();
    const cc = { Component, Node, AudioSource, AudioClip: class {}, game, input,
        Game: { EVENT_HIDE: 'hide', EVENT_SHOW: 'show' },
        Input: { EventType: { TOUCH_END: 'touch', MOUSE_UP: 'mouse', KEY_DOWN: 'key' } },
        director: { getScene: () => scene }, resources: { load: (...args) => callbacks.push(args.at(-1)) },
        sys: { localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } },
        _decorator: { ccclass: () => cls => cls },
    };
    const transpile = file => ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {compilerOptions: {
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
    }}).outputText;
    const settingsExports = {};
    vm.runInNewContext(transpile('assets/scripts/start/GameSettings.ts'), { exports: settingsExports, require: () => cc, console });
    settingsExports.saveSettings(settings);
    const exports = {};
    vm.runInNewContext(transpile('assets/scripts/audio/BackgroundMusic.ts'), {
        exports, require: name => name === 'cc' ? cc : name === 'cc/env' ? { EDITOR: editor } : settingsExports,
        Date: { now: () => now }, console: { warn() {} },
    });
    const manager = exports.BackgroundMusic;
    function change(values) { settingsExports.saveSettings({ ...settingsExports.loadSettings(), ...values }); }
    function finish(error = null) {
        const clip = { refs: 0, addRef() { this.refs++; return this; }, decRef() { this.refs--; } };
        callbacks.shift()(error, error ? null : clip); return clip;
    }
    return { manager, game, input, persistent, callbacks, change, finish, storage,
        get instance() { return persistent[0]?.components[0]; },
        get audio() { return persistent[0]?.components.find(c => c instanceof AudioSource); },
        tick(ms) { now += ms; }, settingsExports };
}
let checks = 0;
function test(name, fn) { fn(); checks++; console.log('PASS ' + name); }

test('editor never creates or loads audio', () => {
    const h = harness({ editor: true }); h.manager.ensureStarted(); assert.equal(h.persistent.length, 0);
});
test('one persistent player across repeated scene initialization', () => {
    const h = harness(); h.manager.ensureStarted(); h.manager.ensureStarted();
    assert.equal(h.persistent.length, 1); assert.equal(h.callbacks.length, 1);
    h.finish(); assert.equal(h.audio.plays, 0);
    h.input.emit('touch'); h.input.emit('mouse'); assert.equal(h.audio.plays, 1);
    h.audio.resolvePlay(); h.manager.ensureStarted(); h.input.emit('key'); assert.equal(h.audio.plays, 1);
    assert.equal(h.audio.loop, true);
});
test('music disabled during load stays silent; sound switch is independent', () => {
    const h = harness(); h.manager.ensureStarted(); h.input.emit('touch'); h.change({ musicEnabled: false }); h.finish();
    assert.equal(h.audio.plays, 0); assert.equal(h.audio.volume, 0);
    h.change({ musicEnabled: true, soundEnabled: false }); assert.equal(h.audio.plays, 1);
    h.audio.resolvePlay(); h.change({ tourHintsEnabled: false }); assert.equal(h.audio.plays, 1);
    h.change({ musicEnabled: false }); assert.equal(h.audio.playing, false); assert.equal(h.audio.volume, 0);
    const saved = JSON.parse(h.storage.get(h.settingsExports.GAME_SETTINGS_STORAGE_KEY)); assert.equal(saved.musicEnabled, false);
});
test('disabled startup does not download; enabling reuses remembered gesture', () => {
    const h = harness({ enabled: false }); h.manager.ensureStarted(); h.input.emit('touch'); assert.equal(h.callbacks.length, 0);
    h.change({ musicEnabled: true }); h.finish(); assert.equal(h.audio.plays, 1);
});
test('background and late native start cannot defeat mute', () => {
    const h = harness(); h.manager.ensureStarted(); h.finish(); h.input.emit('touch'); h.audio.resolvePlay();
    h.game.emit('hide'); assert.equal(h.audio.volume, 0); assert.equal(h.audio.playing, false);
    h.audio.resolvePlay(); assert.equal(h.audio.playing, false);
    h.change({ musicEnabled: false }); h.game.emit('show'); assert.equal(h.audio.plays, 1);
    h.audio.resolvePlay(); assert.equal(h.audio.volume, 0); assert.equal(h.audio.playing, false);
    h.change({ musicEnabled: true }); assert.equal(h.audio.plays, 2);
});
test('failed download waits for backoff and retries on gesture', () => {
    const h = harness(); h.manager.ensureStarted(); h.finish(Error('offline')); h.input.emit('touch');
    assert.equal(h.callbacks.length, 0); h.tick(10001); h.input.emit('touch'); assert.equal(h.callbacks.length, 1);
    h.finish(); assert.equal(h.audio.plays, 1);
});
test('loading completion after disposal never plays or retains clip', () => {
    const h = harness(); h.manager.ensureStarted(); h.instance.onDestroy(); const clip = h.finish();
    assert.equal(clip.refs, 0); assert.equal(h.audio.plays, 0); h.input.emit('touch'); assert.equal(h.audio.plays, 0);
});
test('destroy releases retained clip and permits a fresh player', () => {
    const h = harness(); h.manager.ensureStarted(); const clip = h.finish(); assert.equal(clip.refs, 1);
    h.instance.onDestroy(); assert.equal(clip.refs, 0); h.manager.ensureStarted(); assert.equal(h.persistent.length, 2);
});
console.log(`${checks} background music checks passed`);
