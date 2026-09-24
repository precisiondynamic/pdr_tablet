// Bundled reference apps: every SDK capability exercised through a real app.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text() + ' @' + (m.location().url || '').split('/').slice(-2).join('/')); });
  await p.goto((process.env.PDR_URL || 'http://localhost:8765/dev/'));
  const os = () => p.frames().find(f => f.url().includes('/os/index.html'));
  const app = (name) => p.frames().find(f => f.url().includes('/apps/' + name + '/') && !f.isDetached());
  const send = (m) => p.evaluate(m => document.getElementById('os').contentWindow.postMessage(m, '*'), m);
  const wait = (ms = 350) => p.waitForTimeout(ms);
  const has = (sel) => os().$(sel).then(Boolean);
  const stored = (id) => os().evaluate(id => JSON.parse(localStorage.getItem('pdr_tablet:app:' + id) || '{}'), id);
  const emits = async () => (await p.$$eval('#log .out', els => els.map(e => e.textContent))).reverse();
  const clearLog = () => p.evaluate(() => document.getElementById('log').innerHTML = '');
  const badge = (id) => os().$eval(`.app-grid .app-icon[data-app="${id}"]`, e => e.querySelector('.badge')?.textContent || '0');
  const launch = async (id, data, ms = 1100) => { await send({ action: 'apps:launch', id, data }); await wait(ms); };
  const key = (k) => send({ action: 'input:key', type: 'keydown', key: k });
  const type = async (s) => { for (const ch of s) await key(ch); };
  let failed = 0;
  const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  → ' + JSON.stringify(extra))); };
  const section = (s) => console.log('— ' + s);

  await wait(300); await os().evaluate(() => localStorage.clear()); await p.reload(); await wait(3800);
  await send({ action: 'os:unlock' }); await wait(500);

  section('Platform');
  let ids = await os().$$eval('.app-grid .app-icon', els => els.map(e => e.dataset.app));
  check('5 bundled apps + Settings registered', ['pdr.messages', 'pdr.notes', 'pdr.calculator', 'pdr.crypto', 'pdr.sdkdemo', 'system.settings'].every(i => ids.includes(i)), ids);
  check('default dash pins bundled apps', (await os().$$eval('#dash .app-icon[data-app]', els => els.map(e => e.dataset.app))).join() === 'pdr.messages,pdr.notes,pdr.crypto,system.settings');
  await send({ action: 'apps:set', apps: [] }); await wait();
  check('apps:set [] keeps bundled apps', (await os().$$eval('.app-grid .app-icon', els => els.length)) === 6);
  await send({ action: 'os:init', devApps: false }); await wait();
  check('devApps:false hides SDK Demo', !(await has('.app-grid .app-icon[data-app="pdr.sdkdemo"]')));
  await send({ action: 'os:init', bundledApps: false }); await wait();
  check('bundledApps:false removes all bundled apps', (await os().$$eval('.app-grid .app-icon', els => els.map(e => e.dataset.app))).join() === 'system.settings');
  await send({ action: 'os:init', bundledApps: true, devApps: true }); await wait();
  check('re-enabling brings them back', (await os().$$eval('.app-grid .app-icon', els => els.length)) === 6);

  await launch('pdr.calculator');
  const sandbox = await os().$eval('.app-frame[data-app="pdr.calculator"] iframe', e => e.getAttribute('sandbox'));
  check('bundled app sandbox has no allow-same-origin', !sandbox.includes('allow-same-origin'), sandbox);
  const escape = await app('calculator').evaluate(() => { try { return window.parent.document.title; } catch (e) { return 'blocked'; } });
  check('bundled app cannot touch the OS page', escape === 'blocked', escape);
  const ls = await app('calculator').evaluate(() => { try { localStorage.setItem('x', '1'); return 'allowed'; } catch (e) { return 'blocked'; } });
  check('bundled app has no direct localStorage (must use tablet.storage)', ls === 'blocked');

  section('Calculator (self-contained)');
  await type('12'); await key('*'); await type('3.5'); await key('+'); await type('8'); await key('Enter'); await wait(200);
  check('relayed keys: 12*3.5+8 = 50', (await app('calculator').$eval('#result', e => e.textContent)) === '50');
  await key('/'); await key('0'); await key('Enter'); await wait(150);
  check('divide by zero error', (await app('calculator').$eval('#result', e => e.textContent)).includes('divide by zero'));
  await key('Escape'); await type('2'); await key('^'); await key('+'); await key('r'); await type('16'); await key('Enter'); await wait(150);
  check('2² + √16 = 8', (await app('calculator').$eval('#result', e => e.textContent)) === '8');
  check('history recorded', (await app('calculator').$$eval('.calc-history-item', els => els.length)) === 2);
  await clearLog();

  section('Notes (storage, input, lifecycle)');
  await launch('pdr.notes');
  await app('notes').click('#new-note'); await wait(200);
  await type('Shopping'); await key('Enter');
  await type('eggs, milk'); await wait(100);
  check('typing via relayed keys fills title + body', (await app('notes').$eval('.notes-title', e => e.value)) === 'Shopping' && (await app('notes').$eval('.notes-body', e => e.value)) === 'eggs, milk');
  await send({ action: 'apps:home' }); await wait(150);   // before the 500 ms debounce: must flush on hide
  let s = await stored('pdr.notes');
  check('hide flushes pending save immediately', s.notes && s.notes[0] && s.notes[0].body === 'eggs, milk', s);
  check('app:storage reported to host', (await emits()).some(e => e.includes('app:storage') && e.includes('pdr.notes')));
  await send({ action: 'apps:close', id: 'pdr.notes' }); await wait(400);
  await launch('pdr.notes');
  check('after close + relaunch the note is restored and reopened', (await app('notes').$eval('.notes-title', e => e.value)) === 'Shopping');
  await launch('pdr.notes', { create: true, title: 'Deep linked', body: 'from launch data' }, 500);
  check('launch data creates a note', (await app('notes').$eval('.notes-title', e => e.value)) === 'Deep linked' && (await app('notes').$$eval('.notes-item', els => els.length)) === 2);
  await app('notes').click('.notes-editor-actions .btn-destructive'); await wait(200);
  await app('notes').click('.kit-dialog .btn-destructive-fill'); await wait(300);
  check('delete (after confirm) removes it', (await app('notes').$$eval('.notes-item', els => els.length)) === 1);
  await app('notes').click('.kit-toast button'); await wait(300);
  check('undo restores it', (await app('notes').$$eval('.notes-item', els => els.length)) === 2);
  await app('notes').fill('#search', 'eggs'); await wait(100);
  check('search filters by body', (await app('notes').$$eval('.notes-item', els => els.length)) === 1);
  await app('notes').fill('#search', '');

  section('Messages (notifications, badges, deep links, background)');
  await launch('pdr.messages', undefined, 1300);
  await send({ action: 'apps:home' }); await wait(400);
  check('initial unread badge on icon', (await badge('pdr.messages')) === '3');
  await app('messages').evaluate(() => window.__messages.simulateIncoming('dani')); await wait(400);
  check('background message → badge increments', (await badge('pdr.messages')) === '4');
  check('background message → banner shown', await has('.banner'));
  await os().click('#tb-calendar'); await wait(300);
  const titles = await os().$$eval('#calendar .notif-title', els => els.map(e => e.textContent));
  check('notification in message tray', titles.includes('Dani Okafor'), titles);
  await os().click('#calendar .notif:has-text("Dani Okafor")'); await wait(900);
  check('tapping it deep-links into the Dani thread', (await app('messages').$eval('.msg-header-name', e => e.textContent)) === 'Dani Okafor');
  check('opening the thread clears its unread', (await app('messages').evaluate(() => window.__messages.totalUnread())) === 3);
  await send({ action: 'apps:message', id: 'pdr.messages', event: 'incoming', data: { from: 'Dani Okafor', text: 'host push works' } }); await wait(400);
  const bubbles = await app('messages').$$eval('.msg-bubble', els => els.map(e => e.textContent));
  check('host → app message arrives in the open thread (no notification)', bubbles.some(t => t.includes('host push works')));
  await app('messages').fill('.msg-input', 'test reply'); await app('messages').press('.msg-input', 'Enter'); await wait(300);
  check('sending works', (await app('messages').$$eval('.from-me .msg-bubble', els => els.map(e => e.textContent))).some(t => t.includes('test reply')));
  await send({ action: 'apps:home' }); await wait(5200);
  check('scripted reply arrives while in background (badge)', parseInt(await badge('pdr.messages'), 10) >= 4);

  section('Eviction + restore');
  await send({ action: 'os:init', maxBackgroundApps: 1 }); await wait(200);
  await launch('pdr.calculator', undefined, 600); await launch('pdr.notes', undefined, 600); await launch('pdr.sdkdemo', undefined, 800);
  check('messages evicted under a 1-app background limit', !(await has('.app-frame[data-app="pdr.messages"]')));
  await send({ action: 'os:init', maxBackgroundApps: 4 }); await wait(200);
  await launch('pdr.messages', { thread: 'dani' }, 1300);
  const restored = await app('messages').$$eval('.msg-bubble', els => els.map(e => e.textContent));
  check('state restored from storage after eviction', restored.some(t => t.includes('host push works')));

  section('SDK Demo');
  await launch('pdr.sdkdemo', undefined, 900);
  const d = app('sdk-demo');
  await d.click('#s-quota'); await wait(400);
  check('storage quota enforced', (await d.$eval('#s-out', e => e.textContent)).includes('quota exceeded'));
  await d.click('#s-badkey'); await wait(300);
  check('invalid key rejected', (await d.$eval('#s-out', e => e.textContent)).includes('key must be'));
  await d.click('#s-fn'); await wait(300);
  check('non-serialisable value rejected', (await d.$eval('#s-out', e => e.textContent)).includes('ERROR'));
  await d.click('#s-count'); await wait(200); await d.click('#s-count'); await wait(300);
  check('storage round-trip (counter++ twice)', (await d.$eval('#s-out', e => e.textContent)).startsWith('counter++ → 2'));
  await d.click('#r-send'); await wait(300);
  check('request() echo', (await d.$eval('#r-out', e => e.textContent)).startsWith('OK'));
  await d.click('#r-empty'); await wait(300);
  check('request("") rejected', (await d.$eval('#r-out', e => e.textContent)).includes('expected'));
  await d.click('#r-timeoutbtn'); await wait(300);
  check('request timeout', (await d.$eval('#r-out', e => e.textContent)).includes('timed out'));
  await d.click('#r-spam'); await wait(1500);
  check('50 parallel requests all answered', (await d.$eval('#r-out', e => e.textContent)).includes('50 ok'));
  await d.click('#n-send'); await wait(300);
  await send({ action: 'apps:home' }); await wait(300);
  await os().click('#tb-calendar'); await wait(300);
  await os().click('#calendar .notif:has-text("SDK Demo")'); await wait(700);
  check('notification data comes back as launch data', (await app('sdk-demo').$eval('#ctx', e => e.textContent)).includes('"from": "notification"'));
  await send({ action: 'os:settings', settings: { theme: 'light', accent: '#e62d42' } }); await wait(300);
  check('theme propagates to app pages', (await app('sdk-demo').$eval('#t-theme', e => e.textContent)) === 'light' && (await app('sdk-demo').$eval('#t-accent', e => e.textContent)) === '#e62d42');
  await send({ action: 'os:settings', settings: { theme: 'dark', accent: '#3584e4' } }); await wait(200);

  section('LSX Crypto (demo backend)');
  await launch('pdr.crypto', undefined, 3600);
  const c = () => app('crypto');
  const W = () => c().evaluate(() => JSON.parse(JSON.stringify(window.__crypto.wallet())));
  check('starts in demo mode', (await c().$eval('.cx-mode', e => e.textContent)).includes('Demo'));
  let w0 = await W();
  check('seeded wallet is consistent (cash ≥ 0, holdings > 0)', w0.cash > 0 && Object.values(w0.holdings).some(h => h.amount > 0) && w0.txs.length === 11, { cash: w0.cash, txs: w0.txs.length });
  await c().evaluate(() => window.__crypto.go('coin', 'VNW')); await wait(600);
  await c().fill('.cx-amount', '1000'); await c().dispatchEvent('.cx-amount', 'input'); await wait(150);
  await c().click('.cx-trade .cx-submit'); await wait(300); await c().click('.kit-dialog .cx-submit'); await wait(700);
  let w1 = await W();
  check('buy $1000 VNW: cash down by $1000 (fee included)', Math.abs((w0.cash - w1.cash) - 1000) < 0.05, w0.cash - w1.cash);
  check('buy: VNW holding increased, tx recorded', w1.holdings.VNW.amount > w0.holdings.VNW.amount && w1.txs[0].type === 'buy' && w1.txs[0].sym === 'VNW');
  await c().click('.cx-trade-tab.is-sell'); await wait(200);
  await c().click('.cx-frac:has-text("50%")'); await wait(150);
  await c().click('.cx-trade .cx-submit'); await wait(300); await c().click('.kit-dialog .cx-submit'); await wait(700);
  let w2 = await W();
  check('sell 50%: holding halves, cash up', Math.abs(w2.holdings.VNW.amount - w1.holdings.VNW.amount / 2) < 1e-6 && w2.cash > w1.cash);
  await c().click('.cx-trade-tab.is-buy'); await wait(200);
  await c().fill('.cx-amount', '99999999'); await c().dispatchEvent('.cx-amount', 'input'); await wait(150);
  check('over-budget buy blocked', await c().$eval('.cx-trade .cx-submit', e => e.disabled) && (await c().$eval('.cx-trade .cx-hint', e => e.textContent)).includes('Not enough cash'));
  await c().fill('.cx-amount', '3'); await c().dispatchEvent('.cx-amount', 'input'); await wait(150);
  check('below-minimum order blocked', (await c().$eval('.cx-trade .cx-hint', e => e.textContent)).includes('Minimum'));

  await c().evaluate(() => window.__crypto.go('transfer', 'LSC', 'send')); await wait(500);
  await c().fill('.cx-form input.mono', 'lsx1bad'); await c().dispatchEvent('.cx-form input.mono', 'input'); await wait(150);
  check('invalid address rejected', (await c().$eval('.cx-form .cx-hint', e => e.textContent)).includes('lsx1'));
  const addr = 'lsx1' + 'q'.repeat(38);
  await c().fill('.cx-form input.mono', addr); await c().dispatchEvent('.cx-form input.mono', 'input');
  await c().fill('.cx-form input.num', '0.01'); await c().dispatchEvent('.cx-form input.num', 'input'); await wait(150);
  await c().click('.cx-form .btn-suggested.btn-lg'); await wait(300); await c().click('.kit-dialog .btn-suggested'); await wait(700);
  let w3 = await W();
  check('send 0.01 LSC: holding reduced by amount + network fee, tx recorded', w3.txs[0].type === 'send' && w3.txs[0].to === addr && Math.abs((w2.holdings.LSC.amount - w3.holdings.LSC.amount) - (0.01 + w3.txs[0].feeCoin)) < 1e-9);
  await c().evaluate(() => window.__crypto.go('transfer', null, 'cash')); await wait(400);
  await c().fill('.cx-cash-input', '500'); await c().click('.cx-form .btn-suggested'); await wait(500);
  let w4 = await W();
  check('deposit $500 from bank', Math.abs(w4.cash - w3.cash - 500) < 0.01 && Math.abs(w3.bank - w4.bank - 500) < 0.01);

  // alert that is already satisfied → fires on the next check
  await c().evaluate(() => {
    const M = LSX.Market;
    window.__crypto.prefs().alerts.push({ id: 'atest', sym: 'CHOP', dir: 'above', target: M.price('CHOP', Date.now()) * 0.5, created: Date.now(), triggered: null });
  });
  await send({ action: 'apps:home' }); await wait(300);
  await c().evaluate(() => window.__crypto.checkAlerts(Date.now())); await wait(400);
  check('price alert → notification + badge while in background', (await badge('pdr.crypto')) === '1' && await has('.banner'));
  await os().click('#tb-calendar'); await wait(300);
  await os().click('#calendar .notif:has-text("Chop Inu")'); await wait(900);
  check('alert notification deep-links to the coin page', (await c().$eval('.cx-coin-title h1', e => e.textContent)) === 'Chop Inu');
  await c().evaluate(() => window.__crypto.go('alerts')); await wait(300);
  await send({ action: 'apps:home' }); await wait(300);
  check('visiting Alerts clears the badge', (await badge('pdr.crypto')) === '0');
  const cashBefore = (await W()).cash;
  await send({ action: 'apps:close', id: 'pdr.crypto' }); await wait(400);
  await launch('pdr.crypto', { coin: 'LSC' }, 3300);
  check('wallet persisted across close/relaunch', Math.abs((await W()).cash - cashBefore) < 0.001);
  check('launch data {coin} opens the coin page', (await c().$eval('.cx-coin-title h1', e => e.textContent)) === 'Los Santos Coin');

  section('LSX Crypto (live backend contract)');
  await p.evaluate(() => {
    const state = { cash: 777, bank: 1000, bankName: 'Fleeca •• 0001', holdings: { LSC: { amount: 1, cost: 60000 } }, address: 'lsx1' + 'z'.repeat(38), txs: [] };
    window.harnessRequestHandlers = {
      'crypto:hello': () => ({ ok: true, data: { backend: 'lsx', version: 1 } }),
      'crypto:state': () => ({ ok: true, data: state }),
      'crypto:trade': (r) => ({ ok: true, data: { tx: { id: 'srv', hash: '0x' + '1'.repeat(64), type: r.data.side, sym: r.data.sym, amount: r.data.amount, price: 1, usd: 100, fee: 0.5, time: Date.now(), status: 'completed' }, state: { ...state, cash: 111 } } }),
    };
  });
  await send({ action: 'apps:close', id: 'pdr.crypto' }); await wait(400);
  await launch('pdr.crypto', undefined, 3300);
  check('server answering crypto:hello → Live mode', (await c().$eval('.cx-mode', e => e.textContent)).includes('Live'));
  check('wallet comes from the server', (await W()).cash === 777 && (await c().$eval('.cx-account-bank', e => e.textContent)).includes('Fleeca'));
  await c().evaluate(() => window.__crypto.go('coin', 'LSC')); await wait(500);
  await c().fill('.cx-amount', '100'); await c().dispatchEvent('.cx-amount', 'input'); await wait(150);
  await c().click('.cx-trade .cx-submit'); await wait(300); await c().click('.kit-dialog .cx-submit'); await wait(700);
  check('trades go to the server and its state wins', (await W()).cash === 111);
  await p.evaluate(() => { window.harnessRequestHandlers = {}; });

  section('Settings › Apps');
  await launch('system.settings', { section: 'apps' }, 700);
  const notesRow = await os().$eval('.row:has(.row-title:text-is("Notes")) .row-subtitle', e => e.textContent);
  check('storage usage shown', /Built-in · .*(KB|B) stored/.test(notesRow), notesRow);
  await os().click('.row:has(.row-title:text-is("Notes")) .btn:has-text("Clear Data")'); await wait(200);
  await os().click('.dialog-btn:has-text("Clear Data")'); await wait(400);
  check('Clear Data wipes the app storage', Object.keys(await stored('pdr.notes')).length === 0);
  check('host told about the wipe', (await emits()).some(e => e.includes('app:storage') && e.includes('"cleared":true')));

  console.log(`\n${failed} failed`);
  console.log(errors.filter(e => !/404|Failed to load resource/.test(e)).join('\n') || 'no unexpected console errors');
  process.exitCode = failed ? 1 : 0;
  await b.close();
})();
