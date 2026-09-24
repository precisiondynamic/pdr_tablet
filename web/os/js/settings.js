// Settings — the only built-in app. Rendered natively (not in an iframe), libadwaita style.

import { Apps } from './apps.js';
import { Bridge } from './bridge.js';
import { log } from './log.js';
import { state, settings, settingsSource, on, updateSettings, resetSettings, ACCENTS } from './store.js';
import { appTile, icon, logoMark } from './icons.js';
import { WALLPAPERS, wallpaperCss, isSafeUrl } from './wallpapers.js';
import { h, fill, slider } from './util.js';

/* ---------- widgets ---------- */

function switchFor(value, onChange) {
    return h('button', {
        class: `switch ${value ? 'is-on' : ''}`,
        role: 'switch',
        'aria-checked': String(value),
        onClick: () => onChange(!value),
    }, h('span'));
}

const settingSwitch = (key) => switchFor(!!settings[key], (v) => updateSettings({ [key]: v }));

function segmented(options, value, onChange) {
    return h('div', { class: 'linked' },
        options.map(([v, label]) => h('button', {
            class: `linked-btn ${v === value ? 'is-active' : ''}`,
            onClick: () => onChange(v),
        }, label)),
    );
}

/** libadwaita action row */
function row(title, suffix, subtitle, { prefix = null, activatable = false } = {}) {
    return h('div', { class: `row ${activatable ? 'is-activatable' : ''}` },
        prefix,
        h('div', { class: 'row-text' },
            h('div', { class: 'row-title' }, title),
            subtitle ? h('div', { class: 'row-subtitle' }, subtitle) : null,
        ),
        suffix ? h('div', { class: 'row-suffix' }, suffix) : null,
    );
}

/** preferences group: title + boxed list */
function group(title, description, ...rows) {
    return h('section', { class: 'pref-group' },
        title ? h('h3', { class: 'pref-title' }, title) : null,
        description ? h('p', { class: 'pref-desc' }, description) : null,
        h('div', { class: 'boxed-list' }, rows),
    );
}

const value = (text) => h('span', { class: 'row-value' }, text);

/* ---------- pages ---------- */

function stylePreview(theme) {
    return h('button', {
        class: `style-choice ${settings.theme === theme ? 'is-active' : ''}`,
        onClick: () => updateSettings({ theme }),
    },
    h('span', { class: `style-thumb style-${theme}`, style: { background: wallpaperCss(settings) } },
        h('span', { class: 'style-window' }, h('span', { class: 'style-headerbar' }), h('span', { class: 'style-body' }))),
    h('span', { class: 'style-label' }, theme === 'dark' ? 'Dark' : 'Default'));
}

function appearancePage() {
    const input = h('input', {
        type: 'text',
        class: 'entry',
        placeholder: 'https://… image URL',
        value: settings.customWallpaper,
        spellcheck: false,
    });
    const error = h('div', { class: 'row-error' });
    const apply = () => {
        const url = input.value.trim();
        if (!isSafeUrl(url)) {
            error.textContent = 'Enter a valid http(s):// or nui:// image URL.';
            return;
        }
        updateSettings({ customWallpaper: url, wallpaper: 'custom' });
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });

    return [
        h('div', { class: 'style-choices' }, stylePreview('light'), stylePreview('dark')),
        group('Accent Color', null,
            h('div', { class: 'row accent-row' }, ACCENTS.map((a) => h('button', {
                class: `accent ${settings.accent === a.color ? 'is-active' : ''}`,
                style: { background: a.color },
                title: a.id,
                onClick: () => updateSettings({ accent: a.color }),
            }, icon('check'))))),
        group('Background', null,
            h('div', { class: 'wp-grid' }, WALLPAPERS.map((w) => h('button', {
                class: `wp-item ${settings.wallpaper === w.id ? 'is-active' : ''}`,
                title: w.name,
                onClick: () => updateSettings({ wallpaper: w.id }),
            }, h('span', { class: 'wp-preview', style: { background: w.css } }), h('span', { class: 'wp-name' }, w.name))))),
        group('Custom Background', 'Any http(s):// or nui:// image. It is loaded on the tablet itself.',
            h('div', { class: 'row row-stack' },
                h('div', { class: 'entry-row' }, input, h('button', { class: 'btn btn-suggested', onClick: apply }, 'Apply')),
                error)),
    ];
}

