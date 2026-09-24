/* SVG charts: price chart (area line or candles) with crosshair, sparkline, donut, QR-style code. */
(function (global) {
    'use strict';
    var NS = 'http://www.w3.org/2000/svg';

    function svg(tag, attrs) {
        var el = document.createElementNS(NS, tag);
        for (var k in attrs) if (attrs[k] != null) el.setAttribute(k, attrs[k]);
        for (var i = 2; i < arguments.length; i++) if (arguments[i]) el.appendChild(arguments[i]);
        return el;
    }

    var uid = 0;

    /** Tiny sparkline. */
    function sparkline(points, opts) {
        opts = opts || {};
        var w = opts.width || 120, hgt = opts.height || 36;
        var min = Infinity, max = -Infinity;
        points.forEach(function (p) { if (p.p < min) min = p.p; if (p.p > max) max = p.p; });
        var span = max - min || 1;
        var d = points.map(function (p, i) {
            var x = (i / (points.length - 1)) * w;
            var y = hgt - 2 - ((p.p - min) / span) * (hgt - 4);
            return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
        }).join('');
        var up = points[points.length - 1].p >= points[0].p;
        var id = 'sg' + ++uid;
        var cls = up ? 'is-up' : 'is-down';
        return svg('svg', { class: 'spark ' + cls, viewBox: '0 0 ' + w + ' ' + hgt, preserveAspectRatio: 'none', width: w, height: hgt },
            svg('defs', {}, svg('linearGradient', { id: id, x1: 0, y1: 0, x2: 0, y2: 1 },
                svg('stop', { offset: '0', 'stop-color': 'currentColor', 'stop-opacity': '.25' }),
                svg('stop', { offset: '1', 'stop-color': 'currentColor', 'stop-opacity': '0' }))),
            opts.fill === false ? null : svg('path', { d: d + 'L' + w + ' ' + hgt + 'L0 ' + hgt + 'Z', fill: 'url(#' + id + ')', stroke: 'none' }),
            svg('path', { d: d, fill: 'none', stroke: 'currentColor', 'stroke-width': opts.stroke || 1.6, 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }));
    }

    function niceTicks(min, max, count) {
        var span = max - min || Math.abs(max) || 1;
        var step = Math.pow(10, Math.floor(Math.log10(span / count)));
        var err = (span / count) / step;
        if (err >= 7.5) step *= 10; else if (err >= 3.5) step *= 5; else if (err >= 1.5) step *= 2;
        var out = [];
        for (var v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(v);
        return out;
    }

    /**
     * Interactive price chart.
     * @param {HTMLElement} host   element to draw into (sized by CSS)
     * @param {object} o  { points:[{t,p}], candles:[{t,o,h,l,c}], mode:'line'|'candles',
     *                      formatPrice(p), formatTime(t), onHover(point|null) }
     */
    function priceChart(host, o) {
        var W = host.clientWidth || 800, H = host.clientHeight || 300;
        var data = o.mode === 'candles' ? o.candles : o.points;
        if (!data || !data.length) { host.replaceChildren(); return; }
        // right gutter wide enough for the longest price label
        var longest = Math.max(o.formatPrice(data[data.length - 1].p != null ? data[data.length - 1].p : data[data.length - 1].c).length, 8);
        var padL = 8, padR = Math.round(longest * 7.2 + 22), padT = 14, padB = 26;
        var cw = W - padL - padR, ch = H - padT - padB;

        var min = Infinity, max = -Infinity;
        data.forEach(function (d) {
            var lo = o.mode === 'candles' ? d.l : d.p, hi = o.mode === 'candles' ? d.h : d.p;
            if (lo < min) min = lo; if (hi > max) max = hi;
        });
        var padV = (max - min) * 0.08 || max * 0.01;
        min -= padV; max += padV;
        var t0 = data[0].t, t1 = o.mode === 'candles' ? data[data.length - 1].t + (data[1] ? data[1].t - data[0].t : 0) : data[data.length - 1].t;
        var x = function (t) { return padL + ((t - t0) / (t1 - t0 || 1)) * cw; };
        var y = function (p) { return padT + (1 - (p - min) / (max - min)) * ch; };

        var first = o.mode === 'candles' ? data[0].o : data[0].p;
        var lastP = o.mode === 'candles' ? data[data.length - 1].c : data[data.length - 1].p;
        var up = lastP >= first;
        var root = svg('svg', { class: 'pchart ' + (up ? 'is-up' : 'is-down'), width: W, height: H, viewBox: '0 0 ' + W + ' ' + H });

        // grid + price axis
        var grid = svg('g', { class: 'pchart-grid' });
        niceTicks(min, max, 5).forEach(function (v) {
            var yy = y(v);
            if (yy < padT - 1 || yy > padT + ch + 1) return;
            grid.appendChild(svg('line', { x1: padL, x2: padL + cw, y1: yy, y2: yy }));
            var label = svg('text', { x: W - padR + 10, y: yy + 4, class: 'pchart-axis' });
            label.textContent = o.formatPrice(v);
            grid.appendChild(label);
        });
        // time axis: 5 labels
        for (var i = 0; i <= 4; i++) {
            var tt = t0 + ((t1 - t0) * i) / 4;
            var lab = svg('text', { x: x(tt), y: H - 7, class: 'pchart-axis', 'text-anchor': i === 0 ? 'start' : i === 4 ? 'end' : 'middle' });
            lab.textContent = o.formatTime(tt);
            grid.appendChild(lab);
        }
        root.appendChild(grid);

        if (o.mode === 'candles') {
            var slot = cw / data.length;
            var bw = Math.max(1.5, slot * 0.62);
            var g = svg('g', {});
            data.forEach(function (c, i) {
                var cx = padL + slot * (i + 0.5);
                var cls = c.c >= c.o ? 'candle is-up' : 'candle is-down';
                var yo = y(c.o), yc = y(c.c);
                g.appendChild(svg('line', { class: cls, x1: cx, x2: cx, y1: y(c.h), y2: y(c.l) }));
                g.appendChild(svg('rect', { class: cls, x: cx - bw / 2, y: Math.min(yo, yc), width: bw, height: Math.max(1, Math.abs(yc - yo)), rx: Math.min(1.5, bw / 4) }));
            });
            root.appendChild(g);
        } else {
            var id = 'pc' + ++uid;
            var d = data.map(function (p, i) { return (i ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(p.p).toFixed(1); }).join('');
            root.appendChild(svg('defs', {}, svg('linearGradient', { id: id, x1: 0, y1: 0, x2: 0, y2: 1 },
                svg('stop', { offset: '0', class: 'pchart-stop', 'stop-opacity': '.28' }),
                svg('stop', { offset: '1', class: 'pchart-stop', 'stop-opacity': '0' }))));
            root.appendChild(svg('path', { class: 'pchart-area', d: d + 'L' + x(data[data.length - 1].t) + ' ' + (padT + ch) + 'L' + x(t0) + ' ' + (padT + ch) + 'Z', fill: 'url(#' + id + ')' }));
            root.appendChild(svg('path', { class: 'pchart-line', d: d }));
            // opening reference line
            root.appendChild(svg('line', { class: 'pchart-ref', x1: padL, x2: padL + cw, y1: y(first), y2: y(first) }));
        }

        // last price tag
        var ly = y(lastP);
        root.appendChild(svg('line', { class: 'pchart-last', x1: padL, x2: padL + cw, y1: ly, y2: ly }));
        var tag = svg('g', { class: 'pchart-tag' },
            svg('rect', { x: W - padR + 4, y: ly - 10, width: padR - 6, height: 20, rx: 5 }));
        var tagText = svg('text', { x: W - padR + 10, y: ly + 4 });
        tagText.textContent = o.formatPrice(lastP);
        tag.appendChild(tagText);
        root.appendChild(tag);

        // crosshair
        var cross = svg('g', { class: 'pchart-cross', visibility: 'hidden' },
            svg('line', { class: 'pchart-cross-v', y1: padT, y2: padT + ch }),
            svg('line', { class: 'pchart-cross-h', x1: padL, x2: padL + cw }),
            svg('circle', { r: 4.5 }));
        root.appendChild(cross);
        var hit = svg('rect', { x: padL, y: 0, width: cw, height: H, fill: 'transparent', style: 'cursor:crosshair' });
        root.appendChild(hit);

        function nearest(px) {
            var t = t0 + ((px - padL) / cw) * (t1 - t0);
            if (o.mode === 'candles') {
                var idx = Math.max(0, Math.min(data.length - 1, Math.floor(((px - padL) / cw) * data.length)));
                return { i: idx, d: data[idx] };
            }
            var lo = 0, hi = data.length - 1;
            while (hi - lo > 1) { var m = (lo + hi) >> 1; if (data[m].t < t) lo = m; else hi = m; }
            var idx2 = Math.abs(data[lo].t - t) < Math.abs(data[hi].t - t) ? lo : hi;
            return { i: idx2, d: data[idx2] };
        }

        hit.addEventListener('pointermove', function (e) {
            var r = root.getBoundingClientRect();
            var n = nearest(e.clientX - r.left);
            var cx = o.mode === 'candles' ? padL + (cw / data.length) * (n.i + 0.5) : x(n.d.t);
            var val = o.mode === 'candles' ? n.d.c : n.d.p;
            var cy = y(val);
            cross.setAttribute('visibility', 'visible');
            cross.children[0].setAttribute('x1', cx); cross.children[0].setAttribute('x2', cx);
            cross.children[1].setAttribute('y1', cy); cross.children[1].setAttribute('y2', cy);
            cross.children[2].setAttribute('cx', cx); cross.children[2].setAttribute('cy', cy);
            if (o.onHover) o.onHover(n.d);
        });
        hit.addEventListener('pointerleave', function () {
            cross.setAttribute('visibility', 'hidden');
            if (o.onHover) o.onHover(null);
        });

        host.replaceChildren(root);
    }

    /** Donut chart: slices [{ value, color, label }]. */
    function donut(slices, size, thickness) {
        var total = slices.reduce(function (a, s) { return a + s.value; }, 0) || 1;
        var r = (size - thickness) / 2, c = size / 2, circ = 2 * Math.PI * r;
        var root = svg('svg', { class: 'donut', width: size, height: size, viewBox: '0 0 ' + size + ' ' + size });
        root.appendChild(svg('circle', { cx: c, cy: c, r: r, class: 'donut-track', 'stroke-width': thickness, fill: 'none' }));
        var offset = 0;
        slices.forEach(function (s) {
            var len = (s.value / total) * circ;
            if (len <= 0) return;
            var gap = slices.length > 1 ? Math.min(2, len / 3) : 0;
            root.appendChild(svg('circle', {
                cx: c, cy: c, r: r, fill: 'none', stroke: s.color, 'stroke-width': thickness,
                'stroke-dasharray': Math.max(0, len - gap) + ' ' + (circ - Math.max(0, len - gap)),
                'stroke-dashoffset': -offset, transform: 'rotate(-90 ' + c + ' ' + c + ')', class: 'donut-slice',
            }));
            offset += len;
        });
        return root;
    }

    /** Deterministic QR-style block pattern for a wallet address (decorative, not a real QR code). */
    function addressCode(text, size) {
        var n = 25, cell = size / n;
        var h = 2166136261;
        for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
        var bits = function (k) { var x = Math.imul(h ^ k * 2654435761, 2246822519); x ^= x >>> 15; return (x >>> 0) % 100 < 47; };
        var root = svg('svg', { class: 'qr', width: size, height: size, viewBox: '0 0 ' + size + ' ' + size });
        root.appendChild(svg('rect', { width: size, height: size, rx: cell * 1.5, class: 'qr-bg' }));
        var finder = function (fx, fy) {
            return (fx < 7 && fy < 7) || (fx >= n - 7 && fy < 7) || (fx < 7 && fy >= n - 7);
        };
        var path = '';
        for (var yy = 0; yy < n; yy++) {
            for (var xx = 0; xx < n; xx++) {
                if (finder(xx, yy)) continue;
                if (bits(yy * n + xx)) path += 'M' + (xx * cell) + ' ' + (yy * cell) + 'h' + cell + 'v' + cell + 'h-' + cell + 'z';
            }
        }
        root.appendChild(svg('path', { d: path, class: 'qr-fg' }));
        [[0, 0], [n - 7, 0], [0, n - 7]].forEach(function (f) {
            var fx = f[0] * cell, fy = f[1] * cell;
            root.appendChild(svg('rect', { x: fx + cell * 0.5, y: fy + cell * 0.5, width: cell * 6, height: cell * 6, rx: cell * 1.4, class: 'qr-finder-outer' }));
            root.appendChild(svg('rect', { x: fx + cell * 2, y: fy + cell * 2, width: cell * 3, height: cell * 3, rx: cell * 0.8, class: 'qr-fg' }));
        });
        return root;
    }

    global.LSX.Charts = { sparkline: sparkline, priceChart: priceChart, donut: donut, addressCode: addressCode };
})(window);
