import { h } from './util.js';

// GNOME-style symbolic icons: 24×24, 2px stroke, round caps.
const SYMBOLIC = {
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    home: '<path d="M4 11l8-7 8 7"/><path d="M6.5 9.5V20h11V9.5"/><path d="M10 20v-5h4v5"/>',
    grid: '<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>',
    bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    bellOff: '<path d="M8.2 5.3A6 6 0 0 1 18 11v4.5M6 11v5.5L4.5 18H18"/><path d="M10 20.5a2 2 0 0 0 4 0"/><path d="M3.5 3.5l17 17"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6L6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>',
    brightness: '<circle cx="12" cy="12" r="4"/><path d="M12 3v1.5M12 19.5V21M3 12h1.5M19.5 12H21M5.6 5.6l1.1 1.1M17.3 17.3l1.1 1.1M5.6 18.4l1.1-1.1M17.3 6.7l1.1-1.1"/>',
    darkStyle: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/>',
    lock: '<rect x="5" y="11" width="14" height="9.5" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    power: '<path d="M12 3.5V12"/><path d="M6.6 7a7.5 7.5 0 1 0 10.8 0"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    chevronLeft: '<path d="M14.5 6l-6 6 6 6"/>',
    chevronRight: '<path d="M9.5 6l6 6-6 6"/>',
    chevronUp: '<path d="M6 14.5l6-6 6 6"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.2"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 15.5l-4.5-4.5-8.5 8.5"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    display: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8.5 20h7M12 16.5V20"/>',
    terminal: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M7.5 9.5l3 2.5-3 2.5M12.5 15h4"/>',
    palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1 0 1.5-.7 1.5-1.5 0-1.1-1-1.4-1-2.4 0-.9.8-1.6 1.7-1.6H17a3.5 3.5 0 0 0 3.5-3.5c0-4.4-3.8-8-8.5-8z"/><circle cx="7.8" cy="11" r=".9" fill="currentColor"/><circle cx="10.2" cy="7.4" r=".9" fill="currentColor"/><circle cx="14.6" cy="7.6" r=".9" fill="currentColor"/>',
    system: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9.5 2.5V6M14.5 2.5V6M9.5 18v3.5M14.5 18v3.5M2.5 9.5H6M2.5 14.5H6M18 9.5h3.5M18 14.5h3.5"/>',
    bolt: '<path d="M13 2.5L5.5 13.5h6l-1 8 7.5-11h-6z" fill="currentColor" stroke="none"/>',
    trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
    wifi: '<path d="M2.5 9a14 14 0 0 1 19 0M5.8 12.4a9.5 9.5 0 0 1 12.4 0M9.1 15.8a5 5 0 0 1 5.8 0"/><circle cx="12" cy="19" r="1" fill="currentColor"/>',
    lockScreen: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>',
};

// Filled glyphs for app tiles.
const FILLED = {
    gear: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.47.47 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.47.47 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z',
};

/** Symbolic icon, sized by font-size (1em). */
export function icon(name, cls = '') {
    const body = SYMBOLIC[name];
    return h('span', {
        class: `icon ${cls}`,
        html: body
            ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
            : '',
    });
}

/** OS mark: four rounded squares. */
export function logoMark(cls = '') {
    return h('span', {
        class: `logo-mark ${cls}`,
        html: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">'
            + '<rect x="2" y="2" width="9" height="9" rx="2.4"/><rect x="13" y="2" width="9" height="9" rx="2.4" opacity=".7"/>'
            + '<rect x="2" y="13" width="9" height="9" rx="2.4" opacity=".7"/><rect x="13" y="13" width="9" height="9" rx="2.4" opacity=".45"/></svg>',
    });
}

function iconSource(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const v = value.trim();
    // inline SVG → data URI in an <img>, so scripts inside it never run
    if (v.startsWith('<svg')) return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(v)}`;
    if (/^(https?:|nui:|data:image\/)/i.test(v) || v.startsWith('/') || v.startsWith('.')) return v;
    return null;
}

/**
 * App tile (the rounded square). Supports image URLs, inline SVG strings,
 * built-in glyphs (system apps only) and falls back to the first letter.
 */
export function appTile(app, cls = '') {
    const tile = h('span', { class: `tile ${cls}` });
    if (app.color) tile.style.backgroundColor = app.color;
    else tile.classList.add('tile-default');

    const letter = () => h('span', { class: 'tile-letter' }, (app.label || app.id || '?').trim().charAt(0).toUpperCase());

    if (app.systemIcon && FILLED[app.systemIcon]) {
        tile.append(h('span', {
            class: 'tile-glyph',
            html: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${FILLED[app.systemIcon]}"/></svg>`,
        }));
    } else {
        const src = iconSource(app.icon);
        if (src) {
            const img = h('img', { src, alt: '', draggable: 'false' });
            img.addEventListener('error', () => {
                img.replaceWith(letter());
                tile.classList.remove('has-image');
            }, { once: true });
            tile.append(img);
            tile.classList.add('has-image');
        } else {
            tile.append(letter());
        }
    }
    return tile;
}
