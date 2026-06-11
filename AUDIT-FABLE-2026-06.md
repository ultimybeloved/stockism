# Stockism Full Audit — Fable Pass (June 2026)

Scope of this pass: the trade engine and every other code path that moves prices
(executeTrade, limit order fills, the market-open stop-loss sweep, the pre-market
auction). System movers (bot trader, market maker) were reviewed lightly — they
already respect admin price protection and daily caps per the June 2026 work.

Severity: CRITICAL / HIGH / MEDIUM / LOW.

---

## CRITICAL

### C1. validateTrade wipes IP anti-manipulation history — FIXED (one step left)
The old `validateTrade` callable overwrote the ipTracking doc without merge,
destroying `tickerTradeHistory` and `recentTraders` — the data executeTrade uses
for the IP-level 10% daily impact cap and the 2-accounts-per-IP cap. Anyone could
call it before each trade to neuter both protections.
- Status: the function was already deleted from the codebase (its watched-IP logic
  moved into `trackWatchedIpTrade` in watchlist.js, called from executeTrade).
- **Remaining step: the old function is still deployed and callable in production.**
  Run: `firebase functions:delete validateTrade --region us-central1 --force`

## HIGH

### H1. No daily impact cap on sell/cover (trading.js) — FIXED
The 10% daily impact cap (MAX_DAILY_IMPACT) was enforced for buy and short but not
sell or cover. Coordinated dumping (or repeated covers) could move a price without
any daily limit.
- Fix shipped: sells and covers always execute (players must be able to exit), but
  price impact is clamped to the remaining daily allowance — once the cap is hit
  the trade stops moving the price. Uses the same user-level/IP-level max as
  buy/short. The clamped impact flows into trade history, so tracking stays honest.

### H2. Limit order fills and stop-loss sweep bypass impact protections — FIXED
`checkLimitOrders` (limitOrders.js) and the market-open stop-loss sweep
(marketOrders.js) applied full price impact with no MAX_DAILY_IMPACT check and no
new-account impact reduction (`getAccountAgeImpactFactor`). A user past their daily
cap (or a brand-new account) could keep moving prices through limit orders.
- Fix shipped: both fill paths now apply the age factor and clamp impact to the
  user's remaining daily allowance, same approach as H1. Fills still execute.

## MEDIUM

### M1. Limit orders are invisible to IP-level tracking — OPEN
Limit order fills append to the user's own tickerTradeHistory (so the user-level
cap now sees them, after H2) but never to the ipTracking doc, and order creation
has no per-IP checks. An alt ring could route buy pressure through limit orders so
the IP-level daily impact accumulation and per-IP account cap never see it.
- Suggested fix: store the creator's IP on the order doc at creation, append fill
  impact to ipTracking at execution, and enforce the per-IP account cap at creation
  for BUY orders. Needs a design pass (fills run in a scheduler with no request IP,
  and ipTracking writes from the processor add contention) — discuss before building.

### M2. Limit order fills skip trailing effects — OPEN (accepted for now)
executeTrade propagates price moves to related characters/ETFs and records
synthetic history entries so trailing impact can't be farmed. Limit fills update
only the traded ticker. Inconsistent, but the impact clamp (H2) bounds the damage.
Revisit if limit order volume grows.

## LOW

### L1. Dangling "Daily Checkin" comment at end of trading.js — FIXED
Leftover header comment for a function that lives in users.js. Removed.

---

## Reviewed, no findings
- executeTrade input validation (amount bounds/decimals, action whitelist, ticker
  whitelist, halt checks, bankrupt gating, cooldowns, velocity/burst limits)
- Short margin model (100% collateral, equity cap, concentration cap, cooldowns)
- Transaction log capping, NaN guards, maxAttempts:1 phantom-retry protection
- IP-level history read/write in executeTrade (merge: true, prune-on-write)
- Limit order creation validation (ticker/type/shares/price bounds, reserved-share
  accounting, IPO-phase block, 20-order cap)
- Pre-market auction aggregate impact (by design: net-demand based, not per-user)
