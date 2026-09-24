// System journal. Every module logs here; the boot screen and Settings › System Log read it,
// warnings/errors are forwarded to the integration (`os:log`) so they reach the F8 console.

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const MAX_ENTRIES = 500;
const t0 = performance.now();

const entries = [];
const listeners = new Set();
let seq = 0;
let forward = null;

/**
 * @param {'debug'|'info'|'warn'|'error'} level
 * @param {string} unit      subsystem, e.g. 'apps', 'bridge'
 * @param {string} message
 * @param {'ok'|'failed'|null} status  systemd-style unit status shown on the boot screen
 */
function write(level, unit, message, status = null) {
    const entry = {
        id: ++seq,
        uptime: (performance.now() - t0) / 1000,   // seconds since the page loaded
        time: Date.now(),
        level,
        unit,
        message: String(message),
        status,
    };
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.shift();

    const method = level === 'debug' ? 'debug' : level === 'info' ? 'log' : level;
    console[method](`[pdr_tablet] ${unit}: ${entry.message}`);

    if (forward && LEVELS[level] >= LEVELS.warn) {
        try { forward(entry); } catch { /* never let logging throw */ }
    }
    for (const fn of listeners) {
        try { fn(entry); } catch { /* ignore */ }
    }
    return entry;
}

export const log = {
    debug: (unit, msg) => write('debug', unit, msg),
    info: (unit, msg) => write('info', unit, msg),
    warn: (unit, msg) => write('warn', unit, msg),
    error: (unit, msg) => write('error', unit, msg, 'failed'),
    /** A service/unit came up: `[  OK  ] Started …` on the boot screen. */
    ok: (unit, msg) => write('info', unit, msg, 'ok'),

    entries: () => entries,
    subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
    },
    clear() {
        entries.length = 0;
        write('info', 'journal', 'Journal cleared');
    },
    /** Called once by main.js; kept out of this module to avoid an import cycle with bridge.js. */
    setForwarder(fn) { forward = fn; },
    LEVELS,
};

window.addEventListener('error', (e) => {
    log.error('kernel', `${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`);
});
window.addEventListener('unhandledrejection', (e) => {
    log.error('kernel', `Unhandled rejection: ${e.reason?.message ?? e.reason}`);
});
