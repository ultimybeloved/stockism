'use strict';
// Seasons: a competition that runs the length of a story arc, so a player who
// joined last week has something live to chase instead of an all-time board they
// can never reach. Nothing resets — portfolios, achievements and the all-time
// leaderboard are untouched. Only bragging rights are at stake.
//
// Return is measured NET OF GRANTED VALUE (see grantedValueUpdate in helpers.js).
// Measured 2026-08-13, the median player was +67% over 30 days while the median
// stock moved +0.8%; ranking on raw return would rank free-money collection.
//
// Season length is never known ahead of time — an arc ends when "Finale" shows
// up in a chapter title — so the season is ended by an admin button rather than
// a schedule. Who earns which tier is decided in seasonTiers.js.
const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const db = admin.firestore();

const {
  DEFAULT_SEASON_RULES,
  rulesFor,
  tierRank,
  higherTier,
  buildSeasonBaseline,
  baselineIndexFor,
  seasonScore,
  checkpointTier,
  weeklyRecordSummary,
  topTierSlots,
  rankTopTiers,
  seasonTitles,
  lastHaltStart,
} = require('./seasonTiers');
const {
  ADMIN_UID, ONE_WEEK_MS, LEADERBOARD_CACHE_TTL, ACTIVE_USER_WINDOW_MS, SEASON_MIN_BASELINE,
} = require('../constants');
const {
  writeNotification, recordHeartbeat, getLastActiveMs, exitEquityAt, readIndexNow, round2,
} = require('../helpers');

const seasonRef = () => db.collection('market').doc('season');
const BATCH_LIMIT = 400;
// A season's weekly record is capped. Far longer than any arc, and it stops one
// very long season from growing the user doc without bound.
const SEASON_WEEK_RECORD_CAP = 80;

const round1 = (n) => Math.round(n * 10) / 10;

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
 *   h  total value of all holdings
 *
 * Cumulative return, weekly return, excess over the index and concentration are
 * all derivable from consecutive entries. None of them are stored.
 */
