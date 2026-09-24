// Quick settings (GNOME system menu): session buttons, brightness, toggles.

import { Apps } from './apps.js';
import { log } from './log.js';
import { Shell, batteryIndicator } from './shell.js';
import { state, settings, on, updateSettings } from './store.js';
import { icon } from './icons.js';
import { h, fill, slider } from './util.js';

let el = null;

function roundButton(glyph, title, onClick) {
    return h('button', { class: 'qs-round', title, onClick }, icon(glyph));
}

function toggle(glyph, title, active, onClick) {
    return h('button', { class: `qs-toggle ${active ? 'is-active' : ''}`, onClick },
        icon(glyph),
        h('span', { class: 'qs-toggle-text' },
            h('span', { class: 'qs-toggle-title' }, title),
            h('span', { class: 'qs-toggle-sub' }, active ? 'On' : 'Off')),
    );
}

function render() {
    fill(el,
        h('div', { class: 'qs-head' },
            h('div', { class: 'qs-head-info' }, batteryIndicator()),
            h('div', { class: 'qs-head-buttons' },
                roundButton('settings', 'Settings', () => { Shell.closeOverlays(); Apps.launch('system.settings'); }),
                roundButton('lock', 'Lock', () => Shell.lock()),
                roundButton('power', 'Put away', () => Shell.requestClose()),
            ),
        ),
        h('label', { class: 'qs-slider' },
            icon('brightness'),
            slider({
                min: 10, max: 100, value: settings.brightness,
                'aria-label': 'Brightness',
                onInput: (e) => updateSettings({ brightness: Number(e.target.value) }),
            }),
        ),
        h('div', { class: 'qs-toggles' },
            toggle(settings.dnd ? 'bellOff' : 'bell', 'Do Not Disturb', settings.dnd,
                () => updateSettings({ dnd: !settings.dnd })),
            toggle('darkStyle', 'Dark Style', settings.theme === 'dark',
                () => updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })),
        ),
    );
}

export const QuickSettings = {
    init() {
        el = document.getElementById('quick');
        Shell.registerOverlay('quick', { onOpen: render });
        const rerender = () => { if (state.overlay === 'quick') render(); };
        on('settings', (changed) => { if (!changed.includes('brightness')) rerender(); });
        document.addEventListener('pdr:status', rerender);
        log.ok('shell', 'Started Quick Settings.');
    },
};
