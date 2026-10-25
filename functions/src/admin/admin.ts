// Direct admin actions on players and the market: bans and price-cliff repair.
// The backup/restore tooling is in adminBackups.js.

import * as functions from 'firebase-functions/v1';
import { cf, requireAdmin } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import type { Timestamp } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
const db = admin.firestore();

import { sendDiscordDM, pxe } from '../shared/discordApi';
import { ADMIN_DISCORD_USER_ID } from '../shared/constants';
import { priceHistoryRef } from '../shared/marketData';
import { recordLedger } from '../shared/ledger';
import { logAdminAction } from '../shared/adminLog';
import { readBook, orderSession, type BookChange } from '../orders/preMarketBook';
import type { PreMarketOrder } from '../orders/preMarket';

/**
 * Cancel every open order a banned user left on the books.
 *
 * The ban itself wipes holdings and resets cash, so a surviving order is either
 * selling shares that no longer exist or spending the rollback cash. The fill
 * paths reject banned users now, but leaving the orders PENDING means the sweep
 * re-reads and re-cancels them every cycle and the player still sees them as
 * live in their order list. Clear them at ban time instead.
 *
 * @param {string} userId - Banned user's ID
 * @returns {Promise<{limit: number, preMarket: number}>} counts cancelled
 */
const cancelOpenOrders = async (userId: string) => {
  const counts = { limit: 0, preMarket: 0 };
  const stamp = FieldValue.serverTimestamp();

  const [limitSnap, preMarketSnap] = await Promise.all([
    db
      .collection('limitOrders')
      .where('userId', '==', userId)
      .where('status', 'in', ['PENDING', 'PARTIALLY_FILLED'])
      .get(),
    db.collection('preMarketOrders').where('userId', '==', userId).where('status', '==', 'PENDING').get(),
  ]);

  if (limitSnap.empty && preMarketSnap.empty) return counts;

  const batch = db.batch();
  limitSnap.docs.forEach((doc) => {
    batch.update(doc.ref, { status: 'CANCELED', cancelReason: 'Account is banned', updatedAt: stamp });
    counts.limit++;
  });
  await batch.commit();

  // Pre-market orders also leave the public queue totals, so they're cancelled
  // in a transaction with market/preMarketBook.
  if (!preMarketSnap.empty) {
    counts.preMarket = await db.runTransaction(async (tx) => {
      const fresh = await Promise.all(preMarketSnap.docs.map((d) => tx.get(d.ref)));
      const writeBook = await readBook(tx);
      const changes: BookChange[] = [];
      for (const snap of fresh) {
        const order = snap.data() as PreMarketOrder & { createdAt?: Timestamp };
        if (!order || order.status !== 'PENDING') continue;
        tx.update(snap.ref, { status: 'CANCELED', cancelReason: 'Account is banned', updatedAt: stamp });
        changes.push({
          ticker: order.ticker,
          action: order.action,
          shares: order.shares,
          sign: -1,
          session: orderSession(order.createdAt),
        });
      }
      writeBook(changes);
      return changes.length;
    });
  }

  return counts;
};

/**
 * Admin function to ban a user and rollback fraudulent gains
 * @param {string} userId - User ID to ban
 * @param {number} rollbackCash - Cash amount to reset to (default: 1000)
 * @param {string} reason - Reason for ban
 */
