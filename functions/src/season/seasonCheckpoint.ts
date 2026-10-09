// The weekly season checkpoint engine, plus the season doc ref and ladder-cash
// read that season.ts shares with it. Split out of season.ts. INTERNAL MODULE:
// exports no Cloud Functions.
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import {
  rulesFor,
  tierRank,
  buildSeasonBaseline,
  seasonScore,
  seasonAccountSize,
  seasonMarginUpdate,
  freshMarginTally,
  checkpointTier,
} from './seasonTiers';
import { ONE_WEEK_MS, SEASON_MIN_BASELINE } from '../shared/constants';
import { exitEquityAt } from '../shared/equity';
import { readIndexNow } from '../shared/marketData';
import { round2 } from '../shared/money';
import { getLadderWithdrawable } from '../shared/ladderMath';
import type { SeasonDoc, UserData } from '../shared/types';
import { buildWeekRecord, appendWeekRecord, weeksElapsed } from './seasonRecords';
import * as logger from 'firebase-functions/logger';
const db = admin.firestore();

export const seasonRef = () => db.collection('market').doc('season');
export const BATCH_LIMIT = 400;
/**
 * uid -> cash each player could withdraw from the ladder right now. Money parked
 * there is out of their account value but still theirs, so pinning without it
 * would let a player shrink their starting value (and division) for the season
 * and take it back out afterwards. One read of the ladder collection.
 */
export const readLadderCash = async () => {
  const snap = await db
    .collection('ladderGameUsers')
    .select('balance', 'nonWithdrawable', 'chipsMigrated', 'totalLost')
    .get();
  const cash = new Map();
  snap.forEach((doc) => {
    const amount = getLadderWithdrawable(doc.data());
    if (amount > 0) cash.set(doc.id, amount);
  });
  return cash;
};

// ── Weekly checkpoint ────────────────────────────────────────────────────────

/**
 * Record the week for every player, once a week during the Thursday halt.
 *
 * Writes the raw week record Diamond and the season chart are judged from, and
 * banks Bronze for turning up. Nothing else banks here: Silver and Gold are
 * judged on where a player finishes, Platinum and Diamond on the final board.
 *
 * Runs inside the halt (13:00-21:00 UTC Thursday) so prices are frozen while it
 * reads — nobody can move the market during the scan.
 */
export const runSeasonCheckpoint = async () => {
  const seasonSnap = await seasonRef().get();
  if (!seasonSnap.exists || seasonSnap.data()!.status !== 'active') {
    return { ran: false, reason: 'no active season' };
  }
  const season = seasonSnap.data() as SeasonDoc;
  const rules = rulesFor(season);
  const weeks = weeksElapsed(season.startedAt as number);
  const now = Date.now();
  const activeCutoff = now - ONE_WEEK_MS;

  // Prices are frozen (this runs inside the halt), so one read serves every
  // player and every value and concentration figure lines up with one market.
  const [{ prices, value: indexValue }, ladderCash] = await Promise.all([readIndexNow(), readLadderCash()]);

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
      'isBanned',
      'seasonBaseline',
      'seasonTier',
      'seasonActiveWeeks',
      'seasonWeeks',
      'seasonMargin',
      'lastActive',
    )
    .get();

  let promoted = 0;
  let scored = 0;
  let pinned = 0;
  let batch = db.batch();
  let ops = 0;

  for (const doc of snap.docs) {
    const u = doc.data() as UserData;
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
    const ladder = ladderCash.get(doc.id) || 0;
    const noBaseline = !u.seasonBaseline || u.seasonBaseline.seasonId !== season.id;
    const grewPastFloor =
      !noBaseline && seasonAccountSize(u.seasonBaseline) < SEASON_MIN_BASELINE && value + ladder >= SEASON_MIN_BASELINE;
    if (noBaseline || grewPastFloor) {
      const pinnedAt = Date.now();
      batch.update(doc.ref, {
        seasonBaseline: buildSeasonBaseline({
          seasonId: season.id,
          value,
          granted: u.grantedValue,
          grantedDays: u.grantedDays,
          ladderFlow: u.ladderFlowValue,
          predictionFlow: u.predictionFlowValue,
          index: indexValue,
          pinnedAt,
          ladder,
        }),
        seasonMargin: freshMarginTally(season.id, u.marginUsed, pinnedAt),
      });
      pinned++;
      if (++ops >= BATCH_LIMIT) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
      continue;
    }

    const score = seasonScore(u, season, { value, indexNow: indexValue });
    if (!score) continue;
    scored++;

    // Turning up this week counts toward Bronze, whatever the portfolio did.
    // Once per week: adminEndSeason always re-runs the checkpoint, so ending on a
    // Thursday after the scheduled run would otherwise count that week twice and
    // hand Bronze, and a shot at a Platinum place, to a one-week player.
    const wasActive = ((u.lastActive as number) || 0) >= activeCutoff;
    const prior = u.seasonActiveWeeks?.seasonId === season.id ? u.seasonActiveWeeks : null;
    const alreadyCounted = prior?.lastWeek === weeks;
    const activeWeeks = (prior?.weeks || 0) + (wasActive && !alreadyCounted ? 1 : 0);

    // Only Bronze banks here. Silver and Gold are judged on where the player
    // finishes, so one lucky Thursday can't lock them in.
    const earned = checkpointTier({ activeWeeks }, rules);
    const held = u.seasonTier?.seasonId === season.id ? u.seasonTier.tier : null;

    const update: Record<string, unknown> = {
      seasonActiveWeeks: {
        seasonId: season.id,
        weeks: activeWeeks,
        lastWeek: wasActive || alreadyCounted ? weeks : (prior?.lastWeek ?? null),
      },
      // The raw week record. Diamond is judged from it when the season ends, so
      // it is written for every scored player whether or not they moved a tier.
      // Re-syncs the margin tally with the debt as it stands, so interest or any
      // writer that missed it only ever drifts for a week.
      ...seasonMarginUpdate(u, u.marginUsed, now),
      seasonWeeks: appendWeekRecord(
        u.seasonWeeks,
        buildWeekRecord({ season, weeks, userData: { ...u, portfolioValue: value }, prices, indexValue, now }),
      ),
    };
    if (earned && tierRank(earned) > tierRank(held)) {
      update.seasonTier = { seasonId: season.id, tier: earned, lockedAt: Date.now() };
      promoted++;
    }

    batch.update(doc.ref, update);
    if (++ops >= BATCH_LIMIT) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();

  await seasonRef().update({
    lastCheckpointAt: Date.now(),
    lastCheckpointWeeks: weeks,
    lastCheckpointScored: scored,
    lastCheckpointIndex: round2(indexValue),
    checkpointWeeks: FieldValue.arrayUnion(weeks),
  });

  logger.info(
    `SEASON CHECKPOINT: ${season.id} week ${weeks} — ${scored} scored, ${promoted} promoted, ${pinned} late baselines pinned, index ${indexValue.toFixed(2)}`,
  );
  return { ran: true, seasonId: season.id, weeks, scored, promoted, pinned, indexValue };
};
