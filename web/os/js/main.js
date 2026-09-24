import { log } from './log.js';
import { Bridge } from './bridge.js';
import { state, setState, settings, settingsSource, updateSettings, replaceSettings, setStorageMode, VERSION } from './store.js';
import { Apps } from './apps.js';
import { Bundled } from './bundled.js';
import { Calendar } from './calendar.js';
import { Home } from './home.js';
import { Menu } from './menu.js';
import { Notifications } from './notifications.js';
import { Overview } from './overview.js';
import { ControlCenter } from './control.js';
import { Dialog } from './dialog.js';
import { SettingsApp } from './settings.js';
import { Shell } from './shell.js';
import { AppStorage } from './storage.js';
import { Watchdog } from './watchdog.js';
import { clamp } from './util.js';

/* ---------- early boot: these lines are what the verbose boot screen prints ---------- */

log.info('kernel', `${state.osName} ${VERSION} (pdr_tablet)`);
log.info('kernel', `Command line: resource=${Bridge.resource} transport=${Bridge.mode}`);
log.info('kernel', `Display: ${innerWidth}x${innerHeight} @${devicePixelRatio}x, ${navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0] ?? 'unknown engine'}`);
log.info('settings', `Loaded from ${settingsSource}: theme=${settings.theme} accent=${settings.accent} wallpaper=${settings.wallpaper}`);

log.setForwarder((entry) => Bridge.emit('os:log', {
    level: entry.level, unit: entry.unit, message: entry.message, uptime: entry.uptime,
}));
log.ok('journal', 'Started Journal Service.');

// If one subsystem fails the rest still comes up, and the failure lands in the journal.
function start(name, fn) {
    try {
        fn();
    } catch (err) {
        log.error(name, `Failed to start: ${err.message}`);
    }
}

start('shell', () => Shell.init());
start('menu', () => Menu.init());
start('notify', () => { Notifications.init(); log.ok('notify', 'Started Notification Service.'); });
start('apps', () => { Apps.init(); log.ok('apps', 'Started App Host.'); });
start('apps', () => Apps.register(SettingsApp, { system: true }));
start('shell', () => ControlCenter.init());
start('shell', () => Dialog.init());
start('shell', () => Calendar.init());
start('shell', () => Overview.init());
start('home', () => Home.init());
start('watchdog', () => { Watchdog.init(); log.ok('watchdog', 'Started App Watchdog.'); });
Bundled.load();

/* ---------- inbound actions (see docs/PROTOCOL.md) ---------- */
// Everything here is input from the integration: types are checked, never assumed.

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64;
const bad = (action, why) => log.warn('bridge', `${action} ignored: ${why}`);

function applyRuntimeOptions(msg, parts) {
    if (Number.isFinite(msg.maxBackgroundApps)) {
        setState({ maxBackgroundApps: clamp(Math.round(msg.maxBackgroundApps), 0, 20) });
        parts.push(`maxBackgroundApps=${state.maxBackgroundApps}`);
    }
    if (Number.isFinite(msg.requestTimeout)) {
        setState({ requestTimeout: clamp(Math.round(msg.requestTimeout), 1000, 120000) });
        parts.push(`requestTimeout=${state.requestTimeout}`);
    }
    if (isObj(msg.heartbeat)) {
        if (Number.isFinite(msg.heartbeat.interval)) setState({ heartbeatInterval: clamp(msg.heartbeat.interval, 250, 60000) });
        if (Number.isFinite(msg.heartbeat.timeout)) setState({ heartbeatTimeout: clamp(msg.heartbeat.timeout, 1000, 300000) });
        Watchdog.reschedule();
        parts.push(`heartbeat=${state.heartbeatInterval}/${state.heartbeatTimeout}`);
    }
    if (msg.storageMode === 'host' || msg.storageMode === 'local') {
        AppStorage.setMode(msg.storageMode);
        setStorageMode(msg.storageMode);
        parts.push(`storageMode=${msg.storageMode}`);
    }
}

Bridge.on('os:init', (msg) => {
    const parts = [];
    applyRuntimeOptions(msg, parts);   // first: storageMode decides whether the rest is cached locally
    if (typeof msg.osName === 'string' && msg.osName.trim()) { Shell.setOsName(msg.osName); parts.push(`name=${state.osName}`); }
    if (msg.deviceName !== undefined) {
        setState({ deviceName: typeof msg.deviceName === 'string' && msg.deviceName ? msg.deviceName.slice(0, 40) : null });
        parts.push(`device=${state.deviceName}`);
    }
    if (isObj(msg.settings)) { updateSettings(msg.settings, { fromHost: true }); parts.push('settings'); }
    if (isObj(msg.appStorage)) {
        for (const [id, data] of Object.entries(msg.appStorage)) if (isId(id)) AppStorage.seed(id, data);
        parts.push('app storage');
    }
    if (typeof msg.bundledApps === 'boolean' || typeof msg.devApps === 'boolean') {
        Bundled.configure({ bundledApps: msg.bundledApps, devApps: msg.devApps });
        parts.push(`bundledApps=${msg.bundledApps !== false} devApps=${!!msg.devApps}`);
    }
    if (isObj(msg.status)) { Shell.setStatus(msg.status); parts.push('status'); }
    if (Array.isArray(msg.apps)) { Apps.setAll(msg.apps); parts.push(`${msg.apps.length} apps`); }
    log.ok('bridge', `Host initialised (${parts.join(', ') || 'defaults'}).`);
});

