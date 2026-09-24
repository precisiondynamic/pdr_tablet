--[[
    LSX server: authoritative wallets, trading, transfers, cash in/out, and the exports other
    resources use to pay players in crypto.

    Exports (server side):

        exports.pdr_tablet:CryptoPay(target, amount, opts)      → ok, tx | nil, err
            target  player server id (online) or character id string (works offline)
            amount  coin amount; or pass opts.usd to pay a dollar value in the coin at the live price
            opts    { sym = 'ZNC', usd = 250, memo = 'Delivery', from = 'Unknown sender' }
        exports.pdr_tablet:CryptoCharge(target, amount, opts)   → ok, tx | nil, err    (take coins)
        exports.pdr_tablet:CryptoBalance(target, sym)           → number | nil
        exports.pdr_tablet:CryptoWallet(target)                 → wallet summary | nil
        exports.pdr_tablet:CryptoPrice(sym)                     → USD price now
        exports.pdr_tablet:CryptoAddress(target)                → 'lsx1…' | nil

    Server events other resources can listen to:
        'pdr_tablet:crypto:transaction' (owner, tx)             every completed transaction
]]

local C = LSXConfig
if not C or not C.enabled then return end

local V, M = PDRValidate, LSXMarket
local bridge
local guard = PDRGuard.new({ rate = C.rate.perSecond, burst = C.rate.burst, log = function(m) print('^3[LSX]^7 ' .. m) end })
local online = {}          -- owner → src (last seen)

