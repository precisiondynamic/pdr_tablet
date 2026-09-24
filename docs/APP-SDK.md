# Building a tablet app

A tablet app is an ordinary web page in **your own resource** (e.g. `pdr_criminal`). The
tablet loads it in a sandboxed iframe and talks to it through a small SDK. Your page has no
access to the OS, and the OS doesn't know what your app does.

## 1. Ship the page

```lua
-- pdr_criminal/fxmanifest.lua
files {
    'web/index.html',
    'web/app.js',
    'web/icon.png',
}
```

## 2. Include the SDK

```html
<script src="https://cfx-nui-pdr_tablet/web/sdk/pdr-tablet.js"></script>
```

It exposes `window.PDRTablet`. It has no dependencies and works with plain JS, React, Vue, etc.

## 3. Register the app

Registration goes through pdr_tablet's Lua exports (provided by the integration layer); it
ends up as the `App` descriptor in [PROTOCOL.md](PROTOCOL.md#app-descriptor). Whether a
player can see your app (job, item, gang…) is decided **by your resource**, using `hidden`
or by registering/unregistering. The tablet enforces no gameplay rules.

## API

```js
const tablet = await PDRTablet.ready();
```

`ready()` resolves once the tablet has initialised your app. Opened outside the tablet (a
normal browser tab while you develop), it resolves right away with `tablet.inTablet === false`.

### Properties

| | |
|---|---|
| `tablet.appId` | Your app id |
| `tablet.launchData` | Data passed when the app was launched (`null` if none) |
| `tablet.settings` | `{ theme: 'dark' \| 'light', accent: '#rrggbb', clock24h: boolean }` |
| `tablet.visible` | Whether the app is on screen right now |
| `tablet.os` | `{ name, version }` |
| `tablet.inTablet` | `false` when the page isn't inside the tablet |

The SDK also sets `data-tablet-theme="dark|light"` on `<html>` and the CSS variable
`--tablet-accent`, so matching the OS look can be pure CSS:

```css
:root { --accent: var(--tablet-accent, #3b82f6); }
[data-tablet-theme="light"] { --bg: #fff; --text: #111; }
```

### Talking to your Lua

```js
const profile = await tablet.request('getProfile', { citizenId });
```

The call goes through the tablet to the `onRequest` handler **of the resource that
registered this app**. It resolves with the handler's return value and rejects with an
`Error` if the handler fails or doesn't answer within 15 s (override that with
`request(action, data, { timeout })`).

Anything server-side is your resource's business: the Lua handler triggers your own server
events or callbacks as usual.

### Events

```js
tablet.on('show', () => startPolling());       // app came on screen
tablet.on('hide', () => stopPolling());        // app left the screen (home, switch, lock, tablet put away)
tablet.on('launch', (data) => openTab(data));  // launched again while already running, with new data
tablet.on('settings', (s) => applyTheme(s));   // theme/accent/clock changed
tablet.on('message', (event, data) => {});     // pushed from Lua (SendAppMessage / apps:message)
tablet.on('message:contractUpdated', (data) => {}); // same, filtered to one event name
```

`on()` returns an unsubscribe function. `once()` and `off()` also exist.

### Actions

```js
tablet.home();                       // go to the home screen (the app keeps running)
tablet.close();                      // close this app
tablet.notify('Job ready', 'Meet at the docks');   // notification from this app
tablet.setBadge(3);                  // icon badge, 0 clears it
tablet.launch('pdr_boosting', { contractId: 12 }); // open another installed app
```

## Guidelines

* **Pause work on `hide`.** The app stays loaded in the background (unless it's registered
  with `keepAlive: false`) and can be evicted when too many apps are open.
* **Leave the frame to the OS.** It already draws the status bar and home bar around your
  page. Your page fills the area between them.
* **Size with relative units.** The DUI resolution is set by the integration, so use
  `rem`/`%`/`vh` rather than fixed pixels.
* **Text input works** with `<input>` and `<textarea>`. Keys are relayed through the SDK when
  the tablet runs in a DUI. `contenteditable` and IME composition are not supported there.
* **Stick to plain web platform features.** Don't rely on `alert()`, `confirm()`, popups or
  top-level navigation. The iframe sandbox blocks them.
