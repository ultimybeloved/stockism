// Turning the season's weekly record into the numbers a player can read.
//
// The server stores raw measurements only — portfolio value, granted value since
// the baseline, the market index, largest holding, total holdings. No verdicts,
// so the tier rule can change at any point and every past week rescores from the
// same rows. Everything below is derivation. Nothing here is stored.
//
// Record shape (functions/src/season/season.js, buildWeekRecord):
//   s season id   w week   t timestamp   v portfolio value
//   g granted since the season baseline  x index value
//   c largest single holding's value     h total value of all holdings
//   d dollar-days owed on margin since the baseline was pinned
//   a grantedDays counter since the baseline (when grants arrived; absent on
//     records from before the counter existed)
//   f ladder + prediction flows since the baseline (part of g, counted in full)

import { SEASON_DIAMOND_CONCENTRATION_MIN_INVESTED } from '../constants/seasons';

/** Account size at pinning: value plus ladder cash. Mirror of seasonAccountSize in seasonTiers.js. */
/**
 * One weekly checkpoint record (users/{uid}.seasonWeeks[]). Short keys keep the
 * user doc small; see seasonRecords.js on the backend for how each is written.
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

export interface SeasonBaseline {
  value?: number;
  ladder?: number;
  pinnedAt?: number;
}

interface SeasonUserData {
  seasonMargin?: { seasonId?: string; dd?: number; amount?: number; at?: number };
  seasonBaseline?: SeasonBaseline;
}

export interface DerivedSeasonWeek {
  week: number;
  totalReturn: number;
  totalIndex: number;
  weekReturn: number;
  weekIndex: number;
  beat: boolean;
  concentration: number;
}

export const seasonAccountSize = (baseline: SeasonBaseline | null | undefined): number =>
  (baseline?.value || 0) + (baseline?.ladder || 0);

const DAY_MS = 24 * 60 * 60 * 1000;

// Margin owed, averaged over the season. Mirrors of the margin tally helpers in
// seasonTiers.js: `seasonMargin` on the user is { dd dollar-days up to `at`,
// amount owed since `at` }.
const marginTally = (userData: SeasonUserData | null | undefined, seasonId: string) => {
  const t = userData?.seasonMargin;
  if (t && t.seasonId === seasonId) return t;
  return { seasonId, dd: 0, amount: 0, at: userData?.seasonBaseline?.pinnedAt || 0 };
};

/** Dollar-days owed on margin from pinning up to `now`. */
export const marginDollarDays = (
  userData: SeasonUserData | null | undefined,
  seasonId: string,
  now: number = Date.now(),
): number => {
  const t = marginTally(userData, seasonId);
  const since = t.at && t.at > 0 ? Math.max(0, now - t.at) : 0;
  return (t.dd || 0) + (t.amount || 0) * (since / DAY_MS);
};

const averageOwed = (dollarDays: number, fromMs: number, toMs: number, fallback = 0): number => {
  const days = (toMs - fromMs) / DAY_MS;
  return days > 0 ? Math.max(0, dollarDays) / days : fallback;
};

/** What the player has owed on average since they were pinned. */
export const seasonAverageMargin = (
  userData: SeasonUserData | null | undefined,
  seasonId: string,
  now: number = Date.now(),
): number =>
  averageOwed(
    marginDollarDays(userData, seasonId, now),
    userData?.seasonBaseline?.pinnedAt || now,
    now,
    marginTally(userData, seasonId).amount || 0,
  );

/** Average owed between two week records. Older records count as nothing owed. */
export const weekMargin = (r: SeasonWeekRecord, prev: SeasonWeekRecord | null | undefined): number =>
  r.d === undefined || !prev || !(prev.t > 0) ? 0 : averageOwed((r.d || 0) - (prev.d || 0), prev.t, r.t);

/** Amount x day it landed: what the server adds to grantedDays for a booking. */
export const grantedDaysFor = (amount: number, now: number = Date.now()): number => amount * (now / DAY_MS);

/**
 * Money in since pinning, averaged over the time held. Undefined grantedDays
 * (an old baseline or record) counts it in full. Mirror of averageGranted in
 * seasonTiers.js.
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
 * All money in as it counts toward capital: grants averaged over the time held,
 * ladder and prediction flows in full. Mirror of moneyIn in seasonTiers.js.
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

/** Money in between two week records. Mirror of weekGranted. */
export const weekGranted = (r: SeasonWeekRecord, prev: SeasonWeekRecord): number => {
  const g = (r.g || 0) - (prev.g || 0);
  if (r.a === undefined || prev.a === undefined || !(prev.t > 0)) return g;
  return moneyIn(g, r.a - prev.a, (r.f || 0) - (prev.f || 0), prev.t, r.t);
};

/**
 * The money a player traded with this season: starting value, ladder cash at the
 * start, what they owed on margin on average, and money in since (averaged over
 * the time held). The base of every season
 * percentage, so borrowing can't make a return look bigger. Mirror of
 * seasonCapital in seasonTiers.js.
 */
export const seasonCapital = (
  baseline: SeasonBaseline | null | undefined,
  { granted, margin }: { granted?: number; margin?: number } = {},
): number => {
  const ladder = baseline?.ladder || 0;
  return (baseline?.value || 0) + ladder + Math.max(0, margin || 0) + Math.max(0, (granted || 0) - ladder);
};

