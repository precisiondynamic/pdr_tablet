// Context menu for app icons (right click / long press).

import { Apps } from './apps.js';
import { settings, updateSettings } from './store.js';
import { icon } from './icons.js';
import { h, fill } from './util.js';

let el = null;
let scrim = null;

function item(label, glyph, onClick, danger = false) {
    return h('button', {
        class: `menu-item ${danger ? 'is-danger' : ''}`,
        onClick: (e) => { e.stopPropagation(); Menu.close(); onClick(); },
    }, icon(glyph), h('span', null, label));
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
        const items = [
            item('Open', 'open', () => {
                const r = anchor.getBoundingClientRect();
                Apps.launch(app.id, undefined, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
            }),
            item(pinned ? 'Remove from dock' : 'Keep in dock', 'pin', () => {
                updateSettings({ dock: pinned ? settings.dock.filter((id) => id !== app.id) : [...settings.dock, app.id] });
            }),
        ];
        if (Apps.isRunning(app.id)) items.push(item('Close app', 'stop', () => Apps.close(app.id), true));

        fill(el, h('div', { class: 'menu-title' }, app.label), ...items);
        Menu.openAt(anchor);
    },

    openAt(anchor) {
        const device = document.getElementById('device').getBoundingClientRect();
        const a = anchor.getBoundingClientRect();
        el.classList.add('is-open');
        const m = el.getBoundingClientRect();

        let left = a.left + a.width / 2 - m.width / 2 - device.left;
        left = Math.max(12, Math.min(left, device.width - m.width - 12));
        // below the icon if it fits, otherwise above
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