export const banUser = cf().https.onCall(async (data, context) => {
  requireAdmin(context, 'Only admin can ban users.');

  const { userId, rollbackCash = 1000, reason } = data;

  if (!userId) {
    throw new functions.https.HttpsError('invalid-argument', 'User ID is required.');
  }

  try {
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'User not found.');
    }

    const userData = userDoc.data()!;
    const displayName = userData.displayName;

    // Create ban record
    await db.collection('banned_users').doc(userId).set({
      uid: userId,
      displayName,
      bannedAt: FieldValue.serverTimestamp(),
      bannedBy: context.auth!.uid,
      reason,
      originalCash: userData.cash,
      originalPortfolio: userData.portfolioValue,
      rollbackCash,
    });

    // Reset user to starting state
    const banBatch = db.batch();
    // Positions are wiped too (the ban record keeps the originals); the ledger
    // records the cash reset.
    recordLedger(banBatch, {
      uid: userId,
      type: 'admin_ban_reset',
      amount: rollbackCash - (userData.cash || 0),
      cashAfter: rollbackCash,
      detail: { by: context.auth!.uid },
    });
    banBatch.update(userRef, {
      cash: rollbackCash,
      holdings: {},
      shorts: {},
      hasOpenShorts: false,
      costBasis: {},
      // Same reason the locks below are cleared: these describe shares this
      // wipe just destroyed. A reinstated account would otherwise carry the
      // old position's dividend/exit-loyalty standing into its rebuild.
      holdingCohorts: {},
      lowestWhileHolding: {},
      // Clear the share locks along with the shares they referred to — a lock left
      // pointing at destroyed shares blocks selling anything rebought on that
      // ticker if the account is ever reinstated (reinstateUser only adds cash).
      marginLockup: {},
      ipoLockup: {},
      portfolioValue: rollbackCash,
      lastPortfolioSnapshot: { timestamp: Date.now(), value: rollbackCash },
      marginUsed: 0,
      isBanned: true,
      bannedAt: FieldValue.serverTimestamp(),
      banReason: reason,
    });
    await banBatch.commit();

    // Record the rollback in the permanent history subcollection
    await userRef.collection('portfolioHistory').add({ timestamp: Date.now(), value: rollbackCash });

    // Pull their open orders off the books — the wipe above just destroyed the
    // shares and cash those orders were written against.
    let cancelled = { limit: 0, preMarket: 0 };
    try {
      cancelled = await cancelOpenOrders(userId);
    } catch (err) {
      // The ban itself already committed; a failure here is recoverable (the
      // fill paths reject banned users) so don't fail the whole call.
      logger.error('Failed to cancel open orders for banned user:', err);
    }

    // Log to console
    logger.info(
      `USER BANNED: ${displayName} (${userId}) - Reason: ${reason} - cancelled ${cancelled.limit} limit / ${cancelled.preMarket} pre-market orders`,
    );

    // Tell the admin by DM. Never the public channel: bans aren't announced.
    try {
      const orderNote =
        cancelled.limit + cancelled.preMarket > 0
          ? `\nCancelled ${cancelled.limit} limit / ${cancelled.preMarket} pre-market orders`
          : '';
      if (ADMIN_DISCORD_USER_ID)
        await sendDiscordDM(
          ADMIN_DISCORD_USER_ID,
          `${pxe('hammer')} **User Banned**\nUsername: ${displayName}\nReason: ${reason}\nRolled back from $${(userData.cash || 0).toFixed(2)} to $${rollbackCash}${orderNote}`,
        );
    } catch (err) {
      logger.error('Failed to send Discord alert:', err);
    }

    await logAdminAction(context, {
      action: 'ban',
      uid: userId,
      name: displayName,
      before: { cash: userData.cash || 0, portfolioValue: userData.portfolioValue || 0 },
      after: { cash: rollbackCash, isBanned: true },
      detail: { reason: reason || null },
    });

    return {
      success: true,
      message: `User ${displayName} has been banned and reset to $${rollbackCash}`,
      previousCash: userData.cash,
      previousPortfolio: userData.portfolioValue,
    };
  } catch (error) {
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    logger.error('Ban user error:', error);
    throw new functions.https.HttpsError('internal', 'Failed to ban user: ' + (error as Error).message);
  }
});

/**
 * Fix Base Price Cliffs - Removes first data point if >2% jump to second
 * Admin only - fixes chart artifacts from data loss
 */
export const fixBasePriceCliffs = cf().https.onCall(async (data, context) => {
  requireAdmin(context, 'Only admin can fix price cliffs.');

  try {
    const histRef = priceHistoryRef();
    const histDoc = await histRef.get();

    if (!histDoc.exists) {
      throw new Error('Price history document not found');
    }

    const priceHistory = histDoc.data() || {};

    let tickersFixed = 0;
    let tickersSkipped = 0;
    const updates: Record<string, unknown[]> = {};
    const fixedTickers = [];

    for (const [ticker, history] of Object.entries(priceHistory)) {
      if (!history || history.length < 2) {
        tickersSkipped++;
        continue;
      }

      const firstPrice = history[0].price;
      const secondPrice = history[1].price;
      const percentChange = firstPrice > 0 ? ((secondPrice - firstPrice) / firstPrice) * 100 : 0;

      if (Math.abs(percentChange) > 2) {
        fixedTickers.push({
          ticker,
          firstPrice,
          secondPrice,
          percentChange: percentChange.toFixed(2),
          firstTimestamp: new Date(history[0].timestamp).toISOString(),
        });

        // Remove the first element
        updates[ticker] = history.slice(1);
        tickersFixed++;
      } else {
        tickersSkipped++;
      }
    }

    if (tickersFixed === 0) {
      return {
        success: true,
        tickersFixed: 0,
        tickersSkipped,
        message: 'No cliffs found - all data looks good!',
      };
    }

    // Apply updates
    await histRef.update(updates);
    await logAdminAction(context, { action: 'fix_price_cliffs', detail: { tickersFixed, fixed: fixedTickers } });

    return {
      success: true,
      tickersFixed,
      tickersSkipped,
      fixed: fixedTickers,
      message: `Fixed ${tickersFixed} tickers with base price cliffs`,
    };
  } catch (error) {
    logger.error('Error fixing base price cliffs:', error);
    throw new functions.https.HttpsError('internal', 'Failed to fix price cliffs: ' + (error as Error).message);
  }
});
