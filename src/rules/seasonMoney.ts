// Season money maths: margin averaged over the season, money that came in
// (grants, dividends, ladder and prediction flows), and the money a player
// traded with. Shared rule module (see src/rules/ladder.ts for what that means):
// the season card and chart run the code the server scores tiers with.
// functions/src/season/seasonTiers.ts explains the rules in full.

import { SEASON_DIAMOND_CONCENTRATION_MIN_INVESTED } from './seasons';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One weekly checkpoint record (users/{uid}.seasonWeeks[]). Short keys keep the
 * user doc small; the server's seasonRecords.ts writes them.
 */
export interface SeasonWeekRecord {
  /** season id */
  s?: string;
  /** week number, 1-based */
  w: number;
  /** net value at the checkpoint */
  v: number;
  /** market index at the checkpoint */
  x: number;
  /** checkpoint time, epoch ms */
  t: number;
  /** granted value to date */
  g?: number;
  /** granted dollar-days to date */
  a?: number;
  /** side-game flows to date */
  f?: number;
  /** margin dollar-days to date */
  d?: number;
  /** invested dollars */
  h?: number;
  /** dollars in the largest single position */
  c?: number;
}

/** The parts of a season baseline the money maths reads. */
export interface MoneyBaseline {
  value?: number;
  ladder?: number;
  pinnedAt?: number;
}

/** The running margin tally on the user (`seasonMargin`). */
export interface MarginTallyFields {
  seasonId?: string;
  dd?: number;
  amount?: number;
  at?: number;
}

/** The user-doc fields the margin maths reads. */
export interface SeasonMoneyUser {
  seasonMargin?: MarginTallyFields | null;
  seasonBaseline?: MoneyBaseline | null;
}

/** Account size at pinning: value plus ladder cash. Sets the floor and division. */
export const seasonAccountSize = (baseline: MoneyBaseline | null | undefined): number =>
  (baseline?.value || 0) + (baseline?.ladder || 0);

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

/** The player's tally for this season, or an empty one from their pinning. */
export const marginTally = (userData: SeasonMoneyUser | null | undefined, seasonId: string): MarginTallyFields => {
  const t = userData?.seasonMargin;
  if (t && t.seasonId === seasonId) return t;
  return { seasonId, dd: 0, amount: 0, at: userData?.seasonBaseline?.pinnedAt || 0 };
};

/** Dollar-days owed on margin from pinning up to `now`. */
export const marginDollarDays = (
  userData: SeasonMoneyUser | null | undefined,
  seasonId: string,
  now: number = Date.now(),
): number => {
  const t = marginTally(userData, seasonId);
  const since = t.at && t.at > 0 ? Math.max(0, now - t.at) : 0;
  return (t.dd || 0) + (t.amount || 0) * (since / DAY_MS);
};

/** Dollar-days over a span, as the average owed across it. */
export const averageOwed = (dollarDays: number, fromMs: number, toMs: number, fallback = 0): number => {
  const days = (toMs - fromMs) / DAY_MS;
  return days > 0 ? Math.max(0, dollarDays) / days : fallback;
};

/** What the player has owed on average since they were pinned. */
export const seasonAverageMargin = (
  userData: SeasonMoneyUser | null | undefined,
  seasonId: string,
  now: number = Date.now(),
): number =>
  averageOwed(
    marginDollarDays(userData, seasonId, now),
    userData?.seasonBaseline?.pinnedAt || now,
    now,
    marginTally(userData, seasonId).amount || 0,
  );

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

/** Amount x day it landed: what the server adds to grantedDays for a booking. */
export const grantedDaysFor = (amount: number, now: number = Date.now()): number => amount * (now / DAY_MS);

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
): number => {
  if (grantedDays === undefined || grantedDays === null) return granted || 0;
  const days = (toMs - fromMs) / DAY_MS;
  if (!(days > 0)) return 0;
  const g = granted || 0;
  const avg = (g * (toMs / DAY_MS) - grantedDays) / days;
  // Never more than counting it all in full, never past zero. A booking that
  // missed the time counter would otherwise read as held since 1970.
  return Math.min(Math.max(avg, Math.min(0, g)), Math.max(0, g));
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
): number => {
  const side = sideFlows || 0;
  return averageGranted((granted || 0) - side, grantedDays, fromMs, toMs) + side;
};

/**
 * The money a player traded with this season, the denominator of their return.
 *
 * Starting value, plus ladder cash at the start, plus what they owed on margin
 * on average, plus money that came in since (grants, dividends, ladder
 * withdrawals beyond what was parked at the start), averaged over the time held.
 * Money in is still taken off the gain in full; `granted` here is the average.
 * Owing $5k all season on a $10k account measures it against $15k, so margin
 * makes no percentage bigger, only the real profit.
 */
export const seasonCapital = (
  baseline: MoneyBaseline | null | undefined,
  { granted, margin }: { granted?: number; margin?: number } = {},
): number => {
  const ladder = baseline?.ladder || 0;
  return (baseline?.value || 0) + ladder + Math.max(0, margin || 0) + Math.max(0, (granted || 0) - ladder);
};

// ── Between two week records ────────────────────────────────────────────────

/**
 * Average owed on margin between two week records, from their dollar-day
 * counters. Records from before the counter existed count as nothing owed.
 */
export const weekMargin = (r: SeasonWeekRecord, prev: Partial<SeasonWeekRecord> | null | undefined): number =>
  r.d === undefined || !prev || prev.t === undefined || !(prev.t > 0)
    ? 0
    : averageOwed((r.d || 0) - (prev.d || 0), prev.t, r.t);

/** Money in between two week records: grants averaged over the week, flows in full. */
export const weekGranted = (r: SeasonWeekRecord, prev: Partial<SeasonWeekRecord>): number => {
  const g = (r.g || 0) - (prev.g || 0);
  if (r.a === undefined || prev.a === undefined || prev.t === undefined || !(prev.t > 0)) return g;
  return moneyIn(g, r.a - prev.a, (r.f || 0) - (prev.f || 0), prev.t, r.t);
};

/**
 * A week's share of invested money in one character, or 0 when too little of
 * the player's money was invested for it to count (see
 * SEASON_DIAMOND_CONCENTRATION_MIN_INVESTED). Of invested money, not the whole
 * portfolio: someone sitting 90% in cash isn't making a concentrated bet.
 */
export const weekConcentration = (
  r: Pick<SeasonWeekRecord, 'h' | 'v' | 'c'> | null | undefined,
  minInvested: number = SEASON_DIAMOND_CONCENTRATION_MIN_INVESTED,
): number => {
  if (!r || r.h === undefined || !(r.h > 0)) return 0;
  if (r.v > 0 && r.h < r.v * minInvested) return 0;
  return (r.c as number) / r.h;
};
