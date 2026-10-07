// Pure helpers for the trade history modal: timestamp handling, realised P&L,
// and the CSV export. Split out of TradeHistoryModal.jsx when it approached its
// 400-line limit. Nothing here touches React or component state.

// Trades that filled on their own. Without a label these look like trades the
// player never made.
import type { TimestampLike } from '../types';

export interface TradeRecord {
  action: string;
  ticker: string;
  amount: number;
  price: number;
  totalValue?: number;
  profitPercent?: number | null;
  costBasisAtTrade?: number;
  timestamp?: TimestampLike | { toDate: () => Date };
}

export const SOURCE_LABELS: Record<string, string> = {
  limit: 'limit order',
  stop_loss: 'stop loss',
  premarket: 'pre-market',
};

// Firestore hands back a Timestamp; older records are already plain dates.
export const getTimestampDate = (ts: TradeRecord['timestamp']): Date | null => {
  if (!ts) return null;
  if (typeof ts === 'object' && 'toDate' in ts) return ts.toDate();
  return new Date(ts as number | string);
};

export const formatTimestamp = (ts: TradeRecord['timestamp']): string => {
  const date = getTimestampDate(ts);
  if (!date) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/**
 * Realised P&L for a closing trade, or null for one that opened a position.
 * Prefers the profitPercent stamped on the record at fill time and falls back
 * to the cost basis captured with it. Covers invert: on a short, price going
 * down is the profit.
 */
export const getTradeProfit = (trade: TradeRecord): { amount: number; percent: number } | null => {
  const isClosing = trade.action === 'sell' || trade.action === 'cover' || trade.action === 'margin_call_cover';
  if (!isClosing) return null;

  if (trade.profitPercent !== undefined && trade.profitPercent !== null) {
    return {
      percent: trade.profitPercent,
      amount: (trade.totalValue || trade.price * trade.amount) * (trade.profitPercent / 100),
    };
  }

  if (trade.costBasisAtTrade && trade.price) {
    const pl = (trade.price - trade.costBasisAtTrade) * trade.amount;
    const percent =
      trade.costBasisAtTrade > 0 ? ((trade.price - trade.costBasisAtTrade) / trade.costBasisAtTrade) * 100 : 0;
    const isShortClose = trade.action === 'cover' || trade.action === 'margin_call_cover';
    return { amount: isShortClose ? -pl : pl, percent };
  }

  return null;
};

/** Download the given trades as a CSV. */
export const exportTradesToCSV = (trades: TradeRecord[]) => {
  const headers = ['Date', 'Ticker', 'Action', 'Amount', 'Price', 'Total Value', 'P&L'];
  const rows = trades.map((trade) => {
    const date = getTimestampDate(trade.timestamp);
    const pl = getTradeProfit(trade);
    return [
      date ? date.toISOString() : '',
      trade.ticker,
      trade.action,
      trade.amount,
      trade.price?.toFixed(2) || '',
      (trade.totalValue || trade.price * trade.amount)?.toFixed(2) || '',
      pl?.amount?.toFixed(2) || '',
    ].join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `stockism_trades_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};
