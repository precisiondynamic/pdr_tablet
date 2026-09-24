--[[
    LSX client glue. The tablet integration forwards the LSX app's requests here and relays
    server pushes back into the tablet. Wire it up in your NUI callback:

        RegisterNUICallback('app:request', function(body, cb)
            if body.id == 'pdr.crypto' then return PDRCrypto.handleRequest(body.action, body.data, cb) end
            -- … other apps …
        end)

    and forward these two local events to the DUI (see docs/PROTOCOL.md):

        AddEventHandler('pdr_tablet:toApp', function(appId, event, data)
            send({ action = 'apps:message', id = appId, event = event, data = data })
        end)
        AddEventHandler('pdr_tablet:notify', function(n)
            send({ action = 'notify', appId = n.appId, title = n.title, body = n.body, data = n.data })
        end)
]]

PDRCrypto = {}

local TIMEOUT = 10000
local pending, seq = {}, 0

--- Forward one LSX app request to the server. `cb` always runs exactly once.
function PDRCrypto.handleRequest(action, data, cb)
    seq = seq + 1
    local id = seq
    pending[id] = cb
    TriggerServerEvent('pdr_tablet:crypto:request', id, action, data)
    SetTimeout(TIMEOUT, function()
        local waiting = pending[id]
        if waiting then
            pending[id] = nil
            waiting({ ok = false, error = 'The server did not respond' })
        end
    end)
end

RegisterNetEvent('pdr_tablet:crypto:response', function(id, res)
    local cb = pending[id]
    if not cb then return end   -- timed out already
    pending[id] = nil
    cb(type(res) == 'table' and res or { ok = false, error = 'Bad server response' })
end)

-- wallet changed on the server (payment received, trade executed elsewhere…)
RegisterNetEvent('pdr_tablet:crypto:push', function(event, data)
    TriggerEvent('pdr_tablet:toApp', 'pdr.crypto', event, data)
end)

-- tablet notification (e.g. "0.35 ZNC received"); tapping it opens the transaction in LSX
RegisterNetEvent('pdr_tablet:crypto:notify', function(n)
    if type(n) == 'table' then TriggerEvent('pdr_tablet:notify', n) end
end)
