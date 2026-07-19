'use strict';
// Firestore state assembly for executeTrade: IP-level trade tracking, trade
// history pruning/appending, and the single user-doc update payload.
// Internal module — required by trading.js, not exported through index.js.
const admin = require('firebase-admin');
const db = admin.firestore();
const {
  SHORT_MARGIN_RATIO, SHORT_COOLDOWN_WINDOW_MS,
} = require('../constants');
const { pruneAndSumTradeHistory, addPendingShares, decrementCohort } = require('../helpers');

// ANTI-MANIPULATION: Read IP-level trade history (shared across all accounts
// on the same IP). Must run before any transaction writes.
async function readIpTradeData(transaction, ip, ticker, now) {
  const result = {
    ipCumulativeDailyImpact: 0,
    ipTrackingRef: null,
    sanitizedIp: null,
    ipTickerTradeHistory: {},
    ipRecentTraders: {},
  };
  if (ip === 'unknown') return result;

  result.sanitizedIp = ip.replace(/[.:/]/g, '_');
  result.ipTrackingRef = db.collection('ipTracking').doc(result.sanitizedIp);
  const ipDoc = await transaction.get(result.ipTrackingRef);
  if (ipDoc.exists) {
    const ipData = ipDoc.data();
    result.ipTickerTradeHistory = ipData.tickerTradeHistory || {};
    result.ipRecentTraders = ipData.recentTraders || {};
    const ipAllActions = result.ipTickerTradeHistory[ticker] || {};
    for (const act of ['buy', 'sell', 'short', 'cover']) {
      const { totalImpact } = pruneAndSumTradeHistory(ipAllActions[act] || [], now);
      result.ipCumulativeDailyImpact += totalImpact;
    }
  }
  return result;
}

// Rebuild a { ticker: { action: [entries] } } history map with expired entries
// pruned out. Used for both the user-doc and IP-doc histories.
function pruneHistoryMap(historyMap, now) {
  const pruned = {};
  for (const [t, actions] of Object.entries(historyMap)) {
    pruned[t] = {};
    for (const [act, entries] of Object.entries(actions)) {
      const { recent } = pruneAndSumTradeHistory(entries, now);
      pruned[t][act] = recent;
    }
  }
  return pruned;
}

// Append this trade's entry plus any synthetic trailing-effect entries to a
// (already pruned) history map. Mutates and returns the map.
function appendTradeEntries(historyMap, ticker, action, newTradeEntry, trailingEntries) {
  if (!historyMap[ticker]) historyMap[ticker] = {};
  if (!historyMap[ticker][action]) historyMap[ticker][action] = [];
  historyMap[ticker][action].push(newTradeEntry);

  for (const [trailingTicker, { action: trailingAction, entry }] of Object.entries(trailingEntries)) {
    if (!historyMap[trailingTicker]) historyMap[trailingTicker] = {};
    if (!historyMap[trailingTicker][trailingAction]) historyMap[trailingTicker][trailingAction] = [];
    historyMap[trailingTicker][trailingAction].push(entry);
  }
  return historyMap;
}

// Build the merge payload for the ipTracking doc: pruned+appended trade
// history, plus the rolling 1h recent-traders map for the per-IP account cap.
function buildIpTrackingUpdate({ ipTickerTradeHistory, ipRecentTraders, ticker, action, newTradeEntry, trailingEntries, uid, now }) {
  const updatedIpHistory = appendTradeEntries(
    pruneHistoryMap(ipTickerTradeHistory, now), ticker, action, newTradeEntry, trailingEntries
  );

  // Record this account as a recent trader from the IP (rolling 1h) for the
  // per-IP multi-account cap; prune entries older than 1h.
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const updatedRecentTraders = {};
  for (const [u, ts] of Object.entries(ipRecentTraders)) {
    if (now - (typeof ts === 'number' ? ts : 0) < ONE_HOUR_MS) updatedRecentTraders[u] = ts;
  }
  // Only buy/short consume a per-IP slot (sell/cover never blocked, so don't count them).
  if (action === 'buy' || action === 'short') updatedRecentTraders[uid] = now;

  return { tickerTradeHistory: updatedIpHistory, recentTraders: updatedRecentTraders };
}

