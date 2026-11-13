// INTERNAL MODULE (not in index.ts). The checks that decide whether a new limit
// order fits beside the player's account and their other live orders.
//
// createLimitOrder runs these twice: once up front for a fast answer, then
// again inside the transaction that writes the order, against a fresh read.
// Without the second pass two orders placed at the same instant each saw the
// book without the other and both got through the cap and duplicate checks.

import * as functions from 'firebase-functions/v1';
import { oppositePositionError } from '../shared/oppositePosition';
import { lockedShares } from '../shared/cohorts';
import { checkDiscordWall } from '../shared/accountGuards';
import type { LimitOrder, UserData } from '../shared/types';

const fail = (code: functions.https.FunctionsErrorCode, message: string) =>
  new functions.https.HttpsError(code, message);

export const MAX_LIVE_ORDERS = 20;

/** Account-level gates: banned, walled, bankrupt, in debt. */
export function assertAccountCanOrder(userData: UserData) {
  if (userData.isBanned) throw fail('permission-denied', 'Account is banned.');
  // Suspected-alt wall: same gate as executeTrade, or queued orders bypass it
  checkDiscordWall(userData);
  if (userData.isBankrupt) throw fail('failed-precondition', 'Cannot create orders while bankrupt.');
  if ((userData.cash || 0) < 0) throw fail('failed-precondition', 'Cannot create orders while in debt.');
}

/**
 * `liveOrders` are the player's PENDING and PARTIALLY_FILLED orders. Partially
 * filled ones are still live, so they count toward the cap, reserved shares,
 * and the duplicate check just like pending ones.
 */
export function assertOrderFits(
  userData: UserData,
  liveOrders: LimitOrder[],
  { ticker, type, shares }: { ticker: string; type: LimitOrder['type']; shares: number },
) {
  if (liveOrders.length >= MAX_LIVE_ORDERS) {
    throw fail('resource-exhausted', 'Maximum 20 pending orders allowed.');
  }

  const isExit = type === 'SELL' || type === 'STOP_LOSS';
  const isExitOrder = (o: LimitOrder) => o.type === 'SELL' || o.type === 'STOP_LOSS';

  if (isExit) {
    // Holdings, minus shares already reserved by live sells / stop losses
    const currentHoldings = userData.holdings?.[ticker] || 0;
    if (currentHoldings < shares) throw fail('failed-precondition', 'Insufficient holdings to sell.');
    const reserved = liveOrders
      .filter((o) => o.ticker === ticker && isExitOrder(o))
      .reduce((sum, o) => sum + (o.shares - (o.filledShares || 0)), 0); // only the unfilled remainder
    if (currentHoldings < shares + reserved) {
      throw fail('failed-precondition', 'Insufficient holdings (some shares reserved by pending orders).');
    }

    // Lockups: can't queue a sell / stop-loss against IPO- or margin-locked shares
    // (otherwise a queued order would dodge the hold and flip the position).
    const locks = lockedShares(userData, ticker);
    if (locks.total > 0) {
      const freeShares = Math.max(0, currentHoldings - locks.total);
      if (shares > freeShares) {
        const parts: string[] = [];
        if (locks.ipo > 0) parts.push(`${locks.ipo} IPO-locked`);
        if (locks.margin > 0) parts.push(`${locks.margin} margin-locked`);
        throw fail(
          'failed-precondition',
          `Some $${ticker} shares are locked (${parts.join(', ')}). You can place a sell for up to ${freeShares} now.`,
        );
      }
    }

    // Anti-manipulation: no sell order while short the same ticker
    if ((userData.shorts?.[ticker]?.shares || 0) > 0) {
      throw fail('failed-precondition', 'Cannot place a sell order while you have an active short on this stock.');
    }
  } else {
    // Long and short never mix.
    const opposite = oppositePositionError(userData, ticker, 'buy');
    if (opposite) throw fail('failed-precondition', opposite);
  }

  // One live order per ticker and side. SELL and STOP_LOSS count as the same
  // side to prevent double-selling.
  const duplicate = liveOrders.some((o) => o.ticker === ticker && (isExit ? isExitOrder(o) : o.type === type));
  if (duplicate) {
    throw fail(
      'already-exists',
      isExit
        ? `You already have a pending sell or stop-loss order on ${ticker}. Cancel it first.`
        : `You already have a pending buy order on ${ticker}. Cancel it first.`,
    );
  }
}
