-- lua5.4 tests/lua/test_lib.lua   (run from the repository root)
package.path = './lib/?.lua;' .. package.path
local V = require('validate')
local Guard = require('guard')

local passed, failed = 0, 0
local function check(name, cond, extra)
    if cond then passed = passed + 1 else failed = failed + 1 end
    print((cond and 'PASS ' or 'FAIL ') .. name .. ((not cond and extra) and ('  → ' .. tostring(extra)) or ''))
end

-- ---------------------------------------------------------------- validate
local Trade = V.table({
    side = V.enum({ 'buy', 'sell' }),
    sym = V.string({ pattern = '^[A-Z]+$', max = 8 }),
    amount = V.optional(V.number({ min = 0, max = 1e9 })),
    note = V.optional(V.string({ max = 10, trim = true })),
    tags = V.optional(V.array({ of = V.string({ max = 5 }), max = 3 })),
})

local ok, res = V.check(Trade, { side = 'buy', sym = 'LSC', amount = 1.5 })
check('valid request passes', ok and res.side == 'buy' and res.amount == 1.5, res)
ok, res = V.check(Trade, { side = 'steal', sym = 'LSC' })
check('bad enum', not ok and res:find('side'), res)
ok, res = V.check(Trade, { side = 'buy', sym = 'lsc' })
check('pattern enforced', not ok and res:find('sym'), res)
ok, res = V.check(Trade, { side = 'buy', sym = 'LSC', amount = -1 })
check('min enforced', not ok and res:find('amount'), res)
ok, res = V.check(Trade, { side = 'buy', sym = 'LSC', amount = 0 / 0 })
check('NaN rejected', not ok, res)
ok, res = V.check(Trade, { side = 'buy', sym = 'LSC', amount = math.huge })
check('inf rejected', not ok, res)
ok, res = V.check(Trade, { side = 'buy', sym = 'LSC', amount = '5' })
check('number as string rejected', not ok, res)
ok, res = V.check(Trade, { side = 'buy', sym = 'LSC', admin = true })
check('unknown field rejected', not ok and res:find('admin'), res)
ok, res = V.check(V.table({ a = V.number() }, { extra = true }), { a = 1, junk = 2 })
check('extra = true drops unknown fields', ok and res.junk == nil and res.a == 1)
ok, res = V.check(Trade, { side = 'buy', sym = 'LSC', note = '  hi  ' })
check('trim', ok and res.note == 'hi', res and res.note)
ok, res = V.check(Trade, { side = 'buy', sym = 'LSC', tags = { 'a', 'b', 'c', 'd' } })
check('array max', not ok and res:find('tags'), res)
ok, res = V.check(Trade, { side = 'buy', sym = 'LSC', tags = { [1] = 'a', [3] = 'c' } })
check('sparse array rejected', not ok, res)
ok, res = V.check(Trade, { side = 'buy', sym = 'LSC', tags = { 'toolong' } })
check('nested path in error', not ok and res:find('tags%[1%]'), res)
ok, res = V.check(Trade, 'nope')
check('non-table rejected', not ok)
ok, res = V.check(V.number({ integer = true }), 2.5)
check('integer enforced', not ok)
local cyclic = {}; cyclic.self = cyclic
check('sizeOf refuses cycles', V.sizeOf(cyclic) == math.huge)
check('sizeOf counts strings', V.sizeOf({ a = string.rep('x', 1000) }) > 1000)

-- ---------------------------------------------------------------- guard
local t = 0
local logs = {}
local g = Guard.new({ rate = 2, burst = 3, clock = function() return t end, log = function(m) logs[#logs + 1] = m end })
local taken = 0
for _ = 1, 10 do if g:take(1, 'trade') then taken = taken + 1 end end
check('burst of 3 then limited', taken == 3, taken)
check('rate-limit warning logged once', #logs == 1, #logs)
t = 1000
check('refills at 2/s', g:take(1, 'trade') and g:take(1, 'trade') and not g:take(1, 'trade'))
check('limits are per player', g:take(2, 'trade'))
check('limits are per key', g:take(1, 'other'))
g:forget(1)
check('forget() resets a player', g:take(1, 'trade'))

local replies = {}
local function reply(r) replies[#replies + 1] = r end
local g2 = Guard.new({ rate = 100, burst = 100, clock = function() return t end, log = function() end, maxBytes = 200 })
g2:handle(1, 'trade', { side = 'buy', sym = 'LSC' }, Trade, function(clean) return { done = clean.sym } end, reply)
check('handle: valid → ok + data', replies[1].ok and replies[1].data.done == 'LSC')
g2:handle(1, 'trade', { side = 'x', sym = 'LSC' }, Trade, function() error('must not run') end, reply)
check('handle: invalid → error, handler not run', not replies[2].ok and replies[2].error:find('Invalid request'))
g2:handle(1, 'trade', { side = 'buy', sym = 'LSC' }, Trade, function() error('db down') end, reply)
check('handle: handler error isolated', not replies[3].ok and replies[3].error == 'Server error')
g2:handle(1, 'trade', { side = 'buy', sym = 'LSC' }, Trade, function() return nil, 'Not enough cash' end, reply)
check('handle: nil, err → user-facing error', not replies[4].ok and replies[4].error == 'Not enough cash')
g2:handle(1, 'trade', { side = 'buy', sym = string.rep('A', 500) }, Trade, function() return 1 end, reply)
check('handle: oversized request rejected before validation', replies[5].error == 'Request too large', replies[5].error)
local g3 = Guard.new({ rate = 0, burst = 1, clock = function() return t end, log = function() end })
g3:handle(9, 'x', {}, nil, function() return 1 end, reply)
g3:handle(9, 'x', {}, nil, function() return 1 end, reply)
check('handle: rate limited → Slow down', replies[7].error == 'Slow down')

print(('\n%d passed, %d failed'):format(passed, failed))
os.exit(failed == 0 and 0 or 1)
