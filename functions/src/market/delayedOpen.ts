// A late Thursday reopen, for when the chapter translation runs late. The rules
// and the step list live in delayedOpenState.ts.
//
// adminDelayOpen pushes today's open back (or cancels a delay before anything
// ran). delayedOpenTick runs every minute on Thursdays and fires each held step
// once its time comes: the recap and the pre-market queue 30 minutes before the
// new open, the review collapse, the chapter marker and the opening auction just
// before it, then the open itself and the weekly posts after.

import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { cf, requireAdmin } from '../shared/fnConfig';
import { sendMarketStatusAlert } from '../shared/discordApi';
import { recordHeartbeat } from '../shared/activity';
import { reportError } from '../shared/sentry';
import { logAdminAction } from '../shared/adminLog';
import {
  DELAYED_STEPS,
  delayFor,
  delayedPreMarket,
  reviewWindowFor,
  scheduledOpenFor,
  type DelayedOpen,
} from './delayedOpenState';
import { finalizeReview } from './reviewChanges';
import { runChapterReviewRecap } from './reviewRecap';
import { recordChapterMarker } from './chapterMarkers';
import { runWeeklyCrewRankings, runWeeklyMarketSummary, runWeeklyLeaderboard } from './marketWeekly';
import { runMarketOpenProcessing } from '../orders/marketOrders';

const db = admin.firestore();
const marketRef = () => db.collection('market').doc('current');
const MIN = 60 * 1000;
// Every step, up to the weekly leaderboard 15 minutes after the open, has to
// run before midnight: delayedOpenTick only runs on Thursdays and a delay stops
// counting on Friday, so a later step would never run and its usual job had
// already stood down. A 23:40 open puts the last step at 23:55.
const MAX_DELAY_MIN = 160;

export const DELAY_REASON = 'The chapter is late, so the market opens late today.';

/** Push today's reopen back by `minutes` (0 cancels). Only before the held steps begin. */
export const adminDelayOpen = cf().https.onCall(async (data: { minutes?: unknown }, context) => {
  requireAdmin(context, 'Admin only.');
  const minutes = Number(data?.minutes);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_DELAY_MIN) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Minutes must be a whole number from 0 to ${MAX_DELAY_MIN}.`,
    );
  }
  const now = Date.now();
  if (new Date(now).getUTCDay() !== 4) {
    throw new functions.https.HttpsError('failed-precondition', 'The open can only be delayed on a Thursday.');
  }
  const scheduled = scheduledOpenFor(now);
  const openAt = scheduled + minutes * MIN;

  await db.runTransaction(async (tx) => {
    const market = (await tx.get(marketRef())).data();
    const current = delayFor(market, now);
    if (current?.done?.length) {
      throw new functions.https.HttpsError('failed-precondition', 'The late open has already started.');
    }
    // The 20:30 recap is the first held step. Once its time has passed on the
    // old schedule, a change would have run (or skipped) it already.
    if (now >= delayedPreMarket(current?.openAt ?? scheduled).start) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Too late to change the open: pre-market has started.',
      );
    }
    if (minutes > 0 && now >= delayedPreMarket(openAt).start) {
      throw new functions.https.HttpsError('failed-precondition', 'That open is too soon. Pick a later time.');
    }
    if (minutes === 0) {
      tx.update(marketRef(), {
        delayedOpen: FieldValue.delete(),
        ...(current ? { marketHalted: false, haltReason: '', haltedAt: null, haltedBy: null } : {}),
      });
    } else {
      const delayedOpen: DelayedOpen = { openAt, done: [] };
      tx.update(marketRef(), {
        delayedOpen,
        marketHalted: true,
        haltReason: DELAY_REASON,
        haltedAt: now,
        haltedBy: context.auth!.uid,
      });
    }
  });

  await logAdminAction(context, { action: 'delay_open', detail: { minutes, openAt: minutes ? openAt : null } });
  return { success: true, openAt: minutes ? openAt : null };
});

const runStep = async (id: string, d: DelayedOpen) => {
  const win = reviewWindowFor(d.openAt);
  switch (id) {
    case 'chapterReviewRecap':
      return runChapterReviewRecap(win);
    case 'preMarketOpenAlert':
      return sendMarketStatusAlert('premarket');
    case 'collapseReviewHistory':
      return finalizeReview(win);
    case 'weeklyCallsResolve':
      // The marker belongs to the week that is ending, and getWeekId rolls over
      // at 21:00, so it is dated inside the halt.
      return recordChapterMarker(win.haltStart);
    case 'processMarketOpenOrders':
      return runMarketOpenProcessing('schedule');
    case 'marketOpenAlert':
      await marketRef().update({ marketHalted: false, haltReason: '', haltedAt: null, haltedBy: null });
      return sendMarketStatusAlert('open');
    case 'weeklyCrewRankings':
      return runWeeklyCrewRankings();
    case 'weeklyMarketSummary':
      return runWeeklyMarketSummary();
    case 'weeklyLeaderboard':
      return runWeeklyLeaderboard();
  }
};

// Claimed before running, so a slow step can't run twice when the next minute's
// tick starts while it's still going.
const claim = (id: string, now: number) =>
  db.runTransaction(async (tx) => {
    const d = delayFor((await tx.get(marketRef())).data(), now);
    if (!d || (d.done || []).includes(id)) return null;
    tx.update(marketRef(), { 'delayedOpen.done': FieldValue.arrayUnion(id) });
    return d;
  });

export const delayedOpenTick = cf({ timeoutSeconds: 540 })
  .pubsub.schedule('* * * * 4')
  .timeZone('UTC')
  .onRun(async () => {
    const now = Date.now();
    const d = delayFor((await marketRef().get()).data(), now);
    if (!d) return null;
    for (const step of DELAYED_STEPS) {
      if (now < d.openAt + step.at * MIN) break;
      if ((d.done || []).includes(step.id)) continue;
      const claimed = await claim(step.id, now);
      if (!claimed) continue;
      try {
        await runStep(step.id, claimed);
        await recordHeartbeat(step.id);
        logger.info(`delayedOpenTick: ran ${step.id}`);
      } catch (err) {
        reportError(err, { where: `delayedOpenTick:${step.id}` });
      }
    }
    return null;
  });
