/*
 * Drawn intel: the search-area map, the degraded target photograph and the signal trace.
 * Everything is inline SVG, so it renders identically in the DUI and costs nothing to ship.
 */
(function (global) {
    'use strict';

    var NS = 'http://www.w3.org/2000/svg';
    function svg(tag, attrs, kids) {
        var el = document.createElementNS(NS, tag);
        for (var k in attrs) if (attrs[k] != null) el.setAttribute(k, attrs[k]);
        (kids || []).forEach(function (c) { if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
        return el;
    }

    /* ------------------------------------------------------------------ */
    /* map                                                                 */
    /* ------------------------------------------------------------------ */

    // Los Santos city, world coordinates (GTA units). Deliberately rough: this is an intel plot,
    // not a satnav. x → east, y → north.
    var BOUNDS = { x0: -3000, x1: 1800, y0: -3700, y1: 1300 };
    var W = 480, H = W * (BOUNDS.y1 - BOUNDS.y0) / (BOUNDS.x1 - BOUNDS.x0);
    function px(x) { return (x - BOUNDS.x0) / (BOUNDS.x1 - BOUNDS.x0) * W; }
    function py(y) { return (BOUNDS.y1 - y) / (BOUNDS.y1 - BOUNDS.y0) * H; }
    function scale(r) { return r / (BOUNDS.x1 - BOUNDS.x0) * W; }

    var LAND = [
        [-2250, 1300], [-2100, 700], [-1950, 350], [-1750, -150], [-1600, -520], [-1450, -900], [-1350, -1250],
        [-1500, -1600], [-1250, -1900], [-1900, -2500], [-1850, -3250], [-1150, -3500], [-400, -3000], [-200, -3350],
        [600, -3450], [1250, -3400], [1400, -2800], [1500, -2200], [1800, -1800], [1800, 1300],
    ];
    var DISTRICTS = {
        'VINEWOOD HILLS': [-150, 850], 'WEST VINEWOOD': [-540, 260], 'VINEWOOD': [300, 180], 'RICHMAN': [-1600, 280],
        'ROCKFORD HILLS': [-820, -160], 'BURTON': [-420, -120], 'DEL PERRO': [-1550, -520], 'MORNINGWOOD': [-1300, -300],
        'VESPUCCI': [-1250, -1150], 'LITTLE SEOUL': [-700, -900], 'PILLBOX HILL': [100, -800], 'DOWNTOWN': [150, -650],
        'MIRROR PARK': [1100, -580], 'LA MESA': [820, -1150], 'EL BURRO HEIGHTS': [1350, -1800], 'MURRIETA HEIGHTS': [1150, -1450],
        'STRAWBERRY': [150, -1350], 'DAVIS': [60, -1650], 'CHAMBERLAIN HILLS': [-180, -1600], 'RANCHO': [400, -1900],
        'CYPRESS FLATS': [850, -2150], 'ELYSIAN ISLAND': [0, -2750], 'TERMINAL': [950, -3050], 'LSIA': [-1200, -2800],
        'BANNING': [-150, -2300], 'TEXTILE CITY': [400, -700], 'HAWICK': [150, -150], 'ALTA': [200, -300],
    };
    var LABELS = ['VINEWOOD HILLS', 'WEST VINEWOOD', 'ROCKFORD HILLS', 'DEL PERRO', 'VESPUCCI', 'DOWNTOWN', 'MIRROR PARK', 'LA MESA', 'DAVIS', 'LSIA', 'ELYSIAN ISLAND', 'RICHMAN', 'CYPRESS FLATS'];

    function district(name) {
        if (!name) return null;
        var key = String(name).toUpperCase().split('/')[0].trim();
        return DISTRICTS[key] || null;
    }

    // deterministic street grid so the map looks the same every time
    function rng(seed) { return function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
    var streets = null;
    function streetPath() {
        if (streets) return streets;
        var r = rng(1337), d = '';
        for (var i = 0; i < 420; i++) {
            var x = -1900 + r() * 3700, y = -3400 + r() * 4600, horizontal = r() < 0.5, len = 80 + r() * (i < 40 ? 1600 : 420);
            var a = r() * 0.5 - 0.25;
            var x2 = horizontal ? x + len : x + len * a, y2 = horizontal ? y + len * a : y + len;
            d += 'M' + px(x).toFixed(1) + ' ' + py(y).toFixed(1) + 'L' + px(x2).toFixed(1) + ' ' + py(y2).toFixed(1);
        }
        return (streets = d);
    }

    /**
     * map({ area, world:{x,y,r}, point:{x,y}, delivery:{x,y} }) → <svg>. A search area is drawn
     * as a hatched zone; an exact point only when intel actually provides one.
     */
    var uid = 0;
    var LAND_D = null;
    function landPath() {
        return LAND_D || (LAND_D = 'M' + LAND.map(function (p) { return px(p[0]).toFixed(1) + ' ' + py(p[1]).toFixed(1); }).join('L') + 'L' + W + ' 0L' + px(-2250) + ' 0Z');
    }
    function zoneOf(o) {
        var z = o.world && typeof o.world.x === 'number' ? o.world : null;
        if (!z) { var d = district(o.area || o.name); if (d) z = { x: d[0], y: d[1], r: 420 }; }
        return z;
    }
    /** An irregular blob: search areas aren't circles. */
    function blob(zone) {
        var cx = px(zone.x), cy = py(zone.y), rr = scale(zone.r || 400);
        var pts = [], rnd = rng(Math.round(Math.abs(zone.x * 7 + zone.y * 13)) + 11);
        for (var i = 0; i < 9; i++) { var a = i / 9 * Math.PI * 2, k = 0.78 + rnd() * 0.34; pts.push([cx + Math.cos(a) * rr * k, cy + Math.sin(a) * rr * k * 0.9]); }
        return 'M' + pts.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('L') + 'Z';
    }
    function hatch(id, color) {
        return svg('pattern', { id: id, width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, [
            svg('line', { x1: 0, y1: 0, x2: 0, y2: 5, stroke: color, 'stroke-width': 1.3, 'stroke-opacity': 0.6 }),
        ]);
    }
    function base(view, defs, labelSize) {
        var clip = 'net-land-' + (++uid);
        var kids = [
            svg('defs', {}, [svg('clipPath', { id: clip }, [svg('path', { d: landPath() })])].concat(defs || [])),
            svg('rect', { x: view[0] - 50, y: view[1] - 50, width: view[2] + 100, height: view[3] + 100, class: 'map-sea' }),
            svg('path', { d: landPath(), class: 'map-land' }),
            svg('path', { d: streetPath(), class: 'map-streets', 'clip-path': 'url(#' + clip + ')' }),
            svg('path', { d: gridPath(view), class: 'map-grid' }),
        ];
        LABELS.forEach(function (n) {
            var p = DISTRICTS[n];
            kids.push(svg('text', { x: px(p[0]).toFixed(1), y: py(p[1]).toFixed(1), class: 'map-label', 'font-size': labelSize.toFixed(1) }, [n]));
        });
        return kids;
    }
    function gridPath(v) {
        var d = '', step = v[2] / 12;
        for (var x = Math.ceil(v[0] / step) * step; x < v[0] + v[2]; x += step) d += 'M' + x.toFixed(1) + ' ' + v[1] + 'V' + (v[1] + v[3]);
        for (var y = Math.ceil(v[1] / step) * step; y < v[1] + v[3]; y += step) d += 'M' + v[0] + ' ' + y.toFixed(1) + 'H' + (v[0] + v[2]);
        return d;
    }
    function marker(kids, point, size, color) {
        var qx = px(point.x), qy = py(point.y), s = size;
        kids.push(svg('circle', { cx: qx, cy: qy, r: s * 2.4, class: 'map-point-ring', style: color ? 'stroke:' + color : null }));
        kids.push(svg('path', { d: 'M' + (qx - s) + ' ' + qy + 'H' + (qx + s) + 'M' + qx + ' ' + (qy - s) + 'V' + (qy + s), class: 'map-point' }));
    }
    function viewBox(v) { return v.map(function (n) { return n.toFixed(1); }).join(' '); }

    /**
     * map({ area, world:{x,y,r}, point:{x,y}, color }) → <svg> focused on one search area. The area
     * is a hatched zone; an exact point is drawn only when intel actually provides one.
     */
    function map(o) {
        o = o || {};
        var color = o.color || 'var(--net-danger)';
        var zone = zoneOf(o);
        var focus = zone || { x: -200, y: -800, r: 2200 };
        var span = Math.max(1400, (focus.r || 400) * 5);
        var v = [px(focus.x) - scale(span) / 2, py(focus.y) - scale(span) * 0.62 / 2, scale(span), scale(span) * 0.62];
        var hid = 'net-hatch-' + (++uid);
        var kids = base(v, [hatch(hid, color)], v[2] / 38);
        if (zone && !o.point) {
            var b = blob(zone);
            kids.push(svg('path', { d: b, class: 'map-zone', fill: 'url(#' + hid + ')' }));
            kids.push(svg('path', { d: b, class: 'map-zone-edge', style: 'stroke:' + color }));
        }
        if (o.point) marker(kids, o.point, v[2] / 60, o.pointColor);
        return svg('svg', { class: 'net-map-svg', viewBox: viewBox(v), preserveAspectRatio: 'xMidYMid slice' }, kids);
    }

    /**
     * cityMap({ zones: [{ id, name, world?, color, label, active }], onZone(id) }) → the whole city
     * with every known area. Zones are clickable.
     */
    function cityMap(o) {
        o = o || {};
        var v = [px(-2300), py(1150), px(1750) - px(-2300), py(-3550) - py(1150)];
        var defs = [], kids;
        var zones = (o.zones || []).map(function (z) { var w = zoneOf(z); return w ? { z: z, w: w } : null; }).filter(Boolean);
        zones.forEach(function (x, i) { x.hid = 'net-cz-' + (++uid) + '-' + i; defs.push(hatch(x.hid, x.z.color || 'var(--net-danger)')); });
        kids = base(v, defs, v[2] / 52);
        zones.forEach(function (x) {
            var b = blob(x.w);
            var g = svg('g', { class: 'map-hit' + (x.z.active ? ' is-active' : ''), 'data-zone': x.z.id }, [
                svg('path', { d: b, class: 'map-zone', fill: 'url(#' + x.hid + ')' }),
                svg('path', { d: b, class: 'map-zone-edge', style: 'stroke:' + (x.z.color || 'var(--net-danger)') }),
                svg('text', { x: px(x.w.x).toFixed(1), y: (py(x.w.y) - scale(x.w.r || 400) * 1.05).toFixed(1), class: 'map-tag', 'font-size': (v[2] / 55).toFixed(1), style: 'fill:' + (x.z.color || 'var(--net-danger)') }, [x.z.label || x.z.name || '']),
            ]);
            if (o.onZone) g.addEventListener('click', function () { o.onZone(x.z.id); });
            kids.push(g);
        });
        (o.points || []).forEach(function (p) { marker(kids, p, v[2] / 120, p.color); });
        return svg('svg', { class: 'net-map-svg is-city', viewBox: viewBox(v), preserveAspectRatio: 'xMidYMid meet' }, kids);
    }

    /* ------------------------------------------------------------------ */
    /* charts                                                              */
    /* ------------------------------------------------------------------ */

    /** bars([{ label, value }], { color, height }) → <svg> vertical bars with labels. */
    function bars(data, o) {
        o = o || {};
        var n = data.length || 1, w = 300, hgt = o.height || 110, pad = 18;
        var max = Math.max.apply(null, data.map(function (d) { return d.value; }).concat([1e-9]));
        var bw = (w / n) * 0.62, kids = [];
        kids.push(svg('path', { d: 'M0 ' + (hgt - pad) + 'H' + w, class: 'chart-axis' }));
        data.forEach(function (d, i) {
            var x = (i + 0.5) * (w / n) - bw / 2;
            var bh = Math.max(d.value > 0 ? 2 : 0, (d.value / max) * (hgt - pad - 12));
            kids.push(svg('rect', { x: x.toFixed(1), y: (hgt - pad - bh).toFixed(1), width: bw.toFixed(1), height: bh.toFixed(1), rx: 1.5, class: 'chart-bar' + (d.hot ? ' is-hot' : ''), style: 'fill:' + (d.color || o.color || 'var(--net-access)') }, [svg('title', {}, [d.title || String(d.value)])]));
            if (d.label) kids.push(svg('text', { x: ((i + 0.5) * (w / n)).toFixed(1), y: hgt - 4, class: 'chart-label' }, [d.label]));
        });
        return svg('svg', { class: 'chart chart-bars', viewBox: '0 0 ' + w + ' ' + hgt, preserveAspectRatio: 'none' }, kids);
    }

    /** donut([{ value, color }], size, thickness) */
    function donut(parts, size, th) {
        size = size || 120; th = th || 14;
        var r = (size - th) / 2, c = 2 * Math.PI * r, total = parts.reduce(function (a, p) { return a + p.value; }, 0) || 1, off = 0;
        var kids = [svg('circle', { cx: size / 2, cy: size / 2, r: r, class: 'chart-track', 'stroke-width': th, fill: 'none' })];
        parts.forEach(function (p) {
            var len = p.value / total * c;
            kids.push(svg('circle', { cx: size / 2, cy: size / 2, r: r, fill: 'none', stroke: p.color, 'stroke-width': th,
                'stroke-dasharray': len.toFixed(2) + ' ' + (c - len).toFixed(2), 'stroke-dashoffset': (-off).toFixed(2), transform: 'rotate(-90 ' + size / 2 + ' ' + size / 2 + ')' }));
            off += len;
        });
        return svg('svg', { class: 'chart chart-donut', viewBox: '0 0 ' + size + ' ' + size }, kids);
    }

    /** line([{ t, v }], { color }) → area line chart, auto-scaled. */
    function line(points, o) {
        o = o || {};
        var w = 300, hgt = o.height || 90;
        if (points.length < 2) return svg('svg', { class: 'chart', viewBox: '0 0 ' + w + ' ' + hgt });
        var t0 = points[0].t, t1 = points[points.length - 1].t;
        var vs = points.map(function (p) { return p.v; });
        var lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs);
        if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
        var X = function (t) { return (t - t0) / (t1 - t0 || 1) * w; };
        var Y = function (v) { return hgt - 6 - (v - lo) / (hi - lo) * (hgt - 16); };
        var d = points.map(function (p, i) { return (i ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(p.v).toFixed(1); }).join('');
        var gid = 'net-lg-' + (++uid), color = o.color || 'var(--net-access)';
        return svg('svg', { class: 'chart chart-line', viewBox: '0 0 ' + w + ' ' + hgt, preserveAspectRatio: 'none' }, [
            svg('defs', {}, [svg('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 }, [
                svg('stop', { offset: 0, 'stop-color': color, 'stop-opacity': 0.35 }), svg('stop', { offset: 1, 'stop-color': color, 'stop-opacity': 0 })])]),
            svg('path', { d: d + 'L' + w + ' ' + hgt + 'L0 ' + hgt + 'Z', fill: 'url(#' + gid + ')' }),
            svg('path', { d: d, class: 'chart-line-path', style: 'stroke:' + color }),
        ]);
    }

    /* ------------------------------------------------------------------ */
    /* target photograph                                                   */
    /* ------------------------------------------------------------------ */

    var SHAPES = {
        // side profiles, 200×80, wheels drawn separately
        sports: 'M14 58 L20 44 Q48 38 70 30 Q98 20 126 24 Q150 28 170 40 L188 46 Q194 50 192 58 Z',
        super: 'M10 58 L18 48 Q60 40 84 28 Q110 20 136 26 Q160 32 184 46 Q194 52 192 58 Z',
        sedan: 'M12 58 L16 44 L46 40 Q62 24 86 22 L128 22 Q146 24 158 38 L184 42 Q192 48 190 58 Z',
        compact: 'M24 58 L26 42 Q40 38 54 26 Q70 18 104 18 Q126 20 138 36 L162 42 Q170 48 168 58 Z',
        suv: 'M12 58 L14 36 Q20 20 44 18 L140 18 Q156 20 166 32 L186 38 Q192 46 190 58 Z',
        van: 'M12 58 L12 20 Q14 12 30 12 L150 12 Q162 14 172 30 L188 38 Q192 46 190 58 Z',
        muscle: 'M10 58 L14 44 L50 40 Q70 26 96 26 L128 26 Q146 28 156 40 L188 44 Q194 50 192 58 Z',
    };
    var WHEELS = { sports: [48, 158], super: [46, 160], sedan: [46, 156], compact: [52, 144], suv: [46, 158], van: [46, 158], muscle: [46, 160] };

    /** photo({ kind: 'cctv'|'crop'|'silhouette'|'none', shape, cam, url, stamp }) */
    function photo(o, stamp) {
        o = o || {};
        var wrap = document.createElement('div');
        wrap.className = 'net-photo is-' + (o.kind || 'none');
        if (o.kind === 'none') {
            wrap.innerHTML = '<div class="net-photo-none">NO IMAGE</div>';
            return wrap;
        }
        if (o.url) {
            var img = document.createElement('img');
            img.src = o.url; img.alt = ''; img.referrerPolicy = 'no-referrer';
            wrap.appendChild(img);
        } else {
            var shape = SHAPES[o.shape] ? o.shape : 'sedan';
            var wheels = WHEELS[shape];
            var body = svg('g', { class: 'ph-car' }, [
                svg('path', { d: SHAPES[shape] }),
                svg('circle', { cx: wheels[0], cy: 60, r: 11 }),
                svg('circle', { cx: wheels[1], cy: 60, r: 11 }),
            ]);
            var scene = svg('svg', { viewBox: o.kind === 'crop' ? '70 0 130 80' : '-40 -30 280 130', preserveAspectRatio: 'xMidYMid slice' }, [
                svg('defs', {}, [
                    svg('filter', { id: 'ph-blur' }, [svg('feGaussianBlur', { stdDeviation: o.kind === 'silhouette' ? 2.2 : 1.1 })]),
                ]),
                svg('rect', { x: -40, y: 70, width: 280, height: 40, class: 'ph-ground' }),
                svg('g', { filter: 'url(#ph-blur)', transform: o.kind === 'cctv' ? 'skewX(-6) translate(8 0)' : null }, [body]),
            ]);
            wrap.appendChild(scene);
        }
        var noise = document.createElement('div'); noise.className = 'net-photo-noise'; wrap.appendChild(noise);
        var meta = document.createElement('div');
        meta.className = 'net-photo-meta';
        var t = new Date(stamp || Date.now());
        var ts = [t.getHours(), t.getMinutes(), t.getSeconds()].map(function (n) { return String(n).padStart(2, '0'); }).join(':');
        meta.innerHTML = '<span>' + (o.kind === 'silhouette' ? 'REF · UNVERIFIED' : (o.cam || 'CAM') + ' · ' + ts) + '</span><span class="rec">●</span>';
        wrap.appendChild(meta);
        return wrap;
    }

    /* ------------------------------------------------------------------ */
    /* signal                                                              */
    /* ------------------------------------------------------------------ */

    /** −100 dBm (nothing) … −30 dBm (on top of it) → 0…1 */
    function signalLevel(dbm) { return dbm == null ? 0 : Math.max(0, Math.min(1, (dbm + 100) / 70)); }

    /** A live trace that jitters around the current level. Returns { el, set(dbm), stop() }. */
    function trace() {
        var el = svg('svg', { class: 'net-trace', viewBox: '0 0 300 60', preserveAspectRatio: 'none' });
        var path = svg('path', { class: 'net-trace-line' });
        var base = svg('path', { class: 'net-trace-base', d: 'M0 59H300' });
        el.appendChild(base); el.appendChild(path);
        var pts = [], level = 0, timer = null;
        for (var i = 0; i < 60; i++) pts.push(0);
        function draw() {
            pts.shift();
            pts.push(level ? Math.max(0, Math.min(1, level + (Math.random() - 0.5) * 0.18 * (1 - level * 0.5))) : Math.random() * 0.04);
            path.setAttribute('d', pts.map(function (p, i) { return (i ? 'L' : 'M') + (i * 300 / 59).toFixed(1) + ' ' + (58 - p * 54).toFixed(1); }).join(''));
        }
        function loop() { if (document.documentElement.getAttribute('data-tablet-visible') !== 'false') draw(); timer = setTimeout(loop, 140); }
        loop();
        return {
            el: el,
            set: function (dbm) { level = signalLevel(dbm); },
            stop: function () { clearTimeout(timer); },
        };
    }

    global.NET = global.NET || {};
    global.NET.Visuals = { map: map, cityMap: cityMap, bars: bars, donut: donut, line: line, photo: photo, trace: trace, signalLevel: signalLevel, district: district };
})(window);
