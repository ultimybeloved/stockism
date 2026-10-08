'use strict';
// The Discord daily free-stock drop.

// ============================================
// DISCORD DAILY DROP (loot roll in dailyDropRoll.js)
// ============================================
// A normal claim draws from THREE tables. The roster has grown a long cheap
// tail (over a third of it trades under $25), and when one flat pool fed the
// whole roll most days paid out a single share of a $10 character. So the
// cheap end now rides on top of the real pull instead of replacing it:
//
//   CORE table       the actual pull, drawn from the mid tiers. Always pays.
//   BONUS table      cheapest tiers, several shares. Always pays.
//   LEGENDARY table  a slim chance at ONE legendary share. Usually pays nothing.
//   JACKPOT          3% of claims, replaces the core pull with a legendary haul
//
// Tiers come from computeRarityTiers (src/characters.ts), which ranks by LIVE
// price rather than basePrice and re-sorts itself as the market moves. New
// cheap characters therefore route themselves into the bonus table with no
// maintenance here.
//
// Legendary is deliberately absent from the CORE table — a single legendary
// share outvalues a whole good roll, so making it a routine core outcome would
// wreck the predictable everyday payout. The legendary table is how it stays
// reachable anyway: rare, one share, and capped to the cheaper half of the
// tier so the priciest legendaries remain jackpot-exclusive.
//
// Calibrated against live prices 2026-07-31: mean $425/claim, typical $296,
// worst 10% of claims still clear $181. Re-run scripts/sim-daily-drop.cjs
// after changing any weight below.
const DAILY_DROP_JACKPOT_CHANCE = 0.03; // 3% of claims are jackpots

// How long a posted drop stays claimable. Also bounds the per-user
// claimedDailyStockMessages ledger: a message older than this is refused by the
// expiry check regardless, so entries past the window are pruned rather than
// kept forever.
const DROP_CLAIM_WINDOW_MS = 72 * 60 * 60 * 1000;
// How long a feed entry lives. Written onto each entry as a Timestamp so a
// Firestore TTL policy on feed.expiresAt can act on it — a numeric field is
// ignored by TTL, which is why nothing was ever deleted.
const FEED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Discord snowflake epoch (2015-01-01). Message IDs carry their own creation
// time in the high bits, which is how a drop's age is known without storing it.
const DISCORD_EPOCH_MS = 1420070400000;

// Bonus table — the cheap end of the roster, added to every single claim.
const DAILY_DROP_BONUS_TIERS = ['common', 'uncommon'];
const DAILY_DROP_BONUS_SHARE_VALUES = [3, 4, 5, 6, 7];
const DAILY_DROP_BONUS_SHARE_WEIGHTS = [20, 30, 25, 17, 8];
const DAILY_DROP_BONUS_VARIETY_VALUES = [1, 2, 3]; // how many different stocks
const DAILY_DROP_BONUS_VARIETY_WEIGHTS = [30, 45, 25];

// Core table — the main pull. Share counts are per-tier so an epic pull can't
// hand out as many shares as a rare one.
const DAILY_DROP_CORE_TIER_VALUES = ['rare', 'epic'];
const DAILY_DROP_CORE_TIER_WEIGHTS = [55, 45];
const DAILY_DROP_CORE_SHARE_VALUES = { rare: [2, 3, 4], epic: [1, 2, 3] };
const DAILY_DROP_CORE_SHARE_WEIGHTS = { rare: [35, 40, 25], epic: [35, 45, 20] };
const DAILY_DROP_CORE_VARIETY_VALUES = [1, 2];
const DAILY_DROP_CORE_VARIETY_WEIGHTS = [70, 30];

// Legendary table — the third roll on a normal claim, and usually a miss.
// Pays ONE share, drawn from the cheapest slice of the legendary tier, so it
// reads as a lucky bonus rather than a stealth jackpot. On live prices that
// slice is the four legendaries around $350-$400; the $970+ megacaps sit above
// the cut and stay jackpot-only.
const DAILY_DROP_LEGENDARY_CHANCE = 0.1; // ~1 in 10 normal rolls
const DAILY_DROP_LEGENDARY_SHARES = 1;
const DAILY_DROP_LEGENDARY_POOL_FRACTION = 0.5; // cheapest half of the tier

// Jackpot — draws the whole legendary tier, megacaps included.
const DAILY_DROP_JACKPOT_TIERS = ['legendary', 'epic'];
const DAILY_DROP_JACKPOT_SHARES_MIN = 6;
const DAILY_DROP_JACKPOT_SHARES_MAX = 10;
const DAILY_DROP_JACKPOT_VARIETY_MIN = 3;
const DAILY_DROP_JACKPOT_VARIETY_MAX = 5;

module.exports = {
  DAILY_DROP_JACKPOT_CHANCE,
  DROP_CLAIM_WINDOW_MS,
  FEED_TTL_MS,
  DISCORD_EPOCH_MS,
  DAILY_DROP_BONUS_TIERS,
  DAILY_DROP_BONUS_SHARE_VALUES,
  DAILY_DROP_BONUS_SHARE_WEIGHTS,
  DAILY_DROP_BONUS_VARIETY_VALUES,
  DAILY_DROP_BONUS_VARIETY_WEIGHTS,
  DAILY_DROP_CORE_TIER_VALUES,
  DAILY_DROP_CORE_TIER_WEIGHTS,
  DAILY_DROP_CORE_SHARE_VALUES,
  DAILY_DROP_CORE_SHARE_WEIGHTS,
  DAILY_DROP_CORE_VARIETY_VALUES,
  DAILY_DROP_CORE_VARIETY_WEIGHTS,
  DAILY_DROP_LEGENDARY_CHANCE,
  DAILY_DROP_LEGENDARY_SHARES,
  DAILY_DROP_LEGENDARY_POOL_FRACTION,
  DAILY_DROP_JACKPOT_TIERS,
  DAILY_DROP_JACKPOT_SHARES_MIN,
  DAILY_DROP_JACKPOT_SHARES_MAX,
  DAILY_DROP_JACKPOT_VARIETY_MIN,
  DAILY_DROP_JACKPOT_VARIETY_MAX,
};
