// Shared constants for all Cloud Functions.
// Source of truth for economy rules — keep in sync with src/constants/economy.js.

// ============================================
// MARKET MECHANICS
// ============================================
const BASE_IMPACT = 0.012;
const BASE_LIQUIDITY = 100;
const BID_ASK_SPREAD = 0.002;
const ETF_BID_ASK_SPREAD = 0.001;
const MIN_PRICE = 0.01;
const MAX_PRICE_CHANGE_PERCENT = 0.05;

// Anti-manipulation: per-user, per-ticker, per-day limits
const MAX_DAILY_IMPACT = 0.10;          // 10% max cumulative price move
const MAX_TRADES_PER_TICKER_24H = 10;   // Max buys or sells per ticker per rolling 24h

// Anti-manipulation: reduced price impact for brand-new accounts.
// Mirrors src/constants/economy.js — keep both in sync.
const NEW_ACCOUNT_IMPACT_PERIOD_DAYS = 3;  // ramps over the first 3 days
const NEW_ACCOUNT_MIN_IMPACT_FACTOR = 0.1; // 10% impact at day 0 → 100% at day 3

// Anti-alt: hard cap on accounts per IP, enforced at signup AND trade.
// ADMIN_UID is always exempt. Flip IP_ACCOUNT_CAP_ENABLED to false to disable the
// hard block instantly (e.g. if client IPs turn out unreliable) without a code change.
const MAX_ACCOUNTS_PER_IP = 2;
const IP_ACCOUNT_CAP_ENABLED = true;

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const ONE_WEEK_MS           = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS        = 30 * 24 * 60 * 60 * 1000;
const NINETY_DAYS_MS        = 90 * 24 * 60 * 60 * 1000;

// ============================================
// WEEKLY TRADING HALT (Thursday 13:00–21:00 UTC)
// ============================================
const WEEKLY_HALT_START_MINUTE = 780;  // 13 * 60
const WEEKLY_HALT_END_MINUTE   = 1260; // 21 * 60
const PRE_MARKET_START_MINUTE  = 1230; // 20:30 UTC
const PRE_MARKET_LOCK_MINUTE   = 1255; // 20:55 UTC — no cancellations after this

const isWeeklyTradingHalt = () => {
  const now = new Date();
  if (now.getUTCDay() !== 4) return false;
  const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  return utcMins >= WEEKLY_HALT_START_MINUTE && utcMins < WEEKLY_HALT_END_MINUTE;
};

// ============================================
// ECONOMY
// ============================================
const STARTING_CASH = 3000;            // full starting cash once verified (Discord linked)
const UNVERIFIED_STARTING_CASH = 1000; // starting cash before Discord verification (anti-alt)
const BAILOUT_CASH = 1500;
const SHORT_MARGIN_RATIO = 1.0; // 100% collateral — deposit dollar-for-dollar
const LEADERBOARD_CACHE_TTL = 60000; // 60 seconds

// ============================================
// MARGIN
// ============================================
const MARGIN_INTEREST_RATE = 0.005;  // 0.5% per day
const CREW_SWITCH_PENALTY  = 0.15;   // 15% of portfolio value lost on crew switch
const MAX_SHORT_EXPOSURE_RATIO = 1.0; // total short value ≤ net worth (1:1 cap)
const MARKET_OPEN_GRACE_PERIOD_MINUTES = 30; // pause auto-liquidations after halt end
const LADDER_GAME_MAX_BALANCE = 5000; // max cash held in ladder minigame at once
const LADDER_GAME_MAX_DAILY_DEPOSIT = 5000; // max cash deposited into ladder per calendar day (UTC)
const CREW_BUY_THRESHOLD = 1500;    // shares crew must buy to complete CREW_BUY_500 mission
const CREW_SELL_THRESHOLD = 1500;   // shares crew must sell to complete CREW_SELL_500 mission
const CREW_VOLUME_THRESHOLD = 20000; // $ trade volume crew must hit to complete CREW_VOLUME mission

// ============================================
// MARGIN THRESHOLDS
// ============================================
const SHORT_MARGIN_CALL_THRESHOLD    = 0.25; // short equity ratio below which force-cover triggers
const SHORT_MARGIN_DAMPENING_FACTOR  = 0.50; // reduced price impact for forced short covers
const LONG_MARGIN_CALL_THRESHOLD     = 0.30; // long margin equity ratio at which margin call is issued
const LONG_MARGIN_LIQUIDATION_THRESHOLD = 0.25; // long margin equity ratio at which auto-liquidation triggers

