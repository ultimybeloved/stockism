// Folding a finished chapter review down to one price point per stock.
//
// Owns two Cloud Functions; the work itself lives in reviewChanges.js, which is
// an internal module and is NOT listed in servicePaths.js.
//
// Timing matters and is load-bearing. The run is at 20:54 UTC, in the quietest
// window of the week: the market is halted, the bot trader and market maker both
// skip the halt, and pre-market orders only queue without touching price history.
// It has to land before the 20:55 lock and the 20:56 opening auction, or the
// review would appear on the chart AFTER the fills that were priced off it.

import { cf, requireAdmin } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
const db = admin.firestore();

import { WEEKLY_HALT_START_MINUTE, WEEKLY_HALT_END_MINUTE } from '../shared/constants';
import { reportError } from '../shared/sentry';
import { writeReviewChanges, collapseReviewWindow } from './reviewChanges';

// The halt window for a given moment's date, in UTC.
const haltWindowFor = (when: Date) => {
  const dayStart = Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate());
  return {
    haltStart: dayStart + WEEKLY_HALT_START_MINUTE * 60 * 1000,
    haltEnd: dayStart + WEEKLY_HALT_END_MINUTE * 60 * 1000,
  };
};

// Most recent Thursday halt, mirroring getMostRecentHaltWindow on the client.
const mostRecentHaltWindow = () => {
  const now = new Date();
  const day = now.getUTCDay();
  const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const d = new Date(now);
  if (!(day === 4 && utcMins >= WEEKLY_HALT_START_MINUTE)) {
    d.setUTCDate(d.getUTCDate() - ((day - 4 + 7) % 7 || 7));
  }
  return haltWindowFor(d);
};

/**
 * Save the review's numbers, then tidy the chart.
 *
 * Order is not optional. Collapsing destroys the step-by-step detail the
 * set/knock-on split is derived from, so the split has to be written first.
 * Re-running writeReviewChanges here also picks up anything adjusted after the
 * 20:30 recap posted.
 */
const finalizeReview = async ({ haltStart, haltEnd }: { haltStart: number; haltEnd: number }) => {
  // The pre-halt snapshot is usually deleted by the recap before this runs; it
  // is only a fallback for a stock with no surviving pre-window point anyway.
  const snapshotSnap = await db.collection('market').doc('preHaltSnapshot').get();
  const fallbackPrices = snapshotSnap.exists ? snapshotSnap.data()!.prices || {} : {};

  const payload = await writeReviewChanges({ haltStart, haltEnd, fallbackPrices, includeArchive: true });
  const { tidied, folded } = await collapseReviewWindow({ haltStart, haltEnd });
  return { tickerCount: payload.tickerCount, tidied, folded };
};

/**
 * Thursday 20:54 UTC, six minutes before the market reopens.
 */
export const collapseReviewHistory = cf({ timeoutSeconds: 300 })
  .pubsub.schedule('54 20 * * 4')
  .timeZone('UTC')
  .onRun(async () => {
    try {
      const result = await finalizeReview(haltWindowFor(new Date()));
      console.log(
        `collapseReviewHistory: ${result.tickerCount} tickers recorded, ` +
          `${result.tidied} tidied, ${result.folded} points folded`,
      );
    } catch (err) {
      // A failure here leaves the chart untidy but costs nothing else: prices
      // are untouched either way, and the admin trigger can re-run it.
      console.error('collapseReviewHistory failed:', err);
      await reportError(err, { where: 'collapseReviewHistory' });
    }
    return null;
  });

/**
 * Admin re-run, for a failed scheduled pass. Idempotent: a stock already folded
 * to one point has nothing left to fold.
 */
export const triggerCollapseReviewHistory = cf({ timeoutSeconds: 300 }).https.onCall(
  async (_data: unknown, context) => {
    requireAdmin(context);

    const result = await finalizeReview(mostRecentHaltWindow());
    return { success: true, ...result };
  },
);
