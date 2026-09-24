import { Apps } from './apps.js';
import { Bridge } from './bridge.js';
import { Home } from './home.js';
import { Menu } from './menu.js';
import { Notifications } from './notifications.js';
import { Panel } from './panel.js';
import { SettingsApp } from './settings.js';
import { Shell } from './shell.js';
import { Switcher } from './switcher.js';
import { state, setState, updateSettings, VERSION } from './store.js';
import { clamp } from './util.js';

Shell.init();
Menu.init();
Notifications.init();
Panel.init();
Switcher.init();
Apps.init();
Apps.register(SettingsApp, { system: true });
Home.init();

/* ---------- inbound actions (see docs/PROTOCOL.md) ---------- */

const guard = (fn) => (msg) => {
    try { fn(msg); } catch (err) { console.error(`[pdr_tablet] ${msg.action}:`, err.message); }
};

Bridge.on('os:init', guard((msg) => {
    if (msg.osName) Shell.setOsName(msg.osName);
    if (msg.deviceName !== undefined) setState({ deviceName: msg.deviceName ? String(msg.deviceName).slice(0, 40) : null });
    if (Number.isFinite(msg.maxBackgroundApps)) setState({ maxBackgroundApps: clamp(msg.maxBackgroundApps, 0, 20) });
    if (msg.settings && typeof msg.settings === 'object') updateSettings(msg.settings, { fromHost: true });
    if (msg.status && typeof msg.status === 'object') Shell.setStatus(msg.status);
    if (Array.isArray(msg.apps)) Apps.setAll(msg.apps);
}));

Bridge.on('os:wake', guard(() => Shell.wake()));
Bridge.on('os:sleep', guard(() => Shell.sleep()));
Bridge.on('os:lock', guard(() => Shell.lock()));
Bridge.on('os:unlock', guard(() => { if (state.awake) Shell.unlock(); }));
Bridge.on('os:settings', guard((msg) => updateSettings(msg.settings ?? {}, { fromHost: true })));
Bridge.on('os:status', guard((msg) => Shell.setStatus(msg)));

Bridge.on('apps:set', guard((msg) => Apps.setAll(msg.apps)));
Bridge.on('apps:register', guard((msg) => Apps.register(msg.app)));
Bridge.on('apps:update', guard((msg) => Apps.update(msg.id, msg.patch)));
Bridge.on('apps:unregister', guard((msg) => Apps.unregister(msg.id)));
Bridge.on('apps:launch', guard((msg) => { Shell.closeOverlays(); Apps.launch(msg.id, msg.data); }));
Bridge.on('apps:close', guard((msg) => Apps.close(msg.id)));
Bridge.on('apps:home', guard(() => { Shell.closeOverlays(); Apps.home(); }));
Bridge.on('apps:message', guard((msg) => Apps.message(msg.id, msg.event, msg.data)));
Bridge.on('apps:badge', guard((msg) => Apps.setBadge(msg.id, msg.count)));

Bridge.on('notify', guard((msg) => Notifications.push(msg)));

Bridge.on('input:key', guard((msg) => Apps.routeKey(msg)));
Bridge.on('input:text', guard((msg) => Apps.routeText(String(msg.text ?? ''))));

Bridge.emit('os:ready', { version: VERSION });

// Opened directly in a browser (no integration, no harness): wake up so there's something to see.
if (Bridge.standalone) Shell.wake();
