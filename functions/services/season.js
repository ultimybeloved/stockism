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

const { indexConstituents, computeIndexValue } = require('./indexMaintenance');
const {
  ADMIN_UID,
  ONE_WEEK_MS,
  INDEX_BASE_VALUE,
  SEASON_TIER_ORDER,
  DEFAULT_SEASON_THRESHOLDS,
  SEASON_BRONZE_ACTIVE_WEEKS,
  SEASON_MIN_BASELINE,
  LEADERBOARD_CACHE_TTL,
  ACTIVE_USER_WINDOW_MS,
} = require('../constants');
const { netReturnPercent, writeNotification, recordHeartbeat, getLastActiveMs } = require('../helpers');

const seasonRef = () => db.collection('market').doc('season');
const BATCH_LIMIT = 400;
// A season's weekly record is capped. Far longer than any arc, and it stops one
// very long season from growing the user doc without bound.
const SEASON_WEEK_RECORD_CAP = 80;

/**
 * The market index right now, plus the constituent set behind it.
 *
 * Read once per job, never per player. Tiers are scored against this line, so it
 * has to be the same divisor-adjusted number the daily job records rather than a
 * fresh average — see functions/services/indexMaintenance.js.
 */
const readIndexNow = async () => {
  const [marketSnap, idxSnap] = await Promise.all([
    db.collection('market').doc('current').get(),
    db.collection('market').doc('indexHistory').get(),
  ]);
  const prices = marketSnap.exists ? (marketSnap.data().prices || {}) : {};
  const stored = idxSnap.exists ? (idxSnap.data() || {}) : {};
  const constituents = (Array.isArray(stored.constituents) && stored.constituents.length)
    ? stored.constituents
    : indexConstituents();
  const divisor = stored.divisor > 0
    ? stored.divisor
    : (constituents.length || 1) / INDEX_BASE_VALUE;
  return { prices, value: computeIndexValue(prices, constituents, divisor) };
};

/**
 * One week's raw measurements for a player. Deliberately NOT a verdict.
 *
 * Storing "beat the index: true" would marry the season to whatever tier rule
 * shipped with it, and the rule is exactly the thing that can't be settled until
 * the calibration data lands. Storing the underlying numbers means the rule can
 * change at any point, mid-season included, and every past week can be rescored
 * from the record.
 *
 *   v  portfolio value now          g  granted value since the season baseline
 *   x  market index now             c  value of the single largest holding
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
 * Whether a player belongs on the season standings board.
 *
 * adminStartSeason pins a baseline for EVERY non-bot account, so without this
 * the board fills up with people who signed up once and never came back, sitting
 * at roughly 0%. They can't take a tier off anyone — tiers are absolute bars,
 * not rankings — but they pad the field and make "top 5%" a much softer thing
 * than it sounds.
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

// Exported for the standings reader and the weekly checkpoint. The serviceLoader
// copies only real Cloud Functions, so these never reach index.js.
exports.buildWeekRecord = buildWeekRecord;
exports.isSeasonParticipant = isSeasonParticipant;
exports.appendWeekRecord = appendWeekRecord;
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

  // The index at the moment the season opens. Every "did you beat the market"
  // question for the whole arc is measured from this number, so it is pinned
  // once here rather than reconstructed later from daily history.
  const { value: indexAtStart } = await readIndexNow();

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
      seasonWeeks: FieldValue.delete(),
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
    indexAtStart: Math.round(indexAtStart * 100) / 100,
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

  // Prices are frozen (this runs inside the halt), so one read serves every
  // player and every concentration figure lines up with the same market.
  const { prices, value: indexValue } = await readIndexNow();

  const snap = await db.collection('users')
    .select('portfolioValue', 'grantedValue', 'ladderFlowValue', 'isBot', 'isBanned',
      'seasonBaseline', 'seasonTier', 'seasonActiveWeeks', 'seasonWeeks',
      'holdings', 'lastActive', 'displayName')
    .get();

  let promoted = 0;
  let scored = 0;
  let pinned = 0;
  let batch = db.batch();
  let ops = 0;

  for (const doc of snap.docs) {
    const u = doc.data();
    if (u.isBot || u.isBanned) continue;

    // Safety net for a player with no baseline for this season: createUser pins
    // one at signup, but an account that predates that (or lands in a race with
    // adminStartSeason) would otherwise sit outside the season for good, because
    // seasonReturnFor skips anyone unbaselined. Pin from where they stand now and
    // they are scored from the next checkpoint on.
    if (!u.seasonBaseline || u.seasonBaseline.seasonId !== season.id) {
      const baseline = {
        seasonId: season.id,
        value: u.portfolioValue || 0,
        granted: u.grantedValue || 0,
        ladderFlow: u.ladderFlowValue || 0,
        pinnedAt: Date.now(),
      };
      batch.update(doc.ref, { seasonBaseline: baseline });
      pinned++;
      if (++ops >= BATCH_LIMIT) { await batch.commit(); batch = db.batch(); ops = 0; }
      continue;
    }

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
      // The raw week record. This is the part the eventual tier rule is computed
      // FROM, so it is written for every scored player whether or not they moved
      // a tier this week.
      seasonWeeks: appendWeekRecord(
        u.seasonWeeks,
        buildWeekRecord({ season, weeks, userData: u, prices, indexValue })
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
    lastCheckpointIndex: Math.round(indexValue * 100) / 100,
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
      'seasonTier', 'seasonActiveWeeks', 'displayName', 'crew', 'activeCosmetics', 'ownedCosmetics',
      // Activity, for isSeasonParticipant — same fields getLastActiveMs reads.
      'lastSynced', 'lastActive', 'lastTradeTime', 'lastCheckin')
    .get();

  const entries = [];
  snap.forEach((doc) => {
    const u = doc.data();
    if (u.isBot || u.isBanned) return;
    if (!isSeasonParticipant(u, season)) return;
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