/**
 * Per-week figures, oldest first.
 *
 * Week 1 is measured against a synthetic week 0 built from the season baseline,
 * so the first week is treated exactly like every other one.
 */
/**
 * A week's share of invested money in one character, or 0 when too little of the
 * player's money was invested for it to count. Mirror of weekConcentration in
 * functions/src/season/seasonTiers.js.
 */
export const weekConcentration = (
  r: SeasonWeekRecord | null | undefined,
  minInvested: number = SEASON_DIAMOND_CONCENTRATION_MIN_INVESTED,
): number => {
  if (!r || r.h === undefined || !(r.h > 0)) return 0;
  if (r.v > 0 && r.h < r.v * minInvested) return 0;
  return (r.c as number) / r.h;
};

export const deriveSeasonWeeks = (
  seasonWeeks: (SeasonWeekRecord | null)[] | null | undefined,
  {
    seasonId,
    baselineValue,
    baselineLadder = 0,
    pinnedAt = 0,
    indexAtStart,
  }: {
    seasonId: string;
    baselineValue: number;
    baselineLadder?: number;
    pinnedAt?: number;
    indexAtStart: number;
  },
): DerivedSeasonWeek[] => {
  if (!(baselineValue > 0) || !(indexAtStart > 0)) return [];

  const rows = (seasonWeeks || [])
    .filter((r): r is SeasonWeekRecord => !!r && r.s === seasonId && r.w > 0)
    .sort((a, b) => a.w - b.w);
  if (!rows.length) return [];

  const derived: DerivedSeasonWeek[] = [];
  let prev: SeasonWeekRecord = {
    w: 0,
    v: baselineValue,
    g: 0,
    a: 0,
    f: 0,
    x: indexAtStart,
    t: pinnedAt,
    d: 0,
  };

  const baseline = { value: baselineValue, ladder: baselineLadder };

  for (const r of rows) {
    // Free money collected during the week is stripped before the week is
    // scored, the same way the season total strips it, and the week is measured
    // against what was traded with, borrowing included. Mirror of
    // weeklyRecordSummary in seasonTiers.js.
    const grantsThisWeek = (r.g || 0) - (prev.g || 0);
    const weekCapital = prev.v + Math.max(0, weekGranted(r, prev)) + weekMargin(r, prev);
    const weekReturn = weekCapital > 0 ? ((r.v - grantsThisWeek - prev.v) / weekCapital) * 100 : 0;
    const weekIndex = prev.x > 0 ? ((r.x - prev.x) / prev.x) * 100 : 0;
    const sinceStart = r.d === undefined ? 0 : averageOwed(r.d, pinnedAt, r.t);
    const capital = seasonCapital(baseline, {
      granted: moneyIn(r.g, r.a, r.f, pinnedAt, r.t),
      margin: sinceStart,
    });

    derived.push({
      week: r.w,
      totalReturn: ((r.v - (r.g || 0) - baselineValue) / capital) * 100,
      totalIndex: ((r.x - indexAtStart) / indexAtStart) * 100,
      weekReturn,
      weekIndex,
      beat: weekReturn > weekIndex,
      // Of invested money, not of the whole portfolio: someone sitting 90% in
      // cash isn't making a concentrated bet, they're making a small one.
      concentration: weekConcentration(r),
    });
    prev = r;
  }
  return derived;
};

/**
 * Season-to-date summary.
 *
 * Reports peak AND average concentration on purpose. The top-tier rule may end
 * up being "never went above X" or "averaged under X", and this way the screen
 * already shows whichever one gets picked.
 */
export const summariseSeasonWeeks = (derived: DerivedSeasonWeek[] | null | undefined) => {
  if (!derived || !derived.length) return null;
  const last = derived[derived.length - 1]!;
  const beatCount = derived.filter((d) => d.beat).length;
  const concentrations = derived.map((d) => d.concentration);

  return {
    weeks: derived.length,
    beatCount,
    beatShare: beatCount / derived.length,
    totalReturn: last.totalReturn,
    totalIndex: last.totalIndex,
    excess: last.totalReturn - last.totalIndex,
    peakConcentration: Math.max(...concentrations),
    avgConcentration: concentrations.reduce((s, c) => s + c, 0) / concentrations.length,
  };
};

/**
 * Two same-scaled polyline paths for the season chart.
 *
 * A shared y-scale is the whole point — the player's line and the market's line
 * only mean anything next to each other. Week 0 is prepended at 0% so both lines
 * start from the season's opening instead of from the first checkpoint.
 */
export const buildSeasonSeries = (
  derived: DerivedSeasonWeek[] | null | undefined,
  { width = 300, height = 90, pad = 4 }: { width?: number; height?: number; pad?: number } = {},
) => {
  if (!derived || !derived.length) return null;

  const you = [0, ...derived.map((d) => d.totalReturn)];
  const market = [0, ...derived.map((d) => d.totalIndex)];
  const all = [...you, ...market];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;

  const toPoints = (values: number[]) =>
    values
      .map((v, i) => {
        const x = pad + (i / Math.max(1, values.length - 1)) * (width - pad * 2);
        const y = height - pad - ((v - min) / span) * (height - pad * 2);
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');

  // Where 0% sits, so the chart can show the line you're actually being measured
  // against when both series are above or below it.
  const zeroY = height - pad - ((0 - min) / span) * (height - pad * 2);

  return { you: toPoints(you), market: toPoints(market), zeroY, min, max, width, height };
};
