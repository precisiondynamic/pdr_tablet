import { log } from './log.js';
import { Bridge } from './bridge.js';
import { state, setState, settings, settingsSource, updateSettings, VERSION } from './store.js';
import { Apps } from './apps.js';
import { Calendar } from './calendar.js';
import { Home } from './home.js';
import { Menu } from './menu.js';
import { Notifications } from './notifications.js';
import { Overview } from './overview.js';
import { QuickSettings } from './quick.js';
import { SettingsApp } from './settings.js';
import { Shell } from './shell.js';
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
start('shell', () => QuickSettings.init());
start('shell', () => Calendar.init());
start('shell', () => Overview.init());
start('home', () => Home.init());

/* ---------- inbound actions (see docs/PROTOCOL.md) ---------- */

Bridge.on('os:init', (msg) => {
    const parts = [];
    if (msg.osName) { Shell.setOsName(msg.osName); parts.push(`name=${state.osName}`); }
    if (msg.deviceName !== undefined) {
        setState({ deviceName: msg.deviceName ? String(msg.deviceName).slice(0, 40) : null });
        parts.push(`device=${state.deviceName}`);
    }
    if (Number.isFinite(msg.maxBackgroundApps)) {
        setState({ maxBackgroundApps: clamp(msg.maxBackgroundApps, 0, 20) });
        parts.push(`maxBackgroundApps=${state.maxBackgroundApps}`);
    }
    if (msg.settings && typeof msg.settings === 'object') { updateSettings(msg.settings, { fromHost: true }); parts.push('settings'); }
    if (msg.status && typeof msg.status === 'object') { Shell.setStatus(msg.status); parts.push('status'); }
    if (Array.isArray(msg.apps)) { Apps.setAll(msg.apps); parts.push(`${msg.apps.length} apps`); }
    log.ok('bridge', `Host initialised (${parts.join(', ') || 'defaults'}).`);
});

Bridge.on('os:wake', () => Shell.wake());
Bridge.on('os:sleep', () => Shell.sleep());
Bridge.on('os:lock', () => Shell.lock());
Bridge.on('os:unlock', () => Shell.unlock());
Bridge.on('os:settings', (msg) => updateSettings(msg.settings ?? {}, { fromHost: true }));
Bridge.on('os:status', (msg) => Shell.setStatus(msg));

Bridge.on('apps:set', (msg) => Apps.setAll(msg.apps));
Bridge.on('apps:register', (msg) => Apps.register(msg.app));
Bridge.on('apps:update', (msg) => Apps.update(msg.id, msg.patch));
Bridge.on('apps:unregister', (msg) => Apps.unregister(msg.id));
Bridge.on('apps:launch', (msg) => { Shell.closeOverlays(); Apps.launch(msg.id, msg.data); });
Bridge.on('apps:close', (msg) => Apps.close(msg.id));
Bridge.on('apps:home', () => { Shell.closeOverlays(); Apps.home(); });
Bridge.on('apps:message', (msg) => Apps.message(msg.id, msg.event, msg.data));
Bridge.on('apps:badge', (msg) => Apps.setBadge(msg.id, msg.count));

Bridge.on('notify', (msg) => Notifications.push(msg));

Bridge.on('input:key', (msg) => Apps.routeKey(msg));
Bridge.on('input:text', (msg) => Apps.routeText(String(msg.text ?? '')));

log.ok('bridge', `Listening for host messages (${Bridge.mode}).`);
Bridge.emit('os:ready', { version: VERSION });

// Opened directly in a browser (no integration, no harness): wake up so there's something to see.
if (Bridge.standalone) Shell.wake();
