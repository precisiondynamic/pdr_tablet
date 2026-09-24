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

### Storage

```js
await tablet.storage.set('notes', notes);     // any JSON-serialisable value
const notes = await tablet.storage.get('notes');   // null if missing
await tablet.storage.remove('draft');
const keys = await tablet.storage.keys();
await tablet.storage.clear();
```

Every app has its own namespace with a 512 KB quota. Writes are reported to the integration,
which persists them (per character, typically) and restores them when the tablet starts.
Treat storage as the source of truth for anything the user shouldn't lose. Apps can be evicted
from memory at any time while in the background (see Guidelines).

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
tablet.notify({ title: 'Dani', body: 'hey', data: { thread: 'dani' } });
//  ↑ tapping it launches your app with launchData = { thread: 'dani' } (or fires 'launch' if running)
tablet.setBadge(3);                  // icon badge, 0 clears it
tablet.launch('pdr_boosting', { contractId: 12 }); // open another installed app
```

## Reference apps

`web/apps/` contains working apps built only on this SDK. Read them before building your own:

| App | Shows |
|---|---|
| Notes | storage, text input, save-on-hide, restore after eviction, launch data |
| Calculator | a fully self-contained app with no requests |
| Messages | notifications with deep links, badges, background work, host → app events |
| LSX Crypto | a large app: live UI, charts, request contract with a demo fallback |
| SDK Demo | one raw control per SDK call (developer only) |

`web/apps/shared/kit.css` and `kit.js` are the small libadwaita-style kit those apps use.
Copy it if you like; it isn't part of the SDK contract.

## Guidelines

* **Save on `hide`.** A backgrounded app can be evicted without further warning, so flush
  pending writes when you get `hide` and restore from `tablet.storage` on start.
* **Pause work on `hide`.** The app stays loaded in the background (unless it's registered
  with `keepAlive: false`) and can be evicted when too many apps are open.
* **Leave the window chrome to the OS.** Your page sits inside a window with a
  headerbar (your icon and label, a home button and a close button), below the top bar
  and above the home bar. Don't draw your own title bar or close button.
* **Size with relative units.** The DUI resolution is set by the integration, so use
  `rem`/`%`/`vh` rather than fixed pixels.
* **Text input works** with `<input>` and `<textarea>`. Keys are relayed through the SDK when
  the tablet runs in a DUI. `contenteditable` and IME composition are not supported there.
* **Stick to plain web platform features.** Don't rely on `alert()`, `confirm()`, popups or
  top-level navigation. The iframe sandbox blocks them.
