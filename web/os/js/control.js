// Control Center (top-right system menu).
//
//   status + session buttons (Settings, Lock, Put away)
//   brightness
//   toggles: Do Not Disturb · Dark Style ▸ accent · Night Light ▸ strength · Lock Screen
//   open apps with quit buttons
//   shortcut to the notification list
//
// Every control writes the same settings the Settings app does, so both stay in sync.

import { Apps } from './apps.js';
import { log } from './log.js';
import { Notifications } from './notifications.js';
import { Shell, batteryIndicator } from './shell.js';
import { state, settings, on, updateSettings, ACCENTS, SLIDER_KEYS } from './store.js';
import { appTile, icon } from './icons.js';
import { h, fill, slider, clamp } from './util.js';

let el = null;
let expanded = null;   // id of the open toggle submenu

function roundButton(glyph, title, onClick) {
    return h('button', { class: 'cc-round', title, 'aria-label': title, onClick }, icon(glyph));
}

/**
 * GNOME-style pill toggle. With `menu`, the right side becomes an arrow that opens a submenu.
 */
function toggle({ id, glyph, title, subtitle, active, onToggle, menu = false }) {
    return h('div', { 'data-toggle': id, class: `cc-toggle ${active ? 'is-active' : ''} ${menu ? 'has-menu' : ''} ${expanded === id ? 'is-expanded' : ''}` },
        h('button', { class: 'cc-toggle-main', 'aria-pressed': String(active), onClick: onToggle },
            icon(glyph, 'cc-toggle-icon'),
            h('span', { class: 'cc-toggle-text' },
                h('span', { class: 'cc-toggle-title' }, title),
                h('span', { class: 'cc-toggle-sub' }, subtitle ?? (active ? 'On' : 'Off')))),
        menu
            ? h('button', {
                class: 'cc-toggle-arrow',
                title: `${title} options`,
                onClick: () => { expanded = expanded === id ? null : id; render(); },
            }, icon('chevronRight'))
            : null,
    );
}

function submenu() {
    if (expanded === 'style') {
        return h('div', { class: 'cc-menu' },
            h('div', { class: 'cc-menu-title' }, icon('palette'), 'Accent Color'),
            h('div', { class: 'cc-accents' }, ACCENTS.map((a) => h('button', {
                class: `accent accent-sm ${settings.accent === a.color ? 'is-active' : ''}`,
                style: { background: a.color },
                title: a.id,
                onClick: () => updateSettings({ accent: a.color }),
            }, icon('check')))));
    }
    if (expanded === 'night') {
        const value = h('span', { class: 'cc-value' }, `${settings.nightLightStrength}%`);
        return h('div', { class: 'cc-menu' },
            h('div', { class: 'cc-menu-title' }, icon('nightLight'), 'Night Light Strength'),
            h('label', { class: 'cc-slider' },
                icon('sun'),
                slider({
                    min: 10, max: 100, value: settings.nightLightStrength,
                    'aria-label': 'Night light strength',
                    onInput: (e) => {
                        value.textContent = `${e.target.value}%`;
                        updateSettings({ nightLightStrength: Number(e.target.value), nightLight: true });
                        // patch the toggle in place; a full re-render would end the drag
                        const t = el.querySelector('[data-toggle="night"]');
                        t.classList.add('is-active');
                        t.querySelector('.cc-toggle-sub').textContent = value.textContent;
                    },
                }),
                value));
    }
    return null;
}

