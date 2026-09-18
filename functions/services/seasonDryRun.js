'use strict';
// Season dry run: what the season rules WOULD do, with no season running.
//
// The Thursdays before season 1 are test weeks. The flashback arc is wrapping
// up and season 1 waits for the next arc, so this watches live players go
// through the real rules in the meantime.
//
// It writes NOTHING to player documents and hands out nothing: one report
// document a week, and a reader that scores those reports with the same
// functions the real season uses (seasonTiers.js). Cost is one user scan and one
// document write a week.
const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const db = admin.firestore();

const { ADMIN_UID, ACTIVE_USER_WINDOW_MS, SEASON_MIN_BASELINE } = require('../constants');
const { netEquityAt, getLastActiveMs, readIndexNow, round2 } = require('../helpers');
const {
  DEFAULT_SEASON_RULES, checkpointTier, rankTopTiers, topTierSlots,
} = require('./seasonTiers');

const dryRuns = () => db.collection('seasonDryRuns');
// Reports are keyed by the day they ran, so re-running one replaces it.
const weekIdOf = (ms) => new Date(ms).toISOString().slice(0, 10);
// Enough to cover any wait for an arc to finish without an unbounded read.
const MAX_WEEKS_READ = 30;

/**
 * One player's row. The same raw numbers a real season week record holds, and
 * deliberately no verdicts: the rules can change between now and season 1 and
 * every recorded week still rescores.
 *
 *   v net equity   g the granted-value counter   c largest holding   h all holdings
 */
const buildRow = (uid, u, prices) => {
  let largest = 0;
  let total = 0;
  for (const [ticker, shares] of Object.entries(u.holdings || {})) {
    if (!(shares > 0)) continue;
    const value = (prices[ticker] || 0) * shares;
    total += value;
    if (value > largest) largest = value;
  }
  return {
    uid,
    n: u.displayName || 'Anonymous',
    v: netEquityAt(u, prices),
    g: round2(u.grantedValue || 0),
    c: round2(largest),
    h: round2(total),
  };
};

/**
 * Score every recorded week with the real rules.
 *
 * A player's first appearance is their baseline, exactly as a mid-season signup
 * is pinned when they join. Weeks they are missing from count as weeks they did
 * not beat the market, which is what the real Diamond rule does.
 *
 * "Active weeks" here is how many reports a player appears in. A report only
 * holds players active in the last 14 days, so it is the same idea as the real
 * count without needing a season to be running.
 */
const scoreDryRuns = (weeks, rules = DEFAULT_SEASON_RULES) => {
  const ordered = [...(weeks || [])].filter((w) => w && Array.isArray(w.rows)).sort((a, b) => a.ranAt - b.ranAt);
  if (ordered.length < 2) {
    return { weeks: ordered.length, scored: [], tierCounts: {}, slots: { platinum: 0, diamond: 0 }, belowFloor: 0 };
  }

  const state = new Map();
  for (const week of ordered) {
    for (const row of week.rows) {
      const seen = state.get(row.uid);
      if (!seen) {
        // The week they first appear is their starting line, not a scored week.
        state.set(row.uid, {
          name: row.n, base: row.v, baseGranted: row.g, baseIndex: week.index,
          prev: row, prevIndex: week.index, last: row, lastIndex: week.index,
          beat: 0, appearances: 1, peak: row.h > 0 ? row.c / row.h : 0,
        });
        continue;
      }
      const grantsThisWeek = row.g - seen.prev.g;
      const weekReturn = seen.prev.v > 0 ? ((row.v - grantsThisWeek) - seen.prev.v) / seen.prev.v : 0;
      const weekIndex = seen.prevIndex > 0 ? (week.index - seen.prevIndex) / seen.prevIndex : 0;
      if (weekReturn > weekIndex) seen.beat++;
      const concentration = row.h > 0 ? row.c / row.h : 0;
      if (concentration > seen.peak) seen.peak = concentration;
      seen.name = row.n;
      seen.prev = row;
      seen.prevIndex = week.index;
      seen.last = row;
      seen.lastIndex = week.index;
      seen.appearances++;
    }
  }

  // Every gap between reports is a scored week, so a player who skipped some
  // is measured against the same denominator as everyone else.
  const scoredWeeks = ordered.length - 1;
  const scored = [];
  let belowFloor = 0;
  for (const [uid, s] of state) {
    if (s.base < SEASON_MIN_BASELINE) { belowFloor++; continue; }
    if (s.appearances < 2) continue;
    const granted = s.last.g - s.baseGranted;
    const returnPercent = ((s.last.v - granted) - s.base) / s.base * 100;
    const marketPercent = s.baseIndex > 0 ? ((s.lastIndex - s.baseIndex) / s.baseIndex) * 100 : 0;
    scored.push({
      uid,
      name: s.name,
      returnPercent: Math.round(returnPercent * 10) / 10,
      marketPercent: Math.round(marketPercent * 10) / 10,
      excess: Math.round((returnPercent - marketPercent) * 10) / 10,
      beatWeeks: s.beat,
      weeks: scoredWeeks,
      beatShare: scoredWeeks ? s.beat / scoredWeeks : 0,
      peakConcentration: Math.round(s.peak * 1000) / 1000,
      activeWeeks: s.appearances,
    });
  }

  // The same two functions the real season uses, so this is a rehearsal rather
  // than a second implementation that could disagree with it.
  const ranked = rankTopTiers(scored, rules);
  const tierCounts = {};
  for (const p of scored) {
    p.tier = ranked.get(p.uid)
      || checkpointTier({ returnPercent: p.returnPercent, marketPercent: p.marketPercent, activeWeeks: p.activeWeeks }, rules);
    if (p.tier) tierCounts[p.tier] = (tierCounts[p.tier] || 0) + 1;
  }
  scored.sort((a, b) => b.excess - a.excess);

  return {
    weeks: scoredWeeks,
    reports: ordered.length,
    from: ordered[0].weekId,
    to: ordered[ordered.length - 1].weekId,
    marketPercent: ordered[0].index > 0
      ? Math.round(((ordered[ordered.length - 1].index - ordered[0].index) / ordered[0].index) * 1000) / 10
      : 0,
    scored,
    tierCounts,
    slots: topTierSlots(scored.length, rules),
    belowFloor,
  };
};