function displayPage() {
    return [
        group('Brightness', null,
            row('Screen Brightness', h('div', { class: 'range-wrap' },
                slider({
                    min: 10, max: 100, value: settings.brightness,
                    onInput: (e) => updateSettings({ brightness: Number(e.target.value) }),
                }))),
        ),
    ];
}

function notificationsPage() {
    const apps = Apps.list({ includeHidden: true, includeSystem: false });
    return [
        group(null, null,
            row('Do Not Disturb', settingSwitch('dnd'), 'Notifications are collected without banners.'),
            row('Lock Screen Notifications', settingSwitch('lockPreviews'), 'Show notification content on the lock screen.'),
        ),
        group('App Notifications', null,
            apps.length
                ? apps.map((app) => row(app.label,
                    switchFor(!settings.mutedApps.includes(app.id), (allow) => updateSettings({
                        mutedApps: allow ? settings.mutedApps.filter((id) => id !== app.id) : [...settings.mutedApps, app.id],
                    })),
                    null,
                    { prefix: appTile(app, 'tile-xs row-icon') }))
                : h('div', { class: 'row row-placeholder' }, 'No apps installed.')),
    ];
}

function lockPage() {
    return [
        group(null, null,
            row('Lock Screen', settingSwitch('lockEnabled'), 'Show the lock screen whenever the tablet is taken out.'),
        ),
    ];
}

function dateTimePage() {
    return [
        group(null, null,
            row('Time Format', segmented([[true, '24-hour'], [false, 'AM / PM']], settings.clock24h, (v) => updateSettings({ clock24h: v }))),
            row('Date in Top Bar', settingSwitch('statusDate')),
        ),
    ];
}

function appsPage() {
    const apps = Apps.list({ includeHidden: true, includeSystem: false });
    if (!apps.length) {
        return [h('div', { class: 'status-page' },
            icon('grid', 'status-icon'),
            h('div', { class: 'status-title' }, 'No Apps Installed'),
            h('div', { class: 'status-desc' }, 'Compatible resources register their apps automatically when they start.'))];
    }
    return [group(`${apps.length} Installed`, null, apps.map((app) => {
        const running = Apps.isRunning(app.id);
        const pinned = settings.dock.includes(app.id);
        return row(app.label,
            h('div', { class: 'row-buttons' },
                h('button', {
                    class: 'btn',
                    onClick: () => updateSettings({
                        dock: pinned ? settings.dock.filter((id) => id !== app.id) : [...settings.dock, app.id],
                    }),
                }, pinned ? 'Unpin' : 'Pin to Dash'),
                running ? h('button', { class: 'btn btn-destructive', onClick: () => Apps.close(app.id) }, 'Force Quit') : null),
            [app.id, running ? 'Running' : null, app.hidden ? 'Hidden' : null].filter(Boolean).join(' · '),
            { prefix: appTile(app, 'tile-sm row-icon') });
    }))];
}

/* ---- system log (journal viewer) ---- */

const LOG_FILTERS = [['all', 'All'], ['info', 'Info'], ['warn', 'Warnings'], ['error', 'Errors']];
let logFilter = 'all';

function passes(entry) {
    if (logFilter === 'all') return true;
    return log.LEVELS[entry.level] >= log.LEVELS[logFilter];
}

function journalLine(e) {
    const t = new Date(e.time);
    const ts = `${t.toTimeString().slice(0, 8)}.${String(t.getMilliseconds()).padStart(3, '0')}`;
    return h('div', { class: `jl jl-${e.level}` },
        h('span', { class: 'jl-time' }, ts),
        h('span', { class: 'jl-level' }, e.level.toUpperCase()),
        h('span', { class: 'jl-unit' }, e.unit),
        h('span', { class: 'jl-msg' }, e.message));
}

function logPage(ctx) {
    const box = h('div', { class: 'journal' });
    const counts = { warn: 0, error: 0 };
    for (const e of log.entries()) if (counts[e.level] !== undefined) counts[e.level]++;

    const lines = log.entries().filter(passes).slice(-400).map(journalLine);
    if (lines.length) box.append(...lines);
    else box.append(h('div', { class: 'jl-empty' }, 'No entries'));
    requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });

    // live tail while the page is open
    ctx.cleanup = log.subscribe((e) => {
        if (!passes(e)) return;
        box.querySelector('.jl-empty')?.remove();
        const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
        box.append(journalLine(e));
        while (box.childElementCount > 400) box.firstElementChild.remove();
        if (atBottom) box.scrollTop = box.scrollHeight;
    });

    return [
        h('div', { class: 'journal-toolbar' },
            segmented(LOG_FILTERS, logFilter, (v) => { logFilter = v; ctx.refresh(); }),
            h('span', { class: 'journal-counts' },
                `${log.entries().length} entries · ${counts.warn} warnings · ${counts.error} errors`),
            h('button', { class: 'btn', onClick: () => { log.clear(); ctx.refresh(); } }, icon('trash'), 'Clear')),
        box,
    ];
}