// Build the complete user-doc update payload for this trade: balances,
// positions, throttle stamps, cost basis, dividend cohorts, lockup cleanup,
// short history, and the rolling transaction log.
function buildUserUpdates({
  ticker, action, amount, now, userData, character,
  cash, holdings, shorts, newCash, newHoldings, newShorts, newMarginUsed,
  marginLockUpdate, updatedTickerTradeHistory, creditUpdates,
  executionPrice, totalCost, currentPrice,
}) {
  const updates = {
    cash: newCash,
    holdings: newHoldings,
    shorts: newShorts,
    // Queried by checkShortMarginCalls so the scanner doesn't have to read
    // every user doc. Recomputed on every trade, so it self-heals.
    hasOpenShorts: Object.keys(newShorts).length > 0,
    marginUsed: newMarginUsed,
    ...(marginLockUpdate ? { [`marginLockup.${ticker}`]: marginLockUpdate } : {}),
    tickerTradeHistory: updatedTickerTradeHistory,
    lastTradeTime: admin.firestore.Timestamp.now(),
    ...creditUpdates
  };

  // ANTI-MANIPULATION: Track ticker trade times for buy/short cooldown
  if (action === 'buy' || action === 'short') {
    updates[`lastTickerTradeTime.${ticker}`] = admin.firestore.Timestamp.now();
  }

  if (action === 'buy') {
    updates[`lastBuyTime.${ticker}`] = admin.firestore.Timestamp.now();

    // Cost basis tracking
    const currentHoldings = holdings[ticker] || 0;
    const currentCostBasis = userData.costBasis?.[ticker] || 0;
    const totalHoldings = newHoldings[ticker] || 0;
    const newCostBasis = currentHoldings > 0
      ? (totalHoldings > 0 ? ((currentCostBasis * currentHoldings) + (executionPrice * amount)) / totalHoldings : executionPrice)
      : executionPrice;
    updates[`costBasis.${ticker}`] = Math.round(newCostBasis * 100) / 100;

    // Dividend cohort: new shares enter pending with a 10-day wait
    const existingCohort = userData.holdingCohorts?.[ticker] || null;
    const newCohort = addPendingShares(existingCohort, amount, now);
    // Dividend Demon: track when user first held this ETF (preserve on add, reset on full sell)
    if (character?.isETF) {
      newCohort.firstHeldAt = existingCohort?.firstHeldAt || now;
    }
    updates[`holdingCohorts.${ticker}`] = newCohort;
  }

  if (action === 'sell') {
    // Clear cost basis if selling all shares
    const totalHoldings = newHoldings[ticker] || 0;
    if (totalHoldings <= 0) {
      updates[`costBasis.${ticker}`] = 0;
      updates[`lowestWhileHolding.${ticker}`] = admin.firestore.FieldValue.delete();
    }
    // Drop an IPO lockup once it has expired or the position is fully closed.
    const sellLock = userData.ipoLockup?.[ticker];
    if (sellLock && (now >= (sellLock.until || 0) || totalHoldings <= 0)) {
      updates[`ipoLockup.${ticker}`] = admin.firestore.FieldValue.delete();
    }
    // Same for the margin lockup.
    const mLock = userData.marginLockup?.[ticker];
    if (mLock && (now >= (mLock.until || 0) || totalHoldings <= 0)) {
      updates[`marginLockup.${ticker}`] = admin.firestore.FieldValue.delete();
    }

    // Dividend cohort: consume eligible first, then oldest pending. Delete
    // the field entirely if the position is closed.
    const existingCohort = userData.holdingCohorts?.[ticker] || null;
    const newCohort = decrementCohort(existingCohort, amount);
    if (newCohort) {
      updates[`holdingCohorts.${ticker}`] = newCohort;
    } else {
      updates[`holdingCohorts.${ticker}`] = admin.firestore.FieldValue.delete();
    }
  }

  if (action === 'short') {
    const shortHistory = userData.shortHistory || {};
    const tickerHistory = (shortHistory[ticker] || []).filter(ts => now - ts < SHORT_COOLDOWN_WINDOW_MS);
    tickerHistory.push(now);
    updates.shortHistory = { ...shortHistory, [ticker]: tickerHistory };
  }

  // Append to transaction log (keep last 100 entries)
  const txLogEntry = { timestamp: now, ticker, shares: amount, cashBefore: cash, cashAfter: newCash };
  if (action === 'buy') {
    txLogEntry.type = 'BUY';
    txLogEntry.pricePerShare = executionPrice;
    txLogEntry.totalCost = totalCost;
  } else if (action === 'sell') {
    txLogEntry.type = 'SELL';
    txLogEntry.pricePerShare = executionPrice;
    txLogEntry.totalRevenue = totalCost;
    const costBasis = userData.costBasis?.[ticker] || 0;
    txLogEntry.profitPercent = costBasis > 0 ? Math.round(((executionPrice - costBasis) / costBasis) * 100) : 0;
  } else if (action === 'short') {
    txLogEntry.type = 'SHORT_OPEN';
    txLogEntry.entryPrice = executionPrice;
    txLogEntry.marginRequired = currentPrice * amount * SHORT_MARGIN_RATIO;
  } else if (action === 'cover') {
    txLogEntry.type = 'SHORT_CLOSE';
    const shortCostBasis = shorts[ticker]?.costBasis || shorts[ticker]?.entryPrice || 0;
    txLogEntry.totalProfit = (shortCostBasis - executionPrice) * amount;
  }
  const existingLog = userData.transactionLog || [];
  updates.transactionLog = [...existingLog, txLogEntry].slice(-100);

  return updates;
}

module.exports = {
  readIpTradeData,
  pruneHistoryMap,
  appendTradeEntries,
  buildIpTrackingUpdate,
  buildUserUpdates,
};
