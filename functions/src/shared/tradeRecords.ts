// Trade records and the mission / stat credit every fill lane books.

import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { ANIMAL_TICKERS, TRADE_RECORD_ACTIONS } from './constants';
import { missionWeekId, missionTradeCounts, auctionWeekId, inOpeningDay } from './rules/missions';
import type { DailyProgress, WeeklyProgress } from './rules/missionProgress';
import { stampMs } from './impact';
import { round2 } from './money';
import { tickerStatsRef, buildTickerFlowUpdate } from './marketData';
import type { UserData } from './types';
import { recordLedger } from './ledger';
const db = admin.firestore();

// The mission week id (the Thursday it began) that keys weeklyMissions. One
// clock for every week-based system since 2026-10-22 (rules/missions).
export const getWeekId = (now: Date | number = Date.now()) => missionWeekId(now);

// Mission/stat credit for a filled trade — shared by executeTrade, limit-order
// fills, the stop-loss sweep and the pre-market auction so every fill counts
// the same. Returns { updates, animalProfitTotal }: `updates` is a field-path
// fragment that must be merged into the SAME user write as the balance change;
// `animalProfitTotal` is non-null only on an animal-ticker sell with a cost
// basis (executeTrade feeds it to the achievement context).
// `marketPrice` is the pre-impact market price, `executionPrice` what the user
// actually paid/received per share. `userData` is the doc BEFORE this fill.
//
// Only raw facts are written here (what was bought or sold, how many shares,
// for how much). Whether they count is judged at claim time by
// rules/missionProgress.
export const buildTradeCreditUpdates = ({
  userData,
  ticker,
  action,
  shares,
  totalValue,
  executionPrice,
  marketPrice,
  viaAuction = false,
  now = Date.now(),
}: {
  userData: UserData;
  ticker: string;
  action: string;
  shares: number;
  totalValue: number;
  executionPrice: number;
  marketPrice: number;
  /** The opening auction filled this (Opening Bell, credited to the week the reopen starts). */
  viaAuction?: boolean;
  now?: number;
}) => {
  const todayDate = new Date(now).toISOString().split('T')[0]!;
  const weekId = getWeekId(now);
  const day = `dailyMissions.${todayDate}`;
  const week = `weeklyMissions.${weekId}`;
  const auctionWeek = `weeklyMissions.${auctionWeekId(now)}`;
  // Opening Bell: the auction, or any fill in the first day after the reopen.
  const openingBell = viaAuction || inOpeningDay(now);
  const updates: Record<string, unknown> = {
    totalTrades: FieldValue.increment(1),
    [`${week}.tradeCount`]: FieldValue.increment(1),
  };
  let animalProfitTotal: number | null = null;
  // Trading Streak: a day counts once any trade counts (1 share or $50).
  const markTradingDay = (tradeShares: number, value: number) => {
    if (missionTradeCounts(tradeShares, value)) updates[`${week}.tradingDays.${todayDate}`] = true;
  };

  if (action === 'buy') {
    const prev = (userData.dailyMissions as Record<string, DailyProgress> | undefined)?.[todayDate]?.buys?.[ticker];
    const prevWeekLow = (userData.weeklyMissions as Record<string, WeeklyProgress> | undefined)?.[weekId]?.buys?.[
      ticker
    ]?.low;
    updates[`${day}.buys.${ticker}.shares`] = FieldValue.increment(shares);
    updates[`${day}.buys.${ticker}.value`] = FieldValue.increment(totalValue);
    updates[`${day}.buys.${ticker}.low`] = round2(Math.min(prev?.low ?? marketPrice, marketPrice));
    updates[`${day}.buys.${ticker}.high`] = round2(Math.max(prev?.high ?? marketPrice, marketPrice));
    updates[`${week}.buys.${ticker}.low`] = round2(Math.min(prevWeekLow ?? marketPrice, marketPrice));
    updates[`${week}.buys.${ticker}.shares`] = FieldValue.increment(shares);
    updates[`${week}.buys.${ticker}.value`] = FieldValue.increment(totalValue);
    if (openingBell) {
      updates[`${auctionWeek}.auctionBuys.${ticker}.shares`] = FieldValue.increment(shares);
      updates[`${auctionWeek}.auctionBuys.${ticker}.value`] = FieldValue.increment(totalValue);
    }
    markTradingDay(shares, totalValue);

    // Lowest price while holding (for Diamond Hands achievement)
    const currentHoldings = userData.holdings?.[ticker] || 0;
    const currentLowest = userData.lowestWhileHolding?.[ticker];
    const newLowest =
      currentHoldings === 0 ? executionPrice : Math.min(currentLowest || executionPrice, executionPrice);
    updates[`lowestWhileHolding.${ticker}`] = round2(newLowest);
  }

  if (action === 'sell') {
    // Profit Taker / Cut Your Losses: above or below the average cost.
    const value = round2(shares * executionPrice);
    const cost = userData.costBasis?.[ticker] || 0;
    const side =
      cost > 0 && executionPrice > cost ? 'profitSold' : cost > 0 && executionPrice < cost ? 'lossSold' : null;
    if (side) {
      updates[`${day}.${side}.shares`] = FieldValue.increment(shares);
      updates[`${day}.${side}.value`] = FieldValue.increment(value);
    }
    if (openingBell) {
      updates[`${auctionWeek}.auctionSold.shares`] = FieldValue.increment(shares);
      updates[`${auctionWeek}.auctionSold.value`] = FieldValue.increment(value);
    }
    markTradingDay(shares, value);

    // Animal Instinct: track cumulative profit from animal characters
    if (ANIMAL_TICKERS.has(ticker)) {
      const costBasis = userData.costBasis?.[ticker] || 0;
      if (costBasis > 0) {
        const profitThisSell = Math.max(0, (executionPrice - costBasis) * shares);
        const pbt = userData.profitByTicker || {};
        const newTickerProfit = (pbt[ticker] || 0) + profitThisSell;
        updates[`profitByTicker.${ticker}`] = newTickerProfit;
        animalProfitTotal =
          newTickerProfit + [...ANIMAL_TICKERS].filter((t) => t !== ticker).reduce((s, t) => s + (pbt[t] || 0), 0);
      }
    }
  }

  if (action === 'short') {
    const value = round2(shares * executionPrice);
    updates[`${day}.shorts.${ticker}.shares`] = FieldValue.increment(shares);
    updates[`${day}.shorts.${ticker}.value`] = FieldValue.increment(value);
    markTradingDay(shares, value);
  }

  // Covered: any close of a short.
  if (action === 'cover') {
    const pos = userData.shorts?.[ticker];
    const openedMs = stampMs(pos?.openedAt as Parameters<typeof stampMs>[0]);
    const value = round2(shares * executionPrice);
    updates[`${day}.covered.shares`] = FieldValue.increment(shares);
    updates[`${day}.covered.value`] = FieldValue.increment(value);
    markTradingDay(shares, value);
    // Keeps today's mission list as it was (rules/missionProgress holdsShortForMissions).
    if (openedMs > 0 && openedMs < Date.parse(todayDate)) updates[`${day}.oldShortCovered`] = true;
  }

  return { updates, animalProfitTotal };
};

