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
// up in a chapter title — so tier targets are weekly rates compounded over the
// weeks actually elapsed, and the season is ended by an admin button rather than
// a schedule.
const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const db = admin.firestore();

const {
  ADMIN_UID,
  ONE_WEEK_MS,
  SEASON_TIER_ORDER,
  DEFAULT_SEASON_THRESHOLDS,
  SEASON_BRONZE_ACTIVE_WEEKS,
  SEASON_MIN_BASELINE,
  LEADERBOARD_CACHE_TTL,
} = require('../constants');
const { netReturnPercent, writeNotification, recordHeartbeat } = require('../helpers');

const seasonRef = () => db.collection('market').doc('season');
const BATCH_LIMIT = 400;

// ── Shared maths (mirror of src/constants/seasons.js) ────────────────────────

const weeksElapsed = (startedAt) =>
  Math.max(1, Math.ceil((Date.now() - startedAt) / ONE_WEEK_MS));

const tierTarget = (weeklyRatePercent, weeks) =>
  (Math.pow(1 + (weeklyRatePercent / 100), Math.max(1, weeks)) - 1) * 100;

const tierFor = ({ returnPercent, weeks, activeWeeks, thresholds }) => {
  const t = thresholds || DEFAULT_SEASON_THRESHOLDS;
  for (const id of ['diamond', 'platinum', 'gold', 'silver']) {
    if (t[id] !== undefined && returnPercent >= tierTarget(t[id], weeks)) return id;
  }
  return (activeWeeks || 0) >= SEASON_BRONZE_ACTIVE_WEEKS ? 'bronze' : null;
};

const tierRank = (tierId) => (tierId ? SEASON_TIER_ORDER.indexOf(tierId) + 1 : 0);

/**
 * A user's season return, or null if they can't be scored.
 *
 * Grants booked since the season started are subtracted using the baseline
 * snapshot of grantedValue rather than the rolling grantedSamples, so the window
 * lines up exactly with the season no matter how long it runs.
 */
const seasonReturnFor = (userData, season) => {
  const baseline = userData.seasonBaseline;
  if (!baseline || baseline.seasonId !== season.id) return null;
  if (!baseline.value || baseline.value < SEASON_MIN_BASELINE) return null;

  // Signed: ladder deposits book a negative flow (see grantedFlowUpdate), and
  // clamping would turn money parked in the ladder into a fake trading loss.
  const granted = (userData.grantedValue || 0) - (baseline.granted || 0);
  return netReturnPercent(userData.portfolioValue || 0, baseline.value, granted);
};

/**
 * What the season return WOULD have been if ladder winnings counted.
 *
 * Not used for ranking anything — it exists so a player who had a good run at
 * the ladder can see what it was worth, and so the number that doesn't count is
 * visible rather than merely asserted. Adding the ladder's net flow back cancels
 * the exclusion for this one figure.
 */
const seasonReturnWithLadderFor = (userData, season) => {
  const baseline = userData.seasonBaseline;
  if (!baseline || baseline.seasonId !== season.id) return null;
  if (!baseline.value || baseline.value < SEASON_MIN_BASELINE) return null;

  const granted = (userData.grantedValue || 0) - (baseline.granted || 0);
  const ladderNet = (userData.ladderFlowValue || 0) - (baseline.ladderFlow || 0);
  return netReturnPercent(userData.portfolioValue || 0, baseline.value, granted - ladderNet);
};

// Exported for the standings reader and the weekly checkpoint.
exports.seasonReturnFor = seasonReturnFor;
exports.seasonReturnWithLadderFor = seasonReturnWithLadderFor;

// ── Admin: start a season ────────────────────────────────────────────────────

/**
 * Open a season and pin every player's baseline.
 *
 * The baseline captures portfolio value AND the granted-value counter at the
 * same instant, which is what makes "return net of free money" computable over
 * an arbitrary window later. One write per user, once per season.
 */
