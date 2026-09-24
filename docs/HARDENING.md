# Hardening guide

What PDR OS guarantees when things go wrong, the limits it enforces, and what the Lua
integration and app servers must do so it stays that way. Everything under
"The OS guarantees" is covered by `tests/e2e/murder.js` (`tests/run.sh murder`).

## Threat model

| Actor | Can | Trusted for |
|---|---|---|
| The **player** | Open NUI devtools, edit any page, call any NUI callback, trigger any client→server event | nothing |
| An **app page** (another resource's UI) | Anything JavaScript can do inside its iframe | its own UI; never for the OS, other apps, or the server |
| The **integration** (your Lua) | Everything the OS protocol offers | the OS state; still validate what it forwards |
| The **server** | – | the only source of truth for money, items and permissions |

The OS keeps apps from hurting each other or the tablet. It can't stop a player from
lying to *your server*. Validate on the server (see below).

## The OS guarantees

| Failure | Behaviour |
|---|---|
| App registered with `javascript:` / `data:` / `blob:` / `about:` URL, bad id, HTML in the label, `javascript:` icon, CSS in the colour | Rejected or neutralised. Labels are text, icons only load http(s)/nui/data:image, colours must be a colour. |
| More than 200 apps | Further registrations fail with a journal error. |
| Registered → launched → unregistered before it loaded | Nothing is left behind. |
| Same id re-registered with a new URL while running | The app is restarted. |
| An app hammers `request()` | Max 16 in flight per app; up to 64 queue behind; beyond that requests fail fast (`Too many pending requests`). Two apps can't cross wires: routing is by iframe window, not by anything the page claims. |
| Request payload > 256 KB, or not JSON | Rejected before it reaches Lua. |
| The integration never calls `cb()` | The OS answers the app with `Request timed out` after `requestTimeout` (default 30 s) and logs it. |
| App closed / unregistered / its resource stopped mid-request | Queued requests are dropped, late answers are discarded, its notifications are removed. |
| Tablet put away mid-request | The request still completes and the (hidden) app gets the answer. |
| Notification tapped / deep link, in any state (not running, background, foreground, locked, asleep, launched twice before the SDK loaded) | The app gets the data **exactly once**, via `launchData` on a cold start or the `launch` event otherwise. While locked or asleep only the latest launch is kept. |
| Notification data > 4 KB or not JSON | Data dropped with a warning; the notification is still shown. |
| App spams notifications | 10 at once, then one per 2 s per app; at most 3 banners on screen, 50 notifications stored. |
| Background app calls `launch()` (itself or another app) | Blocked and logged: only the app on screen can switch apps, so nothing can steal focus. |
| App throws | The error goes to Settings › System Log and `os:log` (max 10/min per app). The OS is unaffected. |
| App hangs, crashes or navigates away | The heartbeat stops. After `heartbeat.timeout` (15 s) the user gets **“… Is Not Responding”** with Force Quit / Wait. It dismisses itself if the app recovers. The window's home/close buttons and the home bar are OS chrome and always work. |
| App reloads itself | It re-handshakes and keeps working. |
| Garbage protocol messages from an app or the host (fuzzed with 6000 random messages) | Ignored or logged; nothing throws. |
| Storage: over 512 KB, `__proto__` key, non-JSON value | That write fails with a readable error; earlier data is untouched. |
| Corrupt cached app data / settings | Reset to empty/defaults with a warning. No crash. |
| Page's own localStorage full | Logged once; the integration's copy (via `app:storage`) is unaffected. |
| Character switch (`os:session`) | Every app closed, notifications and badges cleared, app data and local caches wiped, settings **replaced** (not merged), tablet locked. Character B can't see character A's data. |
| Tablet put away / locked mid-drag or mid-long-press | Gestures are cancelled, and the stray pointer-up afterwards does nothing. Menus, popovers and dialogs never survive sleep. |
| Text field focused when the field, app or tablet goes away | `input:focus { editable = false }` is sent, so the integration can drop keyboard capture. |
| Lock screen shown | App content is not rendered behind it. |
| Asleep | OS layers aren't painted; apps get `hide` and the kit pauses their animations. |
| 80 theme changes in a burst with apps open | Every app ends on the final theme. |
| 75 launch/close cycles | No frames, listeners or DOM left behind. |
| 150 apps registered in one burst | One render (~30 ms), not 150. |
| Tablet page reloaded (DUI recreated) | `os:ready` fires again; re-send `os:init` (with `appStorage` in host mode) and everything is back. |

## Limits

| Limit | Value | Where |
|---|---|---|
| Registered apps | 200 | `LIMITS.maxApps` in `web/os/js/apps.js` |
| App id | `[A-Za-z0-9][A-Za-z0-9._:-]{0,63}` | apps.js |
| Label | 40 characters | apps.js |
| Requests in flight / queued per app | 16 / 64 | `LIMITS` |
| Request payload | 256 KB JSON | `LIMITS.maxRequestBytes` |
| Request timeout (OS side) | 30 s, `os:init { requestTimeout }` 1–120 s | store.js |
| SDK request timeout (app side) | 15 s default, per call `{ timeout }` | SDK |
| Host → app messages queued before the SDK is ready | 200 (oldest dropped) | `LIMITS` |
| Notifications | burst 10, then 1 per 2 s per app; 50 stored; data ≤ 4 KB | apps.js / notifications.js |
| App errors logged | 10 per minute per app (20 per page load from the SDK) | apps.js / SDK |
| App storage | 512 KB JSON per app; key 1–128 chars | storage.js |
| Heartbeat | ping every 5 s, “not responding” after 15 s; `os:init { heartbeat = { interval, timeout } }` | store.js |
| Background apps kept loaded | 4, `os:init { maxBackgroundApps }` 0–20 | store.js |
| Journal | 500 entries | log.js |

## Integration checklist (Lua)

**Startup and restarts**

- [ ] Don't send anything before `os:ready`, and send `os:init` every time it fires (it fires again after the DUI reloads).
- [ ] On **pdr_tablet** stop: `SetNuiFocus(false, false)`, destroy the DUI, remove the replaced texture, delete the prop, clear the anim.
- [ ] On a **consumer resource** stop: `apps:unregister` its apps (`AddEventHandler('onResourceStop', …)`), and forget its handlers.
- [ ] Consumers re-register when pdr_tablet (re)starts (emit a `pdr_tablet:ready` event for them).

**Focus. Never leave the player stuck.**

- [ ] Release NUI focus on put-away, death, ragdoll, vehicle entry, `os:requestClose`, resource stop, and before any other UI takes focus.
- [ ] Capture the keyboard only while `input:focus { editable = true }`; release it as soon as `editable = false`.
- [ ] Keep one always-working escape: a keybind that puts the tablet away and releases focus, even if the page is hung.

**Callbacks**

- [ ] Every `RegisterNUICallback` calls `cb()` exactly once, on every path, including errors (`pcall` your handler). Otherwise the app waits for the OS timeout.
- [ ] Route `app:request` by `body.id`, which the OS guarantees is the calling app. Answer `{ ok = true, data = … }` / `{ ok = false, error = '…' }`.

**Data and characters**

- [ ] Multi-character servers: `os:init { storageMode = 'host' }` so nothing is cached in the shared browser profile.
- [ ] Persist `app:storage` per character; send it back with `os:init { appStorage }`.
- [ ] Character switch / logout: `os:session { settings, appStorage, deviceName }` with the *new* character's data. Never `os:init` on top of the old one.

**Server**

- [ ] Every client→server event an app uses is attacker-controlled. Validate the shape (`lib/validate.lua`), rate-limit per player (`lib/guard.lua`), check permissions/ownership/amounts against server state, and never take prices, balances or app ids from the client.
- [ ] For LSX, execute trades with `lib/lsx_market.lua` (same prices as the tablet) and `verifyQuote` if you accept a client quote.

**Performance**

- [ ] Create the DUI once and reuse it; `os:sleep` when put away (the OS stops painting).
- [ ] Throttle `os:status` (≤ 1/s) and other periodic messages; don't stream per-frame data.

## Server helpers (`lib/`)

```lua
-- fxmanifest.lua of your app resource
server_scripts { '@pdr_tablet/lib/validate.lua', '@pdr_tablet/lib/guard.lua' }
```

```lua
local V = PDRValidate
local guard = PDRGuard.new({ rate = 4, burst = 10 })   -- per player, per action

local Transfer = V.table({
    sym    = V.enum({ 'LSC', 'VNW', 'MZE' }),
    amount = V.number({ min = 0.00000001, max = 1e6 }),
    to     = V.string({ pattern = '^lsx1[a-z0-9]+$', min = 42, max = 42 }),
})

RegisterNetEvent('pdr_crypto:transfer', function(reqId, data)
    local src = source
    guard:handle(src, 'transfer', data, Transfer, function(t)
        local ok, err = DoTransfer(src, t.sym, t.amount, t.to)   -- your logic, server state only
        if not ok then return nil, err end
        return { state = WalletFor(src) }
    end, function(res) TriggerClientEvent('pdr_crypto:reply', src, reqId, res) end)
end)

AddEventHandler('playerDropped', function() guard:forget(source) end)
```

`guard:handle` rate-limits → size-checks → validates (unknown fields are rejected) → runs your
handler inside `pcall` → always replies. See the comments in `lib/*.lua`.

## Tests

```sh
tests/run.sh                 # everything
tests/run.sh murder          # just the adversarial suite
```

| Suite | What |
|---|---|
| `lua`, `market` | `lib/validate.lua`, `lib/guard.lua`; Lua market engine vs the JS one (bit-for-bit) |
| `os-lifecycle` | lifecycle, security basics, navigation |
| `settings-audit` | every Settings control and the Control Center, with visible effects |
| `apps` | bundled apps and every SDK capability |
| `murder` | everything in the table above |
