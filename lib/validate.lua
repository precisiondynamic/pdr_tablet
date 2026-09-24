--[[
    PDR request validation — pure Lua 5.4, no framework, no natives.

    Everything that reaches your server from a tablet app is player-controlled input: NUI can be
    inspected and edited on the client. Validate the *shape* of every request before acting on it.

        local V = PDRValidate
        local TradeSchema = V.table({
            side   = V.enum({ 'buy', 'sell' }),
            sym    = V.string({ pattern = '^[A-Z]+$', max = 8 }),
            amount = V.optional(V.number({ min = 0, max = 1e9, finite = true })),
            usd    = V.optional(V.number({ min = 0, max = 1e9, finite = true })),
        })

        local ok, err = V.check(TradeSchema, data)      -- ok == true, or false + 'amount: must be ≤ 1000000000'

    Unknown fields are rejected by default (`V.table(fields, { extra = true })` to allow them),
    so a client can't smuggle in values your handler later reads by accident.

    Load it with:  shared_script '@pdr_tablet/lib/validate.lua'   → global PDRValidate
]]

local V = {}

local function fail(path, msg)
    return false, (path ~= '' and (path .. ': ') or '') .. msg
end

local function isFinite(n) return n == n and n ~= math.huge and n ~= -math.huge end

--- Strings. opts: min, max (UTF-8 bytes, default 256), pattern (Lua pattern), trim.
function V.string(opts)
    opts = opts or {}
    local max = opts.max or 256
    return function(v, path)
        if type(v) ~= 'string' then return fail(path, 'must be a string') end
        if opts.trim then v = v:match('^%s*(.-)%s*$') end
        if #v < (opts.min or 0) then return fail(path, ('must be at least %d characters'):format(opts.min)) end
        if #v > max then return fail(path, ('must be at most %d characters'):format(max)) end
        if opts.pattern and not v:find(opts.pattern) then return fail(path, 'has an invalid format') end
        return true, v
    end
end

--- Numbers. opts: min, max, integer, finite (default true).
function V.number(opts)
    opts = opts or {}
    return function(v, path)
        if type(v) ~= 'number' then return fail(path, 'must be a number') end
        if opts.finite ~= false and not isFinite(v) then return fail(path, 'must be a finite number') end
        if opts.integer and math.type(v) ~= 'integer' and v ~= math.floor(v) then return fail(path, 'must be a whole number') end
        if opts.min and v < opts.min then return fail(path, ('must be ≥ %s'):format(opts.min)) end
        if opts.max and v > opts.max then return fail(path, ('must be ≤ %s'):format(opts.max)) end
        return true, v
    end
end

function V.boolean()
    return function(v, path)
        if type(v) ~= 'boolean' then return fail(path, 'must be true or false') end
        return true, v
    end
end

--- One of a fixed list of values.
function V.enum(values)
    local set = {}
    for _, x in ipairs(values) do set[x] = true end
    return function(v, path)
        if not set[v] then return fail(path, 'must be one of: ' .. table.concat(values, ', ')) end
        return true, v
    end
end

--- nil (or JSON null) allowed; otherwise must match `schema`.
function V.optional(schema)
    return function(v, path)
        if v == nil then return true, nil end
        return schema(v, path)
    end
end

--- Arrays (sequential tables). opts: of (schema), min, max (default 100).
function V.array(opts)
    opts = opts or {}
    local max = opts.max or 100
    return function(v, path)
        if type(v) ~= 'table' then return fail(path, 'must be a list') end
        local n = #v
        for k in pairs(v) do
            if math.type(k) ~= 'integer' or k < 1 or k > n then return fail(path, 'must be a list') end
        end
        if n < (opts.min or 0) then return fail(path, ('needs at least %d items'):format(opts.min)) end
        if n > max then return fail(path, ('allows at most %d items'):format(max)) end
        local out = {}
        for i = 1, n do
            local ok, res = true, v[i]
            if opts.of then ok, res = opts.of(v[i], ('%s[%d]'):format(path, i)) end
            if not ok then return false, res end
            out[i] = res
        end
        return true, out
    end
end

--- Objects with known fields. opts: extra = true to allow (and drop) unknown fields.
function V.table(fields, opts)
    opts = opts or {}
    return function(v, path)
        if type(v) ~= 'table' then return fail(path, 'must be an object') end
        for k in pairs(v) do
            if type(k) ~= 'string' then return fail(path, 'must be an object') end
            if not fields[k] and not opts.extra then return fail(path, ('unexpected field "%s"'):format(k)) end
        end
        local out = {}
        for name, schema in pairs(fields) do
            local ok, res = schema(v[name], path == '' and name or (path .. '.' .. name))
            if not ok then return false, res end
            out[name] = res
        end
        return true, out
    end
end

--- Validate. Returns true + the cleaned value, or false + a readable error.
function V.check(schema, value)
    return schema(value, '')
end

--- Rough size guard for anything you store or relay (counts string bytes and table entries).
function V.sizeOf(v, limit, seen)
    seen = seen or {}
    local t = type(v)
    if t == 'string' then return #v end
    if t ~= 'table' then return 8 end
    if seen[v] then return math.huge end   -- cycles never come from JSON; refuse them
    seen[v] = true
    local total = 2
    for k, x in pairs(v) do
        total = total + V.sizeOf(k, limit, seen) + V.sizeOf(x, limit, seen)
        if limit and total > limit then return total end
    end
    return total
end

PDRValidate = V
return V
