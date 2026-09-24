// Writes "SYM time price" samples from the JavaScript market engine for tests/lua/test_market.lua.
global.window = global;
require('../../web/apps/crypto/js/market.js');
const M = window.LSX.Market;
const out = [];
const base = 1758700000000;
for (let k = 0; k < 400; k++) {
    const t = base + k * 7919123 + (k % 7) * 13;
    for (const c of M.COINS) out.push(`${c.sym} ${t} ${M.price(c.sym, t).toPrecision(17)}`);
}
for (const t of [0, 1, 1e12, 2e12, 4102444800000]) for (const c of M.COINS) out.push(`${c.sym} ${t} ${M.price(c.sym, t).toPrecision(17)}`);
require('fs').writeFileSync(process.argv[2], out.join('\n'));
