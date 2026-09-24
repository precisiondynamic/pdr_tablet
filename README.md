# pdr_tablet

A physical tablet platform for FiveM. This repository currently holds the **tablet OS**, the
UI that renders on the tablet's screen, plus the **SDK** other resources use to put their
apps on it.

The OS looks and behaves like a GNOME / libadwaita tablet: a top bar with Activities,
clock and Control Center, a lock screen, an app grid with search, a dash, an activities
overview, a message tray with calendar, notifications, and a Settings app. It ships with
no gameplay apps.

The **Control Center** (top-right) holds brightness, Do Not Disturb, Dark Style (with an
accent picker), Night Light (with a strength slider), the lock screen toggle, the list of
open apps with quit buttons, and Settings / Lock / Put away. Everything in it writes the
same settings as the Settings app.

It ships with five **reference apps** built only on the public SDK: Messages, Notes,
Calculator, the LSX Crypto exchange, and a developer-only SDK Demo. They make the tablet
usable on its own and exercise every SDK capability; the integration can switch them off.
See [web/apps/README.md](web/apps/README.md).

It keeps a real system journal. The first boot of a session prints it systemd-style
(`[  OK  ] Started App Host.`), Settings › System Log shows it live, and warnings/errors
are sent to the integration as `os:log` so they reach the F8 console. Criminal,
MDT, banking and the like are separate resources that register themselves and show up
automatically.

## Layout

```
web/
  os/             the OS page (load it in the DUI)   → nui://pdr_tablet/web/os/index.html
    css/os.css
    js/           ES modules, no build step
    fonts/        Cantarell + JetBrains Mono (SIL OFL, licenses alongside)
  sdk/
    pdr-tablet.js script that app pages include      → https://cfx-nui-pdr_tablet/web/sdk/pdr-tablet.js
  apps/           bundled reference apps + manifest.json
  dev/            browser dev harness + SDK test page (not listed in fxmanifest, never shipped)
docs/
  PROTOCOL.md     contract between the OS and the Lua integration
  APP-SDK.md      how another resource builds a tablet app
  HARDENING.md    guarantees, limits, integration checklist, server validation
  LSX.md          crypto payouts: exports, cash-out rules, frameworks
lib/              server helpers (Lua 5.4): validate.lua, guard.lua, lsx_market.lua
config/lsx.lua    LSX economy settings
server/crypto/    LSX server: framework bridge, wallet storage, requests + exports
client/crypto.lua LSX client glue (request relay, pushes, notifications)
tests/            run.sh + browser suites (e2e/) + Lua tests (lua/)
```

## Preview in a browser

```sh
python3 -m http.server -d web 8080
# open http://localhost:8080/dev/
```

The harness simulates the integration: wake/sleep/lock, status, registering test apps,
launching, messages, badges and notifications, with a live log of every event the OS emits.
`web/os/index.html` opened on its own also works and wakes itself up.

## Tests

```sh
tests/run.sh           # all suites: Lua libs, market parity, LSX server, OS, settings, apps, adversarial
```

Needs node, lua5.4 (+ lua-cjson for the LSX server suite) and Playwright + Chromium. `tests/e2e/murder.js` is the adversarial suite:
hostile apps, request floods, deep-link races, storage corruption, character switches, stuck
input, restarts and fuzzing. See [docs/HARDENING.md](docs/HARDENING.md).

## Integration

See [docs/PROTOCOL.md](docs/PROTOCOL.md). In short: load the OS page in the DUI, send it
`{ action = ... }` messages, register NUI callbacks for its events, relay mouse through
`SendDuiMouse*` and keys through `input:key`.

## LSX crypto (job payouts)

The bundled LSX app comes with a server economy that works on Qbox, QBCore, ESX, standalone
or a custom framework. Jobs pay with `exports.pdr_tablet:CryptoPay(src, nil, { usd = 450 })`,
and the cash-out ("laundering") rules are in `config/lsx.lua`.
See [docs/LSX.md](docs/LSX.md).

## NETWORK (pdr_criminal's app)

`web/apps/network/` is the player app for pdr_criminal. It ships here but only appears when
pdr_criminal registers it, and none of the criminal gameplay lives in the tablet.
Contract: [web/apps/network/CONTRACT.md](web/apps/network/CONTRACT.md).

## Building apps

See [docs/APP-SDK.md](docs/APP-SDK.md).
