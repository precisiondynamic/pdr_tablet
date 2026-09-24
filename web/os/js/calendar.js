// Message tray (GNOME date menu): notifications on the left, calendar on the right.

import { log } from './log.js';
import { Notifications, notificationCard } from './notifications.js';
import { Shell } from './shell.js';
import { state, settings, on, updateSettings } from './store.js';
import { icon } from './icons.js';
import { h, fill, dayName, monthName } from './util.js';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];   // indexed by Date#getDay()
let el = null;
let viewMonth = null;   // Date set to the 1st of the month being shown

function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function monthGrid() {
    const today = new Date();
    const first = new Date(viewMonth);
    const startDay = settings.weekStart === 'sunday' ? 0 : 1;
    const offset = (first.getDay() - startDay + 7) % 7;
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);

    const cells = [];
    for (let i = 0; i < 7; i++) cells.push(h('span', { class: 'cal-wd' }, WEEKDAYS[(startDay + i) % 7]));
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
                h('div', { class: 'cal-weekday' }, dayName(now)),
                h('div', { class: 'cal-date' }, `${now.getDate()} ${monthName(now)} ${now.getFullYear()}`),
            ),
            h('div', { class: 'cal-card' },
                h('div', { class: 'cal-nav' },
                    h('button', { class: 'hb-btn', title: 'Previous month', onClick: () => shiftMonth(-1) }, icon('chevronLeft')),
                    h('button', {
                        class: 'cal-month',
                        title: 'Back to today',
                        onClick: () => { viewMonth = new Date(now.getFullYear(), now.getMonth(), 1); render(); },
                    }, viewMonth.getFullYear() === now.getFullYear()
                        ? monthName(viewMonth)
                        : `${monthName(viewMonth)} ${viewMonth.getFullYear()}`),
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
        on('settings', (changed) => { if (changed.some((k) => k === 'dnd' || k === 'weekStart')) rerender(); });
        document.addEventListener('pdr:minute', rerender);   // relative times + date rollover
        log.ok('shell', 'Started Message Tray.');
    },
};
