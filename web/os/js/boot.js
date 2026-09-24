// Boot screen.
//   verbose – replays the system journal systemd-style: every line is a real entry written
//             while the OS initialised (see log.js), followed by the entries of this boot.
//   splash  – logo + spinner (Plymouth-like).
//   off     – straight to the lock screen.
// Click or any key skips it.

import { log } from './log.js';
import { state } from './store.js';
import { logoMark } from './icons.js';
import { h } from './util.js';

const LINE_MS = 32;          // time per journal line
const MAX_VERBOSE_MS = 3200; // long journals are printed faster to stay under this
const HOLD_MS = 450;         // pause on the final line
const SPLASH_MS = 1600;

let el = null;
let finish = null;

function tag(status, level) {
    if (status === 'ok') return h('span', { class: 'bl-tag' }, '[', h('span', { class: 'bl-ok' }, '  OK  '), '] ');
    if (status === 'failed') return h('span', { class: 'bl-tag' }, '[', h('span', { class: 'bl-failed' }, 'FAILED'), '] ');
    if (level === 'warn') return h('span', { class: 'bl-tag' }, '[', h('span', { class: 'bl-warn' }, ' WARN '), '] ');
    return null;
}

function line(entry) {
    const status = tag(entry.status, entry.level);
    if (status) return h('div', { class: 'bl-line' }, status, entry.message);
    return h('div', { class: `bl-line bl-kernel ${entry.level === 'debug' ? 'bl-debug' : ''}` },
        h('span', { class: 'bl-time' }, `[${entry.uptime.toFixed(6).padStart(12)}] `),
        h('span', { class: 'bl-unit' }, `${entry.unit}: `),
        entry.message);
}

function runVerbose() {
    return new Promise((resolve) => {
        const screen = h('div', { class: 'bootlog' });
        el.replaceChildren(screen);

        const queue = [...log.entries()];
        let printed = 0;
        let doneLogging = false;
        const unsubscribe = log.subscribe((entry) => queue.push(entry));

        // one final unit once the queue has caught up
        const perLine = Math.max(8, Math.min(LINE_MS, MAX_VERBOSE_MS / Math.max(queue.length, 1)));
        const timer = setInterval(() => {
            if (printed < queue.length) {
                // print several lines per tick if we're behind
                const batch = Math.max(1, Math.round(LINE_MS / perLine));
                for (let i = 0; i < batch && printed < queue.length; i++) screen.append(line(queue[printed++]));
                screen.scrollTop = screen.scrollHeight;
                return;
            }
            if (!doneLogging) {
                doneLogging = true;
                log.ok('systemd', 'Reached target Graphical Interface.');
                return;
            }
            end();
        }, perLine);

        const end = () => {
            clearInterval(timer);
            unsubscribe();
            setTimeout(resolve, HOLD_MS);
        };
        finish = () => { clearInterval(timer); unsubscribe(); resolve(); };
    });
}

function runSplash() {
    return new Promise((resolve) => {
        el.replaceChildren(h('div', { class: 'splash' },
            logoMark('splash-logo'),
            h('div', { class: 'splash-name' }, state.osName),
            h('div', { class: 'splash-spinner' }, h('i'), h('i'), h('i')),
        ));
        log.ok('systemd', 'Reached target Graphical Interface.');
        const t = setTimeout(resolve, SPLASH_MS);
        finish = () => { clearTimeout(t); resolve(); };
    });
}

export const Boot = {
    init() {
        el = document.getElementById('boot');
        const skip = () => finish?.();
        el.addEventListener('click', skip);
        document.addEventListener('keydown', () => { if (state.booting) skip(); });
    },

    async run(style) {
        log.info('systemd', `Booting ${state.osName} ${state.version} (${style} boot)`);
        if (style === 'off') {
            log.ok('systemd', 'Reached target Graphical Interface.');
            return;
        }
        el.classList.remove('is-hidden', 'is-leaving');
        await (style === 'splash' ? runSplash() : runVerbose());
        finish = null;
        el.classList.add('is-leaving');
        setTimeout(() => el.classList.add('is-hidden'), 400);
    },

    /** Screen turned off mid-boot. */
    cancel() {
        finish?.();
    },
};
