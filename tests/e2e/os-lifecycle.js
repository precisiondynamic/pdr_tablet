// OS lifecycle, security and navigation regression suite.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto((process.env.PDR_URL || 'http://localhost:8765/dev/'));
  const osf = () => p.frames().find(f => f.url().includes('/os/index.html'));
  const events = async () => (await p.$$eval('#log .out', els => els.map(e => e.textContent))).reverse();
  const clearLog = () => p.evaluate(() => document.getElementById('log').innerHTML = '');
  const send = (m) => p.evaluate(m => { document.getElementById('os').contentWindow.postMessage(m, '*'); }, m);
  const has = (sel) => osf().$(sel).then(Boolean);
  const cls = (sel, c) => osf().$eval(sel, (e, c) => e.classList.contains(c), c);
  let failed = 0;
  const check = (name, ok) => { if (!ok) failed++; console.log((ok ? 'PASS ' : 'FAIL ') + name); };

  // --- sleep during boot must not leave the tablet unlocked/awake
  await p.waitForTimeout(150);
  await send({ action: 'os:settings', settings: { lockEnabled: false } });
  await send({ action: 'os:sleep' }); await p.waitForTimeout(600);
  check('sleep during boot: stays asleep', await cls('#device', 'is-asleep'));
  check('sleep during boot: boot screen hidden', await cls('#boot', 'is-hidden'));
  await send({ action: 'os:settings', settings: { lockEnabled: true } });
  await send({ action: 'os:wake' }); await p.waitForTimeout(300);
  check('wake after interrupted boot shows lock', await cls('#device', 'is-locked') && !(await cls('#device', 'is-asleep')));

  // --- drag on lock that doesn't reach threshold must not unlock via the trailing click
  const box = await osf().$eval('#lock', e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const off = await p.$eval('#os', e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y }; });
  const cx = off.x + box.w / 2, cy = off.y + box.h * 0.6;
  await p.mouse.move(cx, cy); await p.mouse.down(); await p.mouse.move(cx, cy - 30, { steps: 5 }); await p.mouse.up();
  await p.waitForTimeout(300);
  check('short lock drag does not unlock', await cls('#device', 'is-locked'));
  await p.mouse.move(cx, cy); await p.mouse.down(); await p.mouse.move(cx, cy - 300, { steps: 8 }); await p.mouse.up();
  await p.waitForTimeout(400);
  check('long lock drag unlocks', !(await cls('#device', 'is-locked')));

  // --- lifecycle
  await clearLog();
  await p.click('#reg'); await p.click('#launch'); await p.waitForTimeout(1200);
  let ev = await events();
  check('launched → ready → foreground', ['launched', 'ready', 'foreground'].every(s => ev.some(e => e.includes(`"state":"${s}"`))));

  const app = await (await osf().$('.app-frame[data-app="dev.test"] iframe')).contentFrame();
  await app.focus('#k-input');
  for (const k of 'Hi!') await send({ action: 'input:key', type: 'keydown', key: k });
  await send({ action: 'input:key', type: 'keydown', key: 'Backspace' });
  await send({ action: 'input:text', text: ' there' });
  await p.waitForTimeout(200);
  check('key relay into app input', (await app.$eval('#k-input', e => e.value)) === 'Hi there');

  await clearLog();
  await send({ action: 'os:sleep' }); await p.waitForTimeout(200);
  await send({ action: 'os:wake' }); await p.waitForTimeout(300);
  ev = await events();
  check('sleep → background', ev.some(e => e.includes('"state":"background"')));
  check('wake stays locked', !ev.some(e => e.includes('"state":"foreground"')));
  await send({ action: 'os:unlock' }); await p.waitForTimeout(400);
  ev = await events();
  check('unlock → foreground', ev.some(e => e.includes('"state":"foreground"')));

  // --- security
  await app.evaluate(() => window.parent.postMessage({ action: 'apps:unregister', id: 'dev.test' }, '*'));
  await app.evaluate(() => window.parent.postMessage({ action: 'os:sleep' }, '*'));
  await p.waitForTimeout(200);
  check('app cannot impersonate host', !(await cls('#device', 'is-asleep')) && await has('.app-frame[data-app="dev.test"]'));

  // --- headerbar
  await osf().click('.app-frame[data-app="dev.test"] .hb-btn[title="Home"]'); await p.waitForTimeout(400);
  check('headerbar home button → home', !(await cls('#device', 'in-app')) && await has('.app-frame[data-app="dev.test"]'));
  await send({ action: 'apps:launch', id: 'dev.test' }); await p.waitForTimeout(500);
  await osf().click('.app-frame[data-app="dev.test"] .hb-close'); await p.waitForTimeout(400);
  check('headerbar close button quits app', !(await has('.app-frame[data-app="dev.test"]')));

  // --- apps:set keeps listed running apps, removes others
  await send({ action: 'apps:register', app: { id: 'dev.a', label: 'A', url: 'http://localhost:8765/apps/sdk-demo/index.html' } });
  await send({ action: 'apps:register', app: { id: 'dev.b', label: 'B', url: 'http://localhost:8765/apps/sdk-demo/index.html' } });
  await send({ action: 'apps:launch', id: 'dev.a' }); await p.waitForTimeout(700);
  await send({ action: 'notify', appId: 'dev.b', title: 'from b' }); await p.waitForTimeout(100);
  await send({ action: 'apps:set', apps: [{ id: 'dev.a', label: 'A2', url: 'http://localhost:8765/apps/sdk-demo/index.html' }] });
  await p.waitForTimeout(400);
  check('apps:set keeps running listed app', await has('.app-frame[data-app="dev.a"]') && await cls('#device', 'in-app'));
  check('apps:set updates label live', (await osf().$eval('.app-frame[data-app="dev.a"] .hb-label', e => e.textContent)) === 'A2');
  check('apps:set removes unlisted app', !(await osf().$$eval('.app-grid .app-icon', els => els.map(e => e.dataset.app))).includes('dev.b'));
  await osf().click('#tb-calendar'); await p.waitForTimeout(300);
  check('notifications of removed app are dropped', !(await osf().$$eval('#calendar .notif-title', els => els.map(e => e.textContent))).includes('from b'));

  // --- top bar switches menus directly
  await osf().click('#tb-control'); await p.waitForTimeout(250);
  check('top bar switches calendar → quick', (await osf().$eval('#device', d => d.dataset.overlay)) === 'control');
  await osf().click('#tb-control'); await p.waitForTimeout(250);
  check('clicking again closes it', (await osf().$eval('#device', d => d.dataset.overlay)) === undefined);

  // --- settings + power
  await clearLog();
  await osf().click('#tb-control'); await p.waitForTimeout(250);
  await osf().click('[data-toggle="dnd"] .cc-toggle-main'); await p.waitForTimeout(250);
  ev = await events();
  check('os:settingsChanged emitted (dnd)', ev.some(e => e.includes('os:settingsChanged') && e.includes('"dnd":true')));
  await osf().click('.cc-round[title="Put away"]'); await p.waitForTimeout(200);
  check('Put away → os:requestClose', (await events()).some(e => e.includes('os:requestClose')));

  // --- App Details deep link into Settings
  await osf().click('#overlay-scrim').catch(() => {});
  await send({ action: 'apps:home' }); await p.waitForTimeout(400);
  await osf().click('.app-grid .app-icon[data-app="dev.a"]', { button: 'right' }); await p.waitForTimeout(200);
  await osf().click('.menu-item:has-text("App Details")'); await p.waitForTimeout(600);
  check('App Details opens Settings › Apps', (await osf().$eval('.settings .page-title', e => e.textContent)) === 'Apps');

  // --- logging: errors forwarded to host as os:log, visible in journal
  await clearLog();
  await send({ action: 'apps:register', app: { id: 'bad' } }); await p.waitForTimeout(300);
  ev = await events();
  check('errors forwarded as os:log', ev.some(e => e.includes('os:log') && e.includes('"level":"error"')));
  await osf().click('.sidebar-row:has-text("System Log")'); await p.waitForTimeout(300);
  check('journal shows the error', (await osf().$$eval('.jl-error .jl-msg', els => els.map(e => e.textContent))).some(t => t.includes('needs an')));

  // --- search
  await send({ action: 'apps:home' }); await p.waitForTimeout(400);
  await osf().fill('.search-entry', 'zzz'); await p.waitForTimeout(100);
  check('search: no results page', (await osf().$eval('.app-grid .status-title', e => e.textContent)) === 'No Results');
  await osf().fill('.search-entry', 'a2'); await osf().press('.search-entry', 'Enter'); await p.waitForTimeout(500);
  check('search: Enter launches first match', await cls('.app-frame[data-app="dev.a"]', 'is-foreground'));

  console.log(`\n${failed} failed`);
  console.log(errors.filter(e => !e.includes('needs an')).join('\n') || 'no unexpected console errors');
  process.exitCode = failed ? 1 : 0;
  await b.close();
})();
