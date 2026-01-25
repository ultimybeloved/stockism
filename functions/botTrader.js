const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Economy constants (match src/constants/economy.js)
const BASE_IMPACT = 0.003;
const BASE_LIQUIDITY = 100;
const MIN_PRICE = 0.01;
const MAX_PRICE_CHANGE_PERCENT = 0.02;

/**
 * Calculate price impact using square root model
 */
function calculatePriceImpact(currentPrice, shares, liquidity = BASE_LIQUIDITY) {
  let impact = currentPrice * BASE_IMPACT * Math.sqrt(shares / liquidity);
  const maxChange = currentPrice * MAX_PRICE_CHANGE_PERCENT;
  if (impact > maxChange) impact = maxChange;
  return impact;
}

/**
 * Get price trend (% change over last N data points)
 */
function getPriceTrend(priceHistory, ticker, lookbackMinutes = 60) {
  const history = priceHistory[ticker] || [];
  if (history.length < 2) return 0;

  const now = Date.now();
  const cutoff = now - (lookbackMinutes * 60 * 1000);

  // Find price at cutoff
  let oldPrice = history[0].price;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].timestamp <= cutoff) {
      oldPrice = history[i].price;
      break;
    }
  }

  const currentPrice = history[history.length - 1].price;
  return ((currentPrice - oldPrice) / oldPrice) * 100;
}

/**
 * Bot decision logic based on personality
 * Returns: { action: 'BUY'|'SELL'|'HOLD', ticker: string, shares: number }
 */
