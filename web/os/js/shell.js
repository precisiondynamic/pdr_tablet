// System chrome: status bar, boot, lock screen, sleep, wallpaper/theme/brightness, home bar.

import { Apps } from './apps.js';
import { Bridge } from './bridge.js';
import { Notifications, notificationCard } from './notifications.js';
import { Panel } from './panel.js';
import { Switcher } from './switcher.js';
import { Menu } from './menu.js';
import { state, settings, on, setState } from './store.js';
import { icon, logoMark } from './icons.js';
import { wallpaperCss } from './wallpapers.js';
import { h, fill, drag, formatDate, formatTime, timeParts, hexToRgb, clamp } from './util.js';

const BOOT_MS = 1900;
const $ = (id) => document.getElementById(id);

let device, lockEl, bootEl;
let lastMinute = -1;

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
}

function applyState() {
    device.classList.toggle('is-asleep', !state.awake);
    device.classList.toggle('is-locked', state.locked);
    device.classList.toggle('in-app', state.view === 'app');
    device.classList.toggle('has-overlay', !!state.overlay);
    if (state.overlay) device.dataset.overlay = state.overlay;
    else delete device.dataset.overlay;
}

/* ---------- status bar ---------- */

function buildStatusBar() {
    const bar = $('statusbar');
    bar.append(
        h('div', { class: 'sb-left' },
            h('span', { class: 'sb-time', id: 'sb-time' }),
            h('span', { class: 'sb-date', id: 'sb-date' }),
        ),
        h('button', { class: 'sb-right', id: 'sb-right', title: 'Quick settings', onClick: () => Panel.toggle() }),
    );
    renderStatusRight();
}

function signalBars(level) {
    const bars = h('span', { class: 'sb-signal', title: `Signal ${level}/4` });
    for (let i = 1; i <= 4; i++) bars.append(h('i', { class: i <= level ? 'on' : '' }));
    return bars;
}

function renderStatusRight() {
    const { battery, charging, signal, network } = state.status;
    const items = [
        settings.dnd ? icon('moon', 'sb-icon') : null,
        network ? h('span', { class: 'sb-network' }, network) : null,
        Number.isFinite(signal) ? signalBars(clamp(Math.round(signal), 0, 4)) : null,
        Number.isFinite(battery)
            ? h('span', { class: 'sb-battery' },
                h('span', { class: 'sb-battery-pct' }, `${Math.round(battery)}%`),
                h('span', { class: `battery ${battery <= 20 && !charging ? 'is-low' : ''}` },
                    h('span', { class: 'battery-fill', style: { width: `${clamp(battery, 0, 100)}%` } })),
                charging ? icon('bolt', 'sb-icon sb-bolt') : null)
            : null,
    ].filter(Boolean);
    // the integration decides what status exists; keep a visible handle for the quick panel either way
    if (!items.length) items.push(icon('sunSmall', 'sb-icon'));
    fill($('sb-right'), ...items);
}

function tickClock(force) {
    const now = new Date();
    if (!force && now.getMinutes() === lastMinute) return;
    lastMinute = now.getMinutes();

    $('sb-time').textContent = formatTime(now, settings.clock24h);
    $('sb-date').textContent = settings.statusDate ? formatDate(now, 'short') : '';

    const { hm, suffix } = timeParts(now, settings.clock24h);
    fill(lockEl.querySelector('.lock-time'), hm, suffix ? h('small', null, suffix) : null);
    lockEl.querySelector('.lock-date').textContent = formatDate(now);
    document.dispatchEvent(new CustomEvent('pdr:minute', { detail: now }));
}

/* ---------- boot ---------- */

function buildBoot() {
    bootEl = $('boot');
    bootEl.append(
        h('div', { class: 'boot-inner' },
            logoMark('boot-logo'),
            h('div', { class: 'boot-name', id: 'boot-name' }, state.osName),
            h('div', { class: 'boot-progress' }, h('span')),
        ),
    );
}

function runBoot() {
    return new Promise((resolve) => {
        $('boot-name').textContent = state.osName;
        bootEl.classList.remove('is-hidden', 'is-done');
        bootEl.classList.add('is-running');
        setTimeout(() => {
            bootEl.classList.add('is-done');
            setTimeout(() => {
                bootEl.classList.add('is-hidden');
                bootEl.classList.remove('is-running', 'is-done');
            }, 450);
            resolve();
        }, BOOT_MS);
    });
}

/* ---------- lock screen ---------- */

