// "Try to murder PDR OS." Adversarial end-to-end suite: hostile apps, a broken integration,
// races, floods, corruption, character switches, garbage input. Every section must leave the
// OS usable, and nothing may throw inside the OS page.

const { start } = require('./lib');

const SDK_DEMO = 'http://localhost:8765/apps/sdk-demo/index.html';

(async () => {
    const t = await start();
    const { page, os, wait, send, has, cls, emits, clearLog, received, frameOf, fromApp, launch, check, section, journal } = t;
    const reg = (app) => send({ action: 'apps:register', app });
    const registered = () => os().$$eval('.app-grid .app-icon', (els) => els.map((e) => e.dataset.app));
    const warned = async (re) => (await journal()).some((e) => (e.level === 'warn' || e.level === 'error') && re.test(e.message));
    const osAlive = async () => {
        // the OS must still do basic work after every attack
        await send({ action: 'apps:home' });
        await wait(150);
        return (await os().$$eval('.app-grid .app-icon', (els) => els.length)) > 0 && !(await cls('#device', 'in-app'));
    };

    // fast timings so the suite doesn't take minutes
    await send({ action: 'os:init', requestTimeout: 1500, heartbeat: { interval: 300, timeout: 1500 } });
    await wait(200);

    /* ================================================================== */
    section('Registration abuse');
    /* ================================================================== */
    await reg({ id: 'evil.js', label: 'JS', url: 'javascript:alert(document.cookie)' });
    await reg({ id: 'evil.data', label: 'Data', url: 'data:text/html,<script>parent.alert(1)</script>' });
    await reg({ id: 'evil.blob', label: 'Blob', url: 'blob:http://x/1' });
    await reg({ id: 'evil.about', label: 'About', url: 'about:blank' });
    await wait(200);
    let ids = await registered();
    check('javascript:/data:/blob:/about: app URLs rejected', !ids.some((i) => i.startsWith('evil.')), ids);
    await reg({ id: 'a"b', label: 'Quote', url: SDK_DEMO });
    await reg({ id: 'x'.repeat(80), label: 'Long', url: SDK_DEMO });
    await reg({ id: '<img>', url: SDK_DEMO });
    await reg({ id: 42, url: SDK_DEMO });
    await reg(['not', 'an', 'object']);
    await reg(null);
    await wait(200);
    check('invalid ids / non-object descriptors rejected', (await registered()).length === ids.length);
    await reg({ id: 'xss.label', label: '<img src=x onerror="parent.__pwned=1">', url: SDK_DEMO, icon: 'javascript:parent.__pwned=2', color: 'red;background-image:url(//evil)' });
    await wait(200);
    const label = await os().$eval('.app-icon[data-app="xss.label"] .app-label', (e) => ({ text: e.textContent, imgs: e.querySelectorAll('img').length }));
    check('HTML in labels is rendered as text', label.imgs === 0 && label.text.startsWith('<img'), label);
    const tile = await os().$eval('.app-icon[data-app="xss.label"] .tile', (e) => ({ img: !!e.querySelector('img'), bg: e.style.backgroundColor, cls: e.className }));
    check('javascript: icon ignored, CSS-injection colour ignored', !tile.img && !tile.bg && tile.cls.includes('tile-default'), tile);
    check('nothing executed', !(await os().evaluate(() => window.__pwned)));
    // flood the registry
    for (let i = 0; i < 230; i++) await reg({ id: `flood.${i}`, label: `Flood ${i}`, url: SDK_DEMO });
    await wait(600);
    const count = (await registered()).length;
    check(`registry capped at 200 apps (have ${count})`, count <= 200 && count >= 190);
    const t0 = Date.now();
    await send({ action: 'apps:set', apps: [] });
    await wait(300);
    check(`apps:set [] clears 200 apps quickly (${Date.now() - t0 - 300} ms)`, (await registered()).filter((i) => i.startsWith('flood.')).length === 0);
    // register → launch → unregister before the app can say hello
    await reg({ id: 'race.1', label: 'Race', url: SDK_DEMO });
    await send({ action: 'apps:launch', id: 'race.1' });
    await send({ action: 'apps:unregister', id: 'race.1' });
    await wait(900);
    check('register → launch → unregister race leaves nothing behind', !(await has('.app-frame[data-app="race.1"]')) && !(await cls('#device', 'in-app')));
    // re-register with a new URL while running → restart
    await reg({ id: 'swap.1', label: 'Swap', url: SDK_DEMO });
    await launch('swap.1');
    await reg({ id: 'swap.1', label: 'Swap', url: SDK_DEMO + '?v=2' });
    await wait(500);
    check('re-registering with a new URL restarts the app', !(await has('.app-frame[data-app="swap.1"]')));
    await reg({ id: 'system.settings', label: 'Fake settings', url: SDK_DEMO });
    await send({ action: 'apps:unregister', id: 'system.settings' });
    await wait(200);
    check('system app cannot be replaced or removed', (await os().$eval('.app-icon[data-app="system.settings"] .app-label', (e) => e.textContent)) === 'Settings');
    check('OS alive after registration abuse', await osAlive());

    /* ================================================================== */
    section('Request floods');
    /* ================================================================== */
    await reg({ id: 'ext.a', label: 'Ext A', url: SDK_DEMO });
    await reg({ id: 'ext.b', label: 'Ext B', url: SDK_DEMO });
    await launch('ext.a'); await launch('ext.b');
    const fa = await frameOf('ext.a'), fb = await frameOf('ext.b');
    await page.evaluate(() => {
        window.harnessRequestHandlers = { echo: (r) => ({ ok: true, data: { app: r.id, n: r.data && r.data.n } }) };
    });
    const hammer = (frame, n) => frame.evaluate((n) => {
        const jobs = [];
        for (let i = 0; i < n; i++) jobs.push(PDRTablet.request('echo', { n: i }, { timeout: 20000 }).then((r) => r, (e) => ({ error: e.message })));
        return Promise.all(jobs);
    }, n);
    // 75 each: just under the per-app limit (16 in flight + 64 queued); overflow is tested below
    const [ra, rb] = await Promise.all([hammer(fa, 75), hammer(fb, 75)]);
    const crossed = (res, id) => res.filter((r, i) => r.app !== id || r.n !== i);
    check('2 apps × 75 concurrent requests: nothing crossed or lost', crossed(ra, 'ext.a').length === 0 && crossed(rb, 'ext.b').length === 0,
        { a: crossed(ra, 'ext.a').slice(0, 3), b: crossed(rb, 'ext.b').slice(0, 3) });
    // an integration that never answers
    await clearLog();
    await page.evaluate(() => { window.harnessRequestHandlers = { hang: () => '__NO_REPLY__' }; });
    const hung = fa.evaluate(() => {
        const jobs = [];
        for (let i = 0; i < 100; i++) jobs.push(PDRTablet.request('hang', { i }, { timeout: 30000 }).then(() => 'ok', (e) => e.message));
        return Promise.all(jobs);
    });
    await wait(400);
    const reached = await received('request:hang');
    check(`at most 16 in flight reach the integration (got ${reached})`, reached === 16);
    const results = await hung;
    const tooMany = results.filter((r) => r === 'Too many pending requests').length;
    const timedOut = results.filter((r) => r === 'Request timed out').length;
    check(`queue overflow fails fast (${tooMany}) and the rest time out OS-side (${timedOut})`, tooMany === 100 - 16 - 64 && timedOut === 80);
    check('timeouts are logged', await warned(/never answered/));
    // payload bomb
    const bomb = await fa.evaluate(() => PDRTablet.request('echo', { blob: 'x'.repeat(300 * 1024) }).then(() => 'ok', (e) => e.message));
    check('oversized request payload rejected before reaching the host', bomb.startsWith('Request too large'));
    const clone = await fa.evaluate(() => PDRTablet.request('echo', { fn: () => 1 }).then(() => 'ok', (e) => e.message));
    check('non-serialisable request data rejects cleanly', clone.includes('JSON'), clone);
    // close the app mid-request, then let the late answer arrive
    await page.evaluate(() => {
        window.harnessRequestHandlers = { slow: () => '__NO_REPLY__' };
    });
    await fb.evaluate(() => { window.__late = PDRTablet.request('slow', null, { timeout: 30000 }).catch(() => {}); });
    await wait(100);
    await send({ action: 'apps:close', id: 'ext.b' });
    await wait(2000);   // OS timeout fires for a closed app: must be dropped silently
    check('closing an app mid-request is clean', !(await has('.app-frame[data-app="ext.b"]')));
    // sleep mid-request: the answer still reaches the (hidden) app
    await page.evaluate(() => { window.harnessRequestHandlers = { echo: (r) => ({ ok: true, data: { n: r.data.n } }) }; });
    const sleepy = fa.evaluate(() => new Promise((res) => setTimeout(() => PDRTablet.request('echo', { n: 7 }).then((r) => res(r.n), (e) => res(e.message)), 50)));
    await send({ action: 'os:sleep' });
    check('request made while the tablet goes to sleep still resolves', (await sleepy) === 7);
    await send({ action: 'os:wake' }); await wait(300); await send({ action: 'os:unlock' }); await wait(300);
    await page.evaluate(() => { window.harnessRequestHandlers = {}; });
    check('OS alive after request floods', await osAlive());

    /* ================================================================== */
    section('Notification → deep link → exactly once');
    /* ================================================================== */
    const launches = async (id) => { const f = await frameOf(id); return f ? f.evaluate(() => window.__launches.slice()) : null; };
    const tapNotification = async (title) => {
        await os().click('#tb-calendar'); await wait(250);
        await os().click(`#calendar .notif:has-text("${title}")`); await wait(1100);
    };
    const notifyFrom = (id, title, data) => send({ action: 'notify', appId: id, title, body: 'x', data });
    await send({ action: 'apps:close', id: 'ext.a' }); await wait(300);
    await notifyFrom('ext.a', 'Cold start', { n: 1 });
    await tapNotification('Cold start');
    let L = await launches('ext.a');
    check('not running → launched with data once (init)', L && L.length === 1 && L[0].via === 'init' && L[0].data.n === 1, L);
    await send({ action: 'apps:home' }); await wait(300);
    await notifyFrom('ext.a', 'From background', { n: 2 });
    await tapNotification('From background');
    L = await launches('ext.a');
    check('background → one launch event', L.length === 2 && L[1].via === 'launch' && L[1].data.n === 2, L);
    await notifyFrom('ext.a', 'While open', { n: 3 });
    await tapNotification('While open');
    L = await launches('ext.a');
    check('foreground → one launch event', L.length === 3 && L[2].data.n === 3, L);
    await send({ action: 'os:lock' }); await wait(200);
    await send({ action: 'apps:launch', id: 'ext.a', data: { n: 4 } }); await wait(200);
    check('launch while locked is deferred', (await launches('ext.a')).length === 3);
    await send({ action: 'os:unlock' }); await wait(500);
    L = await launches('ext.a');
    check('…and delivered once after unlock', L.length === 4 && L[3].data.n === 4, L);
    await send({ action: 'os:sleep' }); await wait(150);
    await send({ action: 'apps:launch', id: 'ext.a', data: { n: 5 } });
    await send({ action: 'apps:launch', id: 'ext.a', data: { n: 6 } });
    await send({ action: 'os:wake' }); await wait(300); await send({ action: 'os:unlock' }); await wait(500);
    L = await launches('ext.a');
    check('launches while asleep: only the latest is delivered, once', L.length === 5 && L[4].data.n === 6, L);
    await send({ action: 'apps:close', id: 'ext.a' }); await wait(300);
    await send({ action: 'apps:launch', id: 'ext.a', data: { n: 7 } });
    await send({ action: 'apps:launch', id: 'ext.a', data: { n: 8 } });   // before the SDK said hello
    await wait(1100);
    L = await launches('ext.a');
    check('two launches before the handshake: latest data exactly once, no duplicate', L.length === 1 && L[0].via === 'init' && L[0].data.n === 8, L);
    await notifyFrom('ext.a', 'Huge data', { blob: 'x'.repeat(5000) });
    await wait(200);
    check('oversized notification data dropped with a warning, notification kept', await warned(/over 4 KB/) && (await os().evaluate(() => window.__pdr.Notifications.all().some((n) => n.title === 'Huge data' && n.data === undefined))));
    check('OS alive after deep links', await osAlive());

    /* ================================================================== */
    section('Hostile / crashing apps');
    /* ================================================================== */
    await launch('ext.a');
    let fe = await frameOf('ext.a');
    // notification spam
    await fe.evaluate(() => { for (let i = 0; i < 200; i++) PDRTablet.notify({ title: 'spam ' + i, body: 'x' }); });
    await wait(400);
    const spam = await os().evaluate(() => window.__pdr.Notifications.all().filter((n) => n.title.startsWith('spam ')).length);
    check(`notification spam rate-limited (${spam} of 200 got through)`, spam <= 11 && spam >= 9);
    check('banners never pile up', (await os().$$eval('.banner', (els) => els.length)) <= 3);
    // focus stealing
    await send({ action: 'apps:home' }); await wait(300);
    await fromApp(fe, { type: 'launch', id: 'ext.a' });
    await fromApp(fe, { type: 'launch', id: 'pdr.calculator' });
    await wait(300);
    check('background app cannot launch itself or others (focus stealing)', !(await cls('#device', 'in-app')) && await warned(/from the background \(blocked\)/));
    // app errors → journal
    await launch('ext.a');
    fe = await frameOf('ext.a');
    await fe.evaluate(() => { for (let i = 0; i < 30; i++) setTimeout(() => { throw new Error('boom ' + i); }); });
    await wait(400);
    const boom = (await journal()).filter((e) => e.unit === 'ext.a' && /boom/.test(e.message)).length;
    check(`app errors reach the System Log, rate-limited (${boom})`, boom >= 1 && boom <= 10);
    // garbage protocol messages from an app
    for (const m of [{ type: 'request' }, { type: 'request', action: 5 }, { type: 'storage', op: 'drop' }, { type: 'storage', op: 'set', key: {} },
        { type: 'badge', count: 'lots' }, { type: 'badge', count: 1e99 }, { type: 'launch', id: {} }, { type: 'notify', title: { a: 1 } },
        { type: 'focus', editable: 'yes' }, { type: '__proto__' }, { type: 'hello' }, { type: 'hello', sdk: 'x' }, { type: 12 }]) await fromApp(fe, m);
    await wait(300);
    check('garbage protocol messages do not break the OS', await osAlive());
    // hang: stop answering the heartbeat (fresh instance: the garbage above included a fake hello)
    await send({ action: 'apps:close', id: 'ext.a' }); await wait(300);
    await launch('ext.a');
    fe = await frameOf('ext.a');
    await fe.evaluate(() => { PDRTablet.__debug.noPong = true; });
    await wait(2600);
    const dialog = await os().$eval('#dialog', (d) => d.classList.contains('is-open') && d.textContent);
    check('hung app → "not responding" dialog', !!dialog && dialog.includes('Not Responding'), dialog);
    await os().click('.dialog-btn:has-text("Wait")'); await wait(300);
    check('Wait keeps it open', await has('.app-frame[data-app="ext.a"]'));
    await fe.evaluate(() => { PDRTablet.__debug.noPong = false; });
    await wait(1000);
    check('it recovers: no dialog while it answers', !(await os().$eval('#dialog', (d) => d.classList.contains('is-open'))));
    await fe.evaluate(() => { PDRTablet.__debug.noPong = true; });
    await wait(2600);
    await os().click('.dialog-btn:has-text("Force Quit")'); await wait(400);
    check('Force Quit kills the hung app', !(await has('.app-frame[data-app="ext.a"]')) && !(await cls('#device', 'in-app')));
    // recovery dismisses the dialog on its own
    await launch('ext.a');
    fe = await frameOf('ext.a');
    await fe.evaluate(() => { PDRTablet.__debug.noPong = true; });
    await wait(2600);
    await fe.evaluate(() => { PDRTablet.__debug.noPong = false; });
    await wait(900);
    check('dialog closes by itself when the app starts answering again', !(await os().$eval('#dialog', (d) => d.classList.contains('is-open'))));
    // the app page navigates away / dies
    await fe.evaluate(() => { location.href = 'about:blank'; });
    await wait(2600);
    check('a dead app page is detected as not responding', await os().$eval('#dialog', (d) => d.classList.contains('is-open')));
    await os().click('.dialog-btn:has-text("Force Quit")'); await wait(400);
    // the OS chrome always works regardless of the app
    await launch('ext.a');
    await os().click('.app-frame[data-app="ext.a"] .hb-close'); await wait(400);
    check('window close button always works', !(await has('.app-frame[data-app="ext.a"]')));
    // app reloads itself → re-handshake, still works
    await launch('ext.a');
    fe = await frameOf('ext.a');
    await fe.evaluate(() => location.reload());
    await wait(1200);
    fe = await frameOf('ext.a');
    const afterReload = await fe.evaluate(() => PDRTablet.storage.set('k', 1).then(() => 'ok', (e) => e.message));
    check('app that reloads itself re-handshakes and keeps working', afterReload === 'ok');
    check('OS alive after hostile apps', await osAlive());

    /* ================================================================== */
    section('Storage limits & corruption');
    /* ================================================================== */
    await launch('ext.a');
    fe = await frameOf('ext.a');
    const st = (fn) => fe.evaluate(fn);
    check('__proto__ key rejected', (await st(() => PDRTablet.storage.set('__proto__', { polluted: true }).then(() => 'ok', (e) => e.message))).includes('reserved'));
    check('prototype not polluted', !(await os().evaluate(() => ({}).polluted)));
    const quota = await st(async () => {
        await PDRTablet.storage.clear();
        await PDRTablet.storage.set('keep', 'me');
        const big = 'x'.repeat(500 * 1024);
        const first = await PDRTablet.storage.set('big', big).then(() => 'ok', (e) => e.message);
        const second = await PDRTablet.storage.set('big2', 'y'.repeat(20 * 1024)).then(() => 'ok', (e) => e.message);
        const keep = await PDRTablet.storage.get('keep');
        await PDRTablet.storage.remove('big');
        const third = await PDRTablet.storage.set('big2', 'y'.repeat(20 * 1024)).then(() => 'ok', (e) => e.message);
        return { first, second, keep, third };
    });
    check('500 KB fits, the write that crosses 512 KB fails, earlier data intact, space is reclaimable',
        quota.first === 'ok' && quota.second.includes('quota') && quota.keep === 'me' && quota.third === 'ok', quota);
    // corrupt the local cache behind the OS's back
    await send({ action: 'apps:close', id: 'ext.a' }); await wait(300);
    await os().evaluate(() => {
        localStorage.setItem('pdr_tablet:app:ext.corrupt', '{not json');
        localStorage.setItem('pdr_tablet:app:ext.array', '[1,2,3]');
        localStorage.setItem('pdr_tablet:settings', '{"theme":5,"accent":"javascript:x","dock":"lol","brightness":"9999","bogus":{"x":1}}');
    });
    await reg({ id: 'ext.corrupt', label: 'Corrupt', url: SDK_DEMO });
    await reg({ id: 'ext.array', label: 'Array', url: SDK_DEMO });
    await launch('ext.corrupt');
    const cg = await (await frameOf('ext.corrupt')).evaluate(() => PDRTablet.storage.keys());
    check('corrupt app data → empty store + warning', Array.isArray(cg) && cg.length === 0 && await warned(/was corrupt/));
    await launch('ext.array');
    check('non-object app data → empty store', (await (await frameOf('ext.array')).evaluate(() => PDRTablet.storage.keys())).length === 0);
    await send({ action: 'apps:storage', id: 'ext.array', data: [1, 2] });
    await send({ action: 'apps:storage', id: 'ext.array', data: 'string' });
    await wait(150);
    check('invalid seeds ignored', await warned(/apps:storage ignored/));
    check('OS alive after storage abuse', await osAlive());

    /* ================================================================== */
    section('Character switch');
    /* ================================================================== */
    await launch('pdr.notes', { create: true, title: 'Char A secret', body: 'only A may see this' }, 1300);
    await send({ action: 'notify', appId: 'pdr.notes', title: 'A notification' });
    await send({ action: 'apps:badge', id: 'pdr.notes', count: 5 });
    await send({ action: 'os:settings', settings: { theme: 'light', wallpaper: 'mint' } });
    await launch('pdr.calculator', undefined, 500);
    await wait(700);   // Notes' debounced save
    await clearLog();
    await send({ action: 'os:session', deviceName: 'Char B', settings: { accent: '#e62d42' }, appStorage: { 'pdr.notes': { notes: [{ id: 'b1', title: 'Char B note', body: 'hi', pinned: false, created: 1, updated: 1 }] } } });
    await wait(500);
    check('session switch closes every running app', (await os().$$eval('.app-frame', (els) => els.length)) === 0);
    check('…clears notifications and badges', (await os().evaluate(() => window.__pdr.Notifications.all().length)) === 0 && !(await has('.app-icon[data-app="pdr.notes"] .badge')));
    check('…replaces settings (not merge)', (await os().evaluate(() => [window.__pdr.settings.theme, window.__pdr.settings.wallpaper, window.__pdr.settings.accent].join())) === 'dark,adwaita,#e62d42');
    check('…locks the tablet', await cls('#device', 'is-locked'));
    check('…drops the previous character from the local cache', !(await os().evaluate(() => Object.keys(localStorage).some((k) => (localStorage.getItem(k) || '').includes('Char A secret')))));
    check('…and tells the integration', (await emits()).some((e) => e.includes('os:sessionReady')));
    await send({ action: 'os:unlock' }); await wait(300);
    await launch('pdr.notes', undefined, 1300);
    const titles = await (await frameOf('pdr.notes')).$$eval('.notes-item-title', (els) => els.map((e) => e.textContent));
    check('new character sees only their own notes', titles.length === 1 && titles[0] === 'Char B note', titles);
    await send({ action: 'os:init', storageMode: 'host' }); await wait(200);
    await (await frameOf('pdr.notes')).evaluate(() => PDRTablet.storage.set('probe', 'host-mode'));
    await send({ action: 'os:settings', settings: { theme: 'light' } }); await wait(200);
    const localKeys = await os().evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('pdr_tablet:')));
    check('storageMode "host": nothing is cached in localStorage', localKeys.length === 0, localKeys);
    await send({ action: 'os:settings', settings: { theme: 'dark' } });
    check('OS alive after session switch', await osAlive());

    /* ================================================================== */
    section('Focus & stuck input');
    /* ================================================================== */
    const lastFocus = async () => {
        const all = (await emits()).filter((e) => e.includes('input:focus'));
        return all.length ? JSON.parse(all[all.length - 1].split('input:focus ')[1]).editable : null;
    };
    await clearLog();
    await os().click('.search-entry'); await wait(150);
    check('focusing an OS text field → input:focus { editable: true }', (await lastFocus()) === true);
    await os().click('#tb-calendar'); await os().click('#tb-calendar'); await wait(150);
    await os().evaluate(() => document.activeElement.blur()); await wait(150);
    check('blurring it → editable: false', (await lastFocus()) === false);
    await launch('ext.a');
    fe = await frameOf('ext.a');
    await fe.focus('#k-input'); await wait(200);
    check('focusing a field inside an app → editable: true', (await lastFocus()) === true);
    await send({ action: 'os:sleep' }); await wait(200);
    check('putting the tablet away releases keyboard capture', (await lastFocus()) === false);
    await send({ action: 'os:wake' }); await wait(300); await send({ action: 'os:unlock' }); await wait(300);
    await fe.focus('#k-input'); await wait(200);
    await send({ action: 'apps:home' }); await wait(300);
    check('leaving the app releases keyboard capture', (await lastFocus()) === false);
    // drag held while the tablet is put away
    await send({ action: 'os:lock' }); await wait(200);
    const box = await page.$eval('#os', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height * 0.6 }; });
    await page.mouse.move(box.x, box.y); await page.mouse.down(); await page.mouse.move(box.x, box.y - 40, { steps: 4 });
    await send({ action: 'os:sleep' }); await wait(200);
    await send({ action: 'os:wake' }); await wait(300);
    await page.mouse.move(box.x, box.y - 400, { steps: 6 });
    const tr = await os().$eval('.lock-inner', (e) => e.style.transform);
    check('a drag in progress when the tablet sleeps is cancelled (no ghost drag after wake)', !tr && await cls('#device', 'is-locked'), tr);
    await page.mouse.up(); await wait(200);
    check('…and the stray pointerup does not unlock', await cls('#device', 'is-locked'));
    await send({ action: 'os:unlock' }); await wait(300);
    // long-press interrupted by sleep
    const icon = await os().$eval('.app-grid .app-icon[data-app="pdr.notes"]', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    const off = await page.$eval('#os', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y }; });
    await page.mouse.move(off.x + icon.x, off.y + icon.y); await page.mouse.down();
    await wait(200); await send({ action: 'os:sleep' }); await wait(600);
    await send({ action: 'os:wake' }); await wait(300); await send({ action: 'os:unlock' }); await wait(300);
    await page.mouse.up();
    check('a long-press interrupted by sleep never opens the menu', !(await os().$eval('#menu', (m) => m.classList.contains('is-open'))));
    // overlays + dialogs never survive sleep
    await os().click('#tb-control'); await wait(200);
    await send({ action: 'os:sleep' }); await wait(200); await send({ action: 'os:wake' }); await wait(300); await send({ action: 'os:unlock' }); await wait(300);
    check('open menus are closed after sleep', (await os().$eval('#device', (d) => d.dataset.overlay)) === undefined);
    check('lock screen hides app content (privacy)', await (async () => {
        await launch('pdr.calculator', undefined, 500);
        await send({ action: 'os:lock' }); await wait(200);
        const v = await os().$eval('#apps', (e) => getComputedStyle(e).visibility);
        await send({ action: 'os:unlock' }); await wait(300);
        return v === 'hidden';
    })());

    /* ================================================================== */
    section('Theme storm');
    /* ================================================================== */
    await launch('pdr.notes', undefined, 800); await launch('pdr.messages', undefined, 800); await launch('ext.a', undefined, 800);
    const accents = ['#3584e4', '#2190a4', '#3a944a', '#c88800', '#ed5b00', '#e62d42'];
    const s0 = Date.now();
    for (let i = 0; i < 80; i++) await send({ action: 'os:settings', settings: { theme: i % 2 ? 'light' : 'dark', accent: accents[i % accents.length], clock24h: !!(i % 3) } });
    await send({ action: 'os:settings', settings: { theme: 'light', accent: '#9141ac' } });
    await wait(600);
    const themes = [];
    for (const id of ['pdr.notes', 'pdr.messages', 'ext.a']) {
        const f = await frameOf(id);
        themes.push(await f.evaluate(() => document.documentElement.getAttribute('data-tablet-theme') + ' ' + getComputedStyle(document.documentElement).getPropertyValue('--tablet-accent').trim()));
    }
    check(`81 theme changes in ${Date.now() - s0} ms: every open app ends on the final theme`, themes.every((x) => x === 'light #9141ac'), themes);
    await send({ action: 'os:settings', settings: { theme: 'dark', accent: '#3584e4' } });

    /* ================================================================== */
    section('Cleanup & leaks');
    /* ================================================================== */
    await send({ action: 'apps:home' }); await wait(300);
    const nodes0 = await os().evaluate(() => document.getElementsByTagName('*').length);
    for (let i = 0; i < 25; i++) {
        await send({ action: 'apps:launch', id: 'pdr.calculator' });
        await send({ action: 'apps:launch', id: 'ext.a' });
        await send({ action: 'apps:launch', id: 'system.settings' });
        await wait(60);
        await send({ action: 'apps:close', id: 'pdr.calculator' });
        await send({ action: 'apps:close', id: 'ext.a' });
        await send({ action: 'apps:close', id: 'system.settings' });
    }
    await send({ action: 'apps:home' }); await wait(1200);
    const nodes1 = await os().evaluate(() => document.getElementsByTagName('*').length);
    check(`75 launch/close cycles leave no frames behind`, (await os().$$eval('.app-frame', (els) => els.length)) === (await os().evaluate(() => window.__pdr.Apps.running().length)));
    check(`DOM does not grow (${nodes0} → ${nodes1} nodes)`, nodes1 <= nodes0 + 60);
    for (let i = 0; i < 120; i++) await send({ action: 'notify', title: 'bulk ' + i });
    await wait(300);
    check('notification store is capped (50)', (await os().evaluate(() => window.__pdr.Notifications.all().length)) === 50);
    check('journal is capped (500)', (await journal()).length <= 500);

    /* ================================================================== */
    section('Fuzz');
    /* ================================================================== */
    const fuzzed = await page.evaluate(() => {
        const actions = ['os:init', 'os:session', 'os:wake', 'os:sleep', 'os:lock', 'os:unlock', 'os:settings', 'os:status', 'apps:set', 'apps:register', 'apps:update',
            'apps:unregister', 'apps:launch', 'apps:close', 'apps:home', 'apps:message', 'apps:badge', 'apps:storage', 'notify', 'input:key', 'input:text', 'nope', '', null];
        const vals = [null, undefined, 0, -1, 1e308, NaN, '', 'x', 'x'.repeat(5000), true, [], [1, 'a'], {}, { id: 'pdr.notes' }, { a: { b: { c: [] } } }, 'pdr.notes', 'system.settings'];
        const pick = (a) => a[Math.floor(Math.random() * a.length)];
        const os = document.getElementById('os').contentWindow;
        let n = 0;
        for (let i = 0; i < 3000; i++) {
            const msg = { action: pick(actions) };
            for (const k of ['id', 'app', 'apps', 'data', 'settings', 'patch', 'event', 'count', 'key', 'text', 'title', 'appId', 'status', 'appStorage', 'battery', 'storageMode', 'heartbeat']) {
                if (Math.random() < 0.3) msg[k] = pick(vals);
            }
            if (msg.action === 'os:session' && Math.random() < 0.9) continue;   // keep the run meaningful
            if (msg.action === 'os:init' && msg.heartbeat) delete msg.heartbeat;
            try { os.postMessage(msg, '*'); n++; } catch { /* uncloneable combos are the caller's problem */ }
            if (Math.random() < 0.02) os.postMessage('{"action":"notify", broken json', '*');
        }
        return n;
    });
    await wait(1500);
    const f2 = await frameOf('pdr.messages') || await (async () => { await launch('ext.a'); return frameOf('ext.a'); })();
    if (f2) {
        await f2.evaluate(() => {
            const types = ['hello', 'request', 'storage', 'notify', 'badge', 'launch', 'home', 'close', 'error', 'pong', 'focus', 'x', null, 1];
            const vals = [null, 0, -1, 'x', 'x'.repeat(3000), [], {}, { a: 1 }, true, 1e308];
            const pick = (a) => a[Math.floor(Math.random() * a.length)];
            for (let i = 0; i < 3000; i++) {
                const m = { __pdrTablet: Math.random() < 0.95 ? 1 : pick(vals), type: pick(types) };
                for (const k of ['rid', 'action', 'data', 'op', 'key', 'value', 'title', 'body', 'count', 'id', 'message', 'editable', 'sdk']) if (Math.random() < 0.3) m[k] = pick(vals);
                if (m.type === 'close' || m.type === 'launch') continue;   // they'd just end the run
                window.parent.postMessage(m, '*');
            }
        });
        await wait(1500);
    }
    await send({ action: 'os:init', storageMode: 'local', requestTimeout: 30000 });
    await send({ action: 'os:wake' }); await wait(200); await send({ action: 'os:unlock' }); await wait(300);
    check(`${fuzzed} garbage host messages + 3000 garbage app messages: OS still works`, await osAlive());
    await launch('pdr.calculator', undefined, 700);
    check('…and can still launch apps', await cls('.app-frame[data-app="pdr.calculator"]', 'is-foreground'));

    /* ================================================================== */
    section('Restart recovery');
    /* ================================================================== */
    // the fuzzer may have unregistered bundled apps (allowed for the host); bring them back
    await send({ action: 'os:init', bundledApps: true });
    await wait(200);
    // the integration owns the data (host mode) and the tablet page is torn down mid-session
    await send({ action: 'os:init', storageMode: 'host' });
    await launch('pdr.notes', { create: true, title: 'Survives restart', body: 'kept by the host' }, 1300);
    await send({ action: 'apps:home' });   // flushes Notes' pending save
    await wait(400);
    const hostCopy = await page.evaluate(() => window.harnessStorage && window.harnessStorage['pdr.notes']);
    check('app data mirrored by the host before the restart', !!hostCopy && JSON.stringify(hostCopy).includes('Survives restart'));
    await clearLog();
    await page.evaluate(() => {
        const w = document.getElementById('os').contentWindow;
        w.__beforeRestart = true;          // marks the old document so we wait for the new one
        w.location.reload();
    });
    await page.waitForFunction(() => {
        const w = document.getElementById('os').contentWindow;
        return w && !w.__beforeRestart && w.__pdr && w.__pdr.state.booted && !w.__pdr.state.booting && w.document.querySelector('.app-grid .app-icon');
    }, null, { timeout: 15000 });
    await wait(300);
    check('restarted page announces itself again (os:ready)', (await emits()).some((e) => e.includes('os:ready')));
    await send({ action: 'os:init', storageMode: 'host', appStorage: { 'pdr.notes': hostCopy }, requestTimeout: 1500, heartbeat: { interval: 300, timeout: 1500 } });
    await send({ action: 'os:unlock' }); await wait(400);
    await launch('pdr.notes', undefined, 1300);
    const restored = await (await frameOf('pdr.notes')).$$eval('.notes-item-title', (els) => els.map((e) => e.textContent));
    check('after the restart, re-seeding from the host restores the app data', restored.includes('Survives restart'), restored);
    check('nothing was cached locally in host mode', (await os().evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('pdr_tablet:')).length)) === 0);
    // a consumer resource stops while its app is open with work in flight
    await reg({ id: 'ext.stop', label: 'Stopping', url: SDK_DEMO });
    await launch('ext.stop');
    await page.evaluate(() => { window.harnessRequestHandlers = { slow: () => '__NO_REPLY__' }; });
    const fs2 = await frameOf('ext.stop');
    await fs2.evaluate(() => { PDRTablet.request('slow').catch(() => {}); PDRTablet.notify({ title: 'Before stop', body: 'x' }); });
    await wait(200);
    await send({ action: 'apps:unregister', id: 'ext.stop' });   // what the integration does on onResourceStop
    await wait(2000);
    check('resource stop mid-request: app closed, its notifications removed, OS usable',
        !(await has('.app-frame[data-app="ext.stop"]')) && !(await os().evaluate(() => window.__pdr.Notifications.all().some((n) => n.title === 'Before stop'))) && await osAlive());
    await page.evaluate(() => { window.harnessRequestHandlers = {}; });
    await send({ action: 'os:init', storageMode: 'local' });

    /* ================================================================== */
    section('Performance');
    /* ================================================================== */
    await send({ action: 'apps:home' }); await wait(200);
    const perf = await os().evaluate(async () => {
        const long = [];
        const obs = new PerformanceObserver((l) => l.getEntries().forEach((e) => long.push(Math.round(e.duration))));
        try { obs.observe({ type: 'longtask', buffered: false }); } catch { /* not supported */ }
        const t0 = performance.now();
        for (let i = 0; i < 150; i++) window.__pdr.Apps.register({ id: 'perf.' + i, label: 'Perf ' + i, url: 'http://localhost:8765/apps/sdk-demo/index.html' });
        const reg = performance.now() - t0;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const paint = performance.now() - t0;
        const t1 = performance.now();
        for (let i = 0; i < 150; i++) window.__pdr.Apps.unregister('perf.' + i);
        const unreg = performance.now() - t1;
        await new Promise((r) => setTimeout(r, 300));
        obs.disconnect();
        return { reg: Math.round(reg), paint: Math.round(paint), unreg: Math.round(unreg), long };
    });
    console.log('      perf:', JSON.stringify(perf));
    check(`register 150 apps + render < 1500 ms (${perf.paint} ms)`, perf.paint < 1500);
    // what runs while the tablet is put away
    await launch('pdr.crypto', undefined, 3300);
    await send({ action: 'os:sleep' }); await wait(400);
    const asleep = await os().evaluate(() => ({
        apps: getComputedStyle(document.getElementById('apps')).visibility,
        home: getComputedStyle(document.getElementById('home')).visibility,
    }));
    const cryptoHidden = await (await frameOf('pdr.crypto')).evaluate(() => document.documentElement.getAttribute('data-tablet-visible'));
    check('asleep: OS layers are not painted', asleep.apps === 'hidden' && asleep.home === 'hidden', asleep);
    check('asleep: apps are told they are hidden (animations paused by the kit)', cryptoHidden === 'false');
    await send({ action: 'os:wake' }); await wait(300); await send({ action: 'os:unlock' }); await wait(400);
    const tick = await (await frameOf('pdr.crypto')).evaluate(async () => {
        window.__crypto.go('markets');
        await new Promise((r) => setTimeout(r, 600));
        const long = [];
        const obs = new PerformanceObserver((l) => l.getEntries().forEach((e) => long.push(Math.round(e.duration))));
        try { obs.observe({ type: 'longtask' }); } catch { /* ignore */ }
        await new Promise((r) => setTimeout(r, 6500));
        obs.disconnect();
        return long;
    });
    check(`LSX markets page live-updating for 6.5 s: no long tasks > 100 ms (${JSON.stringify(tick)})`, tick.every((d) => d <= 100));

    // handled errors the OS writes to its own journal are expected here; uncaught ones are not
    await t.done(/404|Failed to load resource|boom|deliberate|^\[pdr_tablet\]/);
})();
