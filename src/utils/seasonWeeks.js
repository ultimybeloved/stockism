// Turning the season's weekly record into the numbers a player can read.
//
// The server stores raw measurements only — portfolio value, granted value since
// the baseline, the market index, largest holding, total holdings. No verdicts,
// so the tier rule can change at any point and every past week rescores from the
// same rows. Everything below is derivation. Nothing here is stored.
//
// Record shape (functions/services/season.js, buildWeekRecord):
//   s season id   w week   t timestamp   v portfolio value
//   g granted since the season baseline  x index value
//   c largest single holding's value     h total value of all holdings

/**
 * Per-week figures, oldest first.
 *
 * Week 1 is measured against a synthetic week 0 built from the season baseline,
 * so the first week is treated exactly like every other one.
 */
export const deriveSeasonWeeks = (seasonWeeks, { seasonId, baselineValue, indexAtStart }) => {
  if (!(baselineValue > 0) || !(indexAtStart > 0)) return [];

  const rows = (seasonWeeks || [])
    .filter((r) => r && r.s === seasonId && r.w > 0)
    .sort((a, b) => a.w - b.w);
  if (!rows.length) return [];

  const derived = [];
  let prev = { v: baselineValue, g: 0, x: indexAtStart };

  for (const r of rows) {
    // Free money collected during the week is stripped before the week is
    // scored, the same way the season total strips it.
    const grantsThisWeek = (r.g || 0) - (prev.g || 0);
    const weekReturn = prev.v > 0
      ? (((r.v - grantsThisWeek) - prev.v) / prev.v) * 100
      : 0;
    const weekIndex = prev.x > 0 ? ((r.x - prev.x) / prev.x) * 100 : 0;

    derived.push({
      week: r.w,
      totalReturn: ((r.v - (r.g || 0) - baselineValue) / baselineValue) * 100,
      totalIndex: ((r.x - indexAtStart) / indexAtStart) * 100,
      weekReturn,
      weekIndex,
      beat: weekReturn > weekIndex,
      // Of invested money, not of the whole portfolio: someone sitting 90% in
      // cash isn't making a concentrated bet, they're making a small one.
      concentration: r.h > 0 ? r.c / r.h : 0,
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
export const summariseSeasonWeeks = (derived) => {
  if (!derived || !derived.length) return null;
  const last = derived[derived.length - 1];
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
export const buildSeasonSeries = (derived, { width = 300, height = 90, pad = 4 } = {}) => {
  if (!derived || !derived.length) return null;

  const you = [0, ...derived.map((d) => d.totalReturn)];
  const market = [0, ...derived.map((d) => d.totalIndex)];
  const all = [...you, ...market];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = (max - min) || 1;

  const toPoints = (values) => values.map((v, i) => {
    const x = pad + (i / Math.max(1, values.length - 1)) * (width - pad * 2);
    const y = height - pad - ((v - min) / span) * (height - pad * 2);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');

  // Where 0% sits, so the chart can show the line you're actually being measured
  // against when both series are above or below it.
  const zeroY = height - pad - ((0 - min) / span) * (height - pad * 2);

  return { you: toPoints(you), market: toPoints(market), zeroY, min, max, width, height };
};
