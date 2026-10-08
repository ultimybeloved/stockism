// Leaderboards and achievements.

// Consecutive days holding an ETF to earn the Dividend Demon achievement.
export const DIVIDEND_DEMON_HOLD_MS = 50 * 24 * 60 * 60 * 1000;

// ============================================
// LEADERBOARD
// ============================================
export const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
// A user counts as "active" if they opened the app or did anything in this
// window.
export const ACTIVE_USER_WINDOW_MS = FOURTEEN_DAYS_MS;
export const ACTIVE_USER_WINDOW_DAYS = Math.round(ACTIVE_USER_WINDOW_MS / (24 * 60 * 60 * 1000));

// transactionLog entry types that count as a trade. Shorts belong here: leaving
// them out undercounted both trade totals and the number of people trading.
export const TRADE_TX_TYPES = new Set(['BUY', 'SELL', 'SHORT_OPEN', 'SHORT_CLOSE']);

// `action` values in the trades collection that count as a player trade. That
// collection also holds dividend payouts and forced margin closes, which are
// not trades anyone placed.
export const TRADE_RECORD_ACTIONS = new Set(['buy', 'sell', 'short', 'cover']);

// ============================================
// ACHIEVEMENTS
// ============================================
// Unifier of Seoul: a character only counts toward the achievement if the user
// holds at least one FULL share. The threshold sits just under 1.0 to tolerate
// floating-point dust from fractional trades (e.g. 0.3333 + 0.6667 landing on
// 0.9999999999999999) while still rejecting any genuine partial holding.
export const UNIFIER_FULL_SHARE_MIN = 0.999999;

// Minimum 7-day-ago portfolio value to appear on the percent-gain leaderboard:
// a $50 account doubling up must not outrank real portfolios with a
// meaningless percentage.
export const LEADERBOARD_PERCENT_MIN_BASELINE = 1000;
