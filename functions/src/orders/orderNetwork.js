'use strict';
// Per-network (IP) rules for queued orders. INTERNAL MODULE — not exported
// through functions/src/index.js, same pattern as tradeGuards.
//
// executeTrade applies two network-level rules:
//   - at most MAX_ACCOUNTS_PER_IP accounts may buy or short from one connection
//     in an hour (assertIpAccountCap), and
//   - each ticker's daily price-move allowance is shared by every account on
//     that connection (the ipTracking tickerTradeHistory).
// Limit and pre-market orders skipped both until 2026-09-28 (audit M1): order
// placement never looked at the connection, and fills run in a scheduler that
// has no request to take an IP from. An alt ring could route its buying through
// queued orders and neither rule ever saw it.
//
// Now placement of a BUY takes one of the connection's slots exactly as a trade
// would, and a limit order's connection is kept in orderOrigins/{orderId} so its
// fill can apply both rules. That collection is private (no client rule): a
// network key on a world-readable order would tell anyone which accounts share
// a connection.

const admin = require('firebase-admin');
const db = admin.firestore();

const { sumDirectionalImpact, impactDirectionOf } = require('../shared/helpers');
const { assertIpAccountCap } = require('../trading/tradeGuards');
const { buildIpTrackingUpdate } = require('../trading/tradeState');

/** The ipTracking doc id for this request's connection, or null. Same key executeTrade uses. */
const networkKeyOf = (context) => {
  const ip = context?.rawRequest?.ip;
  return ip ? ip.replace(/[.:/]/g, '_') : null;
};

const ipRef = (key) => db.collection('ipTracking').doc(key);
const originRef = (orderId) => db.collection('orderOrigins').doc(orderId);

/**
 * At placement. A BUY takes one of the connection's hourly slots, and is refused
 * with executeTrade's own error if the connection is already full. Exits never
 * take a slot, the same as trading. Returns the network key (or null).
 */
async function claimNetworkForOrder({ context, uid, isBuy, now = Date.now() }) {
  const key = networkKeyOf(context);
  if (!key || !isBuy) return key;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ipRef(key));
    const recentTraders = snap.exists ? snap.data().recentTraders || {} : {};
    assertIpAccountCap({ ip: key, uid, action: 'buy', ipRecentTraders: recentTraders, now });
    tx.set(ipRef(key), { recentTraders: { [uid]: now } }, { merge: true });
  });
  return key;
}

/** Remember which connection placed a limit order, for its fill. */
const recordOrderOrigin = (orderId, { uid, key }) =>
  key ? originRef(orderId).set({ uid, ipKey: key, createdAt: Date.now() }) : Promise.resolve();

/**
 * Inside a fill transaction, READ phase. Returns the order's network state, or
 * null for an order placed before this existed (or with no known connection),
 * which then fills on the per-account rules alone.
 */
async function readOrderNetwork(transaction, orderId) {
  const originSnap = await transaction.get(originRef(orderId));
  const key = originSnap.exists ? originSnap.data().ipKey : null;
  if (!key) return null;
  const snap = await transaction.get(ipRef(key));
  const data = snap.exists ? snap.data() : {};
  return {
    key,
    ref: ipRef(key),
    tickerTradeHistory: data.tickerTradeHistory || {},
    recentTraders: data.recentTraders || {},
  };
}

/** Allowance the whole connection has spent on this ticker in this action's direction. */
const networkImpactSpent = (net, ticker, action, now) =>
  net ? sumDirectionalImpact(net.tickerTradeHistory[ticker], now)[impactDirectionOf(action)] : 0;

/** The accounts-per-connection rule, re-checked at fill time. Buys only. */
const assertNetworkSlot = (net, uid, action, now) => {
  if (net) assertIpAccountCap({ ip: net.key, uid, action, ipRecentTraders: net.recentTraders, now });
};

/** WRITE phase: add the fill to the connection's shared history, as executeTrade does. */
const writeNetworkFill = (transaction, net, { ticker, action, entry, trailingEntries, uid, now }) => {
  if (!net) return;
  transaction.set(
    net.ref,
    buildIpTrackingUpdate({
      ipTickerTradeHistory: net.tickerTradeHistory,
      ipRecentTraders: net.recentTraders,
      ticker,
      action,
      newTradeEntry: entry,
      trailingEntries,
      uid,
      now,
    }),
    { merge: true },
  );
};

module.exports = {
  networkKeyOf,
  claimNetworkForOrder,
  recordOrderOrigin,
  readOrderNetwork,
  networkImpactSpent,
  assertNetworkSlot,
  writeNetworkFill,
};
