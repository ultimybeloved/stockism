// ============================================
// ECONOMY CONSTANTS
// ============================================

// General
export const ITEMS_PER_PAGE = 15;
export const STARTING_CASH = 1000;
export const DAILY_BONUS = 300;
export const PRICE_UPDATE_INTERVAL = 5000; // 5 seconds
export const HISTORY_RECORD_INTERVAL = 60000; // 1 minute

// IPO System Constants
export const IPO_HYPE_DURATION = 24 * 60 * 60 * 1000; // 24 hours hype phase
export const IPO_WINDOW_DURATION = 24 * 60 * 60 * 1000; // 24 hours IPO window
export const IPO_TOTAL_SHARES = 150; // Total shares available in IPO
export const IPO_MAX_PER_USER = 10; // Max shares per user during IPO
export const IPO_PRICE_JUMP = 0.30; // 30% price jump after IPO ends

// Economy balancing constants - Realistic Market Model
export const BASE_IMPACT = 0.012; // 1.2% base impact per sqrt(share) - 4x increase for better movement
export const BASE_LIQUIDITY = 100; // Base liquidity pool (higher = harder to move price)
export const BID_ASK_SPREAD = 0.002; // 0.2% spread between buy/sell prices
export const MIN_PRICE = 0.01; // Minimum price floor
export const MAX_PRICE_CHANGE_PERCENT = 0.05; // Max 5% price change per single trade (up from 2%)

// Shorting constants (realistic NYSE-style)
export const SHORT_MARGIN_REQUIREMENT = 0.5; // 50% margin required (can short up to 2x cash)
export const SHORT_INTEREST_RATE = 0.001; // 0.1% daily interest on short positions
export const SHORT_MARGIN_CALL_THRESHOLD = 0.25; // Auto-close if equity drops below 25%
export const SHORT_RATE_LIMIT_HOURS = 12; // 12-hour cooldown after 2nd short on same ticker
export const MAX_SHORTS_BEFORE_COOLDOWN = 2; // Number of shorts allowed before cooldown kicks in

// ============================================
// MARGIN TRADING SYSTEM
// ============================================

export const MARGIN_CASH_MINIMUM = 2000; // $2,000 minimum cash to initially enable margin
export const MARGIN_TIERS = [
  { minPeak: 0, maxPeak: 7500, multiplier: 0.25 },
  { minPeak: 7500, maxPeak: 15000, multiplier: 0.35 },
  { minPeak: 15000, maxPeak: 30000, multiplier: 0.50 },
  { minPeak: 30000, maxPeak: Infinity, multiplier: 0.75 },
];
export const MARGIN_INTEREST_RATE = 0.005; // 0.5% daily interest on margin used
export const MARGIN_WARNING_THRESHOLD = 0.35; // Warning at 35% equity ratio
export const MARGIN_CALL_THRESHOLD = 0.30; // Margin call at 30% equity ratio
export const MARGIN_LIQUIDATION_THRESHOLD = 0.25; // Auto-liquidate at 25% equity ratio
export const MARGIN_CALL_GRACE_PERIOD = 24 * 60 * 60 * 1000; // 24 hours to resolve margin call
export const MARGIN_MAINTENANCE_RATIO = 0.30; // 30% maintenance requirement for all positions

// Anti-manipulation protections
export const MAX_DAILY_IMPACT_PER_USER = 0.10; // 10% max cumulative impact per user per ticker per day

// Admin user IDs - only these users can see the Admin button
export const ADMIN_UIDS = [
  '4usiVxPmHLhmitEKH2HfCpbx4Yi1'
];
