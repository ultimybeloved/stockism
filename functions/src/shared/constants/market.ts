// Market mechanics: price impact, spreads, trade sizes, wash rule, circuit breaker, neglect decay, IPOs, chart history.

// ============================================
// MARKET MECHANICS
// ============================================
export {
  BASE_IMPACT,
  BASE_LIQUIDITY,
  MAX_PRICE_CHANGE_PERCENT,
  OVERSIZED_IMPACT_MULTIPLE,
  MAX_TRADE_SHARES,
  MIN_PRICE,
  BID_ASK_SPREAD,
  ETF_BID_ASK_SPREAD,
  NEW_ACCOUNT_IMPACT_PERIOD_DAYS,
  NEW_ACCOUNT_MIN_IMPACT_FACTOR,
} from '../rules/impact';
export const DUST_MAX_VALUE = 5; // positions worth less than this ($) are sweepable dust
// How many levels a trailing move travels out from the stock that was traded.
// Mirror of TRAILING_MAX_DEPTH in src/constants/economy.ts — keep both in sync.
export const TRAILING_MAX_DEPTH = 3;
// Market index reads 1000 when every character sits at its base price.
export const INDEX_BASE_VALUE = 1000;

// Order sizing. Entries (buy/short) are whole-cent share counts. Exits
// (sell/cover) go much finer: dividends, partial fills and ETF math leave
// fractional remainders, and a player must always be able to close a position
// down to the last speck instead of being stuck holding unsellable dust.
export const MIN_TRADE_SHARES = 0.01; // min buy/short size
export const MIN_EXIT_SHARES = 0.000001; // min sell/cover size
export const TRADE_SHARE_DECIMALS = 2; // decimal places allowed on entries
export const EXIT_SHARE_DECIMALS = 6; // decimal places exits are held to (matches MIN_EXIT_SHARES)

// ── Wash rule ────────────────────────────────────────────────────────────────
// You cannot buy back a stock you just pushed down. Real markets have the same
// idea (the IRS wash-sale rule runs 30 days). Here it exists because of the
// $SHNG raid of 2026-09-17/18: three accounts dumped $SHNG inside 21 seconds,
// five shorted it inside a minute, and all five bought it back ~25% cheaper
// the next day. The trade records show the buy-back came ~24h later, not
// minutes, which is exactly why a 6h window never touched it. 48h would have
// had them buying back after the price recovered (~1,930 vs ~1,550).
//
// Replayed over the month before this changed (8,691 trades): 21 of 702 active
// traders ever armed it, and 6 of the 7 whose buys the longer window would have
// blocked were in coordinated clusters.
//
// Keyed off price impact rather than share count or dollar value, so it scales
// with the stock instead of needing a threshold per ticker, and so someone
// selling a large position in a deep stock is not caught for a move they did
// not cause. Shorts count too: pushing a price down to buy the dip is the same
// trade whichever way you did the pushing.
export const WASH_RULE_IMPACT_TRIGGER = 0.04; // 4% of down-impact in 24h arms it
export const WASH_RULE_COOLDOWN_MS = 48 * 60 * 60 * 1000; // no buying it back for 48h
// The other half of the raid: sell hard, then short the crash you just caused.
// Armed only by a heavy SELL (lastHeavyExit), not a short, so someone running a
// short is never stopped adding to it by this. Same 48h.
export const SHORT_AFTER_DUMP_COOLDOWN_MS = 48 * 60 * 60 * 1000;

// ── Circuit breaker ──────────────────────────────────────────────────────────
// A stock that moves this far this fast pauses for a few minutes. The caps are
// per USER, so a group can stack their allowances and walk a stock down far
// faster than any one of them could: on 2026-09-17 six accounts took $SHNG down
// 23% in 21 minutes, each one individually inside every limit. This is the only
// rule that looks at the stock rather than the trader.
//
// An earlier version of this was removed on 2026-04-30 for being unbearable:
// it measured over an HOUR, halted for THIRTY minutes, and ran on a 5-minute
// scheduler so it fired long after the move was over. The numbers below are
// deliberately the opposite — a short window, a short pause, and evaluated
// inline on the trade that breaches it, so it lands while the cascade is
// happening instead of afterwards.
export const CIRCUIT_BREAKER_MOVE = 0.1; // 10% move...
export const CIRCUIT_BREAKER_WINDOW_MS = 5 * 60 * 1000; // ...within 5 minutes...
export const CIRCUIT_BREAKER_PAUSE_MS = 3 * 60 * 1000; // ...pauses the ticker 3 min
// A pause is itself a tool: trigger one deliberately and you freeze a stock
// while you act elsewhere. Three minutes makes that nearly worthless and this
// cap stops it being repeatable.
export const CIRCUIT_BREAKER_MAX_PER_DAY = 2;

