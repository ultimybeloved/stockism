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
const STARTING_CASH = 3000;
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

// ============================================
// IPO
// ============================================
const IPO_PRICE_JUMP = 0.15; // 15% price bump when IPO fully subscribed

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
  BAILOUT_CASH,
  LEADERBOARD_CACHE_TTL,
  MARGIN_INTEREST_RATE,
  CREW_SWITCH_PENALTY,
  MAX_SHORT_EXPOSURE_RATIO,
  MARKET_OPEN_GRACE_PERIOD_MINUTES,
  LADDER_GAME_MAX_BALANCE,
  LADDER_GAME_MAX_DAILY_DEPOSIT,
  IPO_PRICE_JUMP,
  CREW_MEMBERS,
  ALL_CREW_TICKERS,
  ANIMAL_TICKERS,
  ADMIN_UID,
};
