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
import * as functions from 'firebase-functions/v1';
import { cf, requireAppCheck, requireAdmin } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
const db = admin.firestore();

import {
  DEFAULT_SEASON_RULES,
  rulesFor,
  tierRank,
  buildSeasonBaseline,
  freshMarginTally,
  recordMargin,
  finalTier,
  divisionSlots,
  rankTopTiers,
  seasonTitles,
  lastHaltStart,
} from './seasonTiers';
import { ONE_WEEK_MS, LEADERBOARD_CACHE_TTL, isWeeklyTradingHalt } from '../shared/constants';
import { writeNotification } from '../shared/notifications';
import { recordHeartbeat } from '../shared/activity';
import { exitEquityAt } from '../shared/equity';
import { readIndexNow } from '../shared/marketData';
import { round2 } from '../shared/money';
import type { DocumentData } from 'firebase-admin/firestore';
import type { SeasonDoc, UserData } from '../shared/types';
import { latestWeekRecord, weeksElapsed, isSeasonParticipant, boardEntry } from './seasonRecords';
import { seasonRef, BATCH_LIMIT, readLadderCash, runSeasonCheckpoint } from './seasonCheckpoint';

const round1 = (n: number) => Math.round(n * 10) / 10;
// Rows kept per size division on the live board and in the filed results.
const BOARD_PER_DIVISION = 100;
const RESULTS_PER_DIVISION = 50;

/**
 * Refuse unless prices are frozen: the Thursday halt, or a halt the admin set.
 * Ending a season and running a checkpoint both score everyone at this moment's
 * prices, so mid-week anyone could pump their own stock seconds before the
 * button is pressed. The scheduled checkpoint always runs inside the halt.
 */
const assertPricesFrozen = async (action: string) => {
  if (isWeeklyTradingHalt()) return;
  const marketSnap = await db.collection('market').doc('current').get();
  if (marketSnap.data()?.marketHalted === true) return;
  throw new functions.https.HttpsError(
    'failed-precondition',
    `${action} while the market is halted: during the Thursday halt, or halt it first in Admin -> Market.`,
  );
};

/** The first `n` of each division, keeping the input's (ranked) order. */
const topPerDivision = <T extends { division?: string | null }>(rows: T[], n: number) => {
  const seen: Record<string, number> = {};
  return rows.filter((r) => (seen[r.division as string] = (seen[r.division as string] || 0) + 1) <= n);
};

// ── Admin: start a season ────────────────────────────────────────────────────

/**
 * Open a season and pin every player's baseline.
 *
 * The baseline captures net equity, the granted-value counter and the index at
 * the same instant, which is what makes "return net of free money, against the
 * market" computable over an arbitrary window later. One write per user.
 */
