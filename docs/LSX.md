# LSX: crypto payments for your jobs

LSX (Los Santos Exchange) is the tablet's crypto exchange. Your other resources pay players in
crypto, for example the payout of an illegal job. The money arrives in the **payout coin**
(ZNC by default). From there the player can hold it, trade it for other coins, send it to
another player, or cash it out to the bank, if and how you allow that.

Wallets are **server-side**, one per character. The tablet only displays them. Nothing the
client sends is trusted.

```
job resource ── exports.pdr_tablet:CryptoPay(src, …) ──▶ server/crypto/service.lua ──▶ wallet (KVP / oxmysql)
                                                                 │
                     tablet notification "4.2 ZNC received" ◀────┤ pdr_tablet:crypto:notify
                     LSX app refreshes live                ◀────┘ pdr_tablet:crypto:push
```

## Setup

1. Everything ships in `pdr_tablet`, and `fxmanifest.lua` loads it. Edit `config/lsx.lua`.
2. In your tablet integration (client), route the LSX app's requests and forward the two
   local events to the OS page. See the header of `client/crypto.lua`:

   ```lua
   RegisterNUICallback('app:request', function(body, cb)
       if body.id == 'pdr.crypto' then return PDRCrypto.handleRequest(body.action, body.data, cb) end
       -- … other apps …
   end)

   AddEventHandler('pdr_tablet:toApp', function(appId, event, data)
       send({ action = 'apps:message', id = appId, event = event, data = data })
   end)
   AddEventHandler('pdr_tablet:notify', function(n)
       send({ action = 'notify', appId = n.appId, title = n.title, body = n.body, data = n.data })
   end)
   ```

   (`send` is whatever posts to the DUI/NUI; see `docs/PROTOCOL.md`.)
3. Start the server. The console prints the detected framework, the storage, the payout coin
   and the cash-out mode:
   `[LSX] ready — framework qb, storage kvp, payout coin ZNC, cash-out bank, 15% fee`.

If the server never answers `crypto:hello` (LSX disabled, or requests not routed), the app
falls back to its **demo account**. That account is fake money kept on the tablet, and
nothing in it can reach a bank. The account card says "Demo account" and a live connection
says "Live".

## Paying players

```lua
-- $450 worth of the payout coin at the current price
local ok, tx = exports.pdr_tablet:CryptoPay(src, nil, { usd = 450, memo = 'Package delivered' })

-- an exact coin amount, a specific coin, and a sender label
exports.pdr_tablet:CryptoPay(src, 12.5, { sym = 'DPR', from = 'Tow yard', memo = 'Impound run' })

-- offline characters work too: pass the character id (citizenid / ESX identifier / license)
exports.pdr_tablet:CryptoPay('ABC12345', nil, { usd = 200 })
```

| Export | Returns |
|---|---|
| `CryptoPay(target, amount, opts)` | `true, tx` or `nil, err`. `opts = { sym?, usd?, memo?, from? }` |
| `CryptoCharge(target, amount, opts)` | Takes coins, e.g. for buying from an NPC dealer. `opts = { sym?, usd?, memo?, to? }` |
| `CryptoBalance(target, sym)` | Coin amount, or exchange cash with `sym = 'USD'` |
| `CryptoWallet(target)` | `{ owner, address, cash, holdings, value }` |
| `CryptoPrice(sym)` | USD price right now (the same number the tablet shows) |
| `CryptoAddress(target)` | The player's `lsx1…` address |

`target` is an online player's server id or a character id string. Errors are returned
(`'unknown player'`, `'invalid amount'`, `'unknown coin X'`, `'insufficient ZNC'`,
`'wallet unavailable'`), never thrown into your resource.

When a payment lands, the player gets a tablet notification ("10.38 ZNC received · Unknown
sender · Package delivered"). Tapping it opens that transaction in LSX. If LSX is open, it
refreshes on the spot. The Portfolio shows an **Incoming payments** card for the payout
coin, and Activity has a **Payments** filter.

Every completed transaction also fires a server event, for logs or anti-cheat:

```lua
AddEventHandler('pdr_tablet:crypto:transaction', function(owner, tx) … end)
```

`tx.source` is the resource that called `CryptoPay` / `CryptoCharge`.

## Cash-out ("laundering") rules

These are all in `config/lsx.lua`. Pick what fits your economy:

| Want | Set |
|---|---|
| Crypto can be cashed out freely | `cashout = { mode = 'bank', feePercent = 0 }` |
| Laundering costs something | `cashout.feePercent = 15` (the player receives 85 %) |
| Limit how much is cleaned per day | `cashout.dailyLimit = 5000` (USD per character per UTC day) |
| Crypto never becomes bank money | `cashout.mode = 'disabled'`. Your own resources can still `CryptoCharge` it for goods |
| No clean money into crypto | `deposit.enabled = false` |
| No wallet-to-wallet transfers | `transfers.enabled = false` |
| Different payout coin | `payoutCoin = 'DPR'` (any listed coin) |

The app reads these rules from the server and adapts. Disabled actions disappear, and a
withdrawal shows the fee, what the player receives, and how much of the daily limit is left.
The server enforces the rules either way.

## Frameworks

`framework = 'auto'` detects **Qbox** (`qbx_core`), then **QBCore** (`qb-core`), then **ESX**
(`es_extended`). Without any of them it runs **standalone**: wallets are keyed by license, and
there is no bank, so deposit and cash-out are off.

For anything else, set `framework = 'custom'` and fill in `LSXConfig.custom`:

```lua
custom = {
    hasBank = true,
    identifier = function(src) return exports.my_core:GetCharId(src) end,
    getBank    = function(src) return exports.my_core:GetBank(src) end,
    addBank    = function(src, amount, reason) return exports.my_core:AddBank(src, amount, reason) end,
    removeBank = function(src, amount, reason) return exports.my_core:RemoveBank(src, amount, reason) end,
},
```

`removeBank` must return `true` only when the money was actually taken.

## Storage

`storage = 'kvp'` needs no setup. `storage = 'oxmysql'` stores wallets in `lsx_wallets`, a
table created on start. If oxmysql isn't running, LSX logs a warning and falls back to KVP.

## Safety

* Every wallet operation holds a per-wallet lock, so one balance can't be spent twice even
  when storage yields.
* A cash-out takes the money off the wallet and saves **before** paying the bank. If the
  bank refuses, the wallet is refunded and the daily limit isn't used up. A deposit that fails
  to save is returned to the bank. A transfer whose recipient can't be credited is refunded.
* App requests are shape-validated (unknown fields rejected), size-capped and rate-limited per
  player (`rate` in the config). Prices always come from the server's own clock
  (`lib/lsx_market.lua`, which is bit-identical to the tablet's engine).
* History is capped at `maxTransactions` per wallet.

Tests: `tests/run.sh crypto` runs the Lua suite against a FiveM mock (Qbox, QBCore, ESX,
standalone, custom). `tests/run.sh apps` covers the app side: payouts, deep links, server
features and live pushes.

## Custom backend

To run your own economy instead of `server/crypto/`, set `LSXConfig.enabled = false` and
implement the request contract in `web/apps/crypto/BACKEND.md`.
