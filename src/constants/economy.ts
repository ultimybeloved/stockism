// ============================================
// ECONOMY CONSTANTS
// ============================================

// General
export const ITEMS_PER_PAGE = 15;
// Numbers the server enforces too live in the shared rule module.
export {
  STARTING_CASH,
  UNVERIFIED_STARTING_CASH,
  BAILOUT_CASH,
  CHECKIN_STREAK_REWARDS,
  PRE_MARKET_MAX_BUY_BUFFER,
  EVENT_AMM_LIQUIDITY,
  EVENT_MIN_BUYIN,
  INDEX_BASE_VALUE,
  TRAILING_MAX_DEPTH,
  DUST_MAX_VALUE,
  MIN_TRADE_SHARES,
  MIN_EXIT_SHARES,
  LEGACY_SHORT_MARGIN_RATIO,
  SHORT_MARGIN_CALL_THRESHOLD,
  MAX_SHORTS_BEFORE_COOLDOWN,
  MARGIN_CASH_MINIMUM,
  MARGIN_MIN_CHECKINS,
  MARGIN_MIN_TRADES,
  MARGIN_MIN_PEAK_PORTFOLIO,
  MARGIN_INTEREST_RATE,
  MAX_TRADES_PER_TICKER_24H,
  IPO_PRICE_JUMP,
} from '../rules/economy';
export const PORTFOLIO_SYNC_MIN_INTERVAL_MS = 5 * 60 * 1000; // floor between passive syncPortfolio calls (backend cost control)
export { LEADERBOARD_CACHE_TTL as LEADERBOARD_DOC_FRESH_MS } from '../rules/economy'; // how long a precomputed leaderboard/{key} doc counts as fresh
export const DAILY_BONUS = 300;
export const PRICE_UPDATE_INTERVAL = 5000; // 5 seconds
export const HISTORY_RECORD_INTERVAL = 60000; // 1 minute

// IPO System Constants
export const IPO_HYPE_DURATION = 24 * 60 * 60 * 1000; // 24 hours hype phase
export const IPO_WINDOW_DURATION = 24 * 60 * 60 * 1000; // 24 hours IPO window
export const IPO_TOTAL_SHARES = 150; // Total shares available in IPO
export const IPO_MAX_PER_USER = 10; // Max shares per user during IPO

export const MS_PER_HOUR = 60 * 60 * 1000;
// Announce-before-open delay presets (hours) offered when creating a long-term market. 0 = open immediately.
export const EVENT_OPEN_DELAY_PRESETS_HOURS = [0, 1, 6, 12, 24];
// Admin-set opening odds: each outcome's opening percentage must stay inside
// this band (extremes make shares near-worthless or the house loss explode).
export const EVENT_OPENING_ODDS_MIN_PCT = 1;
export const EVENT_OPENING_ODDS_MAX_PCT = 99;
// Weekly prediction house seed: the admin's total is split evenly across the
// options' pools at creation. The house is just another bettor, so the losing
// options' seed goes to the winners and the winning option's seed share is never
// claimed. Max house cost per prediction = the seed. Cap catches typos.
export const WEEKLY_PREDICTION_SEED_MAX = 100000;

// Economy balancing constants - Realistic Market Model
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

// Shorting constants (realistic NYSE-style)
export const SHORT_MARGIN_REQUIREMENT = 1.0; // 100% margin required (dollar-for-dollar collateral)
export const SHORT_MARGIN_WARNING_THRESHOLD = 0.35; // Show a force-cover warning once equity dips below 35%
export const SHORT_RATE_LIMIT_HOURS = 8; // 8-hour cooldown after 3rd short on same ticker

// ============================================
// MARGIN TRADING SYSTEM
// ============================================

export const MARGIN_TIERS = [
  { minPeak: 0, maxPeak: 7500, multiplier: 0.25 },
  { minPeak: 7500, maxPeak: 15000, multiplier: 0.35 },
  { minPeak: 15000, maxPeak: 30000, multiplier: 0.5 },
  { minPeak: 30000, maxPeak: Infinity, multiplier: 0.75 },
];
export const MARGIN_WARNING_THRESHOLD = 0.65; // Display warning at 65% equity ratio
export const MARGIN_DANGER_THRESHOLD = 0.4; // Display danger zone at 40% equity ratio
export const MARGIN_CALL_THRESHOLD = 0.3; // Matches backend threshold — actual margin call fires here
export const MARGIN_LIQUIDATION_THRESHOLD = 0.25; // Matches backend threshold — liquidation fires here
export const MARGIN_MAINTENANCE_RATIO = 0.3; // 30% maintenance requirement for all positions

// Anti-manipulation protections

export { MAX_DAILY_IMPACT as MAX_DAILY_IMPACT_PER_USER } from '../rules/economy';
// Ladder money rules live in the shared rule module (also run by the server).
export {
  LADDER_GAME_MAX_BALANCE,
  LADDER_DEPOSIT_WINDOW_MS,
  LADDER_RAMP_DAYS,
  LADDER_RAMP_MIN_FACTOR,
  LADDER_WITHDRAW_PRINCIPAL_FEE_RATE,
  LADDER_WITHDRAW_RUSH_RATE,
  LADDER_WITHDRAW_PROFIT_BRACKETS,
} from '../rules/ladder';

// Admin user IDs - only these users can see the Admin button
export const ADMIN_UIDS = ['4usiVxPmHLhmitEKH2HfCpbx4Yi1'];

// ============================================
// DIVIDEND SYSTEM
// ============================================

// The dividend system (rates, hold gate, loyalty ladder) lives in
// src/characters.ts so the backend gets the identical math via
// npm run sync:chars. Re-exported here for frontend convenience.
export {
  DIVIDEND_HOLD_DAYS,
  DIVIDEND_HOLD_MS,
  DIVIDEND_RATES,
  DIVIDEND_LOYALTY_LADDER,
  DIVIDEND_MAX_MULTIPLIER,
  dividendMultiplierForAgeMs,
  dividendWeightedShares,
} from '../characters';