function openApps() {
    const apps = Apps.running();
    return h('section', { class: 'cc-section' },
        h('div', { class: 'cc-section-head' },
            h('span', null, 'Open Apps'),
            apps.length > 1 ? h('button', { class: 'link-btn', onClick: () => Apps.closeAll() }, 'Quit All') : null),
        apps.length
            ? h('div', { class: 'cc-apps' }, apps.map((app) => h('div', { class: 'cc-app' },
                h('button', {
                    class: 'cc-app-main',
                    title: `Show ${app.label}`,
                    onClick: () => { Shell.closeOverlays(); Apps.launch(app.id); },
                },
                appTile(app, 'tile-xs'),
                h('span', { class: 'cc-app-text' },
                    h('span', { class: 'cc-app-name' }, app.label),
                    h('span', { class: 'cc-app-state' }, app.id === Apps.foreground ? 'In use' : 'In background'))),
                h('button', { class: 'cc-app-quit', title: `Quit ${app.label}`, onClick: () => Apps.close(app.id) }, icon('close')))))
            : h('div', { class: 'cc-empty' }, 'No apps are open'),
    );
}

function render() {
    const { network, signal } = state.status;
    const count = Notifications.all().length;
    const scroll = el.querySelector('.cc-scroll')?.scrollTop ?? 0;

    fill(el,
        h('div', { class: 'cc-head' },
            h('div', { class: 'cc-status' },
                batteryIndicator(),
                network ? h('span', { class: 'cc-chip' }, icon('wifi'), network, Number.isFinite(signal) ? ` · ${clamp(Math.round(signal), 0, 4)}/4` : '') : null),
            h('div', { class: 'cc-head-buttons' },
                roundButton('settings', 'Settings', () => { Shell.closeOverlays(); Apps.launch('system.settings'); }),
                roundButton('lock', 'Lock', () => Shell.lock()),
                roundButton('power', 'Put away', () => Shell.requestClose()))),

        h('label', { class: 'cc-slider cc-brightness' },
            icon('brightness'),
            slider({
                min: 10, max: 100, value: settings.brightness,
                'aria-label': 'Brightness',
                onInput: (e) => updateSettings({ brightness: Number(e.target.value) }),
            })),

        h('div', { class: 'cc-toggles' },
            toggle({
                id: 'dnd', glyph: settings.dnd ? 'bellOff' : 'bell', title: 'Do Not Disturb', active: settings.dnd,
                onToggle: () => updateSettings({ dnd: !settings.dnd }),
            }),
            toggle({
                id: 'style', glyph: 'darkStyle', title: 'Dark Style', active: settings.theme === 'dark', menu: true,
                onToggle: () => updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' }),
            }),
            toggle({
                id: 'night', glyph: 'nightLight', title: 'Night Light', active: settings.nightLight, menu: true,
                subtitle: settings.nightLight ? `${settings.nightLightStrength}%` : 'Off',
                onToggle: () => updateSettings({ nightLight: !settings.nightLight }),
            }),
            toggle({
                id: 'lock', glyph: 'lock', title: 'Lock Screen', active: settings.lockEnabled,
                subtitle: settings.lockEnabled ? 'On wake' : 'Off',
                onToggle: () => updateSettings({ lockEnabled: !settings.lockEnabled }),
            }),
        ),
        submenu(),

        h('div', { class: 'cc-scroll' }, openApps()),

        count
            ? h('button', {
                class: 'cc-notifs',
                onClick: () => Shell.openOverlay('calendar'),
            }, icon('bell'), h('span', null, `${count} notification${count === 1 ? '' : 's'}`), icon('chevronRight'))
            : null,
    );
    const sc = el.querySelector('.cc-scroll');
    if (sc) sc.scrollTop = scroll;
}

export const ControlCenter = {
    init() {
        el = document.getElementById('control');
        Shell.registerOverlay('control', {
            onOpen: () => { expanded = null; render(); },
        });
        const rerender = () => { if (state.overlay === 'control') render(); };
        on('settings', (changed) => {
            // slider drags update the slider themselves; re-rendering would drop the drag
            const fromSlider = changed.some((k) => SLIDER_KEYS.includes(k))
                && changed.every((k) => SLIDER_KEYS.includes(k) || k === 'nightLight');
            if (!fromSlider) rerender();
        });
        on('running', rerender);
        on('notifications', rerender);
        document.addEventListener('pdr:status', rerender);
        log.ok('shell', 'Started Control Center.');
    },
};
