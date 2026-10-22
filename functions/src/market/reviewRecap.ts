// The chapter review recap: the Discord post listing what the admin adjusted,
// and the stored copy the Review tab reads. INTERNAL MODULE; chapterReviewRecap
// (market.ts) runs it at 20:30 UTC, delayedOpen.ts at a late reopen.

import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { CHARACTERS } from '../shared/characters';
import { sendDiscordMessage, pxe } from '../shared/discordApi';
import { priceHistoryRef, getReviewWindowChanges } from '../shared/marketData';
import { indexFromStored } from '../shared/indexMaintenance';
import { writeReviewChanges } from './reviewChanges';
import { scheduledReviewWindow, type ReviewWindow } from './delayedOpenState';
import type { PricePoint } from '../shared/types';

const db = admin.firestore();

type RecapLine = { ticker: string; before: number; after: number; change: number };

export async function runChapterReviewRecap(win: ReviewWindow = scheduledReviewWindow()) {
  try {
    // Read pre-halt snapshot
    const snapshotRef = db.collection('market').doc('preHaltSnapshot');
    const snapshotSnap = await snapshotRef.get();

    if (!snapshotSnap.exists) {
      logger.warn('No pre-halt snapshot found, skipping chapter review recap');
      return;
    }

    const beforePrices = snapshotSnap.data()!.prices || {};

    // Read current prices
    const marketSnap = await db.collection('market').doc('current').get();
    if (!marketSnap.exists) {
      logger.error('No current market data found');
      return;
    }

    const afterPrices = marketSnap.data()!.prices || {};

    const { haltStart, haltEnd, reviewEnd } = win;

    const histSnap = await priceHistoryRef().get();
    const priceHistory: Record<string, PricePoint[]> = histSnap.exists ? histSnap.data() || {} : {};

    // Everything the review moved, direct and knock-on. The pre-halt snapshot
    // is the opening price for a ticker with no surviving earlier point.
    // Stop at the pre-market lock: the 20:56 opening auction is inside the
    // halt but is real trading, not part of the review.
    const windowChanges = getReviewWindowChanges(priceHistory, haltStart, reviewEnd, beforePrices);

    // The recap lists the stocks that were actually adjusted, and reports the
    // FULL move each one made — a stock set +4.75% can finish the review up 8%
    // once the knock-on from linked stocks lands on it, and quoting the typed
    // number made the announcement disagree with the chart. Stocks that only
    // moved by knock-on are counted at the end rather than listed, so the
    // recap stays about decisions and does not run past Discord's field cap.
    const adjustments: typeof windowChanges = {};
    let knockOnOnlyCount = 0;
    for (const [ticker, change] of Object.entries(windowChanges)) {
      if (Math.abs(change.directChange) >= 0.01) adjustments[ticker] = change;
      else knockOnOnlyCount++;
    }

    // Build ETF ticker set from CHARACTERS
    const etfTickers = new Set(CHARACTERS.filter((c) => c.isETF).map((c) => c.ticker));

    // Split into gainers/losers; a directly adjusted ETF is tracked separately
    const gainers: RecapLine[] = [];
    const losers: RecapLine[] = [];
    const etfMovements: RecapLine[] = [];

    for (const [ticker, adj] of Object.entries(adjustments)) {
      const entry = { ticker, before: adj.oldPrice, after: adj.newPrice, change: adj.percentChange };
      if (etfTickers.has(ticker)) {
        etfMovements.push(entry);
      } else if (adj.percentChange > 0) {
        gainers.push(entry);
      } else {
        losers.push(entry);
      }
    }

    // Every stock the admin left alone this review
    // Genuinely untouched: not adjusted AND not dragged. Counting off
    // `adjustments` alone would report the knock-on stocks as unchanged and
    // then count them again under Moved On Their Own.
    const unchangedCount = CHARACTERS.filter((c) => !c.isETF && !windowChanges[c.ticker]).length;

    gainers.sort((a, b) => b.change - a.change);
    losers.sort((a, b) => a.change - b.change);

    // Compute SMI before and after
    // The recap used to compute its own index with a plain average, which
    // gave the right percentage change but absolute numbers that have not
    // matched the site's index since the divisor was introduced. Same
    // function as the real one now, so the recap and the site agree.
    // The stored constituents and divisor are a pair; today's roster with the
    // stored divisor disagreed with the site whenever characters were added.
    const idxSnap = await db.collection('market').doc('indexHistory').get();
    const storedIndex = idxSnap.exists ? idxSnap.data() : null;
    const smiBefore = indexFromStored(beforePrices, storedIndex);
    const smiAfter = indexFromStored(afterPrices, storedIndex);
    const smiChange = smiBefore > 0 ? ((smiAfter - smiBefore) / smiBefore) * 100 : 0;

    // Build Discord embed
    const dateStr = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

    const formatLine = (s: RecapLine) =>
      `**${s.ticker}**  $${s.before.toFixed(2)} → $${s.after.toFixed(2)}  (${s.change > 0 ? '+' : ''}${s.change.toFixed(1)}%)`;

    // Discord caps a field value at 1024 chars; ~45 chars a line leaves room.
    const MAX_LINES = 20;
    const formatList = (list: RecapLine[]) => {
      const shown = list.slice(0, MAX_LINES).map(formatLine).join('\n');
      const extra = list.length - MAX_LINES;
      return extra > 0 ? `${shown}\n…and ${extra} more` : shown;
    };

    const fields = [];

    if (gainers.length > 0) {
      fields.push({
        name: `${pxe('trade')} Price Increases`,
        value: formatList(gainers),
        inline: false,
      });
    }

    if (losers.length > 0) {
      fields.push({
        name: `${pxe('chart_down')} Price Decreases`,
        value: formatList(losers),
        inline: false,
      });
    }

    if (gainers.length === 0 && losers.length === 0 && etfMovements.length === 0) {
      fields.push({
        name: `${pxe('flat')} No Changes`,
        value: 'No price adjustments were made this week.',
        inline: false,
      });
    } else if (unchangedCount > 0) {
      fields.push({
        name: `${pxe('flat')} Unchanged`,
        value: `${unchangedCount} stock${unchangedCount !== 1 ? 's' : ''}`,
        inline: false,
      });
    }

    if (etfMovements.length > 0) {
      fields.push({
        name: `${pxe('basket')} ETF Movements`,
        value: formatList(etfMovements.sort((a, b) => b.change - a.change)),
        inline: false,
      });
    }

    if (knockOnOnlyCount > 0) {
      fields.push({
        name: `${pxe('link')} Moved On Their Own`,
        value:
          `${knockOnOnlyCount} stock${knockOnOnlyCount !== 1 ? 's' : ''} moved without being adjusted, ` +
          'because a stock they follow was.',
        inline: false,
      });
    }

    const smiSign = smiChange >= 0 ? '+' : '';
    fields.push({
      name: `${pxe('chart')} Stockism Market Index`,
      value: `${Math.round(smiBefore).toLocaleString()} → ${Math.round(smiAfter).toLocaleString()} (${smiSign}${smiChange.toFixed(1)}%)`,
      inline: false,
    });

    const embed = {
      title: `${pxe('book')} Chapter Review Recap`,
      description: dateStr,
      color: 0x9b59b6,
      fields,
      timestamp: new Date().toISOString(),
    };

    await sendDiscordMessage(null, [embed]);

    // Store the same result for the Review tab. Computed here, while the live
    // price history still covers the whole window — the browser cannot
    // reconstruct it later once those points age out. A failure must not lose
    // the Discord recap that already went out.
    try {
      await writeReviewChanges({ haltStart, haltEnd, reviewEnd, fallbackPrices: beforePrices });
    } catch (e) {
      logger.error('Failed to store review changes for the Review tab:', e);
    }

    // Cleanup snapshot
    await snapshotRef.delete();
    logger.info(
      `Chapter review recap sent: ${gainers.length} gainers, ${losers.length} losers, ${unchangedCount} unchanged`,
    );

    return;
  } catch (error) {
    logger.error('Error in chapterReviewRecap:', error);
  }
}
