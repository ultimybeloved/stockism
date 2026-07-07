import { useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { CHARACTERS } from '../../characters';

// Stats tab: aggregate market statistics.
export function useAdminStats({ showMessage, prices }) {
  // Market Stats state
  const [marketStats, setMarketStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // Load market stats
  const loadMarketStats = async () => {
    setStatsLoading(true);
    try {
      const usersRef = collection(db, 'users');
      const snapshot = await getDocs(usersRef);
      
      const now = Date.now();
      const oneDayAgo = now - 24 * 60 * 60 * 1000;
      const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
      
      let totalUsers = 0;
      let activeUsers24h = 0;
      let activeUsers7d = 0;
      let totalCashInSystem = 0;
      let totalPortfolioValue = 0;
      let totalSharesHeld = 0;
      let totalMarginUsed = 0;
      let usersWithMargin = 0;
      let totalBetsPlaced = 0;
      let totalTradesAllTime = 0;
      
      // 24h activity tracking
      let trades24h = 0;
      let volume24h = 0; // Total cash moved in trades
      let buys24h = 0;
      let sells24h = 0;
      let shorts24h = 0;
      let checkins24h = 0;
      let bets24h = 0;
      const tickerVolume24h = {}; // Volume per ticker
      
      // Holdings by character
      const holdingsByTicker = {};
      CHARACTERS.forEach(c => { holdingsByTicker[c.ticker] = 0; });
      
      // Crew membership counts
      const crewCounts = {};
      
      snapshot.forEach(doc => {
        const data = doc.data();
        totalUsers++;
        
        // Activity tracking
        const lastActive = data.lastTradeTime || data.lastCheckin || 0;
        const lastActiveMs = lastActive?.toMillis ? lastActive.toMillis() : (lastActive || 0);
        if (lastActiveMs > oneDayAgo) activeUsers24h++;
        if (lastActiveMs > oneWeekAgo) activeUsers7d++;
        
        // Cash and portfolio
        totalCashInSystem += data.cash || 0;
        totalPortfolioValue += data.portfolioValue || 0;
        
        // Holdings
        const holdings = data.holdings || {};
        Object.entries(holdings).forEach(([ticker, shares]) => {
          if (shares > 0) {
            totalSharesHeld += shares;
            if (holdingsByTicker[ticker] !== undefined) {
              holdingsByTicker[ticker] += shares;
            }
          }
        });
        
        // Margin
        if (data.marginEnabled) {
          usersWithMargin++;
          totalMarginUsed += data.marginUsed || 0;
        }
        
        // Bets
        const bets = data.bets || {};
        totalBetsPlaced += Object.keys(bets).length;
        
        // Trades
        totalTradesAllTime += data.totalTrades || 0;
        
        // Crew
        if (data.crew) {
          crewCounts[data.crew] = (crewCounts[data.crew] || 0) + 1;
        }

        // Count check-ins from lastCheckin field (more reliable than transactionLog)
        if (data.lastCheckin) {
          const checkinDate = new Date(data.lastCheckin).getTime();
          if (checkinDate > oneDayAgo) {
            checkins24h++;
          }
        }

        // 24h transaction log analysis
        const transactionLog = data.transactionLog || [];
        transactionLog.forEach(tx => {
          if (tx.timestamp > oneDayAgo) {
            if (tx.type === 'BUY') {
              trades24h++;
              buys24h++;
              volume24h += tx.totalCost || 0;
              if (tx.ticker) {
                tickerVolume24h[tx.ticker] = (tickerVolume24h[tx.ticker] || 0) + (tx.totalCost || 0);
              }
            } else if (tx.type === 'SELL') {
              trades24h++;
              sells24h++;
              volume24h += tx.totalRevenue || 0;
              if (tx.ticker) {
                tickerVolume24h[tx.ticker] = (tickerVolume24h[tx.ticker] || 0) + (tx.totalRevenue || 0);
              }
            } else if (tx.type === 'SHORT_OPEN' || tx.type === 'SHORT_CLOSE') {
              trades24h++;
              shorts24h++;
              volume24h += tx.marginRequired || tx.cashBack || 0;
            } else if (tx.type === 'CHECKIN') {
              checkins24h++;
            } else if (tx.type === 'BET') {
              bets24h++;
              volume24h += tx.amount || 0;
            }
          }
        });
      });
      
      // Calculate total market cap (all shares * current prices)
      let totalMarketCap = 0;
      CHARACTERS.forEach(c => {
        const price = prices[c.ticker] || c.basePrice;
        const sharesHeld = holdingsByTicker[c.ticker] || 0;
        totalMarketCap += price * sharesHeld;
      });
      
      // Top 5 most held characters
      const topHeld = Object.entries(holdingsByTicker)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([ticker, shares]) => ({ ticker, shares }));
      
      // Top gainers/losers (comparing to base price)
      const priceChanges = CHARACTERS.map(c => {
        const current = prices[c.ticker] || c.basePrice;
        const change = ((current - c.basePrice) / c.basePrice) * 100;
        return { ticker: c.ticker, name: c.name, price: current, basePrice: c.basePrice, change };
      }).sort((a, b) => b.change - a.change);
      
      const topGainers = priceChanges.slice(0, 5);
      const topLosers = priceChanges.slice(-5).reverse();
      
      // Top traded tickers in 24h
      const topTraded24h = Object.entries(tickerVolume24h)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([ticker, volume]) => ({ ticker, volume }));
      
      setMarketStats({
        totalUsers,
        activeUsers24h,
        activeUsers7d,
        totalCashInSystem,
        totalPortfolioValue,
        totalSharesHeld,
        totalMarketCap,
        totalMarginUsed,
        usersWithMargin,
        totalBetsPlaced,
        totalTradesAllTime,
        topHeld,
        topGainers,
        topLosers,
        crewCounts,
        // 24h activity
        trades24h,
        volume24h,
        buys24h,
        sells24h,
        shorts24h,
        checkins24h,
        bets24h,
        topTraded24h,
        lastUpdated: now
      });
    } catch (err) {
      console.error('Failed to load market stats:', err);
      showMessage('error', 'Failed to load market stats');
    }
    setStatsLoading(false);
  };

  return { statsLoading, marketStats, loadMarketStats };
}
