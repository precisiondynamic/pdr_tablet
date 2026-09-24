// NETWORK (pdr_criminal's player app): registration gating, the full contract → crew →
// operation → settlement journey on the demo world, in-place intel updates, deep links,
// X offers, and the live backend contract (unavailable → retry → pushes).
const { start } = require('./lib');

(async () => {
    const t = await start();
    const { page: p, os, wait, send, has, check, section, frameOf, launch } = t;
    const APP = 'pdr.network';
    const url = (demo) => new URL('../apps/network/index.html' + (demo ? '?demo=1' : ''), await_url).href;
    const await_url = await p.evaluate(() => location.href);
    const register = (demo = true) => send({ action: 'apps:register', app: { id: APP, label: 'Network', url: url(demo), icon: new URL('../apps/network/icon.svg', await_url).href } });
    const f = () => frameOf(APP);
    const step = (s) => send({ action: 'apps:message', id: APP, event: 'network:demo', data: { step: s } });
    const text = async (sel) => (await (await f()).$eval(sel, (e) => e.textContent)).trim();
    const badge = () => os().$eval(`.app-icon[data-app="${APP}"] .badge`, (e) => e.textContent).catch(() => '0');

    section('Registration');
    check('not bundled: no NETWORK icon on a fresh tablet', !(await has(`.app-icon[data-app="${APP}"]`)));
    await register(); await wait(300);
    check('appears once pdr_criminal registers it', await has(`#home .app-icon[data-app="${APP}"]`));

    section('Boot');
    const t0 = Date.now();
    await send({ action: 'apps:launch', id: APP });
    let fr = null;
    for (let i = 0; i < 60 && !fr; i++) { await wait(25); fr = await f(); }
    await fr.waitForSelector('.page-home', { timeout: 3000 });
    const bootMs = Date.now() - t0;
    check('authenticates to the dashboard in under a second', bootMs < 1000, bootMs);
    check('connection indicator says CONNECTED', (await text('.conn')).includes('CONNECTED'));

    section('Home');
    check('available contracts count', (await text('.card-available .big-count')).startsWith('03'));
    check('reputation tier + progress', (await text('.card-rep')).includes('B') && (await text('.card-rep')).includes('1,840 / 2,200'));
    check('no active operation', (await text('.page-home')).includes('No active operation'));
    check('recent history listed', (await (await f()).$$('.recent .trow')).length === 4);

    section('Contracts + dossier');
    await (await f()).click('[data-nav=contracts]'); await wait(300);
    const cards = await (await f()).$$('.contract');
    check('contract feed as cards', cards.length === 3);
    const fieldCounts = await (await f()).$$eval('.contract', (els) => els.map((e) => ({ tier: e.querySelector('.tier').textContent, n: e.querySelectorAll('.kv').length })));
    check('lower tiers reveal more than higher tiers (D > B)', fieldCounts.find((x) => x.tier === 'D').n > fieldCounts.find((x) => x.tier === 'B').n, fieldCounts);
    check('no hidden mechanics on cards (no police/guards/tracker lines)', !/police|guard|tracker/i.test(await text('.feed')));
    await (await f()).click('.contract >> nth=0'); await wait(300);
    check('dossier: codename, photo, search area map, compensation', await (await f()).$('.net-photo') && await (await f()).$('.map svg') && (await text('.pay-big')).startsWith('ZNC'));
    check('primary action is ASSEMBLE CREW, not accept', (await text('.dossier-side .btn-primary')).includes('ASSEMBLE CREW'));

    section('Crew lobby + split');
    await (await f()).click('.dossier-side .btn-primary'); await wait(400);
    check('lobby opens as YOUR OPERATION', (await text('.role')).includes('YOUR OPERATION'));
    await (await f()).click('.member.is-empty .btn'); await wait(200);
    await (await f()).click('.pick >> nth=0'); await wait(250);
    check('invitee shows as INVITED', (await text('.members')).includes('INVITED'));
    await (await f()).click('.member.is-empty .btn'); await wait(200);
    await (await f()).click('.pick >> nth=0'); await wait(3600);
    check('invitees join and confirm the split', (await text('.confirmed')) === '3 / 3 CONFIRMED');
    await (await f()).click('text=EDIT SPLIT'); await wait(150);
    await (await f()).click('.split-row.is-edit >> nth=0 >> .icon-btn >> nth=1'); await wait(80);
    check('split must total 100% before proposing', await (await f()).$eval('text=PROPOSE SPLIT', (e) => e.closest('button').disabled));
    await (await f()).click('.split-row.is-edit >> nth=1 >> .icon-btn >> nth=0'); await wait(80);
    await (await f()).click('text=PROPOSE SPLIT'); await wait(250);
    check('changing the split resets everyone else’s confirmation', (await text('.confirmed')) === '1 / 3 CONFIRMED' && (await text('.members')).includes('REVIEWING'));
    check('BEGIN is locked until everyone reconfirms', await (await f()).$eval('.lobby-side .btn-primary', (e) => e.disabled));
    await wait(2600);
    check('crew reconfirms the new split', (await text('.confirmed')) === '3 / 3 CONFIRMED');
    await (await f()).click('text=BEGIN OPERATION'); await wait(500);

    section('Operation terminal');
    check('app becomes the operation terminal', await (await f()).$('.page-op') && (await text('.phase-title')) === 'LOCATE TARGET');
    check('intel starts unknown', (await text('.intel')).match(/Unknown/g).length === 3);
    check('broad search area, no exact point', await (await f()).$('.map-zone') && !(await (await f()).$('.map-point')));
    check('client window timer shown', /\d\d:\d\d/.test(await text('.op-window .timer')));
    await step('identify'); await wait(250);
    check('changed intel field is highlighted, others are not', await (await f()).$eval('.intel .kv >> nth=0', () => true).catch(() => true) &&
        await (await f()).evaluate(() => { const v = [...document.querySelectorAll('.intel .v')]; return v[0].textContent === 'Identified' && /is-changed/.test(v[0].className) && /is-changed-alert/.test(v[1].className) && !/is-changed/.test(v[2].className); }));
    const trackingEl = await (await f()).$('.intel .kv >> nth=2 >> .v');
    await step('attempt'); await wait(200);
    check('updates within a phase keep the page (same nodes)', await trackingEl.evaluate((e) => e.isConnected));
    check('phase advances to security', (await text('.phase-title')) === 'SECURITY BYPASS' && await (await f()).$('.instrument.security'));
    check('security surface shows attempts', (await text('.attempts')) === 'ATTEMPT 02 / 03');
    await step('bypass'); await wait(300);
    check('tracker phase: signal analysis instrument', await (await f()).$('.instrument.tracker') && (await text('.instrument.tracker')).includes('-61 dBm'));
    const strengthEl = await (await f()).$('.instrument.tracker .kv >> nth=2 >> .v');
    for (let i = 0; i < 4; i++) { await step('signal'); await wait(60); }
    check('signal strength updates without repainting', await strengthEl.evaluate((e) => e.isConnected && /-\d+ dBm/.test(e.textContent)));
    await step('untrack'); await step('disconnect'); await wait(400);
    check('delivery phase: condition, tracking clear, distance', /86%/.test(await text('.instrument.delivery')) && (await text('.instrument.delivery')).includes('CLEAR') && (await text('.instrument.delivery')).includes('3.8 KM'));
    check('exact location only once intel provides it', await (await f()).$('.map-point'));
    check('crew member marked disconnected', await (await f()).$('.crew-dot i.off'));
    check('no hidden bonus hints anywhere in the terminal', !/bonus|police|minutes left to/i.test(await text('.page-op')));

    section('Settlement');
    await step('deliver'); await wait(1400);
    check('report takes over when the contract closes', await (await f()).$('.report.is-complete'));
    const rep = await text('.report');
    check('report shows BASE / ADJUSTMENT / TOTAL / YOUR SHARE, no itemised bonuses', ['BASE', 'ADJUSTMENT', 'TOTAL', 'YOUR SHARE'].every((k) => rep.includes(k)) && !/bonus/i.test(rep));
    check('reputation delta shown', rep.includes('+148'));
    check('crew disconnect noted', rep.includes('Crew member disconnected'));
    check('badge counts the unread report', (await badge()) === '1');
    await (await f()).click('.lsx-link'); await wait(1200);
    check('payout deep-links into LSX', await os().evaluate(() => [...document.querySelectorAll('.app-frame')].some((e) => e.dataset.app === 'pdr.crypto' && !e.hidden && getComputedStyle(e).visibility !== 'hidden')));
    await launch(APP, undefined, 600);
    await (await f()).click('.report .btn-ghost'); await wait(500);
    check('closing the report acknowledges it', !(await (await f()).evaluate(() => window.__network.state().result)) && (await badge()) === '0');
    check('history + standing updated', (await text('.recent .trow >> nth=0')).includes('SENTINEL'));

    section('Invite from the background → deep link');
    await send({ action: 'apps:home' }); await wait(300);
    await step('invite'); await wait(500);
    check('invite raises an OS notification', await has('.banner') && (await os().$eval('.banner', (e) => e.textContent)).includes('invited you'));
    await os().click('#tb-calendar'); await wait(300);
    await os().click('#calendar .notif:has-text("invited you")'); await wait(900);
    check('notification opens Crew with the invitation', await (await f()).$('.invite[data-invite]'));
    await (await f()).click('text=JOIN CREW'); await wait(400);
    check('joining someone else’s crew is CREW SUPPORT', (await text('.role')).includes('CREW SUPPORT'));
    check('support member must confirm the split', (await text('.lobby-side .btn-primary')).includes('CONFIRM SPLIT'));
    await (await f()).click('text=CONFIRM SPLIT'); await wait(2200);
    check('lead begins → support sees the operation', await (await f()).$('.page-op') && (await text('.role-tag')) === 'CREW SUPPORT');
    await step('fail'); await wait(1200);
    check('failure is an operational report, not a banner', (await text('.report-state')) === 'CONTRACT TERMINATED' && (await text('.report')).includes('WITHDRAWN'));
    check('support: no progression change', (await text('.report')).includes('no progression'));
    await (await f()).click('.report .btn-ghost'); await wait(400);

    section('X offer');
    await step('offer'); await wait(300);
    await (await f()).click('[data-nav=contracts]'); await wait(300);
    check('contracts collapse to a single private offer', (await text('.offer-count')) === '1 PRIVATE OFFER' && !(await (await f()).$('.contract')));
    await (await f()).click('.offer-card'); await wait(300);
    check('X dossier is sparse and warns about the authorization', (await text('.warning')).includes('consumes your current X authorization') && !(await (await f()).$('.net-photo')));
    await (await f()).click('.dossier-side .btn-primary'); await wait(250);
    check('accepting asks for confirmation first', await (await f()).$('.sheet .ask'));
    await (await f()).click('.sheet .btn-ghost'); await wait(200);

    section('Live backend contract');
    await send({ action: 'apps:close', id: APP }); await wait(300);
    await register(false); await wait(300);
    await launch(APP, undefined, 1500);
    check('no server answering → NETWORK UNAVAILABLE + RETRY', (await text('.unavailable')).includes('NETWORK UNAVAILABLE'));
    await p.evaluate(() => {
        const base = {
            player: { id: 'x1', handle: 'Live', tag: 'LIV' }, coin: 'DPR',
            standing: { tier: 'C', points: 500, from: 400, next: 1200, ladder: [{ tier: 'D', state: 'complete' }, { tier: 'C', state: 'current' }], xAuth: false },
            contracts: [], offer: null, lobby: null, operation: null, result: null, invites: [], history: [], stats: {}, crews: [], contacts: [],
        };
        window.__netState = base;
        window.harnessRequestHandlers = {
            'network:hello': () => ({ ok: true, data: { backend: 'network', version: 1, coin: 'DPR', player: base.player } }),
            'network:state': () => ({ ok: true, data: window.__netState }),
            'network:assemble': () => ({ ok: true, data: { error: 'This contract is no longer available' } }),
        };
    });
    await (await f()).click('text=RETRY'); await wait(900);
    check('retry connects to the live server', await (await f()).$('.page-home') && (await text('.card-rep')).includes('500 / 1,200'));
    await p.evaluate(() => {
        const c = { id: 'CN-LIVE', code: 'ANVIL', tier: 'C', fresh: true, window: 20, crew: { min: 1, max: 2 }, payout: { amount: 12 }, fields: [['AREA', 'DAVIS']], area: { name: 'DAVIS' }, dossier: { client: 'X' }, expires: Date.now() + 600000 };
        window.__netState = { ...window.__netState, contracts: [c] };
        document.getElementById('os').contentWindow.postMessage({ action: 'apps:message', id: 'pdr.network', event: 'network:update', data: { state: window.__netState } }, '*');
    });
    await wait(400);
    check('server push updates the count in place', (await text('.card-available .big-count')).startsWith('01'));
    await (await f()).click('[data-nav=contracts]'); await wait(200);
    check('coin comes from the server', (await text('.contract-pay')) === 'DPR 12.00');
    await (await f()).click('.contract'); await wait(200);
    await (await f()).click('.dossier-side .btn-primary'); await wait(400);
    check('server refusals are shown, not thrown', (await (await f()).$eval('.toast', (e) => e.textContent)).includes('NO LONGER AVAILABLE'));
    await p.evaluate(() => { window.harnessRequestHandlers = {}; });

    section('Revoke');
    await send({ action: 'apps:unregister', id: APP }); await wait(400);
    check('revoking access removes the app and closes it', !(await has(`.app-icon[data-app="${APP}"]`)) && !(await os().$(`.app-frame[data-app="${APP}"]`)));

    await t.done();
})();