exports.adminStartSeason = cf({ timeoutSeconds: 540 }).https.onCall(async (data, context) => {
  requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const { name, thresholds } = data || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new functions.https.HttpsError('invalid-argument', 'Season name (the arc) is required');
  }

  const existing = await seasonRef().get();
  if (existing.exists && existing.data().status === 'active') {
    throw new functions.https.HttpsError('failed-precondition',
      `Season "${existing.data().name}" is still running. End it first.`);
  }

  const number = (existing.exists ? (existing.data().number || 0) : 0) + 1;
  const id = `S${number}`;
  const startedAt = Date.now();

  const snap = await db.collection('users').select('portfolioValue', 'grantedValue', 'ladderFlowValue', 'isBot').get();

  let pinned = 0;
  let batch = db.batch();
  let ops = 0;
  for (const doc of snap.docs) {
    const u = doc.data();
    if (u.isBot) continue;
    batch.update(doc.ref, {
      seasonBaseline: {
        seasonId: id,
        value: u.portfolioValue || 0,
        granted: u.grantedValue || 0,
        // Pinned so the ladder shadow stat can be worked out over the season.
        ladderFlow: u.ladderFlowValue || 0,
        pinnedAt: startedAt,
      },
      // Cleared rather than deleted so last season's tier can't leak forward.
      seasonTier: FieldValue.delete(),
      seasonActiveWeeks: FieldValue.delete(),
    });
    pinned++;
    if (++ops >= BATCH_LIMIT) { await batch.commit(); batch = db.batch(); ops = 0; }
  }
  if (ops > 0) await batch.commit();

  await seasonRef().set({
    id,
    number,
    name: name.trim(),
    status: 'active',
    startedAt,
    endedAt: null,
    thresholds: thresholds && typeof thresholds === 'object' ? thresholds : DEFAULT_SEASON_THRESHOLDS,
    bronzeActiveWeeks: SEASON_BRONZE_ACTIVE_WEEKS,
    playersPinned: pinned,
  });

  console.log(`SEASON STARTED: ${id} "${name}" — ${pinned} baselines pinned`);
  return { success: true, id, number, name: name.trim(), playersPinned: pinned };
});

// ── Weekly checkpoint ────────────────────────────────────────────────────────

/**
 * Bank the tier each player is HOLDING, once a week during the Thursday halt.
 *
 * Two reasons it is a checkpoint rather than continuous: a tier can't be claimed
 * by touching it for sixty seconds on a spike, and a good season can't be erased
 * by one bad final week. Tiers only ever ratchet up.
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
  const weeks = weeksElapsed(season.startedAt);
  const activeCutoff = Date.now() - ONE_WEEK_MS;

  const snap = await db.collection('users')
    .select('portfolioValue', 'grantedValue', 'isBot', 'isBanned', 'seasonBaseline', 'seasonTier',
      'seasonActiveWeeks', 'lastActive', 'displayName')
    .get();

  let promoted = 0;
  let scored = 0;
  let batch = db.batch();
  let ops = 0;

  for (const doc of snap.docs) {
    const u = doc.data();
    if (u.isBot || u.isBanned) continue;

    const ret = seasonReturnFor(u, season);
    if (ret === null) continue;
    scored++;

    // Turning up this week counts toward Bronze, whatever the portfolio did.
    const wasActive = (u.lastActive || 0) >= activeCutoff;
    const priorWeeks = (u.seasonActiveWeeks?.seasonId === season.id)
      ? (u.seasonActiveWeeks.weeks || 0) : 0;
    const activeWeeks = priorWeeks + (wasActive ? 1 : 0);

    const earned = tierFor({ returnPercent: ret, weeks, activeWeeks, thresholds: season.thresholds });
    const held = (u.seasonTier?.seasonId === season.id) ? u.seasonTier.tier : null;

    const update = {
      seasonActiveWeeks: { seasonId: season.id, weeks: activeWeeks },
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
  });

  console.log(`SEASON CHECKPOINT: ${season.id} week ${weeks} — ${scored} scored, ${promoted} promoted`);
  return { ran: true, seasonId: season.id, weeks, scored, promoted };
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
 * Runs a final checkpoint first so the closing week counts, then awards two
 * titles per tiered player: one for the season number and one for the arc name.
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
  const weeks = weeksElapsed(season.startedAt);

  const snap = await db.collection('users')
    .select('portfolioValue', 'grantedValue', 'isBot', 'isBanned', 'seasonBaseline', 'seasonTier',
      'displayName', 'ownedTitles')
    .get();

  const standings = [];
  let batch = db.batch();
  let ops = 0;
  let awarded = 0;

  for (const doc of snap.docs) {
    const u = doc.data();
    if (u.isBot || u.isBanned) continue;
    const ret = seasonReturnFor(u, season);
    if (ret === null) continue;

    const tier = (u.seasonTier?.seasonId === season.id) ? u.seasonTier.tier : null;
    standings.push({
      uid: doc.id,
      displayName: u.displayName || 'Anonymous',
      returnPercent: Math.round(ret * 10) / 10,
      tier,
    });

    if (!tier) continue;

    // Two titles: the season number and the arc it covered. Both are permanent
    // and dated, which is the point — they can never be bought or re-earned.
    const label = tier.charAt(0).toUpperCase() + tier.slice(1);
    const titles = [
      { id: `season_${season.number}_${tier}`, text: `Season ${season.number} ${label}` },
      { id: `arc_${season.id.toLowerCase()}_${tier}`, text: `${season.name} ${label}` },
    ];
    batch.update(doc.ref, {
      ownedTitles: FieldValue.arrayUnion(...titles.map(t => t.id)),
      [`titleMeta.season_${season.number}_${tier}`]: titles[0].text,
      [`titleMeta.arc_${season.id.toLowerCase()}_${tier}`]: titles[1].text,
    });
    awarded++;
    if (++ops >= BATCH_LIMIT) { await batch.commit(); batch = db.batch(); ops = 0; }
  }
  if (ops > 0) await batch.commit();

  standings.sort((a, b) => b.returnPercent - a.returnPercent);
  const endedAt = Date.now();

  await db.collection('seasonResults').doc(season.id).set({
    ...season,
    status: 'ended',
    endedAt,
    weeks,
    // Full standings would be unbounded; the top 100 is what anyone looks at.
    standings: standings.slice(0, 100),
    totalScored: standings.length,
    awarded,
  });
  await seasonRef().update({ status: 'ended', endedAt, awarded, totalScored: standings.length });

  // Tell the winners. Best-effort — the season is already filed.
  for (const row of standings.slice(0, 3)) {
    try {
      await writeNotification(row.uid, {
        type: 'season_end',
        message: `${season.name} is over. You finished #${standings.indexOf(row) + 1} at ${row.returnPercent > 0 ? '+' : ''}${row.returnPercent}%.`,
      });
    } catch (err) { /* never block the close on a notification */ }
  }

  console.log(`SEASON ENDED: ${season.id} "${season.name}" — ${standings.length} scored, ${awarded} tiered`);
  return { success: true, seasonId: season.id, weeks, totalScored: standings.length, awarded, top: standings.slice(0, 10) };
});

