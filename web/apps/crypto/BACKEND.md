# LSX server contract

LSX works out of the box with a **demo account** that lives on the tablet (seeded wallet,
simulated trades, saved with `tablet.storage`). To connect it to your server's economy,
answer these requests in the Lua handler of the resource that owns `pdr.crypto` (the
integration's `app:request` route; see `docs/PROTOCOL.md`).

All requests arrive as `app:request { id = 'pdr.crypto', action, data }`. Respond with
`{ ok = true, data = … }`, or `{ ok = true, data = { error = 'message' } }` for a
user-facing failure (shown as a toast).

## Handshake

| action | data | respond with |
|---|---|---|
| `crypto:hello` | `{ version = 1 }` | `{ backend = 'lsx', version = 1, feeRate = 0.005, minFee = 0.25, minOrder = 10 }` |

If `crypto:hello` doesn't answer with `backend = 'lsx'` within 2.5 s, LSX stays in demo mode.
The fee fields are optional and only drive the preview in the trade ticket; the server's
numbers are what count.

## State

```lua
State = {
    cash = 1250.00,                      -- USD on the exchange
    bank = 48250.00,                     -- the player's bank balance (display only)
    bankName = 'Maze Bank •• 4471',
    address = 'lsx1…',                   -- 42 chars: 'lsx1' + 38 of [a-z0-9]; unique per player
    holdings = { LSC = { amount = 0.13, cost = 9800.00 } },   -- cost = total USD paid (for P&L)
    txs = { Tx, … },                     -- newest first, cap it (LSX shows ~400)
}

Tx = {
    id = 'unique', hash = '0x…64 hex', time = os.time() * 1000, status = 'completed',
    type = 'buy' | 'sell' | 'send' | 'receive' | 'deposit' | 'withdraw',
    sym = 'LSC',        -- not for deposit/withdraw
    amount = 0.01,      -- coins
    price = 74100.0,    -- execution price
    usd = 741.00,       -- notional
    fee = 3.71,         -- USD
    to = 'lsx1…', from = 'lsx1…',   -- transfers
}
```

| action | data | respond with |
|---|---|---|
| `crypto:state` | – | `State` |
| `crypto:trade` | `{ side = 'buy'\|'sell', sym, amount? , usd? }` | `{ tx = Tx, state = State }` |
| `crypto:transfer` | `{ sym, amount, to }` | `{ tx = Tx, state = State }` |
| `crypto:deposit` | `{ usd }` | `{ tx = Tx, state = State }` |
| `crypto:withdraw` | `{ usd }` | `{ tx = Tx, state = State }` |

* **Buys** come either as `amount` (coins) or as `usd` (what to spend, fee included). Size
  `usd` buys at *your* execution price, so "spend everything" never overshoots.
* **Deposit / withdraw** move money between your framework's bank account and `cash`.
* **Transfers** to another player's `address` should credit them with a `receive` tx.
* Never trust `data`: validate every amount server-side.

## Prices

Prices come from `js/market.js`, a pure function of `(symbol, time)`. Every client computes
the same price for the same millisecond, with no network traffic. To execute trades
server-side at the same prices, port `price(sym, t)` to Lua (it's ~40 lines: an integer hash,
value noise and a sum of octaves) or run it with a JS runtime. The coin list (`COINS`), the
octave table and the seeds must match exactly.

The shared accounting in `js/backend.js` (`applyTrade`, `applyTransfer`, `applyCash`) is the reference
behaviour for fees, minimums and cost basis.
