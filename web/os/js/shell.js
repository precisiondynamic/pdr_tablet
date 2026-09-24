// System chrome: top bar, lock screen, power states, wallpaper/theme/brightness, home bar and
// the overlay manager (overview, message tray, control center).

import { Apps } from './apps.js';
import { Boot } from './boot.js';
import { Bridge } from './bridge.js';
import { Dialog } from './dialog.js';
import { log } from './log.js';
import { Menu } from './menu.js';
import { Notifications, notificationCard } from './notifications.js';
import { state, settings, on, setState, UI_SCALES } from './store.js';
import { icon } from './icons.js';
import { wallpaperCss } from './wallpapers.js';
import { h, fill, drag, cancelGestures, formatDate, formatTime, timeParts, hexToRgb, clamp } from './util.js';

const $ = (id) => document.getElementById(id);

let device, lockEl, lockInner;
let lastMinute = -1;
const overlays = new Map();   // name → { onOpen?, onClose? }

/* ---------- appearance ---------- */

function applyAppearance(changed) {
    const root = document.documentElement;
    if (!changed || changed.includes('theme')) root.dataset.theme = settings.theme;
    if (!changed || changed.includes('accent')) {
        root.style.setProperty('--accent', settings.accent);
        root.style.setProperty('--accent-rgb', hexToRgb(settings.accent));
    }
    if (!changed || changed.some((k) => k === 'wallpaper' || k === 'customWallpaper')) {
        $('wallpaper').style.background = wallpaperCss(settings);
    }
    if (!changed || changed.includes('brightness')) {
        // 100 → no dimming, 10 → 80 % black overlay
        $('dim').style.opacity = String(((100 - settings.brightness) / 90) * 0.8);
    }
    if (!changed || changed.some((k) => k === 'nightLight' || k === 'nightLightStrength')) {
        // warm multiply filter; strength 100 ≈ a strong evening tint
        $('nightlight').style.opacity = settings.nightLight ? String((settings.nightLightStrength / 100) * 0.5) : '0';
    }
    if (!changed || changed.includes('uiScale')) {
        root.style.setProperty('--ui-scale', String(UI_SCALES[settings.uiScale]));
    }
}

function applyState() {
    device.classList.toggle('is-asleep', !state.awake);
    device.classList.toggle('is-locked', state.locked);
    device.classList.toggle('is-booting', state.booting);
    device.classList.toggle('in-app', state.view === 'app');
    if (state.overlay) device.dataset.overlay = state.overlay;
    else delete device.dataset.overlay;
    for (const [name] of overlays) $(`tb-${name}`)?.classList.toggle('is-active', state.overlay === name);
}

/* ---------- top bar ---------- */

function buildTopBar() {
    $('topbar').append(
        h('div', { class: 'tb-start' },
            h('button', { class: 'tb-btn tb-activities', id: 'tb-overview', title: 'Activities', onClick: () => Shell.toggleOverlay('overview') },
                h('span', { class: 'ws', id: 'tb-ws' })),
        ),
        h('div', { class: 'tb-center' },
            h('button', { class: 'tb-btn tb-clock', id: 'tb-calendar', title: 'Calendar and notifications', onClick: () => Shell.toggleOverlay('calendar') },
                h('span', { id: 'tb-clock-text' }),
                h('span', { class: 'tb-unread', id: 'tb-unread' })),
        ),
        h('div', { class: 'tb-end' },
            h('button', { class: 'tb-btn tb-tray', id: 'tb-control', title: 'Control Center', onClick: () => Shell.toggleOverlay('control') }),
        ),
    );
    renderTray();
    renderWorkspaces();
    renderUnread();
}

/** Activities indicator: one pill for the current view plus a dot per background app. */
function renderWorkspaces() {
    const others = Math.min(Apps.running().filter((a) => a.id !== Apps.foreground).length, 5);
    fill($('tb-ws'), h('i', { class: 'ws-active' }), Array.from({ length: others }, () => h('i')));
}

function renderUnread() {
    $('tb-unread').classList.toggle('is-visible', Notifications.unread > 0 && !settings.dnd);
}

function signalBars(level) {
    const bars = h('span', { class: 'tb-signal', title: `Signal ${level}/4` });
    for (let i = 1; i <= 4; i++) bars.append(h('i', { class: i <= level ? 'on' : '' }));
    return bars;
}

export function batteryIndicator() {
    const { battery, charging } = state.status;
    if (!Number.isFinite(battery)) return null;
    return h('span', { class: 'tb-battery' },
        h('span', { class: `battery ${battery <= 20 && !charging ? 'is-low' : ''}` },
            h('span', { class: 'battery-fill', style: { width: `${clamp(battery, 0, 100)}%` } }),
            charging ? icon('bolt', 'battery-bolt') : null),
        h('span', null, `${Math.round(battery)}%`));
}

