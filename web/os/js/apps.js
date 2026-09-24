// App registry + app host.
//
// Lifecycle:  registered → launched → ready (SDK handshake) → foreground ⇄ background → closed
// Every transition is reported to the integration as `app:lifecycle` and to the app page as
// SDK events (`show` / `hide`).

import { Bridge } from './bridge.js';
import { log } from './log.js';
import { state, settings, on, emit, setState, publicSettings } from './store.js';
import { AppStorage } from './storage.js';
import { appTile, icon } from './icons.js';
import { h } from './util.js';

const TAG = 1;
const ANIM_MS = 260;

// Hard limits. Everything an app or the host sends is bounded (see docs/HARDENING.md).
export const LIMITS = {
    maxApps: 200,
    maxInflight: 16,              // concurrent requests per app that reach the integration
    maxQueuedRequests: 64,        // waiting behind those; beyond this requests fail fast
    maxRequestBytes: 256 * 1024,  // JSON size of request data
    maxQueuedMessages: 200,       // host → app messages held until the app's SDK is ready
    notifyBurst: 10,              // notifications an app may send at once…
    notifyRefillMs: 2000,         // …then one per this many ms
    maxErrorsPerMinute: 10,       // app errors written to the journal
};

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const COLOR_RE = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([0-9.,%\s/deg]+\)|[a-z]{3,20})$/i;

/** Only http(s)/nui pages (or paths relative to the OS). Never javascript:, data:, blob:, about:. */
function safeAppUrl(raw) {
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 2048) return null;
    let u;
    try { u = new URL(raw.trim(), location.href); } catch { return null; }
    return ['http:', 'https:', 'nui:'].includes(u.protocol) ? u.href : null;
}

const registry = new Map();   // id → app descriptor
const running = new Map();    // id → runtime record
let foreground = null;        // id of the foreground app (may be suspended while locked/asleep)
let suspended = true;         // true while the screen is off or the lock screen is up
let pendingLaunch = null;     // launch requested while suspended, performed on resume
let layer = null;

function normalize(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('app must be an object');
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    if (!id) throw new Error('app.id is required');
    if (!ID_RE.test(id)) throw new Error(`app id "${id.slice(0, 80)}" is invalid (letters, digits and . _ : - only, max 64)`);
    const url = input.system ? null : safeAppUrl(input.url);
    if (!input.system && !url) throw new Error(`app "${id}" needs an http(s):// or nui:// url`);
    const label = String(input.label ?? id).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40) || id;
    return {
        id,
        label,
        icon: typeof input.icon === 'string' && input.icon.length <= 64 * 1024 ? input.icon : null,
        color: typeof input.color === 'string' && COLOR_RE.test(input.color.trim()) ? input.color.trim() : null,
        url,
        order: Number.isFinite(Number(input.order)) ? Number(input.order) : 100,
        hidden: !!input.hidden,
        keepAlive: input.keepAlive !== false,
        badge: Math.max(0, parseInt(input.badge, 10) || 0),
        system: !!input.system,
        bundled: !!input.bundled,
        systemIcon: input.system ? input.systemIcon ?? null : null,
        render: input.system ? input.render ?? null : null,
    };
}

function sortApps(a, b) {
    return a.order - b.order || a.label.localeCompare(b.label);
}

function lifecycle(id, appState, extra) {
    log.debug('apps', `${id}: ${appState}`);
    Bridge.emit('app:lifecycle', { id, state: appState, ...extra });
    emit('lifecycle', id, appState);
}

function post(r, type, payload = {}) {
    if (!r.iframe?.contentWindow) return;
    r.iframe.contentWindow.postMessage({ __pdrTablet: TAG, type, ...payload }, '*');
}

/** Queue until the app's SDK has said hello, then deliver in order. */
function deliver(r, type, payload) {
    if (r.app.system) return;
    if (!r.ready) {
        // show/hide are covered by `visible` in the init message
        if (type === 'show' || type === 'hide') return;
        if (r.queue.length >= LIMITS.maxQueuedMessages) {
            r.queue.shift();
            if (!r.queueWarned) { r.queueWarned = true; log.warn('apps', `${r.app.id}: not ready, dropping oldest queued messages`); }
        }
        r.queue.push([type, payload]);
        return;
    }
    post(r, type, payload);
}

function isVisible(id) {
    return foreground === id && !suspended && state.view === 'app';
}

