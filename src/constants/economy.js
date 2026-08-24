// ============================================
// ECONOMY CONSTANTS
// ============================================

// General
export const ITEMS_PER_PAGE = 15;
export const STARTING_CASH = 3000;
export const UNVERIFIED_STARTING_CASH = 1000; // before Discord verification (anti-alt) — keep in sync with functions/constants.js
export const BAILOUT_CASH = 1500; // cash granted by a bankruptcy bailout — keep in sync with functions/constants.js
export const PORTFOLIO_SYNC_MIN_INTERVAL_MS = 5 * 60 * 1000; // floor between passive syncPortfolio calls (backend cost control)
export const LEADERBOARD_DOC_FRESH_MS = 5 * 60 * 1000; // how long a precomputed leaderboard/{key} doc counts as fresh — keep in sync with LEADERBOARD_CACHE_TTL in functions/constants.js
export const DAILY_BONUS = 300;
// Daily check-in streak rewards. Index 0 = day 1; reward escalates with the
// consecutive-day streak, then caps at the last value. Keep in sync with
// functions/constants.js (CHECKIN_STREAK_REWARDS).
export const CHECKIN_STREAK_REWARDS = [300, 325, 350, 375, 400, 425, 500];
export const PRICE_UPDATE_INTERVAL = 5000; // 5 seconds
export const HISTORY_RECORD_INTERVAL = 60000; // 1 minute

// Pre-market max-buy headroom: the opening ask can sit up to ~5% (auction
// impact cap) + spread above the queue-time price. Keep in sync with
// functions/constants.js (PRE_MARKET_MAX_BUY_BUFFER).
export const PRE_MARKET_MAX_BUY_BUFFER = 1.06;

// IPO System Constants
export const IPO_HYPE_DURATION = 24 * 60 * 60 * 1000; // 24 hours hype phase
export const IPO_WINDOW_DURATION = 24 * 60 * 60 * 1000; // 24 hours IPO window
export const IPO_TOTAL_SHARES = 150; // Total shares available in IPO
export const IPO_MAX_PER_USER = 10; // Max shares per user during IPO
export const IPO_PRICE_JUMP = 0.15; // 15% price jump after IPO ends

// Event prediction markets (long-term, AMM-priced) — keep in sync with functions/constants.js
export const EVENT_AMM_LIQUIDITY = 5000; // LMSR liquidity param (b); house max loss per market = b * ln(1 / opening price of the winning outcome) — b * ln(numOutcomes) when odds open even
export const EVENT_MIN_BUYIN = 1; // minimum dollar cost of a single buy
export const MS_PER_HOUR = 60 * 60 * 1000;
// Announce-before-open delay presets (hours) offered when creating a long-term market. 0 = open immediately.
export const EVENT_OPEN_DELAY_PRESETS_HOURS = [0, 1, 6, 12, 24];
// Admin-set opening odds: each outcome's opening percentage must stay inside
// this band (extremes make shares near-worthless or the house loss explode).
export const EVENT_OPENING_ODDS_MIN_PCT = 1;
export const EVENT_OPENING_ODDS_MAX_PCT = 99;

// Economy balancing constants - Realistic Market Model
export const BASE_IMPACT = 0.012; // 1.2% base impact per sqrt(share) - 4x increase for better movement
export const BASE_LIQUIDITY = 100; // Base liquidity pool (higher = harder to move price)
export const BID_ASK_SPREAD = 0.002; // 0.2% spread between buy/sell prices
export const ETF_BID_ASK_SPREAD = 0.001; // 0.1% spread for ETFs (diversified = lower risk)
export const MIN_PRICE = 0.01; // Minimum price floor

// How many levels an admin price adjustment travels out through linked stocks.
// Level 1 is the stocks linked to the one that was adjusted, level 2 the stocks
// linked to those, and so on. Kept at 3 because the knock-on is already small
// by then and the cascade has to terminate.
export const TRAILING_MAX_DEPTH = 3;
export const DUST_MAX_VALUE = 5; // positions worth less than this ($) can be swept as dust — keep in sync with functions/constants.js

// Order sizing. Mirror of functions/constants.js — keep both in sync.
// Entries (buy/short) are whole-cent share counts. Exits (sell/cover) go much
// finer: dividends, partial fills and ETF math leave fractional remainders, and
// a player must always be able to close a position down to the last speck.
export const MIN_TRADE_SHARES = 0.01;    // min buy/short size
export const MIN_EXIT_SHARES = 0.000001; // min sell/cover size
export const MAX_PRICE_CHANGE_PERCENT = 0.05; // Max 5% price change per single trade (up from 2%)