const buildWeekRecord = ({ season, weeks, userData, prices, indexValue }) => {
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
    t: Date.now(),
    v: Math.round((userData.portfolioValue || 0) * 100) / 100,
    g: Math.round(((userData.grantedValue || 0) - baselineGranted) * 100) / 100,
    x: Math.round(indexValue * 100) / 100,
    c: Math.round(largest * 100) / 100,
    h: Math.round(total * 100) / 100,
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
 * One player scored for the board: where they stand, their banked tier, and the
 * two figures Diamond is judged on. Null if they can't be scored.
 */
const boardEntry = (uid, u, season, { value, indexNow, granted }) => {
  const score = seasonScore(u, season, { value, indexNow, granted });
  if (!score) return null;
  const summary = weeklyRecordSummary(u.seasonWeeks, {
    seasonId: season.id,
    baselineValue: u.seasonBaseline.value,
    baselineIndex: baselineIndexFor(u.seasonBaseline, season),
  }, (season.checkpointWeeks || []).length);
  return {
    uid,
    ...score,
    tier: (u.seasonTier?.seasonId === season.id) ? u.seasonTier.tier : null,
    activeWeeks: (u.seasonActiveWeeks?.seasonId === season.id) ? (u.seasonActiveWeeks.weeks || 0) : 0,
    beatShare: summary.beatShare,
    peakConcentration: summary.peakConcentration,
  };
};

// Exported for tests. The serviceLoader copies only real Cloud Functions, so
// these never reach index.js.
exports.buildWeekRecord = buildWeekRecord;
exports.isSeasonParticipant = isSeasonParticipant;
exports.appendWeekRecord = appendWeekRecord;

// ── Admin: start a season ────────────────────────────────────────────────────

/**
 * Open a season and pin every player's baseline.
 *
 * The baseline captures net equity, the granted-value counter and the index at
 * the same instant, which is what makes "return net of free money, against the
 * market" computable over an arbitrary window later. One write per user.
 */
exports.adminStartSeason = cf({ timeoutSeconds: 540 }).https.onCall(async (data, context) => {
  requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const { name } = data || {};
  // A preseason is a trial run: same rules, same board, but it doesn't use up a
  // season number and its title reads "Preseason <Tier>", never "Season N".
  const preseason = data?.preseason === true;
  // Started after this week's checkpoint: date the season from this week's halt
  // so this week is week 1, and credit it as an active week to everyone active in
  // the last seven days. Nothing else is banked for it — every return is 0% at
  // the moment of pinning — and it is not a checkpoint week, so Diamond's share
  // of weeks beaten is still out of real checkpoints only.
  const countThisWeek = data?.countThisWeek === true;
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new functions.https.HttpsError('invalid-argument', 'Season name (the arc) is required');
  }

  const existing = await seasonRef().get();
  if (existing.exists && existing.data().status === 'active') {
    throw new functions.https.HttpsError('failed-precondition',
      `Season "${existing.data().name}" is still running. End it first.`);
  }

  // Both counters carry over from whatever ran last, so a preseason never shifts
  // the numbering of the real seasons around it.
  const prev = existing.exists ? existing.data() : {};
  const number = (prev.number || 0) + (preseason ? 0 : 1);
  const preseasons = (prev.preseasons || 0) + (preseason ? 1 : 0);
  const id = preseason ? `P${preseasons}` : `S${number}`;
  const now = Date.now();
  const startedAt = countThisWeek ? lastHaltStart(now) : now;
  const activeCutoff = now - ONE_WEEK_MS;

  // The index and prices at the moment the season opens. Baselines are valued at
  // these prices rather than read off portfolioValue, which is only as fresh as
  // each player's last login and counts margin loans as value.
  const { prices, value: indexAtStart } = await readIndexNow();

  const snap = await db.collection('users')
    .select('cash', 'holdings', 'shorts', 'marginUsed', 'grantedValue', 'ladderFlowValue', 'isBot', 'lastActive')
    .get();

  let pinned = 0;
  let batch = db.batch();
  let ops = 0;
  for (const doc of snap.docs) {
    const u = doc.data();
    if (u.isBot) continue;
    batch.update(doc.ref, {
      seasonBaseline: buildSeasonBaseline({
        seasonId: id,
        value: exitEquityAt(u, prices),
        granted: u.grantedValue,
        ladderFlow: u.ladderFlowValue,
        index: indexAtStart,
        pinnedAt: now,
      }),
      // Cleared rather than deleted so last season's tier can't leak forward.
      seasonTier: FieldValue.delete(),
      seasonActiveWeeks: (countThisWeek && (u.lastActive || 0) >= activeCutoff)
        ? { seasonId: id, weeks: 1, lastWeek: 1 }
        : FieldValue.delete(),
      seasonWeeks: FieldValue.delete(),
    });
    pinned++;
    if (++ops >= BATCH_LIMIT) { await batch.commit(); batch = db.batch(); ops = 0; }
  }
  if (ops > 0) await batch.commit();

  await seasonRef().set({
    id,
    number,
    preseason,
    preseasons,
    name: name.trim(),
    status: 'active',
    startedAt,
    endedAt: null,
    // The rules this season was started under, on record with it.
    rules: { ...DEFAULT_SEASON_RULES },
    indexAtStart: round2(indexAtStart),
    // Weeks a checkpoint has actually run. Diamond's share of weeks is out of this.
    checkpointWeeks: [],
    countedStartWeek: countThisWeek,
    playersPinned: pinned,
  });

  console.log(`SEASON STARTED: ${id} "${name}" — ${pinned} baselines pinned`);
  return { success: true, id, number, preseason, name: name.trim(), playersPinned: pinned };
});

// ── Weekly checkpoint ────────────────────────────────────────────────────────

/**
 * Bank the tier each player is HOLDING, once a week during the Thursday halt.
 *
 * Two reasons it is a checkpoint rather than continuous: a tier can't be claimed
 * by touching it for sixty seconds on a spike, and a good season can't be erased
 * by one bad final week. Tiers only ever ratchet up, and only Bronze, Silver and
 * Gold are banked here.
 *
 * Runs inside the halt (13:00-21:00 UTC Thursday) so prices are frozen while it
 * reads — nobody can move the market during the scan.
 */
