// Dust cleanup: one-click close of tiny positions. Split out of portfolio.ts
// (2026-10-14) to keep that file under its size limit.
import * as functions from 'firebase-functions/v1';
import { cf, requireAppCheck } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
import { FieldValue, type Timestamp } from 'firebase-admin/firestore';
const db = admin.firestore();

import { CHARACTER_MAP } from '../shared/characters';
import {
  BID_ASK_SPREAD,
  ETF_BID_ASK_SPREAD,
  MIN_PRICE,
  DUST_MAX_VALUE,
  isWeeklyTradingHalt,
  TRADE_HOLD_PERIOD_MS,
  LEGACY_SHORT_MARGIN_RATIO,
} from '../shared/constants';
import { stampMs } from '../shared/impact';
import { touchLastActive } from '../shared/activity';
import { lockedShares } from '../shared/cohorts';
import { reportError } from '../shared/sentry';
import { checkDiscordWall } from '../shared/accountGuards';
import { round2 } from '../shared/money';
import type { ShortPosition } from '../shared/types';
import { recordLedger } from '../shared/ledger';

const getSpread = (ticker: string) => (CHARACTER_MAP[ticker]?.isETF ? ETF_BID_ASK_SPREAD : BID_ASK_SPREAD);

/**
 * Dust cleanup: liquidate all of a user's tiny long positions (market value
 * below DUST_MAX_VALUE) to cash in a single pass.
 *
 * Why this exists and isn't just a "sell all" loop: the normal trade path only
 * accepts sell amounts of >= 0.01 shares in 0.01 steps, but holdings are stored
 * to 4 decimals. Sub-0.01-share slivers are therefore un-sellable and pile up as
 * "a few cents in every stock". This sweep sells at the current bid with no
 * price impact (the amounts are far below what moves the market) and clears the
 * whole position, slivers included.
 *
 * Deliberately NOT a trade: it does not touch trade history, trade counts, or
 * mission progress, so it can't be used to farm trade-count missions. Locked
 * shares (IPO / margin holds) are skipped entirely.
 *
 * `{ side: 'short' }` does the same for tiny SHORT positions instead: each is
 * bought back at the ask, with no price impact, and its collateral comes back
 * the way a normal cover returns it (see computeCover in trading/tradeActions).
 */
export const sweepDustPositions = cf().https.onCall(async (data: { side?: unknown } | null, context) => {
  requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  // Selling dust is still selling — it follows the same halt rules as trades.
  if (isWeeklyTradingHalt()) {
    throw new functions.https.HttpsError('failed-precondition', 'Market is closed for the weekly halt.');
  }

  const uid = context.auth.uid;
  touchLastActive(uid, 'portfolio');

  const userRef = db.collection('users').doc(uid);
  const marketRef = db.collection('market').doc('current');

  let result = { swept: 0, proceeds: 0 };

  try {
    await db.runTransaction(async (transaction) => {
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'User not found.');
      }
      const marketSnap = await transaction.get(marketRef);

      const userData = userSnap.data()!;
      if (userData.isBanned) {
        throw new functions.https.HttpsError('permission-denied', 'Account is banned.');
      }
      // Suspected-alt wall: a dust sweep converts shares to cash like any sell
      checkDiscordWall(userData);

      const marketData = marketSnap.exists ? marketSnap.data()! : {};
      if (marketData.marketHalted) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          marketData.haltReason || 'Market is currently halted.',
        );
      }

      const prices: Record<string, number> = marketData.prices || {};
      const haltedTickers = marketData.haltedTickers || {};
      const holdings: Record<string, number> = userData.holdings || {};
      const now = Date.now();

      let proceeds = 0;
      let swept = 0;
      const updates: Record<string, unknown> = {};
      const sweepShorts = data?.side === 'short';

      if (sweepShorts) {
        const shorts: Record<string, ShortPosition | null> = userData.shorts || {};
        let remaining = 0;
        for (const [ticker, pos] of Object.entries(shorts)) {
          const shares = pos?.shares || 0;
          if (!pos || shares <= 0) continue;
          remaining++;
          const price = prices[ticker] != null ? prices[ticker] : CHARACTER_MAP[ticker]?.basePrice || 0;
          if (!(price > 0) || shares * price >= DUST_MAX_VALUE) continue;
          const tickerHalt = haltedTickers[ticker];
          if (tickerHalt && tickerHalt.resumeAt && now < tickerHalt.resumeAt) continue;
          // Same 45-second hold as a normal cover.
          if (now - stampMs(pos.openedAt as Timestamp | number | undefined) < TRADE_HOLD_PERIOD_MS) continue;

          const ask = round2(price * (1 + getSpread(ticker) / 2));
          const costBasis = pos.costBasis || pos.entryPrice || ask;
          const margin = pos.margin || costBasis * shares * LEGACY_SHORT_MARGIN_RATIO;
          // v2 posted collateral and got no proceeds, so it gets the collateral
          // back plus or minus the move. Legacy got the proceeds at open, so it
          // pays the buy-back out of cash and gets the collateral back.
          proceeds += (pos.system || 'v2') === 'v2' ? margin + (costBasis - ask) * shares : margin - ask * shares;
          swept++;
          remaining--;
          updates[`shorts.${ticker}`] = FieldValue.delete();
        }
        if (swept > 0) updates.hasOpenShorts = remaining > 0;
      }

      for (const [ticker, sharesRaw] of Object.entries(sweepShorts ? {} : holdings)) {
        const shares = sharesRaw || 0;
        if (shares <= 0) continue;

        const price = prices[ticker] != null ? prices[ticker] : CHARACTER_MAP[ticker]?.basePrice || 0;
        if (!(price > 0)) continue;

        // Only tiny positions.
        if (shares * price >= DUST_MAX_VALUE) continue;

        // Skip tickers under a circuit-breaker halt.
        const tickerHalt = haltedTickers[ticker];
        if (tickerHalt && tickerHalt.resumeAt && now < tickerHalt.resumeAt) continue;

        // Never sweep locked shares (IPO lockup / margin-funded holds). If any
        // part of the position is locked, leave the whole thing alone.
        if (lockedShares(userData, ticker, now).total > 0) continue;

        const bid = Math.max(MIN_PRICE, round2(price * (1 - getSpread(ticker) / 2)));
        proceeds += bid * shares;
        swept++;

        updates[`holdings.${ticker}`] = FieldValue.delete();
        updates[`costBasis.${ticker}`] = FieldValue.delete();
        updates[`lowestWhileHolding.${ticker}`] = FieldValue.delete();
        // Position is fully closed — drop the dividend cohort like the normal
        // sell path does (also resets the ETF firstHeldAt clock).
        updates[`holdingCohorts.${ticker}`] = FieldValue.delete();
      }

      if (swept === 0) {
        result = { swept: 0, proceeds: 0 };
        return;
      }

      proceeds = round2(proceeds);
      updates.cash = FieldValue.increment(proceeds);
      updates.lastTradeTime = FieldValue.serverTimestamp();
      transaction.update(userRef, updates);
      recordLedger(transaction, {
        uid,
        type: 'dust_sweep',
        amount: proceeds,
        cashAfter: (userData.cash || 0) + proceeds,
        detail: { positions: swept, side: sweepShorts ? 'short' : 'long' },
      });

      result = { swept, proceeds };
    });
  } catch (err) {
    if (err instanceof functions.https.HttpsError) throw err;
    reportError(err, { where: 'sweepDustPositions', uid });
    throw new functions.https.HttpsError('internal', 'Could not clean up dust.');
  }

  return { success: true, ...result };
});
