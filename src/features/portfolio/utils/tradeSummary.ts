// Pure summaries of a player's trades for the portfolio page: what they did in
// one stock, and the positions they recently closed out.
import { getTimestampDate, getTradeProfit } from '../../../utils/tradeHistory';
import type { PlayerTrade } from '../hooks/usePlayerTrades';
import type { ShareMap } from '../../../types';

const ms = (t: PlayerTrade) => getTimestampDate(t.timestamp)?.getTime() ?? 0;
const total = (t: PlayerTrade) => t.totalValue ?? (t.price || 0) * (t.amount || 0);

export interface StockSummary {
  bought: number;
  spent: number;
  sold: number;
  received: number;
  /** Profit or loss booked on sells and covers. */
  realized: number;
  first: number | null;
  last: number | null;
}

export const summarizeStock = (trades: PlayerTrade[]): StockSummary => {
  const s: StockSummary = { bought: 0, spent: 0, sold: 0, received: 0, realized: 0, first: null, last: null };
  for (const t of trades) {
    const at = ms(t);
    if (at) {
      s.first = s.first === null ? at : Math.min(s.first, at);
      s.last = s.last === null ? at : Math.max(s.last, at);
    }
    if (t.action === 'buy') {
      s.bought += t.amount || 0;
      s.spent += total(t);
    } else if (t.action === 'sell') {
      s.sold += t.amount || 0;
      s.received += total(t);
    }
    s.realized += getTradeProfit(t)?.amount ?? 0;
  }
  return s;
};

export interface ClosedPosition {
  ticker: string;
  closedAt: number;
  realized: number;
  sold: number;
}

/**
 * Stocks the player sold in these trades and no longer owns, newest first, with
 * the profit or loss on those sells.
 */
export const recentlyClosed = (trades: PlayerTrade[], holdings: ShareMap | null | undefined): ClosedPosition[] => {
  const byTicker = new Map<string, ClosedPosition>();
  for (const t of trades) {
    if (t.action !== 'sell' || !t.ticker || (holdings?.[t.ticker] || 0) > 0.001) continue;
    const row = byTicker.get(t.ticker) || { ticker: t.ticker, closedAt: 0, realized: 0, sold: 0 };
    row.closedAt = Math.max(row.closedAt, ms(t));
    row.realized += getTradeProfit(t)?.amount ?? 0;
    row.sold += t.amount || 0;
    byTicker.set(t.ticker, row);
  }
  return [...byTicker.values()].sort((a, b) => b.closedAt - a.closedAt);
};