const runSeasonCheckpoint = async () => {
  const seasonSnap = await seasonRef().get();
  if (!seasonSnap.exists || seasonSnap.data().status !== 'active') {
    return { ran: false, reason: 'no active season' };
  }
  const season = seasonSnap.data();
  const rules = rulesFor(season);
  const weeks = weeksElapsed(season.startedAt);
  const activeCutoff = Date.now() - ONE_WEEK_MS;

  // Prices are frozen (this runs inside the halt), so one read serves every
  // player and every value and concentration figure lines up with one market.
  const { prices, value: indexValue } = await readIndexNow();

  const snap = await db.collection('users')
    .select('cash', 'holdings', 'shorts', 'marginUsed', 'grantedValue', 'ladderFlowValue',
      'isBot', 'isBanned', 'seasonBaseline', 'seasonTier', 'seasonActiveWeeks', 'seasonWeeks', 'lastActive')
    .get();

  let promoted = 0;
  let scored = 0;
  let pinned = 0;
  let batch = db.batch();
  let ops = 0;

  for (const doc of snap.docs) {
    const u = doc.data();
    if (u.isBot || u.isBanned) continue;

    // Valued at the frozen checkpoint prices, never the stored portfolioValue.
    // That is only rewritten when a player opens the app, so someone could log
    // in at a spike and stay away until a checkpoint had banked a tier off it.
    const value = exitEquityAt(u, prices);

    // Safety net for a player with no baseline for this season: createUser pins
    // one at signup, but an account that predates that (or lands in a race with
    // adminStartSeason) would otherwise sit outside the season for good. Pin from
    // where they stand now and they are scored from the next checkpoint on.
    //
    // Same for a player pinned under SEASON_MIN_BASELINE who has since grown past
    // it. They used to be out for the whole season; now they join from here, like
    // a late signup.
    const noBaseline = !u.seasonBaseline || u.seasonBaseline.seasonId !== season.id;
    const grewPastFloor = !noBaseline && (u.seasonBaseline.value || 0) < SEASON_MIN_BASELINE
      && value >= SEASON_MIN_BASELINE;
    if (noBaseline || grewPastFloor) {
      batch.update(doc.ref, {
        seasonBaseline: buildSeasonBaseline({
          seasonId: season.id,
          value,
          granted: u.grantedValue,
          ladderFlow: u.ladderFlowValue,
          index: indexValue,
          pinnedAt: Date.now(),
        }),
      });
      pinned++;
      if (++ops >= BATCH_LIMIT) { await batch.commit(); batch = db.batch(); ops = 0; }
      continue;
    }

    const score = seasonScore(u, season, { value, indexNow: indexValue });
    if (!score) continue;
    scored++;

    // Turning up this week counts toward Bronze, whatever the portfolio did.
    // Once per week: adminEndSeason always re-runs the checkpoint, so ending on a
    // Thursday after the scheduled run would otherwise count that week twice and
    // hand Bronze, and a shot at a Platinum place, to a one-week player.
    const wasActive = (u.lastActive || 0) >= activeCutoff;
    const prior = (u.seasonActiveWeeks?.seasonId === season.id) ? u.seasonActiveWeeks : null;
    const alreadyCounted = prior?.lastWeek === weeks;
    const activeWeeks = (prior?.weeks || 0) + (wasActive && !alreadyCounted ? 1 : 0);

    const earned = checkpointTier({ ...score, activeWeeks }, rules);
    const held = (u.seasonTier?.seasonId === season.id) ? u.seasonTier.tier : null;

    const update = {
      seasonActiveWeeks: {
        seasonId: season.id,
        weeks: activeWeeks,
        lastWeek: (wasActive || alreadyCounted) ? weeks : (prior?.lastWeek ?? null),
      },
      // The raw week record. Diamond is judged from it when the season ends, so
      // it is written for every scored player whether or not they moved a tier.
      seasonWeeks: appendWeekRecord(
        u.seasonWeeks,
        buildWeekRecord({ season, weeks, userData: { ...u, portfolioValue: value }, prices, indexValue })
      ),
    };
    if (earned && tierRank(earned) > tierRank(held)) {
      update.seasonTier = { seasonId: season.id, tier: earned, lockedAt: Date.now() };
      promoted++;
    }

    batch.update(doc.ref, update);
    if (++ops >= BATCH_LIMIT) { await batch.commit(); batch = db.batch(); ops = 0; }
  }
  if (ops > 0) await batch.commit();

  await seasonRef().update({
    lastCheckpointAt: Date.now(),
    lastCheckpointWeeks: weeks,
    lastCheckpointScored: scored,
    lastCheckpointIndex: round2(indexValue),
    checkpointWeeks: FieldValue.arrayUnion(weeks),
  });

  console.log(`SEASON CHECKPOINT: ${season.id} week ${weeks} — ${scored} scored, ${promoted} promoted, ${pinned} late baselines pinned, index ${indexValue.toFixed(2)}`);
  return { ran: true, seasonId: season.id, weeks, scored, promoted, pinned, indexValue };
};

