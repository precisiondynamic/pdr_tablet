// Watchdog: keeps the tablet recoverable no matter what an app does.
//
//  • Heartbeat — the app on screen is pinged; if its SDK stops answering (hung, crashed,
//    navigated away) the user gets GNOME's "not responding" dialog with Force Quit / Wait.
//  • Keyboard focus — tells the integration whether a text field has focus
//    (`input:focus { editable }`), so it only captures the keyboard while someone is typing
//    and never leaves it captured after the field, app or tablet goes away.

import { Apps } from './apps.js';
import { Bridge } from './bridge.js';
import { Dialog } from './dialog.js';
import { log } from './log.js';
import { state, on } from './store.js';

let hungId = null;          // app currently shown as not responding
let editable = false;       // last value sent to the integration
let osEditable = false;

function isEditableEl(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') return !el.disabled && !el.readOnly;
    if (el.tagName !== 'INPUT') return false;
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    return ['text', 'search', 'email', 'password', 'tel', 'url', 'number'].includes(type) && !el.disabled && !el.readOnly;
}

function computeEditable() {
    if (!state.awake || state.booting) return false;
    if (osEditable) return true;
    const r = Apps.visibleRecord();
    return !!(r && r.editable);
}

function syncFocus() {
    const next = computeEditable();
    if (next === editable) return;
    editable = next;
    Bridge.emit('input:focus', { editable });
}

function heartbeat() {
    // the foreground app is pinged even behind an overlay or the lock screen (the SDK answers
    // while hidden), but is only declared hung while it is actually on screen
    const r = Apps.foregroundRecord();
    if (!r || !r.iframe || !r.ready || r.sdk < 2 || !state.awake) return;
    const silent = Date.now() - r.lastPong;
    if (Apps.visibleRecord() === r && silent > state.heartbeatTimeout && hungId !== r.app.id) {
        hungId = r.app.id;
        const id = r.app.id, label = r.app.label;
        log.warn('apps', `${id} is not responding (no heartbeat for ${Math.round(silent / 1000)} s)`);
        Dialog.confirm({
            title: `“${label}” Is Not Responding`,
            body: 'You may choose to wait a short while for it to continue or force the app to quit entirely.',
            confirm: 'Force Quit',
            cancel: 'Wait',
            destructive: true,
        }).then((quit) => {
            if (hungId !== id) return;          // it recovered and the dialog was dismissed
            hungId = null;
            if (quit) {
                log.info('apps', `Force quit ${id} after it stopped responding`);
                Apps.close(id);
            } else {
                const again = Apps.visibleRecord();
                if (again && again.app.id === id) again.lastPong = Date.now();   // give it another full timeout
            }
        });
    }
    Apps.ping(r);
}

let timer = null;
function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => { heartbeat(); schedule(); }, state.heartbeatInterval);
}

export const Watchdog = {
    init() {
        document.addEventListener('focusin', (e) => { osEditable = isEditableEl(e.target); syncFocus(); });
        document.addEventListener('focusout', () => {
            // focus moves to the next element in the same task; check once it has settled
            setTimeout(() => { osEditable = isEditableEl(document.activeElement); syncFocus(); }, 0);
        });
        on('input-focus', syncFocus);
        on('state', (keys) => {
            if (keys.includes('awake') && state.awake) { const r = Apps.foregroundRecord(); if (r) r.lastPong = Date.now(); }
            // leaving the view that owns the field must drop keyboard capture
            if (keys.some((k) => ['awake', 'locked', 'view', 'overlay', 'booting'].includes(k))) {
                const a = document.activeElement;
                if ((!state.awake || state.locked || keys.includes('view')) && isEditableEl(a)) a.blur();
                syncFocus();
            }
        });
        on('running', syncFocus);
        on('lifecycle', (id, st) => {
            syncFocus();
            // coming (back) on screen starts a fresh timeout
            if (st === 'foreground' || st === 'ready') { const r = Apps.foregroundRecord(); if (r) r.lastPong = Date.now(); }
        });
        on('app:pong', (id) => {
            if (hungId === id) { hungId = null; Dialog.dismiss(); log.info('apps', `${id} is responding again`); }
        });
        schedule();
    },

    reschedule: schedule,
    get editable() { return editable; },
};
