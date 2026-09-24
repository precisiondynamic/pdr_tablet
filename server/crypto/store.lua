--[[
    LSX wallet storage.

      kvp      server-side resource KVP (default, zero setup)
      oxmysql  table `lsx_wallets` (created on start)

    LSXStore.with(owner, fn) runs fn(wallet) with the wallet locked, saves it if fn returns
    without error, and always unlocks. Two operations on the same wallet never interleave, even
    when a storage call yields (oxmysql), so a balance can't be spent twice.
]]

LSXStore = {}

local locks = {}

local kvp = {
    load = function(owner)
        local raw = GetResourceKvpString('lsx:w:' .. owner)
        return raw and json.decode(raw) or nil
    end,
    save = function(owner, wallet)
        SetResourceKvp('lsx:w:' .. owner, json.encode(wallet))
        SetResourceKvp('lsx:a:' .. wallet.address, owner)
    end,
    ownerOf = function(address)
        return GetResourceKvpString('lsx:a:' .. address)
    end,
}

local mysql = {
    init = function()
        exports.oxmysql:query_async([[
            CREATE TABLE IF NOT EXISTS `lsx_wallets` (
                `owner` VARCHAR(80) NOT NULL PRIMARY KEY,
                `address` VARCHAR(64) NOT NULL UNIQUE,
                `data` LONGTEXT NOT NULL,
                `updated` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        ]])
    end,
    load = function(owner)
        local raw = exports.oxmysql:scalar_async('SELECT `data` FROM `lsx_wallets` WHERE `owner` = ?', { owner })
        return raw and json.decode(raw) or nil
    end,
    save = function(owner, wallet)
        exports.oxmysql:query_async(
            'INSERT INTO `lsx_wallets` (`owner`, `address`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            { owner, wallet.address, json.encode(wallet) })
    end,
    ownerOf = function(address)
        return exports.oxmysql:scalar_async('SELECT `owner` FROM `lsx_wallets` WHERE `address` = ?', { address })
    end,
}

local backend = kvp

function LSXStore.init(kind)
    if kind == 'oxmysql' then
        if GetResourceState('oxmysql') ~= 'started' then
            print('^1[LSX] storage = "oxmysql" but oxmysql is not started; using KVP^7')
        else
            backend = mysql
            mysql.init()
        end
    end
end

local function lock(owner)
    while locks[owner] do
        if Wait then Wait(0) else error('LSX: wallet is busy') end
    end
    locks[owner] = true
end

local function unlock(owner) locks[owner] = nil end

--- Load (or nil) without locking. For read-only views.
function LSXStore.peek(owner) return backend.load(owner) end

--- Run fn(wallet) exclusively; `create()` supplies a new wallet when there's none yet.
--- Returns fn's results. The wallet is saved only if fn doesn't error.
function LSXStore.with(owner, create, fn)
    lock(owner)
    local ok, a, b, c = pcall(function()
        local wallet = backend.load(owner)
        if not wallet then wallet = create() end
        local r1, r2, r3 = fn(wallet)
        backend.save(owner, wallet)
        return r1, r2, r3
    end)
    unlock(owner)
    if not ok then error(a, 0) end
    return a, b, c
end

function LSXStore.ownerOf(address) return backend.ownerOf(address) end
