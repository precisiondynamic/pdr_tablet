(function () {
    'use strict';
    var T = PDRTablet;
    var $ = function (id) { return document.getElementById(id); };
    var badge = 0;
    var keyLog = [];

    function stamp() { var d = new Date(); return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0'); }
    function json(v) { try { return JSON.stringify(v, null, 1); } catch (e) { return String(v); } }
    function parse(id) {
        var raw = $(id).value.trim();
        if (!raw) return null;
        try { return JSON.parse(raw); } catch (e) { log('JSON parse error in #' + id + ': ' + e.message, 'err'); throw e; }
    }

    function log(msg, cls) {
        var line = stamp() + '  ' + msg + '\n';
        var el = $('log');
        var span = document.createElement('span');
        if (cls) span.className = cls;
        span.textContent = line;
        el.prepend(span);
        while (el.childNodes.length > 300) el.lastChild.remove();
    }

    function out(id, text, cls) {
        var el = $(id);
        el.textContent = text;
        el.className = cls || '';
    }

    function renderCtx() {
        $('ctx').textContent = json({
            inTablet: T.inTablet,
            appId: T.appId,
            visible: T.visible,
            launchData: T.launchData,
            settings: T.settings,
            os: T.os,
            location: location.href,
            origin: String(location.origin),
            userAgent: navigator.userAgent.replace(/^.*(Chrome\/[\d.]+).*$/, '$1'),
        });
        $('hdr').textContent = (T.appId || 'standalone') + ' · ' + (T.visible ? 'VISIBLE' : 'HIDDEN');
        $('t-theme').textContent = document.documentElement.getAttribute('data-tablet-theme') || '(unset)';
        $('t-accent').textContent = getComputedStyle(document.documentElement).getPropertyValue('--tablet-accent').trim() || '(unset)';
        $('t-clock').textContent = String(T.settings.clock24h);
    }

    /* ---------- lifecycle ---------- */

    ['ready', 'show', 'hide', 'launch', 'settings', 'message'].forEach(function (ev) {
        T.on(ev, function (a, b) {
            log('event ' + ev + (a !== undefined ? ' ' + json(a) : '') + (b !== undefined ? ' ' + json(b) : ''), ev === 'hide' ? 'dim' : 'ok');
            renderCtx();
        });
    });

    /* ---------- notify ---------- */

    function notify() {
        var data = parse('n-data');
        T.notify({ title: $('n-title').value, body: $('n-body').value, data: data });
        log('notify() data=' + json(data));
    }
    $('n-send').onclick = notify;
    $('n-delay').onclick = function () { log('notify in 5s — go home now to test a background notification'); setTimeout(notify, 5000); };
    $('n-spam').onclick = function () { for (var i = 1; i <= 10; i++) T.notify({ title: 'Spam #' + i, body: 'notification ' + i + '/10', data: { n: i } }); log('sent 10 notifications'); };

    /* ---------- badge ---------- */

    function setBadge(n) { badge = Math.max(0, n); T.setBadge(badge); out('b-out', 'badge = ' + badge); log('setBadge(' + badge + ')'); }
    $('b-set').onclick = function () { setBadge(parseInt($('b-count').value, 10) || 0); };
    $('b-inc').onclick = function () { setBadge(badge + 1); };
    $('b-dec').onclick = function () { setBadge(badge - 1); };
    $('b-zero').onclick = function () { setBadge(0); };

    /* ---------- navigation ---------- */

    $('nav-home').onclick = function () { log('home()'); T.home(); };
    $('nav-close').onclick = function () { log('close()'); T.close(); };
    $('nav-bounce').onclick = function () {
        log('home(); relaunching self in 3s (watch hide → show)');
        T.home();
        setTimeout(function () { T.launch(T.appId, { bounced: Date.now() }); }, 3000);
    };
    $('nav-launch').onclick = function () { var d = parse('l-data'); log('launch(' + $('l-app').value + ', ' + json(d) + ')'); T.launch($('l-app').value, d); };
    $('nav-bad').onclick = function () { log('launch("does.not.exist") → OS should log a warning, nothing opens'); T.launch('does.not.exist'); };

    /* ---------- request ---------- */

    function request(action, data, timeout) {
        var t0 = performance.now();
        return T.request(action, data, { timeout: timeout }).then(function (res) {
            return { ok: true, ms: performance.now() - t0, res: res };
        }, function (err) {
            return { ok: false, ms: performance.now() - t0, err: err.message };
        });
    }
    $('r-send').onclick = function () {
        request($('r-action').value, parse('r-data'), parseInt($('r-timeout').value, 10) || 15000).then(function (r) {
            out('r-out', (r.ok ? 'OK ' : 'ERR ') + r.ms.toFixed(1) + 'ms\n' + (r.ok ? json(r.res) : r.err), r.ok ? 'ok' : 'err');
            log('request → ' + (r.ok ? 'ok' : 'error: ' + r.err) + ' in ' + r.ms.toFixed(1) + 'ms', r.ok ? 'ok' : 'err');
        });
    };
    $('r-spam').onclick = function () {
        var t0 = performance.now();
        var jobs = [];
        for (var i = 0; i < 50; i++) jobs.push(request('ping', { i: i }, 15000));
        Promise.all(jobs).then(function (rs) {
            var ok = rs.filter(function (r) { return r.ok; }).length;
            var ms = rs.map(function (r) { return r.ms; }).sort(function (a, b) { return a - b; });
            out('r-out', '50 parallel: ' + ok + ' ok, ' + (50 - ok) + ' failed\nwall ' + (performance.now() - t0).toFixed(1) + 'ms  p50 ' + ms[24].toFixed(1) + 'ms  p99 ' + ms[49].toFixed(1) + 'ms', ok === 50 ? 'ok' : 'err');
        });
    };
    $('r-empty').onclick = function () { request('', null, 5000).then(function (r) { out('r-out', r.ok ? 'UNEXPECTED OK' : 'ERR (expected): ' + r.err, r.ok ? 'err' : 'ok'); }); };
    $('r-timeoutbtn').onclick = function () { request('ping', null, 1).then(function (r) { out('r-out', r.ok ? 'answered within 1ms?!' : 'ERR (expected): ' + r.err, r.ok ? 'err' : 'ok'); }); };

    /* ---------- storage ---------- */

    function store(label, promise, expectError) {
        var t0 = performance.now();
        promise.then(function (v) {
            out('s-out', label + ' → ' + json(v) + '  (' + (performance.now() - t0).toFixed(1) + 'ms)', expectError ? 'err' : 'ok');
        }, function (e) {
            out('s-out', label + ' → ERROR: ' + e.message, expectError ? 'ok' : 'err');
        });
    }
    $('s-get').onclick = function () { store('get', T.storage.get($('s-key').value)); };
    $('s-set').onclick = function () { store('set', T.storage.set($('s-key').value, parse('s-val'))); };
    $('s-remove').onclick = function () { store('remove', T.storage.remove($('s-key').value)); };
    $('s-keys').onclick = function () { store('keys', T.storage.keys()); };
    $('s-clear').onclick = function () { store('clear', T.storage.clear()); };
    $('s-count').onclick = function () {
        store('counter++', T.storage.get('counter').then(function (v) { var n = (v || 0) + 1; return T.storage.set('counter', n).then(function () { return n; }); }));
    };
    $('s-quota').onclick = function () { store('set 600KB', T.storage.set('big', new Array(600 * 1024).join('x')), true); };
    $('s-badkey').onclick = function () { store('set("")', T.storage.set('', 1), true); };
    $('s-fn').onclick = function () { store('set(fn)', T.storage.set('fn', function () {}), true); };

    /* ---------- input relay ---------- */

    function keyed(e) {
        keyLog.unshift(e.type + ' ' + JSON.stringify(e.key) + (e.ctrlKey ? ' +ctrl' : '') + (e.shiftKey ? ' +shift' : '') + (e.isTrusted ? '' : ' (relayed)'));
        keyLog.length = Math.min(keyLog.length, 12);
        out('k-out', keyLog.join('\n'));
    }
    document.addEventListener('keydown', keyed);

    /* ---------- misc ---------- */

    $('log-clear').onclick = function () { $('log').textContent = ''; };
    $('err-throw').onclick = function () { setTimeout(function () { throw new Error('SDK demo: deliberate error'); }); log('threw an Error (visible in the app frame console only)', 'err'); };
    $('err-reject').onclick = function () { Promise.reject(new Error('SDK demo: deliberate rejection')); log('unhandled rejection (app frame only)', 'err'); };

    window.addEventListener('error', function (e) { log('window.onerror: ' + e.message, 'err'); });
    window.addEventListener('unhandledrejection', function (e) { log('unhandledrejection: ' + (e.reason && e.reason.message), 'err'); });

    renderCtx();
    T.ready().then(function () { log('ready() resolved, inTablet=' + T.inTablet, 'ok'); renderCtx(); });
})();
