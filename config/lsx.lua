--[[
    LSX (Los Santos Exchange) — server configuration.

    LSX is the tablet's crypto exchange. Other resources pay players in crypto (e.g. illegal
    job payouts) with exports.pdr_tablet:CryptoPay(...); players then trade, hold, transfer
    or cash out inside the LSX app. Wallets live on the server; the tablet only displays them.
]]

LSXConfig = {
    enabled = true,

    -- 'auto' picks the first running of: qbx_core, qb-core, es_extended — else 'standalone'.
    -- 'standalone' keys wallets by license and has no bank (deposit / cash-out unavailable).
    -- 'custom' uses the functions in LSXConfig.custom below.
    framework = 'auto',

    -- 'kvp' (built in, no setup) or 'oxmysql' (needs the oxmysql resource; table is created automatically)
    storage = 'kvp',

    -- coin that CryptoPay() uses when a resource doesn't name one. ZNC is the privacy coin.
    payoutCoin = 'ZNC',

    fees = {
        trade = 0.005,        -- 0.5 % per trade
        minTrade = 0.25,      -- USD minimum fee
        minOrder = 10,        -- USD minimum order
        networkUsd = 0.80,    -- flat network fee for wallet-to-wallet transfers, charged in the coin
    },

    -- clean money → exchange cash (from the framework's bank account)
    deposit = { enabled = true, min = 1, max = 1000000 },

    -- exchange cash → bank ("cashing out"). This is where laundering rules go:
    --   mode        'bank'     cash-out allowed (with the fee / limit below)
    --               'disabled' crypto can never leave LSX as bank money (only via other resources)
    --   feePercent  e.g. 15 = the player receives 85 % in the bank
    --   dailyLimit  USD per character per day, 0 = no limit
    cashout = { mode = 'bank', feePercent = 0, dailyLimit = 0, min = 1 },

    transfers = {
        enabled = true,
        allowUnknownAddress = false,   -- false: sending to an address no player owns is refused
    },

    -- per-player request rate limit for the LSX app
    rate = { perSecond = 4, burst = 12 },

    maxTransactions = 300,     -- history kept per wallet (oldest dropped)
    startingCash = 0,          -- USD on a brand-new wallet
    bankName = nil,            -- label in the app; nil = framework default ('Bank')
    defaultSender = 'Unknown sender',
    debug = false,

    -- framework = 'custom': implement these (src = player server id)
    custom = {
        hasBank = false,                                         -- true once getBank/addBank/removeBank are implemented
        identifier = function(src) return nil end,               -- → unique character id string
        getBank = function(src) return nil end,                  -- → number, or nil if no bank
        addBank = function(src, amount, reason) return false end,
        removeBank = function(src, amount, reason) return false end,
    },
}
