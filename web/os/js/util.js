/** Tiny DOM builder. Strings become text nodes; `html` is only for trusted internal markup. */
export function h(tag, props, ...children) {
    const el = document.createElement(tag);
    if (props) {
        for (const [key, value] of Object.entries(props)) {
            if (value == null || value === false) continue;
            if (key === 'class') el.className = value;
            else if (key === 'style' && typeof value === 'object') {
                for (const [prop, v] of Object.entries(value)) {
                    if (prop.startsWith('--')) el.style.setProperty(prop, v);
                    else el.style[prop] = v;
                }
            }
            else if (key === 'html') el.innerHTML = value;
            else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
            else if (key in el && typeof value !== 'string') el[key] = value;
            else el.setAttribute(key, value === true ? '' : value);
        }
    }
    for (const child of children.flat(Infinity)) {
        if (child == null || child === false) continue;
        el.append(child instanceof Node ? child : String(child));
    }
    return el;
}

/** replaceChildren that skips null/false and flattens arrays, like h(). */
export function fill(el, ...children) {
    el.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false));
    return el;
}

/** Range input whose track shows the filled portion (CSS var --val). */
export function slider({ min = 0, max = 100, value = 0, onInput, ...rest }) {
    const input = h('input', { type: 'range', min, max, value, ...rest });
    const paint = () => input.style.setProperty('--val', `${((input.value - min) / (max - min)) * 100}%`);
    input.addEventListener('input', (e) => { paint(); onInput?.(e); });
    paint();
    return input;
}

export class Emitter {
    #map = new Map();
    on(event, fn) {
        if (!this.#map.has(event)) this.#map.set(event, new Set());
        this.#map.get(event).add(fn);
        return () => this.#map.get(event)?.delete(fn);
    }
    emit(event, ...args) {
        for (const fn of this.#map.get(event) ?? []) {
            try { fn(...args); } catch (err) { console.error(`[pdr_tablet] listener "${event}"`, err); }
        }
    }
}

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export function timeParts(date, h24) {
    const m = String(date.getMinutes()).padStart(2, '0');
    if (h24) return { hm: `${String(date.getHours()).padStart(2, '0')}:${m}`, suffix: '' };
    const hours = date.getHours() % 12 || 12;
    return { hm: `${hours}:${m}`, suffix: date.getHours() < 12 ? 'AM' : 'PM' };
}

export function formatTime(date, h24) {
    const { hm, suffix } = timeParts(date, h24);
    return suffix ? `${hm} ${suffix}` : hm;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** 'long' → "Thursday 24 September", 'short' → "Thu 24 Sep" (locale-independent, like GNOME Shell). */
export function formatDate(date, style = 'long') {
    const day = DAYS[date.getDay()], month = MONTHS[date.getMonth()];
    return style === 'short'
        ? `${day.slice(0, 3)} ${date.getDate()} ${month.slice(0, 3)}`
        : `${day} ${date.getDate()} ${month}`;
}

export const monthName = (date) => MONTHS[date.getMonth()];
export const dayName = (date) => DAYS[date.getDay()];

export function relativeTime(ts) {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return 'now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * Pointer drag helper. Works with mouse events forwarded into a DUI as well as real input.
 * Callbacks receive (dx, dy, event). onEnd also gets the gesture duration in ms.
 */
export function drag(el, { onStart, onMove, onEnd, threshold = 4 } = {}) {
    el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const sx = e.clientX, sy = e.clientY, t0 = performance.now();
        let active = false;
        const move = (ev) => {
            const dx = ev.clientX - sx, dy = ev.clientY - sy;
            if (!active && Math.hypot(dx, dy) < threshold) return;
            if (!active) {
                active = true;
                onStart?.(ev);
            }
            onMove?.(dx, dy, ev);
        };
        const up = (ev) => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', up);
            onEnd?.(ev.clientX - sx, ev.clientY - sy, ev, performance.now() - t0, active);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
    });
}

/** Long-press (touch-style) → callback. Suppresses the click that follows. */
export function longPress(el, fn, ms = 550) {
    let timer = null, fired = false, sx = 0, sy = 0;
    const cancel = () => { clearTimeout(timer); timer = null; };
    el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        fired = false; sx = e.clientX; sy = e.clientY;
        timer = setTimeout(() => { fired = true; fn(e); }, ms);
    });
    el.addEventListener('pointermove', (e) => {
        if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 8) cancel();
    });
    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointerleave', cancel);
    el.addEventListener('click', (e) => {
        if (fired) { e.stopImmediatePropagation(); e.preventDefault(); fired = false; }
    }, true);
}

export function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}
