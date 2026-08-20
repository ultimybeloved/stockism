import { CHARACTERS } from '../../characters';
import { getLastActiveMs } from '../../utils/activity';

// Turns a raw users-collection snapshot into the numbers the admin Stats tab
// shows. Pure aggregation, no Firestore reads and no React — split out of
// useAdminStats.js, which was past the 200-line hook limit.
export const aggregateMarketStats = (snapshot, prices) => {
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
  
  // Holdings by character. Two tallies on purpose: holdingsByTicker counts
  // every account (bot shares are real and belong in market cap), while the
  // player maps below skip bots so the "most held" board reflects what players
  // own rather than what the bot trader happened to buy.
  const holdingsByTicker = {};
  const playerSharesByTicker = {};
  const playerHoldersByTicker = {};
  CHARACTERS.forEach(c => {
    holdingsByTicker[c.ticker] = 0;
    playerSharesByTicker[c.ticker] = 0;
    playerHoldersByTicker[c.ticker] = 0;
  });
  
  // Crew membership counts
  const crewCounts = {};
  
  snapshot.forEach(doc => {
    const data = doc.data();
    totalUsers++;
    
    // Activity tracking — same definition the Discord summary uses.
    // Bots are excluded: they get a lastActive stamp when they are created,
    // which would otherwise count them as active players for two weeks.
    const lastActiveMs = data.isBot ? 0 : getLastActiveMs(data);
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
          if (!data.isBot) {
            playerSharesByTicker[ticker] += shares;
            playerHoldersByTicker[ticker] += 1;
          }
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
  
  // Top 5 most held characters, players only. Ranked by share count, with the
  // number of holders alongside: "most held" can mean either, and the two give
  // different answers (one whale outweighs fifty small positions).
  const topHeld = Object.entries(playerSharesByTicker)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([ticker, shares]) => ({ ticker, shares, holders: playerHoldersByTicker[ticker] }));
  
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
  
  return {
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
  };
};
