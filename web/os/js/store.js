import { Bridge } from './bridge.js';
import { Emitter, clamp } from './util.js';

export const VERSION = '1.0.0';
const STORAGE_KEY = 'pdr_tablet:settings';

export const DEFAULT_SETTINGS = Object.freeze({
    theme: 'dark',            // 'dark' | 'light'
    accent: '#3b82f6',
    wallpaper: 'bloom',       // preset id, or 'custom'
    customWallpaper: '',
    brightness: 100,          // 10–100
    lockEnabled: true,
    lockPreviews: true,       // notification previews on the lock screen
    bootAnimation: true,
    dnd: false,
    clock24h: true,
    statusDate: true,         // show the date in the status bar
    dock: ['system.settings'],
    mutedApps: [],
});

function sanitize(input) {
    const out = {};
    for (const [key, def] of Object.entries(DEFAULT_SETTINGS)) {
        const v = input[key];
        if (Array.isArray(def)) out[key] = Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [...def];
        else out[key] = typeof v === typeof def ? v : def;
    }
    if (!['dark', 'light'].includes(out.theme)) out.theme = DEFAULT_SETTINGS.theme;
    if (!/^#[0-9a-f]{6}$/i.test(out.accent)) out.accent = DEFAULT_SETTINGS.accent;
    out.brightness = clamp(Math.round(out.brightness), 10, 100);
    return out;
}

function loadLocal() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}

const bus = new Emitter();

export const settings = sanitize({ ...DEFAULT_SETTINGS, ...loadLocal() });

export const state = {
    awake: false,
    booted: false,
    locked: true,
    view: 'home',             // 'home' | 'app'
    overlay: null,            // 'panel' | 'switcher' | null
    osName: 'PDR OS',
    version: VERSION,
    deviceName: null,
    maxBackgroundApps: 4,
    status: { battery: null, charging: false, signal: null, network: null },
};

export const on = (event, fn) => bus.on(event, fn);
export const emit = (event, ...args) => bus.emit(event, ...args);

export function setState(patch) {
    Object.assign(state, patch);
    bus.emit('state', Object.keys(patch));
}

/**
 * @param {object} patch
 * @param {{ fromHost?: boolean }} opts  fromHost = don't echo the change back to the integration
 */
export function updateSettings(patch, { fromHost = false } = {}) {
    const next = sanitize({ ...settings, ...patch });
    const changed = Object.keys(next).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(settings[k]));
    if (!changed.length) return;
    Object.assign(settings, next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
    if (!fromHost) Bridge.emit('os:settingsChanged', { settings: { ...settings }, changed });
    bus.emit('settings', changed);
}

export function resetSettings() {
    updateSettings({ ...DEFAULT_SETTINGS, dock: [...DEFAULT_SETTINGS.dock], mutedApps: [] });
}

/** The subset of settings apps receive through the SDK. */
export function publicSettings() {
    return { theme: settings.theme, accent: settings.accent, clock24h: settings.clock24h };
}