/**
 * Character switch / logout: nothing from the previous session may survive — running apps,
 * notifications, badges, app data, settings and the local caches are all dropped, then the
 * new session's data is applied and the tablet is locked.
 */
Bridge.on('os:session', (msg) => {
    Shell.closeOverlays();
    Apps.resetRuntime();
    Notifications.clear();
    AppStorage.wipeAll();
    const parts = [];
    applyRuntimeOptions(msg, parts);
    replaceSettings(isObj(msg.settings) ? msg.settings : {});
    if (isObj(msg.appStorage)) for (const [id, data] of Object.entries(msg.appStorage)) if (isId(id)) AppStorage.seed(id, data);
    setState({ deviceName: typeof msg.deviceName === 'string' && msg.deviceName ? msg.deviceName.slice(0, 40) : null });
    if (state.awake) Shell.lock(); else setState({ locked: true });
    log.ok('session', `New session started${state.deviceName ? ` (${state.deviceName})` : ''}.`);
    Bridge.emit('os:sessionReady', {});
});

Bridge.on('os:wake', () => Shell.wake());
Bridge.on('os:sleep', () => Shell.sleep());
Bridge.on('os:lock', () => Shell.lock());
Bridge.on('os:unlock', () => Shell.unlock());
Bridge.on('os:settings', (msg) => (isObj(msg.settings) ? updateSettings(msg.settings, { fromHost: true }) : bad('os:settings', 'settings must be an object')));
Bridge.on('os:status', (msg) => Shell.setStatus(msg));

Bridge.on('apps:set', (msg) => (Array.isArray(msg.apps) ? Apps.setAll(msg.apps) : bad('apps:set', 'apps must be an array')));
Bridge.on('apps:register', (msg) => {
    try { Apps.register(msg.app); } catch (err) { log.error('apps', `Register rejected: ${err.message}`); }
});
Bridge.on('apps:update', (msg) => (isId(msg.id) && isObj(msg.patch) ? Apps.update(msg.id, msg.patch) : bad('apps:update', 'needs id and patch object')));
Bridge.on('apps:unregister', (msg) => (isId(msg.id) ? Apps.unregister(msg.id) : bad('apps:unregister', 'needs an id')));
Bridge.on('apps:launch', (msg) => {
    if (!isId(msg.id)) return bad('apps:launch', 'needs an id');
    Shell.closeOverlays();
    Apps.launch(msg.id, msg.data);
});
Bridge.on('apps:close', (msg) => (isId(msg.id) ? Apps.close(msg.id) : bad('apps:close', 'needs an id')));
Bridge.on('apps:home', () => { Shell.closeOverlays(); Apps.home(); });
Bridge.on('apps:message', (msg) => {
    if (!isId(msg.id) || typeof msg.event !== 'string' || !msg.event) return bad('apps:message', 'needs id and event');
    Apps.message(msg.id, msg.event.slice(0, 128), msg.data);
});
Bridge.on('apps:badge', (msg) => (isId(msg.id) ? Apps.setBadge(msg.id, msg.count) : bad('apps:badge', 'needs an id')));
Bridge.on('apps:storage', (msg) => (isId(msg.id) && isObj(msg.data) ? AppStorage.seed(msg.id, msg.data) : bad('apps:storage', 'needs id and data object')));

Bridge.on('notify', (msg) => Notifications.push(msg));

Bridge.on('input:key', (msg) => (typeof msg.key === 'string' && msg.key.length <= 32 ? Apps.routeKey(msg) : undefined));
Bridge.on('input:text', (msg) => (typeof msg.text === 'string' ? Apps.routeText(msg.text.slice(0, 10000)) : undefined));

log.ok('bridge', `Listening for host messages (${Bridge.mode}).`);
Bridge.emit('os:ready', { version: VERSION });

// Test/debug handle, only outside FiveM (browser harness / standalone).
if (Bridge.mode !== 'cfx') window.__pdr = { log, state, settings, Apps, Notifications, AppStorage };

// Opened directly in a browser (no integration, no harness): wake up so there's something to see.
if (Bridge.standalone) Shell.wake();
