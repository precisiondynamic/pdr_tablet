# NETWORK: app ↔ pdr_criminal contract

NETWORK is the player-facing tablet app for **pdr_criminal**. The files ship with pdr_tablet
(`web/apps/network/`), but the app is **not bundled**: the tablet never shows it on its own.
pdr_criminal registers it for a character once they have access and unregisters it when access
is gone, so players without access never see a locked icon.

The app is a display and control surface. It holds no rules. Contracts, crews, splits,
reputation, X authorizations, phases, intel and payouts are all decided by pdr_criminal. The
app renders what it is sent and asks for player actions. **Gameplay happens in the world.**
The tablet only reports what is known.

## Registering

Send the tablet an `apps:register` (see `docs/PROTOCOL.md`) with:

```lua
{
    id    = 'pdr.network',
    label = 'Network',                                           -- branding is yours
    url   = 'nui://pdr_tablet/web/apps/network/index.html',
    icon  = 'nui://pdr_tablet/web/apps/network/icon.svg',
    order = 60,
}
```

Route the app's requests (`app:request` with `id = 'pdr.network'`) to pdr_criminal. To revoke
access, send `apps:unregister { id = 'pdr.network' }`, which also closes the app if it is open.

`?demo=1` on the URL runs the app against a built-in stand-in world. Only the dev harness uses
it. Without it, a server that doesn't answer shows **NETWORK UNAVAILABLE · RETRY**.

## Requests

All requests arrive as `network:<action>` with a table, or nil. Answer with `State`, the
player's whole current view, or with `{ error = 'message' }` for a refusal. A refusal is
shown to the player as-is, so keep it short and in-world.

| action | data | notes |
|---|---|---|
| `hello` | `{ version = 1 }` | Answer `{ backend = 'network', version = 1, coin = 'ZNC', player = Player }`. 4 s timeout. |
| `state` | – | `State` |
| `seen` | – | The player has looked at the feed. Clear `fresh` flags. |
| `assemble` | `{ contract = id }` | Create a lobby for a feed contract or the X offer. The player becomes lead. |
| `invite` | `{ player = id }` | Lead only. `id` comes from `State.contacts` or is typed by the player (server id / citizen id: your choice). |
| `uninvite` | `{ player = id }` | Lead only. Removes a member or withdraws an invite. |
| `split` | `{ split = { [memberId] = pct } }` | Lead only. Integers, total 100. **Reset every other member to `pending` and bump `lobby.version`.** |
| `confirm` | `{ version = n }` | Confirm the split *as seen*. Refuse if `version` isn't current. |
| `begin` | – | Lead only. Refuse unless every joined member is `confirmed`. |
| `leave` | – | Lead: disband. Member: leave. |
| `accept` / `decline` | `{ invite = id }` | Answer an invitation. |
| `ack` | `{ result = id }` | The player closed the report. Clear `State.result`. |
| `send` | `{ thread = id, text }` | Post to a comms thread (≤ 240 chars). Refuse on a closed crew channel. Relay to the other members. |
| `read` | `{ thread = id }` | The player opened a thread. Set its `unread` to 0. |

Validate everything on the server (`lib/validate.lua` + `lib/guard.lua`). The app enforces
nothing that matters.

## Pushes

Send these with `apps:message { id = 'pdr.network', event = …, data = … }`:

| event | data | effect |
|---|---|---|
| `network:update` | `{ state = State }` | Preferred. Fields that changed update in place and highlight for about a second, and structural changes (a new phase, a tracker appearing) repaint. With no `state`, the app calls `state` itself. |
| `network:signal` | `{ strength = -61 }` | Cheap tracker updates (dBm, −100 … −30). Throttle to a few per second. |
| `network:notice` | `{ text = 'TRACKSUIT CONFIRMED' }` | A short in-app line for when the app is open. |

## Notifications

Use the tablet's `notify` with `appId = 'pdr.network'`. `data` is the deep link:

| data | opens |
|---|---|
| `{ view = 'contracts' }` | Contract feed (or the private offer) |
| `{ contract = id }` | That dossier |
| `{ invite = id }` | Crew, with that invitation highlighted |
| `{ view = 'lobby' }` | The crew lobby |
| `{ view = 'operation' }` | The operation terminal |
| `{ result = id }` | That report |
| `{ thread = id }` | That comms thread |
| `{ view = 'comms' \| 'map' \| 'profile' }` | That screen |

