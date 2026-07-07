import { useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';

// Trades tab: recent-trade feed with time/type/ticker/bot filters.
export function useAdminTrades({ showMessage }) {
  // Trade investigation state
  const [recentTrades, setRecentTrades] = useState([]);
  const [tradesLoading, setTradesLoading] = useState(false);
  const [tradeFilterTicker, setTradeFilterTicker] = useState('');
  const [tradeTimePeriod, setTradeTimePeriod] = useState('24h'); // '24h', 'week', 'all'
  const [tradeTypeFilter, setTradeTypeFilter] = useState('all'); // 'all', 'BUY', 'SELL', 'SHORT_OPEN', 'SHORT_CLOSE'
  const [tradeBotFilter, setTradeBotFilter] = useState('real'); // 'real', 'bots', 'all'

  // Load all recent trades from transaction logs
  const loadRecentTrades = async (timePeriod = '24h', typeFilter = 'all', tickerFilter = '', botFilter = 'real') => {
    setTradesLoading(true);
    try {
      const usersRef = collection(db, 'users');
      const snapshot = await getDocs(usersRef);

      // Calculate time cutoff
      const now = Date.now();
      let cutoffTime = 0;
      if (timePeriod === '24h') {
        cutoffTime = now - 24 * 60 * 60 * 1000;
      } else if (timePeriod === 'week') {
        cutoffTime = now - 7 * 24 * 60 * 60 * 1000;
      } else if (timePeriod === 'month') {
        cutoffTime = now - 30 * 24 * 60 * 60 * 1000;
      }
      // 'all' means cutoffTime = 0

      const trades = [];

      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        const userId = docSnap.id;
        const userName = data.displayName || 'Unknown';
        const isBot = data.isBot || false;
        const transactionLog = data.transactionLog || [];

        // Filter by bot status
        if (botFilter === 'real' && isBot) return;
        if (botFilter === 'bots' && !isBot) return;
        // 'all' shows both

        // Get trades from transaction log
        transactionLog.forEach(tx => {
          if (!['BUY', 'SELL', 'SHORT_OPEN', 'SHORT_CLOSE'].includes(tx.type)) return;
          if (tx.timestamp < cutoffTime) return;
          if (typeFilter !== 'all' && tx.type !== typeFilter) return;
          if (tickerFilter && tx.ticker !== tickerFilter.toUpperCase()) return;

          trades.push({
            userId,
            userName,
            isBot,
            type: tx.type,
            ticker: tx.ticker,
            shares: tx.shares || tx.amount || 0,
            price: tx.pricePerShare || tx.price || tx.entryPrice || 0,
            total: tx.totalCost || tx.totalRevenue || tx.marginRequired || 0,
            timestamp: tx.timestamp,
            priceImpact: tx.priceImpact || 0,
            newPrice: tx.newPrice || 0,
            profit: tx.profit || null
          });
        });
      });

      // Sort by most recent first
      trades.sort((a, b) => b.timestamp - a.timestamp);

      setRecentTrades(trades);
      showMessage('success', `Found ${trades.length} trades`);
    } catch (err) {
      console.error('Failed to load trades:', err);
      showMessage('error', 'Failed to load trades');
    }
    setTradesLoading(false);
  };

  return {
    tradeTimePeriod, setTradeTimePeriod, tradeTypeFilter, setTradeTypeFilter,
    tradeFilterTicker, setTradeFilterTicker, tradeBotFilter, setTradeBotFilter,
    tradesLoading, recentTrades, loadRecentTrades,
  };
}
