/*
 * LSX backends. Both expose the same async API:
 *
 *   state()                      → { cash, bank, bankName, holdings: { SYM: { amount, cost } }, address, txs }
 *   trade({ side, sym, amount, usd }) → { tx, state }  amount in coins, or usd to spend (buys)
 *   transfer({ sym, amount, to })→ { tx, state }
 *   deposit(usd) / withdraw(usd) → { tx, state }
 *
 * DemoBackend  — runs on the tablet, persisted with tablet.storage. Used when no server answers.
 * LiveBackend  — forwards everything to the owning resource via tablet.request('crypto:*').
 *                See apps/crypto/BACKEND.md for the contract a server has to implement.
 */
(function (global) {
    'use strict';
    var M = global.LSX.Market;

    var FEE_RATE = 0.005;        // 0.5 % trading fee
    var MIN_FEE = 0.25;
    var MIN_ORDER = 10;          // USD
    var NETWORK_FEE_USD = 0.8;   // flat network fee for transfers, charged in the coin

    function hex(n) { var s = ''; for (var i = 0; i < n; i++) s += '0123456789abcdef'[Math.floor(Math.random() * 16)]; return s; }
    function newAddress() { var a = 'lsx1', cs = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'; for (var i = 0; i < 38; i++) a += cs[Math.floor(Math.random() * cs.length)]; return a; }
    function round(n, dp) { var f = Math.pow(10, dp); return Math.round(n * f) / f; }

    function Fail(message) { var e = new Error(message); e.user = true; return e; }

    /* ------------------------------------------------------------------ */
    /* shared accounting (the live server should do the same)             */
    /* ------------------------------------------------------------------ */

    /**
     * Market order. Buys can be sized in coins (`amount`) or by what to spend (`usd`, fee
     * included) — the latter is resolved at the execution price, so "spend my whole balance"
     * can never overshoot when the price ticks up between review and confirm.
     */
    function applyTrade(s, side, sym, amount, t, usd) {
        var coin = M.coin(sym);
        if (!coin) throw Fail('Unknown asset');
        var price = M.price(sym, t);
        if (side === 'buy' && usd > 0) {
            usd = Math.min(usd, s.cash);
            amount = (usd - Math.max(MIN_FEE, usd * FEE_RATE / (1 + FEE_RATE))) / price;
        }
        if (!(amount > 0)) throw Fail('Enter an amount');
        var notional = amount * price;
        if (notional < MIN_ORDER) throw Fail('Minimum order is $' + MIN_ORDER);
        var fee = Math.max(MIN_FEE, notional * FEE_RATE);
        var h = s.holdings[sym] || { amount: 0, cost: 0 };

        if (side === 'buy') {
            if (notional + fee > s.cash + 1e-9) throw Fail('Not enough cash — deposit funds first');
            s.cash = Math.max(0, s.cash - (notional + fee));
            h.cost += notional + fee;
            h.amount += amount;
        } else if (side === 'sell') {
            if (amount > h.amount + 1e-12) throw Fail('You only have ' + round(h.amount, 8) + ' ' + sym);
            var share = h.amount ? amount / h.amount : 1;
            h.cost -= h.cost * share;
            h.amount -= amount;
            s.cash += notional - fee;
        } else {
            throw Fail('Unknown order side');
        }
        if (h.amount < 1e-10) { h.amount = 0; h.cost = 0; }
        s.holdings[sym] = h;
        return { id: 't' + t.toString(36) + hex(4), hash: '0x' + hex(64), type: side, sym: sym, amount: amount, price: price, usd: notional, fee: fee, time: t, status: 'completed' };
    }

    function networkFee(sym, t) { return NETWORK_FEE_USD / M.price(sym, t); }

    function applyTransfer(s, sym, amount, to, t) {
        if (!/^lsx1[a-z0-9]{38}$/.test(to || '')) throw Fail('That isn’t a valid LSX address');
        if (to === s.address) throw Fail('You can’t send to your own address');
        if (!(amount > 0)) throw Fail('Enter an amount');
        var h = s.holdings[sym];
        var fee = networkFee(sym, t);
        if (!h || amount + fee > h.amount + 1e-12) throw Fail('Not enough ' + sym + ' (network fee ' + round(fee, 8) + ' ' + sym + ')');
        var share = (amount + fee) / h.amount;
        h.cost -= h.cost * share;
        h.amount -= amount + fee;
        if (h.amount < 1e-10) { h.amount = 0; h.cost = 0; }
        var price = M.price(sym, t);
        return { id: 't' + t.toString(36) + hex(4), hash: '0x' + hex(64), type: 'send', sym: sym, amount: amount, price: price, usd: amount * price, fee: fee * price, feeCoin: fee, to: to, time: t, status: 'completed' };
    }

    function applyCash(s, type, usd, t) {
        usd = round(usd, 2);
        if (!(usd >= 1)) throw Fail('Minimum is $1.00');
        if (type === 'deposit') {
            if (usd > s.bank) throw Fail('Not enough in ' + s.bankName);
            s.bank -= usd; s.cash += usd;
        } else {
            if (usd > s.cash + 1e-9) throw Fail('You only have ' + round(s.cash, 2) + ' available');
            s.cash -= usd; s.bank += usd;
        }
        return { id: 't' + t.toString(36) + hex(4), hash: '0x' + hex(64), type: type, usd: usd, fee: 0, time: t, status: 'completed' };
    }

    /* ------------------------------------------------------------------ */
    /* demo                                                                */
    /* ------------------------------------------------------------------ */

    /** A believable starting account: history replayed at the engine's historical prices. */
    function seedDemo(now) {
        var D = M.DAY;
        var s = { cash: 0, bank: 48250, bankName: 'Maze Bank •• 4471', holdings: {}, address: newAddress(), txs: [] };
        var script = [
            [34.2, 'deposit', null, 25000],
            [33.9, 'buy', 'LSC', 9000],
            [30.1, 'buy', 'VNW', 6000],
            [21.4, 'buy', 'CHD', 2500],
            [14.7, 'buy', 'CHOP', 1200],
            [12.2, 'sell', 'VNW', 0.4],
            [9.3, 'buy', 'ZNC', 1000],
            [8.1, 'payout', 'ZNC', 3.2, 'Unknown sender', 'Package delivered'],
            [4.4, 'payout', 'ZNC', 5.5, 'Unknown sender', 'Vehicle drop-off'],
            [6.1, 'receive', 'LSC', 0.0142],
            [3.6, 'buy', 'GRV', 400],
            [2.2, 'withdraw', null, 1500],
            [1.1, 'sell', 'CHOP', 0.5],
        ];
        script.forEach(function (row) {
            var t = Math.round(now - row[0] * D);
            var tx;
            if (row[1] === 'deposit' || row[1] === 'withdraw') {
                s.bank += row[1] === 'deposit' ? row[3] : 0;   // seed bank so the history balances
                tx = applyCash(s, row[1], row[3], t);
            } else if (row[1] === 'buy') {
                tx = applyTrade(s, 'buy', row[2], (row[3] - Math.max(MIN_FEE, row[3] * FEE_RATE)) / M.price(row[2], t), t);
            } else if (row[1] === 'sell') {
                var held = s.holdings[row[2]].amount;
                tx = applyTrade(s, 'sell', row[2], held * row[3], t);
            } else if (row[1] === 'payout') {
                tx = credit(s, row[2], row[3], t, { fromLabel: row[4], memo: row[5] });
            } else if (row[1] === 'receive') {
                var h = s.holdings[row[2]] || { amount: 0, cost: 0 };
                var p = M.price(row[2], t);
                h.amount += row[3];
                h.cost += row[3] * p;
                s.holdings[row[2]] = h;
                tx = { id: 't' + t.toString(36) + hex(4), hash: '0x' + hex(64), type: 'receive', sym: row[2], amount: row[3], price: p, usd: row[3] * p, fee: 0, from: newAddress(), time: t, status: 'completed' };
            }
            s.txs.unshift(tx);
        });
        s.bank = 48250;
        return s;
    }

    function credit(s, sym, amount, t, fields) {
        var h = s.holdings[sym] || { amount: 0, cost: 0 };
        var p = M.price(sym, t);
        h.amount += amount;
        h.cost += amount * p;
        s.holdings[sym] = h;
        var tx = { id: 't' + t.toString(36) + hex(4), hash: '0x' + hex(64), type: 'receive', sym: sym, amount: amount, price: p, usd: amount * p, fee: 0, time: t, status: 'completed' };
        for (var k in fields) tx[k] = fields[k];
        return tx;
    }

    // what the live server reports in state.features; the demo mirrors a default server
    var DEMO_FEATURES = { deposit: true, withdraw: true, withdrawFee: 0, dailyLimit: 0, withdrawnToday: 0, transfers: true, payoutCoin: 'ZNC' };

    function DemoBackend(tablet) {
        var s = null;
        var persist = function () {
            return tablet.inTablet ? tablet.storage.set('wallet', s) : Promise.resolve();
        };
        var result = function (tx) {
            s.txs.unshift(tx);
            if (s.txs.length > 400) s.txs.length = 400;
            return persist().then(function () { return { tx: tx, state: s }; });
        };
        var run = function (fn) {
            try { return result(fn(Date.now())); } catch (e) { return Promise.reject(e); }
        };
        return {
            mode: 'demo',
            payoutCoin: DEMO_FEATURES.payoutCoin,
            fees: { rate: FEE_RATE, min: MIN_FEE, minOrder: MIN_ORDER, network: networkFee },
            state: function () {
                if (s) return Promise.resolve(s);
                var load = tablet.inTablet ? tablet.storage.get('wallet').catch(function () { return null; }) : Promise.resolve(null);
                return load.then(function (stored) {
                    s = stored && stored.holdings && stored.address ? stored : seedDemo(Date.now());
                    s.features = DEMO_FEATURES;
                    if (!stored) persist();
                    return s;
                });
            },
            trade: function (o) { return run(function (t) { return applyTrade(s, o.side, o.sym, o.amount, t, o.usd); }); },
            transfer: function (o) { return run(function (t) { return applyTransfer(s, o.sym, o.amount, o.to, t); }); },
            deposit: function (usd) { return run(function (t) { return applyCash(s, 'deposit', usd, t); }); },
            withdraw: function (usd) { return run(function (t) { return applyCash(s, 'withdraw', usd, t); }); },
            reset: function () { s = seedDemo(Date.now()); s.features = DEMO_FEATURES; return persist().then(function () { return s; }); },
            /** Demo only: a job payout arriving (the live server does this via CryptoPay). */
            simulatePayout: function (o) {
                o = o || {};
                var sym = o.sym || DEMO_FEATURES.payoutCoin;
                var amount = o.usd ? o.usd / M.price(sym, Date.now()) : (o.amount || 1);
                return result(credit(s, sym, amount, Date.now(), { fromLabel: o.from || 'Unknown sender', memo: o.memo || 'Job payment' }));
            },
        };
    }

    /* ------------------------------------------------------------------ */
    /* live                                                                */
    /* ------------------------------------------------------------------ */

    function LiveBackend(tablet, hello) {
        var call = function (action, data) {
            return tablet.request('crypto:' + action, data || null, { timeout: 10000 }).then(function (res) {
                if (res && res.error) throw Fail(res.error);
                return res;
            });
        };
        return {
            mode: 'live',
            payoutCoin: hello.payoutCoin || 'ZNC',
            server: hello,
            fees: {
                rate: hello.feeRate != null ? hello.feeRate : FEE_RATE,
                min: hello.minFee != null ? hello.minFee : MIN_FEE,
                minOrder: hello.minOrder != null ? hello.minOrder : MIN_ORDER,
                network: hello.networkUsd != null
                    ? function (sym, t) { return hello.networkUsd / M.price(sym, t); }
                    : networkFee,
            },
            state: function () { return call('state'); },
            trade: function (o) { return call('trade', o); },
            transfer: function (o) { return call('transfer', o); },
            deposit: function (usd) { return call('deposit', { usd: usd }); },
            withdraw: function (usd) { return call('withdraw', { usd: usd }); },
        };
    }

    /** Live if the owning resource answers `crypto:hello` with { backend = 'lsx' }, else demo. */
    function connect(tablet) {
        if (!tablet.inTablet) return Promise.resolve(DemoBackend(tablet));
        return tablet.request('crypto:hello', { version: 1 }, { timeout: 2500 }).then(function (res) {
            return res && res.backend === 'lsx' ? LiveBackend(tablet, res) : DemoBackend(tablet);
        }, function () {
            return DemoBackend(tablet);
        });
    }

    global.LSX.Backend = { connect: connect, DEFAULT_FEATURES: DEMO_FEATURES, FEE_RATE: FEE_RATE, MIN_ORDER: MIN_ORDER };
})(window);
