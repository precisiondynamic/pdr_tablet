// Modal alert dialog (libadwaita AdwAlertDialog). One at a time; Escape / backdrop = cancel.

import { h, fill } from './util.js';

let layer = null;
let current = null;   // resolve fn of the open dialog

function close(result) {
    if (!current) return;
    const resolve = current;
    current = null;
    layer.classList.remove('is-open');
    resolve(result);
}

export const Dialog = {
    init() {
        layer = document.getElementById('dialog');
        layer.addEventListener('pointerdown', (e) => { if (e.target === layer) close(false); });
        document.addEventListener('keydown', (e) => {
            if (!current) return;
            if (e.key === 'Escape') close(false);
        });
    },

    isOpen() { return !!current; },

    /**
     * @param {{ title: string, body?: string, confirm?: string, cancel?: string, destructive?: boolean }} opts
     * @returns {Promise<boolean>}
     */
    confirm({ title, body, confirm = 'OK', cancel = 'Cancel', destructive = false }) {
        close(false);
        return new Promise((resolve) => {
            current = resolve;
            const ok = h('button', { class: `dialog-btn ${destructive ? 'is-destructive' : 'is-suggested'}`, onClick: () => close(true) }, confirm);
            fill(layer, h('div', { class: 'dialog', role: 'alertdialog' },
                h('div', { class: 'dialog-title' }, title),
                body ? h('div', { class: 'dialog-body' }, body) : null,
                h('div', { class: 'dialog-buttons' },
                    h('button', { class: 'dialog-btn', onClick: () => close(false) }, cancel),
                    ok),
            ));
            layer.classList.add('is-open');
            ok.focus({ preventScroll: true });
        });
    },

    /** Closes any open dialog as cancelled (e.g. the tablet was put away). */
    dismiss() { close(false); },
};