// ── Standings ────────────────────────────────────────────────────────────────

/**
 * The season board. Cached in a doc the same way the main leaderboard is, so a
 * page load costs one document read rather than a full user scan.
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

  const snap = await db.collection('users')
    .select('portfolioValue', 'grantedValue', 'ladderFlowValue', 'isBot', 'isBanned', 'seasonBaseline',
      'seasonTier', 'seasonActiveWeeks', 'displayName', 'crew', 'activeCosmetics', 'ownedCosmetics')
    .get();

  const entries = [];
  snap.forEach((doc) => {
    const u = doc.data();
    if (u.isBot || u.isBanned) return;
    const ret = seasonReturnFor(u, season);
    if (ret === null) return;
    const withLadder = seasonReturnWithLadderFor(u, season);
    entries.push({
      userId: doc.id,
      displayName: u.displayName || 'Anonymous',
      crew: u.crew || null,
      returnPercent: Math.round(ret * 10) / 10,
      // Never ranked on — shown on your own row so you can see what the ladder
      // would have been worth if it counted.
      returnWithLadder: withLadder === null ? null : Math.round(withLadder * 10) / 10,
      tier: (u.seasonTier?.seasonId === season.id) ? u.seasonTier.tier : null,
      activeWeeks: (u.seasonActiveWeeks?.seasonId === season.id) ? (u.seasonActiveWeeks.weeks || 0) : 0,
    });
  });

  entries.sort((a, b) => b.returnPercent - a.returnPercent);

  const payload = {
    active: true,
    seasonId: season.id,
    number: season.number,
    name: season.name,
    startedAt: season.startedAt,
    weeks: weeksElapsed(season.startedAt),
    thresholds: season.thresholds || DEFAULT_SEASON_THRESHOLDS,
    bronzeActiveWeeks: season.bronzeActiveWeeks || SEASON_BRONZE_ACTIVE_WEEKS,
    entries: entries.slice(0, 100),
    totalScored: entries.length,
    generatedAt: Date.now(),
  };

  await cacheRef.set(payload);
  return payload;
});
