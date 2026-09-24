// App switcher: running apps as cards. Click to switch, swipe up or × to close.

import { Apps } from './apps.js';
import { Shell } from './shell.js';
import { state, on, setState } from './store.js';
import { appTile, icon } from './icons.js';
import { h, fill, drag } from './util.js';

let el = null;

function card(app) {
    const tint = app.color || 'var(--accent)';
    const cardEl = h('div', { class: 'sw-card', style: { '--tint': tint } },
        appTile(app, 'tile-xl'),
        app.id === Apps.foreground ? h('span', { class: 'sw-current' }, 'Current') : null,
    );
    const wrap = h('div', { class: 'sw-item', 'data-app': app.id },
        h('div', { class: 'sw-head' }, appTile(app, 'tile-xs'), h('span', null, app.label)),
        cardEl,
        h('button', {
            class: 'sw-close',
            title: `Close ${app.label}`,
            onClick: (e) => { e.stopPropagation(); Apps.close(app.id); },
        }, icon('close')),
    );

    let dragged = false;
    drag(cardEl, {
        onStart: () => { dragged = true; wrap.classList.add('is-dragging'); },
        onMove: (dx, dy) => {
            const y = Math.min(0, dy);
            wrap.style.transform = `translateY(${y}px)`;
            wrap.style.opacity = String(1 + y / 300);
        },
        onEnd: (dx, dy) => {
            wrap.classList.remove('is-dragging');
            if (dy < -90) {
                wrap.classList.add('is-dismissed');
                setTimeout(() => Apps.close(app.id), 180);
            } else {
                wrap.style.transform = '';
                wrap.style.opacity = '';
            }
            setTimeout(() => { dragged = false; }, 0);
        },
    });
    cardEl.addEventListener('click', () => {
        if (dragged) return;
        Switcher.close();
        Apps.launch(app.id);
    });
    return wrap;
}

function render() {
    const apps = Apps.running();
    fill(el,
        apps.length
            ? h('div', { class: 'sw-track' }, apps.map(card))
            : h('div', { class: 'sw-empty' }, icon('apps'), h('span', null, 'No open apps')),
        apps.length > 1
            ? h('button', { class: 'sw-clear', onClick: (e) => { e.stopPropagation(); Apps.closeAll(); } }, 'Close all')
            : null,
    );
}

export const Switcher = {
    init() {
        el = document.getElementById('switcher');
        // click on empty space → back to whatever was showing
        el.addEventListener('click', (e) => {
            if (e.target === el || e.target.classList.contains('sw-track') || e.target.closest('.sw-empty')) Switcher.close();
        });
        on('running', () => {
            if (state.overlay !== 'switcher') return;
            if (!Apps.running().length) Switcher.close();
            else render();
        });
    },

    open() {
        if (state.locked || !state.awake) return;
        if (state.overlay === 'switcher') return;
        Shell.closeOverlays();
        render();
        setState({ overlay: 'switcher' });
    },

    close() {
        if (state.overlay === 'switcher') setState({ overlay: null });
    },
};
