'use strict';
// Read-only measurements used to make design decisions, not to change state.
//
// Exists because season tier thresholds ("what return puts a player in the top
// 5%?") were being guessed at. The weekly percent leaderboard can't answer it —
// it is one week, capped at 50 rows, and its top entries are dominated by free
// money landing on near-empty accounts rather than by trading.
const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const db = admin.firestore();
const { ADMIN_UID } = require('../constants');

// Division boundaries by portfolio value at the START of the window, matching
// the season proposal. Assignment uses the baseline, not the current value —
// a player's division must not shift because they had a good month.
const DIVISIONS = [
  { id: 'rookie', label: 'Rookie', min: 0, max: 10000 },
  { id: 'trader', label: 'Trader', min: 10000, max: 50000 },
  { id: 'whale', label: 'Whale', min: 50000, max: 200000 },
  { id: 'titan', label: 'Titan', min: 200000, max: Infinity },
];

// Accounts below this at the start of the window are dropped. A $40 account that
// receives a $300 drop reads +650% and tells us nothing about trading skill;
// mirrors LEADERBOARD_PERCENT_MIN_BASELINE, which exists for the same reason.
const MIN_BASELINE = 1000;

// "What return do you need to be in the top N%" — sorted descending, so index
// 0 is the best performer.
const topPercentile = (sortedDesc, p) => {
  if (!sortedDesc.length) return null;
  const idx = Math.min(sortedDesc.length - 1, Math.max(0, Math.floor((p / 100) * sortedDesc.length) - 1));
  return sortedDesc[idx];
};

const summarise = (returns) => {
  const sorted = [...returns].sort((a, b) => b - a);
  const cuts = {};
  for (const p of [1, 3, 5, 10, 25, 50]) {
    const v = topPercentile(sorted, p);
    cuts[`top${p}`] = v === null ? null : Math.round(v * 10) / 10;
  }
  return {
    count: sorted.length,
    best: sorted.length ? Math.round(sorted[0] * 10) / 10 : null,
    worst: sorted.length ? Math.round(sorted[sorted.length - 1] * 10) / 10 : null,
    median: cuts.top50,
    positive: sorted.filter(r => r > 0).length,
    cuts,
  };
};

/**
 * Distribution of 30-day portfolio return, overall and per proposed division.
 *
 * Uses portfolioSnapshot30d, which is the user's ACTUAL value 30 days ago read
 * from portfolioHistory (refreshed daily) — not the rolling 24h/7d snapshots,
 * which are only "the last time this was older than the window" and so cover an
 * unpredictable span.
 *
 * CAVEAT the caller must not forget: this cannot subtract granted value. Nothing
 * has been tracking daily drops, check-ins, mission rewards or admin giveaways
 * per account, so the returns below still contain free money. They are an upper
 * bound on real trading return. Once seasonGranted is being accumulated, the
 * same percentiles recomputed will come in lower — expect to lower thresholds.
 */
exports.adminReturnDistribution = cf({ timeoutSeconds: 300 }).https.onCall(async (data, context) => {
  requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const minBaseline = typeof data?.minBaseline === 'number' ? data.minBaseline : MIN_BASELINE;

  const snap = await db.collection('users')
    .select('portfolioValue', 'portfolioSnapshot30d', 'isBot', 'createdAt')
    .get();

  const skipped = { bots: 0, noSnapshot: 0, belowBaseline: 0 };
  const all = [];
  const byDivision = {};
  for (const d of DIVISIONS) byDivision[d.id] = [];

  snap.forEach((doc) => {
    const u = doc.data();
    if (u.isBot) { skipped.bots++; return; }

    const baseline = u.portfolioSnapshot30d?.value;
    if (!baseline || baseline <= 0) { skipped.noSnapshot++; return; }
    if (baseline < minBaseline) { skipped.belowBaseline++; return; }

    const current = u.portfolioValue || 0;
    const ret = ((current - baseline) / baseline) * 100;

    all.push(ret);
    const div = DIVISIONS.find(d => baseline >= d.min && baseline < d.max);
    if (div) byDivision[div.id].push(ret);
  });

  const divisions = DIVISIONS.map(d => ({
    id: d.id,
    label: d.label,
    min: d.min,
    max: d.max === Infinity ? null : d.max,
    ...summarise(byDivision[d.id]),
  }));

  return {
    success: true,
    windowDays: 30,
    minBaseline,
    generatedAt: Date.now(),
    totalDocs: snap.size,
    skipped,
    overall: summarise(all),
    divisions,
    note: 'Returns still include granted value (drops, check-ins, missions, admin giveaways). Treat as an upper bound.',
  };
});
