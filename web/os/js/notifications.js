import { Apps } from './apps.js';
import { log } from './log.js';
import { state, settings, on, emit } from './store.js';
import { appTile, icon, logoMark } from './icons.js';
import { h, relativeTime } from './util.js';

const MAX_STORED = 50;
const MAX_BANNERS = 3;
const DEFAULT_DURATION = 4500;

const list = [];
let seq = 0;
let bannerLayer = null;
let unread = 0;

function openFrom(n) {
    Notifications.dismiss(n.id);
    if (!n.appId || !Apps.get(n.appId)) return;
    emit('notification:open', n);   // shell closes popovers / unlocks, then launches
}

/** Notification row used by banners, the lock screen and the message tray. */
export function notificationCard(n, { compact = false, dismissible = false } = {}) {
    const app = n.appId ? Apps.get(n.appId) : null;
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

function banner(n, duration) {
    while (bannerLayer.children.length >= MAX_BANNERS) bannerLayer.firstElementChild.remove();
    const el = notificationCard(n);
    el.classList.add('banner');
    bannerLayer.append(el);
    const remove = () => {
        if (el.classList.contains('is-leaving')) return;
        el.classList.add('is-leaving');
        setTimeout(() => el.remove(), 250);
    };
    el.addEventListener('click', remove);
    setTimeout(remove, duration);
}

export const Notifications = {
    init() {
        bannerLayer = document.getElementById('banners');
        on('app:notify', (data) => Notifications.push(data));
        // an app that goes away takes its notifications with it
        on('app:removed', (id) => {
            const before = list.length;
            for (let i = list.length - 1; i >= 0; i--) if (list[i].appId === id) list.splice(i, 1);
            if (list.length !== before) emit('notifications');
        });
    },

    /**
     * @param {{ appId?: string, title?: string, body?: string, duration?: number }} data
     */
    push(data = {}) {
        const app = data.appId ? Apps.get(data.appId) : null;
        if (data.appId && !app) {
            log.warn('notify', `Dropped notification from unknown app "${data.appId}"`);
            return null;
        }
        if (app && Apps.isMuted(app.id)) {
            log.debug('notify', `Muted: ${app.id}`);
            return null;
        }

        const n = {
            id: ++seq,
            appId: app?.id ?? null,
            title: String(data.title ?? app?.label ?? 'Notification').slice(0, 80),
            body: String(data.body ?? '').slice(0, 280),
            time: Date.now(),
        };
        list.unshift(n);
        if (list.length > MAX_STORED) list.length = MAX_STORED;
        unread++;
        log.debug('notify', `${n.appId ?? 'system'}: ${n.title}`);
        emit('notifications');

        if (!settings.dnd && state.awake && !state.locked && state.overlay !== 'calendar') {
            const duration = Number(data.duration) > 0 ? Math.min(Number(data.duration), 15000) : DEFAULT_DURATION;
            banner(n, duration);
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
        unread = 0;
        emit('notifications');
    },

    markRead() {
        if (!unread) return;
        unread = 0;
        emit('notifications');
    },

    get unread() { return unread; },
    all() { return list; },
};
