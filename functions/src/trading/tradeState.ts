// Firestore state assembly for executeTrade: IP-level trade tracking, trade
// history pruning/appending, and the single user-doc update payload.
// Internal module — required by trading.js, not exported through index.js.
import * as admin from 'firebase-admin';
const db = admin.firestore();
import { SHORT_MARGIN_RATIO, SHORT_COOLDOWN_WINDOW_MS, WASH_RULE_IMPACT_TRIGGER } from '../shared/constants';
import { pruneAndSumTradeHistory, sumDirectionalImpact } from '../shared/impact';
import { cohortAddUpdate, cohortRemoveUpdate } from '../shared/cohorts';
import type { ActionHistory, ImpactEntry } from '../shared/impact';
import type { TrailingEntries } from './tradePricing';
import type { Character } from '../shared/characters';
import type { ShortPosition, UserData } from '../shared/types';

/** { ticker: { action: entries } }, on the user doc and on ipTracking docs. */
export type HistoryMap = Record<string, ActionHistory>;
import { seasonMarginUpdate } from '../season/seasonTiers';

// ANTI-MANIPULATION: Read IP-level trade history (shared across all accounts
// on the same IP). Must run before any transaction writes.
export async function readIpTradeData(
  transaction: admin.firestore.Transaction,
  ip: string,
  ticker: string,
  now: number,
) {
  const result: {
    ipDailyImpact: { down: number; up: number };
    ipTrackingRef: admin.firestore.DocumentReference | null;
    sanitizedIp: string | null;
    ipTickerTradeHistory: HistoryMap;
    ipRecentTraders: Record<string, number>;
  } = {
    // Spent allowance split by direction, same shape as the per-user figure.
    ipDailyImpact: { down: 0, up: 0 },
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
    const ipData = ipDoc.data()!;
    result.ipTickerTradeHistory = ipData.tickerTradeHistory || {};
    result.ipRecentTraders = ipData.recentTraders || {};
    result.ipDailyImpact = sumDirectionalImpact(result.ipTickerTradeHistory[ticker], now);
  }
  return result;
}

// Rebuild a { ticker: { action: [entries] } } history map with expired entries
// pruned out. Used for both the user-doc and IP-doc histories.
export function pruneHistoryMap(historyMap: HistoryMap, now: number): HistoryMap {
  const pruned: HistoryMap = {};
  for (const [t, actions] of Object.entries(historyMap)) {
    const prunedActions: ActionHistory = {};
    pruned[t] = prunedActions;
    for (const [act, entries] of Object.entries(actions)) {
      const { recent } = pruneAndSumTradeHistory(entries, now);
      prunedActions[act] = recent;
    }
  }
  return pruned;
}

// Append this trade's entry plus any synthetic trailing-effect entries to a
// (already pruned) history map. Mutates and returns the map.
export function appendTradeEntries(
  historyMap: HistoryMap,
  ticker: string,
  action: string,
  newTradeEntry: ImpactEntry,
  trailingEntries: TrailingEntries,
): HistoryMap {
  const push = (t: string, act: string, entry: ImpactEntry) => {
    const actions = (historyMap[t] ||= {});
    (actions[act] ||= []).push(entry);
  };
  push(ticker, action, newTradeEntry);

  for (const [trailingTicker, { action: trailingAction, entry }] of Object.entries(trailingEntries)) {
    push(trailingTicker, trailingAction, entry);
  }
  return historyMap;
}