Keep them terse: title `NETWORK` or the codename, body one line ("Target identified.",
"Tracksuit confirmed the split.", "Private offer received."). The app sets its own badge from
`invites`, `result`, `offer` and unread comms.

## State

```lua
State = {
    player   = Player,                 -- { id, handle = 'Manel', tag = 'MNL' }
    coin     = 'ZNC',                  -- all amounts are in this LSX coin
    standing = {
        tier = 'B', points = 1840, from = 1200, next = 2200,     -- progress within the tier
        highest = 'B', xAuth = false,                             -- holds an X authorization
        ladder = { { tier = 'D', state = 'complete' }, { tier = 'C', state = 'complete' },
                   { tier = 'B', state = 'current' }, { tier = 'A', state = 'locked' },
                   { tier = 'X', state = 'none' } },              -- none | available
    },
    services  = { Service, … },        -- the hub: one tile + tab per service (omit → a single generic feed)
    contracts = { Contract, … },       -- what this player's standing lets them see (all services)
    offer     = Contract | nil,        -- X private offer; when set, the feed shows only this
    lobby     = Lobby | nil,
    operation = Operation | nil,
    result    = Result | nil,          -- an unacknowledged report; opening the app shows it
    invites   = { { id, from = Player, contract = Contract, sent = ms }, … },
    history   = { { id, code, tier, outcome = 'complete'|'failed', share, when = ms, role, report = Result }, … },
    stats     = {
        completed, failed, delivered, earned, streak, bestShare,
        earnings    = { { t = ms, v = 12.4 }, … },          -- one per day, oldest first (the app shows 7 and 14 days)
        byClass     = { { k = 'SPORTS', n = 8 }, … },       -- deliveries by vehicle class
        tierHistory = { { t = ms, v = 1840 }, … },          -- standing points over time (30-day chart)
    },
    heat      = { level = 0.0 … 1.0, label = 'LOW'|'ELEVATED'|'HIGH' } | nil,   -- optional; omit to hide the meter
    comms     = { threads = { Thread, … } },
    crews     = { { id, code, tier, when, members = { Player, … } }, … },   -- recent crews
    contacts  = { {                                                           -- crewmates, brokers, fixers
        id, handle, tag, role = 'crew'|'broker'|'fixer', trust = 0 … 100, jobs, earned,
        nearby = true, last = ms|nil, thread = threadId|nil,                  -- thread: MESSAGE button
    }, … },
}

Thread = {
    id, kind = 'broker'|'crew', title = 'BROKER 7Q', contact = Player|nil, unread = 1,
    open = true,                     -- crew channels only: false = read-only history
    messages = { {                   -- oldest first
        id, t = ms, from = Player|nil, text,
        system = true,               -- centred channel notice ("Channel opened.")
        tag = 'TIP',                 -- optional label on the message
        attach = { contract = id },  -- optional: a tappable contract card
    }, … },
}
```

Times are epoch milliseconds (`os.time() * 1000`).

### Service

The hub the player lands on. Each service has its own rating, and opening one shows that
rating, the tiers it unlocks, and the jobs possible right now. The job count is computed from
`contracts`.

```lua
Service = {
    id = 'boosting', name = 'BOOSTING', blurb = 'Vehicle acquisition on request.',
    standing = { tier = 'B', points = 1840, from = 1200, next = 2200, ladder = { … } },   -- same shape as State.standing
    stats = { completed = 4, failed = 1 },                                               -- optional
    locked = false, lockedText = 'ACCESS DENIED · REFERRAL REQUIRED',                    -- locked: shown but not enterable
}
```

`State.standing` is the player's overall NETWORK access. Send any services you like (e.g.
`boosting`, `retrieval`). The app has no built-in list.

### Contract

What the network tells the player, and no more. **Higher tiers should reveal less.**

