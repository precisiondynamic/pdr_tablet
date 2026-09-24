// Message tray (GNOME date menu): notifications on the left, calendar on the right.

import { log } from './log.js';
import { Notifications, notificationCard } from './notifications.js';
import { Shell } from './shell.js';
import { state, settings, on, updateSettings } from './store.js';
import { icon } from './icons.js';
import { h, fill } from './util.js';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];   // ISO weeks start on Monday
let el = null;
let viewMonth = null;   // Date set to the 1st of the month being shown

function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function monthGrid() {
    const today = new Date();
    const first = new Date(viewMonth);
    const offset = (first.getDay() + 6) % 7;   // Monday = 0
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);

    const cells = WEEKDAYS.map((d) => h('span', { class: 'cal-wd' }, d));
    for (let i = 0; i < 42; i++) {
        const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        const cls = ['cal-day'];
        if (day.getMonth() !== first.getMonth()) cls.push('is-other');
        if (sameDay(day, today)) cls.push('is-today');
        cells.push(h('span', { class: cls.join(' ') }, String(day.getDate())));
    }
    return h('div', { class: 'cal-grid' }, cells);
}

function shiftMonth(delta) {
    viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + delta, 1);
    render();
}

function render() {
    const now = new Date();
    const notes = Notifications.all();

    fill(el,
        h('section', { class: 'tray-notifs' },
            h('div', { class: 'tray-list' },
                notes.length
                    ? notes.map((n) => notificationCard(n, { dismissible: true }))
                    : h('div', { class: 'status-page status-page-sm' },
                        icon('bell', 'status-icon'),
                        h('div', { class: 'status-title' }, 'No Notifications'))),
            h('div', { class: 'tray-footer' },
                h('label', { class: 'tray-dnd' },
                    h('span', null, 'Do Not Disturb'),
                    h('button', {
                        class: `switch ${settings.dnd ? 'is-on' : ''}`,
                        role: 'switch',
                        'aria-checked': String(settings.dnd),
                        onClick: () => updateSettings({ dnd: !settings.dnd }),
                    }, h('span'))),
                h('button', { class: 'btn btn-flat', disabled: !notes.length, onClick: () => Notifications.clear() }, 'Clear'),
            ),
        ),
        h('section', { class: 'tray-cal' },
            h('div', { class: 'cal-today' },
                h('div', { class: 'cal-weekday' }, now.toLocaleDateString('en-GB', { weekday: 'long' })),
                h('div', { class: 'cal-date' }, now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })),
            ),
            h('div', { class: 'cal-card' },
                h('div', { class: 'cal-nav' },
                    h('button', { class: 'hb-btn', title: 'Previous month', onClick: () => shiftMonth(-1) }, icon('chevronLeft')),
                    h('span', { class: 'cal-month' }, viewMonth.toLocaleDateString('en-GB', {
                        month: 'long',
                        year: viewMonth.getFullYear() === now.getFullYear() ? undefined : 'numeric',
                    })),
                    h('button', { class: 'hb-btn', title: 'Next month', onClick: () => shiftMonth(1) }, icon('chevronRight')),
                ),
                monthGrid(),
            ),
        ),
    );
}

export const Calendar = {
    init() {
        el = document.getElementById('calendar');
        Shell.registerOverlay('calendar', {
            onOpen: () => {
                const now = new Date();
                viewMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                Notifications.markRead();
                render();
            },
        });
        const rerender = () => { if (state.overlay === 'calendar') render(); };
        on('notifications', rerender);
        on('settings', (changed) => { if (changed.includes('dnd')) rerender(); });
        log.ok('shell', 'Started Message Tray.');
    },
};
