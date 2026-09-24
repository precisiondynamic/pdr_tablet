# Bundled reference apps

These ship with the tablet so it works on its own, and so every SDK capability has a real
app exercising it. They use **only** the public SDK (`web/sdk/pdr-tablet.js`): no private OS
hooks. Any of them could be moved into its own resource by changing the SDK `<script>` path
to `https://cfx-nui-pdr_tablet/web/sdk/pdr-tablet.js` and registering it from Lua.

They're listed in `manifest.json` and registered by the OS at startup. Turn them off in-game
with `os:init { bundledApps = false }`.

| App | id | What it's for | SDK surface it tests |
|---|---|---|---|
| **Messages** | `pdr.messages` | Demo conversations (fictional contacts), replies, simulated incoming texts | `notify` with deep-link `data`, `setBadge`, work while hidden, `on('message:incoming')` from the host, `storage` |
| **Notes** | `pdr.notes` | Create / edit / pin / search / delete notes | `storage`, text input (keys relayed in a DUI), flush on `hide`, restore after eviction, `launchData` (`{ note }` or `{ create, title, body }`) |
| **Calculator** | `pdr.calculator` | Basic calculator with history and keyboard input | nothing but `ready()` for the theme: a fully self-contained app |
| **LSX Crypto** | `pdr.crypto` | Crypto exchange: markets, charts, trading, wallet, alerts | large live UI, `request` with a demo fallback, alerts as notifications with deep links, `storage`, `setBadge` |
| **SDK Demo** | `pdr.sdkdemo` | Developer tool, deliberately ugly: one raw control per SDK call | everything, incl. error paths (quota, bad keys, timeouts, 50 parallel requests) |

## Shipped but not bundled: NETWORK

`network/` is the player app for **pdr_criminal** (contracts, crews, operations). Its files ship
with the tablet so every PDR resource shares one app, but it is **not** in `manifest.json`: the
tablet never shows it by itself. pdr_criminal registers it once a character has access and
unregisters it when access is revoked. The tablet works the same with or without it. See
[`network/CONTRACT.md`](network/CONTRACT.md). The dev harness has a "NETWORK" section that
registers it with `?demo=1` and drives an operation step by step.

The SDK Demo is marked `"dev": true`: it appears in the browser harness automatically and
in-game only with `os:init { devApps = true }`.

## Host hooks

```lua
-- push a text into Messages (e.g. from a phone/SMS resource)
SendDuiMessage(dui, json.encode({ action = 'apps:message', id = 'pdr.messages',
    event = 'incoming', data = { from = 'Dani Okafor', text = 'where are you?' } }))

-- open Notes on a new note
SendDuiMessage(dui, json.encode({ action = 'apps:launch', id = 'pdr.notes',
    data = { create = true, title = 'Evidence', body = '...' } }))

-- open LSX on a coin
SendDuiMessage(dui, json.encode({ action = 'apps:launch', id = 'pdr.crypto', data = { coin = 'LSC' } }))
```

LSX runs a **demo account** on the tablet unless the integration answers its requests.
See [`crypto/BACKEND.md`](crypto/BACKEND.md) for the server contract.

## Layout

```
apps/
├─ manifest.json          bundled app list
├─ shared/                app kit (libadwaita look), embedded fonts — optional for your own apps
├─ messages/ notes/ calculator/ sdk-demo/
└─ crypto/
   ├─ js/market.js        deterministic price engine (same prices on every client)
   ├─ js/backend.js       demo wallet + live backend over tablet.request
   ├─ js/charts.js        SVG price chart / candles / sparklines / donut
   ├─ js/format.js
   ├─ js/app.js           views
   └─ BACKEND.md
```
