--[[
    LSX framework bridge: who is this player (character id) and what's in their bank.

    Every adapter implements:
        name
        identifier(src)            → character id string, or nil if no character is loaded
        getBank(src)               → number, or nil when the framework has no bank
        addBank(src, amount, why)  → true on success
        removeBank(src, amount, why) → true on success
        hasBank                    → boolean
]]

LSXBridge = {}

local function started(res) return GetResourceState(res) == 'started' end

local function license(src)
    if GetPlayerIdentifierByType then
        local id = GetPlayerIdentifierByType(src, 'license')
        if id then return id end
    end
    for _, id in ipairs(GetPlayerIdentifiers(src) or {}) do
        if id:sub(1, 8) == 'license:' then return id end
    end
    return nil
end

-- QBCore and Qbox share the player object API
local function qbAdapter(name, getPlayer)
    return {
        name = name,
        hasBank = true,
        identifier = function(src)
            local p = getPlayer(src)
            return p and p.PlayerData and p.PlayerData.citizenid or nil
        end,
        getBank = function(src)
            local p = getPlayer(src)
            return p and p.PlayerData and p.PlayerData.money and tonumber(p.PlayerData.money.bank) or nil
        end,
        addBank = function(src, amount, why)
            local p = getPlayer(src)
            return p and p.Functions.AddMoney('bank', amount, why) ~= false or false
        end,
        removeBank = function(src, amount, why)
            local p = getPlayer(src)
            return p and p.Functions.RemoveMoney('bank', amount, why) == true or false
        end,
    }
end

local adapters = {}

adapters.qbx = function()
    return qbAdapter('qbx', function(src) return exports.qbx_core:GetPlayer(src) end)
end

adapters.qb = function()
    local QBCore = exports['qb-core']:GetCoreObject()
    return qbAdapter('qb', function(src) return QBCore.Functions.GetPlayer(src) end)
end

adapters.esx = function()
    local ESX = exports.es_extended:getSharedObject()
    local function x(src) return ESX.GetPlayerFromId(src) end
    return {
        name = 'esx',
        hasBank = true,
        identifier = function(src)
            local p = x(src)
            if not p then return nil end
            return p.identifier or (p.getIdentifier and p.getIdentifier()) or nil
        end,
        getBank = function(src)
            local p = x(src)
            local acc = p and p.getAccount and p.getAccount('bank')
            return acc and tonumber(acc.money) or nil
        end,
        addBank = function(src, amount, why)
            local p = x(src)
            if not p then return false end
            p.addAccountMoney('bank', amount, why)
            return true
        end,
        removeBank = function(src, amount, why)
            local p = x(src)
            if not p then return false end
            local acc = p.getAccount('bank')
            if not acc or (tonumber(acc.money) or 0) < amount then return false end
            p.removeAccountMoney('bank', amount, why)
            return true
        end,
    }
end

adapters.standalone = function()
    return {
        name = 'standalone',
        hasBank = false,
        identifier = license,
        getBank = function() return nil end,
        addBank = function() return false end,
        removeBank = function() return false end,
    }
end

adapters.custom = function()
    local c = LSXConfig.custom or {}
    if type(c.identifier) ~= 'function' then error('LSX: framework = "custom" needs LSXConfig.custom.identifier(src)') end
    return {
        name = 'custom',
        hasBank = c.hasBank == true,
        identifier = c.identifier,
        getBank = c.getBank or function() return nil end,
        addBank = c.addBank or function() return false end,
        removeBank = c.removeBank or function() return false end,
    }
end

--- Pick and build the adapter. Called once when LSX starts.
function LSXBridge.load(choice)
    choice = choice or 'auto'
    if choice == 'auto' then
        if started('qbx_core') then choice = 'qbx'
        elseif started('qb-core') then choice = 'qb'
        elseif started('es_extended') then choice = 'esx'
        else choice = 'standalone' end
    end
    local make = adapters[choice]
    if not make then error(('LSX: unknown framework "%s"'):format(tostring(choice))) end
    local adapter = make()
    LSXBridge.current = adapter
    return adapter
end
