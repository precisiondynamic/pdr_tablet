// Quick panel: do-not-disturb, lock, settings, put away, brightness and the notification center.

import { Apps } from './apps.js';
import { Notifications, notificationCard } from './notifications.js';
import { Shell } from './shell.js';
import { state, settings, on, setState, updateSettings } from './store.js';
import { icon } from './icons.js';
import { h, fill, slider } from './util.js';

let el = null;

function tile(label, glyph, { active = false, onClick }) {
    return h('button', { class: `qp-tile ${active ? 'is-active' : ''}`, onClick },
        h('span', { class: 'qp-tile-icon' }, icon(glyph)),
        h('span', { class: 'qp-tile-label' }, label),
    );
}

function render() {
    const notes = Notifications.all();
    fill(el,
        h('div', { class: 'qp-tiles' },
            tile('Do not disturb', settings.dnd ? 'bellOff' : 'moon', {
                active: settings.dnd,
                onClick: () => updateSettings({ dnd: !settings.dnd }),
            }),
            tile('Lock', 'lock', { onClick: () => Shell.lock() }),
            tile('Settings', 'gear', {
                onClick: () => { Panel.close(); Apps.launch('system.settings'); },
            }),
            tile('Put away', 'power', { onClick: () => Shell.requestClose() }),
        ),
        h('label', { class: 'qp-brightness' },
            icon('sunSmall'),
            slider({
                min: 10, max: 100, value: settings.brightness,
                'aria-label': 'Brightness',
                onInput: (e) => updateSettings({ brightness: Number(e.target.value) }),
            }),
            icon('sun'),
        ),
        h('div', { class: 'qp-notifs-head' },
            h('span', null, 'Notifications'),
            notes.length ? h('button', { class: 'link-btn', onClick: () => Notifications.clear() }, 'Clear all') : null,
        ),
        h('div', { class: 'qp-notifs' },
            notes.length
                ? notes.map((n) => notificationCard(n, { dismissible: true }))
                : h('div', { class: 'qp-empty' }, icon('bell'), h('span', null, "You're all caught up")),
        ),
    );
}

export const Panel = {
    init() {
        el = document.getElementById('panel');
        document.getElementById('panel-scrim').addEventListener('pointerdown', () => Panel.close());
        const rerender = () => { if (state.overlay === 'panel') render(); };
        on('notifications', rerender);
        on('settings', (changed) => { if (!changed.includes('brightness')) rerender(); });
    },

    open() {
        if (state.locked || !state.awake) return;
        Shell.closeOverlays();
        render();
        setState({ overlay: 'panel' });
    },

    close() {
        if (state.overlay === 'panel') setState({ overlay: null });
    },

    toggle() {
        if (state.overlay === 'panel') Panel.close();
        else Panel.open();
    },
};