function headerbar(app) {
    return h('header', { class: 'headerbar' },
        h('div', { class: 'hb-start' },
            h('button', { class: 'hb-btn', title: 'Home', onClick: () => Apps.home() }, icon('home')),
        ),
        h('div', { class: 'hb-title' }, appTile(app, 'tile-xxs'), h('span', { class: 'hb-label' }, app.label)),
        h('div', { class: 'hb-end' },
            h('button', { class: 'hb-btn hb-close', title: 'Close', onClick: () => Apps.close(app.id) }, icon('close')),
        ),
    );
}

function spawn(app, launchData) {
    const body = h('div', { class: 'app-body' });
    const frame = h('section', { class: 'app-frame', 'data-app': app.id }, headerbar(app), body);
    const r = {
        app, frame, body, iframe: null, ctl: null, ready: false, queue: [], lastUsed: Date.now(), launchData,
        inflight: 0, requests: [],                                   // request limiter
        tokens: LIMITS.notifyBurst, tokensAt: Date.now(),            // notification rate limit
        errors: 0, errorsAt: Date.now(),                             // error-report rate limit
        sdk: 0, editable: false, lastPong: 0,                        // heartbeat + input focus
    };

    if (app.system) {
        r.ctl = app.render?.(body, { home: () => Apps.home(), close: () => Apps.close(app.id) }) || {};
        r.ready = true;
        if (launchData != null) r.ctl.launch?.(launchData);
    } else {
        const loader = h('div', { class: 'app-loader' }, h('span', { class: 'spinner' }));
        const iframe = h('iframe', { src: app.url, title: app.label });
        // Apps served from the OS's own origin (bundled apps) get an opaque origin so they can't
        // reach into the OS page. Apps from other resources keep their own origin.
        const sameOrigin = new URL(app.url, location.href).origin === location.origin;
        iframe.setAttribute('sandbox', sameOrigin ? 'allow-scripts allow-forms' : 'allow-scripts allow-same-origin allow-forms');
        iframe.addEventListener('load', () => loader.remove(), { once: true });
        body.append(iframe, loader);
        r.iframe = iframe;
        r.readyTimer = setTimeout(() => {
            if (!r.ready && running.get(app.id) === r) log.warn('apps', `${app.id}: no SDK handshake after 10 s (messages and requests are unavailable)`);
        }, 10000);
    }

    layer.append(frame);
    running.set(app.id, r);
    log.info('apps', `Started ${app.id}`);
    lifecycle(app.id, 'launched', { data: launchData ?? null });
    return r;
}

function show(r, origin) {
    const box = layer.getBoundingClientRect();
    r.frame.style.transformOrigin = origin
        ? `${origin.x - box.left}px ${origin.y - box.top}px`
        : '50% 50%';
    r.frame.classList.add('is-visible');
    // two frames so the transition runs from the hidden state
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (foreground === r.app.id) r.frame.classList.add('is-foreground');
    }));
}

function hide(r) {
    r.frame.classList.remove('is-foreground');
    setTimeout(() => {
        if (!isVisible(r.app.id)) r.frame.classList.remove('is-visible');
    }, ANIM_MS);
}

function toBackground(r) {
    hide(r);
    deliver(r, 'hide');
    r.ctl?.hide?.();
    lifecycle(r.app.id, 'background');
    if (!r.app.keepAlive) {
        setTimeout(() => { if (foreground !== r.app.id) Apps.close(r.app.id); }, ANIM_MS);
    }
}

function evictBackgroundApps() {
    const bg = [...running.values()]
        .filter((r) => r.app.id !== foreground)
        .sort((a, b) => a.lastUsed - b.lastUsed);
    while (bg.length > state.maxBackgroundApps) {
        const r = bg.shift();
        log.info('apps', `Evicting ${r.app.id} (background limit ${state.maxBackgroundApps})`);
        Apps.close(r.app.id);
    }
}

