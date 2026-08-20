'use strict';
// Post-commit side effects for a limit-order fill or cancel. INTERNAL MODULE —
// not exported through functions/index.js, same pattern as tradeEffects.
//
// Everything here runs AFTER the transaction has committed. None of it may
// throw into the fill path: the trade is already done, and a failed feed write
// must not look like a failed trade.

const { writeNotification, writeFeedEntry } = require('../helpers');
const { updateCrewMissionProgress } = require('./crewMissionProgress');

/** "Stop Loss" / "BUY limit order" — one label, used by both notifications. */
const orderLabel = (order, { capitalized = false } = {}) => {
  if (order.type === 'STOP_LOSS') return capitalized ? 'Stop Loss' : 'Stop loss';
  return capitalized ? `${order.type} Limit Order` : `${order.type} limit order`;
};

/**
 * Tell the user their order was canceled. A silently vanished stop loss leaves
 * them thinking they're still protected.
 */
const notifyCanceled = async (order, orderId, reason) => {
  const label = orderLabel(order, { capitalized: true });
  await writeNotification(order.userId, {
    type: 'trade',
    title: `${label} Canceled`,
    message: `Your ${label.toLowerCase()} for ${order.shares} $${order.ticker} was canceled: ${reason}`,
    data: { ticker: order.ticker, orderId },
  });
};

/**
 * Same reasoning as notifyCanceled, for an order that simply ran out its clock.
 * Orders live 90 days, which is long enough that a stop loss quietly reaching
 * its expiry is exactly the case where the owner has stopped thinking about it.
 */
const notifyExpired = async (order, orderId) => {
  const label = orderLabel(order, { capitalized: true });
  await writeNotification(order.userId, {
    type: 'trade',
    title: `${label} Expired`,
    message: `Your ${label.toLowerCase()} for ${order.shares} $${order.ticker} at $${Number(order.limitPrice || 0).toFixed(2)} expired without filling. It is no longer on the book.`,
    data: { ticker: order.ticker, orderId },
  });
};

/**
 * Everything that happens once a fill is committed: the user's notification,
 * crew mission credit, and the public feed entry.
 */
const publishFill = async (order, orderId, { fillShares, executedPrice, tradeValue, displayName, crew }) => {
  const label = orderLabel(order);
  await writeNotification(order.userId, {
    type: 'trade',
    title: `${label} Filled`,
    message: `Your ${label.toLowerCase()} for ${fillShares} $${order.ticker} executed at $${executedPrice.toFixed(2)}`,
    data: { ticker: order.ticker, orderId, price: executedPrice },
  });

  const action = order.type === 'BUY' ? 'buy' : order.type === 'COVER' ? 'cover' : 'sell';

  // Fire-and-forget, same as executeTrade.
  if (crew && (action === 'buy' || action === 'sell')) {
    updateCrewMissionProgress(crew, order.userId, action, fillShares, order.ticker, tradeValue);
  }

  const message = order.type === 'STOP_LOSS'
    ? `sold ${fillShares} $${order.ticker} via stop loss`
    : order.type === 'BUY'
      ? `bought ${fillShares} $${order.ticker} via limit order`
      : order.type === 'COVER'
        ? `covered ${fillShares} $${order.ticker} via limit order`
        : `sold ${fillShares} $${order.ticker} via limit order`;

  writeFeedEntry({
    type: 'trade',
    userId: order.userId,
    displayName,
    crew,
    ticker: order.ticker,
    action,
    amount: fillShares,
    price: executedPrice,
    message,
  });
};

module.exports = { notifyCanceled, notifyExpired, publishFill };
