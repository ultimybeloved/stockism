// Limit orders: the player-facing callable that creates one, plus the schedule
// that sweeps the book. The matching engine itself is in limitOrderMatching.js.

import * as functions from 'firebase-functions/v1';
import { cf, requireAppCheck } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
const db = admin.firestore();

import { CHARACTERS, CHARACTER_MAP } from '../shared/characters';
import {
  isWeeklyTradingHalt,
  NINETY_DAYS_MS,
  MIN_TRADE_SHARES,
  MIN_EXIT_SHARES,
  TRADE_SHARE_DECIMALS,
  chapterReviewHaltMsg,
} from '../shared/constants';
import { touchLastActive, recordHeartbeat } from '../shared/activity';
import { maxTradeSharesFor } from '../shared/impact';
import type { LimitOrder, UserData } from '../shared/types';
import { runLimitOrderCheck } from './limitOrderMatching';
import { assertAccountCanOrder, assertOrderFits } from './limitOrderRules';
import { claimNetworkForOrder, recordOrderOrigin } from './orderNetwork';

export const createLimitOrder = cf().https.onCall(
  async (
    data: { ticker?: unknown; type?: unknown; shares?: unknown; limitPrice?: unknown; allowPartialFills?: unknown },
    context,
  ) => {
    requireAppCheck(context);
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    }

    // Block during weekly halt
    if (isWeeklyTradingHalt()) {
      throw new functions.https.HttpsError('failed-precondition', chapterReviewHaltMsg());
    }

    const uid = context.auth.uid;
    touchLastActive(uid, 'limitOrders');
    const { ticker, type, shares, limitPrice, allowPartialFills } = (data || {}) as {
      ticker: string;
      type: LimitOrder['type'];
      shares: number;
      limitPrice: number;
      allowPartialFills?: boolean;
    };

    // Validate ticker against character whitelist
    if (!ticker || !CHARACTERS.some((c) => c.ticker === ticker)) {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid ticker.');
    }

    // Validate order type (BUY/SELL/STOP_LOSS supported — SHORT/COVER can't execute in checkLimitOrders)
    if (!type || !['BUY', 'SELL', 'STOP_LOSS'].includes(type)) {
      throw new functions.https.HttpsError('invalid-argument', 'Limit orders support BUY, SELL, and STOP_LOSS only.');
    }

    // Validate shares. Exits (SELL/STOP_LOSS) allow fractional dust so a position
    // built from dividends or partial fills can be closed in full; BUY stays on
    // whole-cent share counts.
    const isExitOrder = type === 'SELL' || type === 'STOP_LOSS';
    const minShares = isExitOrder ? MIN_EXIT_SHARES : MIN_TRADE_SHARES;
    const entryStep = 10 ** TRADE_SHARE_DECIMALS;
    if (
      !shares ||
      !Number.isFinite(shares) ||
      shares < minShares ||
      shares > maxTradeSharesFor(ticker) ||
      (!isExitOrder && Math.round(shares * entryStep) / entryStep !== shares)
    ) {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid share quantity.');
    }

    // Validate limit price (must be finite positive number, max 10000)
    if (!limitPrice || !Number.isFinite(limitPrice) || limitPrice <= 0 || limitPrice > 10000) {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid limit price.');
    }

    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'User not found.');
    }

    const userData = userDoc.data() as UserData;
    assertAccountCanOrder(userData);

    // Block orders on IPO-phase tickers that haven't launched — queued orders
    // would otherwise bypass the IPO's per-user and supply limits entirely.
    if (CHARACTER_MAP[ticker]?.ipoRequired) {
      const marketSnap = await db.collection('market').doc('current').get();
      const launchedTickers: string[] = marketSnap.data()?.launchedTickers || [];
      if (!launchedTickers.includes(ticker)) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `${ticker} is in IPO phase. Use the IPO panel to purchase shares.`,
        );
      }
    }

    // Fast answer first, from a plain read. The same checks run again inside
    // the transaction below, which is the one that counts.
    const liveOrdersQuery = db
      .collection('limitOrders')
      .where('userId', '==', uid)
      .where('status', 'in', ['PENDING', 'PARTIALLY_FILLED']);
    const liveOrdersOf = (snap: admin.firestore.QuerySnapshot) => snap.docs.map((d) => d.data() as LimitOrder);
    assertOrderFits(userData, liveOrdersOf(await liveOrdersQuery.get()), { ticker, type, shares });

    // Accounts-per-connection rule, same as executeTrade. After the checks, so
    // an order that fails them never takes one of the connection's slots.
    const networkKey = await claimNetworkForOrder({ context, uid, isBuy: type === 'BUY' });

    // Write the order. The player's record is read and stamped in the same
    // transaction, so two orders placed at the same instant run one after the
    // other and the second sees the first.
    const orderRef = db.collection('limitOrders').doc();
    await db.runTransaction(async (tx) => {
      const freshUser = await tx.get(userRef);
      if (!freshUser.exists) throw new functions.https.HttpsError('not-found', 'User not found.');
      const fresh = freshUser.data() as UserData;
      assertAccountCanOrder(fresh);
      assertOrderFits(fresh, liveOrdersOf(await tx.get(liveOrdersQuery)), { ticker, type, shares });
      tx.set(orderRef, {
        userId: uid,
        ticker,
        type,
        shares,
        limitPrice,
        allowPartialFills: !!allowPartialFills,
        status: 'PENDING',
        filledShares: 0,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: Date.now() + NINETY_DAYS_MS, // 90 days
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.update(userRef, { lastLimitOrderAt: Date.now() });
    });
    // Kept off the order doc on purpose: see orderNetwork.js.
    await recordOrderOrigin(orderRef.id, { uid, key: networkKey });

    return { success: true, orderId: orderRef.id };
  },
);

export const checkLimitOrders = cf()
  .pubsub.schedule('every 15 minutes')
  .timeZone('UTC')
  .onRun(async () => {
    // Skip during weekly halt — don't execute pending orders. The time gate
    // lives here (not in runLimitOrderCheck) so the emulator test can run the
    // processing on any day; the admin-halt gate is data-driven and stays inside.
    if (isWeeklyTradingHalt()) {
      logger.info('Skipping limit order check — weekly trading halt active');
      return { success: true, skipped: true, reason: 'weekly_halt' };
    }
    const result = await runLimitOrderCheck();
    await recordHeartbeat('checkLimitOrders');
    return result;
  });

// Exposed for the emulator end-to-end test (tests/emulator/limitOrders.test.ts)

// ============================================
// SECURE OPERATIONS - Moved from client-side
// These operations modify protected fields (cash, holdings, shorts, marginUsed)
// and must go through Cloud Functions to prevent exploits
// ============================================

/**
 * Claim mission reward (daily or weekly)
 */

export { runLimitOrderCheck };
