// Trade records and the mission / stat credit every fill lane books.

import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import {
  CREW_MEMBERS,
  ALL_CREW_TICKERS,
  ANIMAL_TICKERS,
  UNDERDOG_PRICE_THRESHOLD,
  TRADE_RECORD_ACTIONS,
} from './constants';
import { round2 } from './money';
import { tickerStatsRef, buildTickerFlowUpdate } from './marketData';
import type { UserData } from './types';
import { recordLedger } from './ledger';
const db = admin.firestore();

// Monday-based week ID (YYYY-MM-DD of the week's Monday) — keys weeklyMissions.
export const getWeekId = (now = new Date()) => {
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
  if (weekStart > now) weekStart.setDate(weekStart.getDate() - 7);
  return weekStart.toISOString().split('T')[0]!;
};

// Mission/stat credit for a filled trade — shared by executeTrade, limit-order
// fills, and the pre-market auction so queued orders count the same as live
// trades. Returns { updates, animalProfitTotal }: `updates` is a field-path
// fragment that must be merged into the SAME user write as the balance change;
// `animalProfitTotal` is non-null only on an animal-ticker sell with a cost
// basis (executeTrade feeds it to the achievement context).
// `marketPrice` is the pre-impact market price (underdog check), while
// `executionPrice` is what the user actually paid/received per share.
export const buildTradeCreditUpdates = ({
  userData,
  ticker,
  action,
  shares,
  totalValue,
  executionPrice,
  marketPrice,
  now = Date.now(),
}: {
  userData: UserData;
  ticker: string;
  action: string;
  shares: number;
  totalValue: number;
  executionPrice: number;
  marketPrice: number;
  now?: number;
}) => {
  const todayDate = new Date(now).toISOString().split('T')[0];
  const weekId = getWeekId(new Date(now));
  const updates: Record<string, unknown> = {
    totalTrades: FieldValue.increment(1),
    [`dailyMissions.${todayDate}.tradesCount`]: FieldValue.increment(1),
    [`dailyMissions.${todayDate}.tradeVolume`]: FieldValue.increment(shares),
    [`weeklyMissions.${weekId}.tradeValue`]: FieldValue.increment(totalValue),
    [`weeklyMissions.${weekId}.tradeVolume`]: FieldValue.increment(shares),
    [`weeklyMissions.${weekId}.tradeCount`]: FieldValue.increment(1),
    [`weeklyMissions.${weekId}.tradingDays.${todayDate}`]: true,
  };
  let animalProfitTotal: number | null = null;

  if (action === 'buy') {
    updates[`dailyMissions.${todayDate}.boughtAny`] = true;

    const userCrew = userData.crew;
    if (userCrew) {
      const crewMembers = CREW_MEMBERS[userCrew] || [];
      if (crewMembers.includes(ticker)) {
        updates[`dailyMissions.${todayDate}.boughtCrewMember`] = true;
        updates[`dailyMissions.${todayDate}.crewSharesBought`] = FieldValue.increment(shares);
      }
      if (!crewMembers.includes(ticker) && ALL_CREW_TICKERS.has(ticker)) {
        updates[`dailyMissions.${todayDate}.boughtRival`] = true;
      }
    }
    if (marketPrice < UNDERDOG_PRICE_THRESHOLD) {
      updates[`dailyMissions.${todayDate}.boughtUnderdog`] = true;
    }

    // Lowest price while holding (for Diamond Hands achievement)
    const currentHoldings = userData.holdings?.[ticker] || 0;
    const currentLowest = userData.lowestWhileHolding?.[ticker];
    const newLowest =
      currentHoldings === 0 ? executionPrice : Math.min(currentLowest || executionPrice, executionPrice);
    updates[`lowestWhileHolding.${ticker}`] = round2(newLowest);
  }

  if (action === 'sell') {
    updates[`dailyMissions.${todayDate}.soldAny`] = true;

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
// History reads it, the daily/weekly market reports count it, and
// reconstructPortfolioHistory replays it (which is why cashAfter is worth
// passing — records without it are skipped there).
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
  // Which order produced this fill. The backfill uses it to skip orders that
  // already have a record, so it can never duplicate a live fill.
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
