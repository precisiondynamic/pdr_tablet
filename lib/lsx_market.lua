--[[
    LSX market engine — Lua 5.4 port of web/apps/crypto/js/market.js.

    Produces the same price as the tablet for the same (symbol, time in ms), so a server can
    execute and validate LSX trades at exactly the price the player saw. Verified against the
    JavaScript engine by tests/lua/test_market.lua.

        server_script '@pdr_tablet/lib/lsx_market.lua'     → global LSXMarket
        local price = LSXMarket.price('LSC', os.time() * 1000)

    Keep COINS / OCTAVES in sync with market.js (same order, bases, vols and seeds).
]]

local M = {}

local SEC, MIN = 1000, 60 * 1000
local HOUR, DAY = 60 * MIN, 24 * 60 * MIN

M.COINS = {
    { sym = 'LSC',  base = 64200,  vol = 0.9,  supply = 19.64e6, seed = 11 },
    { sym = 'VNW',  base = 3150,   vol = 1.1,  supply = 120.2e6, seed = 23 },
    { sym = 'MZE',  base = 1,      vol = 0,    supply = 83.1e9,  seed = 31, stable = true },
    { sym = 'CHD',  base = 148.2,  vol = 1.35, supply = 441e6,   seed = 47 },
    { sym = 'ZNC',  base = 41.2,   vol = 1.3,  supply = 96.5e6,  seed = 59 },
    { sym = 'DPR',  base = 7.85,   vol = 1.55, supply = 1.02e9,  seed = 71 },
    { sym = 'PLT',  base = 12.4,   vol = 1.5,  supply = 612e6,   seed = 83 },
    { sym = 'SND',  base = 2.18,   vol = 1.85, supply = 3.4e9,   seed = 97 },
    { sym = 'GRV',  base = 0.62,   vol = 2.1,  supply = 8.8e9,   seed = 103 },
    { sym = 'CHOP', base = 0.0834, vol = 2.9,  supply = 420e9,   seed = 131 },
}

local OCTAVES = {
    { 45 * DAY, 0.28 }, { 9 * DAY, 0.15 }, { 2 * DAY, 0.075 }, { 8 * HOUR, 0.04 },
    { 2 * HOUR, 0.02 }, { 25 * MIN, 0.009 }, { 5 * MIN, 0.004 }, { 40 * SEC, 0.0015 },
}

local bySym = {}
for _, c in ipairs(M.COINS) do bySym[c.sym] = c end

-- JavaScript int32 semantics ------------------------------------------------------------
local U32 = 0xFFFFFFFF
local function i32(x)
    x = x & U32
    if x >= 0x80000000 then x = x - 0x100000000 end
    return x
end
local function imul(a, b) return i32(a * b) end          -- Lua integer * wraps mod 2^64: low 32 bits match
local function ushr(x, n) return (x & U32) >> n end        -- x >>> n
local function xor32(a, b) return i32((a & U32) ~ (b & U32)) end

local function hash(seed, i)
    local x = i32(imul(i32(i), 374761393) + imul(i32(seed), 668265263))
    x = imul(xor32(x, ushr(x, 13)), 1274126177)
    x = xor32(x, ushr(x, 16))
    return ((x & U32) / 4294967295) * 2 - 1
end

local function noise(seed, x)
    local i = math.floor(x)
    local f = x - i
    local u = f * f * (3 - 2 * f)
    return hash(seed, i) * (1 - u) + hash(seed, i + 1) * u
end

local function fbm(seed, t)
    local v = 0.0
    for k = 1, #OCTAVES do
        local o = OCTAVES[k]
        v = v + o[2] * noise(seed + (k - 1) * 1013, t / o[1])
    end
    return v
end

--- Price of `sym` at `t` (milliseconds since the epoch). nil for unknown symbols.
function M.price(sym, t)
    local c = bySym[sym]
    if not c then return nil end
    if c.stable then
        return 1 + 0.0015 * noise(c.seed, t / (20 * MIN)) + 0.0005 * noise(c.seed + 7, t / MIN)
    end
    return c.base * math.exp(c.vol * (0.45 * fbm(1, t) + 0.75 * fbm(c.seed, t)))
end

function M.coin(sym) return bySym[sym] end

--- Accept a client-quoted price only if it's what the engine says within `window` ms of now
--- (clock skew between client and server) and `tolerance` relative difference.
function M.verifyQuote(sym, quoted, nowMs, window, tolerance)
    window, tolerance = window or 5000, tolerance or 0.0005
    if type(quoted) ~= 'number' or quoted <= 0 then return false end
    for dt = -window, window, 250 do
        local p = M.price(sym, nowMs + dt)
        if p and math.abs(p - quoted) / p <= tolerance then return true, p end
    end
    return false
end

M.SEC, M.MIN, M.HOUR, M.DAY = SEC, MIN, HOUR, DAY
LSXMarket = M
return M