local ADDR_CHARS = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
local SYMS = {}
for _, c in ipairs(M.COINS) do SYMS[#SYMS + 1] = c.sym end

local function dbg(...) if C.debug then print('^5[LSX]^7', ...) end end
local function nowMs() return os.time() * 1000 end
local function round(n, dp) local f = 10 ^ dp; return math.floor(n * f + 0.5) / f end
local function cents(n) return round(n, 2) end
local function hex(n) local t = {}; for i = 1, n do local r = math.random(1, 16); t[i] = ('0123456789abcdef'):sub(r, r) end; return table.concat(t) end
local function today() return os.date('!%Y-%m-%d') end

local function newAddress()
    for _ = 1, 20 do
        local t = { 'lsx1' }
        for i = 2, 39 do local r = math.random(1, #ADDR_CHARS); t[i] = ADDR_CHARS:sub(r, r) end
        local a = table.concat(t)
        if not LSXStore.ownerOf(a) then return a end
    end
    error('LSX: could not allocate a wallet address')
end

local function newWallet()
    return { v = 1, cash = cents(C.startingCash or 0), holdings = {}, address = newAddress(), txs = {}, cashout = { day = today(), usd = 0 } }
end

local function holding(w, sym)
    local h = w.holdings[sym]
    if not h then h = { amount = 0, cost = 0 }; w.holdings[sym] = h end
    return h
end

local function tidy(w, sym)
    local h = w.holdings[sym]
    if h and h.amount < 1e-10 then w.holdings[sym] = nil end
end

local function record(w, owner, tx)
    tx.id = tx.id or ('t' .. tostring(tx.time) .. hex(4))
    tx.hash = tx.hash or ('0x' .. hex(64))
    tx.status = 'completed'
    table.insert(w.txs, 1, tx)
    while #w.txs > (C.maxTransactions or 300) do table.remove(w.txs) end
    TriggerEvent('pdr_tablet:crypto:transaction', owner, tx)
    return tx
end

--- Resolve a target (server id or character id) → owner id, src|nil
local function resolve(target)
    if type(target) == 'number' then
        local owner = bridge.identifier(target)
        if owner then online[owner] = target end
        return owner, owner and target or nil
    elseif type(target) == 'string' and target ~= '' then
        local src = online[target]
        if src and bridge.identifier(src) ~= target then src, online[target] = nil, nil end
        if not src then
            for _, p in ipairs(GetPlayers()) do
                local s = tonumber(p)
                if bridge.identifier(s) == target then src = s; online[target] = s; break end
            end
        end
        return target, src
    end
    return nil
end

--- Tell an online player's tablet that their wallet changed (and optionally notify).
local function push(src, tx, note)
    if not src then return end
    TriggerClientEvent('pdr_tablet:crypto:push', src, 'crypto:update', { tx = tx })
    if note then TriggerClientEvent('pdr_tablet:crypto:notify', src, note) end
end

local function symOk(sym) return type(sym) == 'string' and M.coin(sym) ~= nil end


local function fail(msg) return nil, msg end

--[[ ---------------------------------------------------------------------------------------
    Accounting. Each op validates everything first and only then mutates the wallet.
------------------------------------------------------------------------------------------ ]]

local function fee(notional) return math.max(C.fees.minTrade, notional * C.fees.trade) end

local function opTrade(w, owner, side, sym, amount, usd)
    if not symOk(sym) then return fail('Unknown coin') end
    local t = nowMs()
    local price = M.price(sym, t)
    if side == 'buy' and usd then
        -- tolerate a cent of rounding from the UI, never silently shrink a real order
        if usd > w.cash + 0.01 then return fail('Not enough cash') end
        usd = math.min(usd, w.cash)
        amount = (usd - math.max(C.fees.minTrade, usd * C.fees.trade / (1 + C.fees.trade))) / price
    end
    if not amount or amount <= 0 then return fail('Enter an amount') end
    local notional = amount * price
    if notional < C.fees.minOrder then return fail(('Minimum order is $%d'):format(C.fees.minOrder)) end
    local f = fee(notional)
    local h = holding(w, sym)
    if side == 'buy' then
        if notional + f > w.cash + 1e-9 then tidy(w, sym); return fail('Not enough cash') end
        w.cash = math.max(0, cents(w.cash - notional - f))
        h.amount = h.amount + amount
        h.cost = h.cost + notional + f
    elseif side == 'sell' then
        if amount > h.amount + 1e-12 then tidy(w, sym); return fail(('You only have %s %s'):format(round(h.amount, 8), sym)) end
        amount = math.min(amount, h.amount)
        notional = amount * price
        f = fee(notional)
        h.cost = h.cost - h.cost * (amount / h.amount)
        h.amount = h.amount - amount
        w.cash = cents(w.cash + notional - f)
    else
        return fail('Unknown order side')
    end
    tidy(w, sym)
    return record(w, owner, { type = side, sym = sym, amount = amount, price = price, usd = notional, fee = f, time = t })
end

local function networkFee(sym, t) return C.fees.networkUsd / M.price(sym, t) end

local function credit(w, owner, sym, amount, t, fields)
    local price = M.price(sym, t)
    local h = holding(w, sym)
    h.amount = h.amount + amount
    h.cost = h.cost + amount * price
    local tx = { type = 'receive', sym = sym, amount = amount, price = price, usd = amount * price, fee = 0, time = t }
    for k, v in pairs(fields or {}) do tx[k] = v end
    return record(w, owner, tx)
end

local function debit(w, sym, amount)
    local h = holding(w, sym)
    h.cost = h.cost - h.cost * (amount / h.amount)
    h.amount = h.amount - amount
    tidy(w, sym)
end

--[[ ---------------------------------------------------------------------------------------
    What the app gets
------------------------------------------------------------------------------------------ ]]

local function features(src, w)
    local cash = C.cashout
    if w.cashout.day ~= today() then w.cashout = { day = today(), usd = 0 } end
    return {
        deposit = C.deposit.enabled and bridge.hasBank,
        withdraw = cash.mode == 'bank' and bridge.hasBank,
        withdrawFee = cash.feePercent or 0,
        dailyLimit = cash.dailyLimit or 0,
        withdrawnToday = w.cashout.usd,
        transfers = C.transfers.enabled,
        payoutCoin = C.payoutCoin,
    }
end

local function view(src, w)
    return {
        cash = w.cash,
        bank = bridge.hasBank and (bridge.getBank(src) or 0) or 0,
        bankName = C.bankName or (bridge.hasBank and 'Bank' or 'No bank linked'),
        holdings = w.holdings,
        address = w.address,
        txs = w.txs,
        features = features(src, w),
    }
end

--[[ ---------------------------------------------------------------------------------------
    App requests (via client/crypto.lua)
------------------------------------------------------------------------------------------ ]]

local Num = function(max) return V.number({ min = 0, max = max }) end
local SCHEMAS = {
    ['crypto:hello'] = V.optional(V.table({ version = V.optional(V.number()) }, { extra = true })),
    ['crypto:state'] = nil,
    ['crypto:trade'] = V.table({ side = V.enum({ 'buy', 'sell' }), sym = V.enum(SYMS), amount = V.optional(Num(1e12)), usd = V.optional(Num(1e10)) }),
    ['crypto:transfer'] = V.table({ sym = V.enum(SYMS), amount = Num(1e12), to = V.string({ min = 42, max = 42, pattern = '^lsx1[a-z0-9]+$' }) }),
    ['crypto:deposit'] = V.table({ usd = Num(1e10) }),
    ['crypto:withdraw'] = V.table({ usd = Num(1e10) }),
}

local HANDLERS = {}

HANDLERS['crypto:hello'] = function()
    return { backend = 'lsx', version = 1, feeRate = C.fees.trade, minFee = C.fees.minTrade, minOrder = C.fees.minOrder, networkUsd = C.fees.networkUsd, payoutCoin = C.payoutCoin }
end

HANDLERS['crypto:state'] = function(src, owner)
    return LSXStore.with(owner, newWallet, function(w) return view(src, w) end)
end

HANDLERS['crypto:trade'] = function(src, owner, d)
    return LSXStore.with(owner, newWallet, function(w)
        local tx, err = opTrade(w, owner, d.side, d.sym, d.amount, d.usd)
        if not tx then return nil, err end
        dbg(owner, d.side, tx.amount, d.sym, tx.usd)
        return { tx = tx, state = view(src, w) }
    end)
end

HANDLERS['crypto:transfer'] = function(src, owner, d)
    if not C.transfers.enabled then return nil, 'Transfers are disabled' end
    local to = d.to
    local recipient = LSXStore.ownerOf(to)
    if not recipient and not C.transfers.allowUnknownAddress then return nil, 'No wallet exists with that address' end
    if recipient == owner then return nil, 'You can’t send to your own wallet' end
    local t = nowMs()
    local result, err = LSXStore.with(owner, newWallet, function(w)
        if w.address == to then return nil, 'You can’t send to your own wallet' end
        local h = w.holdings[d.sym]
        local nf = networkFee(d.sym, t)
        if d.amount <= 0 then return nil, 'Enter an amount' end
        if not h or d.amount + nf > h.amount + 1e-12 then return nil, ('Not enough %s (network fee %s %s)'):format(d.sym, round(nf, 8), d.sym) end
        debit(w, d.sym, d.amount + nf)
        local price = M.price(d.sym, t)
        local tx = record(w, owner, { type = 'send', sym = d.sym, amount = d.amount, price = price, usd = d.amount * price, fee = nf * price, feeCoin = nf, to = to, time = t })
        return { tx = tx, state = view(src, w), from = w.address }
    end)
    if not result then return nil, err end
    if recipient then
        local rtx
        local ok, e = pcall(LSXStore.with, recipient, newWallet, function(rw)
            rtx = credit(rw, recipient, d.sym, d.amount, t, { from = result.from })
        end)
        if not ok then
            -- couldn't credit the recipient: give the sender everything back (fee included)
            LSXStore.with(owner, newWallet, function(w)
                local h = holding(w, d.sym)
                local back = d.amount + result.tx.feeCoin
                h.amount = h.amount + back
                h.cost = h.cost + back * result.tx.price
                for i, x in ipairs(w.txs) do if x.id == result.tx.id then table.remove(w.txs, i) break end end
            end)
            print(('^1[LSX]^7 transfer %s → %s failed (%s); sender refunded'):format(owner, recipient, tostring(e)))
            return nil, 'Transfer failed, nothing was sent'
        end
        local _, rsrc = resolve(recipient)
        push(rsrc, rtx, { appId = 'pdr.crypto', title = ('Received %s %s'):format(round(d.amount, 8), d.sym), body = 'From ' .. result.from:sub(1, 12) .. '…', data = { tx = rtx.id } })
    end
    result.from = nil
    return result
end

HANDLERS['crypto:deposit'] = function(src, owner, d)
    if not (C.deposit.enabled and bridge.hasBank) then return nil, 'Deposits are not available' end
    local usd = cents(d.usd)
    if usd < C.deposit.min then return nil, ('Minimum deposit is $%s'):format(C.deposit.min) end
    if usd > C.deposit.max then return nil, ('Maximum deposit is $%s'):format(C.deposit.max) end
    if (bridge.getBank(src) or 0) < usd then return nil, 'Not enough money in the bank' end
    if not bridge.removeBank(src, usd, 'LSX deposit') then return nil, 'The bank declined the transfer' end
    local ok, res = pcall(LSXStore.with, owner, newWallet, function(w)
        w.cash = cents(w.cash + usd)
        local tx = record(w, owner, { type = 'deposit', usd = usd, fee = 0, time = nowMs() })
        return { tx = tx, state = view(src, w) }
    end)
    if not ok then
        bridge.addBank(src, usd, 'LSX deposit refund')
        print(('^1[LSX]^7 deposit for %s failed (%s); refunded to bank'):format(owner, tostring(res)))
        return nil, 'Deposit failed, your money was returned'
    end
    return res
end

HANDLERS['crypto:withdraw'] = function(src, owner, d)
    local cfg = C.cashout
    if cfg.mode ~= 'bank' or not bridge.hasBank then return nil, 'Cashing out to a bank isn’t possible here' end
    local usd = cents(d.usd)
    if usd < (cfg.min or 1) then return nil, ('Minimum is $%s'):format(cfg.min or 1) end
    -- 1) take it off the wallet and save, 2) pay the bank, 3) refund if the bank refused.
    -- Money is never in both places, even if something fails halfway.
    local cut = cents(usd * (cfg.feePercent or 0) / 100)
    local payout = cents(usd - cut)
    local ok, tx, err = pcall(LSXStore.with, owner, newWallet, function(w)
        if usd > w.cash + 1e-9 then return nil, 'Not enough cash on LSX' end
        if w.cashout.day ~= today() then w.cashout = { day = today(), usd = 0 } end
        if (cfg.dailyLimit or 0) > 0 and w.cashout.usd + usd > cfg.dailyLimit then
            return nil, ('Daily cash-out limit is $%s ($%s left today)'):format(cfg.dailyLimit, cents(cfg.dailyLimit - w.cashout.usd))
        end
        w.cash = cents(w.cash - usd)
        w.cashout.usd = cents(w.cashout.usd + usd)
        return record(w, owner, { type = 'withdraw', usd = usd, fee = cut, payout = payout, time = nowMs() })
    end)
    if not tx then return nil, err end

    local okCall, paid = pcall(bridge.addBank, src, payout, 'LSX cash-out')
    if not (okCall and paid) then
        -- the bank refused (or errored): put the money back and drop the transaction
        LSXStore.with(owner, newWallet, function(w)
            w.cash = cents(w.cash + usd)
            w.cashout.usd = math.max(0, cents(w.cashout.usd - usd))
            for i, t in ipairs(w.txs) do if t.id == tx.id then table.remove(w.txs, i) break end end
        end)
        print(('^1[LSX]^7 cash-out of $%s for %s failed at the bank; refunded'):format(payout, owner))
        return nil, 'The bank declined the transfer'
    end
    return LSXStore.with(owner, newWallet, function(w) return { tx = tx, state = view(src, w) } end)
