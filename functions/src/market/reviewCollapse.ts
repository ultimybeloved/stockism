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

import { cf } from '../shared/fnConfig';
import * as logger from 'firebase-functions/logger';

import { reportError } from '../shared/sentry';
import { finalizeReview } from './reviewChanges';
import { holdForDelayedOpen, scheduledReviewWindow } from './delayedOpenState';

/**
 * Thursday 20:54 UTC, six minutes before the market reopens.
 */
export const collapseReviewHistory = cf({ timeoutSeconds: 300 })
  .pubsub.schedule('54 20 * * 4')
  .timeZone('UTC')
  .onRun(async () => {
    try {
      if (await holdForDelayedOpen('collapseReviewHistory')) return null;
      const result = await finalizeReview(scheduledReviewWindow());
      logger.info(
        `collapseReviewHistory: ${result.tickerCount} tickers recorded, ` +
          `${result.tidied} tidied, ${result.folded} points folded`,
      );
    } catch (err) {
      // A failure here leaves the chart untidy but costs nothing else: prices
      // are untouched either way, and the admin trigger can re-run it.
      logger.error('collapseReviewHistory failed:', err);
      await reportError(err, { where: 'collapseReviewHistory' });
    }
    return null;
  });
