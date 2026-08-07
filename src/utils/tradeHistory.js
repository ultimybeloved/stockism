// Pure helpers for the trade history modal: timestamp handling, realised P&L,
// and the CSV export. Split out of TradeHistoryModal.jsx when it approached its
// 400-line limit. Nothing here touches React or component state.

// Trades that filled on their own. Without a label these look like trades the
// player never made.
export const SOURCE_LABELS = {
  limit: 'limit order',
  stop_loss: 'stop loss',
  premarket: 'pre-market',
};

// Firestore hands back a Timestamp; older records are already plain dates.
export const getTimestampDate = (ts) => {
  if (!ts) return null;
  return ts.toDate ? ts.toDate() : new Date(ts);
};

export const formatTimestamp = (ts) => {
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
export const getTradeProfit = (trade) => {
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
    const percent = trade.costBasisAtTrade > 0
      ? ((trade.price - trade.costBasisAtTrade) / trade.costBasisAtTrade) * 100
      : 0;
    const isShortClose = trade.action === 'cover' || trade.action === 'margin_call_cover';
    return { amount: isShortClose ? -pl : pl, percent };
  }

  return null;
};

/** Download the given trades as a CSV. */
export const exportTradesToCSV = (trades) => {
  const headers = ['Date', 'Ticker', 'Action', 'Amount', 'Price', 'Total Value', 'P&L'];
  const rows = trades.map(trade => {
    const date = getTimestampDate(trade.timestamp);
    const pl = getTradeProfit(trade);
    return [
      date ? date.toISOString() : '',
      trade.ticker,
      trade.action,
      trade.amount,
      trade.price?.toFixed(2) || '',
      (trade.totalValue || trade.price * trade.amount)?.toFixed(2) || '',
      pl?.amount?.toFixed(2) || ''
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
