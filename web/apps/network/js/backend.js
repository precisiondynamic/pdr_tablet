/*
 * NETWORK backends. Both expose the same async API (see ../CONTRACT.md):
 *
 *   hello()                    → { backend: 'network', version, coin, player }
 *   state()                    → State
 *   call(action, data)         → State            every mutation answers with the new state
 *   on(fn)                     → fn(event, data)  server pushes: 'update' {state?}, 'signal' {strength}
 *
 * LiveBackend  forwards to the resource that registered the app (pdr_criminal) with
 *              tablet.request('network:<action>').  Pushes arrive as apps:message events.
 * DemoBackend  a self-contained stand-in world (js/demo.js), used with ?demo=1 or outside the
 *              tablet. It never runs in a live session by accident: a real session that gets
 *              no answer shows NETWORK UNAVAILABLE instead.
 */
(function (global) {
    'use strict';

    function Fail(message) { var e = new Error(message); e.user = true; return e; }

    function LiveBackend(T) {
        var listeners = [];
        var emit = function (ev, data) { listeners.forEach(function (fn) { fn(ev, data); }); };
        T.on('message:network:update', function (d) { emit('update', d && typeof d === 'object' ? d : {}); });
        T.on('message:network:signal', function (d) { if (d && typeof d.strength === 'number') emit('signal', d); });
        T.on('message:network:notice', function (d) { if (d && typeof d.text === 'string') emit('notice', d); });
        var req = function (action, data, timeout) {
            return T.request('network:' + action, data == null ? null : data, { timeout: timeout || 8000 }).then(function (res) {
                if (!res || typeof res !== 'object') throw new Error('Malformed response');
                if (res.error) throw Fail(String(res.error));
                return res;
            });
        };
        return {
            mode: 'live',
            hello: function () {
                return req('hello', { version: 1 }, 4000).then(function (res) {
                    if (res.backend !== 'network') throw new Error('No NETWORK service');
                    return res;
                });
            },
            state: function () { return req('state'); },
            call: function (action, data) { return req(action, data); },
            on: function (fn) { listeners.push(fn); },
        };
    }

    function DemoBackend(T) {
        var world = global.NET.DemoWorld(T);
        var latency = function (v) { return new Promise(function (r) { setTimeout(function () { r(v); }, 60 + Math.random() * 90); }); };
        return {
            mode: 'demo',
            world: world,
            hello: function () { return latency(world.hello()); },
            state: function () { return latency(world.state()); },
            call: function (action, data) {
                try { return latency(world.call(action, data || {})); } catch (e) { return Promise.reject(e); }
            },
            on: function (fn) { world.on(fn); },
        };
    }

    function connect(T) {
        var demo = /[?&]demo=1\b/.test(location.search) || !T.inTablet;
        return demo ? DemoBackend(T) : LiveBackend(T);
    }

    global.NET = global.NET || {};
    global.NET.Backend = { connect: connect, Fail: Fail };
})(window);