function renderTray() {
    const { signal, network } = state.status;
    fill($('tb-control'),
        settings.dnd ? icon('bellOff', 'tb-icon') : null,
        settings.nightLight ? icon('nightLight', 'tb-icon') : null,
        network ? h('span', { class: 'tb-network' }, network) : null,
        Number.isFinite(signal) ? signalBars(clamp(Math.round(signal), 0, 4)) : null,
        batteryIndicator(),
        icon('power', 'tb-icon'),
    );
}

function tickClock(force) {
    const now = new Date();
    if (!force && now.getMinutes() === lastMinute) return;
    lastMinute = now.getMinutes();

    const date = settings.statusDate ? formatDate(now, 'short') : '';
    $('tb-clock-text').textContent = date ? `${date}  ${formatTime(now, settings.clock24h)}` : formatTime(now, settings.clock24h);

    const { hm, suffix } = timeParts(now, settings.clock24h);
    fill(lockEl.querySelector('.lock-time'), hm, suffix ? h('small', null, suffix) : null);
    lockEl.querySelector('.lock-date').textContent = formatDate(now);
    renderLockNotifications();   // keeps the relative times fresh
    document.dispatchEvent(new CustomEvent('pdr:minute', { detail: now }));
}

/* ---------- lock screen ---------- */

function buildLock() {
    lockEl = $('lock');
    lockInner = h('div', { class: 'lock-inner' },
        h('div', { class: 'lock-clock' },
            h('div', { class: 'lock-time' }),
            h('div', { class: 'lock-date' }),
        ),
        h('div', { class: 'lock-notifs', id: 'lock-notifs' }),
        h('div', { class: 'lock-hint' }, icon('chevronUp'), h('span', null, 'Swipe up or click to unlock')),
    );
    lockEl.append(lockInner);

    let dragged = false;
    let swallowClick = false;   // the stray pointerup of a gesture cancelled by sleep/lock
    lockEl.addEventListener('pointerdown', () => { swallowClick = false; });
    drag(lockEl, {
        onStart: () => { dragged = true; lockEl.classList.add('is-dragging'); },
        onMove: (dx, dy) => {
            const y = Math.min(0, dy);
            lockInner.style.transform = `translateY(${y}px)`;
            lockInner.style.opacity = String(1 + y / (lockEl.clientHeight * 0.6));
        },
        onCancel: () => {
            lockEl.classList.remove('is-dragging');
            lockInner.style.transform = '';
            lockInner.style.opacity = '';
            dragged = false;
            swallowClick = true;
        },
        onEnd: (dx, dy, e, ms) => {
            lockEl.classList.remove('is-dragging');
            lockInner.style.transform = '';
            lockInner.style.opacity = '';
            const fling = dy < -40 && ms < 300;
            if (dy < -lockEl.clientHeight * 0.18 || fling) Shell.unlock();
            // the click that follows a drag must not unlock
            setTimeout(() => { dragged = false; }, 0);
        },
    });
    lockEl.addEventListener('click', (e) => {
        if (swallowClick) { swallowClick = false; return; }
        if (dragged || e.target.closest('.notif')) return;
        Shell.unlock();
    });
}

function renderLockNotifications() {
    const box = $('lock-notifs');
    const all = Notifications.all();
    if (!settings.lockPreviews) {
        fill(box, all.length
            ? h('div', { class: 'lock-count' }, icon('bell'), `${all.length} notification${all.length === 1 ? '' : 's'}`)
            : null);
        return;
    }
    fill(box, all.slice(0, 3).map((n) => notificationCard(n, { compact: true })));
}

/* ---------- home bar (click = home, swipe up = overview) ---------- */

function buildHomeBar() {
    const bar = $('homebar');
    bar.append(h('span', { class: 'homebar-pill' }));
    drag(bar, {
        threshold: 6,
        onMove: (dx, dy) => bar.style.setProperty('--pull', `${Math.max(-40, Math.min(0, dy))}px`),
        onCancel: () => bar.style.removeProperty('--pull'),
        onEnd: (dx, dy, e, ms, moved) => {
            bar.style.removeProperty('--pull');
            if (state.locked || !state.awake) return;
            if (moved) {
                if (dy < -30) Shell.openOverlay('overview');
                return;
            }
            Shell.closeOverlays();
            if (state.view === 'app') Apps.home();
        },
    });
}

/* ---------- public ---------- */