/** One request to the integration. Always settles: answer, transport error or OS timeout. */
function startRequest(r, msg) {
    const id = r.app.id;
    r.inflight++;
    let settled = false;
    const finish = (payload) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        r.inflight--;
        // the app may have been closed (or restarted) meanwhile: then the answer is dropped
        if (running.get(id) === r) post(r, 'response', { rid: msg.rid, ...payload });
        while (r.inflight < LIMITS.maxInflight && r.requests.length) startRequest(r, r.requests.shift());
    };
    const timer = setTimeout(() => {
        log.warn('apps', `${id} request ${msg.action} timed out after ${state.requestTimeout} ms (the integration never answered)`);
        finish({ ok: false, error: 'Request timed out' });
    }, state.requestTimeout);

    log.debug('apps', `${id} → request ${msg.action}`);
    Bridge.call('app:request', { id, action: msg.action, data: msg.data ?? null })
        .then((res) => {
            // Integration may answer `{ ok, data }` / `{ ok: false, error }`, or just the data.
            if (res && typeof res === 'object' && typeof res.ok === 'boolean') {
                finish(res.ok
                    ? { ok: true, data: res.data ?? null }
                    : { ok: false, error: String(res.error ?? 'Request failed').slice(0, 500) });
            } else {
                finish({ ok: true, data: res ?? null });
            }
        })
        .catch((err) => {
            log.warn('apps', `${id} request ${msg.action} failed: ${err?.message}`);
            finish({ ok: false, error: err?.message || 'Request failed' });
        });
}

function takeToken(r) {
    const now = Date.now();
    r.tokens = Math.min(LIMITS.notifyBurst, r.tokens + (now - r.tokensAt) / LIMITS.notifyRefillMs);
    r.tokensAt = now;
    if (r.tokens < 1) return false;
    r.tokens -= 1;
    return true;
}

function handleAppMessage(r, msg) {
    const id = r.app.id;
    switch (msg.type) {
        case 'hello': {
            r.ready = true;
            r.sdk = parseInt(msg.sdk, 10) || 1;
            r.lastPong = Date.now();
            r.editable = false;
            clearTimeout(r.readyTimer);
            post(r, 'init', {
                appId: id,
                launchData: r.launchData ?? null,
                settings: publicSettings(),
                os: { name: state.osName, version: state.version },
                visible: isVisible(id),
            });
            for (const [type, payload] of r.queue.splice(0)) post(r, type, payload);
            lifecycle(id, 'ready');
            break;
        }
        case 'request': {
            if (typeof msg.action !== 'string' || !msg.action || msg.action.length > 128) {
                post(r, 'response', { rid: msg.rid, ok: false, error: 'action must be a string of 1–128 characters' });
                break;
            }
            let size = 0;
            try { size = JSON.stringify(msg.data ?? null).length; } catch { size = Infinity; }
            if (size > LIMITS.maxRequestBytes) {
                log.warn('apps', `${id} request ${msg.action} rejected: ${Math.round(size / 1024)} KB payload`);
                post(r, 'response', { rid: msg.rid, ok: false, error: `Request too large (max ${LIMITS.maxRequestBytes / 1024} KB)` });
                break;
            }
            if (r.inflight >= LIMITS.maxInflight) {
                if (r.requests.length >= LIMITS.maxQueuedRequests) {
                    post(r, 'response', { rid: msg.rid, ok: false, error: 'Too many pending requests' });
                    break;
                }
                r.requests.push(msg);
                break;
            }
            startRequest(r, msg);
            break;
        }
        case 'home':
            if (foreground === id) Apps.home();
            break;
        case 'close':
            Apps.close(id);
            break;
        case 'launch':
            // only the app on screen may switch apps; a background app can't steal focus
            if (!isVisible(id)) log.warn('apps', `${id} tried to launch "${String(msg.id).slice(0, 64)}" from the background (blocked)`);
            else if (typeof msg.id === 'string' && registry.has(msg.id)) Apps.launch(msg.id, msg.data);
            else log.warn('apps', `${id} tried to launch unknown app "${String(msg.id).slice(0, 64)}"`);
            break;
        case 'notify':
            if (!takeToken(r)) {
                if (!r.notifyWarned || Date.now() - r.notifyWarned > 10000) {
                    r.notifyWarned = Date.now();
                    log.warn('notify', `${id} is sending notifications too fast; dropping some`);
                }
                break;
            }
            emit('app:notify', { appId: id, title: msg.title, body: msg.body, data: msg.data });
            break;
        case 'error': {
            // uncaught errors inside the app page, reported by the SDK
            const now = Date.now();
            if (now - r.errorsAt > 60000) { r.errors = 0; r.errorsAt = now; }
            if (++r.errors <= LIMITS.maxErrorsPerMinute) {
                const where = msg.source ? ` (${String(msg.source).split('/').pop().slice(0, 80)}:${parseInt(msg.line, 10) || 0})` : '';
                log.error(id, `App error: ${String(msg.message ?? 'unknown').slice(0, 300)}${where}`);
            }
            break;
        }
        case 'pong':
            r.lastPong = Date.now();
            emit('app:pong', id);
            break;
        case 'focus':
            r.editable = !!msg.editable;
            emit('input-focus');
            break;
        case 'storage': {
            let reply;
            try {
                reply = { ok: true, data: AppStorage.op(id, msg.op, msg.key, msg.value) };
            } catch (err) {
                log.warn('storage', `${id} ${msg.op} failed: ${err.message}`);
                reply = { ok: false, error: err.message };
            }
            post(r, 'response', { rid: msg.rid, ...reply });
            break;
        }
        case 'badge':
            Apps.setBadge(id, msg.count);
            break;
        default:
            break;
    }
}