exports.runSeasonCheckpoint = runSeasonCheckpoint;

// Thursday 14:00 UTC — an hour into the halt, so prices are settled and frozen.
exports.seasonCheckpoint = cf({ timeoutSeconds: 540 }).pubsub
  .schedule('0 14 * * 4')
  .timeZone('UTC')
  .onRun(async () => {
    await runSeasonCheckpoint();
    await recordHeartbeat('seasonCheckpoint');
    return null;
  });

exports.triggerSeasonCheckpoint = cf({ timeoutSeconds: 540 }).https.onCall(async (data, context) => {
  requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }
  return runSeasonCheckpoint();
});

// ── Admin: end a season ──────────────────────────────────────────────────────

/**
 * Freeze the season, hand out what was earned, and file the results.
 *
 * Pressed the week a Finale chapter lands, during the halt — prices are frozen,
 * so the closing standings can't be sniped by a last-minute pump.
 *
 * Runs a final checkpoint first so the closing week counts, then hands out
 * Platinum and Diamond across the board and awards titles (see seasonTitles).
 */
exports.adminEndSeason = cf({ timeoutSeconds: 540 }).https.onCall(async (data, context) => {
  requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const seasonSnap = await seasonRef().get();
  if (!seasonSnap.exists || seasonSnap.data().status !== 'active') {
    throw new functions.https.HttpsError('failed-precondition', 'No season is running');
  }

  await runSeasonCheckpoint();

  const season = (await seasonRef().get()).data();
  const rules = rulesFor(season);
  const weeks = weeksElapsed(season.startedAt);

  const snap = await db.collection('users')
    .select('isBot', 'isBanned', 'seasonBaseline', 'seasonTier', 'seasonActiveWeeks', 'seasonWeeks',
      'displayName', 'lastSynced', 'lastActive', 'lastTradeTime', 'lastCheckin')
    .get();

  // Everyone is scored off the record the final checkpoint just wrote, so the
  // result is exactly what that checkpoint measured at frozen halt prices.
  const scoredPlayers = [];
  const field = [];
  for (const doc of snap.docs) {
    const u = doc.data();
    if (u.isBot || u.isBanned) continue;
    const latest = latestWeekRecord(u.seasonWeeks, season.id);
    if (!latest) continue;
    const entry = boardEntry(doc.id, u, season, { value: latest.v, indexNow: latest.x, granted: latest.g });
    if (!entry) continue;
    scoredPlayers.push({ entry, ref: doc.ref, displayName: u.displayName || 'Anonymous' });
    // The same field the season board ranks, so the places handed out here are
    // the ones the board was showing.
    if (isSeasonParticipant(u, season)) field.push(entry);
  }

  const ranked = rankTopTiers(field, rules);
  const endedAt = Date.now();
  const standings = [];
  const tierCounts = {};
  let batch = db.batch();
  let ops = 0;
  let awarded = 0;

  for (const { entry, ref, displayName } of scoredPlayers) {
    const tier = higherTier(entry.tier, ranked.get(entry.uid));
    standings.push({
      uid: entry.uid,
      displayName,
      returnPercent: round1(entry.returnPercent),
      excess: round1(entry.excess),
      tier,
    });
    if (!tier) continue;
    tierCounts[tier] = (tierCounts[tier] || 0) + 1;

    // Season number + arc (a preseason: one "Preseason <Tier>"). Permanent and
    // dated. Tiers outside the season's titledTiers get none.
    const titles = seasonTitles(season, tier);
    const update = {
      ...(titles.length ? { ownedTitles: FieldValue.arrayUnion(...titles.map(t => t.id)) } : {}),
      ...Object.fromEntries(titles.map(t => [`titleMeta.${t.id}`, t.text])),
      // Platinum and Diamond only exist from this moment, so they are written here.
      ...(tier !== entry.tier ? { seasonTier: { seasonId: season.id, tier, lockedAt: endedAt } } : {}),
    };
    awarded++;
    if (!Object.keys(update).length) continue;
    batch.update(ref, update);
    if (++ops >= BATCH_LIMIT) { await batch.commit(); batch = db.batch(); ops = 0; }
  }
  if (ops > 0) await batch.commit();

  standings.sort((a, b) => b.excess - a.excess);

  await db.collection('seasonResults').doc(season.id).set({
    ...season,
    status: 'ended',
    endedAt,
    weeks,
    // Full standings would be unbounded; the top 100 is what anyone looks at.
    standings: standings.slice(0, 100),
    totalScored: standings.length,
    boardSize: field.length,
    tierCounts,
    awarded,
  });
  await seasonRef().update({ status: 'ended', endedAt, awarded, totalScored: standings.length });

  // Tell the winners. Best-effort — the season is already filed.
  for (const [i, row] of standings.slice(0, 3).entries()) {
    try {
      await writeNotification(row.uid, {
        type: 'season_end',
        message: `${season.name} is over. You finished #${i + 1}, ${Math.abs(row.excess)}% ${row.excess >= 0 ? 'ahead of' : 'behind'} the market.`,
      });
    } catch (err) { /* never block the close on a notification */ }
  }

  console.log(`SEASON ENDED: ${season.id} "${season.name}" — ${standings.length} scored, ${awarded} tiered`, tierCounts);
  return { success: true, seasonId: season.id, weeks, totalScored: standings.length, awarded, tierCounts, top: standings.slice(0, 10) };
});

