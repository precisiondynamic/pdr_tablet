# OS ↔ integration protocol

This is the contract between the tablet OS (the web page in `web/os/`) and your Lua
integration (prop, DUI, input, app registry exports). The OS has no FiveM, framework or
gameplay knowledge; everything it knows arrives through these messages.

```
 Lua integration ──SendDuiMessage / SendNUIMessage──▶  OS page   (inbound actions)
 Lua integration ◀──── RegisterNUICallback ────────── OS page   (outbound events)
                                                        │  postMessage
                                                        ▼
                                              app iframes (SDK)  ── see APP-SDK.md
```

The page to load is `nui://pdr_tablet/web/os/index.html`. It scales to any resolution
(designed for 16:10 landscape), so create the DUI at the size of your prop's screen texture.

## Inbound actions

Send JSON objects with an `action` field, e.g.

```lua
SendDuiMessage(duiObj, json.encode({ action = 'os:wake' }))
```

String payloads are parsed automatically, so both `SendDuiMessage` and `SendNUIMessage` work.

### Device

| action | payload | effect |
|---|---|---|
| `os:init` | `{ settings?, apps?, status?, osName?, deviceName?, maxBackgroundApps? }` | One-shot setup after `os:ready`. Every field is optional. |
| `os:wake` | – | Tablet taken out. The first wake of a session runs the boot screen (`bootStyle`: a systemd-style log of the real startup journal, a splash, or nothing), then the lock screen if it's enabled. |
| `os:sleep` | – | Tablet put away. The screen goes black, the foreground app gets `hide`, and it locks if the lock screen is enabled. |
| `os:lock` | – | Show the lock screen. |
| `os:unlock` | – | Dismiss the lock screen (if awake). |
| `os:settings` | `{ settings }` | Replace/patch settings (e.g. loaded from KVP). Does **not** echo `os:settingsChanged`. |
| `os:status` | `{ battery?, charging?, signal?, network? }` | Status-bar indicators. Each one is hidden until you send it; `null` hides it again. `battery` is 0–100, `signal` is 0–4, `network` is a short label. |

### Apps

| action | payload | effect |
|---|---|---|
| `apps:set` | `{ apps: App[] }` | Make the registry match this list (useful after your integration restarts). Running apps that are still listed keep running. |
| `apps:register` | `{ app: App }` | Add, or replace by `id`. If a running app's `url` changes, it's restarted. |
| `apps:update` | `{ id, patch }` | Partial update (label, icon, color, hidden, badge, order…). |
| `apps:unregister` | `{ id }` | Remove it and close it if running. Call this when the owning resource stops. |
| `apps:launch` | `{ id, data? }` | Open an app. If the tablet is locked, it opens after unlock. `data` becomes the app's launch data. |
| `apps:close` | `{ id }` | Close (unload) an app. |
| `apps:home` | – | Go to the home screen. |
| `apps:message` | `{ id, event, data? }` | Deliver to the app page (SDK `message` event). Queued until the app is ready. |
| `apps:badge` | `{ id, count }` | Icon badge. `0` clears it. |
| `notify` | `{ appId?, title, body?, duration? }` | Notification (toast + notification center). With no `appId` it comes from the OS. |

### Input relay (only needed when the OS runs in a DUI)

A DUI has no keyboard natives, so forward keys from your input layer and the OS types them
into whatever has focus, inside the foreground app too:

| action | payload |
|---|---|
| `input:key` | `{ type: 'keydown' \| 'keyup', key, code?, ctrlKey?, shiftKey?, altKey? }` (`key` is a `KeyboardEvent.key` value) |
| `input:text` | `{ text }` (inserts a whole string, e.g. paste) |

Mouse input needs no protocol: use `SendDuiMouseMove / Down / Up / Wheel`. Real mouse events
reach the OS and app iframes natively.

### `App` descriptor

```js
{
  id: 'pdr_criminal',            // required, unique. `system.*` is reserved.
  label: 'Criminal',             // shown under the icon (max 40 chars)
  url: 'https://cfx-nui-pdr_criminal/web/index.html',   // required: page loaded in the app iframe
  icon: 'https://cfx-nui-pdr_criminal/web/icon.png',    // optional: image URL, data:image URI, or an inline '<svg…>' string
  color: '#111827',              // optional: tile background (the default is the accent color)
  order: 100,                    // optional: grid sort, then label
  hidden: false,                 // optional: registered but not shown (e.g. the player lacks access)
  keepAlive: true,               // optional: false = unload the app as soon as it leaves the foreground
  badge: 0                       // optional
}
```

Resolve resource-relative paths to full URLs in Lua before sending
(`('https://cfx-nui-%s/%s'):format(resource, path)`). Apps without an icon get a letter tile.

