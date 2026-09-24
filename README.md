# pdr_tablet

A physical tablet platform for FiveM. This repository currently holds the **tablet OS**, the
UI that renders on the tablet's screen, plus the **SDK** other resources use to put their
apps on it.

The OS is deliberately small: boot, lock screen, home screen, app launcher, dock, app
switcher, quick panel, notifications and Settings. It ships with no gameplay apps. Criminal,
MDT, banking and the like are separate resources that register themselves and show up
automatically.

## Layout

```
web/
  os/             the OS page (load it in the DUI)   → nui://pdr_tablet/web/os/index.html
    css/os.css
    js/           ES modules, no build step
  sdk/
    pdr-tablet.js script that app pages include      → https://cfx-nui-pdr_tablet/web/sdk/pdr-tablet.js
  dev/            browser dev harness + SDK test page (not listed in fxmanifest, never shipped)
docs/
  PROTOCOL.md     contract between the OS and the Lua integration
  APP-SDK.md      how another resource builds a tablet app
```

## Preview in a browser

```sh
python3 -m http.server -d web 8080
# open http://localhost:8080/dev/
```

The harness simulates the integration: wake/sleep/lock, status, registering test apps,
launching, messages, badges and notifications, with a live log of every event the OS emits.
`web/os/index.html` opened on its own also works and wakes itself up.

## Integration

See [docs/PROTOCOL.md](docs/PROTOCOL.md). In short: load the OS page in the DUI, send it
`{ action = ... }` messages, register NUI callbacks for its events, relay mouse through
`SendDuiMouse*` and keys through `input:key`.

## Building apps

See [docs/APP-SDK.md](docs/APP-SDK.md).
