// Economy numbers the site shows and the server enforces: starting cash,
// check-in rewards, order sizes, margin gates, daily limits. Shared rule module
// (see src/rules/ladder.ts for what that means). Each one used to be typed
// twice with a "keep in sync" note.

// Starting cash, and the lower amount before Discord verification (anti-alt).
export const STARTING_CASH = 3000;
export const UNVERIFIED_STARTING_CASH = 1000;
export const BAILOUT_CASH = 1500; // cash granted by a bankruptcy bailout

// Daily check-in streak rewards. Index 0 = day 1; the reward escalates with the
// consecutive-day streak, then caps at the last value.
export const CHECKIN_STREAK_REWARDS = [300, 325, 350, 375, 400, 425, 500];

// How long a precomputed leaderboard/{key} doc (and the server's in-memory
// cache) counts as fresh.
export const LEADERBOARD_CACHE_TTL = 5 * 60 * 1000;

// Pre-market max-buy headroom: the opening ask can sit up to ~5% (auction
// impact cap) + spread above the queue-time price.
export const PRE_MARKET_MAX_BUY_BUFFER = 1.06;

// Event prediction markets: LMSR liquidity (b) and the smallest buy.
export const EVENT_AMM_LIQUIDITY = 5000;
export const EVENT_MIN_BUYIN = 1;

// Market index reads this when every character sits at its base price.
export const INDEX_BASE_VALUE = 1000;
// How many levels a price move travels out through linked stocks.
export const TRAILING_MAX_DEPTH = 3;
export const DUST_MAX_VALUE = 5; // positions worth less than this ($) can be swept as dust

// Order sizing. Entries (buy/short) are whole-cent share counts; exits
// (sell/cover) go much finer so a position can always be closed to the last speck.
export const MIN_TRADE_SHARES = 0.01;
export const MIN_EXIT_SHARES = 0.000001;

// Collateral rate assumed for a short with no stored `margin` (old or repaired
// docs). Pre-v2 shorts really were half-collateral. The risk bars and the
// server's force-cover check must agree, or a player sees a healthy position
// the server is about to liquidate.
export const LEGACY_SHORT_MARGIN_RATIO = 0.5;
export const SHORT_MARGIN_CALL_THRESHOLD = 0.25; // force-cover below 25% equity
export const MAX_SHORTS_BEFORE_COOLDOWN = 3; // shorts on one ticker before the cooldown

// Margin: cash to enable it, the experience gates, and daily interest. The
// gates were client-only until 2026-08-04; enforcing them was safe because all
// three only ever go up, so nobody who qualified once can be locked out.
export const MARGIN_CASH_MINIMUM = 2000;
export const MARGIN_MIN_CHECKINS = 10;
export const MARGIN_MIN_TRADES = 35;
export const MARGIN_MIN_PEAK_PORTFOLIO = 7500;
export const MARGIN_INTEREST_RATE = 0.005; // 0.5% per day

// Max cumulative price move one user can cause on one ticker per rolling 24h,
// PER DIRECTION (sells+shorts down, buys+covers up).
export const MAX_DAILY_IMPACT = 0.1;
export const MAX_TRADES_PER_TICKER_24H = 10; // max trades per action per ticker per rolling 24h

export const IPO_PRICE_JUMP = 0.15; // price jump when an IPO ends
