// Activities overview: every open app as a window preview. Click to switch, × or swipe up to close.

import { Apps } from './apps.js';
import { log } from './log.js';
import { Shell } from './shell.js';
import { state, on } from './store.js';
import { appTile, icon } from './icons.js';
import { h, fill, drag } from './util.js';

let el = null;

function preview(app) {
    const win = h('div', { class: 'ov-window', style: { '--tint': app.color || 'var(--accent)' } },
        h('div', { class: 'ov-titlebar' }, h('span', null, app.label)),
        h('div', { class: 'ov-content' }, appTile(app, 'tile-xl')),
    );
    const item = h('div', { class: `ov-item ${app.id === Apps.foreground ? 'is-current' : ''}`, 'data-app': app.id },
        win,
        h('button', {
            class: 'ov-close',
            title: `Close ${app.label}`,
            onClick: (e) => { e.stopPropagation(); Apps.close(app.id); },
        }, icon('close')),
        h('div', { class: 'ov-caption' }, appTile(app, 'tile-sm ov-caption-icon'), h('span', null, app.label)),
    );

    let dragged = false;
    drag(win, {
        onStart: () => { dragged = true; item.classList.add('is-dragging'); },
        onMove: (dx, dy) => {
            const y = Math.min(0, dy);
            item.style.transform = `translateY(${y}px)`;
            item.style.opacity = String(1 + y / 300);
        },
        onEnd: (dx, dy) => {
            item.classList.remove('is-dragging');
            if (dy < -90) {
                item.classList.add('is-dismissed');
                setTimeout(() => Apps.close(app.id), 180);
            } else {
                item.style.transform = '';
                item.style.opacity = '';
            }
            setTimeout(() => { dragged = false; }, 0);
        },
    });
    win.addEventListener('click', () => {
        if (dragged) return;
        Shell.closeOverlays();
        Apps.launch(app.id);
    });
    return item;
}

function render() {
    const apps = Apps.running();
    fill(el,
        apps.length
            ? h('div', { class: 'ov-windows' }, apps.map(preview))
            : h('div', { class: 'status-page ov-empty' },
                icon('grid', 'status-icon'),
                h('div', { class: 'status-title' }, 'No Open Apps'),
                h('div', { class: 'status-desc' }, 'Apps you open appear here.')),
        apps.length > 1
            ? h('button', { class: 'btn btn-pill ov-close-all', onClick: (e) => { e.stopPropagation(); Apps.closeAll(); } }, 'Close All')
            : null,
    );
}

export const Overview = {
    init() {
        el = document.getElementById('overview');
        Shell.registerOverlay('overview', { onOpen: render });
        // clicking empty space returns to what was showing
        el.addEventListener('click', (e) => {
            if (!e.target.closest('.ov-item, .ov-close-all')) Shell.closeOverlays();
        });
        on('running', () => { if (state.overlay === 'overview') render(); });
        log.ok('shell', 'Started Activities Overview.');
    },
};