## Outbound events

The OS POSTs JSON to `https://<resource>/<event>`. `<resource>` is `GetParentResourceName()`,
or the `?resource=` query parameter on the page URL if you set one. Register a callback for
each event you care about. `app:request` is the only one whose response is used.

| event | body | notes |
|---|---|---|
| `os:ready` | `{ version }` | Page loaded. Send `os:init` in response. Also fires after a DUI reload. |
| `os:log` | `{ level, unit, message, uptime }` | Every `warn`/`error` written to the system journal (bad app descriptors, failed requests, script errors…). Print it to the F8 console so problems are visible in-game. |
| `os:awake` / `os:asleep` | `{}` | Echo of wake/sleep. |
| `os:unlocked` | `{}` | The user unlocked. |
| `os:requestClose` | `{}` | The user pressed the power button in the Control Center. Put the tablet away (then send `os:sleep`). |
| `os:settingsChanged` | `{ settings, changed: string[] }` | Persist it (e.g. `SetResourceKvp`) and send it back via `os:init`/`os:settings` next session. |
| `app:lifecycle` | `{ id, state, data? }` | `state` is one of `launched`, `ready`, `foreground`, `background`, `closed`. Route it to the owning resource's hooks. |
| `app:request` | `{ id, action, data }` | From the SDK's `tablet.request()`. **Respond** with `{ ok = true, data = … }` or `{ ok = false, error = '…' }`. Any other value is treated as `data`. |

```lua
RegisterNUICallback('app:request', function(body, cb)
    local handler = appHandlers[body.id]            -- set by your RegisterApp export
    if not handler then return cb({ ok = false, error = 'unknown app' }) end
    local ok, result = pcall(handler, body.action, body.data)
    cb(ok and { ok = true, data = result } or { ok = false, error = tostring(result) })
end)
```

The OS identifies apps by their iframe window and never by anything a page claims, so
`body.id` is always the app the request actually came from. Treat `data` as untrusted
input all the same, and validate anything that matters on the server.

## Lifecycle

```
registered ─▶ launched ─▶ ready ─▶ foreground ⇄ background ─▶ closed
                 │          ▲
                 └ iframe   └ SDK handshake (apps without the SDK still display, they just never become "ready")
```

* Going home, switching apps, sleeping or locking → `background`. Waking/unlocking back into the app → `foreground`.
* With `keepAlive: false` the app is closed right after `background`.
* No more than `maxBackgroundApps` (default 4) apps stay loaded in the background; the least recently used are closed first.
* `closed` fires for user closes (window close button, overview, context menu **Quit**, Settings › Apps), `apps:close`, `apps:unregister`, eviction, and a registration whose `url` changed.
* `apps:set` diffs against what's registered: listed apps are updated in place (running ones keep running), unlisted ones are unregistered.

## Settings object

```js
{
  theme: 'dark' | 'light', accent: '#3584e4',
  wallpaper: 'adwaita' | 'aubergine' | 'arch' | 'mint' | 'plasma' | 'slate' | 'custom', customWallpaper: '',
  brightness: 10..100, nightLight: false, nightLightStrength: 10..100, uiScale: 'small' | 'default' | 'large',
  lockEnabled: true, lockPreviews: true, bootStyle: 'verbose' | 'splash' | 'off',
  dnd: false, clock24h: true, statusDate: true, weekStart: 'monday' | 'sunday',
  dock: ['system.settings'], mutedApps: []
}
```

Settings saved by v1.0 are migrated (`bootAnimation: true/false` becomes `bootStyle: 'verbose'/'off'`).

Unknown keys and invalid values are dropped. The OS also caches settings in the page's
`localStorage`, but treat your KVP copy as the source of truth.

## Minimal integration sketch

```lua
local dui = CreateDui('nui://pdr_tablet/web/os/index.html', 1920, 1200)
-- … runtime txd + AddReplaceTexture on your prop's screen …

local function send(msg) SendDuiMessage(dui, json.encode(msg)) end

RegisterNUICallback('os:ready', function(_, cb)
    send({ action = 'os:init', settings = json.decode(GetResourceKvpString('settings') or '{}'), apps = collectApps() })
    cb({})
end)
RegisterNUICallback('os:settingsChanged', function(body, cb)
    SetResourceKvp('settings', json.encode(body.settings)); cb({})
end)
RegisterNUICallback('os:requestClose', function(_, cb) putAway(); cb({}) end)
RegisterNUICallback('os:log', function(e, cb)
    print(('[pdr_tablet] %s %s: %s'):format(e.level, e.unit, e.message)); cb({})
end)

-- take out / put away
send({ action = 'os:wake' })
send({ action = 'os:sleep' })
```
