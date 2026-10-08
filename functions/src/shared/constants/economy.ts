// Starting cash, bailouts, check-ins, dividends and other money in and out.

// ============================================
// ECONOMY
// ============================================
export const STARTING_CASH = 3000; // full starting cash once verified (Discord linked)
export const UNVERIFIED_STARTING_CASH = 1000; // starting cash before Discord verification (anti-alt)
export const BAILOUT_CASH = 1500;
export const NAME_CHANGE_COST = 10000; // cash cost to change display name (changeDisplayName)

// Anti-manipulation: cooldown between buy/short on the same ticker by one user.
export const TICKER_COOLDOWN_MS = 10000; // 10 seconds

// Anti-manipulation: executeTrade throttle windows.
export const TRADE_COOLDOWN_MS = 3000; // min gap between any two trades by one user
export const TRADE_HOLD_PERIOD_MS = 45 * 1000; // min hold before a position can be sold/covered
export const MAX_TRADES_PER_TICKER_HOUR = 15; // buy/short velocity cap per ticker per hour
export const TRADE_BURST_LIMIT = 3; // max buys or shorts per ticker per burst window
export const TRADE_BURST_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
// After this many shorts on one ticker inside the rolling window, further
// shorts must wait for the oldest one to age out.
export const MAX_SHORTS_BEFORE_COOLDOWN = 3;
export const SHORT_COOLDOWN_WINDOW_MS = 8 * 60 * 60 * 1000; // 8 hours

// How many times executeTrade's transaction may re-run when it loses a race
// with another trade.
//
// Every trade writes market/current, so two players trading at the same time
// collide even on unrelated tickers. This was 1 (no retry at all) because a
// retry could re-read post-trade state and wrongly reject a trade that had
// actually gone through. That hazard came from assertVelocityLimits running its
// non-transactional queries inside the transaction; it now runs before the
// transaction opens, so re-running the body is safe.
//
// Kept low on purpose: each attempt re-reads the user, market, price-history and
// ipTracking docs, so a high ceiling turns a busy market into a cost and latency
// problem. Raise only alongside a measurement.
export const TRADE_TXN_MAX_ATTEMPTS = 3;

// Daily check-in streak rewards. Index 0 = day 1. The reward escalates with the
// consecutive-day check-in streak, then caps at the last value forever (as long
// as the streak isn't broken). The streak itself is already tracked as
// checkinStreak. Day 1 stays at the old flat $300, so the curve is strictly an
// upgrade for everyone. Keep in sync with src/constants/economy.ts.
export const CHECKIN_STREAK_REWARDS = [300, 325, 350, 375, 400, 425, 500];
export const SHORT_MARGIN_RATIO = 1.0; // 100% collateral — deposit dollar-for-dollar
export const LEADERBOARD_CACHE_TTL = 5 * 60 * 1000; // 5 min — freshness window for the in-memory cache AND the shared leaderboard/{key} doc (keep in sync with LEADERBOARD_DOC_FRESH_MS in src/constants/economy.ts)
