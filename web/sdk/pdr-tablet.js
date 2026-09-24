/*!
 * PDR Tablet SDK — include in an app page that runs inside pdr_tablet.
 *
 *   <script src="https://cfx-nui-pdr_tablet/web/sdk/pdr-tablet.js"></script>
 *
 *   const tablet = await PDRTablet.ready();
 *   const profile = await tablet.request('getProfile', { id: 1 });
 *   tablet.on('message', (event, data) => { ... });
 *
 * See docs/APP-SDK.md for the full API.
 */
(function (global) {
    'use strict';

    // loaded twice (two <script> tags, a bundler + a tag…): keep the first instance, or every
    // message would be handled twice
    if (global.PDRTablet && global.PDRTablet.__sdk) return;

    var TAG = 1;
    var SDK_VERSION = 2;          // 2: heartbeat, focus + error reporting
    // the OS page loads this file only for the key helpers and sets __PDR_TABLET_OS__
    var inTablet = global.parent !== global && !global.__PDR_TABLET_OS__;
    var listeners = {};
    var pending = {};
    var rid = 0;
    var ctx = null;
    var readyResolvers = [];

    /* ------------------------------------------------------------------ */
    /* keyboard injection                                                  */
    /* A DUI has no keyboard natives, so the integration relays keys and   */
    /* this code types them into the focused element.                      */
    /* ------------------------------------------------------------------ */

    var TEXT_INPUTS = ['text', 'search', 'email', 'password', 'tel', 'url', 'number', ''];

    function isEditable(el) {
        if (!el || el.disabled || el.readOnly) return false;
        if (el.tagName === 'TEXTAREA') return true;
        if (el.tagName === 'INPUT') return TEXT_INPUTS.indexOf((el.getAttribute('type') || '').toLowerCase()) !== -1;
        return false;
    }

    function fireInput(el, inputType, data) {
        var ev;
        try { ev = new InputEvent('input', { bubbles: true, inputType: inputType, data: data == null ? null : data }); }
        catch (e) { ev = new Event('input', { bubbles: true }); }
        el.dispatchEvent(ev);
    }

    // Works with frameworks (React etc.) that track the value through the native setter.
    function setValue(el, value) {
        var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        var desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(el, value); else el.value = value;
    }

    function selection(el) {
        var start = null, end = null;
        try { start = el.selectionStart; end = el.selectionEnd; } catch (e) { /* number/email inputs */ }
        if (start == null) { start = end = el.value.length; }
        return { start: start, end: end, supported: (function () { try { return el.selectionStart != null; } catch (e) { return false; } })() };
    }

    function replaceRange(el, text, start, end, inputType) {
        var sel = selection(el);
        var maxLen = el.maxLength > 0 ? el.maxLength : Infinity;
        var value = el.value;
        var next = value.slice(0, start) + text + value.slice(end);
        if (next.length > maxLen) return;
        setValue(el, next);
        if (sel.supported) {
            var caret = start + text.length;
            try { el.setSelectionRange(caret, caret); } catch (e) { /* ignore */ }
        }
        fireInput(el, inputType, text || null);
    }

    function insertText(text, doc) {
        doc = doc || global.document;
        var el = doc.activeElement;
        if (!isEditable(el) || typeof text !== 'string' || !text) return;
        if (el.tagName === 'INPUT') text = text.replace(/[\r\n]+/g, ' ');
        var sel = selection(el);
        replaceRange(el, text, sel.start, sel.end, 'insertText');
    }

    function moveCaret(el, pos) {
        try { el.setSelectionRange(pos, pos); } catch (e) { /* ignore */ }
    }

    function injectKey(k, doc) {
        doc = doc || global.document;
        if (!k || typeof k.key !== 'string') return;
        var el = doc.activeElement;
        var target = el && el !== doc.body ? el : doc.body || doc.documentElement;
        var init = {
            key: k.key, code: k.code || '', bubbles: true, cancelable: true,
            ctrlKey: !!k.ctrlKey, shiftKey: !!k.shiftKey, altKey: !!k.altKey, metaKey: !!k.metaKey,
        };

        if (k.type === 'keyup') {
            target.dispatchEvent(new KeyboardEvent('keyup', init));
            return;
        }
        // the page may handle the key itself and preventDefault
        if (!target.dispatchEvent(new KeyboardEvent('keydown', init))) return;

        if (!isEditable(el)) {
            if (k.key === 'Enter' && el && (el.tagName === 'BUTTON' || el.tagName === 'A')) el.click();
            return;
        }

        var sel = selection(el);
        var len = el.value.length;

        if (init.ctrlKey || init.metaKey) {
            if (k.key.toLowerCase() === 'a') { try { el.select(); } catch (e) { /* ignore */ } }
            return;
        }

        switch (k.key) {
            case 'Backspace':
                if (sel.start !== sel.end) replaceRange(el, '', sel.start, sel.end, 'deleteContentBackward');
                else if (sel.start > 0) replaceRange(el, '', sel.start - 1, sel.start, 'deleteContentBackward');
                break;
            case 'Delete':
                if (sel.start !== sel.end) replaceRange(el, '', sel.start, sel.end, 'deleteContentForward');
                else if (sel.start < len) replaceRange(el, '', sel.start, sel.start + 1, 'deleteContentForward');
                break;
            case 'ArrowLeft': moveCaret(el, sel.start === sel.end ? Math.max(0, sel.start - 1) : sel.start); break;
            case 'ArrowRight': moveCaret(el, sel.start === sel.end ? Math.min(len, sel.end + 1) : sel.end); break;
            case 'Home': moveCaret(el, 0); break;
            case 'End': moveCaret(el, len); break;
            case 'Enter':
                if (el.tagName === 'TEXTAREA') replaceRange(el, '\n', sel.start, sel.end, 'insertLineBreak');
                else if (el.form) {
                    if (typeof el.form.requestSubmit === 'function') el.form.requestSubmit();
                    else el.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                }
                break;
            default:
                if (k.key.length === 1) replaceRange(el, k.key, sel.start, sel.end, 'insertText');
        }
    }

    /* ------------------------------------------------------------------ */
    /* messaging                                                           */
    /* ------------------------------------------------------------------ */

    /** Returns false (and warns) instead of throwing when the payload can't be sent. */
    function post(type, payload, strict) {
        if (!inTablet) return false;
        var msg = { __pdrTablet: TAG, type: type };
        if (payload) for (var k in payload) if (Object.prototype.hasOwnProperty.call(payload, k)) msg[k] = payload[k];
        try {
            global.parent.postMessage(msg, '*');
            return true;
        } catch (e) {
            if (strict) throw e;
            console.warn('[PDRTablet] ' + type + ' could not be sent: ' + e.message);
            return false;
        }
    }

    function fire(event) {
        var args = Array.prototype.slice.call(arguments, 1);
        var list = (listeners[event] || []).slice();
        for (var i = 0; i < list.length; i++) {
            try { list[i].apply(null, args); } catch (e) { console.error('[PDRTablet] "' + event + '" listener failed', e); }
        }
    }

    /** Round-trip to the tablet: resolves with `data`, rejects with the tablet's error. */
    function call(type, payload, options, label) {
        if (!inTablet) return Promise.reject(new Error('Not running inside pdr_tablet'));
        var timeout = (options && options.timeout) || 15000;
        return new Promise(function (resolve, reject) {
            var id = ++rid;
            pending[id] = {
                resolve: resolve,
                reject: reject,
                timer: setTimeout(function () {
                    if (!pending[id]) return;
                    delete pending[id];
                    reject(new Error(label + ' timed out'));
                }, timeout),
            };
            var msg = { rid: id };
            for (var k in payload) if (Object.prototype.hasOwnProperty.call(payload, k)) msg[k] = payload[k];
            try {
                post(type, msg, true);
            } catch (e) {
                clearTimeout(pending[id].timer);
                delete pending[id];
                reject(new Error(label + ': ' + (e.name === 'DataCloneError' ? 'data must be JSON-serialisable' : e.message)));
            }
        });
    }

    function setVisibleAttr(v) {
        var root = global.document && global.document.documentElement;
        if (root) root.setAttribute('data-tablet-visible', v ? 'true' : 'false');
    }

    function applyTheme() {
        var root = global.document && global.document.documentElement;
        if (!root || !ctx) return;
        root.setAttribute('data-tablet-theme', ctx.settings.theme);
        root.style.setProperty('--tablet-accent', ctx.settings.accent);
    }

    function resolveReady() {
        var list = readyResolvers.splice(0);
        for (var i = 0; i < list.length; i++) list[i](api);
    }

    if (inTablet) {
        global.addEventListener('message', function (e) {
            if (e.source !== global.parent) return;
            var m = e.data;
            if (!m || m.__pdrTablet !== TAG) return;

            switch (m.type) {
                case 'init':
                    ctx = {
                        appId: m.appId,
                        launchData: m.launchData,
                        settings: m.settings || {},
                        os: m.os || {},
                        visible: !!m.visible,
                    };
                    applyTheme();
                    setVisibleAttr(ctx.visible);
                    resolveReady();
                    fire('ready', api);
                    if (ctx.visible) fire('show');
                    break;
                case 'launch':
                    if (ctx) ctx.launchData = m.data;
                    fire('launch', m.data);
                    break;
                case 'show':
                    if (ctx) ctx.visible = true;
                    setVisibleAttr(true);
                    fire('show');
                    break;
                case 'hide':
                    if (ctx) ctx.visible = false;
                    setVisibleAttr(false);
                    fire('hide');
                    break;
                case 'ping':
                    // heartbeat: answered from the event loop, so a hung page stops answering
                    if (!api.__debug.noPong) post('pong');
                    break;
                case 'message':
                    fire('message', m.event, m.data);
                    fire('message:' + m.event, m.data);
                    break;
                case 'settings':
                    if (ctx) ctx.settings = m.settings || {};
                    applyTheme();
                    fire('settings', m.settings);
                    break;
                case 'response': {
                    var p = pending[m.rid];
                    if (!p) break;
                    delete pending[m.rid];
                    clearTimeout(p.timer);
                    if (m.ok) p.resolve(m.data); else p.reject(new Error(m.error || 'Request failed'));
                    break;
                }
                case 'key':
                    injectKey(m.key);
                    break;
                case 'text':
                    insertText(m.text);
                    break;
            }
        });
    }

    var api = {
        /** true when running inside the tablet (false when the page is opened on its own) */
        get inTablet() { return inTablet; },
        get appId() { return ctx ? ctx.appId : null; },
        get launchData() { return ctx ? ctx.launchData : null; },
        get settings() { return ctx ? ctx.settings : { theme: 'dark', accent: '#3b82f6', clock24h: true }; },
        get os() { return ctx ? ctx.os : null; },
        get visible() { return ctx ? ctx.visible : !inTablet; },

        /**
         * Resolves once the tablet has initialised the app. Outside the tablet it resolves
         * immediately so the page can be developed standalone.
         */
        ready: function () {
            if (!inTablet || ctx) return Promise.resolve(api);
            return new Promise(function (resolve) { readyResolvers.push(resolve); });
        },

        /**
         * Ask the Lua side of your resource for something. Routed by pdr_tablet to the
         * onRequest handler of the resource that registered this app.
         */
        request: function (action, data, options) {
            return call('request', { action: action, data: data === undefined ? null : data }, options, 'Request "' + action + '"');
        },

        /**
         * Per-app key/value storage kept by the tablet (and persisted by the integration).
         * Values must be JSON-serialisable; each app has a 512 KB quota.
         */
        storage: {
            get: function (key) { return call('storage', { op: 'get', key: key }, null, 'storage.get'); },
            set: function (key, value) { return call('storage', { op: 'set', key: key, value: value }, null, 'storage.set'); },
            remove: function (key) { return call('storage', { op: 'remove', key: key }, null, 'storage.remove'); },
            keys: function () { return call('storage', { op: 'keys' }, null, 'storage.keys'); },
            clear: function () { return call('storage', { op: 'clear' }, null, 'storage.clear'); },
        },

        /** Subscribe: ready | show | hide | launch | settings | message | message:<event>. Returns an unsubscribe fn. */
        on: function (event, fn) {
            (listeners[event] = listeners[event] || []).push(fn);
            return function () { api.off(event, fn); };
        },
        off: function (event, fn) {
            var list = listeners[event];
            if (!list) return;
            var i = list.indexOf(fn);
            if (i !== -1) list.splice(i, 1);
        },
        once: function (event, fn) {
            var off = api.on(event, function () { off(); fn.apply(null, arguments); });
            return off;
        },

        /** Go to the home screen (the app keeps running in the background). */
        home: function () { post('home'); },
        /** Close this app. */
        close: function () { post('close'); },
        /** Open another installed app, optionally with launch data. */
        launch: function (appId, data) { post('launch', { id: appId, data: data }); },
        /**
         * Show a notification from this app. `data` is handed back as launch data when the user
         * taps it (a deep link): notify({ title, body, data: { thread: 4 } }).
         */
        notify: function (title, body, data) {
            if (title && typeof title === 'object') { data = title.data; body = title.body; title = title.title; }
            post('notify', { title: title, body: body, data: data });
        },
        /** Badge count on this app's icon (0 clears it). */
        setBadge: function (count) { post('badge', { count: count }); },

        // used by the OS itself for its own inputs
        injectKey: injectKey,
        insertText: insertText,

        __sdk: SDK_VERSION,
        __debug: { noPong: false },   // tests: simulate a hung app
    };

    global.PDRTablet = api;

    if (inTablet) {
        // tell the tablet when a text field gains/loses focus, so the integration only
        // captures the keyboard while someone is actually typing
        var lastEditable = null;
        var reportFocus = function () {
            setTimeout(function () {
                var ed = isEditable(global.document.activeElement);
                if (ed !== lastEditable) { lastEditable = ed; post('focus', { editable: ed }); }
            }, 0);
        };
        global.addEventListener('focusin', reportFocus, true);
        global.addEventListener('focusout', reportFocus, true);

        // uncaught errors land in the tablet's System Log (rate limited on both ends)
        var reported = 0;
        var reportError = function (message, source, line) {
            if (++reported > 20) return;
            post('error', { message: String(message || 'Error').slice(0, 300), source: source ? String(source).slice(0, 200) : '', line: line || 0 });
        };
        global.addEventListener('error', function (e) { reportError(e.message, e.filename, e.lineno); });
        global.addEventListener('unhandledrejection', function (e) {
            var r = e.reason;
            reportError('Unhandled rejection: ' + (r && r.message ? r.message : String(r)));
        });

        // announce ourselves; the tablet answers with `init`
        post('hello', { sdk: SDK_VERSION });
    }
})(window);
