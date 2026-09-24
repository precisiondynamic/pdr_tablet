// Shared helpers for the browser test suites. They drive web/dev (the harness) in Chromium.
//   PDR_URL     harness URL            (default http://localhost:8765/dev/)
//   PLAYWRIGHT  module path to require (default 'playwright')

const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');

async function start({ fresh = true, viewport = { width: 1600, height: 1000 } } = {}) {
    const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text() + ' @' + (m.location().url || '').split('/').slice(-2).join('/'));
    });
    await page.goto(process.env.PDR_URL || 'http://localhost:8765/dev/');

    const os = () => page.frames().find((f) => f.url().includes('/os/index.html'));
    const wait = (ms = 300) => page.waitForTimeout(ms);
    const send = (m) => page.evaluate((m) => document.getElementById('os').contentWindow.postMessage(m, '*'), m);
    const has = async (sel) => !!(await os().$(sel));
    const cls = (sel, c) => os().$eval(sel, (e, c) => e.classList.contains(c), c);
    const emits = async () => (await page.$$eval('#log .out', (els) => els.map((e) => e.textContent))).reverse();
    const clearLog = () => page.evaluate(() => { document.getElementById('log').innerHTML = ''; window.harnessReceived = {}; });
    const received = (key) => page.evaluate((k) => (window.harnessReceived || {})[k] || 0, key);
    /** System journal entries (dev builds expose window.__pdr; see web/os/js/main.js). */
    const journal = () => os().evaluate(() => window.__pdr.log.entries().map((e) => ({ level: e.level, unit: e.unit, message: e.message })));
    /** Frame of a running app by id (bundled or not). */
    const frameOf = async (id) => {
        const el = await os().$(`.app-frame[data-app="${id}"] iframe`);
        return el ? el.contentFrame() : null;
    };
    /** Post a raw SDK-protocol message *from* an app frame (simulates a buggy/hostile app). */
    const fromApp = (frame, msg) => frame.evaluate((m) => window.parent.postMessage(Object.assign({ __pdrTablet: 1 }, m), '*'), msg);
    const launch = async (id, data, ms = 900) => { await send({ action: 'apps:launch', id, data }); await wait(ms); };

    let failed = 0, passed = 0;
    const check = (name, ok, extra) => {
        if (ok) passed++; else failed++;
        console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  → ' + JSON.stringify(extra).slice(0, 300)));
    };
    const section = (s) => console.log('— ' + s);

    if (fresh) {
        await wait(300);
        await os().evaluate(() => localStorage.clear());
        await page.reload();
        await os().waitForSelector('#boot.is-hidden', { state: 'attached', timeout: 15000 }).catch(() => {});
        await page.waitForFunction(() => {
            const f = document.getElementById('os');
            return f && f.contentDocument && f.contentDocument.querySelector('#boot.is-hidden');
        }, null, { timeout: 15000 }).catch(() => {});
        await wait(700);
        await send({ action: 'os:unlock' });
        await wait(400);
    }

    const done = async (ignore = /404|Failed to load resource/) => {
        const unexpected = errors.filter((e) => !ignore.test(e));
        console.log(`\n${passed} passed, ${failed} failed`);
        console.log(unexpected.length ? 'UNEXPECTED ERRORS:\n' + unexpected.join('\n') : 'no unexpected console errors');
        await browser.close();
        process.exitCode = failed || unexpected.length ? 1 : 0;
    };

    return { browser, page, os, wait, send, has, cls, emits, clearLog, received, frameOf, fromApp, launch, check, section, done, errors, journal };
}

module.exports = { start };
