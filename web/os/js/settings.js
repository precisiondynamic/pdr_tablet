// Settings — the only built-in app. Rendered natively (not in an iframe).

import { Apps } from './apps.js';
import { Bridge } from './bridge.js';
import { state, settings, on, updateSettings, resetSettings } from './store.js';
import { appTile, icon, logoMark } from './icons.js';
import { WALLPAPERS, wallpaperCss, isSafeUrl } from './wallpapers.js';
import { h, fill, slider } from './util.js';

const ACCENTS = ['#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316', '#f59e0b', '#22c55e', '#14b8a6'];

/* ---------- controls ---------- */

function toggle(key) {
    const on = !!settings[key];
    return h('button', {
        class: `switch ${on ? 'is-on' : ''}`,
        role: 'switch',
        'aria-checked': String(on),
        onClick: () => updateSettings({ [key]: !settings[key] }),
    }, h('span'));
}

function toggleValue(value, onChange) {
    return h('button', {
        class: `switch ${value ? 'is-on' : ''}`,
        role: 'switch',
        'aria-checked': String(value),
        onClick: () => onChange(!value),
    }, h('span'));
}

function segmented(options, value, onChange) {
    return h('div', { class: 'segmented' },
        options.map(([v, label]) => h('button', {
            class: v === value ? 'is-active' : '',
            onClick: () => onChange(v),
        }, label)),
    );
}

function row(label, control, desc) {
    return h('div', { class: 'set-row' },
        h('div', { class: 'set-row-text' },
            h('div', { class: 'set-row-label' }, label),
            desc ? h('div', { class: 'set-row-desc' }, desc) : null,
        ),
        control,
    );
}

const group = (title, ...rows) => h('section', { class: 'set-group' },
    title ? h('h3', { class: 'set-group-title' }, title) : null,
    h('div', { class: 'set-card' }, rows),
);

/* ---------- sections ---------- */

