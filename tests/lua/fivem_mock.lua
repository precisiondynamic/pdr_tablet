-- Minimal FiveM server environment for testing LSX in plain Lua 5.4 (needs lua-cjson).
-- boot(opts) loads the LSX server files into a fresh environment and returns the mock.

local cjson = require('cjson')

local Mock = {}

function Mock.boot(opts)
    opts = opts or {}
    local m = {
        kvp = opts.kvp or {},
        resources = opts.resources or {},
        players = {},             -- src → { license, citizenid, identifier, bank }
        client = {},              -- TriggerClientEvent log
        events = {},              -- TriggerEvent log
        handlers = {},
        exports = {},
        resourceExports = {},
        printed = {},
    }

    json = { encode = cjson.encode, decode = function(s) local v = cjson.decode(s); return v end }
    GetResourceKvpString = function(k) return m.kvp[k] end
    SetResourceKvp = function(k, v) m.kvp[k] = v end
    GetResourceState = function(r) return m.resources[r] or 'missing' end
    GetPlayers = function()
        local out = {}
        for src in pairs(m.players) do out[#out + 1] = tostring(src) end
        return out
    end
    GetPlayerIdentifierByType = function(src, kind)
        local p = m.players[src]
        return p and kind == 'license' and p.license or nil
    end
    GetPlayerIdentifiers = function(src)
        local p = m.players[src]
        return p and { p.license } or {}
    end
    GetGameTimer = function() return math.floor(os.clock() * 1000) end
    GetInvokingResource = function() return 'test_job' end
    Wait = nil
    TriggerClientEvent = function(name, src, ...) m.client[#m.client + 1] = { name = name, src = src, args = { ... } } end
    TriggerEvent = function(name, ...) m.events[#m.events + 1] = { name = name, args = { ... } } end
    RegisterNetEvent = function(name, fn) if fn then m.handlers[name] = fn end end
    AddEventHandler = function(name, fn) m.handlers[name] = fn end
    exports = setmetatable({}, {
        __call = function(_, name, fn) m.exports[name] = fn end,
        __index = function(_, res) return m.resourceExports[res] end,
    })
    print = function(...) local t = {}; for i = 1, select('#', ...) do t[#t + 1] = tostring(select(i, ...)) end; m.printed[#m.printed + 1] = table.concat(t, ' ') end

    -- frameworks -------------------------------------------------------------------------
    local function qbPlayer(src)
        local p = m.players[src]
        if not p or not p.citizenid then return nil end
        return {
            PlayerData = { citizenid = p.citizenid, money = { bank = p.bank } },
            Functions = {
                AddMoney = function(kind, amt) if kind ~= 'bank' then return false end; if p.bankDown then return false end; p.bank = p.bank + amt; return true end,
                RemoveMoney = function(kind, amt) if kind ~= 'bank' or p.bank < amt then return false end; p.bank = p.bank - amt; return true end,
            },
        }
    end
    m.resourceExports['qb-core'] = { GetCoreObject = function() return { Functions = { GetPlayer = qbPlayer } } end }
    m.resourceExports['qbx_core'] = { GetPlayer = function(_, src) return qbPlayer(src) end }
    m.resourceExports['es_extended'] = {
        getSharedObject = function()
            return {
                GetPlayerFromId = function(src)
                    local p = m.players[src]
                    if not p or not p.identifier then return nil end
                    return {
                        identifier = p.identifier,
                        getAccount = function(name) return name == 'bank' and { money = p.bank } or nil end,
                        addAccountMoney = function(_, amt) p.bank = p.bank + amt end,
                        removeAccountMoney = function(_, amt) p.bank = p.bank - amt end,
                    }
                end,
            }
        end,
    }

    LSX_TEST = {}
    package.path = './lib/?.lua;' .. package.path
    dofile('lib/validate.lua')
    dofile('lib/guard.lua')
    dofile('lib/lsx_market.lua')
    dofile('config/lsx.lua')
    for k, v in pairs(opts.config or {}) do LSXConfig[k] = v end
    LSXConfig.rate = opts.rate or { perSecond = 1000, burst = 1000 }
    dofile('server/crypto/bridge.lua')
    dofile('server/crypto/store.lua')
    dofile('server/crypto/service.lua')
    m.api = LSX_TEST.api

    --- Simulate the LSX app sending a request from player `src`. Returns the reply table.
    function m.request(src, action, data)
        local before = #m.client
        source = src
        m.handlers['pdr_tablet:crypto:request'](42, action, data)
        for i = #m.client, before + 1, -1 do
            local e = m.client[i]
            if e.name == 'pdr_tablet:crypto:response' and e.src == src then return e.args[2] end
        end
        return nil
    end

    function m.sent(name, src)
        local out = {}
        for _, e in ipairs(m.client) do if e.name == name and (not src or e.src == src) then out[#out + 1] = e end end
        return out
    end

    return m
end

return Mock
