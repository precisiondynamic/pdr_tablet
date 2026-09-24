import { Bridge } from './bridge.js';
import { log } from './log.js';
import { Emitter, clamp } from './util.js';

export const VERSION = '1.2.0';
const STORAGE_KEY = 'pdr_tablet:settings';

// GNOME accent colours
export const ACCENTS = [
    { id: 'blue', color: '#3584e4' },
    { id: 'teal', color: '#2190a4' },
    { id: 'green', color: '#3a944a' },
    { id: 'yellow', color: '#c88800' },
    { id: 'orange', color: '#ed5b00' },
    { id: 'red', color: '#e62d42' },
    { id: 'pink', color: '#d56199' },
    { id: 'purple', color: '#9141ac' },
    { id: 'slate', color: '#6f8396' },
];

const BOOT_STYLES = ['verbose', 'splash', 'off'];
export const UI_SCALES = { small: 0.9, default: 1, large: 1.1 };

export const DEFAULT_SETTINGS = Object.freeze({
    theme: 'dark',            // 'dark' | 'light'
    accent: '#3584e4',
    wallpaper: 'adwaita',     // preset id, or 'custom'
    customWallpaper: '',
    brightness: 100,          // 10–100
    nightLight: false,        // warm colour filter
    nightLightStrength: 50,   // 10–100
    uiScale: 'default',       // 'small' | 'default' | 'large'
    lockEnabled: true,
    lockPreviews: true,       // notification previews on the lock screen
    bootStyle: 'verbose',     // 'verbose' (boot log) | 'splash' | 'off'
    dnd: false,
    clock24h: true,
    statusDate: true,         // show the date in the top bar
    weekStart: 'monday',      // 'monday' | 'sunday'
    dock: ['system.settings'],
    mutedApps: [],
});

function sanitize(input) {
    // v1.0 stored a boolean; map it onto the new setting
    if (typeof input.bootAnimation === 'boolean' && typeof input.bootStyle !== 'string') {
        input = { ...input, bootStyle: input.bootAnimation ? 'verbose' : 'off' };
    }
    const out = {};
    for (const [key, def] of Object.entries(DEFAULT_SETTINGS)) {
        const v = input[key];
        if (Array.isArray(def)) out[key] = Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string'))] : [...def];
        else out[key] = typeof v === typeof def ? v : def;
    }
    if (!['dark', 'light'].includes(out.theme)) out.theme = DEFAULT_SETTINGS.theme;
    if (!/^#[0-9a-f]{6}$/i.test(out.accent)) out.accent = DEFAULT_SETTINGS.accent;
    if (!BOOT_STYLES.includes(out.bootStyle)) out.bootStyle = DEFAULT_SETTINGS.bootStyle;
    if (!Object.prototype.hasOwnProperty.call(UI_SCALES, out.uiScale)) out.uiScale = DEFAULT_SETTINGS.uiScale;
    if (!['monday', 'sunday'].includes(out.weekStart)) out.weekStart = DEFAULT_SETTINGS.weekStart;
    out.brightness = clamp(Math.round(out.brightness) || 100, 10, 100);
    out.nightLightStrength = clamp(Math.round(out.nightLightStrength) || 50, 10, 100);
    return out;
}

function loadLocal() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? { data: JSON.parse(raw), source: 'local storage' } : { data: {}, source: 'defaults' };
    } catch {
        return { data: {}, source: 'defaults (storage unavailable)' };
    }
}

/** Settings driven by sliders: UIs skip full re-renders for these so a drag isn't interrupted. */
export const SLIDER_KEYS = ['brightness', 'nightLightStrength'];

const bus = new Emitter();
const initial = loadLocal();

export const settings = sanitize({ ...DEFAULT_SETTINGS, ...initial.data });
export const settingsSource = initial.source;

export const state = {
    awake: false,
    booted: false,
    booting: false,
    locked: true,
    view: 'home',             // 'home' | 'app'
    overlay: null,            // 'overview' | 'calendar' | 'control' | null
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
    // sliders fire on every tick; keep them out of the journal
    if (!(changed.length === 1 && SLIDER_KEYS.includes(changed[0]))) {
        log.debug('settings', `${fromHost ? 'Applied from host' : 'Changed'}: ${changed.join(', ')}`);
    }
    bus.emit('settings', changed);
}

export function resetSettings() {
    updateSettings({ ...DEFAULT_SETTINGS, dock: [...DEFAULT_SETTINGS.dock], mutedApps: [] });
    log.info('settings', 'Reset to defaults');
}

/** The subset of settings apps receive through the SDK. */
export function publicSettings() {
    return { theme: settings.theme, accent: settings.accent, clock24h: settings.clock24h };
}
