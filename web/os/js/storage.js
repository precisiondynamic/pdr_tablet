// Per-app key/value storage behind the SDK's `tablet.storage`.
//
// Each app gets its own namespace, capped at QUOTA bytes of JSON. The OS keeps a copy in
// the page's localStorage and reports every change to the integration (`app:storage`) so
// it can be persisted per character (KVP / database) and seeded back with `apps:storage`.

import { Bridge } from './bridge.js';
import { log } from './log.js';
import { state } from './store.js';

const PREFIX = 'pdr_tablet:app:';
export const STORAGE_QUOTA = 512 * 1024;
const MAX_KEY = 128;

const stores = new Map();   // appId → plain object

let persistWarned = false;

function load(id) {
    if (!stores.has(id)) {
        let data = {};
        if (state.storageMode === 'local') {
            let raw = null;
            try { raw = localStorage.getItem(PREFIX + id); } catch { /* storage unavailable */ }
            if (raw) {
                try { data = JSON.parse(raw); } catch { data = null; }
                if (!data || typeof data !== 'object' || Array.isArray(data)) {
                    log.warn('storage', `Stored data for ${id} was corrupt and has been reset`);
                    data = {};
                    try { localStorage.removeItem(PREFIX + id); } catch { /* ignore */ }
                }
            }
        }
        stores.set(id, data);
    }
    return stores.get(id);
}

function persist(id) {
    if (state.storageMode !== 'local') return;
    try {
        localStorage.setItem(PREFIX + id, JSON.stringify(stores.get(id)));
    } catch (err) {
        // the page's own quota (~5 MB for all apps) — the integration's copy is still intact
        if (!persistWarned) { persistWarned = true; log.warn('storage', `Local cache full or unavailable (${err.name}); relying on the integration`); }
    }
}

function localKeys() {
    const out = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(PREFIX)) out.push(k); } } catch { /* ignore */ }
    return out;
}

function checkKey(key) {
    if (typeof key !== 'string' || !key || key.length > MAX_KEY) throw new Error(`key must be a string of 1–${MAX_KEY} characters`);
    if (key === '__proto__') throw new Error('key "__proto__" is reserved');
}

export const AppStorage = {
    /** Handles one SDK storage operation. Throws with a readable message on bad input. */
    op(id, op, key, value) {
        const store = load(id);
        switch (op) {
            case 'get':
                checkKey(key);
                return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
            case 'keys':
                return Object.keys(store);
            case 'set': {
                checkKey(key);
                if (value === undefined) throw new Error('value is required (use remove to delete)');
                let json;
                try { json = JSON.stringify(value); } catch { throw new Error('value must be JSON-serialisable'); }
                const next = { ...store, [key]: JSON.parse(json) };
                const size = JSON.stringify(next).length;
                if (size > STORAGE_QUOTA) throw new Error(`storage quota exceeded (${Math.round(size / 1024)} KB of ${STORAGE_QUOTA / 1024} KB)`);
                stores.set(id, next);
                persist(id);
                Bridge.emit('app:storage', { id, key, value: next[key] });
                return true;
            }
            case 'remove':
                checkKey(key);
                if (!Object.prototype.hasOwnProperty.call(store, key)) return false;
                delete store[key];
                persist(id);
                Bridge.emit('app:storage', { id, key, value: null });
                return true;
            case 'clear':
                AppStorage.wipe(id);
                return true;
            default:
                throw new Error(`unknown storage operation "${op}"`);
        }
    },

    /** Replace an app's data with what the integration saved (no echo back). */
    seed(id, data) {
        if (!id || !data || typeof data !== 'object' || Array.isArray(data)) return;
        let copy;
        try { copy = JSON.parse(JSON.stringify(data)); } catch { log.warn('storage', `Seed for ${id} is not JSON; ignored`); return; }
        if (JSON.stringify(copy).length > STORAGE_QUOTA) log.warn('storage', `Seed for ${id} is over quota; writes will fail until it shrinks`);
        stores.set(id, copy);
        persist(id);
        log.debug('storage', `Seeded ${id} (${AppStorage.size(id)} bytes)`);
    },

    /** Forget every app's data (memory and local cache), e.g. when the character changes. */
    wipeAll() {
        stores.clear();
        localKeys().forEach((k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } });
    },

    /** Switch between caching app data locally and keeping it in memory only. */
    setMode(mode) {
        state.storageMode = mode === 'host' ? 'host' : 'local';
        if (state.storageMode === 'host') localKeys().forEach((k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } });
    },

    wipe(id) {
        stores.set(id, {});
        try { localStorage.removeItem(PREFIX + id); } catch { /* ignore */ }
        Bridge.emit('app:storage', { id, key: null, value: null, cleared: true });
        log.info('storage', `Cleared data for ${id}`);
    },

    size(id) {
        return JSON.stringify(load(id)).length;
    },
};