const SECTIONS = [
    {
        id: 'display', label: 'Display', icon: 'display', color: '#3b82f6',
        render: () => [
            group('Appearance',
                row('Theme', segmented([['dark', 'Dark'], ['light', 'Light']], settings.theme, (v) => updateSettings({ theme: v }))),
                row('Accent color', h('div', { class: 'swatches' }, ACCENTS.map((c) => h('button', {
                    class: `swatch ${settings.accent === c ? 'is-active' : ''}`,
                    style: { background: c },
                    title: c,
                    onClick: () => updateSettings({ accent: c }),
                })))),
            ),
            group('Brightness',
                row('Screen brightness', h('div', { class: 'range-wrap' },
                    icon('sunSmall'),
                    slider({
                        min: 10, max: 100, value: settings.brightness,
                        onInput: (e) => updateSettings({ brightness: Number(e.target.value) }),
                    }),
                    icon('sun'),
                )),
            ),
        ],
    },
    {
        id: 'wallpaper', label: 'Wallpaper', icon: 'image', color: '#0ea5e9',
        render: () => {
            const input = h('input', {
                type: 'text',
                placeholder: 'https://… image URL',
                value: settings.customWallpaper,
                spellcheck: false,
            });
            const error = h('div', { class: 'set-error' });
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
                group('Presets',
                    h('div', { class: 'wp-grid' }, WALLPAPERS.map((w) => h('button', {
                        class: `wp-item ${settings.wallpaper === w.id ? 'is-active' : ''}`,
                        onClick: () => updateSettings({ wallpaper: w.id }),
                    }, h('span', { class: 'wp-preview', style: { background: w.css } }), h('span', { class: 'wp-name' }, w.name)))),
                ),
                group('Custom image',
                    h('div', { class: 'set-row set-row-stack' },
                        h('div', { class: 'input-row' }, input, h('button', { class: 'btn', onClick: apply }, 'Apply')),
                        error,
                        settings.wallpaper === 'custom'
                            ? h('div', { class: 'wp-custom-preview', style: { background: wallpaperCss(settings) } })
                            : null,
                    ),
                ),
            ];
        },
    },
    {
        id: 'lock', label: 'Lock screen', icon: 'lock', color: '#64748b',
        render: () => [
            group(null,
                row('Lock screen', toggle('lockEnabled'), 'Show the lock screen whenever the tablet is taken out.'),
                row('Notification previews', toggle('lockPreviews'), 'Show notification content on the lock screen.'),
                row('Boot animation', toggle('bootAnimation'), 'Play the startup animation the first time the tablet is used.'),
            ),
        ],
    },
    {
        id: 'notifications', label: 'Notifications', icon: 'bell', color: '#ef4444',
        render: () => {
            const apps = Apps.list({ includeHidden: true, includeSystem: false });
            return [
                group(null, row('Do not disturb', toggle('dnd'), 'Notifications are collected silently without pop-ups.')),
                group('Allow notifications',
                    apps.length
                        ? apps.map((app) => row(
                            h('span', { class: 'set-app' }, appTile(app, 'tile-xs'), app.label),
                            toggleValue(!settings.mutedApps.includes(app.id), (allow) => updateSettings({
                                mutedApps: allow
                                    ? settings.mutedApps.filter((id) => id !== app.id)
                                    : [...settings.mutedApps, app.id],
                            })),
                        ))
                        : h('div', { class: 'set-empty' }, 'No apps installed.'),
                ),
            ];
        },
    },
    {
        id: 'datetime', label: 'Date & time', icon: 'clock', color: '#f59e0b',
        render: () => [
            group(null,
                row('24-hour time', toggle('clock24h')),
                row('Date in status bar', toggle('statusDate')),
            ),
        ],
    },
    {
        id: 'apps', label: 'Apps', icon: 'apps', color: '#8b5cf6',
        render: () => {
            const apps = Apps.list({ includeHidden: true, includeSystem: false });
            if (!apps.length) {
                return [group(null, h('div', { class: 'set-empty' },
                    'No apps installed. Compatible resources register their apps automatically when they start.'))];
            }
            return [group(`${apps.length} installed`, apps.map((app) => {
                const running = Apps.isRunning(app.id);
                const pinned = settings.dock.includes(app.id);
                return h('div', { class: 'set-row' },
                    h('div', { class: 'set-app' },
                        appTile(app, 'tile-sm'),
                        h('div', null,
                            h('div', { class: 'set-row-label' }, app.label),
                            h('div', { class: 'set-row-desc' }, [
                                running ? 'Running' : 'Not running',
                                app.hidden ? 'Hidden' : null,
                            ].filter(Boolean).join(' · ')),
                        ),
                    ),
                    h('div', { class: 'set-actions' },
                        h('button', {
                            class: 'btn btn-ghost',
                            onClick: () => updateSettings({
                                dock: pinned ? settings.dock.filter((id) => id !== app.id) : [...settings.dock, app.id],
                            }),
                        }, pinned ? 'Unpin from dock' : 'Pin to dock'),
                        running ? h('button', { class: 'btn btn-danger', onClick: () => Apps.close(app.id) }, 'Force stop') : null,
                    ),
                );
            }))];
        },
    },
    {
        id: 'about', label: 'About', icon: 'info', color: '#22c55e',
        render: () => [
            h('div', { class: 'about-hero' },
                logoMark('about-logo'),
                h('div', { class: 'about-name' }, state.osName),
                h('div', { class: 'about-version' }, `Version ${state.version}`),
            ),
            group(null,
                state.deviceName ? row('Device', h('span', { class: 'set-value' }, state.deviceName)) : null,
                row('Installed apps', h('span', { class: 'set-value' }, String(Apps.list({ includeHidden: true, includeSystem: false }).length))),
                row('Open apps', h('span', { class: 'set-value' }, String(Apps.running().length))),
                row('Resource', h('span', { class: 'set-value mono' }, Bridge.resource)),
            ),
            group(null,
                row('Reset settings', h('button', { class: 'btn btn-danger', onClick: () => resetSettings() }, 'Reset'),
                    'Restore every setting on this tablet to its default.'),
            ),
        ],
    },
];

function render(root, current, select) {
    const section = SECTIONS.find((s) => s.id === current) ?? SECTIONS[0];
    const detail = h('div', { class: 'set-detail' },
        h('h2', { class: 'set-title' }, section.label),
        section.render(),
    );
    const scroll = root.querySelector('.set-detail')?.scrollTop ?? 0;
    fill(root,
        h('nav', { class: 'set-nav' },
            h('div', { class: 'set-nav-title' }, 'Settings'),
            SECTIONS.map((s) => h('button', {
                class: `set-nav-item ${s.id === section.id ? 'is-active' : ''}`,
                onClick: () => select(s.id),
            }, h('span', { class: 'set-nav-icon', style: { background: s.color } }, icon(s.icon)), h('span', null, s.label),
            icon('chevronRight', 'set-nav-chevron'))),
        ),
        detail,
    );
    detail.scrollTop = scroll;
}

export const SettingsApp = {
    id: 'system.settings',
    label: 'Settings',
    color: '#475569',
    systemIcon: 'gear',
    order: 1000,

    render(frame) {
        const root = h('div', { class: 'settings' });
        frame.append(root);
        let current = SECTIONS[0].id;
        const select = (id) => {
            current = id;
            root.querySelector('.set-detail')?.scrollTo(0, 0);
            render(root, current, select);
        };
        const rerender = () => {
            // don't rebuild while the user is typing in a field
            if (root.contains(document.activeElement) && document.activeElement.tagName === 'INPUT'
                && document.activeElement.type === 'text') return;
            render(root, current, select);
        };
        render(root, current, select);

        const offs = [
            on('settings', (changed) => { if (!(changed.length === 1 && changed[0] === 'brightness')) rerender(); }),
            on('apps', rerender),
            on('running', rerender),
        ];
        return {
            show: rerender,
            destroy: () => offs.forEach((off) => off()),
        };
    },
};
