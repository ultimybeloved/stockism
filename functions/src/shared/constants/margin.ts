// Margin lending, interest, and the forced-sale thresholds.

import { CREW_REJOIN_LOCKOUT_DAYS } from '../crews';
import { TWENTY_FOUR_HOURS_MS } from './time';

// ============================================
// MARGIN
// ============================================
export {
  MARGIN_INTEREST_RATE,
  MARGIN_CASH_MINIMUM,
  MARGIN_MIN_CHECKINS,
  MARGIN_MIN_TRADES,
  MARGIN_MIN_PEAK_PORTFOLIO,
  SHORT_MARGIN_CALL_THRESHOLD,
  LEGACY_SHORT_MARGIN_RATIO,
} from '../rules/economy';

export const CREW_REJOIN_LOCKOUT_MS = CREW_REJOIN_LOCKOUT_DAYS * TWENTY_FOUR_HOURS_MS; // rejoin lockout after leaving a crew (from crews.ts)
export const MAX_SHORT_EXPOSURE_RATIO = 1.0; // total short value ≤ net worth (1:1 cap)
export const MARKET_OPEN_GRACE_PERIOD_MINUTES = 30; // pause auto-liquidations after halt end
// New accounts ramp up to the full ladder caps over their first week, mirroring
// the NEW_ACCOUNT_* price-impact ramp above. The invested-in-stocks cap doesn't
// stop a fresh alt — it buys stock with the cash it was handed at signup and
// clears that gate honestly — so the free stake can be gambled on day one. This
// makes an alt worth a few hundred dollars of play instead of thousands, while
// a real new player still gets to try the game immediately.
// The ladder caps and ramp are defined in the shared rule module rules/ladder.
export {
  LADDER_GAME_MAX_BALANCE,
  LADDER_GAME_MAX_DEPOSIT_PER_WINDOW,
  LADDER_DEPOSIT_WINDOW_MS,
  LADDER_RAMP_DAYS,
  LADDER_RAMP_MIN_FACTOR,
} from '../rules/ladder';
// Crew buy/sell/volume goals scale with roster size (see getCrew*Target in crews.ts)

// ============================================
// MARGIN THRESHOLDS
// ============================================
export const SHORT_MARGIN_DAMPENING_FACTOR = 0.5; // reduced price impact for forced short covers
export const LONG_MARGIN_CALL_THRESHOLD = 0.3; // long margin equity ratio at which margin call is issued
export const LONG_MARGIN_LIQUIDATION_THRESHOLD = 0.25; // long margin equity ratio at which auto-liquidation triggers

// Price a forced long-margin liquidation sells at: 5% below market. The seller is
// dumping an entire portfolio at once and does not get to shop for a better fill.
export const MARGIN_LIQUIDATION_SLIPPAGE = 0.05;

// Cap on forced short covers per ticker per run of checkShortMarginCalls, so one
// crowded short cannot cascade into a spike inside a single cycle.
//
// This is a BLAST-RADIUS cap, not a throughput setting. Each forced cover pushes
// the price up by at most MAX_PRICE_CHANGE_PERCENT (5%), and covers inside a run
// compound, so 3 is roughly a 16% worst-case move per ticker per run. Raising it
// to keep the old hourly liquidation rate after the schedule moved from 5 to 30
// minutes would allow ~140% in one burst — the squeeze the cap exists to stop.
//
// Consequence to know: at a 30-minute schedule a crowded underwater short drains
// ~6x slower than when this was written. That is the safe direction to be wrong
// in, but if liquidation latency ever becomes the problem, fix it by running the
// scan more often, NOT by raising this number.
export const SHORT_MARGIN_CALL_INTERVAL_MINUTES = 30;
export const FORCED_COVERS_PER_TICKER_PER_CYCLE = 3;

// Firestore caps a batched write at 500 ops; stay under it with room to spare.
export const FIRESTORE_BATCH_SIZE = 400;