// ============================================
// IPO
// ============================================
const IPO_PRICE_JUMP = 0.15; // 15% price bump when IPO fully subscribed

// ============================================
// EVENT PREDICTION MARKETS (long-term, AMM-priced)
// ============================================
// LMSR liquidity parameter (b). Bigger = steadier prices and a larger bounded
// house subsidy. Max the house can ever lose on a market is b * ln(numOutcomes).
// Seeded generously on purpose: stable prices and generous payouts build trust.
const EVENT_AMM_LIQUIDITY = 1000;
const EVENT_MIN_BUYIN = 1; // minimum dollar cost of a single buy (avoids dust)

// ============================================
// CREW MEMBER MAPPINGS
// ============================================
const CREW_MEMBERS = {
  ALLIED:          ['BDNL', 'LDNL', 'VSCO', 'ZACK', 'JAY', 'VIN', 'AHN'],
  BIG_DEAL:        ['JAKE', 'SWRD', 'JSN', 'BRAD', 'LINE', 'SINU', 'LUAH'],
  FIST_GANG:       ['GAP', 'ELIT', 'JYNG', 'TOM', 'KWON', 'DNCE', 'GNTL', 'MMA', 'LIAR', 'NOH'],
  GOD_DOG:         ['GDOG', 'MIRO', 'EDEN'],
  SECRET_FRIENDS:  ['GOO', 'LOGN', 'SAM', 'ALEX', 'SHMN'],
  HOSTEL:          ['ELI', 'SLLY', 'CHAE', 'MAX', 'DJO', 'ZAMI', 'RYAN'],
  WTJC:            ['TOM', 'SRMK', 'SGUI', 'YCHL', 'SERA', 'MMA', 'LIAR', 'NOH'],
  WORKERS:         ['WRKR', 'BANG', 'CAPG', 'JYNG', 'NOMN', 'NEKO', 'DOOR', 'JINJ', 'DRMA', 'HYOT', 'OLDF', 'SHKO', 'HIKO', 'DOC', 'NO1'],
  YAMAZAKI:        ['GUN', 'SHNG', 'SHRO', 'SHKO', 'HIKO', 'SOMI']
};

const ALL_CREW_TICKERS = new Set(Object.values(CREW_MEMBERS).flat());

const ANIMAL_TICKERS = new Set(['RYAN', 'EDEN', 'MIRO', 'ENU']);

// ============================================
// LEADERBOARD
// ============================================
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

// ============================================
// LADDER GAME
// ============================================
const LADDER_GAME_INITIAL_BALANCE    = 500;   // starting balance for new ladder game users
const LADDER_HIGH_BET_THRESHOLD      = 50;    // bets at or above this count toward ADDICTED achievement
const LADDER_ACHIEVEMENT_PROFIT      = 2500;  // net profit needed for COMPULSIVE_GAMBLER achievement
const LADDER_ACHIEVEMENT_HIGH_BETS   = 100;   // high-bet games needed for ADDICTED achievement

// ============================================
// DISCORD ALERTS
// ============================================
const WHALE_ALERT_SHARES_SOFT   = 50;   // shares threshold (combined with price check) for whale alert
const WHALE_ALERT_PRICE_SOFT    = 35;   // price threshold (combined with shares check) for whale alert
const WHALE_ALERT_SHARES_HARD   = 100;  // shares threshold alone triggers whale alert regardless of price
const CREW_MILESTONE_THRESHOLDS = [5, 10, 25, 50, 100]; // crew member counts that trigger Discord alerts

// ============================================
// ADMIN OPS
// ============================================
const REINSTATE_CASH_DEFAULT = 1000; // cash given when admin reinstates a bankrupt user

// ============================================
// CREW PUMP THRESHOLD
// ============================================
const CREW_PUMP_THRESHOLD = 1.10; // a stock must reach 110% of its week-start price to satisfy CREW_PUMP

