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
    function map(o) {
        o = o || {};
        var zone = o.world && typeof o.world.x === 'number' ? o.world : null;
        if (!zone) { var d = district(o.area); if (d) zone = { x: d[0], y: d[1], r: 420 }; }
        var focus = zone || { x: -200, y: -800, r: 2200 };
        var span = Math.max(1400, (focus.r || 400) * 5);
        var vx = px(focus.x) - scale(span) / 2, vy = py(focus.y) - scale(span) * 0.62 / 2;
        var vw = scale(span), vh = scale(span) * 0.62;

        var land = 'M' + LAND.map(function (p) { return px(p[0]).toFixed(1) + ' ' + py(p[1]).toFixed(1); }).join('L') + 'L' + W + ' 0L' + px(-2250) + ' 0Z';
        var kids = [
            svg('defs', {}, [
                svg('pattern', { id: 'net-hatch', width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, [
                    svg('line', { x1: 0, y1: 0, x2: 0, y2: 5, stroke: 'var(--net-danger)', 'stroke-width': 1.2, 'stroke-opacity': 0.55 }),
                ]),
                svg('clipPath', { id: 'net-land' }, [svg('path', { d: land })]),
            ]),
            svg('rect', { x: vx - 50, y: vy - 50, width: vw + 100, height: vh + 100, class: 'map-sea' }),
            svg('path', { d: land, class: 'map-land' }),
            svg('path', { d: streetPath(), class: 'map-streets', 'clip-path': 'url(#net-land)' }),
        ];
        LABELS.forEach(function (n) {
            var p = DISTRICTS[n];
            kids.push(svg('text', { x: px(p[0]).toFixed(1), y: py(p[1]).toFixed(1), class: 'map-label', 'font-size': (vw / 38).toFixed(1) }, [n]));
        });
        if (zone && !o.point) {
            var cx = px(zone.x), cy = py(zone.y), rr = scale(zone.r || 400);
            // an irregular blob: search areas aren't circles
            var pts = [], rnd = rng(Math.round(Math.abs(zone.x * 7 + zone.y * 13)) + 11);
            for (var i = 0; i < 9; i++) { var a = i / 9 * Math.PI * 2, k = 0.78 + rnd() * 0.34; pts.push([cx + Math.cos(a) * rr * k, cy + Math.sin(a) * rr * k * 0.9]); }
            var blob = 'M' + pts.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('L') + 'Z';
            kids.push(svg('path', { d: blob, class: 'map-zone', fill: 'url(#net-hatch)' }));
            kids.push(svg('path', { d: blob, class: 'map-zone-edge' }));
        }
        if (o.point) {
            var qx = px(o.point.x), qy = py(o.point.y), s = vw / 60;
            kids.push(svg('circle', { cx: qx, cy: qy, r: s * 2.4, class: 'map-point-ring' }));
            kids.push(svg('path', { d: 'M' + (qx - s) + ' ' + qy + 'H' + (qx + s) + 'M' + qx + ' ' + (qy - s) + 'V' + (qy + s), class: 'map-point' }));
        }
        return svg('svg', { class: 'net-map-svg', viewBox: [vx, vy, vw, vh].map(function (n) { return n.toFixed(1); }).join(' '), preserveAspectRatio: 'xMidYMid slice' }, kids);
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
    global.NET.Visuals = { map: map, photo: photo, trace: trace, signalLevel: signalLevel, district: district };
})(window);