interface TradeRecordInput {
  uid: string;
  ticker: string;
  action: string;
  amount: number;
  price: number;
  priceImpact?: number;
  totalValue: number;
  cashBefore?: number | null;
  cashAfter?: number | null;
  source?: string | null;
  ip?: string | null;
  orderId?: string | null;
}

// Writes one record to the trades collection, inside the caller's transaction.
//
// This collection is the canonical record of a trade: the player's own Trade
// History reads it, the daily/weekly market reports count it, and the admin
// player file lists it.
//
// `source` marks a fill that the player didn't place by hand ('limit',
// 'stop_loss', 'premarket'). Trades placed through executeTrade leave it unset,
// and that absence is what the velocity guards use to tell the two apart.
export function recordTrade(
  transaction: admin.firestore.Transaction,
  {
    uid,
    ticker,
    action,
    amount,
    price,
    priceImpact = 0,
    totalValue,
    cashBefore = null,
    cashAfter = null,
    source = null,
    ip = null,
    orderId = null,
  }: TradeRecordInput,
) {
  const record: Record<string, unknown> = {
    uid,
    ticker,
    action,
    amount,
    price,
    priceImpact,
    totalValue,
    timestamp: FieldValue.serverTimestamp(),
    ip,
  };
  if (cashBefore !== null) record.cashBefore = cashBefore;
  if (cashAfter !== null) record.cashAfter = cashAfter;
  if (source) record.source = source;
  // Which order produced this fill, so a fill can be traced back to its order.
  if (orderId) record.orderId = orderId;

  const tradeRef = db.collection('trades').doc();
  transaction.set(tradeRef, record);

  // Every fill lane passes cashBefore/cashAfter, so the money ledger is booked
  // here once instead of in each lane.
  if (cashBefore !== null && cashAfter !== null) {
    recordLedger(transaction, {
      uid,
      type: `trade_${action}`,
      amount: cashAfter - cashBefore,
      cashAfter,
      ref: `trades/${tradeRef.id}`,
      detail: { ticker, shares: amount, ...(source ? { source } : {}) },
    });
  }

  // Per-ticker running totals, written in the same transaction as the record
  // itself so the two can never disagree. Dividends and forced margin closes
  // are excluded for the same reason sumMarketActivity excludes them: nobody
  // chose to trade this stock.
  if (TRADE_RECORD_ACTIONS.has(action)) {
    transaction.set(tickerStatsRef(), buildTickerFlowUpdate({ ticker, action, amount, totalValue, now: Date.now() }), {
      merge: true,
    });
  }
}
