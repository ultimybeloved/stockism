// GENERATED from src/rules/callRecord.ts by `npm run sync:chars`. Do not edit.
// A player's lifetime record of weekly Calls. Shared rule module (see
// src/rules/ladder.ts): the halt that scores Calls (callResolution.ts) keeps
// users/{uid}.callRecord with nextCallRecord, and the profile and the callers
// board read it with callAccuracy. Weekly mission data is pruned after two
// weeks, so this tally is the only lasting record.
//
// A push or a chapter break is neither right nor wrong: it doesn't count toward
// accuracy and doesn't end a streak. A wrong Call ends it.

import type { CallResult } from './missions';

export interface CallRecord {
  calls: number;
  /** Right Calls, big ones included. */
  wins: number;
  /** Right by 10% or more. */
  big: number;
  losses: number;
  pushes: number;
  breaks: number;
  /** Paid out over all Calls, bonus included. */
  earned: number;
  /** Right Calls in a row. */
  streak: number;
  bestStreak: number;
  last?: { weekId: string; ticker: string; direction: 'up' | 'down'; result: CallResult };
}

export const EMPTY_CALL_RECORD: CallRecord = {
  calls: 0,
  wins: 0,
  big: 0,
  losses: 0,
  pushes: 0,
  breaks: 0,
  earned: 0,
  streak: 0,
  bestStreak: 0,
};

export const nextCallRecord = (
  record: Partial<CallRecord> | null | undefined,
  call: { weekId: string; ticker: string; direction: 'up' | 'down'; result: CallResult; paid: number },
): CallRecord => {
  const r = { ...EMPTY_CALL_RECORD, ...(record || {}) };
  const right = call.result === 'win' || call.result === 'big';
  const streak = right ? r.streak + 1 : call.result === 'loss' ? 0 : r.streak;
  return {
    calls: r.calls + 1,
    wins: r.wins + (right ? 1 : 0),
    big: r.big + (call.result === 'big' ? 1 : 0),
    losses: r.losses + (call.result === 'loss' ? 1 : 0),
    pushes: r.pushes + (call.result === 'push' ? 1 : 0),
    breaks: r.breaks + (call.result === 'break' ? 1 : 0),
    earned: Math.round((r.earned + (call.paid || 0)) * 100) / 100,
    streak,
    bestStreak: Math.max(r.bestStreak, streak),
    last: { weekId: call.weekId, ticker: call.ticker, direction: call.direction, result: call.result },
  };
};

/** Right Calls as a percent of decided ones (pushes and breaks left out), or null with none decided. */
export const callAccuracy = (r: Partial<CallRecord> | null | undefined) => {
  const decided = (r?.wins || 0) + (r?.losses || 0);
  return decided > 0 ? Math.round(((r?.wins || 0) / decided) * 100) : null;
};

/** Board order: most right Calls, then the better accuracy, then the longer best streak. */
export const compareCallRecords = (a: Partial<CallRecord>, b: Partial<CallRecord>) =>
  (b.wins || 0) - (a.wins || 0) ||
  (callAccuracy(b) ?? 0) - (callAccuracy(a) ?? 0) ||
  (b.bestStreak || 0) - (a.bestStreak || 0);
