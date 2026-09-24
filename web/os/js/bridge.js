// Host <-> OS transport.
//
// Inbound:  the integration sends `{ action, ...payload }` with SendDuiMessage / SendNUIMessage.
// Outbound: the OS POSTs to `https://<resource>/<event>` (RegisterNUICallback on the Lua side).
//
// This is the only file that knows how messages travel. If your integration needs a different
// transport, swap it out here.

import { log } from './log.js';

const params = new URLSearchParams(location.search);
const framed = window.parent !== window;

const inCfx = typeof window.GetParentResourceName === 'function'
    || typeof window.invokeNative === 'function'
    || params.has('resource');

const resource = params.get('resource')
    || (typeof window.GetParentResourceName === 'function' ? window.GetParentResourceName() : 'pdr_tablet');

const mode = inCfx ? 'cfx' : framed ? 'harness' : 'standalone';

const handlers = new Map();
const pendingReplies = new Map();
let seq = 0;

// Host messages come from the page itself (NUI/DUI) or, in the dev harness, from the parent frame.
// App iframes are children, so they can never pass this check.
function isHostSource(source) {
    return source == null || source === window || (framed && source === window.parent);
}

window.addEventListener('message', (event) => {
    let msg = event.data;
    if (typeof msg === 'string') {
        try { msg = JSON.parse(msg); } catch { return; }
    }
    if (!msg || typeof msg !== 'object' || msg.__pdrTablet) return;
    if (!isHostSource(event.source)) return;

    if (msg.__pdrTabletReply) {
        const resolve = pendingReplies.get(msg.id);
        if (resolve) {
            pendingReplies.delete(msg.id);
            resolve(msg.result);
        }
        return;
    }

    if (typeof msg.action !== 'string') return;
    const list = handlers.get(msg.action);
    if (!list) {
        log.warn('bridge', `Unknown action "${msg.action}"`);
        return;
    }
    log.debug('bridge', `← ${msg.action}`);
    for (const fn of list) {
        try { fn(msg); } catch (err) { log.error('bridge', `${msg.action}: ${err.message}`); }
    }
});

async function call(event, data = {}) {
    if (inCfx) {
        const res = await fetch(`https://${resource}/${event}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=UTF-8' },
            body: JSON.stringify(data),
        });
        const text = await res.text();
        if (!text) return null;
        try { return JSON.parse(text); } catch { return text; }
    }

    if (framed) {
        // dev harness: the parent page answers
        const id = ++seq;
        return new Promise((resolve) => {
            pendingReplies.set(id, resolve);
            window.parent.postMessage({ __pdrTabletEmit: true, id, event, data }, '*');
            setTimeout(() => {
                if (pendingReplies.delete(id)) resolve(null);
            }, 10000);
        });
    }

    return null;
}

export const Bridge = {
    resource,
    mode,
    standalone: mode === 'standalone',

    on(action, fn) {
        if (!handlers.has(action)) handlers.set(action, []);
        handlers.get(action).push(fn);
    },

    /** Fire-and-forget. Never throws. */
    emit(event, data) {
        // os:log must not log its own failures (it would loop)
        call(event, data).catch((err) => {
            if (event !== 'os:log') log.warn('bridge', `emit ${event} failed: ${err.message}`);
        });
    },

    /** Resolves with the callback's response. Rejects if the transport fails. */
    call,
};
