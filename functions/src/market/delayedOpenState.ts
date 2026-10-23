// A late reopen. When the chapter translation runs late, the admin pushes this
// Thursday's reopen back (adminDelayOpen). market/current.delayedOpen holds the
// new open time. The market stays halted (marketHalted) until then, the usual
// reopen jobs stand down, and delayedOpenTick runs each one at the same distance
// from the new open as it normally sits from 21:00. INTERNAL MODULE.

import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import {
  WEEKLY_HALT_START_MINUTE,
  WEEKLY_HALT_END_MINUTE,
  PRE_MARKET_START_MINUTE,
  PRE_MARKET_LOCK_MINUTE,
  REVIEW_COLLAPSE_MINUTE,
} from '../shared/constants';

const MIN = 60 * 1000;

export interface ReviewWindow {
  haltStart: number;
  /** The open. */
  haltEnd: number;
  /** The pre-market lock: the review counts moves up to here. */
  reviewEnd: number;
  /** Where the collapsed review point is stamped. */
  collapseAt: number;
}

export interface DelayedOpen {
  openAt: number;
  /** Steps already run, by job name. */
  done?: string[];
}

const dayStartOf = (ms: number) => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

/** 21:00 UTC on the day of `ms`. */
export const scheduledOpenFor = (ms: number) => dayStartOf(ms) + WEEKLY_HALT_END_MINUTE * MIN;

/** The review window for a reopen at `openAt`. */
export const reviewWindowFor = (openAt: number): ReviewWindow => ({
  haltStart: dayStartOf(openAt) + WEEKLY_HALT_START_MINUTE * MIN,
  haltEnd: openAt,
  reviewEnd: openAt - (WEEKLY_HALT_END_MINUTE - PRE_MARKET_LOCK_MINUTE) * MIN,
  collapseAt: openAt - (WEEKLY_HALT_END_MINUTE - REVIEW_COLLAPSE_MINUTE) * MIN,
});

/** The usual 21:00 window on the day of `ms`. */
export const scheduledReviewWindow = (ms: number = Date.now()) => reviewWindowFor(scheduledOpenFor(ms));

/** This day's late reopen, or null. A delay left from an earlier week doesn't count. */
export const delayFor = (market: { delayedOpen?: DelayedOpen } | undefined, now = Date.now()): DelayedOpen | null => {
  const d = market?.delayedOpen;
  if (!d || !(d.openAt > scheduledOpenFor(d.openAt))) return null;
  return dayStartOf(d.openAt) === dayStartOf(now) ? d : null;
};

const marketRef = () => admin.firestore().collection('market').doc('current');

export async function readDelayedOpen(now = Date.now()) {
  return delayFor((await marketRef().get()).data(), now);
}

/** True, and logged, when a scheduled reopen job should leave its work to delayedOpenTick. */
export async function holdForDelayedOpen(job: string) {
  const d = await readDelayedOpen();
  if (!d) return false;
  logger.info(`${job}: held for the late reopen at ${new Date(d.openAt).toISOString()}`);
  return true;
}

/** The pre-market queue for a late reopen: [start, lock). */
export const delayedPreMarket = (openAt: number) => ({
  start: openAt - (WEEKLY_HALT_END_MINUTE - PRE_MARKET_START_MINUTE) * MIN,
  lock: openAt - (WEEKLY_HALT_END_MINUTE - PRE_MARKET_LOCK_MINUTE) * MIN,
});

/** Each held job and its minutes from the open, in the order they normally run. */
export const DELAYED_STEPS = [
  { id: 'chapterReviewRecap', at: PRE_MARKET_START_MINUTE - WEEKLY_HALT_END_MINUTE },
  { id: 'preMarketOpenAlert', at: PRE_MARKET_START_MINUTE - WEEKLY_HALT_END_MINUTE },
  { id: 'collapseReviewHistory', at: REVIEW_COLLAPSE_MINUTE - WEEKLY_HALT_END_MINUTE },
  { id: 'weeklyCallsResolve', at: PRE_MARKET_LOCK_MINUTE - WEEKLY_HALT_END_MINUTE },
  { id: 'processMarketOpenOrders', at: PRE_MARKET_LOCK_MINUTE + 1 - WEEKLY_HALT_END_MINUTE },
  { id: 'marketOpenAlert', at: 0 },
  { id: 'weeklyCrewRankings', at: 5 },
  { id: 'weeklyMarketSummary', at: 10 },
  { id: 'weeklyLeaderboard', at: 15 },
] as const;
