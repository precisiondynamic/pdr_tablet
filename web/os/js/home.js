// Home: search + app grid, and the dash (dock) at the bottom.

import { Apps } from './apps.js';
import { log } from './log.js';
import { Menu } from './menu.js';
import { Shell } from './shell.js';
import { settings, on } from './store.js';
import { appTile, icon } from './icons.js';
import { h, fill, longPress, coalesce } from './util.js';

const MAX_DASH_RECENTS = 3;
let grid, dash, search;

function badge(app) {
    if (!app.badge) return null;
    return h('span', { class: 'badge' }, app.badge > 99 ? '99+' : String(app.badge));
}

function launchFrom(app, tile) {
    const r = tile.getBoundingClientRect();
    Apps.launch(app.id, undefined, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
}

function appButton(app, { inDash = false } = {}) {
    const tile = appTile(app);
    const el = h('button', {
        class: `app-icon ${inDash ? 'in-dash' : ''}`,
        'data-app': app.id,
        'data-label': app.label,
        'aria-label': app.label,
    },
        h('span', { class: 'tile-wrap' }, tile, badge(app)),
        inDash ? null : h('span', { class: 'app-label' }, app.label),
        inDash && Apps.isRunning(app.id) ? h('span', { class: 'run-dot' }) : null,
    );
    el.addEventListener('click', () => {
        Shell.closeOverlays();
        launchFrom(app, tile);
    });
    el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        Menu.forApp(app, tile);
    });
    longPress(el, () => Menu.forApp(app, tile));
    return el;
}

function matches(app, query) {
    return !query || app.label.toLowerCase().includes(query) || app.id.toLowerCase().includes(query);
}

function renderGrid() {
    const query = search.value.trim().toLowerCase();
    const apps = Apps.list().filter((a) => matches(a, query));
    const installed = Apps.list().some((a) => !a.system);

    let empty = null;
    if (query && !apps.length) {
        empty = h('div', { class: 'status-page' },
            icon('search', 'status-icon'),
            h('div', { class: 'status-title' }, 'No Results'),
            h('div', { class: 'status-desc' }, 'Try a different search.'));
    } else if (!query && !installed) {
        empty = h('div', { class: 'status-page' },
            icon('grid', 'status-icon'),
            h('div', { class: 'status-title' }, 'No Apps Installed'),
            h('div', { class: 'status-desc' }, 'Apps from compatible resources appear here automatically when they start.'));
    }
    fill(grid, apps.map((app) => appButton(app)), empty);
}

function renderDash() {
    const pinned = settings.dock.map((id) => Apps.get(id)).filter((a) => a && !a.hidden);
    const recents = Apps.running()
        .filter((a) => !a.hidden && !settings.dock.includes(a.id))
        .slice(0, MAX_DASH_RECENTS);

    fill(dash,
        pinned.map((app) => appButton(app, { inDash: true })),
        recents.length ? h('span', { class: 'dash-sep' }) : null,
        recents.map((app) => appButton(app, { inDash: true })),
        pinned.length || recents.length ? h('span', { class: 'dash-sep' }) : null,
        h('button', {
            class: 'app-icon in-dash dash-overview',
            'data-label': 'Open Apps',
            'aria-label': 'Open apps',
            onClick: () => Shell.toggleOverlay('overview'),
        }, h('span', { class: 'tile tile-ghost' }, icon('grid'))),
    );
}

export const Home = {
    init() {
        search = h('input', {
            type: 'text',
            class: 'search-entry',
            placeholder: 'Type to search',
            spellcheck: false,
            autocomplete: 'off',
        });
        const clear = h('button', {
            class: 'search-clear',
            'aria-label': 'Clear search',
            onClick: () => { search.value = ''; search.dispatchEvent(new Event('input')); search.focus({ preventScroll: true }); },
        }, icon('close'));
        search.addEventListener('input', () => {
            clear.classList.toggle('is-visible', !!search.value);
            renderGrid();
        });
        search.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                search.value = '';
                search.dispatchEvent(new Event('input'));
                search.blur();
            } else if (e.key === 'Enter') {
                const first = grid.querySelector('.app-icon');
                if (first) first.click();
                search.value = '';
                search.dispatchEvent(new Event('input'));
            }
        });

        grid = h('div', { class: 'app-grid' });
        dash = document.getElementById('dash');
        document.getElementById('home').append(
            h('div', { class: 'search-wrap' }, icon('search', 'search-icon'), search, clear),
            h('div', { class: 'grid-scroll' }, grid),
        );

        renderGrid();
        renderDash();

        const gridSoon = coalesce(renderGrid);
        const dashSoon = coalesce(renderDash);
        on('apps', () => { gridSoon(); dashSoon(); });
        on('running', dashSoon);
        on('settings', (changed) => { if (changed.includes('dock')) dashSoon(); });
        log.ok('home', 'Started App Launcher.');
    },
};
