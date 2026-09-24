// Home screen: clock + notifications widgets, app grid, dock.

import { Apps } from './apps.js';
import { Menu } from './menu.js';
import { Notifications, notificationCard } from './notifications.js';
import { settings, on } from './store.js';
import { appTile, icon } from './icons.js';
import { h, fill, longPress, formatDate, timeParts } from './util.js';

const MAX_DOCK_RECENTS = 3;
let grid, dock, clockEl, notifBox;

function badge(app) {
    if (!app.badge) return null;
    return h('span', { class: 'badge' }, app.badge > 99 ? '99+' : String(app.badge));
}

function appButton(app, { inDock = false } = {}) {
    const tile = appTile(app);
    const el = h('button', { class: `app-icon ${inDock ? 'in-dock' : ''}`, 'data-app': app.id, title: app.label },
        h('span', { class: 'tile-wrap' }, tile, badge(app)),
        inDock ? null : h('span', { class: 'app-label' }, app.label),
        inDock && Apps.isRunning(app.id) ? h('span', { class: 'run-dot' }) : null,
    );
    el.addEventListener('click', () => {
        const r = tile.getBoundingClientRect();
        Apps.launch(app.id, undefined, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
    });
    el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        Menu.forApp(app, tile);
    });
    longPress(el, () => Menu.forApp(app, tile));
    return el;
}

function renderGrid() {
    const apps = Apps.list();
    const thirdParty = apps.filter((a) => !a.system);
    fill(grid,
        ...apps.map((app) => appButton(app)),
        thirdParty.length
            ? null
            : h('div', { class: 'grid-empty' },
                icon('apps', 'grid-empty-icon'),
                h('div', { class: 'grid-empty-title' }, 'No apps installed'),
                h('div', { class: 'grid-empty-text' }, 'Apps from compatible resources appear here automatically when they start.'),
            ),
    );
}

function renderDock() {
    const pinned = settings.dock.map((id) => Apps.get(id)).filter((a) => a && !a.hidden);
    const recents = Apps.running()
        .filter((a) => !a.hidden && !settings.dock.includes(a.id))
        .slice(0, MAX_DOCK_RECENTS);

    fill(dock,
        ...pinned.map((app) => appButton(app, { inDock: true })),
        pinned.length && recents.length ? h('span', { class: 'dock-divider' }) : null,
        ...recents.map((app) => appButton(app, { inDock: true })),
    );
    dock.classList.toggle('is-empty', !pinned.length && !recents.length);
}

function renderClock(now = new Date()) {
    const { hm, suffix } = timeParts(now, settings.clock24h);
    fill(clockEl,
        h('div', { class: 'cw-time' }, hm, suffix ? h('small', null, suffix) : null),
        h('div', { class: 'cw-date' }, formatDate(now)),
    );
}

function renderNotifications() {
    const list = Notifications.all().slice(0, 4);
    fill(notifBox,
        h('div', { class: 'widget-title' }, icon('bell'), 'Notifications'),
        list.length
            ? h('div', { class: 'nw-list' }, list.map((n) => notificationCard(n, { compact: true, dismissible: true })))
            : h('div', { class: 'nw-empty' }, "You're all caught up"),
    );
}

export const Home = {
    init() {
        const home = document.getElementById('home');
        clockEl = h('div', { class: 'widget clock-widget' });
        notifBox = h('div', { class: 'widget notif-widget' });
        grid = h('div', { class: 'app-grid' });
        dock = document.getElementById('dock');

        home.append(
            h('aside', { class: 'home-widgets' }, clockEl, notifBox),
            h('main', { class: 'home-apps' }, grid),
        );

        renderClock();
        renderGrid();
        renderDock();
        renderNotifications();

        document.addEventListener('pdr:minute', (e) => renderClock(e.detail));
        on('apps', () => { renderGrid(); renderDock(); });
        on('running', renderDock);
        on('notifications', renderNotifications);
        on('settings', (changed) => {
            if (changed.includes('dock')) renderDock();
            if (changed.includes('clock24h')) renderClock();
            if (changed.includes('mutedApps')) renderGrid();
        });
    },
};