```lua
Contract = {
    id = 'CN-84F1', code = 'CERBERUS', tier = 'A', fresh = true, service = 'boosting',
    window = 12,                          -- minutes after the operation begins
    crew = { min = 1, max = 4 },
    payout = { amount = 36.4 } | { min = 82, max = 108 },
    fields = { { 'TARGET', 'HIGH VALUE' }, { 'AREA', 'ROCKFORD / UNKNOWN' }, … },   -- the card, in order
    photo = { kind = 'cctv'|'crop'|'silhouette'|'none', shape = 'sports'|'super'|'sedan'|'compact'|'suv'|'van'|'muscle'|'person', cam = 'CAM 11', url = nil },
    area = { name = 'ROCKFORD HILLS', world = { x = -820, y = -160, r = 520 } },    -- world optional; name alone is looked up
    dossier = { client = 'BROKER 2C', target = 'One-line description…', rows = { { 'DELIVERY', 'Vehicle intact' }, … } },
    expires = ms,
    source = 'SOURCE UNKNOWN',            -- X only
    warning = 'Accepting this operation consumes your current X authorization.',   -- asked before assembling
}
```

Every contract surface (card, dossier, lobby, operation header, map zone) is coloured by its
tier: D grey, C green, B blue, A amber, X red.

`photo.url` can point to your own degraded image. Without it, the app draws a CCTV-style
silhouette from `shape`.

### Lobby

```lua
Lobby = {
    id, contract = Contract, role = 'lead'|'support', owner = playerId, max = 4,
    members = { { id, handle, tag, state = 'confirmed'|'pending'|'invited' }, … },
    split = { [memberId] = 40, … }, version = 3, total = 21.6,   -- total = what the split divides
    consumesX = false,       -- lead of an X: "Beginning consumes your X authorization"
}
```

`role = 'support'` shows **CREW SUPPORT**: the player's own X state is untouched and they get
crypto but no progression. The lead sees **YOUR OPERATION**.

### Operation

```lua
Operation = {
    id, contract = Contract, role = 'lead'|'support', started = ms, ends = ms|nil,   -- only real windows
    phase = { n = 2, title = 'SECURITY BYPASS' },
    objective = 'Security bypass required.',            -- what is known, not how to solve it
    intel = { { k = 'TARGET', v = 'Identified', level = 'known' }, { k = 'SECURITY', v = 'Aftermarket immobilizer detected', level = 'alert' }, … },
                                                        -- level: unknown | known | alert | ok
    crew = { { id, handle, tag, online = true }, … },   -- no health bars
    map = { area = 'WEST VINEWOOD', world = { x, y, r }, point = { x, y } | nil, updated = ms },
                                                        -- point only once intel gives one
    log = { { t = ms, text = 'Target identified.' }, … },   -- newest first

    -- instruments; at most one is shown, in this priority: delivery, active tracker, security
    security = { title = 'VEHICLE SECURITY', system = 'ECU HANDSHAKE', hardware = 'OEM IMMOBILIZER' | nil,
                 lines = { { 'CHALLENGE', 'RECEIVED', 'known' }, { 'KEY SEQUENCE', '7A:F4:19:CC', 'known' }, { 'AUTHORIZATION', 'FAILED', 'alert' } },
                 attempt = 2, attempts = 3, scrambled = false },       -- scrambled: X-grade hardware, values won't hold still
    tracker  = { status = 'ACTIVE'|'CLEAR', source = 'VEHICLE', strength = -61, note = 'Locate and disable the transmitting unit.' },
    delivery = { condition = 86, tracking = 'CLEAR', location = 'RECEIVED', distance = 3.8, ends = ms },
}
```

The security surface is display only. Whatever interaction or minigame you run happens in
your resource, and you push the lines it produces.

### Result

```lua
Result = {
    id, outcome = 'complete'|'failed', code, tier, contractId, closed = ms, coin = 'ZNC', role,
    rows = { { 'TARGET CONDITION', '86%' }, { 'DELIVERY', 'COMPLETE' }, { 'CREW', '3' } },
    base = 18.0, adjustment = 3.6, total = 21.6, share = 8.64,      -- one ADJUSTMENT line, never itemised
    rep = { delta = 148, from = 1840, points = 1988, tier = 'B', next = 2200, fromFloor = 1200 },   -- the service's standing
    tx = 'lsx tx id' | nil,          -- from CryptoPay: "ZNC 8.64 RECEIVED" opens it in LSX
    notes = { 'Crew member disconnected. Operation continued.' },
}
```

## Paying out

Pay each member with LSX, and put the returned transaction id in `result.tx`:

```lua
local ok, tx = exports.pdr_tablet:CryptoPay(src, share, { from = 'NETWORK', memo = contractId })
```

The payout shows in LSX as "Payment from NETWORK · CN-84F1", and the report's
"RECEIVED" line deep-links to it. See `docs/LSX.md`.