function makeBotDecision(bot, marketData, allTickers, isThursday = false) {
  const personality = bot.botPersonality;
  const cash = bot.cash || 0;
  const holdings = bot.holdings || {};
  const prices = marketData.prices || {};
  const priceHistory = marketData.priceHistory || {};

  // Filter to bot's crew preference if they have one
  let tickerPool = allTickers;
  if (bot.botCrew) {
    // Get crew members for this crew
    const CREW_MEMBERS = {
      'BIG_DEAL': ['JAKE', 'SWRD', 'JSN', 'BRAD', 'LINE', 'SINU', 'LUAH'],
      'HOSTEL': ['ELI', 'SLLY', 'CHAE', 'MAX', 'DJO', 'ZAMI', 'RYAN'],
      'WORKERS': ['WRKR', 'BANG', 'CAPG', 'JYNG', 'NOMN', 'NEKO', 'DOOR', 'JINJ', 'DRMA', 'HYOT', 'OLDF', 'SHKO', 'HIKO', 'DOC', 'NO1']
    };
    tickerPool = (CREW_MEMBERS[bot.botCrew] || allTickers).filter(t => allTickers.includes(t));
  }

  if (tickerPool.length === 0) return { action: 'HOLD' };

  // Calculate trends for all tickers
  const trends = {};
  tickerPool.forEach(ticker => {
    trends[ticker] = getPriceTrend(priceHistory, ticker);
  });

  // Personality-based decision making
  switch (personality) {
    case 'market_follower': {
      // Amplify market movements - use shorter lookback for faster reaction
      const shortTermTrends = {};
      tickerPool.forEach(ticker => {
        shortTermTrends[ticker] = getPriceTrend(priceHistory, ticker, isThursday ? 15 : 20);
      });

      // Find stocks with any upward momentum
      const risingStocks = tickerPool.filter(t => shortTermTrends[t] > 0.5).sort((a, b) => shortTermTrends[b] - shortTermTrends[a]);
      const fallingHoldings = Object.keys(holdings).filter(t => (holdings[t] > 0 || holdings[t]?.shares > 0) && shortTermTrends[t] < -0.5);

      // More aggressive on Thursdays
      const aggressionMultiplier = isThursday ? 1.5 : 1.0;

      if (fallingHoldings.length > 0 && Math.random() > 0.2) {
        // Aggressively sell falling positions to amplify downward movement
        const ticker = fallingHoldings[0]; // Sell the most falling stock
        const shareCount = typeof holdings[ticker] === 'number' ? holdings[ticker] : (holdings[ticker]?.shares || 0);
        const sellPct = Math.min(0.9, (0.4 + Math.random() * 0.3) * aggressionMultiplier);
        return { action: 'SELL', ticker, shares: Math.ceil(shareCount * sellPct) };
      } else if (risingStocks.length > 0 && cash > 30) {
        // Aggressively buy rising stocks to amplify upward movement
        const ticker = risingStocks[0]; // Buy the most rising stock
        const cashPct = Math.min(0.6, (0.25 + Math.random() * 0.25) * aggressionMultiplier);
        const maxShares = Math.floor((cash * cashPct) / prices[ticker]);
        return { action: 'BUY', ticker, shares: Math.max(1, Math.min(15, maxShares)) };
      }
      break;
    }

    case 'momentum': {
      // Buy rising stocks, sell falling ones
      const risingStocks = tickerPool.filter(t => trends[t] > 2).sort((a, b) => trends[b] - trends[a]);
      const fallingHoldings = Object.keys(holdings).filter(t => (holdings[t] > 0 || holdings[t]?.shares > 0) && trends[t] < -2);

      if (fallingHoldings.length > 0 && Math.random() > 0.3) {
        // Sell falling
        const ticker = fallingHoldings[Math.floor(Math.random() * fallingHoldings.length)];
        const shareCount = typeof holdings[ticker] === 'number' ? holdings[ticker] : (holdings[ticker]?.shares || 0);
        return { action: 'SELL', ticker, shares: Math.ceil(shareCount * (0.3 + Math.random() * 0.4)) };
      } else if (risingStocks.length > 0 && cash > 50) {
        // Buy rising
        const ticker = risingStocks[0];
        const maxShares = Math.floor((cash * (0.2 + Math.random() * 0.3)) / prices[ticker]);
        return { action: 'BUY', ticker, shares: Math.max(1, Math.min(10, maxShares)) };
      }
      break;
    }

    case 'contrarian': {
      // Buy dips, sell peaks
      const dips = tickerPool.filter(t => trends[t] < -3).sort((a, b) => trends[a] - trends[b]);
      const peakHoldings = Object.keys(holdings).filter(t => (holdings[t] > 0 || holdings[t]?.shares > 0) && trends[t] > 3);

      if (peakHoldings.length > 0 && Math.random() > 0.4) {
        const ticker = peakHoldings[Math.floor(Math.random() * peakHoldings.length)];
        const shareCount = typeof holdings[ticker] === 'number' ? holdings[ticker] : (holdings[ticker]?.shares || 0);
        return { action: 'SELL', ticker, shares: Math.ceil(shareCount * (0.4 + Math.random() * 0.4)) };
      } else if (dips.length > 0 && cash > 50) {
        const ticker = dips[0];
        const maxShares = Math.floor((cash * (0.3 + Math.random() * 0.3)) / prices[ticker]);
        return { action: 'BUY', ticker, shares: Math.max(1, Math.min(15, maxShares)) };
      }
      break;
    }

    case 'hodler': {
      // Mostly buys, rarely sells
      if (Math.random() > 0.9 && Object.keys(holdings).length > 0) {
        // Rarely trim positions
        const ticker = Object.keys(holdings)[Math.floor(Math.random() * Object.keys(holdings).length)];
        const shareCount = typeof holdings[ticker] === 'number' ? holdings[ticker] : (holdings[ticker]?.shares || 0);
        if (shareCount > 10) {
          return { action: 'SELL', ticker, shares: Math.floor(shareCount * 0.2) };
        }
      } else if (cash > 100) {
        // Buy and hold
        const ticker = tickerPool[Math.floor(Math.random() * tickerPool.length)];
        const maxShares = Math.floor((cash * (0.15 + Math.random() * 0.15)) / prices[ticker]);
        return { action: 'BUY', ticker, shares: Math.max(1, Math.min(8, maxShares)) };
      }
      break;
    }

    case 'daytrader': {
      // Quick small trades
      if (Math.random() > 0.5 && Object.keys(holdings).length > 0) {
        const ticker = Object.keys(holdings)[Math.floor(Math.random() * Object.keys(holdings).length)];
        const shareCount = typeof holdings[ticker] === 'number' ? holdings[ticker] : (holdings[ticker]?.shares || 0);
        return { action: 'SELL', ticker, shares: Math.min(5, shareCount) };
      } else if (cash > 30) {
        const ticker = tickerPool[Math.floor(Math.random() * tickerPool.length)];
        const maxShares = Math.floor((cash * 0.1) / prices[ticker]);
        return { action: 'BUY', ticker, shares: Math.max(1, Math.min(5, maxShares)) };
      }
      break;
    }

    case 'random': {
      // Completely random
      if (Math.random() > 0.6 && Object.keys(holdings).length > 0) {
        const ticker = Object.keys(holdings)[Math.floor(Math.random() * Object.keys(holdings).length)];
        const shareCount = typeof holdings[ticker] === 'number' ? holdings[ticker] : (holdings[ticker]?.shares || 0);
        return { action: 'SELL', ticker, shares: Math.ceil(shareCount * Math.random()) };
      } else if (cash > 50) {
        const ticker = tickerPool[Math.floor(Math.random() * tickerPool.length)];
        const maxShares = Math.floor((cash * Math.random() * 0.5) / prices[ticker]);
        return { action: 'BUY', ticker, shares: Math.max(1, Math.min(12, maxShares)) };
      }
      break;
    }

    case 'panic': {
      // Sells on any dip
      const fallingHoldings = Object.keys(holdings).filter(t => (holdings[t] > 0 || holdings[t]?.shares > 0) && trends[t] < -1);
      if (fallingHoldings.length > 0) {
        const ticker = fallingHoldings[0];
        const shareCount = typeof holdings[ticker] === 'number' ? holdings[ticker] : (holdings[ticker]?.shares || 0);
        return { action: 'SELL', ticker, shares: Math.ceil(shareCount * (0.5 + Math.random() * 0.4)) };
      } else if (cash > 80 && Math.random() > 0.7) {
        const ticker = tickerPool[Math.floor(Math.random() * tickerPool.length)];
        const maxShares = Math.floor((cash * 0.15) / prices[ticker]);
        return { action: 'BUY', ticker, shares: Math.max(1, Math.min(6, maxShares)) };
      }
      break;
    }

    case 'swing':
    case 'balanced':
    default: {
      // Balanced approach
      if (Math.random() > 0.55 && Object.keys(holdings).length > 0) {
        const ticker = Object.keys(holdings)[Math.floor(Math.random() * Object.keys(holdings).length)];
        const shareCount = typeof holdings[ticker] === 'number' ? holdings[ticker] : (holdings[ticker]?.shares || 0);
        return { action: 'SELL', ticker, shares: Math.ceil(shareCount * (0.3 + Math.random() * 0.3)) };
      } else if (cash > 70) {
        const ticker = tickerPool[Math.floor(Math.random() * tickerPool.length)];
        const maxShares = Math.floor((cash * (0.2 + Math.random() * 0.2)) / prices[ticker]);
        return { action: 'BUY', ticker, shares: Math.max(1, Math.min(10, maxShares)) };
      }
      break;
    }
  }

  return { action: 'HOLD' };
}

