/*
 * Demo world: a stand-in for pdr_criminal so every screen can be seen and tested without a
 * server. It answers the same requests with the same State shape as CONTRACT.md describes, and
 * simulates the other players (they join, confirm splits, lead operations).
 *
 * The physical side of an operation can't happen in a browser, so the dev harness "directs" it:
 * apps:message { id = 'pdr.network', event = 'network:demo', data = { step = 'identify' } }
 * Steps: identify · attempt · bypass · signal · untrack · deliver · fail · disconnect · invite ·
 * offer · contracts. None of this logic exists in the live app; the server owns all of it.
 */
(function (global) {
    'use strict';

    var MIN = 60000;
    var TIERS = [
        { tier: 'D', from: 0, to: 400 },
        { tier: 'C', from: 400, to: 1200 },
        { tier: 'B', from: 1200, to: 2200 },
        { tier: 'A', from: 2200, to: 3600 },
    ];
    var PEOPLE = {
        p1: { id: 'p1', handle: 'Manel', tag: 'MNL' },
        p2: { id: 'p2', handle: 'Tracksuit', tag: 'TRK' },
        p3: { id: 'p3', handle: 'Kai', tag: 'KAI' },
        p4: { id: 'p4', handle: 'Vero', tag: 'VRO' },
        p5: { id: 'p5', handle: 'Dutch', tag: 'DTC' },
    };

    function copy(v) { return JSON.parse(JSON.stringify(v)); }
    function hexId() { var s = ''; for (var i = 0; i < 4; i++) s += '0123456789ABCDEF'[Math.floor(Math.random() * 16)]; return 'CN-' + s; }
    function fail(msg) { return global.NET.Backend.Fail(msg); }

    function contract(o) {
        var c = {
            id: o.id || hexId(), code: o.code, tier: o.tier, fresh: !!o.fresh,
            window: o.window, crew: o.crew || { min: 1, max: 4 },
            payout: o.payout, fields: o.fields, photo: o.photo || { kind: 'cctv', shape: 'sedan', cam: 'CAM 04' },
            area: o.area, dossier: o.dossier, expires: Date.now() + (o.expiresIn || 45) * MIN,
        };
        if (o.source) c.source = o.source;
        if (o.warning) c.warning = o.warning;
        return c;
    }

    function feed() {
        return [
            contract({
                code: 'SENTINEL', tier: 'B', window: 18, payout: { amount: 36.4 }, fresh: true,
                fields: [['VEHICLE CLASS', 'SPORTS'], ['AREA', 'WEST LS'], ['WINDOW', '18 MIN'], ['CREW', '1–4']],
                photo: { kind: 'cctv', shape: 'sports', cam: 'CAM 11' },
                area: { name: 'WEST VINEWOOD', world: { x: -540, y: 260, r: 420 } },
                dossier: {
                    client: 'BROKER 7Q',
                    target: 'Two-door sports coupé, dark finish. Seen parked on residential streets after dark.',
                    rows: [['SEARCH AREA', 'WEST VINEWOOD'], ['DELIVERY', 'Vehicle intact'], ['CONDITION', 'Expected ≥ 70%']],
                },
            }),
            contract({
                code: 'VECTOR', tier: 'C', window: 22, payout: { amount: 17.8 },
                fields: [['VEHICLE CLASS', 'SEDAN'], ['AREA', 'SOUTH LS'], ['WINDOW', '22 MIN'], ['CREW', '1–3']], crew: { min: 1, max: 3 },
                photo: { kind: 'crop', shape: 'sedan', cam: 'CAM 02' },
                area: { name: 'DAVIS', world: { x: 60, y: -1650, r: 380 } },
                dossier: {
                    client: 'ANONYMOUS',
                    target: 'Four-door sedan, light colour, aftermarket wheels. Commuter use.',
                    rows: [['SEARCH AREA', 'DAVIS / STRAWBERRY'], ['DELIVERY', 'Vehicle intact']],
                },
            }),
            contract({
                code: 'STATIC', tier: 'D', window: 25, payout: { amount: 7.9 },
                fields: [['VEHICLE', 'DINKA BLISTA'], ['COLOUR', 'DARK BLUE'], ['AREA', 'MIRROR PARK'], ['SECURITY', 'OEM'], ['WINDOW', '25 MIN'], ['CREW', '1–2']], crew: { min: 1, max: 2 },
                photo: { kind: 'cctv', shape: 'compact', cam: 'CAM 07' },
                area: { name: 'MIRROR PARK', world: { x: 1100, y: -580, r: 300 } },
                dossier: {
                    client: 'LOCAL',
                    target: 'Dinka Blista, dark blue. Owner parks it outside a residence near the lake.',
                    rows: [['SEARCH AREA', 'MIRROR PARK'], ['SECURITY', 'Factory immobilizer'], ['DELIVERY', 'Any condition']],
                },
            }),
        ];
    }

    function cerberus() {
        return contract({
            id: 'CN-84F1', code: 'CERBERUS', tier: 'A', window: 12, payout: { min: 82, max: 108 },
            fields: [['TARGET', 'HIGH VALUE'], ['AREA', 'ROCKFORD / UNKNOWN'], ['WINDOW', '12 MIN'], ['SECURITY', 'ELEVATED']],
            photo: { kind: 'silhouette', shape: 'super', cam: '—' },
            area: { name: 'ROCKFORD HILLS', world: { x: -820, y: -160, r: 520 } },
            dossier: {
                client: 'BROKER 2C',
                target: 'High-value vehicle. Low profile. Owner is aware of its value.',
                rows: [['SEARCH AREA', 'ROCKFORD HILLS'], ['DELIVERY', 'Vehicle intact'], ['CONDITION', 'Expected ≥ 80%']],
            },
        });
    }

    function xOffer() {
        return contract({
            id: 'CN-X001', code: 'CLASSIFIED', tier: 'X', window: 0, payout: { amount: 384 }, expiresIn: 30,
            source: 'SOURCE UNKNOWN',
            fields: [['CLIENT', '—'], ['TARGET', 'CLASSIFIED'], ['LOCATION', 'PROVIDED ON ACCEPTANCE'], ['WINDOW', 'LIMITED'], ['CREW', 'UP TO 4']],
            photo: { kind: 'none' },
            area: { name: 'UNDISCLOSED' },
            dossier: { client: '—', target: 'Classified.', rows: [['LOCATION', 'Provided on acceptance'], ['WINDOW', 'Limited']] },
            warning: 'Accepting this operation consumes your current X authorization.',
        });
    }

    function seedHistory(now) {
        var D = 86400000;
        var h = [
            ['MARROW', 'B', 'complete', 8.62, now - 3 * 3600000, 148],
            ['VECTOR', 'B', 'failed', 0, now - D - 5 * 3600000, -42],
            ['GHOST', 'B', 'complete', 12.10, now - D - 9 * 3600000, 131],
            ['STATIC', 'C', 'complete', 6.35, now - 3 * D, 96],
            ['LANTERN', 'C', 'complete', 5.90, now - 4 * D, 88],
        ];
        return h.map(function (r, i) {
            return {
                id: 'h' + i, code: r[0], tier: r[1], outcome: r[2], share: r[3], when: r[4], role: 'lead', contractId: hexId(),
                report: {
                    id: 'r' + i, outcome: r[2], code: r[0], tier: r[1], contractId: 'CN-' + (4000 + i * 713).toString(16).toUpperCase(),
                    closed: r[4], coin: 'ZNC', role: 'lead',
                    rows: r[2] === 'complete'
                        ? [['TARGET CONDITION', (78 + i * 3) + '%'], ['DELIVERY', 'COMPLETE'], ['CREW', String(2 + (i % 2))]]
                        : [['TARGET', 'LOST'], ['CLIENT', 'WITHDRAWN']],
                    base: r[2] === 'complete' ? +(r[3] * 2.2).toFixed(2) : 0,
                    adjustment: r[2] === 'complete' ? +(r[3] * 0.3).toFixed(2) : 0,
                    total: r[2] === 'complete' ? +(r[3] * 2.5).toFixed(2) : 0,
                    share: r[3],
                    rep: { delta: r[5] },
                    notes: r[2] === 'failed' ? ['This contract is no longer available.'] : [],
                },
            };
        });
    }

    function seedStats(now) {
        var D = 86400000, r = 7, rnd = function () { r = (r * 16807) % 2147483647; return r / 2147483647; };
        var earnings = [];
        for (var i = 13; i >= 0; i--) {
            var t = now - i * D;
            earnings.push({ t: t, v: rnd() < 0.3 ? 0 : +(4 + rnd() * 22).toFixed(2) });
        }
        var tierHistory = [];
        for (var j = 30; j >= 0; j--) tierHistory.push({ t: now - j * D, v: Math.round(900 + (30 - j) * 31 + (rnd() - 0.5) * 60) });
        tierHistory[tierHistory.length - 1].v = 1840;
        return {
            completed: 23, failed: 4, delivered: 23, earned: 214.6, streak: 3, fastest: 11 * 60000 + 42000, bestShare: 24.8,
            earnings: earnings,
            byClass: [{ k: 'SPORTS', n: 8 }, { k: 'SEDAN', n: 7 }, { k: 'COMPACT', n: 5 }, { k: 'SUV', n: 2 }, { k: 'SUPER', n: 1 }],
            tierHistory: tierHistory,
        };
    }

    function seedComms(now, sentinelId) {
        var b7q = { id: 'b7q', handle: 'Broker 7Q', tag: '7Q' }, lou = { id: 'lou', handle: 'Lou', tag: 'LOU' }, unk = { id: 'unk', handle: 'Unknown', tag: '???' };
        return [
            { id: 't-7q', kind: 'broker', title: 'BROKER 7Q', contact: b7q, unread: 1, messages: [
                { id: 'm1', from: b7q, t: now - 3 * 3600000 - 600000, text: 'Clean work on MARROW. The client noticed.' },
                { id: 'm2', from: b7q, t: now - 38 * 60000, text: 'Something on the west side if you want it. Sports class, quiet street. Don’t make noise.', attach: { contract: sentinelId } },
            ] },
            { id: 't-lou', kind: 'broker', title: 'LOU', contact: lou, unread: 1, messages: [
                { id: 'm3', from: lou, t: now - 2 * 3600000, text: 'Heard Vinewood patrols doubled after midnight. Just saying.', tag: 'TIP' },
            ] },
            { id: 't-unk', kind: 'broker', title: 'UNKNOWN', contact: unk, unread: 0, messages: [
                { id: 'm4', from: unk, t: now - 26 * 3600000, text: 'Your progress has been noted.' },
            ] },
        ];
    }

    var CHATTER = {
        identify: ['Got eyes on it. Parked behind the pool house.', 'That’s the one. Owner just went inside.'],
        bypass: ['Tracker’s pinging. Pull over somewhere dark.', 'We’re in. It’s talking to someone though.'],
        untrack: ['Clean. Go.', 'Signal’s dead. Drop-off is coming through.'],
        reply: ['Copy.', 'On my way.', 'Two minutes.', 'Seen.', 'Keep it quiet.', 'Understood.'],
    };

    function DemoWorld(T) {
        var listeners = [];
        var timers = [];
        var later = function (ms, fn) { var t = setTimeout(function () { timers.splice(timers.indexOf(t), 1); fn(); }, ms); timers.push(t); };
        var now = Date.now();
        var s = {
            player: PEOPLE.p1,
            coin: 'ZNC',
            standing: { tier: 'B', points: 1840, xAuth: false, highest: 'B' },
            contracts: feed(),
            offer: null,
            lobby: null,
            operation: null,
            result: null,
            invites: [],
            history: seedHistory(now),
            stats: seedStats(now),
            heat: { level: 0.18, label: 'LOW' },
            comms: { threads: [] },
            crews: [
                { id: 'c1', code: 'MARROW', tier: 'B', when: now - 3 * 3600000, members: [PEOPLE.p2, PEOPLE.p3] },
                { id: 'c2', code: 'GHOST', tier: 'B', when: now - 86400000 - 9 * 3600000, members: [PEOPLE.p4] },
            ],
            contacts: [
                { id: 'p2', handle: 'Tracksuit', tag: 'TRK', role: 'crew', trust: 82, jobs: 11, earned: 96.4, nearby: true, last: now - 3 * 3600000 },
                { id: 'p3', handle: 'Kai', tag: 'KAI', role: 'crew', trust: 64, jobs: 6, earned: 51.2, nearby: true, last: now - 3 * 3600000 },
                { id: 'p4', handle: 'Vero', tag: 'VRO', role: 'crew', trust: 45, jobs: 3, earned: 22.9, nearby: false, last: now - 86400000 - 9 * 3600000 },
                { id: 'p5', handle: 'Dutch', tag: 'DTC', role: 'crew', trust: 20, jobs: 0, earned: 0, nearby: false, last: null },
                { id: 'b7q', handle: 'Broker 7Q', tag: '7Q', role: 'broker', trust: 72, jobs: 14, earned: 0, nearby: false, last: now - 38 * 60000, thread: 't-7q' },
                { id: 'b2c', handle: 'Broker 2C', tag: '2C', role: 'broker', trust: 36, jobs: 2, earned: 0, nearby: false, last: now - 5 * 86400000 },
                { id: 'lou', handle: 'Lou', tag: 'LOU', role: 'fixer', trust: 55, jobs: 4, earned: 0, nearby: false, last: now - 2 * 3600000, thread: 't-lou' },
            ],
        };
        s.comms.threads = seedComms(now, s.contracts[0].id);

        function heat(level) {
            s.heat = { level: level, label: level < 0.3 ? 'LOW' : level < 0.6 ? 'ELEVATED' : 'HIGH' };
        }
        function thread(id) { return s.comms.threads.filter(function (t) { return t.id === id; })[0]; }
        var mid = 0;
        function post(tid, from, text, extra) {
            var t = thread(tid);
            if (!t) return;
            var m = { id: 'm' + Date.now().toString(36) + (++mid), from: from, t: Date.now(), text: text };
            for (var k in extra || {}) m[k] = extra[k];
            t.messages.push(m);
            if (from && from.id !== s.player.id) {
                t.unread++;
                if (T.inTablet && !T.visible) T.notify({ title: t.title, body: text, data: { thread: tid } });
            }
            return m;
        }
        function crewThread() { return s.comms.threads.filter(function (t) { return t.kind === 'crew' && t.open; })[0]; }
        function chatter(key) {
            var t = crewThread(), op = s.operation;
            if (!t || !op) return;
            var mates = op.crew.filter(function (m) { return m.id !== s.player.id && m.online; });
            if (!mates.length) return;
            var who = mates[Math.floor(Math.random() * mates.length)];
            var lines = CHATTER[key];
            later(700, function () { post(t.id, { id: who.id, handle: who.handle, tag: who.tag }, lines[Math.floor(Math.random() * lines.length)]); push(); });
        }
        function openCrewThread(L) {
            s.comms.threads.forEach(function (t) { if (t.kind === 'crew') t.open = false; });
            var t = { id: 'crew-' + L.id, kind: 'crew', open: true, title: L.contract.code + ' · CREW', contact: null, unread: 0, messages: [] };
            s.comms.threads.unshift(t);
            post(t.id, null, 'Channel opened. End-to-end encrypted.', { system: true });
            if (L.role === 'support') post(t.id, PEOPLE[L.owner], 'Glad you’re in. Confirm the split and we move.');
        }

        var emit = function (ev, data) { listeners.forEach(function (fn) { fn(ev, data); }); };
        var push = function () { emit('update', { state: view() }); };
        /** What pdr_criminal would do with the tablet's notify: the app is told how to deep-link. */
        // pdr_criminal decides when to notify; this stand-in only does it while the app is in the background
        // and shows an in-app notice otherwise
        var notify = function (title, body, data) {
            if (T.inTablet && !T.visible) T.notify({ title: title, body: body, data: data });
            else emit('notice', { text: (title === 'NETWORK' ? '' : title + ' · ') + body.split('\n')[0].replace(/\.$/, '').toUpperCase() });
        };

        function ladder() {
            var st = s.standing;
            var out = TIERS.map(function (t) {
                var state = t.tier === st.tier ? 'current' : TIERS.findIndex(function (x) { return x.tier === t.tier; }) < TIERS.findIndex(function (x) { return x.tier === st.tier; }) ? 'complete' : 'locked';
                return { tier: t.tier, state: state };
            });
            out.push({ tier: 'X', state: st.xAuth ? 'available' : 'none' });
            return out;
        }

        function view() {
            var st = s.standing;
            var band = TIERS.filter(function (t) { return t.tier === st.tier; })[0] || TIERS[TIERS.length - 1];
            var v = copy(s);
            v.now = Date.now();
            v.standing.from = band.from;
            v.standing.next = band.to;
            v.standing.ladder = ladder();
            return v;
        }

        function pay(c) { return c.payout.amount != null ? c.payout.amount : +((c.payout.min + c.payout.max) / 2).toFixed(2); }
        function evenSplit(ids) {
            var out = {}, base = Math.floor(100 / ids.length), rest = 100 - base * ids.length;
            ids.forEach(function (id, i) { out[id] = base + (i < rest ? 1 : 0); });
            return out;
        }
        function member(p, state) { return { id: p.id, handle: p.handle, tag: p.tag, state: state }; }
        function others() { return s.lobby.members.filter(function (m) { return m.id !== s.player.id; }); }

        /** Simulated crewmates confirm whatever split is current, a moment after it changes. */
        function autoConfirm() {
            var L = s.lobby;
            if (!L) return;
            var version = L.version;
            others().forEach(function (m, i) {
                if (m.state !== 'pending' || m.id === L.owner) return;
                later(900 + i * 700, function () {
                    if (!s.lobby || s.lobby.version !== version) return;
                    var mm = s.lobby.members.filter(function (x) { return x.id === m.id; })[0];
                    if (!mm || mm.state !== 'pending') return;
                    mm.state = 'confirmed';
                    notify(L.contract.code, mm.handle + ' confirmed the split.', { view: 'lobby' });
                    push();
                });
            });
        }

        function startOperation() {
            var L = s.lobby, c = L.contract;
            var t = Date.now();
            s.operation = {
                id: 'op-' + c.id, contract: c, role: L.role, started: t,
                ends: c.window ? t + c.window * MIN : null,
                phase: { n: 1, title: 'LOCATE TARGET' },
                objective: 'Locate target within search area.',
                intel: [
                    { k: 'TARGET', v: 'Unknown', level: 'unknown' },
                    { k: 'SECURITY', v: 'Unknown', level: 'unknown' },
                    { k: 'TRACKING', v: 'Unknown', level: 'unknown' },
                ],
                crew: L.members.filter(function (m) { return m.state === 'confirmed'; }).map(function (m) { return { id: m.id, handle: m.handle, tag: m.tag, online: true }; }),
                map: { area: c.area.name, world: c.area.world || null, point: null, updated: t },
                tracker: null, security: null, delivery: null,
                log: [{ t: t, text: 'Operation started.' }],
                split: L.split, total: L.total,
            };
            s.crews.unshift({ id: 'c' + t, code: c.code, tier: c.tier, when: t, members: others().map(function (m) { return PEOPLE[m.id] || m; }) });
            s.crews.length = Math.min(s.crews.length, 6);
            s.contracts = s.contracts.filter(function (x) { return x.id !== c.id; });
            if (c.tier === 'X' && L.role === 'lead') { s.offer = null; s.standing.xAuth = false; }
            s.lobby = null;
            heat(0.34);
            var t = crewThread(); if (t) post(t.id, null, 'Operation active. Window ' + (c.window ? c.window + ' min' : 'limited') + '.', { system: true });
        }

        function intel(k, v, level) {
            var op = s.operation;
            op.intel.forEach(function (i) { if (i.k === k) { i.v = v; i.level = level; } });
        }
        function log(text) { s.operation.log.unshift({ t: Date.now(), text: text }); }

        function close(outcome) {
            var op = s.operation, c = op.contract;
            var mine = (op.split && op.split[s.player.id]) || 100;
            var cond = op.delivery ? op.delivery.condition : null;
            var base = pay(c), adj = outcome === 'complete' ? +(base * (cond >= 85 ? 0.2 : cond >= 70 ? 0.06 : -0.1)).toFixed(2) : 0;
            var total = outcome === 'complete' ? +(base + adj).toFixed(2) : 0;
            var share = +(total * mine / 100).toFixed(4);
            var support = op.role === 'support';
            var delta = outcome === 'complete' ? (support ? 0 : 148) : (support ? 0 : -42);
            var st = s.standing, before = st.points;
            st.points = Math.max(0, st.points + delta);
            var band = TIERS.filter(function (t) { return t.tier === st.tier; })[0];
            if (band && st.points >= band.to && st.tier !== 'A') { st.tier = TIERS[TIERS.indexOf(band) + 1].tier; st.highest = st.tier; }
            else if (band && st.tier === 'A' && st.points >= band.to) st.xAuth = true;
            var r = {
                id: 'r' + Date.now(), outcome: outcome, code: c.code, tier: c.tier, contractId: c.id, closed: Date.now(), coin: s.coin, role: op.role,
                rows: outcome === 'complete'
                    ? [['TARGET CONDITION', (cond != null ? cond : 90) + '%'], ['DELIVERY', 'COMPLETE'], ['CREW', String(op.crew.length)]]
                    : [['TARGET', 'LOST'], ['CLIENT', 'WITHDRAWN']],
                base: outcome === 'complete' ? base : 0, adjustment: adj, total: total, share: share,
                rep: { delta: delta, from: before, points: st.points, tier: st.tier, next: (TIERS.filter(function (t) { return t.tier === st.tier; })[0] || {}).to },
                tx: null,   // live: the LSX transaction id from CryptoPay, so the payout deep-links into LSX
                notes: [],
            };
            if (support) r.notes.push('Crew support: no progression for your standing.');
            if (op.crew.some(function (m) { return !m.online; })) r.notes.push('Crew member disconnected. Operation continued.');
            if (outcome === 'failed') r.notes.push('This contract is no longer available.');
            s.result = r;
            s.history.unshift({ id: 'h' + Date.now(), code: c.code, tier: c.tier, outcome: outcome, share: share, when: Date.now(), role: op.role, contractId: c.id, report: copy(r) });
            if (outcome === 'complete') { s.stats.completed++; s.stats.delivered++; s.stats.earned = +(s.stats.earned + share).toFixed(4); s.stats.streak++; }
            else { s.stats.failed++; s.stats.streak = 0; }
            s.operation = null;
            heat(0.22);
            var ct = crewThread(); if (ct) { post(ct.id, null, (outcome === 'complete' ? 'Contract closed.' : 'Contract terminated.') + ' Channel closed.', { system: true }); ct.open = false; }
            if (outcome === 'complete') {
                var today = s.stats.earnings[s.stats.earnings.length - 1];
                today.v = +(today.v + share).toFixed(2);
                s.stats.tierHistory.push({ t: Date.now(), v: st.points });
                s.stats.byClass.forEach(function (b) { if (c.photo && b.k === String(c.photo.shape).toUpperCase()) b.n++; });
                s.stats.bestShare = Math.max(s.stats.bestShare, share);
            }
            // live: pdr_criminal pays each member with exports.pdr_tablet:CryptoPay and puts the
            // returned LSX tx id in result.tx. The dev harness sends LSX a demo payout alongside.
            notify(c.code, outcome === 'complete' ? 'Contract closed.' : 'Contract terminated.', { result: r.id });
        }

        var ACTIONS = {
            assemble: function (d) {
                if (s.lobby) throw fail('You are already assembling a crew');
                if (s.operation) throw fail('Finish the active operation first');
                var c = s.contracts.filter(function (x) { return x.id === d.contract; })[0] || (s.offer && s.offer.id === d.contract ? s.offer : null);
                if (!c) throw fail('This contract is no longer available');
                s.lobby = {
                    id: 'l' + Date.now(), contract: c, role: 'lead', owner: s.player.id, max: c.crew.max,
                    members: [member(s.player, 'confirmed')], split: evenSplit([s.player.id]), version: 1, total: pay(c),
                    consumesX: c.tier === 'X',
                };
                openCrewThread(s.lobby);
            },
            invite: function (d) {
                var L = s.lobby;
                if (!L || L.owner !== s.player.id) throw fail('Only the crew lead can invite');
                if (L.members.length >= L.max) throw fail('Crew is full');
                var p = PEOPLE[d.player];
                if (!p || L.members.some(function (m) { return m.id === p.id; })) throw fail('Player not available');
                L.members.push(member(p, 'invited'));
                later(1100, function () {
                    if (!s.lobby) return;
                    var m = s.lobby.members.filter(function (x) { return x.id === p.id; })[0];
                    if (!m || m.state !== 'invited') return;
                    m.state = 'pending';
                    s.lobby.split = evenSplit(s.lobby.members.filter(function (x) { return x.state !== 'invited'; }).map(function (x) { return x.id; }));
                    s.lobby.version++;
                    s.lobby.members.forEach(function (x) { if (x.id !== s.lobby.owner && x.state === 'confirmed') x.state = 'pending'; });
                    emit('notice', { text: p.handle.toUpperCase() + ' JOINED' });
                    push();
                    autoConfirm();
                });
            },
            uninvite: function (d) {
                var L = s.lobby;
                if (!L || L.owner !== s.player.id) throw fail('Only the crew lead can remove members');
                L.members = L.members.filter(function (m) { return m.id !== d.player || m.id === L.owner; });
                L.split = evenSplit(L.members.filter(function (x) { return x.state !== 'invited'; }).map(function (x) { return x.id; }));
                L.version++;
                L.members.forEach(function (x) { if (x.id !== L.owner && x.state === 'confirmed') x.state = 'pending'; });
                autoConfirm();
            },
            split: function (d) {
                var L = s.lobby;
                if (!L || L.owner !== s.player.id) throw fail('Only the crew lead sets the split');
                var ids = L.members.filter(function (m) { return m.state !== 'invited'; }).map(function (m) { return m.id; });
                var sum = 0, next = {};
                ids.forEach(function (id) { var v = Math.round(Number(d.split && d.split[id])); if (!(v >= 0 && v <= 100)) throw fail('Invalid split'); next[id] = v; sum += v; });
                if (sum !== 100) throw fail('Split must total 100%');
                L.split = next;
                L.version++;
                L.members.forEach(function (m) { if (m.id !== L.owner && m.state === 'confirmed') m.state = 'pending'; });
                autoConfirm();
            },
            confirm: function (d) {
                var L = s.lobby;
                if (!L) throw fail('No crew');
                if (d.version !== L.version) throw fail('Compensation updated. Review it again.');
                L.members.forEach(function (m) { if (m.id === s.player.id) m.state = 'confirmed'; });
                if (L.role === 'support') {
                    later(1600, function () {
                        if (!s.lobby || s.lobby.id !== L.id) return;
                        if (!s.lobby.members.every(function (m) { return m.state === 'confirmed'; })) return;
                        startOperation();
                        notify(L.contract.code, 'Operation active.', { view: 'operation' });
                        push();
                    });
                }
            },
            begin: function () {
                var L = s.lobby;
                if (!L || L.owner !== s.player.id) throw fail('Only the crew lead can begin');
                var joined = L.members.filter(function (m) { return m.state !== 'invited'; });
                if (!joined.every(function (m) { return m.state === 'confirmed'; })) throw fail('Everyone must confirm the split');
                L.members = joined;
                startOperation();
            },
            leave: function () {
                if (!s.lobby) return;
                var t = crewThread(); if (t) { post(t.id, null, 'Crew disbanded. Channel closed.', { system: true }); t.open = false; }
                s.lobby = null;
            },
            send: function (d) {
                var t = thread(d.thread);
                var text = String(d.text || '').trim().slice(0, 240);
                if (!t) throw fail('Channel closed');
                if (t.kind === 'crew' && !t.open) throw fail('Channel closed');
                if (!text) throw fail('Empty message');
                post(t.id, { id: s.player.id, handle: s.player.handle, tag: s.player.tag }, text);
                var from = t.kind === 'crew'
                    ? (s.operation ? s.operation.crew : (s.lobby ? s.lobby.members : [])).filter(function (m) { return m.id !== s.player.id && m.online !== false && m.state !== 'invited'; })[0]
                    : t.contact;
                if (from && Math.random() < 0.85) later(1300 + Math.random() * 900, function () { post(t.id, { id: from.id, handle: from.handle, tag: from.tag }, CHATTER.reply[Math.floor(Math.random() * CHATTER.reply.length)]); push(); });
            },
            read: function (d) { var t = thread(d.thread); if (t) t.unread = 0; },
            accept: function (d) {
                var inv = s.invites.filter(function (i) { return i.id === d.invite; })[0];
                if (!inv) throw fail('Invitation expired');
                if (s.lobby || s.operation) throw fail('Leave your current crew first');
                s.invites = s.invites.filter(function (i) { return i !== inv; });
                var owner = PEOPLE[inv.from.id];
                var members = [member(owner, 'confirmed'), member(PEOPLE.p3, 'confirmed'), member(s.player, 'pending')];
                s.lobby = {
                    id: 'l' + Date.now(), contract: inv.contract, role: 'support', owner: owner.id, max: inv.contract.crew.max,
                    members: members, split: { p2: 40, p3: 30, p1: 30 }, version: 3, total: pay(inv.contract), consumesX: false,
                };
                openCrewThread(s.lobby);
            },
            decline: function (d) { s.invites = s.invites.filter(function (i) { return i.id !== d.invite; }); },
            ack: function (d) { if (s.result && s.result.id === d.result) s.result = null; },
            seen: function () { s.contracts.forEach(function (c) { c.fresh = false; }); },
        };

        var DIRECTOR = {
            invite: function () {
                var c = cerberus();
                var inv = { id: 'i' + Date.now(), from: { id: 'p2', handle: 'Tracksuit', tag: 'TRK' }, contract: c, sent: Date.now() };
                s.invites.unshift(inv);
                notify('NETWORK', 'Tracksuit invited you to an operation.\n' + c.code + ' · ' + c.tier, { invite: inv.id });
            },
            contracts: function () {
                var add = feed()[Math.floor(Math.random() * 3)];
                add.code = ['HALCYON', 'MERIDIAN', 'PALISADE', 'ORCHID', 'TANGENT'][Math.floor(Math.random() * 5)];
                add.fresh = true;
                s.contracts.unshift(add);
                s.contracts.length = Math.min(s.contracts.length, 6);
                notify('NETWORK', 'New contracts available.', { view: 'contracts' });
            },
            message: function () {
                var lines = [
                    ['t-lou', 'Word is a flatbed is working the Rockford lots tonight. Might be nothing.', 'TIP'],
                    ['t-7q', 'Client wants the next one cleaner. Take your time with it.', null],
                    ['t-lou', 'If you need a quiet garage in La Mesa, ask for Ramon.', 'TIP'],
                ];
                var l = lines[Math.floor(Math.random() * lines.length)];
                var t = thread(l[0]);
                post(l[0], t.contact, l[1], l[2] ? { tag: l[2] } : null);
            },
            offer: function () {
                s.standing.xAuth = true;
                s.offer = xOffer();
                notify('NETWORK', 'Private offer received.', { view: 'contracts' });
            },
            identify: function () {
                var op = s.operation; if (!op) return;
                intel('TARGET', 'Identified', 'known');
                intel('SECURITY', op.contract.tier === 'X' ? '▒▒▒▒▒▒▒▒' : op.contract.tier === 'A' ? 'Aftermarket encrypted immobilizer' : 'OEM immobilizer', 'alert');
                op.phase = { n: 2, title: 'SECURITY BYPASS' };
                op.objective = 'Security bypass required.';
                var X = op.contract.tier === 'X', A = op.contract.tier === 'A';
                op.security = {
                    title: 'VEHICLE SECURITY', system: 'ECU HANDSHAKE',
                    hardware: X ? null : A ? 'AFTERMARKET ENCRYPTED IMMOBILIZER' : 'OEM IMMOBILIZER',
                    lines: [['CHALLENGE', 'RECEIVED', 'known'], ['KEY SEQUENCE', X ? '??:??:??:??' : '7A:F4:19:CC', 'known'], ['AUTHORIZATION', 'PENDING', 'unknown']]
                        .concat(A ? [['CHALLENGE MODE', 'ROLLING', 'alert']] : []),
                    attempt: 1, attempts: 3, scrambled: X,
                };
                log('Target identified.');
                heat(0.48); chatter('identify');
                notify(op.contract.code, 'Target identified.', { view: 'operation' });
            },
            attempt: function () {
                var sec = s.operation && s.operation.security; if (!sec) return;
                sec.attempt = Math.min(sec.attempts, sec.attempt + 1);
                sec.lines.forEach(function (l) { if (l[0] === 'AUTHORIZATION') { l[1] = 'FAILED'; l[2] = 'alert'; } if (l[0] === 'KEY SEQUENCE' && !sec.scrambled) l[1] = ['3C:91:E0:5B', 'D2:07:AF:44', 'B8:6E:12:F9'][sec.attempt % 3]; });
                log('Authorization failed.');
            },
            bypass: function () {
                var op = s.operation; if (!op) return;
                if (op.security) op.security.lines.forEach(function (l) { if (l[0] === 'AUTHORIZATION') { l[1] = 'GRANTED'; l[2] = 'ok'; } });
                intel('SECURITY', 'Bypassed', 'ok');
                intel('TRACKING', 'Signal detected', 'alert');
                op.phase = { n: 3, title: 'TRACKING DEVICE' };
                op.objective = 'Tracker signal detected.';
                op.tracker = { status: 'ACTIVE', source: 'VEHICLE', strength: -61, note: 'Locate and disable the transmitting unit.' };
                if (op.contract.tier === 'A' || op.contract.tier === 'X') op.tracker.note = 'Transmission active. Manual intervention required.';
                log('Security bypassed. Tracking device detected.');
                heat(0.72); chatter('bypass');
                notify(op.contract.code, 'New intelligence available.', { view: 'operation' });
            },
            signal: function () {
                var tr = s.operation && s.operation.tracker; if (!tr || tr.status !== 'ACTIVE') return;
                tr.strength = Math.max(-95, Math.min(-35, tr.strength + Math.round((Math.random() - 0.4) * 14)));
                emit('signal', { strength: tr.strength });
                return 'silent';
            },
            untrack: function () {
                var op = s.operation; if (!op) return;
                if (op.tracker) { op.tracker.status = 'CLEAR'; op.tracker.strength = null; }
                intel('TRACKING', 'Clear', 'ok');
                op.phase = { n: 4, title: 'DELIVERY' };
                op.objective = 'Deliver vehicle.';
                op.delivery = { condition: 86, tracking: 'CLEAR', location: 'RECEIVED', distance: 3.8, area: 'LA MESA', world: { x: 820, y: -1150 }, ends: Date.now() + 8.7 * MIN };
                op.map = { area: 'LA MESA', world: { x: 820, y: -1150, r: 90 }, point: { x: 820, y: -1150 }, updated: Date.now() };
                log('Tracking clear. Delivery location received.');
                heat(0.44); chatter('untrack');
                notify(op.contract.code, 'Delivery location received.', { view: 'operation' });
            },
            drive: function () {
                var d = s.operation && s.operation.delivery; if (!d) return;
                d.distance = Math.max(0.1, +(d.distance - 0.7).toFixed(1));
                d.condition = Math.max(40, d.condition - (Math.random() < 0.3 ? 3 : 0));
            },
            disconnect: function () {
                var op = s.operation; if (!op) return;
                var m = op.crew.filter(function (x) { return x.id !== s.player.id && x.online; })[0];
                if (m) { m.online = false; log(m.handle + ' disconnected.'); }
            },
            deliver: function () { if (s.operation) close('complete'); },
            fail: function () { if (s.operation) close('failed'); },
        };

        return {
            hello: function () { return { backend: 'network', version: 1, coin: s.coin, player: s.player }; },
            state: function () { return view(); },
            call: function (action, data) {
                var fn = ACTIONS[action];
                if (!fn) throw fail('Unknown request');
                fn(data || {});
                return view();
            },
            direct: function (step) {
                var fn = DIRECTOR[step];
                if (!fn) return;
                if (fn() !== 'silent') push();
            },
            on: function (fn) { listeners.push(fn); },
            stop: function () { timers.forEach(clearTimeout); timers = []; },
        };
    }

    global.NET = global.NET || {};
    global.NET.DemoWorld = DemoWorld;
})(window);
