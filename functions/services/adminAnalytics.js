'use strict';
// Read-only measurements used to make design decisions, not to change state.
//
// Built because season tier thresholds were being guessed at. Tiers are now
// shares of the season board rather than fixed targets (services/seasonTiers.js),
// so this is a health check on the field: how active players are doing with free
// money removed, next to the market over the same days.
const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const db = admin.firestore();
const { ADMIN_UID, THIRTY_DAYS_MS, ONE_WEEK_MS, SEASON_DIVISIONS } = require('../constants');
const { grantedTotalAt, toMs } = require('../helpers');

// The season size divisions. Assignment uses the value at the START of the
// window, so a player's division can't shift because they had a good month.
const DIVISIONS = SEASON_DIVISIONS;

// Accounts below this at the start of the window are dropped. A $40 account that
// receives a $300 drop reads +650% and tells us nothing about trading skill;
// mirrors LEADERBOARD_PERCENT_MIN_BASELINE, which exists for the same reason.
const MIN_BASELINE = 1000;

// A player's 30-day figures are only rewritten when they open the app, so one
// last seen three weeks ago is sitting on a window that ended three weeks ago.
// Only windows that ended within this long are measured.
const MAX_WINDOW_AGE_MS = ONE_WEEK_MS;

// "What return do you need to be in the top N%" — sorted descending, so index
// 0 is the best performer.
const topPercentile = (sortedDesc, p) => {
  if (!sortedDesc.length) return null;
  const idx = Math.min(sortedDesc.length - 1, Math.max(0, Math.floor((p / 100) * sortedDesc.length) - 1));
  return sortedDesc[idx];
};

const round1 = (v) => Math.round(v * 10) / 10;

const summarise = (returns) => {
  const sorted = [...returns].sort((a, b) => b - a);
  const cuts = {};
  for (const p of [1, 3, 5, 10, 25, 50]) {
    const v = topPercentile(sorted, p);
    cuts[`top${p}`] = v === null ? null : round1(v);
  }
  return {
    count: sorted.length,
    best: sorted.length ? round1(sorted[0]) : null,
    worst: sorted.length ? round1(sorted[sorted.length - 1]) : null,
    median: cuts.top50,
    positive: sorted.filter(r => r > 0).length,
    cuts,
  };
};

/** Return and return-over-the-market for one group of players. */
const summariseGroup = (rows) => {
  const vsMarket = summarise(rows.map((r) => r.excess));
  return {
    ...summarise(rows.map((r) => r.ret)),
    excessCuts: vsMarket.cuts,
    excessMedian: vsMarket.median,
    beatMarket: vsMarket.positive,
  };
};

/** Newest daily index point at or before `ts`, or the oldest point if none is that old. */
const indexAt = (history, ts) => {
  let pick = history[0];
  for (const h of history) {
    if (h.t > ts) break;
    pick = h;
  }
  return pick?.v || 0;
};

/**
 * 30-day return, overall and per division, with free money removed and the
 * market's move over each player's own 30 days alongside.
 *
 * Each player is measured over their own window: from portfolioSnapshot30d (the
 * value ~30 days before it was last refreshed, or at signup for a newer account)
 * to portfolioValue (their last login). On 2026-09-13, 251 of 315 players had a
 * window that ended more than two days earlier, and counting them read the top
 * of the table about four times too high.
 *
 * Values include margin loans, as the stored portfolioValue always has. Season
 * scoring subtracts them; this can't, having no loan figure for the window start.
 */
exports.adminReturnDistribution = cf({ timeoutSeconds: 300 }).https.onCall(async (data, context) => {
  requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const minBaseline = typeof data?.minBaseline === 'number' ? data.minBaseline : MIN_BASELINE;
  const now = Date.now();

  const [snap, idxSnap] = await Promise.all([
    db.collection('users')
      .select('portfolioValue', 'portfolioSnapshot30d', 'isBot', 'isBanned', 'createdAt', 'lastSynced',
        'grantedValue', 'grantedSamples')
      .get(),
    db.collection('market').doc('indexHistory').get(),
  ]);
  const history = ((idxSnap.exists && idxSnap.data().history) || [])
    .filter((h) => h && h.t > 0 && h.v > 0)
    .sort((a, b) => a.t - b.t);

  const skipped = { bots: 0, banned: 0, noSnapshot: 0, staleWindow: 0, belowBaseline: 0 };
  const all = [];
  const byDivision = {};
  for (const d of DIVISIONS) byDivision[d.id] = [];
  // How the free money was worked out. Exact means a daily sample existed from
  // the start of the window. Otherwise the oldest sample stands in, which can only
  // under-count grants, so those players still read a little high.
  const grants = { exact: 0, lowerBound: 0, none: 0, total: 0 };

  snap.forEach((doc) => {
    const u = doc.data();
    if (u.isBot) { skipped.bots++; return; }
    if (u.isBanned) { skipped.banned++; return; }

    const baseline = u.portfolioSnapshot30d?.value;
    if (!baseline || baseline <= 0) { skipped.noSnapshot++; return; }
    const refreshedAt = toMs(u.portfolioSnapshot30d.refreshedAt);
    if (refreshedAt < now - MAX_WINDOW_AGE_MS) { skipped.staleWindow++; return; }
    if (baseline < minBaseline) { skipped.belowBaseline++; return; }

    const end = toMs(u.lastSynced) || refreshedAt;
    const start = Math.max(refreshedAt - THIRTY_DAYS_MS, toMs(u.createdAt));

    const atStart = grantedTotalAt(u, start);
    const atEnd = grantedTotalAt(u, end);
    const granted = (atStart === null || atEnd === null) ? 0 : atEnd - atStart;
    if (atStart === null) grants.none++;
    else if (u.grantedSamples.some((s) => s && s.ts <= start)) grants.exact++;
    else grants.lowerBound++;
    grants.total += granted;

    const ret = (((u.portfolioValue || 0) - granted - baseline) / baseline) * 100;
    const idxStart = indexAt(history, start);
    const market = idxStart > 0 ? ((indexAt(history, end) - idxStart) / idxStart) * 100 : 0;
    const row = { ret, excess: ret - market };

    all.push(row);
    const div = DIVISIONS.find(d => baseline >= d.min && (d.max === null || baseline < d.max));
    if (div) byDivision[div.id].push(row);
  });

  const marketStart = indexAt(history, now - THIRTY_DAYS_MS);
  const marketEnd = history.length ? history[history.length - 1].v : 0;

  return {
    success: true,
    windowDays: 30,
    minBaseline,
    generatedAt: now,
    totalDocs: snap.size,
    skipped,
    marketLast30: marketStart > 0 ? round1(((marketEnd - marketStart) / marketStart) * 100) : null,
    overall: summariseGroup(all),
    divisions: DIVISIONS.map(d => ({
      id: d.id,
      label: d.label,
      min: d.min,
      max: d.max,
      ...summariseGroup(byDivision[d.id]),
    })),
    grantCoverage: {
      playersMeasured: all.length,
      exact: grants.exact,
      lowerBound: grants.lowerBound,
      none: grants.none,
      grantedTotal: Math.round(grants.total),
    },
  };
});
