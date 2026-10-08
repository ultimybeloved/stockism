// Cloud Function safety caps and scheduled-job monitoring.

// Hard ceiling on how many copies of any one function can run at the same time.
// Bounds how fast cost can pile up if a function is flooded (deliberate abuse or a
// bug) without affecting normal play. Lower = safer on cost; too low could throttle
// trades at a busy market open. Applied to every function via functions/src/shared/fnConfig.js.
export const MAX_FN_INSTANCES = 10;

// App Check enforcement on callable functions. When true, callables reject any
// request that didn't come from our real app (no valid App Check token), which
// blocks outside scripts from hammering the backend. OFF by default on purpose:
// turn it on ONLY after confirming in Firebase Console → App Check that real
// traffic is ~100% verified, or legitimate players could be locked out. Flip back
// to false to disable instantly without a code change (mirrors IP_ACCOUNT_CAP_ENABLED).
// Enabled 2026-08-14 after confirming in Firebase Console → App Check → APIs →
// Cloud Functions that real traffic was 301K/301K verified, with ZERO outdated
// client requests (the metric that would mean locking out real players) and
// 380 unverified requests of unknown or invalid origin, which is exactly what
// this is meant to reject. Flip back to false to disable instantly.
export const APP_CHECK_ENFORCED = true;

// Scheduled jobs the watchdog expects to see a fresh heartbeat from, and how
// stale each may get before it is treated as broken.
//
// These are the jobs whose silent failure costs players money or breaks the
// week: the Thursday auction, dividends, both liquidation scanners, the limit
// order sweep, the weekly report and the season checkpoint. Everything else is
// cosmetic enough to notice by eye.
//
// Each budget is the job's own interval plus generous slack, so a single missed
// run from a cold start or a deploy never pages. `job` must match the export
// name passed to recordHeartbeat().
// Jobs added to the watch list after the watchdog was installed count from
// this date, so a weekly job isn't reported missing before its first run.
const ADDED_2026_09_28 = Date.UTC(2026, 8, 29);
export const WATCHED_SCHEDULED_JOBS = [
  // Weekly (Thursday/Monday): 8 days covers a full cycle plus a missed run.
  { job: 'processMarketOpenOrders', maxAgeHours: 8 * 24, label: 'Thursday opening auction' },
  { job: 'payDividends', maxAgeHours: 8 * 24, label: 'Dividend payout' },
  { job: 'weeklyMarketSummary', maxAgeHours: 8 * 24, label: 'Weekly market report' },
  { job: 'seasonCheckpoint', maxAgeHours: 8 * 24, label: 'Season checkpoint' },
  // Daily.
  { job: 'dailyMarketSummary', maxAgeHours: 48, label: 'Daily market summary' },
  // Frequent scanners. These skip themselves during the Thursday halt, so the
  // budget has to clear the 8-hour halt window or they would false-alarm weekly.
  { job: 'checkShortMarginCalls', maxAgeHours: 12, label: 'Short margin-call scanner' },
  { job: 'checkMarginLending', maxAgeHours: 12, label: 'Margin lending scanner' },
  { job: 'checkLimitOrders', maxAgeHours: 12, label: 'Limit order sweep' },
  // Price and chart movers. These were NOT watched, and it showed: a bad import
  // killed marketMakerCycle on 2026-09-19 and it threw on every hourly run for
  // three days before anyone looked at its logs. They all swallow their own
  // errors and return null, so a heartbeat on the success path is the only
  // outside signal that they are alive. Budgets clear the 8h Thursday halt.
  { job: 'marketMakerCycle', maxAgeHours: 12, label: 'Price stabiliser' },
  { job: 'botTrader', maxAgeHours: 12, label: 'Bot trading round' },
  // Added 2026-09-28: every other scheduled job that players or moderation
  // depend on. All of them caught their own errors and logged to the console,
  // so a dead one was invisible.
  {
    job: 'savePreHaltPrices',
    maxAgeHours: 8 * 24,
    label: 'Pre-halt price snapshot (dividends pay off it)',
    watchedSince: ADDED_2026_09_28,
  },
  {
    job: 'weeklyCrewRankings',
    maxAgeHours: 8 * 24,
    label: 'Crew rankings, multipliers and crew heads',
    watchedSince: ADDED_2026_09_28,
  },
  { job: 'weeklyLeaderboard', maxAgeHours: 8 * 24, label: 'Weekly leaderboard post', watchedSince: ADDED_2026_09_28 },
  { job: 'syncAllPortfolios', maxAgeHours: 48, label: 'Portfolio sync', watchedSince: ADDED_2026_09_28 },
  { job: 'scheduledArchiving', maxAgeHours: 48, label: 'Chart history archiving', watchedSince: ADDED_2026_09_28 },
  { job: 'backupMarketData', maxAgeHours: 48, label: 'Daily backup', watchedSince: ADDED_2026_09_28 },
  { job: 'dailyFreeStock', maxAgeHours: 48, label: 'Daily drop post', watchedSince: ADDED_2026_09_28 },
  { job: 'scanForAltAccounts', maxAgeHours: 48, label: 'Alt account scan', watchedSince: ADDED_2026_09_28 },
  { job: 'scanForCoordination', maxAgeHours: 6, label: 'Coordination scan', watchedSince: ADDED_2026_09_28 },
  { job: 'checkPriceAlerts', maxAgeHours: 6, label: 'Price alerts', watchedSince: ADDED_2026_09_28 },
  { job: 'processEventSettlements', maxAgeHours: 6, label: 'Event market payouts', watchedSince: ADDED_2026_09_28 },
  // Skips itself during the Thursday halt, so the budget clears it.
  { job: 'processIPOPriceJumps', maxAgeHours: 12, label: 'IPO price jumps', watchedSince: ADDED_2026_09_28 },
  { job: 'recordPriceExtremes', maxAgeHours: 12, label: 'All-time high/low sweep' },
  { job: 'applyNeglectDecay', maxAgeHours: 48, label: 'Neglect decay' },
];
