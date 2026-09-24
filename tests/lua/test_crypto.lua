-- lua5.4 tests/lua/test_crypto.lua   (needs lua-cjson; run from the repository root)
-- LSX server economy against a mock FiveM environment: payouts, trading, transfers,
-- cash in/out rules, frameworks, validation, persistence, and failure refunds.

local Mock = dofile('tests/lua/fivem_mock.lua')
local out = io.write
local passed, failed = 0, 0
local function check(name, cond, extra)
    if cond then passed = passed + 1 else failed = failed + 1 end
    out((cond and 'PASS ' or 'FAIL ') .. name .. ((not cond and extra ~= nil) and ('  → ' .. tostring(extra)) or '') .. '\n')
end
local function section(s) out('— ' .. s .. '\n') end
local function near(a, b, eps) return math.abs(a - b) <= (eps or 1e-6) end

------------------------------------------------------------------------------------------
section('Standalone: job payouts')
------------------------------------------------------------------------------------------
local m = Mock.boot()
m.players[1] = { license = 'license:aaa' }
m.players[2] = { license = 'license:bbb' }
local api = m.api
check('standalone detected, no bank', api.bridge.name == 'standalone' and api.bridge.hasBank == false)

local ok, tx = api.Pay(1, 0.35, { memo = 'Package delivered', from = 'Unknown sender' })
check('CryptoPay(src, 0.35) → default payout coin', ok and tx.sym == 'ZNC' and near(tx.amount, 0.35) and tx.type == 'receive')
check('tx carries sender label, memo and calling resource', tx.fromLabel == 'Unknown sender' and tx.memo == 'Package delivered' and tx.source == 'test_job')
check('balance updated', near(api.Balance(1, 'ZNC'), 0.35))
local push = m.sent('pdr_tablet:crypto:push', 1)
local note = m.sent('pdr_tablet:crypto:notify', 1)
check('online player gets a live wallet push', #push == 1 and push[1].args[1] == 'crypto:update')
check('…and a notification that deep-links to the tx', #note == 1 and note[1].args[1].data.tx == tx.id and note[1].args[1].appId == 'pdr.crypto')
check('server event for logs/webhooks', m.events[#m.events].name == 'pdr_tablet:crypto:transaction')

ok, tx = api.Pay(1, nil, { usd = 500, sym = 'LSC', memo = 'Heist cut' })
check('CryptoPay with { usd = 500, sym = LSC } pays $500 worth at the live price', ok and near(tx.usd, 500, 0.01) and tx.sym == 'LSC')
check('bad amount rejected', not api.Pay(1, -5) and not api.Pay(1, 0 / 0) and not api.Pay(1, math.huge) and not api.Pay(1, 'x'))
check('unknown coin rejected', not api.Pay(1, 1, { sym = 'DOGE' }))
check('unknown player rejected', not api.Pay(99, 1))

ok = api.Pay('license:ccc', 2, { memo = 'Paid while offline' })
check('pay an offline character by id', ok and near(api.Balance('license:ccc', 'ZNC'), 2))
m.players[3] = { license = 'license:ccc' }
local st = m.request(3, 'crypto:state')
check('…and they see it when they come online', st.ok and near(st.data.holdings.ZNC.amount, 2) and st.data.txs[1].memo == 'Paid while offline')
local before = #m.sent('pdr_tablet:crypto:notify', 3)
api.Pay('license:ccc', 1)
check('paying by character id reaches the online player', #m.sent('pdr_tablet:crypto:notify', 3) == before + 1)

------------------------------------------------------------------------------------------
section('App requests')
------------------------------------------------------------------------------------------
local hello = m.request(1, 'crypto:hello', { version = 1 })
check('hello → live backend', hello.ok and hello.data.backend == 'lsx' and hello.data.payoutCoin == 'ZNC')
st = m.request(1, 'crypto:state')
check('state view', st.ok and st.data.address:match('^lsx1') and #st.data.address == 42 and st.data.features.withdraw == false and st.data.features.deposit == false)
check('standalone: bank shown as not linked', st.data.bankName == 'No bank linked')

local r = m.request(1, 'crypto:trade', { side = 'sell', sym = 'ZNC', amount = 0.35 })
check('sell payout coin for cash', r.ok and r.data.tx.type == 'sell' and r.data.state.cash > 0 and api.Balance(1, 'ZNC') == 0)
local cash = r.data.state.cash
check('fee applied (0.5 %, min $0.25)', near(r.data.tx.fee, math.max(0.25, r.data.tx.usd * 0.005), 1e-6) and near(cash, r.data.tx.usd - r.data.tx.fee, 0.011))
r = m.request(1, 'crypto:trade', { side = 'buy', sym = 'LSC', usd = 5 })
check('minimum order', not r.ok and r.error:find('Minimum'), r.error)
r = m.request(1, 'crypto:trade', { side = 'buy', sym = 'LSC', usd = cash + 50 })
check('spending more than the cash is refused (not silently shrunk)', not r.ok and r.error == 'Not enough cash', r.error)
r = m.request(1, 'crypto:trade', { side = 'buy', sym = 'VNW', usd = cash })
check('buy with the whole balance (usd) never overshoots', r.ok and r.data.state.cash >= 0 and r.data.state.cash < 0.02, r.ok and r.data.state.cash or r.error)
r = m.request(1, 'crypto:trade', { side = 'sell', sym = 'VNW', amount = 999 })
check('oversell refused', not r.ok and r.error:find('only have'), r.error)
local vnw = api.Balance(1, 'VNW')
r = m.request(1, 'crypto:trade', { side = 'sell', sym = 'VNW', amount = vnw })
check('sell exact holding → position closed', r.ok and r.data.state.holdings.VNW == nil)

------------------------------------------------------------------------------------------
section('Validation & abuse')
------------------------------------------------------------------------------------------
check('unknown action', not m.request(1, 'crypto:mint', {}).ok)
check('extra fields rejected', not m.request(1, 'crypto:trade', { side = 'buy', sym = 'LSC', usd = 100, cash = 1e9 }).ok)
check('string amount rejected', not m.request(1, 'crypto:trade', { side = 'buy', sym = 'LSC', usd = '100' }).ok)
check('negative rejected', not m.request(1, 'crypto:trade', { side = 'sell', sym = 'VNW', amount = -1 }).ok)
check('NaN rejected', not m.request(1, 'crypto:trade', { side = 'sell', sym = 'VNW', amount = 0 / 0 }).ok)
check('non-table rejected', not m.request(1, 'crypto:trade', 'buy everything').ok)
check('player without a character refused', (function() m.players[7] = {}; return m.request(7, 'crypto:state').error == 'No character loaded' end)())

------------------------------------------------------------------------------------------
section('Transfers between players')
------------------------------------------------------------------------------------------
api.Pay(1, 5)
local addr2 = api.Address(2)
r = m.request(1, 'crypto:transfer', { sym = 'ZNC', amount = 1, to = addr2 })
check('send to another player', r.ok and r.data.tx.type == 'send' and r.data.tx.to == addr2)
check('recipient credited', near(api.Balance(2, 'ZNC'), 1))
check('sender paid amount + network fee', near(api.Balance(1, 'ZNC'), 5 - 1 - r.data.tx.feeCoin, 1e-9))
check('recipient notified', #m.sent('pdr_tablet:crypto:notify', 2) == 1)
check('unknown address refused', m.request(1, 'crypto:transfer', { sym = 'ZNC', amount = 1, to = 'lsx1' .. string.rep('q', 38) }).error == 'No wallet exists with that address')
check('own address refused', m.request(1, 'crypto:transfer', { sym = 'ZNC', amount = 1, to = api.Address(1) }).error:find('own wallet') ~= nil)
check('more than balance refused', m.request(1, 'crypto:transfer', { sym = 'ZNC', amount = 100, to = addr2 }).error:find('Not enough') ~= nil)
check('malformed address refused', not m.request(1, 'crypto:transfer', { sym = 'ZNC', amount = 1, to = 'lsx1short' }).ok)
ok = api.Charge(2, 0.4, { memo = 'Bought a burner phone' })
check('CryptoCharge takes coins', ok and near(api.Balance(2, 'ZNC'), 0.6))
check('CryptoCharge refuses more than the balance', not api.Charge(2, 10))

------------------------------------------------------------------------------------------
section('Rate limiting')
------------------------------------------------------------------------------------------
-- (each Mock.boot replaces the FiveM globals, so every environment runs to completion first)
local rl = Mock.boot({ rate = { perSecond = 0, burst = 3 } })
rl.players[1] = { license = 'license:x' }
local n = 0
for _ = 1, 10 do if rl.request(1, 'crypto:state').ok then n = n + 1 end end
check('per-player rate limit', n == 3, n)

------------------------------------------------------------------------------------------
section('QBCore: deposit + cash-out rules')
------------------------------------------------------------------------------------------
local q = Mock.boot({ resources = { ['qb-core'] = 'started' }, config = { cashout = { mode = 'bank', feePercent = 15, dailyLimit = 1000, min = 1 } } })
q.players[1] = { license = 'license:q', citizenid = 'ABC123', bank = 5000 }
check('qb-core detected', q.api.bridge.name == 'qb')
r = q.request(1, 'crypto:deposit', { usd = 2000 })
check('deposit moves bank → exchange cash', r.ok and r.data.state.cash == 2000 and q.players[1].bank == 3000)
check('deposit over bank balance refused', not q.request(1, 'crypto:deposit', { usd = 999999 }).ok)
r = q.request(1, 'crypto:withdraw', { usd = 600 })
check('cash-out: 15 % laundering fee', r.ok and r.data.tx.payout == 510 and q.players[1].bank == 3510 and r.data.state.cash == 1400)
r = q.request(1, 'crypto:withdraw', { usd = 500 })
check('daily limit enforced ($1000/day, $400 left)', not r.ok and r.error:find('400'), r.error)
q.players[1].bankDown = true
r = q.request(1, 'crypto:withdraw', { usd = 100 })
local s2 = q.request(1, 'crypto:state').data
check('bank refuses the payout → wallet refunded, no tx, limit untouched', not r.ok and s2.cash == 1400 and s2.features.withdrawnToday == 600 and s2.txs[1].type == 'withdraw' and s2.txs[1].usd == 600)
q.players[1].bankDown = false
check('wallets are per character (citizenid), not per license', q.kvp['lsx:w:ABC123'] ~= nil)

local qd = Mock.boot({ resources = { qbx_core = 'started' }, config = { cashout = { mode = 'disabled' } } })
qd.players[1] = { license = 'license:z', citizenid = 'QBX1', bank = 100 }
check('qbx_core detected (preferred over qb-core)', qd.api.bridge.name == 'qbx')
check('cash-out mode "disabled" refuses', not qd.request(1, 'crypto:withdraw', { usd = 5 }).ok)
check('…and tells the app', qd.request(1, 'crypto:state').data.features.withdraw == false)

------------------------------------------------------------------------------------------
section('ESX')
------------------------------------------------------------------------------------------
local e = Mock.boot({ resources = { es_extended = 'started' } })
e.players[1] = { license = 'license:e', identifier = 'char1:abc', bank = 800 }
check('es_extended detected', e.api.bridge.name == 'esx')
check('deposit', e.request(1, 'crypto:deposit', { usd = 300 }).ok and e.players[1].bank == 500)
check('withdraw (no fee by default)', e.request(1, 'crypto:withdraw', { usd = 100 }).data.tx.payout == 100 and e.players[1].bank == 600)
check('keyed by ESX identifier', e.kvp['lsx:w:char1:abc'] ~= nil)

------------------------------------------------------------------------------------------
section('Persistence & limits')
------------------------------------------------------------------------------------------
local saved = json.decode(m.kvp['lsx:w:license:aaa'])
local m2 = Mock.boot({ kvp = m.kvp })
m2.players[1] = { license = 'license:aaa' }
check('wallets survive a resource restart (same KVP)', near(m2.api.Balance(1, 'ZNC'), saved.holdings.ZNC.amount, 1e-12) and m2.api.Address(1) == saved.address)
for i = 1, 350 do m2.api.Pay(1, 0.001, { memo = 'spam ' .. i }) end
check('transaction history capped (300)', #m2.request(1, 'crypto:state').data.txs == 300)
check('newest first', m2.request(1, 'crypto:state').data.txs[1].memo == 'spam 350')

local realSet = SetResourceKvp
SetResourceKvp = function() error('disk full') end
local okPay, payErr = m2.api.Pay(1, 1, { memo = 'during outage' })
SetResourceKvp = realSet
check('storage failure: CryptoPay returns nil, err instead of throwing into the job', okPay == nil and payErr == 'wallet unavailable', payErr)
check('…and the payment is not recorded', m2.request(1, 'crypto:state').data.txs[1].memo == 'spam 350')
check('hello reports the network fee for the transfer preview', m2.request(1, 'crypto:hello').data.networkUsd == 0.8)

out(('\n%d passed, %d failed\n'):format(passed, failed))
os.exit(failed == 0 and 0 or 1)