// Build the merge payload for the ipTracking doc: pruned+appended trade
// history, plus the rolling 1h recent-traders map for the per-IP account cap.
export function buildIpTrackingUpdate({
  ipTickerTradeHistory,
  ipRecentTraders,
  ticker,
  action,
  newTradeEntry,
  trailingEntries,
  uid,
  now,
}: {
  ipTickerTradeHistory: HistoryMap;
  ipRecentTraders: Record<string, unknown>;
  ticker: string;
  action: string;
  newTradeEntry: ImpactEntry;
  trailingEntries: TrailingEntries;
  uid: string;
  now: number;
}) {
  const updatedIpHistory = appendTradeEntries(
    pruneHistoryMap(ipTickerTradeHistory, now),
    ticker,
    action,
    newTradeEntry,
    trailingEntries,
  );

  // Record this account as a recent trader from the IP (rolling 1h) for the
  // per-IP multi-account cap; prune entries older than 1h.
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const updatedRecentTraders: Record<string, unknown> = {};
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
export function buildUserUpdates({
  ticker,
  action,
  amount,
  now,
  userData,
  character,
  cash,
  holdings,
  shorts,
  newCash,
  newHoldings,
  newShorts,
  newMarginUsed,
  marginLockUpdate,
  updatedTickerTradeHistory,
  creditUpdates,
  executionPrice,
  totalCost,
  currentPrice,
  downImpactAfter = 0,
}: {
  ticker: string;
  action: string;
  amount: number;
  now: number;
  userData: UserData;
  character: Character | undefined;
  cash: number;
  holdings: Record<string, number>;
  shorts: Record<string, ShortPosition | null | undefined>;
  newCash: number;
  newHoldings: Record<string, number>;
  newShorts: Record<string, ShortPosition>;
  newMarginUsed: number;
  marginLockUpdate?: unknown;
  updatedTickerTradeHistory: HistoryMap;
  creditUpdates: Record<string, unknown>;
  executionPrice: number;
  totalCost: number;
  currentPrice: number;
  downImpactAfter?: number;
}) {
  const updates: Record<string, unknown> = {
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
    ...creditUpdates,
  };

  // Seasons measure return against margin owed, averaged over time, so any
  // change in debt is logged when it happens (see seasonTiers.js).
  if (newMarginUsed !== (userData.marginUsed || 0)) {
    Object.assign(updates, seasonMarginUpdate(userData, newMarginUsed));
  }

  // ANTI-MANIPULATION: Track ticker trade times for buy/short cooldown
  if (action === 'buy' || action === 'short') {
    updates[`lastTickerTradeTime.${ticker}`] = admin.firestore.Timestamp.now();
  }

  // Wash rule: arm the buy-back block once this player's own downward pressure
  // on this ticker passes the trigger. Stamped on every further sell/short too,
  // so the clock runs from the LAST push rather than the first — otherwise a
  // long grind would unlock itself while the grinder was still selling.
  // Enforced in tradeGuards.assertCooldowns.
  if ((action === 'sell' || action === 'short') && downImpactAfter >= WASH_RULE_IMPACT_TRIGGER) {
    updates[`lastHeavySell.${ticker}`] = admin.firestore.Timestamp.now();
    // A heavy SELL also blocks shorting the stock (shortAfterDumpRemainingMs).
    // A short doesn't, so an existing short can still be added to.
    if (action === 'sell') updates[`lastHeavyExit.${ticker}`] = admin.firestore.Timestamp.now();
  }

  if (action === 'buy') {
    updates[`lastBuyTime.${ticker}`] = admin.firestore.Timestamp.now();

    // Cost basis tracking
    const currentHoldings = holdings[ticker] || 0;
    const currentCostBasis = userData.costBasis?.[ticker] || 0;
    const totalHoldings = newHoldings[ticker] || 0;
    const newCostBasis =
      currentHoldings > 0
        ? totalHoldings > 0
          ? (currentCostBasis * currentHoldings + executionPrice * amount) / totalHoldings
          : executionPrice
        : executionPrice;
    updates[`costBasis.${ticker}`] = Math.round(newCostBasis * 100) / 100;

    // Dividend cohort: new shares enter pending with a 10-day wait. Shared with
    // every other fill lane (isETF also preserves the Dividend Demon clock).
    Object.assign(updates, cohortAddUpdate(userData, ticker, amount, now, !!character?.isETF));
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

    // Dividend cohort: consume eligible first, then oldest pending. Deletes
    // the field entirely if the position is closed.
    Object.assign(updates, cohortRemoveUpdate(userData, ticker, amount));
  }

  if (action === 'short') {
    const shortHistory = (userData.shortHistory || {}) as Record<string, number[]>;
    const tickerHistory = (shortHistory[ticker] || []).filter((ts: number) => now - ts < SHORT_COOLDOWN_WINDOW_MS);
    tickerHistory.push(now);
    updates.shortHistory = { ...shortHistory, [ticker]: tickerHistory };
  }

  // Append to transaction log (keep last 100 entries)
  const txLogEntry: Record<string, unknown> = {
    timestamp: now,
    ticker,
    shares: amount,
    cashBefore: cash,
    cashAfter: newCash,
  };
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
