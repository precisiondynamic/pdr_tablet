--[[
    PDR request guard — per-player rate limiting + validation + error isolation for the server
    side of tablet apps. Pure Lua 5.4; uses GetGameTimer() when running inside FiveM.

        local guard = PDRGuard.new({ rate = 4, burst = 10 })    -- 4 requests/s sustained, bursts of 10

        RegisterNetEvent('pdr_crypto:trade', function(reqId, data)
            local src = source
            guard:handle(src, 'trade', data, TradeSchema, function(clean)
                -- only runs if src is under its rate limit and `data` matched the schema;
                -- errors thrown here are caught and logged, never crash the resource
                return Trade(src, clean)
            end, function(response)
                TriggerClientEvent('pdr_crypto:reply', src, reqId, response)   -- { ok = true, data } | { ok = false, error }
            end)
        end)

        AddEventHandler('playerDropped', function() guard:forget(source) end)

    Load with:  server_script '@pdr_tablet/lib/validate.lua'
                server_script '@pdr_tablet/lib/guard.lua'
]]

local Guard = {}
Guard.__index = Guard

local function now()
    if GetGameTimer then return GetGameTimer() end
    return math.floor(os.clock() * 1000)
end

--- opts: rate (tokens per second, default 5), burst (default 10), clock (function → ms, for tests),
---       maxBytes (request size cap, default 64 KB), log (function(msg), default print)
function Guard.new(opts)
    opts = opts or {}
    return setmetatable({
        rate = opts.rate or 5,
        burst = opts.burst or 10,
        clock = opts.clock or now,
        maxBytes = opts.maxBytes or 64 * 1024,
        log = opts.log or function(msg) print('^3[pdr_guard]^7 ' .. msg) end,
        buckets = {},       -- [source .. ':' .. key] = { tokens, at }
        warned = {},
    }, Guard)
end

--- true if `source` may make another `key` request now.
function Guard:take(source, key)
    local id = tostring(source) .. ':' .. tostring(key or '*')
    local t = self.clock()
    local b = self.buckets[id]
    if not b then
        b = { tokens = self.burst, at = t }
        self.buckets[id] = b
    end
    b.tokens = math.min(self.burst, b.tokens + (t - b.at) / 1000 * self.rate)
    b.at = t
    if b.tokens < 1 then
        if not self.warned[id] or t - self.warned[id] > 10000 then
            self.warned[id] = t
            self.log(('player %s is rate limited on "%s"'):format(tostring(source), tostring(key)))
        end
        return false
    end
    b.tokens = b.tokens - 1
    return true
end

--- Drop all state for a player (call from playerDropped).
function Guard:forget(source)
    local prefix = tostring(source) .. ':'
    for id in pairs(self.buckets) do
        if id:sub(1, #prefix) == prefix then self.buckets[id] = nil; self.warned[id] = nil end
    end
end

--- Rate limit → size check → validate → run `fn(clean)` safely → `reply(response)`.
--- `fn` may return a value (sent as data), or nil, error-string to fail.
function Guard:handle(source, key, data, schema, fn, reply)
    reply = reply or function() end
    if not self:take(source, key) then
        return reply({ ok = false, error = 'Slow down' })
    end
    if PDRValidate and PDRValidate.sizeOf(data, self.maxBytes) > self.maxBytes then
        return reply({ ok = false, error = 'Request too large' })
    end
    local clean = data
    if schema then
        local ok, res = PDRValidate.check(schema, data)
        if not ok then return reply({ ok = false, error = 'Invalid request: ' .. res }) end
        clean = res
    end
    local ok, result, err = pcall(fn, clean)
    if not ok then
        self.log(('handler "%s" failed for player %s: %s'):format(tostring(key), tostring(source), tostring(result)))
        return reply({ ok = false, error = 'Server error' })
    end
    if result == nil and err then return reply({ ok = false, error = tostring(err) }) end
    return reply({ ok = true, data = result })
end

PDRGuard = Guard
return Guard
