// Turning the season's weekly record into the numbers a player can read.
//
// The server stores raw measurements only — portfolio value, granted value since
// the baseline, the market index, largest holding, total holdings. No verdicts,
// so the tier rule can change at any point and every past week rescores from the
// same rows. Everything below is derivation. Nothing here is stored.
//
// Record shape (functions/src/season/seasonRecords.ts):
//   s season id   w week   t timestamp   v portfolio value
//   g granted since the season baseline  x index value
//   c largest single holding's value     h total value of all holdings
//   d dollar-days owed on margin since the baseline was pinned
//   a grantedDays counter since the baseline (when grants arrived; absent on
//     records from before the counter existed)
//   f ladder + prediction flows since the baseline (part of g, counted in full)

import { averageOwed, moneyIn, seasonCapital, weekConcentration, weekGranted, weekMargin } from '../rules/seasonMoney';
import type { SeasonWeekRecord } from '../rules/seasonMoney';

// The season money maths is the shared rule module the server scores with.
export {
  seasonAccountSize,
  marginDollarDays,
  seasonAverageMargin,
  weekMargin,
  grantedDaysFor,
  averageGranted,
  moneyIn,
  weekGranted,
  seasonCapital,
  weekConcentration,
} from '../rules/seasonMoney';
export type { SeasonWeekRecord, MoneyBaseline as SeasonBaseline } from '../rules/seasonMoney';

export interface DerivedSeasonWeek {
  week: number;
  totalReturn: number;
  totalIndex: number;
  weekReturn: number;
  weekIndex: number;
  beat: boolean;
  concentration: number;
}

/**
 * Per-week figures, oldest first.
 *
 * Week 1 is measured against a synthetic week 0 built from the season baseline,
 * so the first week is treated exactly like every other one.
 */
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
    // against what was traded with, borrowing included. The server's
    // weeklyRecordSummary (seasonTiers.ts) runs the same rule.
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