end

RegisterNetEvent('pdr_tablet:crypto:request', function(id, action, data)
    local src = source
    local reply = function(res) TriggerClientEvent('pdr_tablet:crypto:response', src, id, res) end
    if type(action) ~= 'string' or not HANDLERS[action] then return reply({ ok = false, error = 'Unknown request' }) end
    local owner = resolve(src)
    if not owner then return reply({ ok = false, error = 'No character loaded' }) end
    guard:handle(src, action, data, SCHEMAS[action], function(clean)
        return HANDLERS[action](src, owner, clean or {})
    end, reply)
end)

--[[ ---------------------------------------------------------------------------------------
    Exports for other resources
------------------------------------------------------------------------------------------ ]]

local function amountFor(sym, amount, opts)
    if opts and type(opts.usd) == 'number' then
        if opts.usd <= 0 then return nil end
        return opts.usd / M.price(sym, nowMs())
    end
    if type(amount) ~= 'number' or amount ~= amount or amount <= 0 or amount == math.huge then return nil end
    return amount
end

local function Pay(target, amount, opts)
    opts = type(opts) == 'table' and opts or {}
    local sym = opts.sym or C.payoutCoin
    if not symOk(sym) then return nil, 'unknown coin ' .. tostring(sym) end
    local owner, src = resolve(target)
    if not owner then return nil, 'unknown player' end
    local coins = amountFor(sym, amount, opts)
    if not coins then return nil, 'invalid amount' end
    local t = nowMs()
    local from = type(opts.from) == 'string' and opts.from:sub(1, 40) or C.defaultSender
    local memo = type(opts.memo) == 'string' and opts.memo:sub(1, 80) or nil
    local ok, tx = pcall(LSXStore.with, owner, newWallet, function(w)
        return credit(w, owner, sym, round(coins, 10), t, { fromLabel = from, memo = memo, source = GetInvokingResource and GetInvokingResource() or nil })
    end)
    if not ok then
        print(('^1[LSX]^7 CryptoPay to %s failed: %s'):format(owner, tostring(tx)))
        return nil, 'wallet unavailable'
    end
    push(src, tx, {
        appId = 'pdr.crypto',
        title = ('%s %s received'):format(round(coins, 6), sym),
        body = memo and (from .. ' · ' .. memo) or from,
        data = { tx = tx.id },
    })
    return true, tx