export const Apps = {
    init() {
        layer = document.getElementById('apps');

        window.addEventListener('message', (event) => {
            const msg = event.data;
            if (!msg || typeof msg !== 'object' || msg.__pdrTablet !== TAG) return;
            // identify the sender by its window, never by anything it claims about itself
            for (const r of running.values()) {
                if (r.iframe && r.iframe.contentWindow === event.source) {
                    handleAppMessage(r, msg);
                    return;
                }
            }
        });

        on('settings', (changed) => {
            if (!changed.some((k) => ['theme', 'accent', 'clock24h'].includes(k))) return;
            for (const r of running.values()) if (r.ready) post(r, 'settings', { settings: publicSettings() });
        });
    },

    /* ---------- registry ---------- */

    register(input, { system = false, bundled = false } = {}) {
        const app = normalize({ ...input, system, bundled });
        const prev = registry.get(app.id);
        if (prev?.system && !system) throw new Error(`"${app.id}" is a system app id`);
        if (!prev && registry.size >= LIMITS.maxApps) throw new Error(`app limit reached (${LIMITS.maxApps}); "${app.id}" not registered`);
        registry.set(app.id, app);

        const r = running.get(app.id);
        if (r) {
            if (prev && prev.url !== app.url) {
                log.info('apps', `${app.id}: entry URL changed, restarting`);
                Apps.close(app.id);
            } else {
                r.app = app;
                r.frame.querySelector('.hb-label').textContent = app.label;
            }
        }
        log.info('apps', `${prev ? 'Updated' : 'Registered'} ${app.id}${app.hidden ? ' (hidden)' : ''}`);
        emit('apps');
        return app;
    },

    update(id, patch) {
        const cur = registry.get(id);
        if (!cur) return log.warn('apps', `update: unknown app "${id}"`);
        if (cur.system || !patch || typeof patch !== 'object') return;
        Apps.register({ ...cur, ...patch, id }, { bundled: cur.bundled });
    },

    unregister(id) {
        const app = registry.get(id);
        if (!app || app.system) return;
        Apps.close(id);
        registry.delete(id);
        log.info('apps', `Unregistered ${id}`);
        emit('apps');
        emit('app:removed', id);
    },

    /**
     * Make the registry match `list` exactly: apps that are still listed keep running,
     * apps that disappeared are closed and removed.
     */
    setAll(list) {
        const incoming = new Map();
        for (const item of Array.isArray(list) ? list : []) {
            try {
                const app = normalize({ ...item, system: false });
                incoming.set(app.id, item);
            } catch (err) {
                log.error('apps', `Rejected app: ${err.message}`);
            }
        }
        for (const [id, app] of registry) {
            // bundled apps are managed by bundled.js, not by the integration's list
            if (!app.system && !app.bundled && !incoming.has(id)) Apps.unregister(id);
        }
        for (const item of incoming.values()) {
            try { Apps.register(item); } catch (err) { log.error('apps', err.message); }
        }
        emit('apps');
    },

    get(id) { return registry.get(id) ?? null; },

    list({ includeHidden = false, includeSystem = true } = {}) {
        return [...registry.values()]
            .filter((a) => (includeHidden || !a.hidden) && (includeSystem || !a.system))
            .sort(sortApps);
    },

    setBadge(id, count) {
        const app = registry.get(id);
        if (!app) return;
        const next = Math.max(0, parseInt(count, 10) || 0);
        if (app.badge === next) return;
        app.badge = next;
        emit('apps');
    },

    /* ---------- runtime ---------- */

    get foreground() { return foreground; },
    isRunning(id) { return running.has(id); },
    running() {
        return [...running.values()].sort((a, b) => b.lastUsed - a.lastUsed).map((r) => r.app);
    },

    /**
     * @param {string} id
     * @param {*} [data]        launch data passed to the app (SDK `launch` event / init.launchData)
     * @param {{x:number,y:number}} [origin]  screen point the open animation grows from
     */
    launch(id, data, origin) {
        const app = registry.get(id);
        if (!app) {
            log.warn('apps', `launch: unknown app "${id}"`);
            return;
        }
        if (suspended) {
            pendingLaunch = { id, data };
            log.debug('apps', `${id}: launch deferred until unlock`);
            return;
        }

        const prev = foreground ? running.get(foreground) : null;
        let r = running.get(id);
        if (!r) r = spawn(app, data);
        else if (data !== undefined) {
            r.launchData = data;
            if (r.app.system) r.ctl.launch?.(data);
            // not ready yet: the init message will carry the latest launch data exactly once
            else if (r.ready) post(r, 'launch', { data });
        }

        const wasVisible = isVisible(id);
        if (prev && prev !== r) toBackground(prev);
        foreground = id;
        r.lastUsed = Date.now();
        setState({ view: 'app' });

        if (!wasVisible) {
            show(r, origin);
            deliver(r, 'show');
            r.ctl?.show?.();
            lifecycle(id, 'foreground');
        }
        evictBackgroundApps();
        emit('running');
    },

    home() {
        const r = foreground ? running.get(foreground) : null;
        foreground = null;
        setState({ view: 'home' });
        if (r) {
            if (suspended) hide(r);      // already told the app it's hidden
            else toBackground(r);
        }
        emit('running');
    },

    close(id) {
        const r = running.get(id);
        if (!r) return;
        running.delete(id);
        clearTimeout(r.readyTimer);
        r.requests.length = 0;     // queued requests die with the app; in-flight answers are dropped
        if (foreground === id) {
            foreground = null;
            setState({ view: 'home' });
        }
        r.frame.classList.remove('is-foreground');
        r.ctl?.destroy?.();
        setTimeout(() => r.frame.remove(), ANIM_MS);
        log.info('apps', `Stopped ${id}`);
        lifecycle(id, 'closed');
        emit('running');
    },

    closeAll() {
        for (const id of [...running.keys()]) Apps.close(id);
    },

    /** Send an integration message to an app page (SDK `message` event). */
    message(id, event, data) {
        const r = running.get(id);
        if (!r) return log.debug('apps', `message "${event}" dropped: ${id} is not running`);
        deliver(r, 'message', { event: String(event), data: data ?? null });
    },

    /** Screen off / lock screen up: the foreground app is hidden but stays foreground. */
    suspend() {
        if (suspended) return;
        suspended = true;
        const r = foreground ? running.get(foreground) : null;
        if (r) {
            deliver(r, 'hide');
            r.ctl?.hide?.();
            lifecycle(r.app.id, 'background');
        }
    },

    resume() {
        if (!suspended) return;
        suspended = false;
        const r = foreground ? running.get(foreground) : null;
        if (r) {
            deliver(r, 'show');
            r.ctl?.show?.();
            lifecycle(r.app.id, 'foreground');
        }
        if (pendingLaunch) {
            const { id, data } = pendingLaunch;
            pendingLaunch = null;
            Apps.launch(id, data);
        }
    },

    /** Relay a keystroke from the integration into whatever has focus. */
    routeKey(key) {
        const r = foreground && state.view === 'app' && !state.overlay ? running.get(foreground) : null;
        if (r?.iframe) {
            if (r.ready) post(r, 'key', { key });
            return;
        }
        window.PDRTablet?.injectKey(key);
    },

    routeText(text) {
        const r = foreground && state.view === 'app' && !state.overlay ? running.get(foreground) : null;
        if (r?.iframe) {
            if (r.ready) post(r, 'text', { text });
            return;
        }
        window.PDRTablet?.insertText(text);
    },

    isMuted(id) { return settings.mutedApps.includes(id); },

    /* ---------- used by the watchdog ---------- */

    /** Runtime record of the app on screen (awake, unlocked, no overlay), else null. */
    visibleRecord() {
        return foreground && isVisible(foreground) && !state.overlay ? running.get(foreground) || null : null;
    },
    foregroundRecord() { return foreground ? running.get(foreground) || null : null; },
    ping(r) { post(r, 'ping', {}); },
    get suspended() { return suspended; },

    /** Everything back to a clean slate (character switch). */
    resetRuntime() {
        pendingLaunch = null;
        Apps.closeAll();
        for (const app of registry.values()) app.badge = 0;
        emit('apps');
    },
};