// ── Standings ────────────────────────────────────────────────────────────────

/**
 * The season board. Cached in a doc the same way the main leaderboard is, so a
 * page load costs one document read rather than a full user scan.
 *
 * Ranked on how far ahead of the market each player is. Platinum and Diamond are
 * projected with the same function adminEndSeason hands them out with, so the
 * board shows exactly where they would land if the season ended now.
 */
exports.getSeasonStandings = cf({ timeoutSeconds: 300 }).https.onCall(async (data, context) => {
  requireAppCheck(context);

  const cacheRef = db.collection('leaderboard').doc('season');
  const cached = await cacheRef.get();
  if (cached.exists && (Date.now() - (cached.data().generatedAt || 0)) < LEADERBOARD_CACHE_TTL) {
    return cached.data();
  }

  const seasonSnap = await seasonRef().get();
  if (!seasonSnap.exists || seasonSnap.data().status !== 'active') {
    return { active: false, entries: [], generatedAt: Date.now() };
  }
  const season = seasonSnap.data();
  const rules = rulesFor(season);

  const [{ prices, value: indexValue }, snap] = await Promise.all([
    readIndexNow(),
    db.collection('users')
      .select('cash', 'holdings', 'shorts', 'marginUsed', 'grantedValue', 'ladderFlowValue',
        'isBot', 'isBanned', 'seasonBaseline', 'seasonTier', 'seasonActiveWeeks', 'seasonWeeks',
        'displayName', 'crew',
        // Activity, for isSeasonParticipant — same fields getLastActiveMs reads.
        'lastSynced', 'lastActive', 'lastTradeTime', 'lastCheckin')
      .get(),
  ]);

  const field = [];
  const names = new Map();
  snap.forEach((doc) => {
    const u = doc.data();
    if (u.isBot || u.isBanned) return;
    if (!isSeasonParticipant(u, season)) return;
    // Live prices, not the stored portfolioValue, which lags each player's login.
    const entry = boardEntry(doc.id, u, season, { value: exitEquityAt(u, prices), indexNow: indexValue });
    if (!entry) return;
    field.push(entry);
    names.set(doc.id, { displayName: u.displayName || 'Anonymous', crew: u.crew || null });
  });

  const projected = rankTopTiers(field, rules);
  const entries = [...field]
    .sort((a, b) => b.excess - a.excess)
    .map((e) => ({
      userId: e.uid,
      ...names.get(e.uid),
      returnPercent: round1(e.returnPercent),
      // Never ranked on — shown on your own row so you can see what the ladder
      // would have been worth if it counted.
      returnWithLadder: round1(e.returnWithLadder),
      excess: round1(e.excess),
      tier: e.tier,
      projectedTier: projected.get(e.uid) || null,
      activeWeeks: e.activeWeeks,
    }));

  const payload = {
    active: true,
    seasonId: season.id,
    number: season.number,
    preseason: !!season.preseason,
    name: season.name,
    startedAt: season.startedAt,
    weeks: weeksElapsed(season.startedAt),
    rules,
    marketPercent: season.indexAtStart > 0
      ? round1(((indexValue - season.indexAtStart) / season.indexAtStart) * 100)
      : null,
    slots: topTierSlots(field.length, rules),
    entries: entries.slice(0, 100),
    totalScored: entries.length,
    generatedAt: Date.now(),
  };

  await cacheRef.set(payload);
  return payload;
});
