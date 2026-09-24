// Settings — the only built-in app. Rendered natively (not in an iframe), libadwaita style.

import { Apps } from './apps.js';
import { Bridge } from './bridge.js';
import { log } from './log.js';
import { Dialog } from './dialog.js';
import { Shell } from './shell.js';
import { state, settings, settingsSource, on, updateSettings, resetSettings, ACCENTS, SLIDER_KEYS } from './store.js';
import { appTile, icon, logoMark } from './icons.js';
import { WALLPAPERS, wallpaperCss, isSafeUrl } from './wallpapers.js';
import { h, fill, slider, formatDate, formatTime } from './util.js';

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
    const status = h('div', { class: 'row-status' });
    const applyBtn = h('button', { class: 'btn btn-suggested' }, 'Apply');

    // load the image first so a dead link never leaves the tablet with a black background
    const apply = () => {
        const url = input.value.trim();
        status.className = 'row-status';
        if (!isSafeUrl(url)) {
            status.classList.add('is-error');
            status.textContent = 'Enter an http(s):// or nui:// image URL.';
            return;
        }
        status.textContent = 'Loading…';
        applyBtn.disabled = true;
        const img = new Image();
        const done = (ok) => {
            applyBtn.disabled = false;
            if (!ok) {
                status.classList.add('is-error');
                status.textContent = 'That image could not be loaded.';
                log.warn('settings', `Custom background failed to load: ${url}`);
                return;
            }
            status.textContent = '';
            input.blur();   // lets the page re-render with the new selection
            updateSettings({ customWallpaper: url, wallpaper: 'custom' });
        };
        img.onload = () => done(true);
        img.onerror = () => done(false);
        img.src = url;
    };
    applyBtn.addEventListener('click', apply);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });

    const tiles = WALLPAPERS.map((w) => ({ id: w.id, name: w.name, css: w.css }));
    if (isSafeUrl(settings.customWallpaper)) {
        tiles.push({ id: 'custom', name: 'Custom', css: wallpaperCss({ wallpaper: 'custom', customWallpaper: settings.customWallpaper }) });
    }

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
            h('div', { class: 'wp-grid' }, tiles.map((w) => h('button', {
                class: `wp-item ${settings.wallpaper === w.id ? 'is-active' : ''}`,
                title: w.name,
                onClick: () => updateSettings({ wallpaper: w.id }),
            }, h('span', { class: 'wp-preview', style: { background: w.css } }), h('span', { class: 'wp-name' }, w.name))))),
        group('Custom Background', 'Any http(s):// or nui:// image. It is checked before it is applied.',
            h('div', { class: 'row row-stack' },
                h('div', { class: 'entry-row' }, input, applyBtn),
                status),
            settings.customWallpaper
                ? row('Remove Custom Background', h('button', {
                    class: 'btn',
                    onClick: () => updateSettings({
                        customWallpaper: '',
                        wallpaper: settings.wallpaper === 'custom' ? 'adwaita' : settings.wallpaper,
                    }),
                }, 'Remove'))
                : null),
    ];
}

function percentSlider(key, label) {
    const out = h('span', { class: 'range-value' }, `${settings[key]}%`);
    return h('div', { class: 'range-wrap' },
        slider({
            min: 10, max: 100, value: settings[key],
            'aria-label': label,
            onInput: (e) => {
                out.textContent = `${e.target.value}%`;
                updateSettings({ [key]: Number(e.target.value) });
            },
        }),
        out);
}

function displayPage() {
    return [
        group('Brightness', null,
            row('Screen Brightness', percentSlider('brightness', 'Screen brightness')),
        ),
        group('Night Light', 'Tints the screen warmer to reduce glare at night.',
            row('Night Light', settingSwitch('nightLight')),
            row('Strength', percentSlider('nightLightStrength', 'Night light strength')),
        ),
        group('Interface', null,
            row('Interface Size',
                segmented([['small', 'Small'], ['default', 'Default'], ['large', 'Large']], settings.uiScale,
                    (v) => updateSettings({ uiScale: v })),
                'Scales the shell and built-in apps. App pages keep their own sizing.'),
        ),
    ];
}

function notificationsPage() {
    const apps = Apps.list({ includeHidden: true, includeSystem: false });
    return [
        group(null, null,
            row('Do Not Disturb', settingSwitch('dnd'), 'Notifications are collected without banners.'),
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
            row('Notification Previews', settingSwitch('lockPreviews'), 'Show notification content on the lock screen. When off, only a count is shown.'),
        ),
        group(null, null,
            row('Lock Now', h('button', { class: 'btn', onClick: () => Shell.lock() }, icon('lock'), 'Lock'),
                'Locks immediately, even when the lock screen is off.'),
        ),
    ];
}

function dateTimePage() {
    const now = new Date();
    return [
        h('div', { class: 'time-preview' },
            h('div', { class: 'time-preview-clock' }, formatTime(now, settings.clock24h)),
            h('div', { class: 'time-preview-date' }, formatDate(now))),
        group(null, null,
            row('Time Format', segmented([[true, '24-hour'], [false, 'AM / PM']], settings.clock24h, (v) => updateSettings({ clock24h: v }))),
            row('Date in Top Bar', settingSwitch('statusDate')),
            row('First Day of Week', segmented([['monday', 'Monday'], ['sunday', 'Sunday']], settings.weekStart,
                (v) => updateSettings({ weekStart: v })), 'Used by the calendar in the message tray.'),
        ),
        h('p', { class: 'pref-footnote' }, 'The time comes from the player\'s computer clock.'),
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
            row('Reset Settings', h('button', {
                class: 'btn btn-destructive',
                onClick: async () => {
                    const ok = await Dialog.confirm({
                        title: 'Reset All Settings?',
                        body: 'Appearance, notifications, lock screen and dash pins go back to their defaults. Installed apps are not affected.',
                        confirm: 'Reset',
                        destructive: true,
                    });
                    if (ok) resetSettings();
                },
            }, 'Reset…'), 'Restore every setting on this tablet to its default.'),
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

        const onMinute = () => { if (current === 'datetime') redraw(); };
        document.addEventListener('pdr:minute', onMinute);

        const offs = [
            () => document.removeEventListener('pdr:minute', onMinute),
            on('settings', (changed) => { if (!changed.every((k) => SLIDER_KEYS.includes(k))) redraw(); }),
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
