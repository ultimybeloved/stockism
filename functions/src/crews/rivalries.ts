// Crew Rivalries: settling the week that ended and pairing the next one.
// INTERNAL MODULE, run by the weekly crew rankings at the Thursday reopen.
// The rules are in src/crews.ts (RIVALRY) and ./rivalryRules.

import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import type { DocumentData } from 'firebase-admin/firestore';
import { RIVALRY, getCrewMultiplier } from '../shared/crews';
import { grantedValueUpdate } from '../shared/equity';
import { recordLedger } from '../shared/ledger';
import { reportError } from '../shared/sentry';
import { writeNotification } from '../shared/notifications';
import { rivalryRef } from '../shared/rivalries';
import { rivalryCount, rivalryQualified } from '../shared/rules/missionProgress';
import { pairCrews, opponentsOf, matchWinners, rivalryScore, type RivalryTally } from './rivalryRules';
const db = admin.firestore();

export interface RivalryResult extends RivalryTally {
  score: number;
  won: boolean;
  opponents: string[];
}

// Firestore can't store nested arrays, so a match is stored as { crews: [...] }.
const readMatches = (board: DocumentData | undefined): string[][] =>
  (board?.matches || []).map((m: { crews?: string[] }) => m.crews || []).filter((m: string[]) => m.length > 1);

/**
 * Score the week's matches from the user docs and pay every member who
 * qualified. Re-runnable: a settled week returns its stored results, and each
 * payout is guarded by weeklyMissions.{week}.rivalryPaid.
 */
export async function settleRivalryWeek(
  weekId: string,
  users: { id: string; data: DocumentData }[],
  crewStats: DocumentData | null | undefined,
) {
  const ref = rivalryRef(weekId);
  const snap = await ref.get();
  const board = snap.data();
  const matches = readMatches(board);
  if (!matches.length) return null;
  if (board?.settled) return { results: board.results as Record<string, RivalryResult>, winners: board.winners || [] };

  const tallies: Record<string, RivalryTally> = {};
  const qualifiers: { uid: string; crew: string }[] = [];
  for (const { id, data } of users) {
    const crew = data.crew;
    if (!crew || data.isBot || data.isBanned) continue;
    const wp = data.weeklyMissions?.[weekId];
    const t = (tallies[crew] ||= { active: 0, qualified: 0 });
    const qualified = rivalryQualified(wp, crew);
    // Active = finished at least one mission in this crew this week. Check-ins
    // alone don't count (until 2026-10-22 they did, so a member who only
    // checked in lowered their own crew's score).
    if (rivalryCount(wp, crew) > 0) t.active++;
    if (qualified) {
      t.qualified++;
      qualifiers.push({ uid: id, crew });
    }
  }

  const results: Record<string, RivalryResult> = {};
  const winners: string[] = [];
  const opponents = opponentsOf(matches);
  for (const match of matches) {
    const won = matchWinners(match, tallies);
    winners.push(...won);
    for (const c of match) {
      const t = tallies[c] || { active: 0, qualified: 0 };
      results[c] = { ...t, score: rivalryScore(t), won: won.includes(c), opponents: opponents[c] || [] };
    }
  }

  let paidCount = 0;
  let paidTotal = 0;
  for (const { uid, crew } of qualifiers) {
    const r = results[crew];
    if (!r) continue; // a crew with no match this week
    const reward = Math.round((r.won ? RIVALRY.winReward : RIVALRY.loseReward) * getCrewMultiplier(crewStats, crew));
    const userRef = db.collection('users').doc(uid);
    try {
      const paid = await db.runTransaction(async (tx) => {
        const fresh = (await tx.get(userRef)).data();
        if (!fresh || fresh.weeklyMissions?.[weekId]?.rivalryPaid) return false;
        tx.update(userRef, {
          cash: (fresh.cash || 0) + reward,
          ...grantedValueUpdate(reward),
          [`weeklyMissions.${weekId}.rivalryPaid`]: true,
        });
        recordLedger(tx, {
          uid,
          type: 'rivalry_reward',
          amount: reward,
          cashAfter: (fresh.cash || 0) + reward,
          ref: weekId,
          detail: { crew, won: r.won },
        });
        return true;
      });
      if (!paid) continue;
      paidCount++;
      paidTotal += reward;
      await writeNotification(uid, {
        type: 'system',
        title: r.won ? `Rivalry won! +$${reward.toLocaleString()}` : `Rivalry reward +$${reward.toLocaleString()}`,
        message: r.won
          ? 'Your crew won its rivalry this week. Your crest glows for the next week.'
          : 'Your crew lost its rivalry, but you finished your missions. Thanks for showing up.',
      });
    } catch (err) {
      reportError(err, { where: 'settleRivalryWeek', uid, weekId });
    }
  }

  await ref.set({ settled: true, settledAt: Date.now(), results, winners }, { merge: true });
  logger.info(`Rivalries ${weekId}: winners ${winners.join(', ') || 'none'}, ${paidCount} paid $${paidTotal}`);
  return { results, winners, paidCount, paidTotal };
}

/** Pair every crew with members for the new week. Kept if already paired. */
export async function pairRivalryWeek(
  weekId: string,
  prevWeekId: string,
  crewIds: string[],
  activeCounts: Record<string, number>,
) {
  const ref = rivalryRef(weekId);
  const existing = (await ref.get()).data();
  if (readMatches(existing).length) return readMatches(existing);
  const prev = (await rivalryRef(prevWeekId).get()).data();
  const matches = pairCrews(crewIds, activeCounts, opponentsOf(readMatches(prev)));
  await ref.set({ weekId, pairedAt: Date.now(), matches: matches.map((crews) => ({ crews })) }, { merge: true });
  return matches;
}
