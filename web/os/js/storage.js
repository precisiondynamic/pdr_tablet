// Per-app key/value storage behind the SDK's `tablet.storage`.
//
// Each app gets its own namespace, capped at QUOTA bytes of JSON. The OS keeps a copy in
// the page's localStorage and reports every change to the integration (`app:storage`) so
// it can be persisted per character (KVP / database) and seeded back with `apps:storage`.

import { Bridge } from './bridge.js';
import { log } from './log.js';

const PREFIX = 'pdr_tablet:app:';
export const STORAGE_QUOTA = 512 * 1024;
const MAX_KEY = 128;

const stores = new Map();   // appId → plain object

function load(id) {
    if (!stores.has(id)) {
        let data = {};
        try { data = JSON.parse(localStorage.getItem(PREFIX + id) || '{}'); } catch { /* corrupt → empty */ }
        stores.set(id, data && typeof data === 'object' && !Array.isArray(data) ? data : {});
    }
    return stores.get(id);
}

function persist(id) {
    try { localStorage.setItem(PREFIX + id, JSON.stringify(stores.get(id))); } catch { /* storage unavailable */ }
}

function checkKey(key) {
    if (typeof key !== 'string' || !key || key.length > MAX_KEY) throw new Error(`key must be a string of 1–${MAX_KEY} characters`);
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
        stores.set(id, JSON.parse(JSON.stringify(data)));
        persist(id);
        log.debug('storage', `Seeded ${id} (${AppStorage.size(id)} bytes)`);
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
