/* PDR app kit — small helpers shared by the bundled apps (classic script → window.Kit).
   Not part of the SDK: third-party apps are free to use any framework they like. */
(function (global) {
    'use strict';

    /** DOM builder: h('div', { class, onClick, style }, ...children). Strings become text. */
    function h(tag, props) {
        var el = document.createElement(tag);
        if (props) {
            for (var key in props) {
                var v = props[key];
                if (v == null || v === false) continue;
                if (key === 'class') el.className = v;
                else if (key === 'style' && typeof v === 'object') {
                    for (var p in v) { if (p.indexOf('--') === 0) el.style.setProperty(p, v[p]); else el.style[p] = v[p]; }
                } else if (key === 'html') el.innerHTML = v;
                else if (key.indexOf('on') === 0 && typeof v === 'function') el.addEventListener(key.slice(2).toLowerCase(), v);
                else if (key in el && typeof v !== 'string') el[key] = v;
                else el.setAttribute(key, v === true ? '' : v);
            }
        }
        append(el, Array.prototype.slice.call(arguments, 2));
        return el;
    }

    function append(el, children) {
        for (var i = 0; i < children.length; i++) {
            var c = children[i];
            if (c == null || c === false) continue;
            if (Array.isArray(c)) append(el, c);
            else el.append(c instanceof Node ? c : String(c));
        }
    }

    function fill(el) {
        el.replaceChildren();
        append(el, Array.prototype.slice.call(arguments, 1));
        return el;
    }

    // symbolic icons (24×24, stroke), same drawing style as the OS
    var ICONS = {
        plus: '<path d="M12 5v14M5 12h14"/>',
        trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
        search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
        pin: '<path d="M9 4h6l-1 6 3 3v2H7v-2l3-3z"/><path d="M12 15v5"/>',
        back: '<path d="M14.5 6l-6 6 6 6"/>',
        forward: '<path d="M9.5 6l6 6-6 6"/>',
        send: '<path d="M4 12l16-8-6 16-2.5-6.5z"/><path d="M11.5 13.5L20 4"/>',
        check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
        checkAll: '<path d="M2.5 12.5l4.5 4.5L16.5 7.5M11 16l1 1L21.5 7.5"/>',
        note: '<path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4M9 12h6M9 15.5h6"/>',
        chat: '<path d="M4.5 5.5h15v10h-9l-4.5 3.5v-3.5h-1.5z"/>',
        backspace: '<path d="M9 5.5h11v13H9l-6-6.5z"/><path d="M12.5 9.5l5 5M17.5 9.5l-5 5"/>',
        star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>',
        wallet: '<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 9.5h18M16 14h2"/>',
        chart: '<path d="M4 19.5h16M6 16l4-5 3 3 5-7"/>',
        list: '<path d="M8.5 6.5h11M8.5 12h11M8.5 17.5h11"/><circle cx="4.8" cy="6.5" r=".6" fill="currentColor"/><circle cx="4.8" cy="12" r=".6" fill="currentColor"/><circle cx="4.8" cy="17.5" r=".6" fill="currentColor"/>',
        arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
        arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
        swap: '<path d="M7 4.5L3.5 8 7 11.5M3.5 8h13M17 12.5l3.5 3.5-3.5 3.5M20.5 16h-13"/>',
        bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
        info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.2"/>',
        close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
        copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
        qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2M18 14h2M14 18v2h2M18 18h2v2"/>',
        bank: '<path d="M3.5 9.5L12 4l8.5 5.5M5 10v7M9.5 10v7M14.5 10v7M19 10v7M3.5 20h17"/>',
        refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
        more: '<circle cx="6" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18" cy="12" r="1.2" fill="currentColor"/>',
        shield: '<path d="M12 3.5l7 3v5.5c0 4.5-3 7.5-7 8.5-4-1-7-4-7-8.5V6.5z"/>',
        clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    };

    function icon(name, cls) {
        return h('span', {
            class: 'icon ' + (cls || ''),
            html: ICONS[name]
                ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + '</svg>'
                : '',
        });
    }

    var toastLayer = null;
    /** AdwToast. `action` = { label, onClick }. */
    function toast(message, action, ms) {
        if (!toastLayer) { toastLayer = h('div', { class: 'kit-toasts' }); document.body.append(toastLayer); }
        var el = h('div', { class: 'kit-toast' + (action ? ' has-action' : '') }, h('span', null, message));
        var remove = function () {
            if (el.classList.contains('is-leaving')) return;
            el.classList.add('is-leaving');
            setTimeout(function () { el.remove(); }, 200);
        };
        if (action) el.append(h('button', { onClick: function () { action.onClick(); remove(); } }, action.label));
        while (toastLayer.children.length >= 2) toastLayer.firstElementChild.remove();
        toastLayer.append(el);
        setTimeout(remove, ms || 3200);
        return remove;
    }

    /** AdwAlertDialog → Promise<boolean>. */
    function confirm(opts) {
        return new Promise(function (resolve) {
            var layer;
            var done = function (v) { layer.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
            var onKey = function (e) { if (e.key === 'Escape') done(false); };
            layer = h('div', { class: 'kit-dialog-layer', onPointerdown: function (e) { if (e.target === layer) done(false); } },
                h('div', { class: 'kit-dialog', role: 'alertdialog' },
                    h('div', { class: 'kit-dialog-title' }, opts.title),
                    opts.body ? h('div', { class: 'kit-dialog-body' }, opts.body) : null,
                    h('div', { class: 'kit-dialog-buttons' },
                        h('button', { class: 'btn', onClick: function () { done(false); } }, opts.cancel || 'Cancel'),
                        h('button', { class: 'btn ' + (opts.destructive ? 'btn-destructive-fill' : 'btn-suggested'), onClick: function () { done(true); } }, opts.confirm || 'OK'))));
            document.addEventListener('keydown', onKey);
            document.body.append(layer);
        });
    }

    function relTime(ts) {
        var s = Math.floor((Date.now() - ts) / 1000);
        if (s < 45) return 'now';
        if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' min ago';
        if (s < 86400) return Math.round(s / 3600) + ' h ago';
        if (s < 86400 * 7) return Math.round(s / 86400) + ' d ago';
        var d = new Date(ts);
        return d.getDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
    }

    function clock(ts, h24) {
        var d = new Date(ts);
        var m = String(d.getMinutes()).padStart(2, '0');
        if (h24 !== false) return String(d.getHours()).padStart(2, '0') + ':' + m;
        return (d.getHours() % 12 || 12) + ':' + m + (d.getHours() < 12 ? ' AM' : ' PM');
    }

    function debounce(fn, ms) {
        var t = null;
        var wrapped = function () {
            var args = arguments;
            clearTimeout(t);
            t = setTimeout(function () { t = null; fn.apply(null, args); }, ms);
        };
        wrapped.flush = function () { if (t) { clearTimeout(t); t = null; fn(); } };
        return wrapped;
    }

    global.Kit = { h: h, fill: fill, icon: icon, toast: toast, confirm: confirm, relTime: relTime, clock: clock, debounce: debounce };
})(window);