function buildLock() {
    lockEl = $('lock');
    const panel = h('div', { class: 'lock-inner' },
        h('div', { class: 'lock-top' },
            icon('lock', 'lock-icon'),
            h('div', { class: 'lock-time' }),
            h('div', { class: 'lock-date' }),
        ),
        h('div', { class: 'lock-notifs', id: 'lock-notifs' }),
        h('div', { class: 'lock-hint' }, icon('chevronUp'), h('span', null, 'Swipe up or click to unlock')),
    );
    lockEl.append(panel);

    drag(lockEl, {
        onStart: () => lockEl.classList.add('is-dragging'),
        onMove: (dx, dy) => {
            panel.style.transform = `translateY(${Math.min(0, dy)}px)`;
            panel.style.opacity = String(1 + Math.min(0, dy) / (lockEl.clientHeight * 0.6));
        },
        onEnd: (dx, dy, e, ms, moved) => {
            lockEl.classList.remove('is-dragging');
            panel.style.transform = '';
            panel.style.opacity = '';
            const fling = dy < -40 && ms < 300;
            if (moved && (dy < -lockEl.clientHeight * 0.18 || fling)) Shell.unlock();
        },
    });
    // plain click anywhere that isn't a notification → unlock
    lockEl.addEventListener('click', (e) => {
        if (!e.target.closest('.notif')) Shell.unlock();
    });
}

function renderLockNotifications() {
    const box = $('lock-notifs');
    if (!settings.lockPreviews) {
        const count = Notifications.all().length;
        fill(box, count
            ? h('div', { class: 'lock-count' }, icon('bell'), `${count} notification${count === 1 ? '' : 's'}`)
            : '');
        return;
    }
    fill(box, ...Notifications.all().slice(0, 3).map((n) => notificationCard(n, { compact: true })));
}

/* ---------- home bar (click = home, drag up / double click = app switcher) ---------- */

function buildHomeBar() {
    const bar = $('homebar');
    bar.append(h('span', { class: 'homebar-pill' }));
    let lastClick = 0;

    drag(bar, {
        threshold: 6,
        onMove: (dx, dy) => {
            bar.style.setProperty('--pull', `${Math.min(0, dy)}px`);
        },
        onEnd: (dx, dy, e, ms, moved) => {
            bar.style.removeProperty('--pull');
            if (state.locked || !state.awake) return;
            if (moved) {
                if (dy < -40) Switcher.open();
                return;
            }
            const now = performance.now();
            if (now - lastClick < 320) {
                Switcher.open();
                lastClick = 0;
                return;
            }
            lastClick = now;
            Shell.closeOverlays();
            if (state.view === 'app') Apps.home();
        },
    });
}

/* ---------- public ---------- */

export const Shell = {
    init() {
        device = $('device');
        buildStatusBar();
        buildBoot();
        buildLock();
        buildHomeBar();

        applyAppearance();
        applyState();
        tickClock(true);
        renderLockNotifications();
        setInterval(() => tickClock(false), 1000);

        on('state', applyState);
        on('settings', (changed) => {
            applyAppearance(changed);
            if (changed.some((k) => ['clock24h', 'statusDate'].includes(k))) tickClock(true);
            if (changed.includes('dnd')) renderStatusRight();
            if (changed.includes('lockPreviews')) renderLockNotifications();
            if (changed.includes('lockEnabled') && !settings.lockEnabled && state.locked && state.awake) Shell.unlock();
        });
        on('notifications', renderLockNotifications);

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (Menu.isOpen()) Menu.close();
            else if (state.overlay) Shell.closeOverlays();
        });
    },

    setOsName(name) {
        setState({ osName: String(name).slice(0, 24) });
        $('boot-name').textContent = state.osName;
    },

    setStatus(status) {
        const s = state.status;
        if ('battery' in status) s.battery = status.battery == null ? null : clamp(Number(status.battery) || 0, 0, 100);
        if ('charging' in status) s.charging = !!status.charging;
        if ('signal' in status) s.signal = status.signal == null ? null : Number(status.signal);
        if ('network' in status) s.network = status.network ? String(status.network).slice(0, 24) : null;
        renderStatusRight();
    },

    /** Tablet taken out. First wake of the session boots. */
    async wake() {
        if (state.awake) return;
        setState({ awake: true });
        tickClock(true);

        if (!state.booted) {
            setState({ booted: true, locked: settings.lockEnabled });
            if (settings.bootAnimation) await runBoot();
        }
        if (!settings.lockEnabled) Shell.unlock();
        Bridge.emit('os:awake');
    },

    /** Tablet put away. */
    sleep() {
        if (!state.awake) return;
        Shell.closeOverlays();
        Apps.suspend();
        setState({ awake: false, locked: settings.lockEnabled || state.locked });
        Bridge.emit('os:asleep');
    },

    lock() {
        Shell.closeOverlays();
        Apps.suspend();
        setState({ locked: true });
    },

    unlock() {
        if (!state.locked) {
            Apps.resume();
            return;
        }
        lockEl.classList.add('is-unlocking');
        setState({ locked: false });
        setTimeout(() => lockEl.classList.remove('is-unlocking'), 400);
        Apps.resume();
        Bridge.emit('os:unlocked');
    },

    closeOverlays() {
        Menu.close();
        if (state.overlay === 'panel') Panel.close();
        if (state.overlay === 'switcher') Switcher.close();
    },

    /** Ask the integration to put the tablet away. */
    requestClose() {
        Shell.closeOverlays();
        Bridge.emit('os:requestClose');
    },
};
