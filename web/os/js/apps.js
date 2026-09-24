// App registry + app host.
//
// Lifecycle:  registered → launched → ready (SDK handshake) → foreground ⇄ background → closed
// Every transition is reported to the integration as `app:lifecycle` and to the app page as
// SDK events (`show` / `hide`).

import { Bridge } from './bridge.js';
import { state, settings, on, emit, setState, publicSettings } from './store.js';
import { Notifications } from './notifications.js';
import { h } from './util.js';

const TAG = 1;
const ANIM_MS = 260;

const registry = new Map();   // id → app descriptor
const running = new Map();    // id → runtime record
let foreground = null;        // id of the foreground app (may be suspended while locked/asleep)
let suspended = true;         // true while the screen is off or the lock screen is up
let pendingLaunch = null;     // launch requested while locked, performed after unlock
let layer = null;

function normalize(input) {
    if (!input || typeof input !== 'object') throw new Error('app must be an object');
    const id = String(input.id ?? '').trim();
    if (!id) throw new Error('app.id is required');
    if (!input.system && typeof input.url !== 'string') throw new Error(`app "${id}" needs a url`);
    return {
        id,
        label: String(input.label ?? id).slice(0, 40),
        icon: typeof input.icon === 'string' ? input.icon : null,
        color: typeof input.color === 'string' ? input.color : null,
        url: input.url ?? null,
        order: Number.isFinite(Number(input.order)) ? Number(input.order) : 100,
        hidden: !!input.hidden,
        keepAlive: input.keepAlive !== false,
        badge: Math.max(0, parseInt(input.badge, 10) || 0),
        system: !!input.system,
        systemIcon: input.system ? input.systemIcon ?? null : null,
        render: input.system ? input.render ?? null : null,
    };
}

function sortApps(a, b) {
    return a.order - b.order || a.label.localeCompare(b.label);
}

function lifecycle(id, appState, extra) {
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
        r.queue.push([type, payload]);
        return;
    }
    post(r, type, payload);
}

function isVisible(id) {
    return foreground === id && !suspended && state.view === 'app';
}

function spawn(app, launchData) {
    const frame = h('div', { class: 'app-frame', 'data-app': app.id });
    const r = { app, frame, iframe: null, ctl: null, ready: false, queue: [], lastUsed: Date.now(), launchData };

    if (app.system) {
        r.ctl = app.render?.(frame, {
            home: () => Apps.home(),
            close: () => Apps.close(app.id),
        }) || {};
        r.ready = true;
    } else {
        const loader = h('div', { class: 'app-loader' }, h('span', { class: 'spinner' }));
        const iframe = h('iframe', { src: app.url, title: app.label });
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
        iframe.addEventListener('load', () => loader.remove(), { once: true });
        frame.append(iframe, loader);
        r.iframe = iframe;
    }

    layer.append(frame);
    running.set(app.id, r);
    lifecycle(app.id, 'launched', { data: launchData ?? null });
    return r;
}

function show(r, origin) {
    const box = layer.getBoundingClientRect();
    r.frame.style.transformOrigin = origin
        ? `${origin.x - box.left}px ${origin.y - box.top}px`
        : '50% 50%';
    r.frame.classList.add('is-visible');
    // next frame so the transition runs
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
    while (bg.length > state.maxBackgroundApps) Apps.close(bg.shift().app.id);
}

function handleAppMessage(r, msg) {
    const id = r.app.id;
    switch (msg.type) {
        case 'hello': {
            r.ready = true;
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
            const rid = msg.rid;
            const reply = (payload) => post(r, 'response', { rid, ...payload });
            if (typeof msg.action !== 'string' || !msg.action) {
                reply({ ok: false, error: 'action must be a non-empty string' });
                break;
            }
            Bridge.call('app:request', { id, action: msg.action, data: msg.data ?? null })
                .then((res) => {
                    // Integration may answer `{ ok, data }` / `{ ok: false, error }`, or just the data.
                    if (res && typeof res === 'object' && typeof res.ok === 'boolean') {
                        reply(res.ok
                            ? { ok: true, data: res.data ?? null }
                            : { ok: false, error: String(res.error ?? 'Request failed') });
                    } else {
                        reply({ ok: true, data: res ?? null });
                    }
                })
                .catch((err) => reply({ ok: false, error: err?.message || 'Request failed' }));
            break;
        }
        case 'home':
            if (foreground === id) Apps.home();
            break;
        case 'close':
            Apps.close(id);
            break;
        case 'launch':
            if (typeof msg.id === 'string' && registry.has(msg.id)) Apps.launch(msg.id, msg.data);
            break;
        case 'notify':
            Notifications.push({ appId: id, title: msg.title, body: msg.body });
            break;
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

    register(input, { system = false } = {}) {
        const clean = { ...input, system };
        const app = normalize(clean);
        const prev = registry.get(app.id);
        if (prev?.system && !system) throw new Error(`"${app.id}" is a system app id`);
        registry.set(app.id, app);

        const r = running.get(app.id);
        if (r) {
            if (prev && prev.url !== app.url) Apps.close(app.id);   // entry changed → restart it
            else r.app = app;
        }
        emit('apps');
        return app;
    },

    update(id, patch) {
        const cur = registry.get(id);
        if (!cur || cur.system || !patch || typeof patch !== 'object') return;
        Apps.register({ ...cur, ...patch, id });
    },

    unregister(id) {
        const app = registry.get(id);
        if (!app || app.system) return;
        Apps.close(id);
        registry.delete(id);
        emit('apps');
    },

    /** Replace every non-system app (e.g. after the integration restarts). */
    setAll(list) {
        for (const [id, app] of registry) {
            if (app.system) continue;
            Apps.close(id);
            registry.delete(id);
        }
        for (const app of Array.isArray(list) ? list : []) {
            try { Apps.register(app); } catch (err) { console.error('[pdr_tablet]', err.message); }
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
            console.warn(`[pdr_tablet] launch: unknown app "${id}"`);
            return;
        }
        if (suspended) {
            pendingLaunch = { id, data };
            return;
        }

        const prev = foreground ? running.get(foreground) : null;
        let r = running.get(id);
        if (!r) r = spawn(app, data);
        else if (data !== undefined) {
            r.launchData = data;
            deliver(r, 'launch', { data });
        }

        if (prev && prev !== r) toBackground(prev);
        const wasVisible = isVisible(id);
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
        if (foreground === id) {
            foreground = null;
            setState({ view: 'home' });
        }
        r.frame.classList.remove('is-foreground');
        r.ctl?.destroy?.();
        setTimeout(() => r.frame.remove(), ANIM_MS);
        lifecycle(id, 'closed');
        emit('running');
    },

    closeAll() {
        for (const id of [...running.keys()]) Apps.close(id);
    },

    /** Send an integration message to an app page (SDK `message` event). */
    message(id, event, data) {
        const r = running.get(id);
        if (r) deliver(r, 'message', { event: String(event), data: data ?? null });
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
};
