import { Apps } from './apps.js';
import { Shell } from './shell.js';
import { state, settings, emit } from './store.js';
import { appTile, icon, logoMark } from './icons.js';
import { h, relativeTime } from './util.js';

const MAX_STORED = 50;
const MAX_TOASTS = 3;
const DEFAULT_DURATION = 4500;

const list = [];
let seq = 0;
let toastLayer = null;

function openFrom(n) {
    Notifications.dismiss(n.id);
    if (!n.appId || !Apps.get(n.appId)) return;
    Apps.launch(n.appId);          // deferred until unlock if the lock screen is up
    if (state.locked) Shell.unlock();
}

function source(n) {
    return n.appId ? Apps.get(n.appId) : null;
}

/** Notification card used by toasts, the lock screen, the home widget and the quick panel. */
export function notificationCard(n, { compact = false, dismissible = false } = {}) {
    const app = source(n);
    const tile = app ? appTile(app, 'tile-xs') : h('span', { class: 'tile tile-xs tile-default' }, logoMark());
    const el = h('div', { class: `notif ${compact ? 'notif-compact' : ''}` },
        tile,
        h('div', { class: 'notif-body' },
            h('div', { class: 'notif-head' },
                h('span', { class: 'notif-app' }, app?.label ?? state.osName),
                h('span', { class: 'notif-time' }, relativeTime(n.time)),
            ),
            h('div', { class: 'notif-title' }, n.title),
            n.body ? h('div', { class: 'notif-text' }, n.body) : null,
        ),
        dismissible
            ? h('button', {
                class: 'notif-dismiss',
                title: 'Dismiss',
                onClick: (e) => { e.stopPropagation(); Notifications.dismiss(n.id); },
            }, icon('close'))
            : null,
    );
    el.addEventListener('click', () => openFrom(n));
    return el;
}

function toast(n, duration) {
    while (toastLayer.children.length >= MAX_TOASTS) toastLayer.firstElementChild.remove();
    const el = notificationCard(n);
    el.classList.add('toast');
    toastLayer.append(el);
    const remove = () => {
        el.classList.add('is-leaving');
        setTimeout(() => el.remove(), 250);
    };
    el.addEventListener('click', remove);
    setTimeout(remove, duration);
}

export const Notifications = {
    init() {
        toastLayer = document.getElementById('toasts');
    },

    /**
     * @param {{ appId?: string, title?: string, body?: string, duration?: number }} data
     */
    push(data = {}) {
        const app = data.appId ? Apps.get(data.appId) : null;
        if (app && Apps.isMuted(app.id)) return null;

        const n = {
            id: ++seq,
            appId: app?.id ?? null,
            title: String(data.title ?? app?.label ?? 'Notification').slice(0, 80),
            body: String(data.body ?? '').slice(0, 280),
            time: Date.now(),
        };
        list.unshift(n);
        if (list.length > MAX_STORED) list.length = MAX_STORED;
        emit('notifications');

        if (!settings.dnd && state.awake && !state.locked) {
            const duration = Number(data.duration) > 0 ? Math.min(Number(data.duration), 15000) : DEFAULT_DURATION;
            toast(n, duration);
        }
        return n.id;
    },

    dismiss(id) {
        const i = list.findIndex((n) => n.id === id);
        if (i === -1) return;
        list.splice(i, 1);
        emit('notifications');
    },

    clear() {
        list.length = 0;
        emit('notifications');
    },

    all() { return list; },
};