// Shorting constants (realistic NYSE-style)
export const SHORT_MARGIN_REQUIREMENT = 1.0; // 100% margin required (dollar-for-dollar collateral)
// Collateral rate to assume when a short position has no stored `margin` value.
// Mirrors LEGACY_SHORT_MARGIN_RATIO in functions/constants.js — the risk bars and
// the server's force-cover check must agree, or a player sees a healthy position
// the server is about to liquidate.
export const LEGACY_SHORT_MARGIN_RATIO = 0.5; // pre-v2 shorts were half-collateral
export const SHORT_MARGIN_CALL_THRESHOLD = 0.25; // Auto-close if equity drops below 25%
export const SHORT_MARGIN_WARNING_THRESHOLD = 0.35; // Show a force-cover warning once equity dips below 35%
export const SHORT_RATE_LIMIT_HOURS = 8; // 8-hour cooldown after 3rd short on same ticker
export const MAX_SHORTS_BEFORE_COOLDOWN = 3; // Number of shorts allowed before cooldown kicks in

// ============================================
// MARGIN TRADING SYSTEM
// ============================================

export const MARGIN_CASH_MINIMUM = 2000; // $2,000 minimum cash to initially enable margin
// Experience gates shown as the requirements checklist in MarginModal. Enforced
// server-side too since 2026-08-04 — keep in sync with functions/constants.js.
export const MARGIN_MIN_CHECKINS = 10;
export const MARGIN_MIN_TRADES = 35;
export const MARGIN_MIN_PEAK_PORTFOLIO = 7500;
export const MARGIN_TIERS = [
  { minPeak: 0, maxPeak: 7500, multiplier: 0.25 },
  { minPeak: 7500, maxPeak: 15000, multiplier: 0.35 },
  { minPeak: 15000, maxPeak: 30000, multiplier: 0.50 },
  { minPeak: 30000, maxPeak: Infinity, multiplier: 0.75 },
];
export const MARGIN_INTEREST_RATE = 0.005; // 0.5% daily interest on margin used
export const MARGIN_WARNING_THRESHOLD = 0.65; // Display warning at 65% equity ratio
export const MARGIN_DANGER_THRESHOLD = 0.40; // Display danger zone at 40% equity ratio
export const MARGIN_CALL_THRESHOLD = 0.30; // Matches backend threshold — actual margin call fires here
export const MARGIN_LIQUIDATION_THRESHOLD = 0.25; // Matches backend threshold — liquidation fires here
export const MARGIN_MAINTENANCE_RATIO = 0.30; // 30% maintenance requirement for all positions

// Anti-manipulation protections
export const MAX_DAILY_IMPACT_PER_USER = 0.10; // 10% max cumulative impact per user per ticker per day
export const MAX_TRADES_PER_TICKER_24H = 10; // Max trades per action per ticker per rolling 24h
export const LADDER_GAME_MAX_BALANCE = 10000; // max cash held in ladder minigame at once
export const LADDER_DEPOSIT_WINDOW_MS = 12 * 60 * 60 * 1000; // rolling 12h window (deposit cap + rush fee) — keep in sync with functions/constants.js
// New accounts ramp up to the full ladder caps over their first week — keep in sync with functions/constants.js
export const LADDER_RAMP_DAYS = 7;
export const LADDER_RAMP_MIN_FACTOR = 0.05; // 5% of the caps at day 0 → 100% at day 7

// Ladder withdrawal tax — keep in sync with functions/constants.js
export const LADDER_WITHDRAW_PRINCIPAL_FEE_RATE = 0.05; // flat 5% on the portion that is deposited principal coming back
export const LADDER_WITHDRAW_RUSH_RATE = 0.15; // +15% of the whole withdrawal if any deposit landed within LADDER_DEPOSIT_WINDOW_MS
// Lifetime-progressive brackets over cumulative profit withdrawn (not per-withdrawal).
export const LADDER_WITHDRAW_PROFIT_BRACKETS = [
  { upTo: 1000, rate: 0.15 },
  { upTo: 5000, rate: 0.30 },
  { upTo: Infinity, rate: 0.45 },
];

// Anti-manipulation: New Account Impact Reduction
export const NEW_ACCOUNT_IMPACT_PERIOD_DAYS = 3; // Reduced impact for first 3 days
export const NEW_ACCOUNT_MIN_IMPACT_FACTOR = 0.1; // 10% impact at day 0, ramps to 100%

// Admin user IDs - only these users can see the Admin button
export const ADMIN_UIDS = [
  '4usiVxPmHLhmitEKH2HfCpbx4Yi1'
];

// ============================================
// DIVIDEND SYSTEM
// ============================================

// The dividend system (rates, hold gate, loyalty ladder) lives in
// src/characters.js so the backend gets the identical math via
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
