'use strict';
// Season records: the weekly record each checkpoint writes, who belongs on the
// board, and one player's board entry. Shared by season.js (start, checkpoint,
// end, standings).
//
// INTERNAL MODULE — required by season.js, never listed in servicePaths.js.
const { ONE_WEEK_MS, ACTIVE_USER_WINDOW_MS } = require('../constants');
const { getLastActiveMs } = require('../helpers');
const {
  baselineIndexFor, seasonScore, weeklyRecordSummary, divisionFor, rulesFor, seasonAccountSize, marginDollarDays,
} = require('./seasonTiers');

// A season's weekly record is capped. Far longer than any arc, and it stops one
// very long season from growing the user doc without bound.
const SEASON_WEEK_RECORD_CAP = 80;

/**
 * One week's raw measurements for a player. Deliberately NOT a verdict.
 *
 * Storing "beat the index: true" would marry the season to whatever tier rule
 * shipped with it. Storing the underlying numbers means the rule can change at
 * any point, mid-season included, and every past week can be rescored from the
 * record.
 *
 *   v  net equity at checkpoint prices   g  granted value since the season baseline
 *   x  market index now                  c  value of the single largest holding
 *   h  total value of all holdings       d  dollar-days owed on margin since pinning
 *
 * Cumulative return, weekly return, excess over the index and concentration are
 * all derivable from consecutive entries. None of them are stored.
 */
const buildWeekRecord = ({ season, weeks, userData, prices, indexValue, now = Date.now() }) => {
  const holdings = userData.holdings || {};
  let largest = 0;
  let total = 0;
  for (const [ticker, shares] of Object.entries(holdings)) {
    if (!(shares > 0)) continue;
    const value = (prices[ticker] || 0) * shares;
    total += value;
    if (value > largest) largest = value;
  }
  const baselineGranted = userData.seasonBaseline?.granted || 0;
  return {
    s: season.id,
    w: weeks,
    t: now,
    v: Math.round((userData.portfolioValue || 0) * 100) / 100,
    g: Math.round(((userData.grantedValue || 0) - baselineGranted) * 100) / 100,
    x: Math.round(indexValue * 100) / 100,
    c: Math.round(largest * 100) / 100,
    h: Math.round(total * 100) / 100,
    // Averages come from the difference between two of these, over the time between.
    d: Math.round(marginDollarDays(userData, season.id, now) * 100) / 100,
  };
};

/** Append this week's record, dropping any left over from an earlier season. */
const appendWeekRecord = (existing, record) => {
  const kept = (Array.isArray(existing) ? existing : [])
    .filter((e) => e && e.s === record.s && e.w !== record.w);
  return [...kept, record].slice(-SEASON_WEEK_RECORD_CAP);
};

const latestWeekRecord = (seasonWeeks, seasonId) => (Array.isArray(seasonWeeks) ? seasonWeeks : [])
  .filter((r) => r && r.s === seasonId)
  .reduce((latest, r) => (!latest || r.w > latest.w ? r : latest), null);

const weeksElapsed = (startedAt) =>
  Math.max(1, Math.ceil((Date.now() - startedAt) / ONE_WEEK_MS));

/**
 * Whether a player belongs on the season standings board.
 *
 * adminStartSeason pins a baseline for EVERY non-bot account, so without this
 * the board fills up with people who signed up once and never came back, sitting
 * at roughly 0%. Platinum and Diamond places are shares of this board, so padding
 * it would also hand out places that nobody on it earned.
 *
 * Two ways to qualify, and both are needed. Banked active weeks cover a player
 * who competed early and went quiet, and there are none of those before the
 * first checkpoint, so recent activity covers week one. Same lastActive
 * definition the rest of the app uses.
 */
const isSeasonParticipant = (userData, season, now = Date.now()) => {
  const activeWeeks = (userData?.seasonActiveWeeks?.seasonId === season?.id)
    ? (userData.seasonActiveWeeks.weeks || 0) : 0;
  if (activeWeeks > 0) return true;
  return getLastActiveMs(userData) >= now - ACTIVE_USER_WINDOW_MS;
};

/**
 * One player scored for the board: where they stand, their banked tier, their
 * size division, and the two figures Diamond is judged on. Null if they can't be
 * scored.
 */
const boardEntry = (uid, u, season, { value, indexNow, granted, margin }) => {
  const score = seasonScore(u, season, { value, indexNow, granted, margin });
  if (!score) return null;
  const summary = weeklyRecordSummary(u.seasonWeeks, {
    seasonId: season.id,
    baselineValue: u.seasonBaseline.value,
    baselineIndex: baselineIndexFor(u.seasonBaseline, season),
    pinnedAt: u.seasonBaseline.pinnedAt,
  }, (season.checkpointWeeks || []).length);
  return {
    uid,
    ...score,
    // Set by the pinned baseline, so a good month never moves anyone up a division.
    division: divisionFor(seasonAccountSize(u.seasonBaseline), rulesFor(season)),
    tier: (u.seasonTier?.seasonId === season.id) ? u.seasonTier.tier : null,
    activeWeeks: (u.seasonActiveWeeks?.seasonId === season.id) ? (u.seasonActiveWeeks.weeks || 0) : 0,
    beatShare: summary.beatShare,
    peakConcentration: summary.peakConcentration,
  };
};

module.exports = {
  buildWeekRecord,
  appendWeekRecord,
  latestWeekRecord,
  weeksElapsed,
  isSeasonParticipant,
  boardEntry,
};