// ============================================
// MISSION REWARDS
// ============================================
const MISSION_REWARDS = {
  // Daily missions
  BUY_CREW_MEMBER: 150, HOLD_CREW_SHARES: 75, MAKE_TRADES: 100,
  BUY_ANY_STOCK: 75, SELL_ANY_STOCK: 75, HOLD_LARGE_POSITION: 125, TRADE_VOLUME: 100,
  CREW_MAJORITY: 125, CREW_COLLECTOR: 100, FULL_ROSTER: 200, CREW_LEADER: 150,
  RIVAL_TRADER: 75, SPY_GAME: 100,
  TOP_DOG: 100, UNDERDOG_INVESTOR: 75,
  BALANCED_CREW: 100, CREW_ACCUMULATOR: 150,
  // Weekly missions
  MARKET_WHALE: 750, VOLUME_KING: 500, TRADING_MACHINE: 400,
  TRADING_STREAK: 600, DAILY_GRINDER: 500,
  CREW_MAXIMALIST: 600, CREW_HOARDER: 500, FULL_CREW_OWNERSHIP: 1000,
  DIVERSIFICATION_MASTER: 500, PORTFOLIO_BUILDER: 750,
  SHARE_MOGUL: 700, TRADE_MASTER: 600, HEAVY_BAGS: 600,
  PENNY_COLLECTOR: 500, BLUE_CHIP_INVESTOR: 600, SHORT_KING: 700,
  PORTFOLIO_MOONSHOT: 1000
};

const CREW_MISSION_REWARDS = {
  CREW_BUY_500:    500,
  CREW_SELL_500:   400,
  CREW_FULL_ROSTER: 750,
  CREW_RECRUIT:    300,
  CREW_PUMP:       600,
  CREW_VOLUME:     500,
};

// ============================================
// ADMIN
// ============================================
// Set via functions/.env in production; fallback for local dev only
const ADMIN_UID = process.env.ADMIN_UID || '4usiVxPmHLhmitEKH2HfCpbx4Yi1';

module.exports = {
  BASE_IMPACT,
  BASE_LIQUIDITY,
  BID_ASK_SPREAD,
  ETF_BID_ASK_SPREAD,
  MIN_PRICE,
  MAX_PRICE_CHANGE_PERCENT,
  MAX_DAILY_IMPACT,
  MAX_TRADES_PER_TICKER_24H,
  NEW_ACCOUNT_IMPACT_PERIOD_DAYS,
  NEW_ACCOUNT_MIN_IMPACT_FACTOR,
  MAX_ACCOUNTS_PER_IP,
  IP_ACCOUNT_CAP_ENABLED,
  TWENTY_FOUR_HOURS_MS,
  ONE_WEEK_MS,
  THIRTY_DAYS_MS,
  NINETY_DAYS_MS,
  SHORT_MARGIN_RATIO,
  WEEKLY_HALT_START_MINUTE,
  WEEKLY_HALT_END_MINUTE,
  PRE_MARKET_START_MINUTE,
  PRE_MARKET_LOCK_MINUTE,
  isWeeklyTradingHalt,
  STARTING_CASH,
  UNVERIFIED_STARTING_CASH,
  BAILOUT_CASH,
  LEADERBOARD_CACHE_TTL,
  MARGIN_INTEREST_RATE,
  CREW_SWITCH_PENALTY,
  MAX_SHORT_EXPOSURE_RATIO,
  MARKET_OPEN_GRACE_PERIOD_MINUTES,
  LADDER_GAME_MAX_BALANCE,
  LADDER_GAME_MAX_DAILY_DEPOSIT,
  CREW_BUY_THRESHOLD,
  CREW_SELL_THRESHOLD,
  CREW_VOLUME_THRESHOLD,
  SHORT_MARGIN_CALL_THRESHOLD,
  SHORT_MARGIN_DAMPENING_FACTOR,
  LONG_MARGIN_CALL_THRESHOLD,
  LONG_MARGIN_LIQUIDATION_THRESHOLD,
  IPO_PRICE_JUMP,
  EVENT_AMM_LIQUIDITY,
  EVENT_MIN_BUYIN,
  CREW_MEMBERS,
  ALL_CREW_TICKERS,
  ANIMAL_TICKERS,
  FOURTEEN_DAYS_MS,
  LADDER_GAME_INITIAL_BALANCE,
  LADDER_HIGH_BET_THRESHOLD,
  LADDER_ACHIEVEMENT_PROFIT,
  LADDER_ACHIEVEMENT_HIGH_BETS,
  WHALE_ALERT_SHARES_SOFT,
  WHALE_ALERT_PRICE_SOFT,
  WHALE_ALERT_SHARES_HARD,
  CREW_MILESTONE_THRESHOLDS,
  REINSTATE_CASH_DEFAULT,
  CREW_PUMP_THRESHOLD,
  MISSION_REWARDS,
  CREW_MISSION_REWARDS,
  ADMIN_UID,
};
