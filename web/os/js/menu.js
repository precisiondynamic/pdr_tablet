// App context menu (right click / long press), GNOME popover-menu style.

import { Apps } from './apps.js';
import { settings, updateSettings } from './store.js';
import { h, fill } from './util.js';

let el = null;
let scrim = null;

function item(label, onClick, cls = '') {
    return h('button', {
        class: `menu-item ${cls}`,
        onClick: (e) => { e.stopPropagation(); Menu.close(); onClick(); },
    }, label);
}

export const Menu = {
    init() {
        el = document.getElementById('menu');
        scrim = document.getElementById('menu-scrim');
        scrim.addEventListener('pointerdown', () => Menu.close());
    },

    isOpen() { return el.classList.contains('is-open'); },

    forApp(app, anchor) {
        const pinned = settings.dock.includes(app.id);
        const running = Apps.isRunning(app.id);
        const center = () => {
            const r = anchor.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        };
        fill(el,
            item(running ? 'Show' : 'Open', () => Apps.launch(app.id, undefined, center())),
            h('div', { class: 'menu-sep' }),
            item(pinned ? 'Unpin from Dash' : 'Pin to Dash', () => updateSettings({
                dock: pinned ? settings.dock.filter((id) => id !== app.id) : [...settings.dock, app.id],
            })),
            app.system ? null : item('App Details', () => Apps.launch('system.settings', { section: 'apps' })),
            running ? h('div', { class: 'menu-sep' }) : null,
            running ? item('Quit', () => Apps.close(app.id), 'is-destructive') : null,
        );
        Menu.openAt(anchor);
    },

    openAt(anchor) {
        const device = document.getElementById('device').getBoundingClientRect();
        const a = anchor.getBoundingClientRect();
        el.classList.add('is-open');
        const m = el.getBoundingClientRect();

        let left = a.left + a.width / 2 - m.width / 2 - device.left;
        left = Math.max(12, Math.min(left, device.width - m.width - 12));
        // below the anchor if it fits, otherwise above
        let top = a.bottom + 8 - device.top;
        if (top + m.height > device.height - 12) top = a.top - m.height - 8 - device.top;

        el.style.left = `${left}px`;
        el.style.top = `${Math.max(12, top)}px`;
        scrim.classList.add('is-open');
    },

    close() {
        el?.classList.remove('is-open');
        scrim?.classList.remove('is-open');
    },
};