function systemPage() {
    return [
        h('div', { class: 'about-hero' },
            logoMark('about-logo'),
            h('div', { class: 'about-name' }, state.osName),
            h('div', { class: 'about-version' }, `Version ${state.version}`)),
        group('Startup', null,
            row('Boot Screen',
                segmented([['verbose', 'Boot Log'], ['splash', 'Splash'], ['off', 'None']], settings.bootStyle,
                    (v) => updateSettings({ bootStyle: v })),
                'Shown the first time the tablet is used each session.'),
        ),
        group('System Details', null,
            row('OS Name', value(state.osName)),
            row('OS Version', value(state.version)),
            state.deviceName ? row('Device', value(state.deviceName)) : null,
            row('Display', value(`${innerWidth} × ${innerHeight}`)),
            row('Resource', value(Bridge.resource)),
            row('Transport', value(Bridge.mode)),
            row('Settings Source', value(settingsSource)),
            row('Installed Apps', value(String(Apps.list({ includeHidden: true, includeSystem: false }).length))),
            row('Open Apps', value(String(Apps.running().length))),
        ),
        group(null, null,
            row('Reset Settings', h('button', { class: 'btn btn-destructive', onClick: () => resetSettings() }, 'Reset'),
                'Restore every setting on this tablet to its default.'),
        ),
    ];
}

const PAGES = [
    { id: 'appearance', label: 'Appearance', icon: 'palette', render: appearancePage },
    { id: 'display', label: 'Display', icon: 'display', render: displayPage },
    { id: 'notifications', label: 'Notifications', icon: 'bell', render: notificationsPage },
    { id: 'lock', label: 'Lock Screen', icon: 'lockScreen', render: lockPage },
    { id: 'datetime', label: 'Date & Time', icon: 'clock', render: dateTimePage },
    { id: 'apps', label: 'Apps', icon: 'grid', render: appsPage },
    { id: 'log', label: 'System Log', icon: 'terminal', render: logPage, live: true },
    { id: 'system', label: 'System', icon: 'system', render: systemPage },
];

export const SettingsApp = {
    id: 'system.settings',
    label: 'Settings',
    color: '#5e5c64',
    systemIcon: 'gear',
    order: 1000,

    render(body) {
        const root = h('div', { class: 'settings' });
        body.append(root);
        let current = PAGES[0].id;
        const ctx = { cleanup: null, refresh: () => draw(true) };

        function draw(keepScroll) {
            ctx.cleanup?.();
            ctx.cleanup = null;
            const page = PAGES.find((p) => p.id === current) ?? PAGES[0];
            const prev = root.querySelector('.settings-content');
            const scroll = keepScroll && prev ? prev.scrollTop : 0;

            const content = h('div', { class: `settings-content ${page.live ? 'is-fill' : ''}` },
                h('div', { class: 'clamp' },
                    h('h2', { class: 'page-title' }, page.label),
                    page.render(ctx)));
            fill(root,
                h('nav', { class: 'settings-sidebar' },
                    PAGES.map((p) => h('button', {
                        class: `sidebar-row ${p.id === page.id ? 'is-selected' : ''}`,
                        onClick: () => { if (current !== p.id) { current = p.id; draw(false); } },
                    }, icon(p.icon), h('span', null, p.label)))),
                content);
            content.scrollTop = scroll;
        }

        const redraw = () => {
            if (current === 'log') return;    // the journal page updates itself
            // don't rebuild while the user is typing in a field
            const a = document.activeElement;
            if (root.contains(a) && a.tagName === 'INPUT' && a.type === 'text') return;
            draw(true);
        };
        draw(false);

        const offs = [
            on('settings', (changed) => { if (!(changed.length === 1 && changed[0] === 'brightness')) redraw(); }),
            on('apps', redraw),
            on('running', redraw),
        ];
        return {
            show: redraw,
            launch: (data) => {
                if (data && PAGES.some((p) => p.id === data.section)) {
                    current = data.section;
                    draw(false);
                }
            },
            destroy: () => {
                ctx.cleanup?.();
                offs.forEach((off) => off());
            },
        };
    },
};