module.exports = {
  /**
   * Bot Trader - Runs every 3 minutes
   * Picks 3-6 random bots to make trades (5-10 on Thursdays)
   */
  botTrader: functions.pubsub
    .schedule('every 3 minutes')
    .onRun(async (context) => {
      try {
        const db = admin.firestore();
        const marketRef = db.collection('market').doc('current');
        const usersRef = db.collection('users');

        // Get all bots
        const usersSnap = await usersRef.where('isBot', '==', true).get();
        const bots = usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        if (bots.length === 0) {
          console.log('No bots found');
          return null;
        }

        // Get market data
        const marketSnap = await marketRef.get();
        if (!marketSnap.exists) {
          console.log('No market data');
          return null;
        }

        const marketData = marketSnap.data();
        const prices = marketData.prices || {};
        const allTickers = Object.keys(prices);

        // Check if it's Thursday (chapter release day)
        const now = new Date();
        const isThursday = now.getDay() === 4;

        // More bots trade on Thursdays to boost activity
        const numBotsToTrade = isThursday
          ? Math.floor(Math.random() * 6) + 5  // 5-10 bots on Thursday
          : Math.floor(Math.random() * 4) + 3; // 3-6 bots normally

        const shuffled = bots.sort(() => 0.5 - Math.random());
        const tradingBots = shuffled.slice(0, numBotsToTrade);

        console.log(`${numBotsToTrade} bots will trade this round${isThursday ? ' (THURSDAY BOOST)' : ''}`);

        // Execute trades for each bot
        for (const bot of tradingBots) {
          const decision = makeBotDecision(bot, marketData, allTickers, isThursday);

          if (decision.action === 'HOLD') {
            console.log(`${bot.displayName} decided to HOLD`);
            continue;
          }

          console.log(`${bot.displayName} (${bot.botPersonality}): ${decision.action} ${decision.shares} ${decision.ticker}`);

          // Execute trade in transaction
          await db.runTransaction(async (transaction) => {
            const botRef = usersRef.doc(bot.id);
            const botSnap = await transaction.get(botRef);
            const botData = botSnap.data();

            const currentPrice = prices[decision.ticker];
            if (!currentPrice) return;

            if (decision.action === 'BUY') {
              const totalCost = currentPrice * decision.shares;
              if (botData.cash < totalCost) return; // Not enough cash

              const priceImpact = calculatePriceImpact(currentPrice, decision.shares);
              const newPrice = Math.max(MIN_PRICE, currentPrice + priceImpact);

              // Update bot
              const newHoldings = { ...(botData.holdings || {}) };
              const currentShares = typeof newHoldings[decision.ticker] === 'number'
                ? newHoldings[decision.ticker]
                : (newHoldings[decision.ticker]?.shares || 0);
              newHoldings[decision.ticker] = currentShares + decision.shares;

              const newCostBasis = { ...(botData.costBasis || {}) };
              const oldCost = newCostBasis[decision.ticker] || 0;
              newCostBasis[decision.ticker] = oldCost + totalCost;

              const newCash = botData.cash - totalCost;
              const holdingsValue = Object.entries(newHoldings).reduce((sum, [ticker, shares]) => {
                const shareCount = typeof shares === 'number' ? shares : (shares?.shares || 0);
                return sum + (prices[ticker] || 0) * shareCount;
              }, 0);

              const txLog = botData.transactionLog || [];
              txLog.push({
                type: 'BUY',
                ticker: decision.ticker,
                shares: decision.shares,
                pricePerShare: currentPrice,
                totalCost,
                cashBefore: botData.cash,
                cashAfter: newCash,
                portfolioAfter: newCash + holdingsValue,
                timestamp: Date.now()
              });

              transaction.update(botRef, {
                cash: newCash,
                holdings: newHoldings,
                costBasis: newCostBasis,
                portfolioValue: newCash + holdingsValue,
                totalTrades: (botData.totalTrades || 0) + 1,
                transactionLog: txLog.slice(-100) // Keep last 100
              });

              // Update market price
              const newPrices = { ...prices, [decision.ticker]: newPrice };
              const newHistory = { ...(marketData.priceHistory || {}) };
              if (!newHistory[decision.ticker]) newHistory[decision.ticker] = [];
              newHistory[decision.ticker].push({
                timestamp: Date.now(),
                price: newPrice
              });

              transaction.update(marketRef, {
                prices: newPrices,
                priceHistory: newHistory
              });

            } else if (decision.action === 'SELL') {
              const currentShares = typeof botData.holdings[decision.ticker] === 'number'
                ? botData.holdings[decision.ticker]
                : (botData.holdings[decision.ticker]?.shares || 0);

              if (currentShares < decision.shares) return; // Not enough shares

              const priceImpact = calculatePriceImpact(currentPrice, decision.shares);
              const newPrice = Math.max(MIN_PRICE, currentPrice - priceImpact);
              const totalRevenue = newPrice * decision.shares;

              // Update bot
              const newHoldings = { ...(botData.holdings || {}) };
              newHoldings[decision.ticker] = Math.max(0, currentShares - decision.shares);

              const newCash = botData.cash + totalRevenue;
              const holdingsValue = Object.entries(newHoldings).reduce((sum, [ticker, shares]) => {
                const shareCount = typeof shares === 'number' ? shares : (shares?.shares || 0);
                return sum + (prices[ticker] || 0) * shareCount;
              }, 0);

              const txLog = botData.transactionLog || [];
              txLog.push({
                type: 'SELL',
                ticker: decision.ticker,
                shares: decision.shares,
                pricePerShare: newPrice,
                totalRevenue,
                cashBefore: botData.cash,
                cashAfter: newCash,
                portfolioAfter: newCash + holdingsValue,
                timestamp: Date.now()
              });

              transaction.update(botRef, {
                cash: newCash,
                holdings: newHoldings,
                portfolioValue: newCash + holdingsValue,
                totalTrades: (botData.totalTrades || 0) + 1,
                transactionLog: txLog.slice(-100)
              });

              // Update market price
              const newPrices = { ...prices, [decision.ticker]: newPrice };
              const newHistory = { ...(marketData.priceHistory || {}) };
              if (!newHistory[decision.ticker]) newHistory[decision.ticker] = [];
              newHistory[decision.ticker].push({
                timestamp: Date.now(),
                price: newPrice
              });

              transaction.update(marketRef, {
                prices: newPrices,
                priceHistory: newHistory
              });
            }
          });
        }

        console.log('Bot trading round complete');
        return null;
      } catch (error) {
        console.error('Error in botTrader:', error);
        return null;
      }
    })
};
