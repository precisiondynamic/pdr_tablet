(function (global) {
    'use strict';

    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    /** 19.64M · 420.00B (no currency) */
    function compactNum(n) {
        var units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
        for (var i = 0; i < units.length; i++) if (Math.abs(n) >= units[i][0]) return (n / units[i][0]).toFixed(2) + units[i][1];
        return String(Math.round(n));
    }

    function group(intStr) { return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

    function fixed(n, dp) {
        var s = Math.abs(n).toFixed(dp).split('.');
        return (n < 0 ? '−' : '') + group(s[0]) + (s[1] ? '.' + s[1] : '');
    }

    /** $12,480.55 */
    function usd(n, dp) { return (n < 0 ? '−$' : '$') + fixed(Math.abs(n), dp == null ? 2 : dp); }

    /** $1.26T · $845.2M · $12.4K */
    function compact(n) {
        var a = Math.abs(n);
        var units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
        for (var i = 0; i < units.length; i++) {
            if (a >= units[i][0]) return (n < 0 ? '−$' : '$') + (a / units[i][0]).toFixed(a / units[i][0] >= 100 ? 1 : 2) + units[i][1];
        }
        return usd(n);
    }

    /** Price with sensible precision for its magnitude. */
    function price(p) {
        if (p >= 1000) return usd(p, 2);
        if (p >= 1) return usd(p, p >= 100 ? 2 : 3);
        if (p >= 0.01) return usd(p, 4);
        return usd(p, 6);
    }

    /** Coin amount: up to 8 decimals, trimmed; big amounts grouped. */
    function amount(n, sym) {
        var dp = n >= 1e6 ? 0 : n >= 1000 ? 2 : n >= 1 ? 4 : 8;
        var s = fixed(n, dp);
        if (s.indexOf('.') !== -1) s = s.replace(/0+$/, '').replace(/\.$/, '');
        return sym ? s + ' ' + sym : s;
    }

    /** +2.41% */
    function pct(x, dp) {
        var v = x * 100;
        return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(dp == null ? 2 : dp) + '%';
    }

    function signed(n) { return (n > 0 ? '+' : n < 0 ? '−' : '') + usd(Math.abs(n)).replace('$', '$'); }

    function trend(x) { return x > 0.00005 ? 'up' : x < -0.00005 ? 'down' : 'flat'; }

    function when(ts, h24) {
        var d = new Date(ts), now = new Date();
        var time = h24 === false
            ? (d.getHours() % 12 || 12) + ':' + String(d.getMinutes()).padStart(2, '0') + (d.getHours() < 12 ? ' AM' : ' PM')
            : String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        if (d.toDateString() === now.toDateString()) return 'Today, ' + time;
        var y = new Date(now); y.setDate(now.getDate() - 1);
        if (d.toDateString() === y.toDateString()) return 'Yesterday, ' + time;
        return d.getDate() + ' ' + MONTHS[d.getMonth()] + (d.getFullYear() !== now.getFullYear() ? ' ' + d.getFullYear() : '') + ', ' + time;
    }

    function shortHash(h) { return h.slice(0, 8) + '…' + h.slice(-6); }

    global.LSX.Fmt = { compactNum: compactNum, MONTHS: MONTHS, usd: usd, compact: compact, price: price, amount: amount, pct: pct, signed: signed, trend: trend, when: when, shortHash: shortHash, fixed: fixed };
})(window);
