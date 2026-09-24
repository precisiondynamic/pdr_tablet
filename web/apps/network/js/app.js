(function () {
    'use strict';
    var T = PDRTablet;
    var h = Kit.h, fill = Kit.fill;
    var V = NET.Visuals;

    var backend = null;
    var hello = null;
    var S = null;                       // last state from the server; never edited except by pushes
    var route = { view: 'home', id: null };
    var conn = 'connecting';            // connecting | connected | degraded | offline
    var binds = [], ticks = [], disposers = [];
    var currentSig = null;
    var shownResult = null;             // result id we already routed to automatically
    var confirmedVersion = null;        // lobby split version this player last confirmed
    var splitDraft = null;              // { id: pct } while the lead is editing the split
    var busy = false;

    var app = document.getElementById('app');

    /* ================================================================== */
    /* formatting                                                          */
    /* ================================================================== */

    var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    var h24 = function () { return T.settings.clock24h !== false; };
    function coin() { return (S && S.coin) || (hello && hello.coin) || 'ZNC'; }
    function num(n, dp) { return Number(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }); }
    function amt(n) { if (n == null || !isFinite(n)) return '—'; return num(n, Math.abs(n) < 1 && n !== 0 ? 4 : 2); }
    function money(n) { return coin() + ' ' + amt(n); }
    function payout(p) {
        if (!p) return '—';
        if (p.amount != null) return money(p.amount);
        return coin() + ' ' + amt(p.min) + '–' + amt(p.max);
    }
    function pad(n) { return String(n).padStart(2, '0'); }
    function clock(t) { return Kit.clock(t, h24()); }
    function when(t) {
        if (!t) return '—';
        var d = new Date(t), n = new Date();
        if (d.toDateString() === n.toDateString()) return clock(t);
        var y = new Date(n); y.setDate(n.getDate() - 1);
        if (d.toDateString() === y.toDateString()) return 'YEST.';
        return MONTHS[d.getMonth()] + ' ' + pad(d.getDate());
    }
    function day(t) { var d = new Date(t); return MONTHS[d.getMonth()] + ' ' + pad(d.getDate()); }
    function countdown(ms) {
        if (ms <= 0) return '00:00';
        var s = Math.floor(ms / 1000), hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = s % 60;
        return (hh ? hh + ':' + pad(mm) : pad(mm)) + ':' + pad(ss);
    }
    function ago(t) {
        var s = Math.max(0, Math.round((Date.now() - t) / 1000));
        if (s < 60) return s + ' seconds ago';
        if (s < 3600) return Math.round(s / 60) + ' min ago';
        return clock(t);
    }
    function crewRange(c) { return c.crew.min === c.crew.max ? String(c.crew.max) : c.crew.min + '–' + c.crew.max; }
    function greeting() { var hr = new Date().getHours(); return hr < 5 ? 'Good evening.' : hr < 12 ? 'Good morning.' : hr < 18 ? 'Good afternoon.' : 'Good evening.'; }

    /* ================================================================== */
    /* live bindings: updates change fields in place instead of repainting */
    /* ================================================================== */

    /**
     * A text node whose content follows the state. fn(S) → string | { text, cls, tone }.
     * `key` names the field across repaints: when a push changes the screen's structure (a new
     * phase), fields that also changed still get their highlight instead of silently resetting.
     */
    var carried = {};
    function bound(tag, cls, fn, key) {
        var el = h(tag, { class: cls || '' });
        var b = { el: el, base: cls || '', fn: fn, last: undefined, key: key };
        binds.push(b);
        apply(b, true);
        if (key && carried[key] !== undefined && carried[key] !== b.last) {
            var tone = b.el.className.indexOf('lv-alert') !== -1 ? 'alert' : null;
            setTimeout(function () { flash(el, tone); });
        }
        return el;
    }
    /** Runs fn(S) whenever the value of key(S) changes (non-text updates: bars, maps, lists). */
    function effect(key, fn) {
        var b = { effect: fn, key: key, last: undefined };
        binds.push(b);
        b.last = safe(key);
        return b;
    }
    function safe(fn) { try { return JSON.stringify(fn(S)); } catch (e) { return null; } }
    function apply(b, initial) {
        if (b.effect) {
            var k = safe(b.key);
            if (k !== b.last) { b.last = k; try { b.effect(S); } catch (e) { /* view changing */ } }
            return;
        }
        var v;
        try { v = b.fn(S); } catch (e) { v = '—'; }
        if (v == null || typeof v !== 'object') v = { text: v == null ? '—' : String(v) };
        var key = v.text + '|' + (v.cls || '');
        if (key === b.last) return;
        var changed = b.last !== undefined;
        b.last = key;
        b.el.textContent = v.text;
        b.el.className = b.base + (v.cls ? ' ' + v.cls : '');
        if (changed && !initial && v.flash !== false) flash(b.el, v.tone);
    }
    function flash(el, tone) {
        el.classList.remove('is-changed', 'is-changed-alert');
        void el.offsetWidth;
        el.classList.add(tone === 'alert' ? 'is-changed-alert' : 'is-changed');
        setTimeout(function () { el.classList.remove('is-changed', 'is-changed-alert'); }, 1400);
    }
    function patch() { binds.forEach(function (b) { apply(b, false); }); }
    function tick(fn) { ticks.push(fn); fn(Date.now()); }
    function levelCls(level) { return level ? 'lv-' + level : ''; }

    /* ================================================================== */
    /* building blocks                                                     */
    /* ================================================================== */

    var GLYPHS = {
        home: '<path d="M4 11l8-6.5 8 6.5M6.5 9.5V19h11V9.5"/>',
        contracts: '<rect x="5" y="3.5" width="14" height="17" rx="1"/><path d="M8.5 8h7M8.5 11.5h7M8.5 15h4"/>',
        crew: '<circle cx="9" cy="9" r="3"/><path d="M3.5 19c.5-3.2 2.7-5 5.5-5s5 1.8 5.5 5"/><path d="M15.5 6.2a3 3 0 0 1 0 5.6M17 14.3c1.9.6 3.2 2.2 3.5 4.7"/>',
        operations: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>',
        profile: '<path d="M5 20V6l7-2.5L19 6v14"/><path d="M9 20v-5h6v5M9 10h6"/>',
        arrow: '<path d="M5 12h13M13 7l5 5-5 5"/>',
        back: '<path d="M19 12H6M11 7l-5 5 5 5"/>',
        plus: '<path d="M12 6v12M6 12h12"/>',
        minus: '<path d="M6 12h12"/>',
        close: '<path d="M7 7l10 10M17 7L7 17"/>',
        ext: '<path d="M14 5h5v5M19 5l-8 8M17 14v5H5V7h5"/>',
    };
    function glyph(name) {
        return h('span', { class: 'g', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter">' + (GLYPHS[name] || '') + '</svg>' });
    }
    function tierBadge(t, cls) { return h('span', { class: 'tier tier-' + String(t).toLowerCase() + ' ' + (cls || '') }, t); }
    function label(text, extra) { return h('div', { class: 'lbl' }, text, extra || null); }
    function kv(k, v, cls) { return h('div', { class: 'kv ' + (cls || '') }, h('span', { class: 'k' }, k), typeof v === 'string' || typeof v === 'number' ? h('span', { class: 'v' }, String(v)) : v); }
    function panel(cls) { var kids = Array.prototype.slice.call(arguments, 1); return h('section', { class: 'panel ' + (cls || '') }, kids); }
    function button(text, onClick, cls, g) {
        return h('button', { class: 'btn ' + (cls || ''), onClick: function (e) { if (!this.disabled) onClick(e); } }, h('span', null, text), g ? glyph(g) : null);
    }
    function link(text, onClick, cls) { return h('button', { class: 'link ' + (cls || ''), onClick: onClick }, h('span', null, text), glyph('arrow')); }
    function bar(frac, cls) {
        var el = h('div', { class: 'bar ' + (cls || '') }, h('i', { style: { width: (Math.max(0, Math.min(1, frac)) * 100).toFixed(2) + '%' } }));
        return el;
    }
    function blocks(frac, n) {
        n = n || 20;
        var on = Math.round(Math.max(0, Math.min(1, frac)) * n);
        return '█'.repeat(on) + '░'.repeat(n - on);
    }

    var toastEl = null;
    function toast(text, tone) {
        if (!toastEl) { toastEl = h('div', { class: 'toasts' }); document.body.append(toastEl); }
        var el = h('div', { class: 'toast ' + (tone ? 'is-' + tone : '') }, text);
        while (toastEl.children.length >= 2) toastEl.firstElementChild.remove();
        toastEl.append(el);
        setTimeout(function () { el.classList.add('is-leaving'); setTimeout(function () { el.remove(); }, 180); }, 2600);
    }

    /** Modal sheet. Returns close(). */
    function sheet(title, body, cls) {
        var layer;
        var close = function () { layer.remove(); document.removeEventListener('keydown', onKey); };
        var onKey = function (e) { if (e.key === 'Escape') close(); };
        layer = h('div', { class: 'sheet-layer', onPointerdown: function (e) { if (e.target === layer) close(); } },
            h('div', { class: 'sheet ' + (cls || ''), role: 'dialog' },
                h('div', { class: 'sheet-head' }, h('span', { class: 'lbl' }, title), h('button', { class: 'icon-btn', title: 'Close', onClick: function () { close(); } }, glyph('close'))),
                body));
        document.addEventListener('keydown', onKey);
        document.body.append(layer);
        return close;
    }
    function ask(o) {
        return new Promise(function (resolve) {
            var done = function (v) { close(); resolve(v); };
            var close = sheet(o.title, h('div', { class: 'ask' },
                o.body ? h('p', null, o.body) : null,
                h('div', { class: 'row-end' },
                    button(o.cancel || 'CANCEL', function () { done(false); }, 'btn-ghost'),
                    button(o.confirm || 'CONFIRM', function () { done(true); }, o.danger ? 'btn-danger' : 'btn-primary'))), 'is-narrow');
        });
    }

    /* ================================================================== */
    /* server calls                                                        */
    /* ================================================================== */

    function setConn(c) {
        if (conn === c) return;
        conn = c;
        var el = document.querySelector('.conn');
        if (el) { el.className = 'conn is-' + c; el.lastChild.textContent = CONN[c]; }
    }
    var CONN = { connecting: 'CONNECTING', connected: 'CONNECTED', degraded: 'RECONNECTING', offline: 'OFFLINE' };

    /** Every mutation answers with the new state. User-facing refusals are toasts, not errors. */
    function act(action, data) {
        if (busy) return Promise.resolve(null);
        busy = true;
        document.body.classList.add('is-busy');
        return backend.call(action, data).then(function (s) {
            setConn('connected');
            receive(s);
            return s;
        }, function (err) {
            if (err.user) toast(err.message.toUpperCase(), 'danger');
            else { setConn('degraded'); toast('REQUEST FAILED · ' + String(err.message || '').toUpperCase(), 'danger'); }
            return null;
        }).then(function (r) { busy = false; document.body.classList.remove('is-busy'); return r; });
    }

    function refresh() {
        return backend.state().then(function (s) { setConn('connected'); receive(s); }, function () { setConn('degraded'); });
    }

    function validState(s) { return s && typeof s === 'object' && s.standing && Array.isArray(s.contracts) && Array.isArray(s.history); }

    /** New state from anywhere. Same screen shape → fields update in place; otherwise repaint. */
    function receive(s) {
        if (!validState(s)) return;
        var prev = S;
        S = s;
        noticeLobby(prev, s);
        syncBadge();
        if (!document.getElementById('main')) return;
        // a fresh result takes over once (the player can always close it)
        if (s.result && s.result.id !== shownResult && T.visible && route.view !== 'report') {
            shownResult = s.result.id;
            go('report', s.result.id);
            return;
        }
        // the lead began the operation while this player was looking at the lobby
        if (route.view === 'lobby' && !s.lobby && s.operation) route = { view: 'operation', id: null };
        var sig = viewFor().sig(S);
        if (sig === currentSig) patch(); else render(true);
    }

    function noticeLobby(prev, s) {
        var L = s.lobby, me = s.player && s.player.id;
        if (!L) { confirmedVersion = null; splitDraft = null; return; }
        var mine = L.members.filter(function (m) { return m.id === me; })[0];
        if (mine && mine.state === 'confirmed') confirmedVersion = L.version;
        var P = prev && prev.lobby;
        if (P && P.id === L.id && P.version !== L.version && mine && mine.state === 'pending' && L.owner !== me && T.visible) {
            toast('COMPENSATION UPDATED · CONFIRMATION REQUIRED', 'warn');
        }
    }

    function syncBadge() {
        if (!T.inTablet || !S) return;
        T.setBadge(S.invites.length + (S.result ? 1 : 0) + (S.offer ? 1 : 0));
    }

    /* ================================================================== */
    /* shell + routing                                                     */
    /* ================================================================== */

    var NAV = [['home', 'Home'], ['contracts', 'Contracts'], ['crew', 'Crew'], ['operations', 'Operations'], ['profile', 'Profile']];

    function shell() {
        fill(app,
            h('aside', { class: 'rail' },
                h('div', { class: 'mark' }, h('span', { class: 'mark-glyph', html: MARK }), h('span', { class: 'mark-name' }, 'NETWORK')),
                h('nav', { class: 'nav', id: 'nav' }),
                h('div', { class: 'rail-foot' },
                    bound('div', 'rail-id', function (s) { return s.player ? s.player.tag + ' · ' + s.player.handle.toUpperCase() : '—'; }),
                    h('div', { class: 'rail-sess mono' }, 'SESSION ' + session))),
            h('div', { class: 'stage' },
                h('header', { class: 'top' },
                    h('div', { class: 'crumb', id: 'crumb' }),
                    h('div', { class: 'conn is-' + conn }, h('i'), CONN[conn])),
                h('main', { class: 'main', id: 'main' })));
        binds = [];
    }

    function renderNav() {
        var nav = document.getElementById('nav');
        if (!nav) return;
        var active = NAV_OF[route.view] || route.view;
        fill(nav, NAV.map(function (n) {
            var count = n[0] === 'crew' ? S.invites.length + (S.lobby ? 0 : 0) : n[0] === 'contracts' ? S.contracts.filter(function (c) { return c.fresh; }).length + (S.offer ? 1 : 0) : 0;
            var live = (n[0] === 'operations' && S.operation) || (n[0] === 'crew' && S.lobby);
            return h('button', { class: 'nav-row' + (active === n[0] ? ' is-active' : ''), 'data-nav': n[0], onClick: function () { go(n[0]); } },
                glyph(n[0]), h('span', null, n[1]),
                live ? h('i', { class: 'nav-live' }) : null,
                count ? h('b', { class: 'nav-count' }, String(count)) : null);
        }));
    }
    var NAV_OF = { dossier: 'contracts', lobby: 'crew', operation: 'operations', report: 'operations' };

    function go(view, id) {
        if (view === 'crew' && S && S.lobby) view = 'lobby';
        if (view === 'operations' && S && S.operation) view = 'operation';
        route = { view: view, id: id || null };
        if (view !== 'lobby') splitDraft = null;
        render(false);
        var m = document.getElementById('main'); if (m) m.scrollTop = 0;
    }

    function viewFor() {
        var v = VIEWS[route.view];
        // routes whose subject disappeared fall back to something sensible
        if (route.view === 'lobby' && !S.lobby) return S.operation ? VIEWS.operation : VIEWS.crew;
        if (route.view === 'operation' && !S.operation) return VIEWS.operations;
        if (route.view === 'dossier' && !findContract(route.id)) return VIEWS.contracts;
        if (route.view === 'report' && !findReport(route.id)) return VIEWS.operations;
        return v || VIEWS.home;
    }

    function render(quiet) {
        carried = {};
        if (quiet) binds.forEach(function (b) { if (b.key) carried[b.key] = b.last; });
        disposers.forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } });
        disposers = []; binds = []; ticks = [];
        var v = viewFor();
        var main = document.getElementById('main');
        currentSig = v.sig(S);
        fill(document.getElementById('crumb'), v.crumb ? v.crumb(S) : null);
        var node = v.build(S);
        fill(main, node);
        if (!quiet) { node.classList.add('is-entering'); setTimeout(function () { node.classList.remove('is-entering'); }, 200); }
        renderNav();
    }

    function findContract(id) {
        if (!S || !id) return null;
        if (S.offer && S.offer.id === id) return S.offer;
        return S.contracts.filter(function (c) { return c.id === id; })[0] || (S.lobby && S.lobby.contract.id === id ? S.lobby.contract : null);
    }
    function findReport(id) {
        if (!S || !id) return null;
        if (S.result && S.result.id === id) return S.result;
        var e = S.history.filter(function (x) { return x.report && x.report.id === id; })[0];
        return e ? e.report : null;
    }

    /* ================================================================== */
    /* views                                                               */
    /* ================================================================== */

    var VIEWS = {};

    /* ---------------- 01 home ---------------- */

    VIEWS.home = {
        sig: function (s) { return ['home', !!s.operation && s.operation.id, !!s.lobby && s.lobby.id, !!s.result && s.result.id, s.invites.length, !!s.offer, s.contracts.length, s.history.length].join(); },
        build: function (s) {
            var op = s.operation;
            var available = s.offer
                ? panel('card card-available is-offer', label('AVAILABLE'), h('div', { class: 'big-count' }, h('b', null, '1'), h('span', null, 'PRIVATE OFFER')),
                    h('div', { class: 'card-foot' }, h('span', { class: 'dim' }, 'Source unknown'), link('REVIEW', function () { go('dossier', s.offer.id); })))
                : panel('card card-available', label('AVAILABLE'),
                    h('div', { class: 'big-count' }, bound('b', 'mono', function (s) { return pad(s.contracts.length); }), h('span', null, 'CONTRACTS')),
                    h('div', { class: 'card-foot' },
                        bound('span', 'dim', function (s) { return s.contracts.length ? (s.contracts.some(function (c) { return c.fresh; }) ? 'New work available' : 'Work available') : 'Nothing right now'; }),
                        link('VIEW', function () { go('contracts'); })));

            var rep = panel('card card-rep', label('REPUTATION'), standingBlock(s, true));

            var active = op ? activeCard(s) : s.lobby ? lobbyCard(s) : panel('card card-empty', h('div', { class: 'dim' }, 'No active operation'));

            var invites = s.invites.length ? h('div', { class: 'section' }, label('INVITATIONS'),
                h('div', { class: 'list' }, s.invites.map(inviteRow))) : null;

            var result = s.result ? panel('card card-result is-' + s.result.outcome,
                h('div', { class: 'row-between' },
                    h('div', null, label(s.result.outcome === 'complete' ? 'CONTRACT CLOSED' : 'CONTRACT TERMINATED'), h('div', { class: 'op-code' }, s.result.code)),
                    link('VIEW REPORT', function () { go('report', s.result.id); }))) : null;

            return h('div', { class: 'page page-home' },
                h('div', { class: 'hello' }, h('div', { class: 'lbl' }, 'NETWORK'), h('h1', null, greeting())),
                result,
                op ? h('div', { class: 'section' }, label('ACTIVE OPERATION'), active) : null,
                h('div', { class: 'grid-2' }, available, rep),
                op ? null : h('div', { class: 'section' }, label(s.lobby ? 'CREW ASSEMBLING' : 'ACTIVE OPERATION'), active),
                invites,
                h('div', { class: 'section' }, label('RECENT'), recentList(s.history.slice(0, 4))));
        },
    };

    function activeCard(s) {
        var op = s.operation;
        return h('button', { class: 'panel card card-active', onClick: function () { go('operation'); } },
            h('div', { class: 'row-between' },
                h('div', { class: 'op-head' }, tierBadge(op.contract.tier), h('div', null, h('div', { class: 'op-code' }, op.contract.code), h('div', { class: 'dim mono sm' }, op.contract.id))),
                h('div', { class: 'op-state' }, h('i', { class: 'pulse' }), 'OPERATION ACTIVE')),
            h('div', { class: 'active-body' },
                h('div', null,
                    bound('div', 'lbl', function (s) { return 'PHASE ' + pad(s.operation.phase.n); }),
                    bound('div', 'active-title', function (s) { return s.operation.phase.title; }),
                    bound('div', 'dim', function (s) { return s.operation.objective; })),
                op.ends ? h('div', { class: 'active-timer' }, label('WINDOW'), timerEl(function () { return S.operation && S.operation.ends; })) : null),
            h('div', { class: 'card-foot' }, h('span', { class: 'dim' }, op.role === 'support' ? 'Crew support' : 'Your operation'), h('span', { class: 'link' }, h('span', null, 'OPEN'), glyph('arrow'))));
    }

    function lobbyCard(s) {
        var L = s.lobby;
        var joined = L.members.filter(function (m) { return m.state !== 'invited'; });
        return h('button', { class: 'panel card card-lobby', onClick: function () { go('lobby'); } },
            h('div', { class: 'row-between' },
                h('div', { class: 'op-head' }, tierBadge(L.contract.tier), h('div', null, h('div', { class: 'op-code' }, L.contract.code), h('div', { class: 'dim sm' }, L.role === 'support' ? 'Crew support' : 'Your operation'))),
                bound('span', 'mono', function (s) {
                    if (!s.lobby) return '';
                    var j = s.lobby.members.filter(function (m) { return m.state !== 'invited'; });
                    return j.filter(function (m) { return m.state === 'confirmed'; }).length + ' / ' + j.length + ' CONFIRMED';
                })),
            h('div', { class: 'card-foot' }, h('span', { class: 'dim' }, joined.length + ' / ' + L.max + ' crew'), h('span', { class: 'link' }, h('span', null, 'OPEN LOBBY'), glyph('arrow'))));
    }

    function timerEl(getEnds) {
        var el = h('span', { class: 'timer mono' });
        tick(function (now) {
            var e = getEnds();
            if (!e) { el.textContent = '—'; return; }
            var left = e - now;
            el.textContent = countdown(left);
            el.classList.toggle('is-low', left < 3 * 60000);
        });
        return el;
    }

    function standingBlock(s, compact) {
        var st = s.standing;
        var frac = function (s) { var x = s.standing; return x.next > x.from ? (x.points - x.from) / (x.next - x.from) : 1; };
        var barEl = bar(frac(s), 'bar-access');
        effect(frac, function (s) { barEl.firstChild.style.width = (Math.max(0, Math.min(1, frac(s))) * 100).toFixed(2) + '%'; });
        return h('div', { class: 'standing' + (compact ? ' is-compact' : '') },
            bound('div', 'standing-tier', function (s) { return s.standing.tier; }),
            barEl,
            bound('div', 'mono dim', function (s) { return num(s.standing.points, 0) + ' / ' + num(s.standing.next, 0); }),
            st.xAuth ? h('div', { class: 'x-auth' }, 'X AUTHORIZATION HELD') : null);
    }

    function outcomeCell(o) { return h('span', { class: 'outcome is-' + o }, o === 'complete' ? 'COMPLETED' : 'FAILED'); }

    function recentList(items) {
        if (!items.length) return panel('card card-empty', h('div', { class: 'dim' }, 'No history yet'));
        return h('div', { class: 'table recent' }, items.map(function (e) {
            return h('button', { class: 'trow', onClick: function () { if (e.report) go('report', e.report.id); } },
                tierBadge(e.tier, 'is-sm'), h('span', { class: 'mono code' }, e.code), outcomeCell(e.outcome),
                h('span', { class: 'mono r ' + (e.share ? 'pos' : 'dim') }, e.share ? '+' + money(e.share) : '—'),
                h('span', { class: 'mono r dim' }, when(e.when)));
        }));
    }

    function inviteRow(inv) {
        return h('div', { class: 'invite', 'data-invite': inv.id },
            h('span', { class: 'tagbox' }, inv.from.tag),
            h('div', { class: 'invite-text' }, h('b', null, inv.from.handle + ' invited you to an operation.'), h('span', { class: 'mono dim' }, inv.contract.code + ' · ' + inv.contract.tier)),
            h('div', { class: 'row-end' },
                button('DECLINE', function () { act('decline', { invite: inv.id }); }, 'btn-ghost btn-sm'),
                button('JOIN CREW', function () { act('accept', { invite: inv.id }).then(function (s) { if (s && s.lobby) go('lobby'); }); }, 'btn-primary btn-sm')));
    }

    /* ---------------- 02 contracts ---------------- */

    VIEWS.contracts = {
        sig: function (s) { return ['contracts', !!s.offer, s.contracts.map(function (c) { return c.id + (c.fresh ? '*' : ''); }).join('.'), !!s.lobby, !!s.operation].join(); },
        crumb: function () { return 'CONTRACTS'; },
        build: function (s) {
            if (s.contracts.some(function (c) { return c.fresh; })) setTimeout(function () { backend.call('seen', {}).then(receive, function () {}); }, 1500);
            if (s.offer) {
                return h('div', { class: 'page page-offer' },
                    h('div', { class: 'offer-count mono' }, '1 PRIVATE OFFER'),
                    h('button', { class: 'panel offer-card', onClick: function () { go('dossier', s.offer.id); } },
                        h('div', { class: 'lbl' }, s.offer.source || 'SOURCE UNKNOWN'),
                        h('div', { class: 'offer-x' }, 'X'),
                        h('p', null, 'A private contract has been offered to you.'),
                        h('p', { class: 'dim' }, 'This opportunity will not remain available.'),
                        h('div', { class: 'row-end' }, h('span', { class: 'link' }, h('span', null, 'REVIEW'), glyph('arrow')))));
            }
            return h('div', { class: 'page' },
                h('div', { class: 'page-head' }, h('h2', null, 'Contracts'),
                    bound('span', 'mono dim', function (s) { return pad(s.contracts.length) + ' AVAILABLE'; })),
                s.operation ? h('div', { class: 'notice' }, 'An operation is active. New contracts can be taken once it closes.') : null,
                s.contracts.length
                    ? h('div', { class: 'feed' }, s.contracts.map(contractCard))
                    : panel('card card-empty', h('div', null, 'No contracts right now.'), h('div', { class: 'dim sm' }, 'The network sends work as your standing allows.')));
        },
    };

    function contractCard(c) {
        return h('button', { class: 'panel contract', 'data-contract': c.id, onClick: function () { go('dossier', c.id); } },
            h('div', { class: 'contract-top' }, tierBadge(c.tier), c.fresh ? h('span', { class: 'fresh mono' }, 'NEW') : null,
                h('span', { class: 'mono dim sm' }, c.id)),
            h('div', { class: 'contract-code' }, c.code),
            h('div', { class: 'kvs' }, c.fields.map(function (f) { return kv(f[0], f[1]); })),
            h('div', { class: 'contract-pay mono' }, payout(c.payout)),
            h('div', { class: 'card-foot' }, expiresEl(c), h('span', { class: 'link' }, h('span', null, 'INSPECT'), glyph('arrow'))));
    }

    function expiresEl(c, bare) {
        var el = h('span', { class: bare ? 'v mono' : 'dim mono sm' });
        tick(function (now) { el.textContent = c.expires ? (bare ? '' : 'EXPIRES ') + countdown(c.expires - now) : '—'; });
        return el;
    }

    /* ---------------- 03 dossier ---------------- */

    VIEWS.dossier = {
        sig: function (s) { var c = findContract(route.id); return ['dossier', route.id, !!c, !!s.lobby && s.lobby.contract.id, !!s.operation].join(); },
        crumb: function () { return h('button', { class: 'crumb-back', onClick: function () { go('contracts'); } }, glyph('back'), 'CONTRACTS'); },
        build: function (s) {
            var c = findContract(route.id);
            var X = c.tier === 'X';
            var inLobby = s.lobby && s.lobby.contract.id === c.id;
            var d = c.dossier || {};
            var rows = [kv('CONTRACT', h('span', { class: 'v mono' }, c.id)), kv('CLASS', c.tier), kv('CLIENT', d.client || '—')]
                .concat((d.rows || []).map(function (r) { return kv(r[0], r[1]); }));

            var left = h('div', { class: 'dossier-main' },
                h('div', { class: 'dossier-head' }, tierBadge(c.tier, 'is-lg'), h('div', null, h('div', { class: 'lbl' }, X ? (c.source || 'SOURCE UNKNOWN') : c.tier + '-CLASS CONTRACT'), h('h2', { class: 'op-code is-lg' }, c.code))),
                X ? null : V.photo(c.photo, c.expires - 45 * 60000),
                d.target ? h('div', { class: 'section' }, label('TARGET DESCRIPTION'), h('p', { class: 'prose' }, d.target)) : null,
                h('div', { class: 'section' }, label('DOSSIER'), h('div', { class: 'kvs' }, rows)),
                !X && c.area && c.area.name ? h('div', { class: 'section' }, label('SEARCH AREA', h('span', { class: 'mono dim' }, c.area.name)), h('div', { class: 'map is-sm' }, V.map(c.area))) : null);

            var action;
            if (inLobby) action = button('OPEN CREW LOBBY', function () { go('lobby'); }, 'btn-primary btn-lg', 'arrow');
            else if (s.lobby || s.operation) action = h('div', null, button('ASSEMBLE CREW', function () {}, 'btn-primary btn-lg is-disabled'), h('p', { class: 'dim sm' }, s.operation ? 'Finish the active operation first.' : 'You are already in a crew.'));
            else {
                action = button(X ? 'ACCEPT & ASSEMBLE CREW' : 'ASSEMBLE CREW', function () {
                    var go2 = function () { act('assemble', { contract: c.id }).then(function (s) { if (s && s.lobby) go('lobby'); }); };
                    if (c.warning) ask({ title: 'X / ' + c.code, body: c.warning, confirm: 'ACCEPT', danger: true }).then(function (ok) { if (ok) go2(); });
                    else go2();
                }, 'btn-primary btn-lg', 'arrow');
            }

            var right = h('div', { class: 'dossier-side' },
                panel('side-card',
                    label('COMPENSATION'), h('div', { class: 'pay-big mono' }, payout(c.payout)),
                    h('div', { class: 'kvs' },
                        kv('WINDOW', X ? 'LIMITED' : c.window + ' MIN'),
                        kv('CREW', X ? 'UP TO ' + c.crew.max : crewRange(c)),
                        kv('OFFER EXPIRES', expiresEl(c, true))),
                    c.warning ? h('div', { class: 'warning' }, c.warning) : null,
                    action),
                X ? null : h('p', { class: 'dim sm fine' }, 'Window starts when the operation begins. Details beyond this dossier are not provided.'));

            return h('div', { class: 'page page-dossier' + (X ? ' is-x' : '') }, left, right);
        },
    };

    /* ---------------- 04 crew lobby ---------------- */

    VIEWS.lobby = {
        sig: function (s) {
            var L = s.lobby;
            return ['lobby', L && L.id, L && L.version, L && L.members.map(function (m) { return m.id + m.state; }).join('.'), !!splitDraft].join();
        },
        crumb: function () { return 'CREW'; },
        build: function (s) {
            var L = s.lobby, c = L.contract, me = s.player.id, lead = L.owner === me;
            var joined = L.members.filter(function (m) { return m.state !== 'invited'; });
            var confirmed = joined.filter(function (m) { return m.state === 'confirmed'; });
            var mine = L.members.filter(function (m) { return m.id === me; })[0];
            var updated = mine && mine.state === 'pending' && confirmedVersion != null && confirmedVersion !== L.version;

            var slots = [];
            for (var i = 0; i < L.max; i++) {
                var m = L.members[i];
                if (m) slots.push(memberRow(m, lead && m.id !== me, L));
                else slots.push(h('div', { class: 'member is-empty' }, h('span', { class: 'tagbox' }, '...'), h('span', { class: 'dim' }, 'Empty'),
                    lead ? button('INVITE', function () { invitePicker(); }, 'btn-ghost btn-sm') : h('span')));
            }

            var role = L.role === 'support'
                ? h('div', { class: 'role is-support' }, h('b', null, 'CREW SUPPORT'), h('span', null, c.tier === 'X' ? 'Your own X authorization is not used. You receive your share; no progression.' : 'You receive your share of the compensation.'))
                : h('div', { class: 'role is-lead' }, h('b', null, 'YOUR OPERATION'), h('span', null, L.consumesX ? 'Beginning consumes your X authorization.' : 'You lead this contract and set the split.'));

            var splitBody = splitDraft ? splitEditor(L) : h('div', { class: 'split' },
                joined.map(function (m) {
                    return h('div', { class: 'split-row' }, h('span', null, m.id === me ? m.handle + ' (you)' : m.handle),
                        h('span', { class: 'mono' }, (L.split[m.id] || 0) + '%'), h('span', { class: 'mono r' }, money(L.total * (L.split[m.id] || 0) / 100)));
                }),
                lead ? h('div', { class: 'row-end' }, button('EDIT SPLIT', function () { splitDraft = Object.assign({}, L.split); render(true); }, 'btn-ghost btn-sm')) : null);

            var canBegin = lead && joined.length >= c.crew.min && confirmed.length === joined.length;
            var primary;
            if (lead) primary = button('BEGIN OPERATION', function () {
                var run = function () { act('begin').then(function (s) { if (s && s.operation) go('operation'); }); };
                if (L.consumesX) ask({ title: 'BEGIN X', body: 'This consumes your X authorization. If the operation fails, it is gone.', confirm: 'BEGIN', danger: true }).then(function (ok) { if (ok) run(); });
                else run();
            }, 'btn-primary btn-lg' + (canBegin ? '' : ' is-disabled'));
            else if (mine && mine.state === 'pending') primary = button('CONFIRM SPLIT', function () { act('confirm', { version: L.version }); }, 'btn-primary btn-lg');
            else primary = h('div', { class: 'waiting mono' }, 'WAITING FOR ' + (L.members.filter(function (m) { return m.id === L.owner; })[0] || { handle: 'LEAD' }).handle.toUpperCase());
            if (!canBegin && lead) primary.disabled = true;

            return h('div', { class: 'page page-lobby' },
                h('div', { class: 'lobby-main' },
                    h('div', { class: 'dossier-head' }, tierBadge(c.tier, 'is-lg'), h('div', null, h('div', { class: 'lbl' }, c.tier + '-CLASS CONTRACT'), h('h2', { class: 'op-code is-lg' }, c.code))),
                    role,
                    h('div', { class: 'section' },
                        label('CREW', h('span', { class: 'mono' }, joined.length + ' / ' + L.max)),
                        h('div', { class: 'members' }, slots))),
                h('div', { class: 'lobby-side' },
                    panel('side-card',
                        label('COMPENSATION'), h('div', { class: 'pay-big mono' }, money(L.total)),
                        updated ? h('div', { class: 'updated' }, h('b', null, 'COMPENSATION UPDATED'), h('span', null, 'Confirmation required.')) : null,
                        label('SPLIT'), splitBody,
                        h('div', { class: 'confirmed mono' + (confirmed.length === joined.length ? ' is-all' : '') }, confirmed.length + ' / ' + joined.length + ' CONFIRMED'),
                        primary,
                        h('button', { class: 'link link-quiet', onClick: function () {
                            ask({ title: lead ? 'DISBAND CREW' : 'LEAVE CREW', body: lead ? 'The crew is released and the contract returns to your feed.' : 'You leave this crew.', confirm: lead ? 'DISBAND' : 'LEAVE', danger: true })
                                .then(function (ok) { if (ok) act('leave').then(function (s) { if (s) go('home'); }); });
                        } }, h('span', null, lead ? 'DISBAND CREW' : 'LEAVE CREW')))));
        },
    };

    var STATE_TEXT = { confirmed: 'READY', pending: 'REVIEWING', invited: 'INVITED' };
    function memberRow(m, removable, L) {
        return h('div', { class: 'member is-' + m.state, 'data-member': m.id },
            h('span', { class: 'tagbox' }, m.tag),
            h('span', { class: 'member-name' }, m.handle, m.id === L.owner ? h('span', { class: 'dim sm' }, ' · LEAD') : null),
            h('span', { class: 'member-state mono' }, STATE_TEXT[m.state] || m.state.toUpperCase()),
            removable ? h('button', { class: 'icon-btn', title: 'Remove', onClick: function () { act('uninvite', { player: m.id }); } }, glyph('close')) : h('span'));
    }

    function splitEditor(L) {
        var joined = L.members.filter(function (m) { return m.state !== 'invited'; });
        var sumEl = h('span', { class: 'mono' });
        var propose = button('PROPOSE SPLIT', function () {
            act('split', { split: splitDraft }).then(function (s) { if (s) { splitDraft = null; render(true); toast('SPLIT PROPOSED · CREW MUST RECONFIRM'); } });
        }, 'btn-primary btn-sm');
        var rows = joined.map(function (m) {
            var val = h('span', { class: 'mono split-val' });
            var money_ = h('span', { class: 'mono r dim' });
            var upd = function () { if (!splitDraft) return; val.textContent = splitDraft[m.id] + '%'; money_.textContent = money(L.total * splitDraft[m.id] / 100); total(); };
            var step = function (d) { return function () { if (!splitDraft) return; splitDraft[m.id] = Math.max(0, Math.min(100, (splitDraft[m.id] || 0) + d)); upd(); }; };
            if (splitDraft[m.id] == null) splitDraft[m.id] = 0;
            var row = h('div', { class: 'split-row is-edit' }, h('span', null, m.handle),
                h('span', { class: 'stepper' }, h('button', { class: 'icon-btn', onClick: step(-5) }, glyph('minus')), val, h('button', { class: 'icon-btn', onClick: step(5) }, glyph('plus'))),
                money_);
            setTimeout(upd);
            return row;
        });
        function total() {
            if (!splitDraft) return;
            var sum = joined.reduce(function (a, m) { return a + (splitDraft[m.id] || 0); }, 0);
            sumEl.textContent = 'TOTAL ' + sum + '%';
            sumEl.className = 'mono ' + (sum === 100 ? 'pos' : 'neg');
            propose.disabled = sum !== 100;
            propose.classList.toggle('is-disabled', sum !== 100);
        }
        return h('div', { class: 'split' }, rows,
            h('div', { class: 'row-between' }, sumEl,
                h('div', { class: 'row-end' },
                    button('EVEN', function () { var n = joined.length, b = Math.floor(100 / n); joined.forEach(function (m, i) { splitDraft[m.id] = b + (i < 100 - b * n ? 1 : 0); }); render(true); }, 'btn-ghost btn-sm'),
                    button('CANCEL', function () { splitDraft = null; render(true); }, 'btn-ghost btn-sm'),
                    propose)));
    }

    function invitePicker() {
        var L = S.lobby;
        var inCrew = function (id) { return L.members.some(function (m) { return m.id === id; }); };
        var people = (S.contacts || []).filter(function (p) { return !inCrew(p.id); });
        var input = h('input', { class: 'field mono', type: 'text', placeholder: 'PLAYER ID', autocomplete: 'off', spellcheck: false, maxlength: 32 });
        var close;
        var send = function (id) { close(); act('invite', { player: id }).then(function (s) { if (s) toast('INVITATION SENT'); }); };
        var row = function (p) {
            return h('button', { class: 'pick', onClick: function () { send(p.id); } },
                h('span', { class: 'tagbox' }, p.tag), h('span', { class: 'member-name' }, p.handle),
                h('span', { class: 'dim mono sm' }, p.nearby ? '● NEARBY' : p.last ? 'WORKED ' + when(p.last) : 'CONTACT'));
        };
        var nearby = people.filter(function (p) { return p.nearby; }), known = people.filter(function (p) { return !p.nearby; });
        close = sheet('INVITE TO CREW', h('div', { class: 'picker' },
            nearby.length ? [label('NEARBY'), h('div', { class: 'list' }, nearby.map(row))] : null,
            known.length ? [label('KNOWN CONTACTS'), h('div', { class: 'list' }, known.map(row))] : null,
            !people.length ? h('p', { class: 'dim' }, 'Nobody to invite nearby.') : null,
            label('BY ID'),
            h('div', { class: 'row-inline' }, input, button('INVITE', function () { var v = input.value.trim(); if (v) send(v); }, 'btn-primary btn-sm'))));
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && input.value.trim()) send(input.value.trim()); });
    }

    /* ---------------- 14 crew (nothing assembling) ---------------- */

    VIEWS.crew = {
        sig: function (s) { return ['crew', !!s.lobby, s.invites.map(function (i) { return i.id; }).join('.'), (s.crews || []).length, (s.contacts || []).length].join(); },
        crumb: function () { return 'CREW'; },
        build: function (s) {
            return h('div', { class: 'page' },
                h('div', { class: 'page-head' }, h('h2', null, 'Crew'), h('span', { class: 'dim sm' }, 'Crews form per operation.')),
                h('div', { class: 'section' }, label('INVITATIONS'),
                    s.invites.length ? h('div', { class: 'list' }, s.invites.map(inviteRow)) : panel('card card-empty', h('div', { class: 'dim' }, 'No invitations'))),
                h('div', { class: 'grid-2 is-top' },
                    h('div', { class: 'section' }, label('RECENT CREWS'),
                        (s.crews || []).length ? h('div', { class: 'table is-4' }, s.crews.map(function (c) {
                            return h('div', { class: 'trow is-static' }, tierBadge(c.tier, 'is-sm'), h('span', { class: 'mono code' }, c.code),
                                h('span', { class: 'tags' }, c.members.map(function (m) { return h('span', { class: 'tagbox is-sm' }, m.tag); })),
                                h('span', { class: 'mono r dim' }, when(c.when)));
                        })) : panel('card card-empty', h('div', { class: 'dim' }, 'None yet'))),
                    h('div', { class: 'section' }, label('RECENT PLAYERS'),
                        (s.contacts || []).length ? h('div', { class: 'table is-4' }, s.contacts.map(function (p) {
                            return h('div', { class: 'trow is-static' }, h('span', { class: 'tagbox' }, p.tag), h('span', null, p.handle),
                                h('span', { class: 'mono sm ' + (p.nearby ? 'pos' : 'dim') }, p.nearby ? '● NEARBY' : ''),
                                h('span', { class: 'mono r dim' }, p.last ? when(p.last) : '—'));
                        })) : panel('card card-empty', h('div', { class: 'dim' }, 'None yet')),
                        h('p', { class: 'dim sm fine' }, 'Invite people from a crew lobby after you take a contract.'))));
        },
    };

    /* ---------------- 05–09 operation terminal ---------------- */

    VIEWS.operation = {
        sig: function (s) {
            var op = s.operation;
            if (!op) return 'operation:none';
            return ['operation', op.id, op.phase.n, !!op.tracker, op.tracker && op.tracker.status, !!op.security, !!op.delivery, op.intel.map(function (i) { return i.k; }).join('.'), op.crew.length, !!op.map.point, !!op.ends].join();
        },
        crumb: function (s) { return h('span', { class: 'mono' }, 'OPERATION · ' + s.operation.contract.id); },
        build: function (s) {
            var op = s.operation, c = op.contract;
            var instrument = op.delivery ? deliveryPanel() : op.tracker && op.tracker.status === 'ACTIVE' ? trackerPanel() : op.security ? securityPanel() : null;

            var mapBox = h('div', { class: 'map' + (instrument ? '' : ' is-lg') });
            var drawMap = function () { fill(mapBox, V.map(S.operation.map)); };
            drawMap();
            effect(function (s) { var m = s.operation.map; return [m.area, m.world, m.point]; }, drawMap);

            return h('div', { class: 'page page-op' },
                h('div', { class: 'op-top' },
                    h('div', { class: 'op-head' }, tierBadge(c.tier, 'is-lg'),
                        h('div', null, h('h2', { class: 'op-code is-lg' }, c.code), h('div', { class: 'op-state' }, h('i', { class: 'pulse' }), 'OPERATION ACTIVE',
                            h('span', { class: 'role-tag' + (op.role === 'support' ? ' is-support' : '') }, op.role === 'support' ? 'CREW SUPPORT' : 'YOUR OPERATION')))),
                    op.ends ? h('div', { class: 'op-window' }, label('CLIENT WINDOW'), timerEl(function () { return S.operation && S.operation.ends; })) : null),
                h('div', { class: 'op-grid' },
                    h('div', { class: 'op-main' },
                        panel('phase',
                            bound('div', 'lbl', function (s) { return 'PHASE ' + pad(s.operation.phase.n); }, 'op:phase'),
                            bound('div', 'phase-title', function (s) { return s.operation.phase.title; }, 'op:title'),
                            bound('div', 'phase-obj', function (s) { return s.operation.objective; }, 'op:obj')),
                        instrument,
                        panel('map-card',
                            h('div', { class: 'row-between' },
                                label(op.map.point ? 'LOCATION' : 'SEARCH AREA', bound('span', 'mono', function (s) { return s.operation.map.area || '—'; })),
                                h('span', { class: 'dim mono sm' }, 'LAST UPDATE ', (function () { var e = h('span'); tick(function () { if (S.operation) e.textContent = ago(S.operation.map.updated).toUpperCase(); }); return e; })())),
                            mapBox)),
                    h('div', { class: 'op-side' },
                        panel('intel', label('INTEL'), h('div', { class: 'kvs' }, op.intel.map(function (i, idx) {
                            return h('div', { class: 'kv' }, h('span', { class: 'k' }, i.k),
                                bound('span', 'v', function (s) { var x = s.operation.intel[idx]; return { text: x.v, cls: levelCls(x.level), tone: x.level === 'alert' ? 'alert' : null }; }, 'intel:' + i.k));
                        }))),
                        panel('crew-strip', label('CREW'), h('div', { class: 'crew-dots' }, op.crew.map(function (m, idx) {
                            return h('span', { class: 'crew-dot' }, bound('i', '', function (s) { var x = s.operation.crew[idx]; return { text: '●', cls: x.online ? 'on' : 'off', flash: !x.online }; }), m.tag);
                        }))),
                        panel('oplog', label('LOG'), (function () {
                            var box = h('div', { class: 'log' });
                            var draw = function () { fill(box, (S.operation ? S.operation.log : []).slice(0, 6).map(function (l) { return h('div', { class: 'log-row' }, h('span', { class: 'mono dim' }, clock(l.t)), h('span', null, l.text)); })); };
                            draw();
                            effect(function (s) { return s.operation.log.length; }, function () { draw(); if (box.firstChild) flash(box.firstChild); });
                            return box;
                        })()))));
        },
    };

    function trackerPanel() {
        var tr = function (s) { return s.operation.tracker; };
        var t = V.trace();
        disposers.push(t.stop);
        var setLevel = function (s) { var x = tr(s); t.set(x.strength); return { text: blocks(V.signalLevel(x.strength)), flash: false }; };
        return panel('instrument tracker',
            h('div', { class: 'row-between' }, label('SIGNAL ANALYSIS'), h('span', { class: 'rec mono' }, h('i', { class: 'pulse is-danger' }), 'LIVE')),
            bound('div', 'blocks mono', setLevel),
            t.el,
            h('div', { class: 'kvs' },
                kv('SOURCE', bound('span', 'v', function (s) { return tr(s).source || 'UNKNOWN'; })),
                kv('STATUS', bound('span', 'v', function (s) { return { text: tr(s).status, cls: tr(s).status === 'ACTIVE' ? 'lv-alert' : 'lv-ok' }; })),
                kv('STRENGTH', bound('span', 'v mono', function (s) { var x = tr(s).strength; return { text: x == null ? '—' : x + ' dBm', flash: false }; }))),
            h('div', { class: 'instrument-msg' }, h('b', null, 'TRACKING DEVICE DETECTED'), bound('span', '', function (s) { return tr(s).note || ''; })));
    }

    function securityPanel() {
        var sec = function (s) { return s.operation.security; };
        var x = sec(S);
        var lines = h('div', { class: 'kvs' }, x.lines.map(function (l, idx) {
            return kv(l[0], bound('span', 'v mono', function (s) { var q = sec(s).lines[idx]; return { text: q ? q[1] : '—', cls: levelCls(q && q[2]), tone: q && q[2] === 'alert' ? 'alert' : null }; }));
        }));
        var el = panel('instrument security' + (x.scrambled ? ' is-scrambled' : ''),
            h('div', { class: 'row-between' }, label(x.title || 'VEHICLE SECURITY'), x.hardware ? h('span', { class: 'mono dim sm' }, x.hardware) : h('span', { class: 'mono dim sm glitch' }, '▒▒▒▒▒▒ ▒▒▒▒')),
            h('div', { class: 'sec-system mono' }, x.system || 'HANDSHAKE'),
            h('div', { class: 'rule' }),
            lines,
            bound('div', 'attempts mono', function (s) { var q = sec(s); return q.attempts ? 'ATTEMPT ' + pad(q.attempt) + ' / ' + pad(q.attempts) : ''; }));
        if (x.scrambled) {
            // unknown hardware: the values themselves don't hold still
            var iv = setInterval(function () {
                if (!T.visible) return;
                el.querySelectorAll('.v').forEach(function (v) { if (Math.random() < 0.3) v.dataset.glitch = '1'; else delete v.dataset.glitch; });
            }, 220);
            disposers.push(function () { clearInterval(iv); });
        }
        return el;
    }

    function deliveryPanel() {
        var d = function (s) { return s.operation.delivery; };
        return panel('instrument delivery',
            h('div', { class: 'row-between' }, label('TARGET ACQUIRED'), h('span', { class: 'mono pos sm' }, 'DELIVERY')),
            h('div', { class: 'kvs is-lg' },
                kv('CONDITION', bound('span', 'v mono', function (s) { return d(s).condition != null ? d(s).condition + '%' : '—'; })),
                kv('TRACKING', bound('span', 'v', function (s) { return { text: d(s).tracking || '—', cls: d(s).tracking === 'CLEAR' ? 'lv-ok' : 'lv-alert' }; })),
                kv('DELIVERY', bound('span', 'v', function (s) { return d(s).location === 'RECEIVED' ? 'LOCATION RECEIVED' : (d(s).location || 'PENDING'); })),
                kv('DISTANCE', bound('span', 'v mono', function (s) { return d(s).distance != null ? num(d(s).distance, 1) + ' KM' : '—'; })),
                kv('CLIENT WINDOW', timerEl(function () { return S.operation && S.operation.delivery && S.operation.delivery.ends; }))));
    }

    /* ---------------- operations (history) + 10/11 report ---------------- */

    VIEWS.operations = {
        sig: function (s) { return ['operations', !!s.operation, s.history.length, !!s.result].join(); },
        crumb: function () { return 'OPERATIONS'; },
        build: function (s) {
            return h('div', { class: 'page' },
                h('div', { class: 'page-head' }, h('h2', null, 'Operations')),
                s.lobby ? panel('card', h('div', { class: 'row-between' }, h('span', null, 'Crew assembling for ', h('b', null, s.lobby.contract.code)), link('LOBBY', function () { go('lobby'); }))) : null,
                !s.lobby ? panel('card card-empty', h('div', { class: 'dim' }, 'No active operation')) : null,
                h('div', { class: 'section' }, label('REPORTS'),
                    s.history.length ? h('div', { class: 'table is-dated' }, s.history.map(function (e) {
                        return h('button', { class: 'trow', onClick: function () { if (e.report) go('report', e.report.id); } },
                            h('span', { class: 'mono dim' }, day(e.when)), h('span', { class: 'mono code' }, e.code), tierBadge(e.tier, 'is-sm'), outcomeCell(e.outcome),
                            h('span', { class: 'mono r ' + (e.share ? 'pos' : 'dim') }, e.share ? '+' + money(e.share) : '—'));
                    })) : panel('card card-empty', h('div', { class: 'dim' }, 'No reports yet'))));
        },
    };

    VIEWS.report = {
        sig: function (s) { return ['report', route.id, !!(s.result && s.result.id === route.id)].join(); },
        crumb: function () { return h('button', { class: 'crumb-back', onClick: function () { go('operations'); } }, glyph('back'), 'OPERATIONS'); },
        build: function (s) {
            var r = findReport(route.id);
            var pending = s.result && s.result.id === r.id;
            var ok = r.outcome === 'complete';
            var closeBtn = button('CLOSE', function () {
                if (pending) act('ack', { result: r.id }).then(function () { go('home'); });
                else go('operations');
            }, 'btn-ghost btn-lg');

            var body;
            if (ok) {
                var shareEl = h('span', { class: 'mono v' });
                countUp(shareEl, r.share, pending);
                body = [
                    h('div', { class: 'kvs' }, r.rows.map(function (x) { return kv(x[0], x[1]); })),
                    h('div', { class: 'rule' }),
                    h('div', { class: 'kvs' },
                        kv('BASE', money(r.base)),
                        kv('ADJUSTMENT', (r.adjustment >= 0 ? '+' : '−') + money(Math.abs(r.adjustment)))),
                    h('div', { class: 'rule' }),
                    h('div', { class: 'kvs is-lg' }, kv('TOTAL', money(r.total)), h('div', { class: 'kv is-share' }, h('span', { class: 'k' }, 'YOUR SHARE'), shareEl)),
                    r.share ? h('button', { class: 'lsx-link', onClick: function () { T.launch('pdr.crypto', r.tx ? { tx: r.tx } : { view: 'activity' }); } },
                        h('span', { class: 'mono' }, money(r.share) + ' RECEIVED'), h('span', { class: 'dim sm' }, 'Open in LSX'), glyph('ext')) : null,
                ];
            } else {
                body = [
                    h('div', { class: 'kvs' }, r.rows.map(function (x) { return kv(x[0], h('span', { class: 'v lv-alert' }, x[1])); }),
                        kv('COMPENSATION', money(0))),
                ];
            }
            var rep = r.rep || {};
            var repBlock = h('div', { class: 'section' },
                h('div', { class: 'kv is-lg' }, h('span', { class: 'k' }, 'REPUTATION'), h('span', { class: 'v mono ' + (rep.delta > 0 ? 'pos' : rep.delta < 0 ? 'neg' : 'dim') }, rep.delta > 0 ? '+' + rep.delta : rep.delta < 0 ? '−' + Math.abs(rep.delta) : '0')),
                rep.next ? (function () {
                    var from = rep.from != null ? rep.from : rep.points;
                    var span = rep.next - (S.standing.from || 0);
                    var b = bar(span ? (from - S.standing.from) / span : 0, 'bar-access');
                    if (pending) setTimeout(function () { b.firstChild.style.width = (Math.max(0, Math.min(1, (rep.points - S.standing.from) / span)) * 100).toFixed(2) + '%'; }, 250);
                    else b.firstChild.style.width = (Math.max(0, Math.min(1, (rep.points - S.standing.from) / span)) * 100).toFixed(2) + '%';
                    return [b, h('div', { class: 'mono dim sm' }, rep.tier + ' PROGRESS    ' + num(rep.points, 0) + ' / ' + num(rep.next, 0))];
                })() : null);

            return h('div', { class: 'page page-report' },
                h('div', { class: 'report is-' + r.outcome },
                    h('div', { class: 'report-state mono' }, ok ? 'CONTRACT CLOSED' : 'CONTRACT TERMINATED'),
                    h('h2', { class: 'op-code is-lg' }, r.code),
                    h('div', { class: 'mono dim' }, r.tier + ' / ' + r.contractId, r.role === 'support' ? ' · CREW SUPPORT' : ''),
                    h('div', { class: 'rule' }),
                    body,
                    repBlock,
                    (r.notes || []).length ? h('div', { class: 'notes' }, r.notes.map(function (n) { return h('p', null, n); })) : null,
                    h('div', { class: 'row-end' }, closeBtn)));
        },
    };

    function countUp(el, target, animate) {
        if (!animate || !(target > 0)) { el.textContent = money(target); return; }
        var t0 = performance.now(), dur = 700;
        var step = function (t) {
            var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
            el.textContent = money(target * e);
            if (k < 1) requestAnimationFrame(step);
        };
        el.textContent = money(0);
        setTimeout(function () { requestAnimationFrame(step); }, 200);
    }

    /* ---------------- 12 profile ---------------- */

    VIEWS.profile = {
        sig: function (s) { return ['profile', s.standing.tier, s.standing.xAuth, s.history.length].join(); },
        crumb: function () { return 'PROFILE'; },
        build: function (s) {
            var st = s.standing, stats = s.stats || {};
            var ladder = (st.ladder || []).map(function (l) {
                var right;
                if (l.state === 'current') {
                    right = h('div', { class: 'ladder-bar' }, bar(st.next > st.from ? (st.points - st.from) / (st.next - st.from) : 1, 'bar-access'),
                        h('span', { class: 'mono' }, num(st.points, 0) + ' / ' + num(st.next, 0)));
                } else {
                    right = h('span', { class: 'mono ' + (l.state === 'complete' ? 'pos' : l.state === 'available' ? 'warn' : 'dim') },
                        { complete: 'COMPLETE', locked: 'LOCKED', none: '—', available: 'AUTHORIZED' }[l.state] || l.state.toUpperCase());
                }
                return h('div', { class: 'ladder-row is-' + l.state }, tierBadge(l.tier, 'is-sm'), right);
            });
            var statCell = function (k, v) { return h('div', { class: 'stat' }, h('div', { class: 'lbl' }, k), h('div', { class: 'stat-v mono' }, v)); };
            return h('div', { class: 'page page-profile' },
                h('div', { class: 'profile-top' },
                    h('div', { class: 'access' }, h('div', { class: 'lbl' }, 'ACCESS LEVEL'), h('div', { class: 'access-tier' }, st.tier), h('div', { class: 'mono dim' }, s.player.tag + ' · ' + s.player.handle.toUpperCase())),
                    panel('ladder', label('NETWORK STANDING'), ladder)),
                h('div', { class: 'stats' },
                    statCell('CONTRACTS COMPLETED', num(stats.completed || 0, 0)),
                    statCell('CONTRACTS FAILED', num(stats.failed || 0, 0)),
                    statCell('VEHICLES DELIVERED', num(stats.delivered || 0, 0)),
                    statCell('TOTAL EARNED', money(stats.earned || 0)),
                    statCell('CURRENT STREAK', num(stats.streak || 0, 0)),
                    statCell('HIGHEST ACCESS', st.highest || st.tier)),
                h('div', { class: 'section' }, label('HISTORY'),
                    s.history.length ? h('div', { class: 'table is-dated' }, s.history.map(function (e) {
                        return h('div', { class: 'trow is-static' }, h('span', { class: 'mono dim' }, day(e.when)), h('span', { class: 'mono code' }, e.code), tierBadge(e.tier, 'is-sm'), outcomeCell(e.outcome), h('span', { class: 'mono r dim' }, e.role === 'support' ? 'SUPPORT' : ''));
                    })) : panel('card card-empty', h('div', { class: 'dim' }, 'No history yet'))));
        },
    };

    /* ================================================================== */
    /* boot / unavailable                                                  */
    /* ================================================================== */

    var MARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square"><path d="M5 19V5l6 7M13 12l6 7V5"/></svg>';
    var session = (function () { var s = ''; for (var i = 0; i < 8; i++) s += '0123456789ABCDEF'[Math.floor(Math.random() * 16)]; return s.slice(0, 4) + '-' + s.slice(4); })();

    function boot() {
        conn = 'connecting';
        var lines = h('div', { class: 'boot-lines mono' });
        fill(app, h('div', { class: 'boot' }, h('span', { class: 'boot-mark', html: MARK }), lines));
        var steps = ['AUTHENTICATING', 'SESSION ' + session, 'ENCRYPTED CHANNEL'];
        var t0 = Date.now();
        steps.forEach(function (s, i) { setTimeout(function () { if (lines.isConnected) lines.append(h('div', null, s, h('span', { class: 'dim' }, i < 2 ? ' ··· OK' : ' ··· '))); }, i * 130); });
        return backend.hello().then(function (hi) {
            hello = hi;
            return backend.state();
        }).then(function (s) {
            if (!validState(s)) throw new Error('Malformed state');
            var wait = Math.max(0, 420 - (Date.now() - t0));
            return new Promise(function (r) { setTimeout(function () { r(s); }, wait); });
        }).then(function (s) {
            S = s;
            conn = 'connected';
            shell();
            syncBadge();
            if (!handleLaunch(T.launchData)) {
                if (S.result) { shownResult = S.result.id; route = { view: 'report', id: S.result.id }; }
                else if (S.operation) route = { view: 'operation', id: null };
            }
            render(false);
        }, function () {
            conn = 'offline';
            unavailable();
        });
    }

    function unavailable() {
        fill(app, h('div', { class: 'unavailable' },
            h('span', { class: 'boot-mark', html: MARK }),
            h('div', { class: 'u-title mono' }, 'NETWORK UNAVAILABLE'),
            h('p', { class: 'dim' }, 'Unable to establish a secure session.'),
            button('RETRY', function () { boot(); }, 'btn-ghost btn-lg')));
    }

    /* ================================================================== */
    /* deep links                                                          */
    /* ================================================================== */

    /** Launch data from a notification or another app. Returns true if it routed somewhere. */
    function handleLaunch(d) {
        if (!d || typeof d !== 'object' || !S) return false;
        var target = null;
        if (typeof d.result === 'string') target = ['report', findReport(d.result) ? d.result : (S.result && S.result.id)];
        else if (typeof d.invite === 'string') target = [S.lobby ? 'lobby' : 'crew'];
        else if (typeof d.contract === 'string' && findContract(d.contract)) target = ['dossier', d.contract];
        else if (d.view === 'operation') target = ['operation'];
        else if (d.view === 'lobby') target = ['lobby'];
        else if (typeof d.view === 'string' && VIEWS[d.view] && d.view !== 'report' && d.view !== 'dossier') target = [d.view];
        if (!target) return false;
        if (target[0] === 'report' && target[1]) shownResult = target[1];
        if (document.getElementById('main')) go(target[0], target[1]);
        else { route = { view: target[0], id: target[1] || null }; if (route.view === 'crew' && S.lobby) route.view = 'lobby'; if (route.view === 'operations' && S.operation) route.view = 'operation'; }
        if (typeof d.invite === 'string') setTimeout(function () { var el = document.querySelector('[data-invite="' + CSS.escape(d.invite) + '"]'); if (el) flash(el); });
        return true;
    }

    /* ================================================================== */
    /* lifecycle                                                           */
    /* ================================================================== */

    setInterval(function () {
        if (!T.visible || !ticks.length) return;
        var now = Date.now();
        ticks.forEach(function (fn) { try { fn(now); } catch (e) { /* view changing */ } });
    }, 1000);

    T.ready().then(function () {
        backend = NET.Backend.connect(T);
        backend.on(function (ev, data) {
            if (ev === 'update') {
                if (data && data.state) { setConn('connected'); receive(data.state); } else if (S) refresh();
            } else if (ev === 'signal' && S && S.operation && S.operation.tracker) {
                S.operation.tracker.strength = data.strength;
                patch();
            } else if (ev === 'notice' && T.visible && data && data.text) {
                toast(String(data.text).slice(0, 80));
            }
        });
        boot();
    });

    T.on('launch', function (d) { handleLaunch(d); });
    T.on('show', function () {
        if (!S || !document.getElementById('main')) return;
        refresh().then(function () {
            if (S.result && S.result.id !== shownResult) { shownResult = S.result.id; go('report', S.result.id); }
        });
    });
    T.on('settings', function () { if (S && document.getElementById('main')) render(true); });
    T.on('message:network:demo', function (d) {
        if (backend && backend.world && d && typeof d.step === 'string') backend.world.direct(d.step);
    });

    window.__network = {
        go: go, state: function () { return S; }, route: function () { return route; },
        demo: function (step) { if (backend && backend.world) backend.world.direct(step); },
    };
})();
