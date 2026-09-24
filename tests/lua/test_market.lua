-- lua5.4 tests/lua/test_market.lua <prices.txt>
-- prices.txt: "SYM time price" lines generated from web/apps/crypto/js/market.js (see tests/README.md)
package.path = './lib/?.lua;' .. package.path
local M = require('lsx_market')
local file = assert(arg[1], 'usage: lua5.4 tests/lua/test_market.lua prices.txt')
local n, worst, bad = 0, 0, 0
for line in io.lines(file) do
    local sym, t, p = line:match('^(%S+) (%S+) (%S+)$')
    t, p = math.tointeger(tonumber(t)) or tonumber(t), tonumber(p)
    local q = M.price(sym, t)
    local rel = math.abs(q - p) / p
    if rel > worst then worst = rel end
    if rel > 1e-12 then bad = bad + 1; if bad <= 5 then print('MISMATCH', sym, t, p, q) end end
    n = n + 1
end
print(('%d samples, worst relative error %.3g'):format(n, worst))
local ok, px = M.verifyQuote('LSC', M.price('LSC', 1758700000000 + 1200), 1758700000000)
print((ok and 'PASS' or 'FAIL') .. ' verifyQuote accepts a quote from 1.2 s ago')
print((not M.verifyQuote('LSC', M.price('LSC', 1758700000000) * 1.01, 1758700000000) and 'PASS' or 'FAIL') .. ' verifyQuote rejects a price 1% off')
os.exit(bad == 0 and ok and 0 or 1)