end

local function Charge(target, amount, opts)
    opts = type(opts) == 'table' and opts or {}
    local sym = opts.sym or C.payoutCoin
    if not symOk(sym) then return nil, 'unknown coin ' .. tostring(sym) end
    local owner, src = resolve(target)
    if not owner then return nil, 'unknown player' end
    local coins = amountFor(sym, amount, opts)
    if not coins then return nil, 'invalid amount' end
    local t = nowMs()
    local ok, tx, err = pcall(LSXStore.with, owner, newWallet, function(w)
        local h = w.holdings[sym]
        if not h or h.amount + 1e-12 < coins then return nil, 'insufficient ' .. sym end
        debit(w, sym, math.min(coins, h.amount))
        local price = M.price(sym, t)
        return record(w, owner, { type = 'send', sym = sym, amount = coins, price = price, usd = coins * price, fee = 0,
            toLabel = type(opts.to) == 'string' and opts.to:sub(1, 40) or 'Payment', memo = type(opts.memo) == 'string' and opts.memo:sub(1, 80) or nil, time = t })
    end)
    if not ok then
        print(('^1[LSX]^7 CryptoCharge on %s failed: %s'):format(owner, tostring(tx)))
        return nil, 'wallet unavailable'
    end
    if not tx then return nil, err end
    push(src, tx)
    return true, tx
