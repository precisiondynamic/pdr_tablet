// Bundled reference apps (web/apps/manifest.json).
//
// They ship with the tablet so it is usable on its own, and they only use the public SDK, so
// each one is also a working example for resource authors. The integration can switch them
// off (`os:init { bundledApps: false }`). Entries marked `dev` (the SDK Demo) only appear in
// the browser harness or when the integration sends `devApps: true`.

import { Apps } from './apps.js';
import { Bridge } from './bridge.js';
import { log } from './log.js';

const MANIFEST = '../apps/manifest.json';

let manifest = [];          // resolved descriptors
let enabled = true;
let devApps = Bridge.mode !== 'cfx';

function sync() {
    for (const entry of manifest) {
        const want = enabled && (!entry.dev || devApps);
        const has = Apps.get(entry.id)?.bundled;
        if (want && !has) {
            try { Apps.register(entry, { bundled: true }); } catch (err) { log.error('apps', `Bundled ${entry.id}: ${err.message}`); }
        } else if (!want && has) {
            Apps.unregister(entry.id);
        }
    }
}

export const Bundled = {
    async load() {
        try {
            const url = new URL(MANIFEST, location.href);
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const list = await res.json();
            manifest = (Array.isArray(list) ? list : []).map((e) => ({
                ...e,
                url: new URL(e.url, url).href,
                icon: e.icon ? new URL(e.icon, url).href : null,
            }));
            sync();
            log.ok('apps', `Loaded ${manifest.length} bundled apps${devApps ? '' : ' (developer apps hidden)'}.`);
        } catch (err) {
            log.warn('apps', `No bundled apps: ${err.message}`);
        }
    },

    configure({ bundledApps, devApps: dev } = {}) {
        if (typeof bundledApps === 'boolean') enabled = bundledApps;
        if (typeof dev === 'boolean') devApps = dev;
        sync();
    },
};
