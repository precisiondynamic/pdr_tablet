/*
 * LSX market engine.
 *
 * Prices are a pure function of (coin, time): multi-octave value noise on log-price, plus a
 * shared "market" component so coins move together like a real market. Because it's
 * deterministic, every client computes the same price for the same moment without a server,
 * history for any range is available instantly, and a server can run the exact same code to
 * validate trades.
 */
(function (global) {
    'use strict';

    var SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN, DAY = 24 * HOUR;

    var COINS = [
        {
            sym: 'LSC', name: 'Los Santos Coin', base: 64200, vol: 0.9, supply: 19.64e6, color: '#f7931a', seed: 11,
            about: 'The original city coin. Mined by warehouse rigs from Cypress Flats to Paleto Bay, LSC is the reserve asset of the Los Santos crypto scene and the pair everything else is quoted against.',
        },
        {
            sym: 'VNW', name: 'Vinewood', base: 3150, vol: 1.1, supply: 120.2e6, color: '#7b7bef', seed: 23,
            about: 'Vinewood runs the smart contracts behind half the city’s nightlife: ticketing, club memberships and the occasional NFT premiere. Fees are paid in VNW.',
        },
        {
            sym: 'MZE', name: 'Maze Dollar', base: 1, vol: 0, stable: true, supply: 83.1e9, color: '#26a17b', seed: 31,
            about: 'A dollar-pegged stablecoin issued against reserves held in downtown bank vaults. Used to park funds between trades without leaving the exchange.',
        },
        {
            sym: 'CHD', name: 'Chiliad', base: 148.2, vol: 1.35, supply: 441e6, color: '#3a944a', seed: 47,
            about: 'A fast settlement network named after the mountain its founders swear they once climbed. Popular for moving value between counties.',
        },
        {
            sym: 'ZNC', name: 'Zancudo', base: 41.2, vol: 1.3, supply: 96.5e6, color: '#6f8396', seed: 59,
            about: 'Privacy-focused coin with shielded transfers. Its whitepaper was leaked from a server rack nobody will admit to owning.',
        },
        {
            sym: 'DPR', name: 'Del Perro', base: 7.85, vol: 1.55, supply: 1.02e9, color: '#2190a4', seed: 71,
            about: 'The beach-side payments coin. Accepted at more pier vendors than cash, according to its own marketing.',
        },
        {
            sym: 'PLT', name: 'Paleto', base: 12.4, vol: 1.5, supply: 612e6, color: '#e66100', seed: 83,
            about: 'Community coin from the north coast. Small-town governance, big-city volatility.',
        },
        {
            sym: 'SND', name: 'Sandy', base: 2.18, vol: 1.85, supply: 3.4e9, color: '#c88800', seed: 97,
            about: 'Desert-mined and proudly unregulated. Its hashrate doubles whenever the Senora Freeway power grid is having a good day.',
        },
        {
            sym: 'GRV', name: 'Grove', base: 0.62, vol: 2.1, supply: 8.8e9, color: '#26a269', seed: 103,
            about: 'Street-born and community-owned. Grove holders are loud, loyal and very active on Bleeter.',
        },
        {
            sym: 'CHOP', name: 'Chop Inu', base: 0.0834, vol: 2.9, supply: 420e9, color: '#c01c28', seed: 131,
            about: 'A meme coin named after a dog. It has no utility, no roadmap and a larger market cap than most real businesses in the city.',
        },
    ];

    // log-price octaves: [period, amplitude]
    var OCTAVES = [
        [45 * DAY, 0.28],
        [9 * DAY, 0.15],
        [2 * DAY, 0.075],
        [8 * HOUR, 0.04],
        [2 * HOUR, 0.02],
        [25 * MIN, 0.009],
        [5 * MIN, 0.004],
        [40 * SEC, 0.0015],
    ];

    function hash(seed, i) {
        var x = (Math.imul(i | 0, 374761393) + Math.imul(seed | 0, 668265263)) | 0;
        x = Math.imul(x ^ (x >>> 13), 1274126177);
        x = x ^ (x >>> 16);
        return ((x >>> 0) / 4294967295) * 2 - 1;
    }

    /** smooth 1-D value noise in [-1, 1] */
    function noise(seed, x) {
        var i = Math.floor(x), f = x - i;
        var u = f * f * (3 - 2 * f);
        return hash(seed, i) * (1 - u) + hash(seed, i + 1) * u;
    }

    function fbm(seed, t) {
        var v = 0;
        for (var k = 0; k < OCTAVES.length; k++) v += OCTAVES[k][1] * noise(seed + k * 1013, t / OCTAVES[k][0]);
        return v;
    }

    var bySym = {};
    COINS.forEach(function (c, i) { c.rank = i + 1; bySym[c.sym] = c; });

    /** Price of a coin at time t (ms). */
    function price(sym, t) {
        var c = bySym[sym];
        if (!c) return 0;
        if (c.stable) return 1 + 0.0015 * noise(c.seed, t / (20 * MIN)) + 0.0005 * noise(c.seed + 7, t / MIN);
        var market = fbm(1, t);            // shared component
        var own = fbm(c.seed, t);
        return c.base * Math.exp(c.vol * (0.45 * market + 0.75 * own));
    }

    function change(sym, now, span) {
        var p0 = price(sym, now - span);
        return p0 ? price(sym, now) / p0 - 1 : 0;
    }

    /** Evenly spaced samples: [{ t, p }] */
    function series(sym, from, to, points) {
        var out = [];
        var step = (to - from) / (points - 1);
        for (var i = 0; i < points; i++) {
            var t = from + step * i;
            out.push({ t: t, p: price(sym, t) });
        }
        return out;
    }

    /** OHLC candles: each bucket sampled at 6 points (enough for believable wicks). */
    function candles(sym, from, to, count) {
        var out = [];
        var span = (to - from) / count;
        for (var i = 0; i < count; i++) {
            var t0 = from + span * i;
            var o = price(sym, t0), c = price(sym, t0 + span), hi = Math.max(o, c), lo = Math.min(o, c);
            for (var k = 1; k < 6; k++) {
                var p = price(sym, t0 + (span * k) / 6);
                if (p > hi) hi = p;
                if (p < lo) lo = p;
            }
            out.push({ t: t0, o: o, h: hi, l: lo, c: c });
        }
        return out;
    }

    function stats(sym, now) {
        var c = bySym[sym];
        var day = series(sym, now - DAY, now, 97);
        var year = series(sym, now - 365 * DAY, now, 366);
        var p = price(sym, now);
        var hi24 = -Infinity, lo24 = Infinity, hiY = -Infinity, loY = Infinity;
        day.forEach(function (s) { if (s.p > hi24) hi24 = s.p; if (s.p < lo24) lo24 = s.p; });
        year.forEach(function (s) { if (s.p > hiY) hiY = s.p; if (s.p < loY) loY = s.p; });
        var cap = p * c.supply;
        // turnover of ~2–6 % of market cap per day, busier when the price is moving
        var move = Math.abs(change(sym, now, DAY));
        var volume = cap * (0.02 + 0.02 * (noise(c.seed + 99, now / (6 * HOUR)) + 1) + Math.min(move, 0.2) * 0.3);
        return {
            price: p,
            change1h: change(sym, now, HOUR),
            change24h: change(sym, now, DAY),
            change7d: change(sym, now, 7 * DAY),
            high24h: hi24, low24h: lo24,
            highYear: Math.max(hiY, p), lowYear: Math.min(loY, p),
            marketCap: cap,
            volume24h: volume,
            supply: c.supply,
        };
    }

    /** Market-wide numbers for the Markets header. */
    function overview(now) {
        var cap = 0, cap24 = 0, vol = 0, changes = [];
        COINS.forEach(function (c) {
            var s = stats(c.sym, now);
            cap += s.marketCap;
            cap24 += s.marketCap / (1 + s.change24h);
            vol += s.volume24h;
            if (!c.stable) changes.push(s.change24h);
        });
        var avg = changes.reduce(function (a, b) { return a + b; }, 0) / changes.length;
        // sentiment 0–100 from the average 24 h move of non-stable coins
        var sentiment = Math.max(0, Math.min(100, Math.round(50 + avg * 900)));
        var label = sentiment < 20 ? 'Extreme Fear' : sentiment < 42 ? 'Fear' : sentiment < 58 ? 'Neutral' : sentiment < 80 ? 'Greed' : 'Extreme Greed';
        return {
            marketCap: cap,
            change24h: cap / cap24 - 1,
            volume24h: vol,
            dominance: (price('LSC', now) * bySym.LSC.supply) / cap,
            sentiment: sentiment,
            sentimentLabel: label,
        };
    }

    global.LSX = global.LSX || {};
    global.LSX.Market = {
        COINS: COINS, coin: function (sym) { return bySym[sym] || null; },
        price: price, change: change, series: series, candles: candles, stats: stats, overview: overview,
        SEC: SEC, MIN: MIN, HOUR: HOUR, DAY: DAY,
    };
})(window);