export const adminStartSeason = cf({ timeoutSeconds: 540 }).https.onCall(async (data, context) => {
  requireAdmin(context);

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
  if (existing.exists && existing.data()!.status === 'active') {
    throw new functions.https.HttpsError(
      'failed-precondition',
      `Season "${existing.data()!.name}" is still running. End it first.`,
    );
  }

  // Both counters carry over from whatever ran last, so a preseason never shifts
  // the numbering of the real seasons around it.
  const prev: DocumentData = (existing.exists ? existing.data() : null) || {};
  const number = (prev.number || 0) + (preseason ? 0 : 1);
  const preseasons = (prev.preseasons || 0) + (preseason ? 1 : 0);
  const id = preseason ? `P${preseasons}` : `S${number}`;
  const now = Date.now();
  const startedAt = countThisWeek ? lastHaltStart(now) : now;
  const activeCutoff = now - ONE_WEEK_MS;

  // The index and prices at the moment the season opens. Baselines are valued at
  // these prices rather than read off portfolioValue, which is only as fresh as
  // each player's last login and counts margin loans as value.
  const [{ prices, value: indexAtStart }, ladderCash] = await Promise.all([readIndexNow(), readLadderCash()]);

  const snap = await db
    .collection('users')
    .select(
      'cash',
      'holdings',
      'shorts',
      'marginUsed',
      'grantedValue',
      'grantedDays',
      'ladderFlowValue',
      'predictionFlowValue',
      'isBot',
      'lastActive',
    )
    .get();

  let pinned = 0;
  let batch = db.batch();
  let ops = 0;
  for (const doc of snap.docs) {
    const u = doc.data() as UserData;
    if (u.isBot) continue;
    batch.update(doc.ref, {
      seasonBaseline: buildSeasonBaseline({
        seasonId: id,
        value: exitEquityAt(u, prices),
        granted: u.grantedValue,
        grantedDays: u.grantedDays,
        ladderFlow: u.ladderFlowValue,
        predictionFlow: u.predictionFlowValue,
        index: indexAtStart,
        pinnedAt: now,
        ladder: ladderCash.get(doc.id) || 0,
      }),
      // Margin owed from here is averaged over the season (see seasonTiers.js).
      seasonMargin: freshMarginTally(id, u.marginUsed, now),
      // Cleared rather than deleted so last season's tier can't leak forward.
      seasonTier: FieldValue.delete(),
      seasonActiveWeeks:
        countThisWeek && ((u.lastActive as number) || 0) >= activeCutoff
          ? { seasonId: id, weeks: 1, lastWeek: 1 }
          : FieldValue.delete(),
      seasonWeeks: FieldValue.delete(),
    });
    pinned++;
    if (++ops >= BATCH_LIMIT) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
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

  logger.info(`SEASON STARTED: ${id} "${name}" — ${pinned} baselines pinned`);
  return { success: true, id, number, preseason, name: name.trim(), playersPinned: pinned };
});

// Thursday 14:00 UTC — an hour into the halt, so prices are settled and frozen.
export const seasonCheckpoint = cf({ timeoutSeconds: 540 })
  .pubsub.schedule('0 14 * * 4')
  .timeZone('UTC')
  .onRun(async () => {
    await runSeasonCheckpoint();
    await recordHeartbeat('seasonCheckpoint');
    return null;
  });

export const triggerSeasonCheckpoint = cf({ timeoutSeconds: 540 }).https.onCall(async (data, context) => {
  requireAdmin(context);
  await assertPricesFrozen('Run the checkpoint');
  return runSeasonCheckpoint();
});

// ── Admin: end a season ──────────────────────────────────────────────────────

/**
 * Freeze the season, hand out what was earned, and file the results.
 *
 * Pressed the week a Finale chapter lands, during the halt — prices are frozen,
 * so the closing standings can't be sniped by a last-minute pump.
 *
 * Runs a final checkpoint first so the closing week counts, then decides Silver
 * and Gold from where each player finished, hands out Platinum and Diamond
 * across the board, and awards titles (see seasonTitles).
 */
export const adminEndSeason = cf({ timeoutSeconds: 540 }).https.onCall(async (data, context) => {
  requireAdmin(context);

  const seasonSnap = await seasonRef().get();
  if (!seasonSnap.exists || seasonSnap.data()!.status !== 'active') {
    throw new functions.https.HttpsError('failed-precondition', 'No season is running');
  }

  await assertPricesFrozen('End the season');

  await runSeasonCheckpoint();

  const season = (await seasonRef().get()).data() as SeasonDoc;
  const rules = rulesFor(season);
  const weeks = weeksElapsed(season.startedAt as number);

  const snap = await db
    .collection('users')
    .select(
      'isBot',
      'isBanned',
      'seasonBaseline',
      'seasonTier',
      'seasonActiveWeeks',
      'seasonWeeks',
      'seasonMargin',
      'marginUsed',
      'displayName',
      'seasonTopTierExclusion',
      'lastSynced',
      'lastActive',
      'lastTradeTime',
      'lastCheckin',
    )
    .get();

  // Everyone is scored off the record the final checkpoint just wrote, so the
  // result is exactly what that checkpoint measured at frozen halt prices.
  const scoredPlayers = [];
  const field: NonNullable<ReturnType<typeof boardEntry>>[] = [];
  for (const doc of snap.docs) {
    const u = doc.data() as UserData;
    if (u.isBot || u.isBanned) continue;
    const latest = latestWeekRecord(u.seasonWeeks, season.id);
    if (!latest) continue;
    const entry = boardEntry(doc.id, u, season, {
      value: latest.v,
      indexNow: latest.x,
      granted: latest.g,
      grantedDays: latest.a,
      sideFlows: latest.f,
      at: latest.t,
      margin: recordMargin(latest, u.seasonBaseline?.pinnedAt as number),
    });
    if (!entry) continue;
    scoredPlayers.push({ entry, ref: doc.ref, displayName: u.displayName || 'Anonymous' });
    // The same field the season board ranks, so the places handed out here are
    // the ones the board was showing.
    if (isSeasonParticipant(u, season)) field.push(entry);
  }

  const ranked = rankTopTiers(field, rules);
  const endedAt = Date.now();
  const standings = [];
  const tierCounts: Record<string, number> = {};
  let batch = db.batch();
  let ops = 0;
  let awarded = 0;

  for (const { entry, ref, displayName } of scoredPlayers) {
    const tier = finalTier(entry, ranked, rules);
    standings.push({
      uid: entry.uid,
      displayName,
      returnPercent: round1(entry.returnPercent),
      excess: round1(entry.excess),
      division: entry.division,
      tier,
    });
    if (!tier) continue;
    tierCounts[tier] = (tierCounts[tier] || 0) + 1;

    // Season number + arc (a preseason: one "Preseason <Tier>"). Permanent and
    // dated. Tiers outside the season's titledTiers get none.
    const titles = seasonTitles(season, tier);
    const update: Record<string, unknown> = {
      ...(titles.length ? { ownedTitles: FieldValue.arrayUnion(...titles.map((t) => t.id)) } : {}),
      ...Object.fromEntries(titles.map((t) => [`titleMeta.${t.id}`, t.text])),
      // Silver, Gold, Platinum and Diamond are only decided now, so they are written here.
      ...(tier !== entry.tier ? { seasonTier: { seasonId: season.id, tier, lockedAt: endedAt } } : {}),
    };
    awarded++;
    if (!Object.keys(update).length) continue;
    batch.update(ref, update);
    if (++ops >= BATCH_LIMIT) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();

  standings.sort((a, b) => b.excess - a.excess);
  const divisionLabel = Object.fromEntries((rules.divisions || []).map((d) => [d.id, d.label]));

  await db
    .collection('seasonResults')
    .doc(season.id)
    .set({
      ...season,
      status: 'ended',
      endedAt,
      weeks,
      // Full standings would be unbounded; the top of each division is what anyone looks at.
      standings: topPerDivision(standings, RESULTS_PER_DIVISION),
      divisions: divisionSlots(field, rules),
      totalScored: standings.length,
      boardSize: field.length,
      tierCounts,
      awarded,
    });
  await seasonRef().update({ status: 'ended', endedAt, awarded, totalScored: standings.length });

  // Tell the top 3 of each division. Best-effort — the season is already filed.
  const place: Record<string, number> = {};
  for (const row of topPerDivision(standings, 3)) {
    place[row.division as string] = (place[row.division as string] || 0) + 1;
    try {
      await writeNotification(row.uid, {
        type: 'season_end',
        // Required: Firestore rejects an undefined field, and the catch below
        // would swallow that, so without it nobody ever got this notice.
        title: 'Season over',
        message: `${season.name} is over. You finished #${place[row.division as string]} in the ${divisionLabel[row.division as string] || ''} division, ${Math.abs(row.excess)}% ${row.excess >= 0 ? 'ahead of' : 'behind'} the market.`,
      });
    } catch (err) {
      /* never block the close on a notification */
    }
  }

  logger.info(
    `SEASON ENDED: ${season.id} "${season.name}" — ${standings.length} scored, ${awarded} tiered`,
    tierCounts,
  );
  return {
    success: true,
    seasonId: season.id,
    weeks,
    totalScored: standings.length,
    awarded,
    tierCounts,
    top: standings.slice(0, 10),
  };
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
export const getSeasonStandings = cf({ timeoutSeconds: 300 }).https.onCall(async (data, context) => {
  requireAppCheck(context);

  const cacheRef = db.collection('leaderboard').doc('season');
  const cached = await cacheRef.get();
  if (cached.exists && Date.now() - (cached.data()!.generatedAt || 0) < LEADERBOARD_CACHE_TTL) {
    return cached.data()!;
  }

  const seasonSnap = await seasonRef().get();
  if (!seasonSnap.exists || seasonSnap.data()!.status !== 'active') {
    return { active: false, entries: [], generatedAt: Date.now() };
  }
  const season = seasonSnap.data() as SeasonDoc;
  const rules = rulesFor(season);

  const [{ prices, value: indexValue }, snap] = await Promise.all([
    readIndexNow(),
    db
      .collection('users')
      .select(
        'cash',
        'holdings',
        'shorts',
        'marginUsed',
        'grantedValue',
        'grantedDays',
        'ladderFlowValue',
        'predictionFlowValue',
        'isBot',
        'isBanned',
        'seasonBaseline',
        'seasonTier',
        'seasonActiveWeeks',
        'seasonWeeks',
        'seasonMargin',
        'marginUsed',
        'displayName',
        'crew',
        'seasonTopTierExclusion',
        // Activity, for isSeasonParticipant — same fields getLastActiveMs reads.
        'lastSynced',
        'lastActive',
        'lastTradeTime',
        'lastCheckin',
      )
      .get(),
  ]);

  const field: NonNullable<ReturnType<typeof boardEntry>>[] = [];
  const names = new Map();
  snap.forEach((doc) => {
    const u = doc.data() as UserData;
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
    .map((e) => {
      // Where they'd finish if it ended now, when that beats what's banked.
      const finish = finalTier(e, projected, rules);
      return {
        userId: e.uid,
        ...names.get(e.uid),
        returnPercent: round1(e.returnPercent),
        // No returnWithLadder here: it would show every player's ladder results
        // to anyone. Your own card works yours out on your device (useSeason.js).
        excess: round1(e.excess),
        division: e.division,
        tier: e.tier,
        projectedTier: tierRank(finish) > tierRank(e.tier) ? finish : null,
        activeWeeks: e.activeWeeks,
      };
    });

  const payload = {
    active: true,
    seasonId: season.id,
    number: season.number,
    preseason: !!season.preseason,
    name: season.name,
    startedAt: season.startedAt,
    weeks: weeksElapsed(season.startedAt as number),
    rules,
    marketPercent:
      (season.indexAtStart ?? 0) > 0
        ? round1(((indexValue - season.indexAtStart!) / season.indexAtStart!) * 100)
        : null,
    // Players and Platinum/Diamond places in each size division.
    divisions: divisionSlots(field, rules),
    entries: topPerDivision(entries, BOARD_PER_DIVISION),
    totalScored: entries.length,
    generatedAt: Date.now(),
  };

  await cacheRef.set(payload);
  return payload;
});

// Re-exported so the season emulator suite keeps one entry point.
export { runSeasonCheckpoint };