// Anti-manipulation: per-user, per-ticker, per-day limits
// Max cumulative price move one user (or one IP) can cause on one ticker per
// rolling 24h, PER DIRECTION: sells+shorts spend the down allowance, buys+
// covers spend the up one. See sumDirectionalImpact in helpers.js for why the
// two are separate.
export const MAX_DAILY_IMPACT = 0.1;
export const MAX_TRADES_PER_TICKER_24H = 10; // Max buys or sells per ticker per rolling 24h

// How many limit orders on the same ticker one sweep may fill. Anything over
// the cap waits for the next 15-minute sweep, so a cluster of orders at the same
// price can't walk the price in a single run.
export const ORDERS_PER_TICKER_PER_CYCLE = 3;

// Admin price protection: after an admin manually sets a price, automated
// price movers (bot trader, market maker) leave that ticker alone for this
// long so they can't claw the adjustment back. Resets each time admin re-sets.
export const ADMIN_PRICE_PROTECTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── Ticker rename migration ──────────────────────────────────────────────────
// A rename walks every player document and several collections, which cannot be
// one transaction, so it runs as journalled phases that pause and resume.
//
// The budget sits under the 540s function timeout with room to write the
// journal and return. Batch size is under Firestore's 500-op cap on purpose,
// leaving headroom for the delete that pairs with every move.
// ── Neglect decay ────────────────────────────────────────────────────────────
// A stock no real player has traded in this long starts drifting down. Bots do
// not count: bot churn is not interest, and counting it would keep every stock
// alive forever.
export const NEGLECT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

// Compounding daily. At 1% a day a neglected stock loses about a quarter of its
// value in a month, which reads as a slide rather than a crash.
export const NEGLECT_DECAY_DAILY_RATE = 0.01;

// The floor is a fraction of basePrice, drawn from this band per character (see
// neglectFloorFraction). A FIXED fraction would be public the first time anyone
// noticed two dead stocks stopping at the same percentage, and every floor on
// the board would be known.
export const NEGLECT_FLOOR_MIN = 0.3;
export const NEGLECT_FLOOR_MAX = 0.75;

// Open short interest pauses the decay: a stock somebody is short is not
// neglected, and this is what stops a short seller farming a guaranteed decline.
// The threshold is not 1 share, because that would let anyone freeze a stock's
// decay for the price of a single share to protect a big holding.
export const NEGLECT_SHORT_INTEREST_THRESHOLD = 25; // shares

// Short interest is recomputed by the 30-minute margin scanner. If that has not
// run recently the number cannot be trusted, and decaying on a stale "nobody is
// short" reading is exactly the hole the pause exists to close, so decay skips
// its run instead.
export const SHORT_INTEREST_MAX_AGE_MS = 3 * 60 * 60 * 1000; // 3 hours

// ============================================
// IPO
// ============================================
export const IPO_PRICE_JUMP = 0.15; // 15% price bump when IPO fully subscribed
// IPO-bought shares are locked from selling until ipoEndsAt + this buffer, so the
// guaranteed +15% launch pop can't be flipped for a risk-free profit. Measured
// from ipoEndsAt because shares already can't trade before launch: a last-second
// buyer (who triggers an early sellout) still has to hold through the float window,
// and an early buyer holds through the IPO they opted into.
export const IPO_SELL_LOCKUP_MS = 24 * 60 * 60 * 1000; // 24 hours
// Shares bought with margin are locked from re-selling this long, so borrowed
// money can't be used to spike a stock and bail before the price reverts.
export const MARGIN_SELL_LOCKUP_MS = 36 * 60 * 60 * 1000; // 36 hours

// Max LIVE price-history points kept per ticker in market/priceHistory. The
// limit that matters is Firestore's ~40k index entries PER DOCUMENT, shared by
// all ~150 tickers: at ~20k total points the doc rejected every append and
// trades failed ("too many index entries", 2026-07-22 incident). 60/ticker
// bounds the doc to ~9k points worst case. Older points are ARCHIVED (moved,
// never deleted) to market/current/price_history/{ticker}; charts merge the
// archive back in, so trimming costs nothing visible.
export const PRICE_HISTORY_LIVE_MAX = 60;