/** Take this week's snapshot. Skips itself once a real season is running. */
const runSeasonDryRun = async () => {
  const seasonSnap = await db.collection('market').doc('season').get();
  if (seasonSnap.exists && seasonSnap.data().status === 'active') {
    return { ran: false, reason: 'a season is running' };
  }

  const now = Date.now();
  const [{ prices, value: indexValue }, snap] = await Promise.all([
    readIndexNow(),
    db.collection('users')
      .select('cash', 'holdings', 'shorts', 'marginUsed', 'grantedValue', 'isBot', 'isBanned',
        'displayName', 'lastSynced', 'lastActive', 'lastTradeTime', 'lastCheckin')
      .get(),
  ]);

  const rows = [];
  snap.forEach((doc) => {
    const u = doc.data();
    if (u.isBot || u.isBanned) return;
    // Same field the season board uses, so the rehearsal has the same cast.
    if (getLastActiveMs(u) < now - ACTIVE_USER_WINDOW_MS) return;
    rows.push(buildRow(doc.id, u, prices));
  });

  const weekId = weekIdOf(now);
  await dryRuns().doc(weekId).set({
    weekId, ranAt: now, index: round2(indexValue), players: rows.length, rows,
  });

  console.log(`SEASON DRY RUN ${weekId}: ${rows.length} players, index ${indexValue.toFixed(2)}`);
  return { ran: true, weekId, players: rows.length, index: round2(indexValue) };
};

exports.buildRow = buildRow;
exports.scoreDryRuns = scoreDryRuns;
exports.runSeasonDryRun = runSeasonDryRun;

// Thursday 14:05 UTC, five minutes after the real checkpoint's slot and inside
// the halt, so prices are frozen and the rehearsal lines up with what a real
// checkpoint would have seen.
exports.seasonDryRun = cf({ timeoutSeconds: 540 }).pubsub
  .schedule('5 14 * * 4')
  .timeZone('UTC')
  .onRun(async () => {
    await runSeasonDryRun();
    return null;
  });

exports.triggerSeasonDryRun = cf({ timeoutSeconds: 540 }).https.onCall(async (data, context) => {
  requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }
  return runSeasonDryRun();
});

/** What the tiers would look like if this had been a real season. */
exports.adminSeasonDryRunReport = cf({ timeoutSeconds: 300 }).https.onCall(async (data, context) => {
  requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const snap = await dryRuns().orderBy('ranAt', 'desc').limit(MAX_WEEKS_READ).get();
  const report = scoreDryRuns(snap.docs.map((d) => d.data()));
  return {
    success: true,
    generatedAt: Date.now(),
    ...report,
    // The whole field is useful for counts, but only the top of it is readable.
    scored: report.scored.slice(0, 25),
    players: report.scored.length,
  };
});
