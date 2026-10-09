// Season money maths: margin averaged over the season, and money that came in
// (grants, dividends, ladder flows). Split out of seasonTiers.ts, which
// re-exports all of it. INTERNAL MODULE: exports no Cloud Functions.
import { round2 } from '../shared/money';
import type { MarginTally, SeasonBaseline, UserData } from '../shared/types';
import { TWENTY_FOUR_HOURS_MS } from '../shared/constants';

// ── Margin, averaged over the season ────────────────────────────────────────
//
// Borrowed money counts as money traded with, for as long as it was owed. $10k
// owed all season counts $10k; owed for 1 day of 60, about $170. Only debt at
// the checkpoint would let a player borrow Friday and repay Wednesday unseen;
// the most ever owed would punish one day's borrowing for the whole season.
//
// The running tally lives on the user as `seasonMargin`:
//   dd      dollar-days owed from pinning up to `at`
//   amount  what has been owed since `at`
// Every writer of marginUsed spreads in seasonMarginUpdate. The weekly
// checkpoint re-syncs it too, so a writer that misses it only drifts until
// Thursday.

/** The player's tally for this season, or an empty one from their pinning. */
export const marginTally = (userData: UserData | null | undefined, seasonId: string): MarginTally => {
  const t = userData?.seasonMargin;
  if (t && t.seasonId === seasonId) return t;
  return { seasonId, dd: 0, amount: 0, at: userData?.seasonBaseline?.pinnedAt || 0 };
};

/** Dollar-days owed on margin from pinning up to `now`. */
export const marginDollarDays = (userData: UserData | null | undefined, seasonId: string, now = Date.now()) => {
  const t = marginTally(userData, seasonId);
  const since = t.at > 0 ? Math.max(0, now - t.at) : 0;
  return (t.dd || 0) + (t.amount || 0) * (since / TWENTY_FOUR_HOURS_MS);
};

/** Dollar-days over a span, as the average owed across it. */
export const averageOwed = (dollarDays: number, fromMs: number, toMs: number, fallback = 0) => {
  const days = (toMs - fromMs) / TWENTY_FOUR_HOURS_MS;
  return days > 0 ? Math.max(0, dollarDays) / days : fallback;
};

/** What the player has owed on average since they were pinned. */
export const seasonAverageMargin = (userData: UserData | null | undefined, seasonId: string, now = Date.now()) =>
  averageOwed(
    marginDollarDays(userData, seasonId, now),
    userData?.seasonBaseline?.pinnedAt || now,
    now,
    marginTally(userData, seasonId).amount || 0,
  );

/**
 * The update that records margin debt changing to `newAmount`: closes the
 * running span and opens a new one. {} for a player outside any season.
 */
export const seasonMarginUpdate = (
  userData: UserData | null | undefined,
  newAmount: number | null | undefined,
  now = Date.now(),
): { seasonMargin?: MarginTally } => {
  const seasonId = userData?.seasonBaseline?.seasonId;
  if (!seasonId) return {};
  return {
    seasonMargin: {
      seasonId,
      dd: round2(marginDollarDays(userData, seasonId, now)),
      amount: round2(Math.max(0, newAmount || 0)),
      at: now,
    },
  };
};

// ── Money in ────────────────────────────────────────────────────────────────
//
// Grants that arrive mid-season (missions, check-ins, dividends, drops) count
// toward capital only for the time the player has had them, like margin.
// Counting them in full on arrival meant collecting a mission lowered a positive
// return: same trading profit, bigger base.
//
// Side-game flows (ladder, predictions) count in full the moment they land.
// They can be huge lump sums, and averaging one that just arrived leaves the
// money trading with almost none of it in the base: a day-one $17k payout turned
// a -7% start into -31%, and a late payout traded up would inflate the same way.

/**
 * Money in since pinning, averaged over `fromMs`..`toMs`. `grantedDays` is the
 * player's grantedDays counter minus the baseline's. Undefined means a baseline
 * or record from before the counter existed: counted in full, as it used to be.
 */
export const averageGranted = (
  granted: number | null | undefined,
  grantedDays: number | null | undefined,
  fromMs: number,
  toMs: number,
) => {
  if (grantedDays === undefined || grantedDays === null) return granted || 0;
  const days = (toMs - fromMs) / TWENTY_FOUR_HOURS_MS;
  if (!(days > 0)) return 0;
  const g = granted || 0;
  const avg = (g * (toMs / TWENTY_FOUR_HOURS_MS) - grantedDays) / days;
  // Never more than counting it all in full, never past zero. A booking that
  // missed the time counter would otherwise read as held since 1970.
  return Math.min(Math.max(avg, Math.min(0, g)), Math.max(0, g));
};

/** Ladder + prediction flows since pinning. */
export const sideFlowsSince = (userData: UserData | null | undefined) => {
  const b: Partial<SeasonBaseline> = userData?.seasonBaseline || {};
  return (
    (userData?.ladderFlowValue || 0) -
    (b.ladderFlow || 0) +
    ((userData?.predictionFlowValue || 0) - (b.predictionFlow || 0))
  );
};

/**
 * All money in since pinning as it counts toward capital: grants averaged over
 * the time held, side-game flows in full. `granted` is the whole counter (both).
 */
export const moneyIn = (
  granted: number | null | undefined,
  grantedDays: number | null | undefined,
  sideFlows: number | null | undefined,
  fromMs: number,
  toMs: number,
) => {
  const side = sideFlows || 0;
  return averageGranted((granted || 0) - side, grantedDays, fromMs, toMs) + side;
};

/** The grantedDays counter since pinning, or undefined for an old baseline. */
export const grantedDaysSince = (userData: UserData | null | undefined): number | undefined => {
  const pinned = userData?.seasonBaseline?.grantedDays;
  return pinned === undefined ? undefined : (userData!.grantedDays || 0) - pinned;
};

/** A fresh tally, for a player being pinned (or re-pinned) now. */
export const freshMarginTally = (
  seasonId: string,
  marginUsed: number | null | undefined,
  now: number,
): MarginTally => ({
  seasonId,
  dd: 0,
  amount: round2(Math.max(0, marginUsed || 0)),
  at: now,
});

/**
 * The money a player traded with this season, the denominator of their return.
 *
 * Starting value, plus ladder cash at the start, plus what they owed on margin
 * on average, plus money that came in since (grants, dividends, ladder
 * withdrawals beyond what was parked at the start), averaged over the time held.
 * Money in is still taken off the gain in full; `granted` here is the average. Owing
 * $5k all season on a $10k account measures it against $15k, so margin makes no
 * percentage bigger, only the real profit.
 */
export const seasonCapital = (
  baseline: SeasonBaseline | null | undefined,
  { granted, margin }: { granted?: number; margin?: number } = {},
) => {
  const ladder = baseline?.ladder || 0;
  return (baseline?.value || 0) + ladder + Math.max(0, margin || 0) + Math.max(0, (granted || 0) - ladder);
};
