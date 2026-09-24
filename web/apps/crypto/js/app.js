(function () {
    'use strict';
    var M = LSX.Market, F = LSX.Fmt, C = LSX.Charts;
    var T = PDRTablet;
    var h = Kit.h, fill = Kit.fill, icon = Kit.icon;

    var TICK_VISIBLE = 2000;
    var TICK_HIDDEN = 10000;

    var backend = null;
    var wallet = null;
    var prefs = { watch: ['LSC', 'VNW', 'CHOP'], alerts: [], chartMode: 'line', range: '1D', unseenAlerts: 0 };
    var route = { view: 'portfolio', sym: null, tab: null };
    var liveFns = [];              // updaters for the current view, run every tick
    var lastPrices = {};
    var marketSort = { key: 'rank', dir: 1 };
    var marketTab = 'all';
    var marketQuery = '';

    var content = document.getElementById('content');
    var nav = document.getElementById('nav');
    var ticker = document.getElementById('ticker');
    var account = document.getElementById('account');

    var h24 = function () { return T.settings.clock24h !== false; };
    var savePrefs = Kit.debounce(function () { if (T.inTablet) T.storage.set('prefs', prefs).catch(function () {}); }, 300);

    /* ================================================================== */
    /* building blocks                                                     */
    /* ================================================================== */

    function coinIcon(sym, cls) {
        var c = M.coin(sym);
        return h('span', { class: 'coin-icon ' + (cls || ''), style: { '--coin': c.color } }, h('span', null, sym === 'CHOP' ? 'Ch' : sym[0]));
    }

    function changeTag(x, cls) {
        var t = F.trend(x);
        return h('span', { class: 'chg is-' + t + ' ' + (cls || '') },
            t === 'flat' ? null : icon(t === 'up' ? 'arrowUp' : 'arrowDown', 'chg-arrow'),
            F.pct(Math.abs(x)).replace(/^[+−]/, ''));
    }

    function setChange(el, x) {
        var t = F.trend(x);
        el.className = el.className.replace(/is-(up|down|flat)/, 'is-' + t);
        fill(el, t === 'flat' ? null : icon(t === 'up' ? 'arrowUp' : 'arrowDown', 'chg-arrow'), F.pct(Math.abs(x)).replace(/^[+−]/, ''));
    }

    /** Price text that flashes green/red when it moves. */
    function livePrice(sym, cls) {
        var el = h('span', { class: 'num ' + (cls || '') }, F.price(M.price(sym, Date.now())));
        live(function (now) {
            var p = M.price(sym, now);
            var prev = parseFloat(el.dataset.p || '0');
            el.textContent = F.price(p);
            if (prev && p !== prev) {
                el.classList.remove('flash-up', 'flash-down');
                void el.offsetWidth;
                el.classList.add(p > prev ? 'flash-up' : 'flash-down');
            }
            el.dataset.p = String(p);
        });
        return el;
    }

    function liveChange(sym, span, cls) {
        var el = changeTag(M.change(sym, Date.now(), span), cls);
        live(function (now) { setChange(el, M.change(sym, now, span)); });
        return el;
    }

    function live(fn) { liveFns.push(fn); }

    function card(title, body, extra) {
        return h('section', { class: 'cx-card ' + ((extra && extra.cls) || '') },
            title ? h('header', { class: 'cx-card-head' }, h('h3', null, title), extra && extra.actions) : null,
            body);
    }

    function empty(glyph, title, desc, action) {
        return h('div', { class: 'status-page cx-empty' }, icon(glyph), h('div', { class: 'status-title' }, title),
            desc ? h('div', { class: 'status-desc' }, desc) : null, action || null);
    }

    function segmented(options, value, onChange, cls) {
        return h('div', { class: 'linked ' + (cls || '') }, options.map(function (o) {
            return h('button', { class: o[0] === value ? 'is-active' : '', onClick: function () { onChange(o[0]); } }, o[1]);
        }));
    }

    function holding(sym) { return (wallet && wallet.holdings[sym]) || { amount: 0, cost: 0 }; }

    function portfolioValue(t) {
        var v = wallet.cash;
        for (var sym in wallet.holdings) v += wallet.holdings[sym].amount * M.price(sym, t);
        return v;
    }

    function ownedSyms() {
        return Object.keys(wallet.holdings).filter(function (s) { return wallet.holdings[s].amount > 0 && M.coin(s); })
            .sort(function (a, b) { return holding(b).amount * M.price(b, Date.now()) - holding(a).amount * M.price(a, Date.now()); });
    }

    var RANGES = {
        '1H': { span: M.HOUR, points: 61, candles: 30, fmt: function (t) { return Kit.clock(t, h24()); } },
        '1D': { span: M.DAY, points: 145, candles: 48, fmt: function (t) { return Kit.clock(t, h24()); } },
        '1W': { span: 7 * M.DAY, points: 169, candles: 56, fmt: function (t) { return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(t).getDay()]; } },
        '1M': { span: 30 * M.DAY, points: 181, candles: 60, fmt: function (t) { var d = new Date(t); return d.getDate() + ' ' + F.MONTHS[d.getMonth()]; } },
        '1Y': { span: 365 * M.DAY, points: 366, candles: 52, fmt: function (t) { var d = new Date(t); return F.MONTHS[d.getMonth()] + ' ’' + String(d.getFullYear()).slice(2); } },
    };

    /* ================================================================== */
    /* navigation                                                          */
    /* ================================================================== */

    var NAV = [
        ['portfolio', 'Portfolio', 'wallet'],
        ['markets', 'Markets', 'chart'],
        ['activity', 'Activity', 'list'],
        ['transfer', 'Send & Receive', 'swap'],
        ['alerts', 'Price Alerts', 'bell'],
    ];

    function go(view, sym, tab) {
        route = { view: view, sym: sym || null, tab: tab || null };
        if (view === 'alerts' && prefs.unseenAlerts) { prefs.unseenAlerts = 0; syncBadge(); savePrefs(); }
        render();
        content.scrollTop = 0;
    }

    function renderNav() {
        fill(nav, NAV.map(function (n) {
            var active = route.view === n[0] || (route.view === 'coin' && n[0] === 'markets');
            return h('button', { class: 'kit-nav-row' + (active ? ' is-selected' : ''), onClick: function () { go(n[0]); } },
                icon(n[2]), h('span', null, n[1]),
                n[0] === 'alerts' && prefs.unseenAlerts ? h('span', { class: 'cx-nav-badge' }, String(prefs.unseenAlerts)) : null);
        }));
    }

    function renderAccount() {
        var demo = backend.mode === 'demo';
        fill(account,
            h('div', { class: 'cx-account-top' },
                h('span', { class: 'cx-mode ' + (demo ? 'is-demo' : 'is-live') }, h('i'), demo ? 'Demo account' : 'Live'),
                demo ? h('button', { class: 'btn btn-flat cx-reset', title: 'Reset demo account', onClick: resetDemo }, icon('refresh')) : null),
            h('div', { class: 'cx-account-bank' }, icon('bank'),
                h('div', null, h('span', { class: 'dim' }, wallet.bankName || 'Bank'), h('b', { class: 'num' }, F.usd(wallet.bank)))));
    }

    function render() {
        liveFns = [];
        renderNav();
        renderAccount();
        var view = VIEWS[route.view] || VIEWS.portfolio;
        fill(content, view());
        requestAnimationFrame(function () { liveFns.forEach(function (fn) { if (fn.layout) fn(Date.now()); }); });
    }

    /* ================================================================== */
    /* ticker tape                                                         */
    /* ================================================================== */

    function renderTicker() {
        var now = Date.now();
        var items = M.COINS.map(function (c) {
            var ch = M.change(c.sym, now, M.DAY);
            return h('button', { class: 'tick', onClick: function () { go('coin', c.sym); } },
                coinIcon(c.sym, 'is-xs'), h('b', null, c.sym), h('span', { class: 'num' }, F.price(M.price(c.sym, now))),
                h('span', { class: 'num chg-text is-' + F.trend(ch) }, F.pct(ch)));
        });
        // duplicated so the marquee loops seamlessly
        fill(ticker, h('div', { class: 'ticker-track' }, items, items.map(function (n) { return n.cloneNode(true); })));
        ticker.querySelectorAll('.tick').forEach(function (el, i) {
            var sym = M.COINS[i % M.COINS.length].sym;
            el.onclick = function () { go('coin', sym); };
        });
    }

    function updateTicker(now) {
        var ticks = ticker.querySelectorAll('.tick');
        ticks.forEach(function (el, i) {
            var sym = M.COINS[i % M.COINS.length].sym;
            var ch = M.change(sym, now, M.DAY);
            el.children[2].textContent = F.price(M.price(sym, now));
            el.children[3].textContent = F.pct(ch);
            el.children[3].className = 'num chg-text is-' + F.trend(ch);
        });
    }

    /* ================================================================== */
    /* views                                                               */
    /* ================================================================== */

    var VIEWS = {};

    /* ---------------- portfolio ---------------- */

    VIEWS.portfolio = function () {
        var now = Date.now();
        var owned = ownedSyms();
        var range = prefs.portfolioRange || '1D';

        var totalEl = h('div', { class: 'cx-total num' });
        var dayEl = h('div', { class: 'cx-total-change num' });
        var chartHost = h('div', { class: 'cx-chart cx-chart-sm' });
        var hoverEl = h('div', { class: 'cx-chart-hover dim num' });

        function drawChart() {
            var r = RANGES[range];
            var t1 = Date.now();
            var pts = [];
            for (var i = 0; i < 97; i++) { var t = t1 - r.span + (r.span * i) / 96; pts.push({ t: t, p: portfolioValue(t) }); }
            C.priceChart(chartHost, {
                points: pts, mode: 'line', formatPrice: F.compact, formatTime: r.fmt,
                onHover: function (pt) { hoverEl.textContent = pt ? F.usd(pt.p) + ' · ' + F.when(pt.t, h24()) : ''; },
            });
        }
        var updateTotals = function (t) {
            var v = portfolioValue(t);
            var v0 = portfolioValue(t - RANGES[range].span);
            totalEl.textContent = F.usd(v);
            var diff = v - v0;
            fill(dayEl, h('span', { class: 'chg-text is-' + F.trend(diff / (v0 || 1)) }, (diff >= 0 ? '+' : '−') + F.usd(Math.abs(diff)) + ' (' + F.pct(diff / (v0 || 1)) + ')'), h('span', { class: 'dim' }, ' ' + { '1H': 'past hour', '1D': 'today', '1W': 'past week', '1M': 'past month', '1Y': 'past year' }[range]));
        };
        updateTotals(now);
        live(updateTotals);
        var redraw = function () { drawChart(); };
        redraw.layout = true;
        live(redraw);

        var actions = h('div', { class: 'cx-actions' },
            [['Buy', 'plus', function () { openTrade('buy'); }],
                ['Sell', 'arrowDown', function () { openTrade('sell'); }],
                ['Send', 'send', function () { go('transfer', null, 'send'); }],
                ['Receive', 'qr', function () { go('transfer', null, 'receive'); }],
                ['Deposit', 'bank', function () { go('transfer', null, 'cash'); }]].map(function (a) {
                return h('button', { class: 'cx-action', onClick: a[2] }, h('span', { class: 'cx-action-icon' }, icon(a[1])), h('span', null, a[0]));
            }));

        // allocation
        var slices = owned.map(function (sym) { return { sym: sym, value: holding(sym).amount * M.price(sym, now), color: M.coin(sym).color }; });
        if (wallet.cash > 0.01) slices.push({ sym: 'USD', value: wallet.cash, color: '#77767b' });
        var total = slices.reduce(function (a, s) { return a + s.value; }, 0) || 1;
        var allocation = card('Allocation', slices.length
            ? h('div', { class: 'cx-alloc' },
                h('div', { class: 'cx-alloc-donut' }, C.donut(slices, 176, 22),
                    h('div', { class: 'cx-alloc-center' }, h('b', { class: 'num' }, String(owned.length)), h('span', { class: 'dim' }, owned.length === 1 ? 'asset' : 'assets'))),
                h('div', { class: 'cx-alloc-legend' }, slices.map(function (s) {
                    return h('div', { class: 'cx-legend-row' }, h('i', { style: { background: s.color } }),
                        h('span', null, s.sym === 'USD' ? 'Cash' : M.coin(s.sym).name), h('b', { class: 'num' }, (s.value / total * 100).toFixed(1) + '%'));
                })))
            : empty('wallet', 'Nothing here yet', 'Deposit cash to start trading.'), { cls: 'cx-alloc-card' });

        // holdings
        var rows = owned.map(function (sym) {
            var c = M.coin(sym), hd = holding(sym);
            var valueEl = h('b', { class: 'num' });
            var plEl = h('div', { class: 'num' });
            var upd = function (t) {
                var v = hd.amount * M.price(sym, t);
                var pl = v - hd.cost;
                valueEl.textContent = F.usd(v);
                plEl.className = 'num chg-text is-' + F.trend(pl);
                plEl.textContent = (pl >= 0 ? '+' : '−') + F.usd(Math.abs(pl)) + ' · ' + F.pct(hd.cost ? pl / hd.cost : 0);
            };
            upd(now); live(upd);
            return h('button', { class: 'cx-row cx-hold-row', onClick: function () { go('coin', sym); } },
                h('div', { class: 'cx-asset' }, coinIcon(sym), h('div', null, h('b', null, c.name), h('span', { class: 'dim' }, sym))),
                h('div', { class: 'cx-cell-r' }, livePrice(sym), liveChange(sym, M.DAY, 'is-sm')),
                h('div', { class: 'cx-cell-r' }, valueEl, h('span', { class: 'dim num' }, F.amount(hd.amount, sym))),
                h('div', { class: 'cx-cell-r' }, h('span', { class: 'num' }, F.price(hd.amount ? hd.cost / hd.amount : 0)), h('span', { class: 'dim' }, 'avg cost')),
                h('div', { class: 'cx-cell-r' }, plEl, h('span', { class: 'dim' }, 'unrealised')));
        });

        var holdings = card('Your assets', owned.length
            ? h('div', { class: 'cx-table' },
                h('div', { class: 'cx-row cx-row-head cx-hold-row' }, h('span', null, 'Asset'), h('span', null, 'Price'), h('span', null, 'Holdings'), h('span', null, 'Avg cost'), h('span', null, 'P&L')),
                rows)
            : empty('chart', 'No assets', 'Buy your first coin from the Markets page.',
                h('button', { class: 'btn btn-suggested btn-pill', onClick: function () { go('markets'); } }, 'Browse markets')),
        { actions: h('span', { class: 'dim num' }, 'Cash ' + F.usd(wallet.cash)) });

        // movers
        var movers = M.COINS.filter(function (c) { return !c.stable; })
            .map(function (c) { return { sym: c.sym, ch: M.change(c.sym, now, M.DAY) }; })
            .sort(function (a, b) { return Math.abs(b.ch) - Math.abs(a.ch); }).slice(0, 4);

        return h('div', { class: 'cx-page' },
            h('div', { class: 'cx-hero' },
                h('div', { class: 'cx-hero-main cx-card' },
                    h('div', { class: 'cx-hero-top' },
                        h('div', null, h('div', { class: 'cx-label' }, 'Total balance'), totalEl, dayEl),
                        segmented(['1H', '1D', '1W', '1M', '1Y'].map(function (r) { return [r, r]; }), range, function (r) { prefs.portfolioRange = r; savePrefs(); render(); })),
                    chartHost, hoverEl, actions),
                allocation),
            h('div', { class: 'cx-movers' }, movers.map(function (m) {
                var spark = h('div', { class: 'cx-mover-spark' }, C.sparkline(M.series(m.sym, now - M.DAY, now, 48), { width: 140, height: 40 }));
                return h('button', { class: 'cx-card cx-mover', onClick: function () { go('coin', m.sym); } },
                    h('div', { class: 'cx-mover-top' }, coinIcon(m.sym, 'is-sm'), h('b', null, m.sym), liveChange(m.sym, M.DAY, 'is-sm')),
                    livePrice(m.sym, 'cx-mover-price'), spark);
            })),
            holdings);
    };

    /* ---------------- markets ---------------- */

    VIEWS.markets = function () {
        var now = Date.now();
        var o = M.overview(now);
        var gauge = h('div', { class: 'cx-gauge' }, h('div', { class: 'cx-gauge-fill', style: { width: o.sentiment + '%' } }), h('i', { style: { left: o.sentiment + '%' } }));

        var head = h('div', { class: 'cx-stats-strip' },
            stat('Market cap', F.compact(o.marketCap), changeTag(o.change24h, 'is-sm')),
            stat('24h volume', F.compact(o.volume24h)),
            stat('LSC dominance', (o.dominance * 100).toFixed(1) + '%'),
            stat('Sentiment', o.sentiment + ' · ' + o.sentimentLabel, gauge));

        var search = h('input', { class: 'entry cx-search', type: 'text', placeholder: 'Search coins', value: marketQuery, spellcheck: false });
        var tableHost = h('div', { class: 'cx-table cx-market-table' });
        search.addEventListener('input', function () { marketQuery = search.value.trim().toLowerCase(); drawTable(); });

        function sortable(key, label, cls) {
            var active = marketSort.key === key;
            return h('button', {
                class: 'cx-sort ' + (cls || '') + (active ? ' is-active' : ''),
                onClick: function () {
                    marketSort = { key: key, dir: active ? -marketSort.dir : (key === 'name' || key === 'rank' ? 1 : -1) };
                    drawTable();
                },
            }, label, active ? icon(marketSort.dir > 0 ? 'arrowUp' : 'arrowDown', 'cx-sort-arrow') : null);
        }

        function drawTable() {
            var t = Date.now();
            var list = M.COINS.map(function (c) { return { c: c, s: M.stats(c.sym, t) }; });
            if (marketTab === 'watch') list = list.filter(function (r) { return prefs.watch.indexOf(r.c.sym) !== -1; });
            if (marketTab === 'gainers') list = list.filter(function (r) { return r.s.change24h > 0; }).sort(function (a, b) { return b.s.change24h - a.s.change24h; });
            if (marketTab === 'losers') list = list.filter(function (r) { return r.s.change24h < 0; }).sort(function (a, b) { return a.s.change24h - b.s.change24h; });
            if (marketQuery) list = list.filter(function (r) { return (r.c.name + ' ' + r.c.sym).toLowerCase().indexOf(marketQuery) !== -1; });
            if (marketTab === 'all' || marketTab === 'watch') {
                var k = marketSort.key, d = marketSort.dir;
                list.sort(function (a, b) {
                    var va = k === 'rank' ? a.c.rank : k === 'name' ? a.c.name : a.s[k];
                    var vb = k === 'rank' ? b.c.rank : k === 'name' ? b.c.name : b.s[k];
                    return (va > vb ? 1 : va < vb ? -1 : 0) * d;
                });
            }

            liveFns = liveFns.filter(function (fn) { return !fn.table; });
            fill(tableHost,
                h('div', { class: 'cx-row cx-row-head cx-mkt-row' },
                    sortable('rank', '#'), sortable('name', 'Name'), sortable('price', 'Price', 'r'), sortable('change1h', '1h', 'r'),
                    sortable('change24h', '24h', 'r'), sortable('change7d', '7d', 'r'), sortable('volume24h', 'Volume', 'r'),
                    sortable('marketCap', 'Market cap', 'r'), h('span', { class: 'r' }, 'Last 7 days'), h('span')),
                list.length ? list.map(function (r) { return marketRow(r.c, r.s, t); }) : h('div', { class: 'cx-table-empty dim' },
                    marketTab === 'watch' && !marketQuery ? 'Star coins to add them to your watchlist.' : 'No coins match.'));
        }

        function marketRow(c, s, t) {
            var watched = prefs.watch.indexOf(c.sym) !== -1;
            var ch = {};
            ['change1h', 'change24h', 'change7d'].forEach(function (k) { ch[k] = changeTag(s[k], 'is-sm'); });
            var vol = h('span', { class: 'num r' }, F.compact(s.volume24h));
            var cap = h('span', { class: 'num r' }, F.compact(s.marketCap));
            var upd = function (now) {
                setChange(ch.change1h, M.change(c.sym, now, M.HOUR));
                setChange(ch.change24h, M.change(c.sym, now, M.DAY));
                cap.textContent = F.compact(M.price(c.sym, now) * c.supply);
            };
            upd.table = true;
            live(upd);
            var priceEl = livePrice(c.sym, 'r');
            liveFns[liveFns.length - 1].table = true;
            return h('div', { class: 'cx-row cx-mkt-row is-clickable', onClick: function () { go('coin', c.sym); } },
                h('span', { class: 'dim num' }, String(c.rank)),
                h('div', { class: 'cx-asset' }, coinIcon(c.sym, 'is-sm'), h('div', null, h('b', null, c.name), h('span', { class: 'dim' }, c.sym))),
                priceEl,
                h('span', { class: 'r' }, ch.change1h), h('span', { class: 'r' }, ch.change24h), h('span', { class: 'r' }, ch.change7d),
                vol, cap,
                h('span', { class: 'r' }, C.sparkline(M.series(c.sym, t - 7 * M.DAY, t, 56), { width: 120, height: 34, fill: false })),
                h('button', {
                    class: 'cx-star' + (watched ? ' is-on' : ''),
                    title: watched ? 'Remove from watchlist' : 'Add to watchlist',
                    onClick: function (e) { e.stopPropagation(); toggleWatch(c.sym); drawTable(); },
                }, icon('star')));
        }

        drawTable();

        return h('div', { class: 'cx-page' },
            h('div', { class: 'cx-page-head' }, h('h1', null, 'Markets'), h('span', { class: 'cx-live-dot' }, h('i'), 'Live')),
            head,
            card(null, h('div', null,
                h('div', { class: 'cx-toolbar' },
                    segmented([['all', 'All coins'], ['watch', 'Watchlist'], ['gainers', 'Top gainers'], ['losers', 'Top losers']], marketTab,
                        function (v) { marketTab = v; render(); }),
                    search),
                tableHost)));
    };

    function stat(label, value, extra) {
        return h('div', { class: 'cx-stat' }, h('div', { class: 'cx-label' }, label), h('div', { class: 'cx-stat-value num' }, value), extra || null);
    }

    function toggleWatch(sym) {
        var i = prefs.watch.indexOf(sym);
        if (i === -1) prefs.watch.push(sym); else prefs.watch.splice(i, 1);
        savePrefs();
        Kit.toast(i === -1 ? M.coin(sym).name + ' added to watchlist' : M.coin(sym).name + ' removed from watchlist');
    }

    /* ---------------- coin ---------------- */

    VIEWS.coin = function () {
        var sym = route.sym;
        var c = M.coin(sym);
        if (!c) return empty('info', 'Unknown coin', null);
        var now = Date.now();
        var s = M.stats(sym, now);
        var range = prefs.range in RANGES ? prefs.range : '1D';
        var watched = prefs.watch.indexOf(sym) !== -1;

        var chartHost = h('div', { class: 'cx-chart' });
        var hover = h('div', { class: 'cx-chart-hover num' });
        var rangeChange = h('span', { class: 'chg is-flat' });

        var draw = function () {
            var r = RANGES[range];
            var t1 = Date.now(), t0 = t1 - r.span;
            C.priceChart(chartHost, {
                mode: prefs.chartMode,
                points: prefs.chartMode === 'line' ? M.series(sym, t0, t1, r.points) : null,
                candles: prefs.chartMode === 'candles' ? M.candles(sym, t0, t1, r.candles) : null,
                formatPrice: F.price,
                formatTime: r.fmt,
                onHover: function (pt) {
                    if (!pt) { hover.textContent = ''; return; }
                    hover.textContent = pt.o != null
                        ? 'O ' + F.price(pt.o) + '  H ' + F.price(pt.h) + '  L ' + F.price(pt.l) + '  C ' + F.price(pt.c) + '  · ' + F.when(pt.t, h24())
                        : F.price(pt.p) + '  · ' + F.when(pt.t, h24());
                },
            });
            setChange(rangeChange, M.change(sym, t1, r.span));
        };
        draw.layout = true;
        live(function (t) {
            // don't redraw under the cursor while someone is reading the crosshair
            if (chartHost.matches(':hover')) return;
            // short ranges scroll in real time; long ones only need the latest point occasionally
            if (range === '1H' || range === '1D' || (t / 1000 | 0) % 30 < 2) draw(t);
        });
        live(draw);

        var hd = holding(sym);
        var position = hd.amount > 0 ? card('Your position', (function () {
            var val = h('b', { class: 'num' }), pl = h('span', { class: 'num' });
            var upd = function (t) {
                var v = hd.amount * M.price(sym, t), p = v - hd.cost;
                val.textContent = F.usd(v);
                pl.className = 'num chg-text is-' + F.trend(p);
                pl.textContent = (p >= 0 ? '+' : '−') + F.usd(Math.abs(p)) + ' (' + F.pct(hd.cost ? p / hd.cost : 0) + ')';
            };
            upd(now); live(upd);
            return h('div', { class: 'cx-kv' },
                kv('Balance', F.amount(hd.amount, sym)), kv('Value', val), kv('Average cost', F.price(hd.cost / hd.amount)), kv('Return', pl));
        })()) : null;

        var coinAlerts = prefs.alerts.filter(function (a) { return a.sym === sym && !a.triggered; });

        return h('div', { class: 'cx-page cx-coin' },
            h('div', { class: 'cx-coin-main' },
                h('div', { class: 'cx-coin-head' },
                    h('button', { class: 'btn btn-flat btn-circle', title: 'Back to markets', onClick: function () { go('markets'); } }, icon('back')),
                    coinIcon(sym, 'is-lg'),
                    h('div', { class: 'cx-coin-title' },
                        h('div', null, h('h1', null, c.name), h('span', { class: 'cx-sym' }, sym), h('span', { class: 'cx-rank' }, '#' + c.rank)),
                        h('div', { class: 'cx-coin-price' }, livePrice(sym, 'cx-big-price'), liveChange(sym, M.DAY), h('span', { class: 'dim' }, '24h'))),
                    h('button', {
                        class: 'btn cx-watch' + (watched ? ' is-on' : ''),
                        onClick: function () { toggleWatch(sym); render(); },
                    }, icon('star'), watched ? 'Watching' : 'Watch')),

                card(null, h('div', null,
                    h('div', { class: 'cx-chart-bar' },
                        segmented(Object.keys(RANGES).map(function (r) { return [r, r]; }), range, function (r) { prefs.range = r; savePrefs(); render(); }),
                        rangeChange,
                        h('span', { class: 'cx-spacer' }),
                        hover,
                        segmented([['line', 'Line'], ['candles', 'Candles']], prefs.chartMode, function (m) { prefs.chartMode = m; savePrefs(); render(); })),
                    chartHost), { cls: 'cx-chart-card' }),

                h('div', { class: 'cx-stats-grid' },
                    stat('Market cap', F.compact(s.marketCap)),
                    stat('Volume (24h)', F.compact(s.volume24h)),
                    stat('Circulating supply', F.compactNum(s.supply) + ' ' + sym),
                    stat('24h high', F.price(s.high24h)),
                    stat('24h low', F.price(s.low24h)),
                    stat('52-week high', F.price(s.highYear)),
                    stat('52-week low', F.price(s.lowYear)),
                    stat('7-day change', F.pct(s.change7d))),

                card('About ' + c.name, h('p', { class: 'cx-about' }, c.about))),

            h('aside', { class: 'cx-coin-side' },
                tradePanel(sym),
                position,
                card('Price alerts', h('div', { class: 'cx-alert-mini' },
                    coinAlerts.length ? coinAlerts.map(alertRow) : h('div', { class: 'dim cx-mini-empty' }, 'No alerts for ' + sym),
                    h('button', { class: 'btn', onClick: function () { newAlert(sym); } }, icon('bell'), 'New alert')))));
    };

    function kv(k, v) { return h('div', { class: 'cx-kv-row' }, h('span', { class: 'dim' }, k), typeof v === 'string' ? h('b', { class: 'num' }, v) : v); }

    /* ---------------- trade ticket ---------------- */

    function tradePanel(sym, initialSide) {
        var side = initialSide || 'buy';
        var unit = 'usd';          // what the input is denominated in
        var exact = null;          // exact order from the 25/50/75/Max buttons (no rounding dust)
        var root = h('section', { class: 'cx-card cx-trade' });
        var fees = backend.fees;

        function draw() {
            var c = M.coin(sym);
            var avail = side === 'buy' ? wallet.cash : holding(sym).amount;
            var input = h('input', { class: 'cx-amount num', type: 'text', inputmode: 'decimal', placeholder: '0', autocomplete: 'off', spellcheck: false });
            var unitBtn = h('button', { class: 'cx-unit', title: 'Switch between USD and ' + sym }, unit === 'usd' ? 'USD' : sym, icon('swap'));
            var summary = h('div', { class: 'cx-kv cx-summary' });
            var hint = h('div', { class: 'cx-hint' });
            var submit = h('button', { class: 'btn btn-lg cx-submit is-' + side, disabled: true }, (side === 'buy' ? 'Buy ' : 'Sell ') + sym);

            function coinAmount(now) {
                if (exact) return exact.amount != null ? exact.amount : spendToCoins(exact.usd, now);
                var v = parseFloat(input.value.replace(/,/g, ''));
                if (!(v > 0)) return 0;
                var p = M.price(sym, now);
                if (unit === 'coin') return v;
                // for buys, the USD amount includes the fee
                return side === 'buy' ? Math.max(0, (v - Math.max(fees.min, v * fees.rate / (1 + fees.rate))) / p) : v / p;
            }

            function spendToCoins(usd, now) {
                return Math.max(0, (usd - Math.max(fees.min, usd * fees.rate / (1 + fees.rate))) / M.price(sym, now));
            }

            /** What the backend gets: buys in USD are sent as a spend so they size at execution. */
            function order(now) {
                if (side === 'buy') {
                    if (exact && exact.usd != null) return { usd: exact.usd };
                    if (!exact && unit === 'usd') { var v = parseFloat(input.value.replace(/,/g, '')); return { usd: v > 0 ? v : 0 }; }
                }
                return { amount: coinAmount(now) };
            }

            function update() {
                var now = Date.now();
                var p = M.price(sym, now);
                var amt = coinAmount(now);
                var notional = amt * p;
                var fee = amt ? Math.max(fees.min, notional * fees.rate) : 0;
                var total = side === 'buy' ? notional + fee : notional - fee;
                fill(summary,
                    kv('Price', F.price(p)),
                    kv(side === 'buy' ? 'You get' : 'You sell', F.amount(amt, sym)),
                    kv('Fee (' + (fees.rate * 100).toFixed(1) + '%)', F.usd(fee)),
                    kv(side === 'buy' ? 'Total cost' : 'You receive', h('b', { class: 'num cx-total-line' }, F.usd(Math.max(0, total)))));
                var problem = '';
                if (!amt) problem = '';
                else if (notional < fees.minOrder) problem = 'Minimum order is ' + F.usd(fees.minOrder);
                else if (side === 'buy' && total > wallet.cash + 1e-9) problem = 'Not enough cash';
                else if (side === 'sell' && amt > holding(sym).amount + 1e-12) problem = 'Not enough ' + sym;
                hint.textContent = problem;
                submit.disabled = !amt || !!problem;
            }

            function setFraction(f) {
                var now = Date.now(), p = M.price(sym, now);
                if (side === 'buy') {
                    var usd = f === 1 ? wallet.cash : Math.floor(wallet.cash * f * 100) / 100;
                    exact = { usd: usd };
                    input.value = unit === 'usd' ? (Math.floor(usd * 100) / 100).toFixed(2) : String(+spendToCoins(usd, now).toFixed(8));
                } else {
                    var coins = f === 1 ? holding(sym).amount : holding(sym).amount * f;
                    exact = { amount: coins };
                    input.value = unit === 'coin' ? String(Math.floor(coins * 1e8) / 1e8) : (Math.floor(coins * p * 100) / 100).toFixed(2);
                }
                update();
            }

            input.addEventListener('input', function () {
                exact = null;   // typed by hand: use what's in the box
                var clean = input.value.replace(/[^0-9.,]/g, '').replace(/,/g, '.');
                var parts = clean.split('.');
                if (parts.length > 2) clean = parts[0] + '.' + parts.slice(1).join('');
                if (clean !== input.value) input.value = clean;
                update();
            });
            input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !submit.disabled) submit.click(); });
            unitBtn.addEventListener('click', function () {
                var now = Date.now(), amt = coinAmount(now);
                unit = unit === 'usd' ? 'coin' : 'usd';
                unitBtn.firstChild.textContent = unit === 'usd' ? 'USD' : sym;
                if (amt) {
                    input.value = unit === 'coin' ? String(Math.floor(amt * 1e8) / 1e8)
                        : (side === 'buy' && exact && exact.usd != null ? exact.usd : amt * M.price(sym, now)).toFixed(2);
                }
                update();
            });
            submit.addEventListener('click', function () {
                var now = Date.now();
                confirmTrade(side, sym, coinAmount(now), order(now)).then(function (done) { if (done) { input.value = ''; exact = null; draw(); } });
            });

            fill(root,
                h('div', { class: 'cx-trade-tabs' },
                    ['buy', 'sell'].map(function (s) {
                        return h('button', { class: 'cx-trade-tab is-' + s + (s === side ? ' is-active' : ''), onClick: function () { side = s; draw(); } }, s === 'buy' ? 'Buy' : 'Sell');
                    })),
                h('div', { class: 'cx-amount-wrap' }, input, unitBtn),
                h('div', { class: 'cx-fracs' }, [0.25, 0.5, 0.75, 1].map(function (f) {
                    return h('button', { class: 'cx-frac', onClick: function () { setFraction(f); } }, f === 1 ? 'Max' : f * 100 + '%');
                })),
                h('div', { class: 'cx-avail dim' }, 'Available ', h('b', { class: 'num' }, side === 'buy' ? F.usd(avail) : F.amount(avail, sym))),
                summary, hint, submit,
                h('div', { class: 'cx-fine dim' }, 'Market order · executes at the live price'));
            update();
            live(update);
            root.dataset.coin = c.sym;
        }
        draw();
        return root;
    }

    /** Buy/Sell from Portfolio: pick a coin first. */
    function openTrade(side) {
        var syms = side === 'sell' ? ownedSyms() : M.COINS.map(function (c) { return c.sym; });
        if (!syms.length) { Kit.toast('You don’t own anything to sell yet'); return; }
        pickCoin(side === 'buy' ? 'Buy which coin?' : 'Sell which coin?', syms, function (sym) {
            go('coin', sym);
            if (side === 'sell') { var tab = content.querySelector('.cx-trade-tab.is-sell'); if (tab) tab.click(); }
            var amount = content.querySelector('.cx-amount');
            if (amount) amount.focus({ preventScroll: true });
        });
    }

    function sheet(title, body, wide) {
        var layer;
        var close = function () { layer.remove(); document.removeEventListener('keydown', onKey); };
        var onKey = function (e) { if (e.key === 'Escape') close(); };
        layer = h('div', { class: 'kit-dialog-layer', onPointerdown: function (e) { if (e.target === layer) close(); } },
            h('div', { class: 'kit-dialog cx-sheet' + (wide ? ' is-wide' : '') }, h('div', { class: 'kit-dialog-title' }, title), body));
        document.addEventListener('keydown', onKey);
        document.body.append(layer);
        return close;
    }

    function pickCoin(title, syms, onPick) {
        var close = sheet(title, h('div', { class: 'cx-pick' }, syms.map(function (sym) {
            var c = M.coin(sym), hd = holding(sym);
            return h('button', { class: 'cx-pick-row', onClick: function () { close(); onPick(sym); } },
                coinIcon(sym, 'is-sm'), h('div', null, h('b', null, c.name), h('span', { class: 'dim' }, hd.amount ? F.amount(hd.amount, sym) : sym)),
                h('span', { class: 'num' }, F.price(M.price(sym, Date.now()))));
        })));
    }

    function confirmTrade(side, sym, amount, order) {
        return new Promise(function (resolve) {
            var c = M.coin(sym);
            var p0 = M.price(sym, Date.now());
            var notional = amount * p0, fee = Math.max(backend.fees.min, notional * backend.fees.rate);
            var busy = false;
            var btn = h('button', { class: 'btn btn-lg cx-submit is-' + side }, 'Confirm ' + (side === 'buy' ? 'purchase' : 'sale'));
            var close = sheet((side === 'buy' ? 'Buy ' : 'Sell ') + c.name, h('div', null,
                h('div', { class: 'cx-confirm-hero' }, coinIcon(sym, 'is-lg'), h('div', { class: 'cx-confirm-amount num' }, F.amount(amount, sym)), h('div', { class: 'dim num' }, '≈ ' + F.usd(notional))),
                h('div', { class: 'cx-kv' },
                    kv('Price', F.price(p0)), kv('Fee', F.usd(fee)),
                    kv(side === 'buy' ? 'Total' : 'You receive', F.usd(side === 'buy' ? notional + fee : notional - fee)),
                    kv('Pay with', side === 'buy' ? 'Cash balance' : sym + ' balance')),
                h('p', { class: 'cx-fine dim' }, 'Prices move — the final amount is set when the order executes.'),
                h('div', { class: 'kit-dialog-buttons' }, h('button', { class: 'btn', onClick: function () { close(); resolve(false); } }, 'Cancel'), btn)));
            btn.addEventListener('click', function () {
                if (busy) return;
                busy = true;
                btn.disabled = true;
                btn.textContent = 'Placing order…';
                var req = { side: side, sym: sym };
                if (order && order.usd) req.usd = order.usd; else req.amount = amount;
                backend.trade(req).then(function (res) {
                    wallet = res.state;
                    close();
                    Kit.toast((side === 'buy' ? 'Bought ' : 'Sold ') + F.amount(res.tx.amount, sym) + ' for ' + F.usd(res.tx.usd));
                    render();
                    resolve(true);
                }, function (err) {
                    busy = false;
                    btn.disabled = false;
                    btn.textContent = 'Try again';
                    Kit.toast(err.message || 'Order failed');
                });
            });
        });
    }

    /* ---------------- activity ---------------- */

    var activityFilter = 'all';
    var TX_META = {
        buy: ['Bought', 'arrowDown', 'is-in'],
        sell: ['Sold', 'arrowUp', 'is-out'],
        send: ['Sent', 'send', 'is-out'],
        receive: ['Received', 'arrowDown', 'is-in'],
        deposit: ['Deposit', 'bank', 'is-in'],
        withdraw: ['Withdrawal', 'bank', 'is-out'],
    };

    VIEWS.activity = function () {
        var groups = { all: null, trades: ['buy', 'sell'], transfers: ['send', 'receive'], cash: ['deposit', 'withdraw'] };
        var txs = wallet.txs.filter(function (tx) { return !groups[activityFilter] || groups[activityFilter].indexOf(tx.type) !== -1; });
        var byDay = [];
        txs.forEach(function (tx) {
            var d = new Date(tx.time);
            var key = d.toDateString();
            if (!byDay.length || byDay[byDay.length - 1].key !== key) byDay.push({ key: key, time: tx.time, items: [] });
            byDay[byDay.length - 1].items.push(tx);
        });

        return h('div', { class: 'cx-page cx-narrow' },
            h('div', { class: 'cx-page-head' }, h('h1', null, 'Activity'),
                segmented([['all', 'All'], ['trades', 'Trades'], ['transfers', 'Transfers'], ['cash', 'Cash']], activityFilter, function (v) { activityFilter = v; render(); })),
            byDay.length ? byDay.map(function (g) {
                return h('section', { class: 'cx-day' },
                    h('h4', null, F.when(g.time, h24()).split(',')[0]),
                    h('div', { class: 'boxed-list' }, g.items.map(txRow)));
            }) : empty('list', 'No activity', 'Trades, transfers and deposits show up here.'));
    };

    function txTitle(tx) {
        var m = TX_META[tx.type];
        return m[0] + (tx.sym ? ' ' + M.coin(tx.sym).name : '');
    }

    function txRow(tx) {
        var m = TX_META[tx.type];
        var coinSide = tx.sym ? (m[2] === 'is-in' ? '+' : '−') + F.amount(tx.amount, tx.sym) : null;
        var cashSide = tx.type === 'buy' ? '−' + F.usd(tx.usd + tx.fee) : tx.type === 'sell' ? '+' + F.usd(tx.usd - tx.fee)
            : tx.type === 'deposit' ? '+' + F.usd(tx.usd) : tx.type === 'withdraw' ? '−' + F.usd(tx.usd) : '≈ ' + F.usd(tx.usd);
        return h('button', { class: 'row cx-tx', onClick: function () { txDetails(tx); } },
            h('span', { class: 'cx-tx-icon ' + m[2] }, tx.sym ? coinIcon(tx.sym, 'is-sm') : null, h('span', { class: 'cx-tx-glyph' }, icon(m[1]))),
            h('div', { class: 'row-text' }, h('div', { class: 'row-title' }, txTitle(tx)), h('div', { class: 'row-subtitle' }, Kit.clock(tx.time, h24()) + ' · ' + F.shortHash(tx.hash))),
            h('div', { class: 'cx-tx-amounts' },
                coinSide ? h('b', { class: 'num ' + m[2] }, coinSide) : h('b', { class: 'num ' + m[2] }, cashSide),
                coinSide ? h('span', { class: 'dim num' }, cashSide) : h('span', { class: 'dim' }, wallet.bankName)));
    }

    function txDetails(tx) {
        var rows = [kv('Status', h('span', { class: 'cx-status' }, icon('check'), 'Completed')), kv('Date', F.when(tx.time, h24()))];
        if (tx.sym) rows.push(kv('Amount', F.amount(tx.amount, tx.sym)), kv('Price', F.price(tx.price)));
        rows.push(kv(tx.sym ? 'Value' : 'Amount', F.usd(tx.usd)));
        if (tx.fee) rows.push(kv(tx.type === 'send' ? 'Network fee' : 'Fee', F.usd(tx.fee)));
        if (tx.to) rows.push(kv('To', h('span', { class: 'mono cx-addr-sm' }, tx.to)));
        if (tx.from) rows.push(kv('From', h('span', { class: 'mono cx-addr-sm' }, tx.from)));
        rows.push(kv('Transaction', h('span', { class: 'mono cx-addr-sm' }, tx.hash)));
        var close = sheet(txTitle(tx), h('div', null, h('div', { class: 'cx-kv' }, rows),
            h('button', { class: 'btn', style: { width: '100%', marginTop: '2rem' }, onClick: function () { close(); } }, 'Close')));
    }

    /* ---------------- send / receive / cash ---------------- */

    VIEWS.transfer = function () {
        var tab = route.tab || 'send';
        var body = tab === 'send' ? sendForm() : tab === 'receive' ? receivePanel() : cashPanel();
        return h('div', { class: 'cx-page cx-narrow' },
            h('div', { class: 'cx-page-head' }, h('h1', null, 'Send & Receive'),
                segmented([['send', 'Send'], ['receive', 'Receive'], ['cash', 'Cash']], tab, function (v) { go('transfer', null, v); })),
            body);
    };

    function sendForm() {
        var owned = ownedSyms().filter(function (s) { return !M.coin(s).stable || holding(s).amount > 0; });
        if (!owned.length) return card(null, empty('send', 'Nothing to send', 'Buy or receive coins first.'));
        var sym = owned.indexOf(route.sym) !== -1 ? route.sym : owned[0];
        var to = h('input', { class: 'entry mono', type: 'text', placeholder: 'lsx1…', spellcheck: false, autocomplete: 'off' });
        var amount = h('input', { class: 'entry num', type: 'text', inputmode: 'decimal', placeholder: '0.00', autocomplete: 'off' });
        var info = h('div', { class: 'cx-kv' });
        var hint = h('div', { class: 'cx-hint' });
        var btn = h('button', { class: 'btn btn-suggested btn-lg', style: { width: '100%' }, disabled: true }, 'Review transfer');

        function update() {
            var now = Date.now();
            var amt = parseFloat(amount.value) || 0;
            var fee = backend.fees.network(sym, now);
            var hd = holding(sym);
            fill(info,
                kv('Available', F.amount(hd.amount, sym)),
                kv('Network fee', F.amount(fee, sym) + ' (' + F.usd(fee * M.price(sym, now)) + ')'),
                kv('Recipient gets', F.amount(amt, sym)),
                kv('Value', F.usd(amt * M.price(sym, now))));
            var problem = '';
            var addr = to.value.trim();
            if (addr && !/^lsx1[a-z0-9]{38}$/.test(addr)) problem = 'Addresses start with lsx1 and are 42 characters long';
            else if (addr && addr === wallet.address) problem = 'That’s your own address';
            else if (amt && amt + fee > hd.amount + 1e-12) problem = 'Not enough ' + sym + ' to cover the amount and fee';
            hint.textContent = problem;
            btn.disabled = !addr || !amt || !!problem;
        }
        amount.addEventListener('input', function () { amount.value = amount.value.replace(/[^0-9.]/g, ''); update(); });
        to.addEventListener('input', function () { to.value = to.value.replace(/\s/g, '').toLowerCase(); update(); });
        btn.addEventListener('click', function () {
            var amt = parseFloat(amount.value);
            var addr = to.value.trim();
            Kit.confirm({
                title: 'Send ' + F.amount(amt, sym) + '?',
                body: 'To ' + addr.slice(0, 12) + '…' + addr.slice(-6) + '. Transfers can’t be reversed.',
                confirm: 'Send',
            }).then(function (ok) {
                if (!ok) return;
                backend.transfer({ sym: sym, amount: amt, to: addr }).then(function (res) {
                    wallet = res.state;
                    Kit.toast('Sent ' + F.amount(amt, sym));
                    go('activity');
                }, function (err) { Kit.toast(err.message); });
            });
        });
        live(update);
        setTimeout(update);

        return card(null, h('div', { class: 'cx-form' },
            h('label', { class: 'cx-field' }, h('span', null, 'Asset'),
                h('div', { class: 'cx-asset-pick' }, owned.map(function (s) {
                    return h('button', { class: 'cx-chip' + (s === sym ? ' is-active' : ''), onClick: function () { route.sym = s; render(); } }, coinIcon(s, 'is-xs'), s);
                }))),
            h('label', { class: 'cx-field' }, h('span', null, 'Recipient address'), to),
            h('label', { class: 'cx-field' }, h('span', null, 'Amount'),
                h('div', { class: 'cx-inline' }, amount, h('button', {
                    class: 'btn', onClick: function () {
                        var max = holding(sym).amount - backend.fees.network(sym, Date.now());
                        amount.value = max > 0 ? String(+max.toFixed(8)) : '0';
                        update();
                    },
                }, 'Max'))),
            info, hint, btn));
    }

    function receivePanel() {
        var addr = wallet.address;
        var addrEl = h('div', { class: 'cx-address mono' }, addr);
        return card(null, h('div', { class: 'cx-receive' },
            C.addressCode(addr, 220),
            h('div', { class: 'cx-receive-text' },
                h('h3', null, 'Your LSX address'),
                h('p', { class: 'dim' }, 'Share this to receive any coin listed on LSX. Only send LSX-network coins to this address.'),
                addrEl,
                h('button', {
                    class: 'btn btn-suggested',
                    onClick: function () {
                        // clipboard access isn't available in every sandbox; select the text as a fallback
                        var done = function () { Kit.toast('Address copied'); };
                        var fallback = function () {
                            var r = document.createRange(); r.selectNodeContents(addrEl);
                            var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
                            Kit.toast('Address selected — press Ctrl+C to copy');
                        };
                        try { navigator.clipboard.writeText(addr).then(done, fallback); } catch (e) { fallback(); }
                    },
                }, icon('copy'), 'Copy address'))));
    }

    function cashPanel() {
        var amount = h('input', { class: 'entry num cx-cash-input', type: 'text', inputmode: 'decimal', placeholder: '0.00', autocomplete: 'off' });
        var mode = route.cashMode || 'deposit';
        var go2 = function (fn, verb) {
            var v = parseFloat(amount.value);
            if (!(v > 0)) { Kit.toast('Enter an amount'); return; }
            fn(v).then(function (res) {
                wallet = res.state;
                Kit.toast(verb + ' ' + F.usd(v));
                render();
            }, function (err) { Kit.toast(err.message); });
        };
        amount.addEventListener('input', function () { amount.value = amount.value.replace(/[^0-9.]/g, ''); });
        return h('div', { class: 'cx-cash' },
            h('div', { class: 'cx-cash-balances' },
                h('div', { class: 'cx-card cx-balance' }, h('div', { class: 'cx-label' }, 'Exchange cash'), h('div', { class: 'cx-stat-value num' }, F.usd(wallet.cash))),
                h('div', { class: 'cx-card cx-balance' }, h('div', { class: 'cx-label' }, wallet.bankName), h('div', { class: 'cx-stat-value num' }, F.usd(wallet.bank)))),
            card(null, h('div', { class: 'cx-form' },
                segmented([['deposit', 'Deposit from bank'], ['withdraw', 'Withdraw to bank']], mode, function (v) { route.cashMode = v; render(); }),
                h('label', { class: 'cx-field' }, h('span', null, 'Amount (USD)'), amount),
                h('div', { class: 'cx-fracs' }, [100, 500, 1000, 5000].map(function (v) {
                    return h('button', { class: 'cx-frac', onClick: function () { amount.value = String(v); } }, '$' + v.toLocaleString('en-US'));
                })),
                h('button', {
                    class: 'btn btn-suggested btn-lg',
                    style: { width: '100%' },
                    onClick: function () { mode === 'deposit' ? go2(backend.deposit, 'Deposited') : go2(backend.withdraw, 'Withdrew'); },
                }, mode === 'deposit' ? 'Deposit' : 'Withdraw'),
                h('div', { class: 'cx-fine dim' }, backend.mode === 'demo' ? 'Demo account — money moves between demo balances only.' : 'Transfers settle instantly.'))));
    }

    /* ---------------- alerts ---------------- */

    VIEWS.alerts = function () {
        var active = prefs.alerts.filter(function (a) { return !a.triggered; });
        var fired = prefs.alerts.filter(function (a) { return a.triggered; });
        return h('div', { class: 'cx-page cx-narrow' },
            h('div', { class: 'cx-page-head' }, h('h1', null, 'Price Alerts'),
                h('button', { class: 'btn btn-suggested', onClick: function () { newAlert(); } }, icon('plus'), 'New alert')),
            h('p', { class: 'dim cx-intro' }, 'You get a tablet notification when a price crosses your target — even while LSX is in the background.'),
            active.length || fired.length ? [
                active.length ? h('section', { class: 'cx-day' }, h('h4', null, 'Active'), h('div', { class: 'boxed-list' }, active.map(alertRow))) : null,
                fired.length ? h('section', { class: 'cx-day' }, h('h4', null, 'Triggered'), h('div', { class: 'boxed-list' }, fired.map(alertRow))) : null,
            ] : card(null, empty('bell', 'No alerts', 'Create one to get notified about big moves.')));
    };

    function alertRow(a) {
        var c = M.coin(a.sym);
        var now = Date.now();
        var dist = (a.target / M.price(a.sym, now) - 1);
        return h('div', { class: 'row cx-alert-row' + (a.triggered ? ' is-fired' : '') },
            coinIcon(a.sym, 'is-sm'),
            h('div', { class: 'row-text' },
                h('div', { class: 'row-title' }, c.name + ' ' + (a.dir === 'above' ? 'above ' : 'below ') + F.price(a.target)),
                h('div', { class: 'row-subtitle' }, a.triggered
                    ? 'Triggered ' + Kit.relTime(a.triggered) + ' at ' + F.price(a.hitPrice)
                    : 'Now ' + F.price(M.price(a.sym, now)) + ' · ' + F.pct(dist, 1) + ' away')),
            h('button', { class: 'btn btn-flat btn-circle', title: 'Delete alert', onClick: function () { removeAlert(a.id); } }, icon('trash')));
    }

    function newAlert(presetSym) {
        var sym = presetSym || 'LSC';
        var dir = 'above';
        var target = h('input', { class: 'entry num', type: 'text', inputmode: 'decimal' });
        var coinRow = h('div', { class: 'cx-asset-pick' });
        var dirRow = h('div');
        var current = h('div', { class: 'dim cx-fine' });
        var drawBits = function () {
            var p = M.price(sym, Date.now());
            fill(coinRow, M.COINS.map(function (c) {
                return h('button', { class: 'cx-chip' + (c.sym === sym ? ' is-active' : ''), onClick: function () { sym = c.sym; target.value = suggest(); drawBits(); } }, coinIcon(c.sym, 'is-xs'), c.sym);
            }));
            fill(dirRow, segmented([['above', 'Rises above'], ['below', 'Falls below']], dir, function (d) { dir = d; target.value = suggest(); drawBits(); }));
            current.textContent = 'Current price ' + F.price(p);
        };
        var suggest = function () {
            var p = M.price(sym, Date.now());
            var v = p * (dir === 'above' ? 1.05 : 0.95);
            return v >= 1 ? v.toFixed(2) : v.toPrecision(3);
        };
        target.value = suggest();
        target.addEventListener('input', function () { target.value = target.value.replace(/[^0-9.]/g, ''); });
        drawBits();
        var close = sheet('New price alert', h('div', { class: 'cx-form' },
            h('label', { class: 'cx-field' }, h('span', null, 'Coin'), coinRow),
            h('label', { class: 'cx-field' }, h('span', null, 'Condition'), dirRow),
            h('label', { class: 'cx-field' }, h('span', null, 'Target price (USD)'), target),
            current,
            h('div', { class: 'kit-dialog-buttons' },
                h('button', { class: 'btn', onClick: function () { close(); } }, 'Cancel'),
                h('button', {
                    class: 'btn btn-suggested',
                    onClick: function () {
                        var v = parseFloat(target.value);
                        var p = M.price(sym, Date.now());
                        if (!(v > 0)) { Kit.toast('Enter a target price'); return; }
                        if ((dir === 'above' && v <= p) || (dir === 'below' && v >= p)) { Kit.toast('Target is already ' + (dir === 'above' ? 'below' : 'above') + ' the current price'); return; }
                        prefs.alerts.push({ id: 'a' + Date.now().toString(36), sym: sym, dir: dir, target: v, created: Date.now(), triggered: null });
                        savePrefs();
                        close();
                        Kit.toast('Alert set: ' + sym + ' ' + dir + ' ' + F.price(v));
                        render();
                    },
                }, 'Create alert'))), true);
    }

    function removeAlert(id) {
        prefs.alerts = prefs.alerts.filter(function (a) { return a.id !== id; });
        savePrefs();
        render();
    }

    /** Runs every tick, also while the app is in the background. */
    function checkAlerts(now) {
        var fired = false;
        prefs.alerts.forEach(function (a) {
            if (a.triggered) return;
            var p = M.price(a.sym, now);
            if ((a.dir === 'above' && p >= a.target) || (a.dir === 'below' && p <= a.target)) {
                a.triggered = now;
                a.hitPrice = p;
                fired = true;
                var c = M.coin(a.sym);
                if (!(T.visible && route.view === 'alerts')) prefs.unseenAlerts++;
                if (T.inTablet) {
                    T.notify({
                        title: c.name + (a.dir === 'above' ? ' is up — ' : ' is down — ') + F.price(p),
                        body: a.sym + ' crossed your ' + F.price(a.target) + ' alert.',
                        data: { coin: a.sym },
                    });
                }
            }
        });
        if (fired) { savePrefs(); syncBadge(); if (T.visible) renderNav(); }
    }

    function syncBadge() { if (T.inTablet) T.setBadge(prefs.unseenAlerts); }

    /* ================================================================== */
    /* lifecycle                                                           */
    /* ================================================================== */

    function tick() {
        var now = Date.now();
        checkAlerts(now);
        if (T.visible) {
            liveFns.forEach(function (fn) { try { fn(now); } catch (e) { console.error(e); } });
            updateTicker(now);
        }
        setTimeout(tick, T.visible ? TICK_VISIBLE : TICK_HIDDEN);
    }

    function resetDemo() {
        Kit.confirm({ title: 'Reset demo account?', body: 'Your demo balances and history go back to the starting point. Alerts and watchlist are kept.', confirm: 'Reset', destructive: true })
            .then(function (ok) {
                if (!ok) return;
                backend.reset().then(function (s) { wallet = s; go('portfolio'); Kit.toast('Demo account reset'); });
            });
    }

    function handleLaunch(data) {
        if (!data || typeof data !== 'object') return;
        if (data.coin && M.coin(data.coin)) go('coin', data.coin);
        else if (data.view && VIEWS[data.view]) go(data.view);
    }

    var resizeTimer = null;
    window.addEventListener('resize', function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () { liveFns.forEach(function (fn) { if (fn.layout) fn(Date.now()); }); }, 150);
    });

    T.ready().then(function () {
        return Promise.all([
            LSX.Backend.connect(T),
            T.inTablet ? T.storage.get('prefs').catch(function () { return null; }) : null,
        ]);
    }).then(function (res) {
        backend = res[0];
        if (res[1] && typeof res[1] === 'object') {
            for (var k in res[1]) prefs[k] = res[1][k];
        }
        return backend.state();
    }).then(function (s) {
        wallet = s;
        document.body.classList.remove('is-loading');
        renderTicker();
        render();
        syncBadge();
        handleLaunch(T.launchData);
        setTimeout(tick, TICK_VISIBLE);
    }).catch(function (err) {
        fill(content, empty('info', 'LSX couldn’t start', err.message));
    });

    T.on('launch', handleLaunch);
    T.on('show', function () { if (wallet) { renderTicker(); render(); } });
    T.on('settings', function () { if (wallet) render(); });
    T.on('hide', function () { savePrefs.flush(); });   // may be evicted while hidden

    window.__crypto = { go: go, checkAlerts: checkAlerts, prefs: function () { return prefs; }, wallet: function () { return wallet; } };
})();