export const Shell = {
    init() {
        device = $('device');
        buildTopBar();
        buildLock();
        buildHomeBar();
        Boot.init();

        $('overlay-scrim').addEventListener('pointerdown', () => Shell.closeOverlays());
        // the screen never scrolls; focus() or scrollIntoView() inside a layer must not shift it
        device.addEventListener('scroll', () => { device.scrollTop = 0; device.scrollLeft = 0; });

        applyAppearance();
        applyState();
        tickClock(true);
        renderLockNotifications();
        setInterval(() => tickClock(false), 1000);

        on('state', applyState);
        on('running', renderWorkspaces);
        on('settings', (changed) => {
            applyAppearance(changed);
            if (changed.some((k) => ['clock24h', 'statusDate'].includes(k))) tickClock(true);
            if (changed.includes('dnd')) { renderTray(); renderUnread(); }
            if (changed.includes('nightLight')) renderTray();
            if (changed.includes('lockPreviews')) renderLockNotifications();
            if (changed.includes('lockEnabled') && !settings.lockEnabled && state.locked && state.awake) Shell.unlock();
        });
        on('notifications', () => { renderLockNotifications(); renderUnread(); });
        on('notification:open', (n) => {
            Shell.closeOverlays();
            Apps.launch(n.appId, n.data);   // deferred until unlock when locked; data = deep link
            if (state.locked) Shell.unlock();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || Dialog.isOpen()) return;
            if (Menu.isOpen()) Menu.close();
            else if (state.overlay) Shell.closeOverlays();
        });
        log.ok('shell', 'Started Shell (top bar, lock screen, home bar).');
    },

    /* overlays */

    registerOverlay(name, handlers) {
        overlays.set(name, handlers);
    },

    openOverlay(name) {
        if (state.locked || !state.awake || !overlays.has(name)) return;
        if (state.overlay === name) return;
        Menu.close();
        if (state.overlay) overlays.get(state.overlay)?.onClose?.();
        overlays.get(name).onOpen?.();
        setState({ overlay: name });
    },

    toggleOverlay(name) {
        if (state.overlay === name) Shell.closeOverlays();
        else Shell.openOverlay(name);
    },

    closeOverlays() {
        Menu.close();
        if (!state.overlay) return;
        overlays.get(state.overlay)?.onClose?.();
        setState({ overlay: null });
    },

    /* device */

    setOsName(name) {
        setState({ osName: String(name).slice(0, 24) });
    },

    setStatus(status) {
        const s = state.status;
        if ('battery' in status) s.battery = status.battery == null ? null : clamp(Number(status.battery) || 0, 0, 100);
        if ('charging' in status) s.charging = !!status.charging;
        if ('signal' in status) s.signal = status.signal == null ? null : Number(status.signal);
        if ('network' in status) s.network = status.network ? String(status.network).slice(0, 24) : null;
        renderTray();
        document.dispatchEvent(new CustomEvent('pdr:status'));
    },

    /** Tablet taken out. The first wake of a session boots. */
    async wake() {
        if (state.awake) return;
        setState({ awake: true });
        tickClock(true);
        log.info('power', 'Screen on');

        if (!state.booted) {
            setState({ booted: true, booting: true, locked: settings.lockEnabled });
            await Boot.run(settings.bootStyle);
            setState({ booting: false });
            // put away again while the boot screen was up
            if (!state.awake) return;
        }
        if (!settings.lockEnabled) Shell.unlock();
        Bridge.emit('os:awake');
    },

    /** Tablet put away. */
    sleep() {
        if (!state.awake) return;
        cancelGestures();
        Shell.closeOverlays();
        Dialog.dismiss();
        Apps.suspend();
        Boot.cancel();
        setState({ awake: false, booting: false, locked: settings.lockEnabled || state.locked });
        log.info('power', 'Screen off');
        Bridge.emit('os:asleep');
    },

    lock() {
        cancelGestures();
        Shell.closeOverlays();
        Dialog.dismiss();
        Apps.suspend();
        setState({ locked: true });
        log.info('session', 'Locked');
    },

    unlock() {
        if (!state.awake || state.booting) return;
        if (!state.locked) {
            Apps.resume();
            return;
        }
        lockEl.classList.add('is-unlocking');
        setState({ locked: false });
        setTimeout(() => lockEl.classList.remove('is-unlocking'), 400);
        Apps.resume();
        log.info('session', 'Unlocked');
        Bridge.emit('os:unlocked');
    },

    /** Ask the integration to put the tablet away. */
    requestClose() {
        Shell.closeOverlays();
        log.info('power', 'Power off requested (put away)');
        Bridge.emit('os:requestClose');
    },
};