end

local function Balance(target, sym)
    local owner = resolve(target)
    if not owner then return nil end
    local w = LSXStore.peek(owner)
    if not w then return 0 end
    if sym == 'USD' then return w.cash end
    local h = w.holdings[sym or C.payoutCoin]
    return h and h.amount or 0
end

local function Wallet(target)
    local owner = resolve(target)
    if not owner then return nil end
    local w = LSXStore.peek(owner)
    if not w then return nil end
    local t, value = nowMs(), w.cash
    for sym, h in pairs(w.holdings) do value = value + h.amount * M.price(sym, t) end
    return { owner = owner, address = w.address, cash = w.cash, holdings = w.holdings, value = cents(value) }
end

local function Address(target)
    local owner = resolve(target)
    if not owner then return nil end
    return LSXStore.with(owner, newWallet, function(w) return w.address end)
end

exports('CryptoPay', Pay)
exports('CryptoCharge', Charge)
exports('CryptoBalance', Balance)
exports('CryptoWallet', Wallet)
exports('CryptoPrice', function(sym) return M.price(sym or C.payoutCoin, nowMs()) end)
exports('CryptoAddress', Address)

AddEventHandler('playerDropped', function()
    local src = source
    guard:forget(src)
    for owner, s in pairs(online) do if s == src then online[owner] = nil end end
end)

--[[ ---------------------------------------------------------------------------------------
    Start
------------------------------------------------------------------------------------------ ]]

math.randomseed(os.time())
bridge = LSXBridge.load(C.framework)
LSXStore.init(C.storage)
if not symOk(C.payoutCoin) then error(('LSX: payoutCoin "%s" is not a listed coin'):format(tostring(C.payoutCoin))) end
print(('^2[LSX]^7 ready — framework %s, storage %s, payout coin %s, cash-out %s'):format(
    bridge.name, C.storage, C.payoutCoin, (C.cashout.mode == 'bank' and bridge.hasBank) and ('bank, ' .. (C.cashout.feePercent or 0) .. '% fee') or 'disabled'))

-- test hook (plain Lua tests only; never set in FiveM)
if LSX_TEST then LSX_TEST.api = { Pay = Pay, Charge = Charge, Balance = Balance, Wallet = Wallet, Address = Address, handlers = HANDLERS, bridge = bridge } end
