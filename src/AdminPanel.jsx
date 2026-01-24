import React, { useState } from 'react';
import { doc, updateDoc, getDoc, setDoc, collection, getDocs, deleteDoc, runTransaction, arrayUnion } from 'firebase/firestore';
import { db } from './firebase';
import { CHARACTERS } from './characters';
import { ADMIN_UIDS } from './constants';

const AdminPanel = ({ user, predictions, prices, darkMode, onClose }) => {
  const [activeTab, setActiveTab] = useState('users');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  
  // Create prediction form state
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '', '', '', '', '']);
  const [daysUntilEnd, setDaysUntilEnd] = useState(7);
  
  // Calculate end time at 14:55 UTC on target day (5 min before chapter release)
  const getEndTime = (days) => {
    const now = new Date();
    const target = new Date(now);
    target.setDate(target.getDate() + days);
    target.setUTCHours(14, 55, 0, 0);
    return target.getTime();
  };
  
  const endDate = new Date(getEndTime(daysUntilEnd));
  
  // Resolve prediction state
  const [selectedPrediction, setSelectedPrediction] = useState(null);
  const [selectedOutcome, setSelectedOutcome] = useState('');

  // Price adjustment state
  const [selectedTicker, setSelectedTicker] = useState('');
  const [adjustmentType, setAdjustmentType] = useState('set'); // 'set' or 'percent'
  const [newPrice, setNewPrice] = useState('');
  const [percentChange, setPercentChange] = useState('');
  
  // Recovery tool state
  const [recoveryPredictionId, setRecoveryPredictionId] = useState('');
  const [recoveryBets, setRecoveryBets] = useState([]);
  const [recoveryWinner, setRecoveryWinner] = useState('');
  const [recoveryOptions, setRecoveryOptions] = useState([]);
  
  // User search state
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userSearchResults, setUserSearchResults] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [allUsers, setAllUsers] = useState([]);
  const [usersPage, setUsersPage] = useState(0);
  const [deleteMode, setDeleteMode] = useState(false);
  const [selectedForDeletion, setSelectedForDeletion] = useState(new Set());
  const USERS_PER_PAGE = 25;
  
  // IPO state
  const [ipoTicker, setIpoTicker] = useState('');
  const [ipoHoursUntilStart, setIpoHoursUntilStart] = useState(24); // Hours until IPO buying starts (hype phase)
  const [ipoDurationHours, setIpoDurationHours] = useState(24); // How long IPO buying lasts
  const [activeIPOs, setActiveIPOs] = useState([]);
  const [completedIPOTickers, setCompletedIPOTickers] = useState([]); // Tickers that have had IPOs
  
  // Holders state
  const [holdersTicker, setHoldersTicker] = useState('');
  const [holdersData, setHoldersData] = useState([]); // Array of { userId, displayName, shares, value }
  const [holdersLoading, setHoldersLoading] = useState(false);
  
  // Market Stats state
  const [marketStats, setMarketStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  
  // All Bets state
  const [allBets, setAllBets] = useState([]);
  const [betsLoading, setBetsLoading] = useState(false);
  
  // Trade investigation state
  const [recentTrades, setRecentTrades] = useState([]);
  const [tradesLoading, setTradesLoading] = useState(false);
  const [tradeFilterTicker, setTradeFilterTicker] = useState('');
  const [tradeTimePeriod, setTradeTimePeriod] = useState('24h'); // '24h', 'week', 'all'
  const [tradeTypeFilter, setTradeTypeFilter] = useState('all'); // 'all', 'BUY', 'SELL', 'SHORT_OPEN', 'SHORT_CLOSE'
  const [priceSnapshots, setPriceSnapshots] = useState([]); // For rollback
  const [rollbackTimestamp, setRollbackTimestamp] = useState('');
  const [rollbackConfirm, setRollbackConfirm] = useState(false);
  const [selectedTickerHistory, setSelectedTickerHistory] = useState([]);
  const [cleanupMinPrice, setCleanupMinPrice] = useState('');
  const [cleanupMaxPrice, setCleanupMaxPrice] = useState('');
  const [searchStartTime, setSearchStartTime] = useState('');
  const [searchEndTime, setSearchEndTime] = useState('');
  
  // Orphan cleanup state
  const [orphanedUsers, setOrphanedUsers] = useState([]);
  const [orphanScanComplete, setOrphanScanComplete] = useState(false);

  const isAdmin = user && ADMIN_UIDS.includes(user.uid);
  
  // Characters eligible for IPO: those with ipoRequired flag OR not yet in the market
  // We'll track which characters have completed IPOs in Firestore
  const ipoEligibleCharacters = CHARACTERS.filter(c => {
    // Check if there's already an active IPO for this character
    const hasActiveIPO = activeIPOs.some(ipo => ipo.ticker === c.ticker && !ipo.priceJumped);
    if (hasActiveIPO) return false;
    
    // Check if character has ipoRequired flag (new characters)
    if (c.ipoRequired) return true;
    
    // Don't show characters that have already completed IPO or are established
    if (completedIPOTickers.includes(c.ticker)) return false;
    
    // For now, only show characters explicitly marked as needing IPO
    return c.ipoRequired === true;
  });

  const cardClass = darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-300';
  const textClass = darkMode ? 'text-slate-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-slate-400' : 'text-slate-500';
  const inputClass = darkMode 
    ? 'bg-slate-900 border-slate-600 text-slate-100' 
    : 'bg-white border-slate-300 text-slate-900';

  const showMessage = (type, text) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  // Adjust character price
  const handlePriceAdjustment = async () => {
    if (!selectedTicker) {
      showMessage('error', 'Please select a character');
      return;
    }

    const character = CHARACTERS.find(c => c.ticker === selectedTicker);
    const currentPrice = prices[selectedTicker] || character?.basePrice;
    if (!currentPrice) {
      showMessage('error', 'Could not get current price');
      return;
    }

    let targetPrice;
    if (adjustmentType === 'set') {
      targetPrice = parseFloat(newPrice);
      if (isNaN(targetPrice) || targetPrice <= 0) {
        showMessage('error', 'Please enter a valid price');
        return;
      }
    } else {
      const percent = parseFloat(percentChange);
      if (isNaN(percent)) {
        showMessage('error', 'Please enter a valid percentage');
        return;
      }
      targetPrice = currentPrice * (1 + percent / 100);
      if (targetPrice <= 0) {
        showMessage('error', 'Resulting price would be negative');
        return;
      }
    }

    targetPrice = Math.round(targetPrice * 100) / 100;

    setLoading(true);
    try {
      const marketRef = doc(db, 'market', 'current');
      const snap = await getDoc(marketRef);
      const now = Date.now();
      
      if (snap.exists()) {
        const data = snap.data();
        let currentHistory = data.priceHistory?.[selectedTicker] || [];
        
        // If no history exists, add the current price as the first entry
        if (currentHistory.length === 0 && currentPrice) {
          currentHistory = [{ timestamp: now - 1000, price: currentPrice }]; // 1 second before
        }
        
        console.log('Current history length for', selectedTicker, ':', currentHistory.length);
        console.log('Last entry:', currentHistory[currentHistory.length - 1]);
        
        // Add new price to history
        const updatedHistory = [...currentHistory, { timestamp: now, price: targetPrice }];

        console.log('New history length:', updatedHistory.length);
        console.log('New last entry:', updatedHistory[updatedHistory.length - 1]);

        await updateDoc(marketRef, {
          [`prices.${selectedTicker}`]: targetPrice,
          [`priceHistory.${selectedTicker}`]: updatedHistory
        });
      } else {
        // Market doc doesn't exist, create it with this price
        await setDoc(marketRef, {
          prices: { [selectedTicker]: targetPrice },
          priceHistory: { [selectedTicker]: [{ timestamp: now, price: targetPrice }] }
        }, { merge: true });
      }

      const character = CHARACTERS.find(c => c.ticker === selectedTicker);
      const changePercent = ((targetPrice - currentPrice) / currentPrice * 100).toFixed(1);
      const direction = targetPrice > currentPrice ? '📈' : '📉';
      
      showMessage('success', `${direction} ${character?.name || selectedTicker}: $${currentPrice.toFixed(2)} → $${targetPrice.toFixed(2)} (${changePercent > 0 ? '+' : ''}${changePercent}%)`);
      
      // Reset form
      setSelectedTicker('');
      setNewPrice('');
      setPercentChange('');
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to adjust price');
    }
    setLoading(false);
  };

  // Create new prediction
  const handleCreatePrediction = async () => {
    if (!question.trim()) {
      showMessage('error', 'Please enter a question');
      return;
    }

    const validOptions = options.filter(o => o.trim());
    if (validOptions.length < 2) {
      showMessage('error', 'Please enter at least 2 options');
      return;
    }

    setLoading(true);
    try {
      const predictionsRef = doc(db, 'predictions', 'current');
      const snap = await getDoc(predictionsRef);
      const currentList = snap.exists() ? (snap.data().list || []) : [];

      // Generate unique ID using timestamp
      const newId = `pred_${Date.now()}`;

      // Create pools object
      const pools = {};
      validOptions.forEach(opt => {
        pools[opt.trim()] = 0;
      });

      const newPrediction = {
        id: newId,
        question: question.trim(),
        options: validOptions.map(o => o.trim()),
        pools,
        endsAt: getEndTime(daysUntilEnd),
        resolved: false,
        outcome: null,
        payoutsProcessed: false,
        createdAt: Date.now()
      };

      await updateDoc(predictionsRef, {
        list: [...currentList, newPrediction]
      });

      showMessage('success', `Created prediction: "${question.trim()}"`);
      setQuestion('');
      setOptions(['', '', '', '', '', '']);
      setDaysUntilEnd(7);
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to create prediction');
    }
    setLoading(false);
  };

  // Load active IPOs
  const loadIPOs = async () => {
    try {
      const ipoRef = doc(db, 'market', 'ipos');
      const snap = await getDoc(ipoRef);
      if (snap.exists()) {
        const list = snap.data().list || [];
        setActiveIPOs(list);
        // Track which tickers have completed IPOs
        const completed = list.filter(ipo => ipo.priceJumped).map(ipo => ipo.ticker);
        setCompletedIPOTickers(completed);
      } else {
        setActiveIPOs([]);
        setCompletedIPOTickers([]);
      }
    } catch (err) {
      console.error('Failed to load IPOs:', err);
    }
  };

  // Create new IPO
  const handleCreateIPO = async () => {
    if (!ipoTicker) {
      showMessage('error', 'Please select a character');
      return;
    }

    const character = CHARACTERS.find(c => c.ticker === ipoTicker);
    if (!character) {
      showMessage('error', 'Character not found');
      return;
    }

    // Check if IPO already exists for this ticker
    const existingIPO = activeIPOs.find(ipo => ipo.ticker === ipoTicker && !ipo.priceJumped);
    if (existingIPO) {
      showMessage('error', 'An IPO already exists for this character');
      return;
    }

    setLoading(true);
    try {
      const ipoRef = doc(db, 'market', 'ipos');
      const snap = await getDoc(ipoRef);
      const currentList = snap.exists() ? (snap.data().list || []) : [];

      const now = Date.now();
      const ipoStartsAt = now + (ipoHoursUntilStart * 60 * 60 * 1000);
      const ipoEndsAt = ipoStartsAt + (ipoDurationHours * 60 * 60 * 1000);

      const newIPO = {
        ticker: ipoTicker,
        basePrice: character.basePrice,
        ipoStartsAt,
        ipoEndsAt,
        sharesRemaining: 150,
        priceJumped: false,
        createdAt: now
      };

      if (snap.exists()) {
        await updateDoc(ipoRef, {
          list: [...currentList, newIPO]
        });
      } else {
        await setDoc(ipoRef, {
          list: [newIPO]
        });
      }

      showMessage('success', `🚀 IPO created for $${ipoTicker}! Hype phase starts now, buying in ${ipoHoursUntilStart}h`);
      setIpoTicker('');
      loadIPOs();
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to create IPO');
    }
    setLoading(false);
  };

  // Cancel/Delete IPO
  const handleCancelIPO = async (ticker) => {
    if (!window.confirm(`Cancel IPO for $${ticker}? This cannot be undone.`)) return;
    
    setLoading(true);
    try {
      const ipoRef = doc(db, 'market', 'ipos');
      const snap = await getDoc(ipoRef);
      if (snap.exists()) {
        const currentList = snap.data().list || [];
        const updatedList = currentList.filter(ipo => ipo.ticker !== ticker);
        await updateDoc(ipoRef, { list: updatedList });
        showMessage('success', `Cancelled IPO for $${ticker}`);
        loadIPOs();
      }
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to cancel IPO');
    }
    setLoading(false);
  };

  // Load holders for a specific character
  const loadHolders = async (ticker) => {
    if (!ticker) {
      setHoldersData([]);
      return;
    }
    
    setHoldersLoading(true);
    try {
      const usersRef = collection(db, 'users');
      const snapshot = await getDocs(usersRef);
      
      const holders = [];
      const currentPrice = prices[ticker] || CHARACTERS.find(c => c.ticker === ticker)?.basePrice || 0;
      
      snapshot.forEach(doc => {
        const userData = doc.data();
        const shares = userData.holdings?.[ticker] || 0;
        
        if (shares > 0) {
          holders.push({
            userId: doc.id,
            displayName: userData.displayName || 'Unknown',
            shares,
            value: shares * currentPrice,
            costBasis: userData.costBasis?.[ticker] || null
          });
        }
      });
      
      // Sort by shares (highest first)
      holders.sort((a, b) => b.shares - a.shares);
      
      setHoldersData(holders);
    } catch (err) {
      console.error('Failed to load holders:', err);
      showMessage('error', 'Failed to load holders');
    }
    setHoldersLoading(false);
  };

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
        if (lastActive > oneDayAgo) activeUsers24h++;
        if (lastActive > oneWeekAgo) activeUsers7d++;
        
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

  // Load all bets from all users
  const loadAllBets = async () => {
    setBetsLoading(true);
    try {
      const usersRef = collection(db, 'users');
      const snapshot = await getDocs(usersRef);
      
      const bets = [];
      
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        const userId = docSnap.id;
        const userName = data.displayName || 'Unknown';
        const userBets = data.bets || {};
        
        Object.entries(userBets).forEach(([predictionId, bet]) => {
          bets.push({
            userId,
            userName,
            predictionId,
            option: bet.option,
            amount: bet.amount || 0,
            placedAt: bet.placedAt || 0,
            question: bet.question || 'Unknown',
            paid: bet.paid || false,
            payout: bet.payout || 0
          });
        });
      });
      
      // Sort by most recent first
      bets.sort((a, b) => b.placedAt - a.placedAt);
      
      setAllBets(bets);
      showMessage('success', `Found ${bets.length} total bets`);
    } catch (err) {
      console.error('Failed to load bets:', err);
      showMessage('error', 'Failed to load bets');
    }
    setBetsLoading(false);
  };

  // Load all recent trades from transaction logs
  const loadRecentTrades = async (timePeriod = '24h', typeFilter = 'all', tickerFilter = '') => {
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
        const transactionLog = data.transactionLog || [];

        // Get trades from transaction log
        transactionLog.forEach(tx => {
          if (!['BUY', 'SELL', 'SHORT_OPEN', 'SHORT_CLOSE'].includes(tx.type)) return;
          if (tx.timestamp < cutoffTime) return;
          if (typeFilter !== 'all' && tx.type !== typeFilter) return;
          if (tickerFilter && tx.ticker !== tickerFilter.toUpperCase()) return;

          trades.push({
            userId,
            userName,
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

  // Load price history snapshots for rollback
  const loadPriceSnapshots = async (ticker) => {
    try {
      const marketRef = doc(db, 'market', 'current');
      const marketSnap = await getDoc(marketRef);
      const marketData = marketSnap.data();
      const history = marketData?.priceHistory?.[ticker] || [];
      
      // Get last 50 price points
      const snapshots = history.slice(-50).reverse().map(h => ({
        timestamp: h.timestamp,
        price: h.price,
        date: new Date(h.timestamp).toLocaleString()
      }));
      
      setPriceSnapshots(snapshots);
      return snapshots;
    } catch (err) {
      console.error('Failed to load price snapshots:', err);
      return [];
    }
  };

  // Search trades by ticker and time range
  const searchTradesByTickerAndTime = async (ticker, startTime, endTime) => {
    setTradesLoading(true);
    try {
      const usersRef = collection(db, 'users');
      const snapshot = await getDocs(usersRef);
      
      const matchingTrades = [];
      
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        const userId = docSnap.id;
        const userName = data.displayName || 'Unknown';
        const transactionLog = data.transactionLog || [];
        
        // Filter trades by ticker and time range
        transactionLog.forEach(tx => {
          if (tx.ticker === ticker && 
              tx.timestamp >= startTime && 
              tx.timestamp <= endTime &&
              ['BUY', 'SELL', 'SHORT_OPEN', 'SHORT_CLOSE'].includes(tx.type)) {
            matchingTrades.push({
              userId,
              userName,
              type: tx.type,
              ticker: tx.ticker,
              shares: tx.shares || tx.amount || 0,
              price: tx.pricePerShare || tx.price || tx.entryPrice || 0,
              total: tx.totalCost || tx.totalRevenue || tx.marginRequired || 0,
              timestamp: tx.timestamp,
              priceImpact: tx.priceImpact || 0,
              newPrice: tx.newPrice || 0,
              // Include full tx for debugging
              raw: tx
            });
          }
        });
      });
      
      // Sort by timestamp
      matchingTrades.sort((a, b) => a.timestamp - b.timestamp);
      
      setRecentTrades(matchingTrades);
      showMessage('success', `Found ${matchingTrades.length} trades for $${ticker} in time range`);
    } catch (err) {
      console.error('Failed to search trades:', err);
      showMessage('error', 'Failed to search trades');
    }
    setTradesLoading(false);
  };

  // Rollback price to a specific snapshot
  const rollbackPrice = async (ticker, targetPrice) => {
    setLoading(true);
    try {
      const marketRef = doc(db, 'market', 'current');
      
      await updateDoc(marketRef, {
        [`prices.${ticker}`]: targetPrice
      });
      
      showMessage('success', `Rolled back $${ticker} to $${targetPrice.toFixed(2)}`);
    } catch (err) {
      console.error('Failed to rollback price:', err);
      showMessage('error', 'Failed to rollback price');
    }
    setLoading(false);
  };

  // Bulk rollback multiple tickers
  const bulkRollbackPrices = async (tickerPrices) => {
    setLoading(true);
    try {
      const marketRef = doc(db, 'market', 'current');
      const updates = {};
      
      for (const [ticker, price] of Object.entries(tickerPrices)) {
        updates[`prices.${ticker}`] = price;
      }
      
      await updateDoc(marketRef, updates);
      
      showMessage('success', `Rolled back ${Object.keys(tickerPrices).length} prices`);
    } catch (err) {
      console.error('Failed to bulk rollback:', err);
      showMessage('error', 'Failed to bulk rollback');
    }
    setLoading(false);
  };

  // FULL MARKET ROLLBACK - Reverses all trades after a timestamp
  const executeFullRollback = async (rollbackTimestamp) => {
    setLoading(true);
    try {
      const usersRef = collection(db, 'users');
      const usersSnapshot = await getDocs(usersRef);
      const marketRef = doc(db, 'market', 'current');
      const marketSnap = await getDoc(marketRef);
      const marketData = marketSnap.data();
      const priceHistory = marketData?.priceHistory || {};
      
      let tradesReversed = 0;
      let usersAffected = 0;
      const priceRollbacks = {};
      
      // First, find prices at the rollback timestamp
      for (const [ticker, history] of Object.entries(priceHistory)) {
        if (!history || history.length === 0) continue;
        
        // Find the price at or before the rollback timestamp
        let priceAtRollback = history[0]?.price || 100; // Default to first price or 100
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i].timestamp <= rollbackTimestamp) {
            priceAtRollback = history[i].price;
            break;
          }
        }
        priceRollbacks[ticker] = priceAtRollback;
      }
      
      // Process each user
      for (const userDoc of usersSnapshot.docs) {
        const userData = userDoc.data();
        const userId = userDoc.id;
        const transactionLog = userData.transactionLog || [];
        
        // Find trades after rollback timestamp
        const tradesToReverse = transactionLog.filter(tx => 
          tx.timestamp > rollbackTimestamp && 
          ['BUY', 'SELL', 'SHORT_OPEN', 'SHORT_CLOSE'].includes(tx.type)
        );
        
        if (tradesToReverse.length === 0) continue;
        
        usersAffected++;
        tradesReversed += tradesToReverse.length;
        
        // Calculate reversals
        let cashAdjustment = 0;
        const holdingsAdjustments = {};
        const shortsAdjustments = {};
        
        for (const tx of tradesToReverse) {
          const ticker = tx.ticker;
          
          switch (tx.type) {
            case 'BUY':
              // Reverse buy: remove shares, refund cash
              holdingsAdjustments[ticker] = (holdingsAdjustments[ticker] || 0) - (tx.shares || tx.amount || 0);
              cashAdjustment += tx.totalCost || 0;
              break;
            case 'SELL':
              // Reverse sell: add shares back, remove cash received
              holdingsAdjustments[ticker] = (holdingsAdjustments[ticker] || 0) + (tx.shares || tx.amount || 0);
              cashAdjustment -= tx.totalRevenue || 0;
              break;
            case 'SHORT_OPEN':
              // Reverse short open: remove short position, refund margin
              shortsAdjustments[ticker] = (shortsAdjustments[ticker] || 0) - (tx.shares || 0);
              cashAdjustment += tx.marginRequired || 0;
              break;
            case 'SHORT_CLOSE':
              // Reverse short close: restore short position, remove cash returned
              shortsAdjustments[ticker] = (shortsAdjustments[ticker] || 0) + (tx.shares || 0);
              cashAdjustment -= tx.cashBack || 0;
              break;
          }
        }
        
        // Build update object
        const userRef = doc(db, 'users', userId);
        const updateData = {
          cash: (userData.cash || 0) + cashAdjustment,
          // Remove trades after rollback from log
          transactionLog: transactionLog.filter(tx => tx.timestamp <= rollbackTimestamp)
        };
        
        // Apply holdings adjustments
        for (const [ticker, adjustment] of Object.entries(holdingsAdjustments)) {
          const currentHolding = userData.holdings?.[ticker] || 0;
          const newHolding = Math.max(0, currentHolding + adjustment);
          updateData[`holdings.${ticker}`] = newHolding;
        }
        
        // Apply shorts adjustments (simplified - may need more complex logic)
        for (const [ticker, adjustment] of Object.entries(shortsAdjustments)) {
          const currentShort = userData.shorts?.[ticker]?.shares || 0;
          const newShortShares = Math.max(0, currentShort + adjustment);
          if (newShortShares === 0) {
            updateData[`shorts.${ticker}`] = { shares: 0, margin: 0, entryPrice: 0 };
          }
        }
        
        await updateDoc(userRef, updateData);
      }
      
      // Now rollback all prices AND clean price history
      const priceUpdates = {};
      for (const [ticker, price] of Object.entries(priceRollbacks)) {
        priceUpdates[`prices.${ticker}`] = price;
      }

      // Also trim price history to remove bad data after rollback point
      const historyUpdates = {};
      for (const [ticker, history] of Object.entries(priceHistory)) {
        if (!history || history.length === 0) continue;
        // Keep only entries at or before the rollback timestamp
        const cleanedHistory = history.filter(h => h.timestamp <= rollbackTimestamp);
        if (cleanedHistory.length !== history.length) {
          historyUpdates[`priceHistory.${ticker}`] = cleanedHistory;
        }
      }

      // Combine price and history updates
      const marketUpdates = { ...priceUpdates, ...historyUpdates };

      if (Object.keys(marketUpdates).length > 0) {
        await updateDoc(marketRef, marketUpdates);
      }

      const historyTrimmed = Object.keys(historyUpdates).length;
      showMessage('success', `Rollback complete! Reversed ${tradesReversed} trades for ${usersAffected} users. Prices restored. ${historyTrimmed > 0 ? `Cleaned history for ${historyTrimmed} tickers.` : ''}`);
      
    } catch (err) {
      console.error('Full rollback failed:', err);
      showMessage('error', 'Rollback failed: ' + err.message);
    }
    setLoading(false);
  };

  // Get price history for investigation
  const getPriceHistoryForTicker = async (ticker) => {
    try {
      const marketRef = doc(db, 'market', 'current');
      const marketSnap = await getDoc(marketRef);
      const marketData = marketSnap.data();
      const history = marketData?.priceHistory?.[ticker] || [];
      return history.slice(-100).map(h => ({
        timestamp: h.timestamp,
        price: h.price,
        date: new Date(h.timestamp).toLocaleString()
      }));
    } catch (err) {
      console.error('Failed to get price history:', err);
      return [];
    }
  };

  // Clean up bad price history data (removes extreme spikes/crashes)
  const cleanPriceHistory = async (ticker, minPrice, maxPrice) => {
    setLoading(true);
    try {
      const marketRef = doc(db, 'market', 'current');
      const marketSnap = await getDoc(marketRef);
      const marketData = marketSnap.data();
      const history = marketData?.priceHistory?.[ticker] || [];
      
      const originalCount = history.length;
      
      // Filter out price points outside the acceptable range
      const cleanedHistory = history.filter(h => 
        h.price >= minPrice && h.price <= maxPrice
      );
      
      const removedCount = originalCount - cleanedHistory.length;
      
      if (removedCount > 0) {
        await updateDoc(marketRef, {
          [`priceHistory.${ticker}`]: cleanedHistory
        });
        showMessage('success', `Cleaned ${ticker} history: removed ${removedCount} bad data points`);
      } else {
        showMessage('info', `No bad data points found in ${ticker} history`);
      }
    } catch (err) {
      console.error('Failed to clean price history:', err);
      showMessage('error', 'Failed to clean price history');
    }
    setLoading(false);
  };

  // RESTORE PRICES FROM USER COSTBASIS DATA
  // Uses transaction to prevent concurrent updates from being lost
  const restorePricesFromCostBasis = async () => {
    setLoading(true);
    try {
      const usersRef = collection(db, 'users');
      const snapshot = await getDocs(usersRef);

      // Collect all costBasis values per ticker
      const priceData = {};

      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        const costBasis = data.costBasis || {};

        Object.entries(costBasis).forEach(([ticker, price]) => {
          if (price && price > 0 && price < 10000) { // Filter out crazy values
            if (!priceData[ticker]) {
              priceData[ticker] = [];
            }
            priceData[ticker].push(price);
          }
        });
      });

      // Calculate best price estimate using median (avoids manipulation outliers)
      const restoredPrices = {};

      Object.entries(priceData).forEach(([ticker, prices]) => {
        if (prices.length > 0) {
          prices.sort((a, b) => a - b);
          const mid = Math.floor(prices.length / 2);
          const median = prices.length % 2 === 0
            ? (prices[mid - 1] + prices[mid]) / 2
            : prices[mid];
          restoredPrices[ticker] = Math.round(median * 100) / 100;
        }
      });

      // Use transaction to safely merge with current data (prevents race conditions)
      const marketRef = doc(db, 'market', 'current');
      await runTransaction(db, async (transaction) => {
        const marketSnap = await transaction.get(marketRef);
        const currentData = marketSnap.data() || {};
        const currentPrices = currentData.prices || {};
        const currentHistory = currentData.priceHistory || {};

        // Merge: use restored prices where available, keep current otherwise
        const finalPrices = { ...currentPrices, ...restoredPrices };

        // Record the restoration in price history
        const now = Date.now();
        const historyUpdates = {};
        Object.entries(restoredPrices).forEach(([ticker, price]) => {
          const tickerHistory = currentHistory[ticker] || [];
          historyUpdates[ticker] = [...tickerHistory, { timestamp: now, price, source: 'admin_restore' }];
        });

        transaction.update(marketRef, {
          prices: finalPrices,
          priceHistory: { ...currentHistory, ...historyUpdates },
          lastAdminRestore: now
        });
      });

      showMessage('success', `Restored prices for ${Object.keys(restoredPrices).length} tickers from user costBasis data`);
      console.log('Restored prices:', restoredPrices);
    } catch (err) {
      console.error('Failed to restore prices:', err);
      showMessage('error', 'Failed to restore prices: ' + err.message);
    }
    setLoading(false);
  };

  // Find and clean illegitimate bets (bets > investment amount)
  const [illegitimateBets, setIllegitimateBets] = useState([]);
  const [betScanLoading, setBetScanLoading] = useState(false);
  
  const scanForIllegitimateBets = async (minBetAmount = 0) => {
    setBetScanLoading(true);
    try {
      const usersRef = collection(db, 'users');
      const snapshot = await getDocs(usersRef);
      
      const badBets = [];
      
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        const userId = docSnap.id;
        const userName = data.displayName || 'Unknown';
        
        // Skip admin
        if (ADMIN_UIDS.includes(userId)) return;
        
        // Calculate their investment (total spent on stocks)
        const totalSpentOnStocks = Object.entries(data.holdings || {}).reduce((sum, [ticker, shares]) => {
          const basis = data.costBasis?.[ticker] || 0;
          return sum + (basis * shares);
        }, 0);
        const totalShortMargin = Object.values(data.shorts || {}).reduce((sum, short) => sum + (short.margin || 0), 0);
        const totalInvested = totalSpentOnStocks + totalShortMargin;
        
        // Check their bets - ONLY unpaid (active) bets
        const bets = data.bets || {};
        Object.entries(bets).forEach(([predictionId, bet]) => {
          // Skip already paid/resolved bets
          if (bet.paid) return;
          
          const betAmount = bet.amount || 0;
          
          // Flag if bet >= minBetAmount AND bet > their investment
          if (betAmount >= minBetAmount && betAmount > totalInvested) {
            badBets.push({
              userId,
              userName,
              predictionId,
              option: bet.option,
              betAmount,
              totalInvested,
              excess: betAmount - totalInvested,
              question: bet.question || 'Unknown'
            });
          }
        });
      });
      
      // Sort by excess amount (most over-bet first)
      badBets.sort((a, b) => b.excess - a.excess);
      
      setIllegitimateBets(badBets);
      showMessage('success', `Found ${badBets.length} illegitimate active bets`);
    } catch (err) {
      console.error('Failed to scan bets:', err);
      showMessage('error', 'Failed to scan bets');
    }
    setBetScanLoading(false);
  };
  
  // Refund a single illegitimate bet
  const refundBet = async (userId, predictionId, betAmount, option) => {
    setLoading(true);
    try {
      const userRef = doc(db, 'users', userId);
      const userSnap = await getDoc(userRef);
      const userData = userSnap.data();
      
      // Refund cash
      const newCash = (userData.cash || 0) + betAmount;
      
      // Remove the bet
      const updatedBets = { ...userData.bets };
      delete updatedBets[predictionId];
      
      await updateDoc(userRef, {
        cash: newCash,
        bets: updatedBets
      });
      
      // Also need to update the prediction pool
      const predictionsRef = doc(db, 'predictions', 'current');
      const predSnap = await getDoc(predictionsRef);
      const predData = predSnap.data();
      
      if (predData?.list) {
        const updatedList = predData.list.map(p => {
          if (p.id === predictionId && p.pools && p.pools[option]) {
            const newPools = { ...p.pools };
            newPools[option] = Math.max(0, (newPools[option] || 0) - betAmount);
            return { ...p, pools: newPools };
          }
          return p;
        });
        
        await updateDoc(predictionsRef, { list: updatedList });
      }
      
      showMessage('success', `Refunded $${betAmount} to user`);
      
      // Remove from local list
      setIllegitimateBets(prev => prev.filter(b => !(b.userId === userId && b.predictionId === predictionId)));
      
    } catch (err) {
      console.error('Failed to refund bet:', err);
      showMessage('error', 'Failed to refund bet');
    }
    setLoading(false);
  };
  
  // Refund all illegitimate bets
  const refundAllIllegitimateBets = async () => {
    if (illegitimateBets.length === 0) return;
    
    setLoading(true);
    let refunded = 0;
    
    for (const bet of illegitimateBets) {
      try {
        const userRef = doc(db, 'users', bet.userId,);
        const userSnap = await getDoc(userRef);
        const userData = userSnap.data();
        
        // Refund cash
        const newCash = (userData.cash || 0) + bet.betAmount;
        
        // Remove the bet
        const updatedBets = { ...userData.bets };
        delete updatedBets[bet.predictionId];
        
        await updateDoc(userRef, {
          cash: newCash,
          bets: updatedBets
        });
        
        // Update prediction pool
        const predictionsRef = doc(db, 'predictions', 'current');
        const predSnap = await getDoc(predictionsRef);
        const predData = predSnap.data();
        
        if (predData?.list) {
          const updatedList = predData.list.map(p => {
            if (p.id === bet.predictionId && p.pools && p.pools[bet.option]) {
              const newPools = { ...p.pools };
              newPools[bet.option] = Math.max(0, (newPools[bet.option] || 0) - bet.betAmount);
              return { ...p, pools: newPools };
            }
            return p;
          });
          
          await updateDoc(predictionsRef, { list: updatedList });
        }
        
        refunded++;
      } catch (err) {
        console.error('Failed to refund bet:', err);
      }
    }
    
    showMessage('success', `Refunded ${refunded} bets`);
    setIllegitimateBets([]);
    setLoading(false);
  };

  // Scan for suspicious accounts (potential exploiters)
  const [suspiciousAccounts, setSuspiciousAccounts] = useState([]);
  const [suspiciousScanLoading, setSuspiciousScanLoading] = useState(false);
  
  const scanForSuspiciousAccounts = async () => {
    setSuspiciousScanLoading(true);
    try {
      const usersRef = collection(db, 'users');
      const marketRef = doc(db, 'market', 'current');
      const [usersSnapshot, marketSnap] = await Promise.all([
        getDocs(usersRef),
        getDoc(marketRef)
      ]);
      
      const marketData = marketSnap.data();
      const currentPrices = marketData?.prices || {};
      
      const suspicious = [];
      
      usersSnapshot.forEach(docSnap => {
        const data = docSnap.data();
        const id = docSnap.id;
        const userName = data.displayName || 'Unknown';
        
        // Skip admin accounts
        if (ADMIN_UIDS.includes(id)) return;
        
        const cash = data.cash || 0;
        const holdings = data.holdings || {};
        const costBasis = data.costBasis || {};
        const shorts = data.shorts || {};
        const totalTrades = data.totalTrades || 0;
        const portfolioValue = data.portfolioValue || 0;
        
        const flags = [];
        
        // 1. Bought stocks at suspiciously low prices (cost basis < $1)
        Object.entries(costBasis).forEach(([ticker, basis]) => {
          if (basis > 0 && basis < 1 && holdings[ticker] > 0) {
            flags.push(`Bought $${ticker} at $${basis.toFixed(2)} (owns ${holdings[ticker]} shares)`);
          }
        });
        
        // 2. Portfolio value way higher than reasonable from trades
        // Rough check: if portfolioValue > totalTrades * 10000, suspicious
        if (portfolioValue > 100000 && totalTrades < 50) {
          flags.push(`Portfolio $${portfolioValue.toFixed(0)} with only ${totalTrades} trades`);
        }
        
        // 3. Owns massive amounts of a single stock
        Object.entries(holdings).forEach(([ticker, shares]) => {
          if (shares > 1000) {
            const currentPrice = currentPrices[ticker] || 100;
            const value = shares * currentPrice;
            flags.push(`Owns ${shares} $${ticker} (worth $${value.toFixed(0)})`);
          }
        });
        
        // 4. Has shorts with suspicious entry prices
        Object.entries(shorts).forEach(([ticker, short]) => {
          if (short.shares > 0 && short.entryPrice < 1) {
            flags.push(`Shorted $${ticker} at $${short.entryPrice.toFixed(2)} (${short.shares} shares)`);
          }
        });
        
        // 5. Cash way above starting amount without many trades
        if (cash > 50000 && totalTrades < 20) {
          flags.push(`Has $${cash.toFixed(0)} cash with only ${totalTrades} trades`);
        }
        
        // 6. Empty transaction log but has trades recorded
        const hasTransactionLog = data.transactionLog && data.transactionLog.length > 0;
        if (totalTrades > 5 && !hasTransactionLog) {
          flags.push(`${totalTrades} trades but no transaction log (old account or cleared)`);
        }
        
        if (flags.length > 0) {
          suspicious.push({
            id,
            userName,
            cash,
            portfolioValue,
            totalTrades,
            holdings,
            costBasis,
            shorts,
            flags,
            createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt) || null
          });
        }
      });
      
      // Sort by most flags first, then by portfolio value
      suspicious.sort((a, b) => {
        if (b.flags.length !== a.flags.length) return b.flags.length - a.flags.length;
        return b.portfolioValue - a.portfolioValue;
      });
      
      setSuspiciousAccounts(suspicious);
      showMessage('success', `Found ${suspicious.length} suspicious accounts`);
    } catch (err) {
      console.error('Failed to scan for suspicious accounts:', err);
      showMessage('error', 'Failed to scan');
    }
    setSuspiciousScanLoading(false);
  };

  // Scan for likely orphaned/bot accounts
  const scanForOrphanedUsers = async () => {
    setLoading(true);
    try {
      const usersRef = collection(db, 'users');
      const snapshot = await getDocs(usersRef);
      
      const suspicious = [];
      const now = Date.now();
      const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
      
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        const id = docSnap.id;
        
        // Skip admin accounts
        if (ADMIN_UIDS.includes(id)) return;
        
        // Criteria for likely orphaned/bot accounts:
        // 1. No trades ever AND no checkins AND created more than a day ago
        // 2. Still has exactly starting cash ($1000) and no holdings
        // 3. No activity in over a week
        
        const totalTrades = data.totalTrades || 0;
        const totalCheckins = data.totalCheckins || 0;
        const cash = data.cash || 0;
        const holdings = data.holdings || {};
        const holdingsCount = Object.values(holdings).filter(s => s > 0).length;
        const lastActive = data.lastTradeTime || data.lastCheckin || data.createdAt || 0;
        const createdAt = data.createdAt || 0;
        const portfolioValue = data.portfolioValue || 0;
        
        // Flag as suspicious if:
        // - Zero activity (no trades, no checkins) AND default cash AND no holdings
        const isInactive = totalTrades === 0 && totalCheckins === 0 && holdingsCount === 0;
        const hasDefaultCash = cash === 1000 || (cash >= 999 && cash <= 1001);
        const noRecentActivity = lastActive < oneWeekAgo || lastActive === 0;
        
        if (isInactive && hasDefaultCash) {
          suspicious.push({
            id,
            displayName: data.displayName || 'Unknown',
            cash,
            portfolioValue,
            totalTrades,
            totalCheckins,
            holdingsCount,
            createdAt,
            lastActive,
            reason: 'Zero activity + default cash'
          });
        }
      });
      
      // Sort by creation date (oldest first)
      suspicious.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      
      setOrphanedUsers(suspicious);
      setOrphanScanComplete(true);
      showMessage('success', `Found ${suspicious.length} likely orphaned/bot accounts`);
    } catch (err) {
      console.error('Failed to scan for orphans:', err);
      showMessage('error', 'Failed to scan for orphaned users');
    }
    setLoading(false);
  };

  // Delete a single orphaned user
  const deleteOrphanedUser = async (userId) => {
    if (!window.confirm(`Delete user ${userId}? This cannot be undone.`)) return;
    
    try {
      await deleteDoc(doc(db, 'users', userId));
      setOrphanedUsers(prev => prev.filter(u => u.id !== userId));
      showMessage('success', `Deleted user ${userId}`);
    } catch (err) {
      console.error('Failed to delete user:', err);
      showMessage('error', 'Failed to delete user');
    }
  };

  // Delete all orphaned users
  const deleteAllOrphanedUsers = async () => {
    if (!window.confirm(`Delete ALL ${orphanedUsers.length} orphaned users? This cannot be undone!`)) return;
    if (!window.confirm(`Are you REALLY sure? This will permanently delete ${orphanedUsers.length} user documents.`)) return;
    
    setLoading(true);
    try {
      let deleted = 0;
      for (const user of orphanedUsers) {
        await deleteDoc(doc(db, 'users', user.id));
        deleted++;
      }
      setOrphanedUsers([]);
      showMessage('success', `Deleted ${deleted} orphaned users`);
    } catch (err) {
      console.error('Failed to delete orphaned users:', err);
      showMessage('error', 'Failed to delete some users');
    }
    setLoading(false);
  };

  // Toggle user selection for deletion
  const toggleUserForDeletion = (userId) => {
    setSelectedForDeletion(prev => {
      const newSet = new Set(prev);
      if (newSet.has(userId)) {
        newSet.delete(userId);
      } else {
        newSet.add(userId);
      }
      return newSet;
    });
  };

  // Delete selected users
  const deleteSelectedUsers = async () => {
    if (selectedForDeletion.size === 0) {
      showMessage('error', 'No users selected for deletion');
      return;
    }
    
    // Calculate what's being deleted
    let totalCash = 0;
    let totalShares = 0;
    let totalValue = 0;
    let totalShortShares = 0;
    let totalShortCollateral = 0;
    const holdingsSummary = {};
    const shortsSummary = {};
    
    for (const userId of selectedForDeletion) {
      const user = allUsers.find(u => u.id === userId);
      if (!user) continue;
      
      totalCash += user.cash || 0;
      
      // Sum up holdings
      if (user.holdings) {
        Object.entries(user.holdings).forEach(([ticker, shares]) => {
          const shareCount = typeof shares === 'number' ? shares : (shares?.shares || 0);
          if (shareCount > 0) {
            totalShares += shareCount;
            holdingsSummary[ticker] = (holdingsSummary[ticker] || 0) + shareCount;
            const character = CHARACTERS.find(c => c.ticker === ticker);
            const price = prices[ticker] || character?.basePrice || 0;
            totalValue += shareCount * price;
          }
        });
      }
      
      // Sum up shorts
      if (user.shorts) {
        Object.entries(user.shorts).forEach(([ticker, position]) => {
          if (position && position.shares > 0) {
            totalShortShares += position.shares;
            totalShortCollateral += position.margin || 0;
            shortsSummary[ticker] = (shortsSummary[ticker] || 0) + position.shares;
          }
        });
      }
    }
    
    // Build summary message
    const topHoldings = Object.entries(holdingsSummary)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([ticker, shares]) => `${ticker}: ${shares}`)
      .join(', ');
    
    const topShorts = Object.entries(shortsSummary)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([ticker, shares]) => `${ticker}: ${shares}`)
      .join(', ');
    
    let summaryMsg = `DELETE ${selectedForDeletion.size} USERS?\n\n` +
      `💰 Total Cash: $${totalCash.toFixed(2)}\n` +
      `📊 Long Shares: ${totalShares}\n` +
      `💵 Long Value: $${totalValue.toFixed(2)}\n`;
    
    if (totalShortShares > 0) {
      summaryMsg += `🩳 Short Shares: ${totalShortShares}\n` +
        `🔒 Short Collateral: $${totalShortCollateral.toFixed(2)}\n`;
    }
    
    summaryMsg += `\n📈 Top Holdings: ${topHoldings || 'None'}`;
    if (topShorts) {
      summaryMsg += `\n📉 Top Shorts: ${topShorts}`;
    }
    summaryMsg += `\n\nThis cannot be undone!`;
    
    if (!window.confirm(summaryMsg)) return;
    if (!window.confirm(`FINAL CONFIRMATION: Permanently delete ${selectedForDeletion.size} user accounts?`)) return;
    
    setLoading(true);
    let deleted = 0;
    let failed = 0;
    const failedIds = [];
    
    for (const userId of selectedForDeletion) {
      // Don't allow deleting admin
      if (ADMIN_UIDS.includes(userId)) continue;
      
      try {
        await deleteDoc(doc(db, 'users', userId));
        deleted++;
      } catch (err) {
        console.error(`Failed to delete user ${userId}:`, err);
        failed++;
        failedIds.push(userId);
      }
    }
    
    // Remove successfully deleted users from lists
    const successfullyDeleted = new Set([...selectedForDeletion].filter(id => !failedIds.includes(id)));
    setAllUsers(prev => prev.filter(u => !successfullyDeleted.has(u.id)));
    setUserSearchResults(prev => prev.filter(u => !successfullyDeleted.has(u.id)));
    
    // Keep failed ones selected so user can retry
    if (failed > 0) {
      setSelectedForDeletion(new Set(failedIds));
      showMessage('error', `Deleted ${deleted}, but ${failed} failed. Check console for details. Failed IDs still selected.`);
    } else {
      setSelectedForDeletion(new Set());
      setDeleteMode(false);
      showMessage('success', `Deleted ${deleted} users. Removed $${totalCash.toFixed(2)} cash and ${totalShares} shares.`);
    }
    
    setLoading(false);
  };

  // Resolve prediction
  const handleResolvePrediction = async () => {
    if (!selectedPrediction || !selectedOutcome) {
      showMessage('error', 'Please select a prediction and winning option');
      return;
    }

    setLoading(true);
    try {
      const predictionsRef = doc(db, 'predictions', 'current');
      const snap = await getDoc(predictionsRef);
      const currentList = snap.exists() ? (snap.data().list || []) : [];

      const updatedList = currentList.map(p => {
        if (p.id === selectedPrediction.id) {
          return {
            ...p,
            resolved: true,
            outcome: selectedOutcome
          };
        }
        return p;
      });

      await updateDoc(predictionsRef, { list: updatedList });

      showMessage('success', `Resolved! Winner: "${selectedOutcome}"`);
      setSelectedPrediction(null);
      setSelectedOutcome('');
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to resolve prediction');
    }
    setLoading(false);
  };

  // Delete prediction
  const handleDeletePrediction = async (predictionId) => {
    if (!confirm('Are you sure you want to delete this prediction?')) return;

    setLoading(true);
    try {
      const predictionsRef = doc(db, 'predictions', 'current');
      const snap = await getDoc(predictionsRef);
      const currentList = snap.exists() ? (snap.data().list || []) : [];

      const updatedList = currentList.filter(p => p.id !== predictionId);

      await updateDoc(predictionsRef, { list: updatedList });

      showMessage('success', 'Prediction deleted');
      setSelectedPrediction(null);
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to delete prediction');
    }
    setLoading(false);
  };

  // Load all users for search
  const handleLoadAllUsers = async () => {
    setLoading(true);
    try {
      const usersRef = collection(db, 'users');
      const snapshot = await getDocs(usersRef);
      
      const users = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        users.push({
          id: doc.id,
          displayName: data.displayName || 'Unknown',
          cash: data.cash || 0,
          portfolioValue: data.portfolioValue || 0,
          holdings: data.holdings || {},
          shorts: data.shorts || {},
          bets: data.bets || {},
          totalTrades: data.totalTrades || 0,
          isAdmin: data.isAdmin || false,
          marginEnabled: data.marginEnabled || false,
          marginUsed: data.marginUsed || 0,
          activeLoan: data.activeLoan || null,
          transactionLog: data.transactionLog || [],
          costBasis: data.costBasis || {},
          peakPortfolioValue: data.peakPortfolioValue || 0,
          totalCheckins: data.totalCheckins || 0,
          crew: data.crew || null,
          lowestWhileHolding: data.lowestWhileHolding || {}
        });
      });
      
      // Sort by portfolio value
      users.sort((a, b) => b.portfolioValue - a.portfolioValue);
      setAllUsers(users);
      setUserSearchResults(users);
      showMessage('success', `Loaded ${users.length} users`);
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to load users');
    }
    setLoading(false);
  };

  // Recalculate portfolio values for all users
  const handleRecalculatePortfolios = async () => {
    if (!prices || Object.keys(prices).length === 0) {
      showMessage('error', 'No price data available');
      return;
    }
    
    setLoading(true);
    try {
      const usersRef = collection(db, 'users');
      const snapshot = await getDocs(usersRef);
      
      let updated = 0;
      
      for (const userDoc of snapshot.docs) {
        const userData = userDoc.data();
        const holdings = userData.holdings || {};
        const shorts = userData.shorts || {};
        const cash = userData.cash || 0;
        
        // Calculate holdings value
        let holdingsValue = 0;
        for (const [ticker, holdingData] of Object.entries(holdings)) {
          const currentPrice = prices[ticker] || 0;
          // Support both formats: { shares: 5 } or just 5
          const shares = typeof holdingData === 'number' ? holdingData : (holdingData.shares || 0);
          holdingsValue += currentPrice * shares;
        }
        
        // Calculate shorts value (collateral + P&L)
        let shortsValue = 0;
        for (const [ticker, position] of Object.entries(shorts)) {
          if (!position || position.shares <= 0) continue;
          const currentPrice = prices[ticker] || position.entryPrice;
          const collateral = position.margin || 0;
          // P&L = (entry price - current price) * shares (profit when price goes down)
          const pnl = (position.entryPrice - currentPrice) * position.shares;
          shortsValue += collateral + pnl;
          console.log(`${userData.displayName}: SHORT ${ticker} = ${position.shares} shares, entry $${position.entryPrice}, current $${currentPrice}, collateral $${collateral}, pnl $${pnl}`);
        }
        
        const newPortfolioValue = Math.round((cash + holdingsValue + shortsValue) * 100) / 100;
        
        console.log(`${userData.displayName}: cash=$${cash} + holdings=$${holdingsValue} + shorts=$${shortsValue} = $${newPortfolioValue} (was $${userData.portfolioValue})`);
        
        // Only update if different
        if (Math.abs(newPortfolioValue - (userData.portfolioValue || 0)) > 0.01) {
          await updateDoc(doc(db, 'users', userDoc.id), {
            portfolioValue: newPortfolioValue
          });
          console.log(`Updated ${userData.displayName}: ${userData.portfolioValue} -> ${newPortfolioValue}`);
          updated++;
        }
      }
      
      showMessage('success', `Recalculated ${updated} portfolios`);
      // Reload users to see updated values
      await handleLoadAllUsers();
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed to recalculate: ${err.message}`);
    }
    setLoading(false);
  };

  // Filter users by search query
  const handleUserSearch = (query) => {
    setUserSearchQuery(query);
    if (!query.trim()) {
      setUserSearchResults(allUsers);
      return;
    }
    
    const filtered = allUsers.filter(u => 
      u.displayName.toLowerCase().includes(query.toLowerCase()) ||
      u.id.toLowerCase().includes(query.toLowerCase())
    );
    setUserSearchResults(filtered);
  };

  // Scan all users for bets on a specific prediction ID
  const handleScanForBets = async () => {
    if (!recoveryPredictionId.trim()) {
      showMessage('error', 'Please enter a prediction ID (e.g., pred_1)');
      return;
    }

    setLoading(true);
    try {
      const usersRef = collection(db, 'users');
      const snapshot = await getDocs(usersRef);
      
      const bets = [];
      const optionsFound = new Set();
      
      snapshot.forEach(doc => {
        const userData = doc.data();
        const userBet = userData.bets?.[recoveryPredictionId.trim()];
        if (userBet) {
          bets.push({
            userId: doc.id,
            displayName: userData.displayName || 'Unknown',
            option: userBet.option,
            amount: userBet.amount,
            paid: userBet.paid || false,
            payout: userBet.payout || 0,
            cash: userData.cash || 0,
            predictionWins: userData.predictionWins || 0,
            achievements: userData.achievements || []
          });
          optionsFound.add(userBet.option);
        }
      });

      setRecoveryBets(bets);
      setRecoveryOptions(Array.from(optionsFound));
      
      if (bets.length === 0) {
        showMessage('error', `No bets found for prediction "${recoveryPredictionId}"`);
      } else {
        showMessage('success', `Found ${bets.length} bets across ${optionsFound.size} options`);
      }
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to scan users');
    }
    setLoading(false);
  };

  // Process payouts for recovered prediction
  const handleProcessRecovery = async (action) => {
    if (recoveryBets.length === 0) {
      showMessage('error', 'No bets to process');
      return;
    }

    if (action === 'payout' && !recoveryWinner) {
      showMessage('error', 'Please select a winning option');
      return;
    }

    const predId = recoveryPredictionId.trim();
    
    setLoading(true);
    try {
      // Calculate total pool and winning pool
      const totalPool = recoveryBets.reduce((sum, bet) => sum + bet.amount, 0);
      const winningPool = action === 'payout' 
        ? recoveryBets.filter(b => b.option === recoveryWinner).reduce((sum, bet) => sum + bet.amount, 0)
        : 0;

      console.log('Processing recovery:', { action, totalPool, winningPool, recoveryWinner, betsCount: recoveryBets.length });

      let processed = 0;
      
      for (const bet of recoveryBets) {
        if (bet.paid) {
          console.log('Skipping already paid bet:', bet.displayName);
          continue;
        }
        
        const userRef = doc(db, 'users', bet.userId);
        
        try {
          if (action === 'refund') {
            // Refund: give back original bet amount
            await updateDoc(userRef, {
              cash: bet.cash + bet.amount,
              [`bets.${predId}.paid`]: true,
              [`bets.${predId}.payout`]: bet.amount,
              [`bets.${predId}.refunded`]: true
            });
            console.log('Refunded:', bet.displayName, bet.amount);
            processed++;
          } else if (action === 'payout') {
            // Payout: winners split the pot
            if (bet.option === recoveryWinner && winningPool > 0) {
              const userShare = bet.amount / winningPool;
              const payout = Math.round(userShare * totalPool * 100) / 100;

              // Calculate new prediction wins and check for achievements
              const newPredictionWins = (bet.predictionWins || 0) + 1;
              const currentAchievements = bet.achievements || [];
              const newAchievements = [];

              if (newPredictionWins >= 3 && !currentAchievements.includes('ORACLE')) {
                newAchievements.push('ORACLE');
              }
              if (newPredictionWins >= 10 && !currentAchievements.includes('PROPHET')) {
                newAchievements.push('PROPHET');
              }

              const updateData = {
                cash: bet.cash + payout,
                [`bets.${predId}.paid`]: true,
                [`bets.${predId}.payout`]: payout,
                predictionWins: newPredictionWins
              };

              if (newAchievements.length > 0) {
                updateData.achievements = arrayUnion(...newAchievements);
              }

              await updateDoc(userRef, updateData);
              console.log('Paid winner:', bet.displayName, payout, 'wins:', newPredictionWins, newAchievements.length > 0 ? 'NEW ACHIEVEMENTS:' + newAchievements.join(',') : '');
            } else {
              // Losers get nothing but mark as paid
              await updateDoc(userRef, {
                [`bets.${predId}.paid`]: true,
                [`bets.${predId}.payout`]: 0
              });
              console.log('Marked loser as paid:', bet.displayName);
            }
            processed++;
          }
        } catch (userErr) {
          console.error('Error processing user:', bet.displayName, userErr);
        }
      }

      showMessage('success', `${action === 'refund' ? 'Refunded' : 'Paid out'} ${processed} users!`);
      setRecoveryBets([]);
      setRecoveryWinner('');
      setRecoveryOptions([]);
      setRecoveryPredictionId('');
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed to process: ${err.message}`);
    }
    setLoading(false);
  };

  // Check admin access
  if (!isAdmin) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
        <div className={`w-full max-w-md ${cardClass} border rounded-sm shadow-xl p-6 text-center`} onClick={e => e.stopPropagation()}>
          <p className="text-red-500 text-lg mb-4">🔒 Admin Access Required</p>
          <p className={mutedClass}>Your UID: <code className="text-xs bg-slate-700 px-2 py-1 rounded">{user?.uid || 'Not logged in'}</code></p>
          <p className={`text-xs ${mutedClass} mt-2`}>Add this UID to ADMIN_UIDS in AdminPanel.jsx</p>
          <button onClick={onClose} className="mt-4 px-4 py-2 bg-slate-600 text-white rounded-sm">Close</button>
        </div>
      </div>
    );
  }

  const unresolvedPredictions = predictions.filter(p => !p.resolved);

  // Sort characters by name for the dropdown
  const sortedCharacters = [...CHARACTERS].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className={`w-full max-w-2xl ${cardClass} border rounded-sm shadow-xl overflow-hidden max-h-[90vh] flex flex-col`}
        onClick={e => e.stopPropagation()}>
        
        {/* Header */}
        <div className={`p-4 border-b ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
          <div className="flex justify-between items-center">
            <h2 className={`text-lg font-semibold ${textClass}`}>🔧 Admin Panel</h2>
            <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-teal-600 text-xl`}>×</button>
          </div>
        </div>

        {/* Tabs - Responsive grid layout */}
        <div className={`grid grid-cols-3 md:grid-cols-6 border-b ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
          <button
            onClick={() => setActiveTab('prices')}
            className={`py-2.5 text-xs font-semibold transition-colors ${activeTab === 'prices' ? 'text-teal-500 border-b-2 border-teal-500 bg-teal-500/10' : `${mutedClass} hover:bg-slate-500/10`}`}
          >
            💰 Prices
          </button>
          <button
            onClick={() => { setActiveTab('ipo'); loadIPOs(); }}
            className={`py-2.5 text-xs font-semibold transition-colors ${activeTab === 'ipo' ? 'text-orange-500 border-b-2 border-orange-500 bg-orange-500/10' : `${mutedClass} hover:bg-slate-500/10`}`}
          >
            🚀 IPO
          </button>
          <button
            onClick={() => { setActiveTab('predictions'); loadAllBets(); }}
            className={`py-2.5 text-xs font-semibold transition-colors ${activeTab === 'predictions' ? 'text-purple-500 border-b-2 border-purple-500 bg-purple-500/10' : `${mutedClass} hover:bg-slate-500/10`}`}
          >
            🎲 Bets {unresolvedPredictions.length > 0 && `(${unresolvedPredictions.length})`}
          </button>
          <button
            onClick={() => setActiveTab('holders')}
            className={`py-2.5 text-xs font-semibold transition-colors ${activeTab === 'holders' ? 'text-blue-500 border-b-2 border-blue-500 bg-blue-500/10' : `${mutedClass} hover:bg-slate-500/10`}`}
          >
            📊 Holders
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`py-2.5 text-xs font-semibold transition-colors ${activeTab === 'users' ? 'text-green-500 border-b-2 border-green-500 bg-green-500/10' : `${mutedClass} hover:bg-slate-500/10`}`}
          >
            👥 Users
          </button>
          <button
            onClick={() => { setActiveTab('trades'); loadRecentTrades(tradeTimePeriod, tradeTypeFilter, tradeFilterTicker); }}
            className={`py-2.5 text-xs font-semibold transition-colors ${activeTab === 'trades' ? 'text-yellow-500 border-b-2 border-yellow-500 bg-yellow-500/10' : `${mutedClass} hover:bg-slate-500/10`}`}
          >
            💹 Trades
          </button>
          <button
            onClick={() => { setActiveTab('stats'); loadMarketStats(); }}
            className={`py-2.5 text-xs font-semibold transition-colors ${activeTab === 'stats' ? 'text-cyan-500 border-b-2 border-cyan-500 bg-cyan-500/10' : `${mutedClass} hover:bg-slate-500/10`}`}
          >
            📈 Stats
          </button>
          <button
            onClick={() => setActiveTab('recovery')}
            className={`py-2.5 text-xs font-semibold transition-colors ${activeTab === 'recovery' ? 'text-red-500 border-b-2 border-red-500 bg-red-500/10' : `${mutedClass} hover:bg-slate-500/10`}`}
          >
            🔧 Recovery
          </button>
        </div>

        {/* Message */}
        {message && (
          <div className={`mx-4 mt-4 p-3 rounded-sm text-sm font-semibold ${
            message.type === 'error' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
          }`}>
            {message.text}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          
          {/* PRICES TAB */}
          {activeTab === 'prices' && (
            <div className="space-y-4">
              <div className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-slate-100'}`}>
                <p className={`text-sm ${mutedClass} mb-2`}>
                  📊 Manually adjust character prices. Use this for story events (deaths, power-ups, etc.)
                </p>
              </div>

              <div>
                <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Select Character</label>
                <select
                  value={selectedTicker}
                  onChange={e => setSelectedTicker(e.target.value)}
                  className={`w-full px-3 py-2 border rounded-sm ${inputClass}`}
                >
                  <option value="">-- Select Character --</option>
                  {sortedCharacters.map(c => (
                    <option key={c.ticker} value={c.ticker}>
                      {c.name} (${c.ticker}) - Current: ${(prices[c.ticker] || c.basePrice).toFixed(2)}
                    </option>
                  ))}
                </select>
              </div>

              {selectedTicker && (
                <>
                  <div className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700' : 'bg-slate-200'}`}>
                    <div className="flex justify-between items-center">
                      <span className={textClass}>Current Price:</span>
                      <span className={`text-lg font-bold ${textClass}`}>
                        ${(prices[selectedTicker] || 0).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {/* Price History Viewer */}
                  <div className={`p-3 rounded-sm ${darkMode ? 'bg-blue-900/30 border border-blue-700' : 'bg-blue-50 border border-blue-300'}`}>
                    <div className="flex justify-between items-center mb-2">
                      <h4 className="font-semibold text-blue-500">📈 Price History</h4>
                      <button
                        onClick={async () => {
                          const history = await getPriceHistoryForTicker(selectedTicker);
                          setSelectedTickerHistory(history);
                        }}
                        className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-sm"
                      >
                        Load History
                      </button>
                    </div>
                    {selectedTickerHistory.length > 0 && (
                      <div className="max-h-48 overflow-y-auto space-y-1">
                        {selectedTickerHistory.slice().reverse().slice(0, 50).map((h, i) => {
                          const prevPrice = selectedTickerHistory.slice().reverse()[i + 1]?.price;
                          const change = prevPrice ? ((h.price - prevPrice) / prevPrice * 100) : 0;
                          return (
                            <div key={i} className={`text-xs flex justify-between items-center py-1 px-2 rounded ${darkMode ? 'bg-slate-800' : 'bg-white'}`}>
                              <span className={mutedClass}>{new Date(h.timestamp).toLocaleString()}</span>
                              <div className="flex items-center gap-2">
                                <span className={`font-semibold ${textClass}`}>${h.price.toFixed(2)}</span>
                                {change !== 0 && (
                                  <span className={`text-xs ${change > 0 ? 'text-green-500' : 'text-red-500'}`}>
                                    {change > 0 ? '+' : ''}{change.toFixed(1)}%
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {selectedTickerHistory.length === 0 && (
                      <p className={`text-xs ${mutedClass}`}>Click "Load History" to view price changes</p>
                    )}
                  </div>

                  <div>
                    <label className={`block text-xs font-semibold uppercase mb-2 ${mutedClass}`}>Adjustment Type</label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setAdjustmentType('set')}
                        className={`flex-1 py-2 text-sm font-semibold rounded-sm ${
                          adjustmentType === 'set' ? 'bg-teal-600 text-white' : darkMode ? 'bg-slate-700 text-slate-300' : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        Set Price
                      </button>
                      <button
                        onClick={() => setAdjustmentType('percent')}
                        className={`flex-1 py-2 text-sm font-semibold rounded-sm ${
                          adjustmentType === 'percent' ? 'bg-teal-600 text-white' : darkMode ? 'bg-slate-700 text-slate-300' : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        % Change
                      </button>
                    </div>
                  </div>

                  {adjustmentType === 'set' ? (
                    <div>
                      <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>New Price ($)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={newPrice}
                        onChange={e => setNewPrice(e.target.value)}
                        placeholder="Enter new price..."
                        className={`w-full px-3 py-2 border rounded-sm ${inputClass}`}
                      />
                    </div>
                  ) : (
                    <div>
                      <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Percentage Change</label>
                      <input
                        type="number"
                        step="1"
                        value={percentChange}
                        onChange={e => setPercentChange(e.target.value)}
                        placeholder="e.g. -20 for -20%, 50 for +50%"
                        className={`w-full px-3 py-2 border rounded-sm ${inputClass}`}
                      />
                      <div className="flex gap-2 mt-2">
                        {[-50, -25, -10, 10, 25, 50].map(pct => (
                          <button
                            key={pct}
                            onClick={() => setPercentChange(pct.toString())}
                            className={`flex-1 py-1.5 text-xs font-semibold rounded-sm ${
                              pct < 0 ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'
                            } text-white`}
                          >
                            {pct > 0 ? '+' : ''}{pct}%
                          </button>
                        ))}
                      </div>
                      {percentChange && (
                        <p className={`text-sm ${mutedClass} mt-2`}>
                          Preview: ${(prices[selectedTicker] || 0).toFixed(2)} → $
                          {(Math.round((prices[selectedTicker] || 0) * (1 + parseFloat(percentChange || 0) / 100) * 100) / 100).toFixed(2)}
                        </p>
                      )}
                    </div>
                  )}

                  <button
                    onClick={handlePriceAdjustment}
                    disabled={loading}
                    className="w-full py-3 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-sm disabled:opacity-50"
                  >
                    {loading ? 'Updating...' : '💰 Apply Price Change'}
                  </button>
                </>
              )}

              {/* TRADE HISTORY & ROLLBACK SECTION */}
              <div className={`mt-6 pt-6 border-t ${darkMode ? 'border-slate-600' : 'border-slate-300'}`}>
                <h3 className={`font-semibold ${textClass} mb-3`}>🔍 Trade History & Rollback</h3>

                {/* Ticker selector for investigation */}
                <div className="mb-3">
                  <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Investigate Ticker</label>
                  <div className="flex gap-2">
                    <select
                      value={tradeFilterTicker}
                      onChange={e => { setTradeFilterTicker(e.target.value); setSelectedTickerHistory([]); }}
                      className={`flex-1 px-3 py-2 border rounded-sm ${inputClass}`}
                    >
                      <option value="">-- Select Ticker --</option>
                      {sortedCharacters.map(c => (
                        <option key={c.ticker} value={c.ticker}>
                          {c.name} (${c.ticker}) - ${(prices[c.ticker] || c.basePrice).toFixed(2)}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={async () => {
                        if (tradeFilterTicker) {
                          const history = await getPriceHistoryForTicker(tradeFilterTicker);
                          setSelectedTickerHistory(history);
                        }
                      }}
                      disabled={!tradeFilterTicker}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-sm disabled:opacity-50"
                    >
                      Load History
                    </button>
                  </div>
                </div>

                {/* Price History Display */}
                {selectedTickerHistory.length > 0 && (
                  <div className={`p-3 rounded-sm mb-3 ${darkMode ? 'bg-slate-800' : 'bg-slate-100'}`}>
                    <div className="flex justify-between items-center mb-2">
                      <span className={`text-sm font-semibold ${textClass}`}>
                        ${tradeFilterTicker} Price History ({selectedTickerHistory.length} entries)
                      </span>
                      <span className={`text-xs ${mutedClass}`}>Click timestamp to set rollback point</span>
                    </div>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {selectedTickerHistory.slice().reverse().slice(0, 100).map((h, i, arr) => {
                        const prevPrice = arr[i + 1]?.price;
                        const change = prevPrice ? ((h.price - prevPrice) / prevPrice * 100) : 0;
                        return (
                          <div
                            key={i}
                            className={`text-xs flex justify-between items-center py-1.5 px-2 rounded cursor-pointer hover:bg-blue-500/20 ${darkMode ? 'bg-slate-700' : 'bg-white'}`}
                            onClick={() => setRollbackTimestamp(h.timestamp.toString())}
                          >
                            <span className={mutedClass}>{new Date(h.timestamp).toLocaleString()}</span>
                            <div className="flex items-center gap-3">
                              <span className={`font-semibold ${textClass}`}>${h.price.toFixed(2)}</span>
                              {change !== 0 && (
                                <span className={`font-semibold ${change > 0 ? 'text-green-500' : 'text-red-500'}`}>
                                  {change > 0 ? '+' : ''}{change.toFixed(1)}%
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Rollback Controls */}
                <div className={`p-3 rounded-sm ${darkMode ? 'bg-red-900/30 border border-red-700' : 'bg-red-50 border border-red-300'}`}>
                  <h4 className="font-semibold text-red-500 mb-2">⚠️ Rollback Trades</h4>
                  <p className={`text-xs ${mutedClass} mb-3`}>
                    This will reverse ALL trades after the selected timestamp and restore prices.
                  </p>

                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={rollbackTimestamp}
                      onChange={e => setRollbackTimestamp(e.target.value)}
                      placeholder="Timestamp (click history above)"
                      className={`flex-1 px-3 py-2 border rounded-sm text-sm ${inputClass}`}
                    />
                  </div>

                  {rollbackTimestamp && (
                    <p className={`text-sm ${textClass} mb-2`}>
                      Rollback to: <span className="text-orange-500 font-semibold">{new Date(parseInt(rollbackTimestamp)).toLocaleString()}</span>
                    </p>
                  )}

                  <label className={`flex items-center gap-2 text-sm ${textClass} mb-3`}>
                    <input
                      type="checkbox"
                      checked={rollbackConfirm}
                      onChange={e => setRollbackConfirm(e.target.checked)}
                      className="w-4 h-4"
                    />
                    I understand this will reverse ALL trades and cannot be undone
                  </label>

                  <button
                    onClick={() => {
                      if (rollbackTimestamp && rollbackConfirm) {
                        executeFullRollback(parseInt(rollbackTimestamp));
                      }
                    }}
                    disabled={loading || !rollbackTimestamp || !rollbackConfirm}
                    className="w-full py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-sm disabled:opacity-50"
                  >
                    {loading ? 'Rolling back...' : '⚠️ Execute Full Rollback'}
                  </button>
                </div>

                {/* Quick Price Fix */}
                <div className={`p-3 rounded-sm mt-3 ${darkMode ? 'bg-orange-900/30 border border-orange-700' : 'bg-orange-50 border border-orange-300'}`}>
                  <h4 className="font-semibold text-orange-500 mb-2">⚡ Quick Price Fix (No Trade Reversal)</h4>
                  <p className={`text-xs ${mutedClass} mb-2`}>
                    Just set a price without reversing trades.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={tradeFilterTicker}
                      onChange={e => setTradeFilterTicker(e.target.value.toUpperCase())}
                      placeholder="Ticker"
                      className={`w-24 px-3 py-2 border rounded-sm ${inputClass}`}
                    />
                    <input
                      type="number"
                      step="0.01"
                      value={newPrice}
                      onChange={e => setNewPrice(e.target.value)}
                      placeholder="New Price"
                      className={`flex-1 px-3 py-2 border rounded-sm ${inputClass}`}
                    />
                    <button
                      onClick={() => {
                        if (tradeFilterTicker && newPrice) {
                          rollbackPrice(tradeFilterTicker, parseFloat(newPrice));
                        }
                      }}
                      disabled={loading || !tradeFilterTicker || !newPrice}
                      className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-sm disabled:opacity-50"
                    >
                      Set
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* IPO TAB */}
          {activeTab === 'ipo' && (
            <div className="space-y-4">
              <div className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-orange-50'}`}>
                <p className={`text-sm ${mutedClass}`}>
                  🚀 <strong>IPO System:</strong> Create limited-time offerings for new characters.
                  <br />• Hype Phase (24h default): Announcement only, no buying
                  <br />• IPO Window (24h default): 150 shares available, max 10 per user
                  <br />• After IPO: Price jumps 30%, normal trading begins
                </p>
              </div>

              {/* Create IPO Form */}
              <div className={`p-4 rounded-sm border ${darkMode ? 'border-slate-600' : 'border-slate-200'}`}>
                <h3 className={`font-semibold ${textClass} mb-3`}>Create New IPO</h3>
                
                <div className="space-y-3">
                  <div>
                    <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Character</label>
                    <select
                      value={ipoTicker}
                      onChange={e => setIpoTicker(e.target.value)}
                      className={`w-full px-3 py-2 border rounded-sm ${inputClass}`}
                    >
                      <option value="">Select character...</option>
                      {ipoEligibleCharacters.length === 0 ? (
                        <option disabled>No characters need IPO (add ipoRequired: true to characters.js)</option>
                      ) : (
                        ipoEligibleCharacters.map(c => (
                          <option key={c.ticker} value={c.ticker}>
                            ${c.ticker} - {c.name} (Base: ${c.basePrice})
                          </option>
                        ))
                      )}
                    </select>
                    {ipoEligibleCharacters.length === 0 && (
                      <p className={`text-xs ${mutedClass} mt-1`}>
                        💡 To add a new character for IPO, add them to characters.js with <code className="bg-slate-700 px-1 rounded">ipoRequired: true</code>
                      </p>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Hype Phase (hours)</label>
                      <input
                        type="number"
                        value={ipoHoursUntilStart}
                        onChange={e => setIpoHoursUntilStart(Math.max(0, parseInt(e.target.value) || 0))}
                        min="0"
                        className={`w-full px-3 py-2 border rounded-sm ${inputClass}`}
                      />
                      <p className={`text-xs ${mutedClass} mt-1`}>0 = IPO starts immediately</p>
                    </div>
                    <div>
                      <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>IPO Duration (hours)</label>
                      <input
                        type="number"
                        value={ipoDurationHours}
                        onChange={e => setIpoDurationHours(Math.max(1, parseInt(e.target.value) || 24))}
                        min="1"
                        className={`w-full px-3 py-2 border rounded-sm ${inputClass}`}
                      />
                    </div>
                  </div>
                  
                  {ipoTicker && (
                    <div className={`p-3 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-slate-100'}`}>
                      <p className={`text-sm ${textClass}`}>
                        <strong>${ipoTicker}</strong> IPO will:
                      </p>
                      <ul className={`text-xs ${mutedClass} mt-1 space-y-1`}>
                        <li>• Hype phase: {ipoHoursUntilStart}h (announcement)</li>
                        <li>• IPO buying: {ipoDurationHours}h</li>
                        <li>• 150 shares at ${CHARACTERS.find(c => c.ticker === ipoTicker)?.basePrice}</li>
                        <li>• After IPO: +30% price jump</li>
                      </ul>
                    </div>
                  )}
                  
                  <button
                    onClick={handleCreateIPO}
                    disabled={loading || !ipoTicker}
                    className="w-full py-3 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-sm disabled:opacity-50"
                  >
                    {loading ? 'Creating...' : '🚀 Create IPO'}
                  </button>
                </div>
              </div>

              {/* Active IPOs */}
              <div>
                <h3 className={`font-semibold ${textClass} mb-3`}>Active IPOs ({activeIPOs.filter(i => !i.priceJumped).length})</h3>
                
                {activeIPOs.filter(i => !i.priceJumped).length === 0 ? (
                  <p className={`text-sm ${mutedClass}`}>No active IPOs</p>
                ) : (
                  <div className="space-y-2">
                    {activeIPOs.filter(i => !i.priceJumped).map(ipo => {
                      const character = CHARACTERS.find(c => c.ticker === ipo.ticker);
                      const now = Date.now();
                      const inHypePhase = now < ipo.ipoStartsAt;
                      const inBuyingPhase = now >= ipo.ipoStartsAt && now < ipo.ipoEndsAt;
                      const timeUntilStart = ipo.ipoStartsAt - now;
                      const timeUntilEnd = ipo.ipoEndsAt - now;
                      
                      const formatTime = (ms) => {
                        if (ms <= 0) return 'Now';
                        const hours = Math.floor(ms / (1000 * 60 * 60));
                        const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
                        return `${hours}h ${mins}m`;
                      };
                      
                      return (
                        <div key={ipo.ticker} className={`p-3 rounded-sm border ${
                          inBuyingPhase ? 'border-green-500 bg-green-900/20' : 
                          inHypePhase ? 'border-orange-500 bg-orange-900/20' : 
                          'border-slate-600'
                        }`}>
                          <div className="flex justify-between items-start">
                            <div>
                              <span className={`font-bold ${textClass}`}>${ipo.ticker}</span>
                              <span className={`text-sm ${mutedClass} ml-2`}>{character?.name}</span>
                              <div className={`text-xs mt-1 ${
                                inBuyingPhase ? 'text-green-400' : 
                                inHypePhase ? 'text-orange-400' : mutedClass
                              }`}>
                                {inHypePhase ? `🔥 Hype Phase - IPO starts in ${formatTime(timeUntilStart)}` :
                                 inBuyingPhase ? `📈 LIVE - ${ipo.sharesRemaining || 150}/150 left - Ends in ${formatTime(timeUntilEnd)}` :
                                 '✓ Completed'}
                              </div>
                            </div>
                            <button
                              onClick={() => handleCancelIPO(ipo.ticker)}
                              disabled={loading}
                              className="px-2 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded-sm disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Past IPOs */}
              {activeIPOs.filter(i => i.priceJumped).length > 0 && (
                <div>
                  <h3 className={`font-semibold ${textClass} mb-3`}>Completed IPOs</h3>
                  <div className="space-y-1">
                    {activeIPOs.filter(i => i.priceJumped).slice(-5).map(ipo => (
                      <div key={ipo.ticker} className={`p-2 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-slate-100'}`}>
                        <span className={`text-sm ${textClass}`}>${ipo.ticker}</span>
                        <span className={`text-xs ${mutedClass} ml-2`}>
                          Sold {150 - (ipo.sharesRemaining || 0)} shares
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* PREDICTIONS TAB (Consolidated: Create + Resolve + View All + Bets) */}
          {activeTab === 'predictions' && (
            <div className="space-y-6">

              {/* SECTION 1: Resolve Pending Predictions */}
              {unresolvedPredictions.length > 0 && (
                <div className={`p-4 rounded-sm border-2 border-amber-500 ${darkMode ? 'bg-amber-900/20' : 'bg-amber-50'}`}>
                  <h3 className={`font-semibold text-amber-500 mb-3`}>⏳ Pending Resolution ({unresolvedPredictions.length})</h3>
                  <div className="space-y-2 mb-3">
                    {unresolvedPredictions.map(p => (
                      <button
                        key={p.id}
                        onClick={() => { setSelectedPrediction(p); setSelectedOutcome(''); }}
                        className={`w-full p-3 text-left rounded-sm border transition-all ${
                          selectedPrediction?.id === p.id
                            ? 'border-teal-500 bg-teal-500/10'
                            : darkMode ? 'border-slate-600 hover:border-slate-500' : 'border-slate-300 hover:border-slate-400'
                        }`}
                      >
                        <div className={`font-semibold ${textClass}`}>{p.question}</div>
                        <div className={`text-xs ${mutedClass} mt-1`}>
                          {p.options.join(' • ')} | Pool: ${Object.values(p.pools || {}).reduce((a, b) => a + b, 0).toFixed(0)}
                        </div>
                      </button>
                    ))}
                  </div>

                  {selectedPrediction && (
                    <>
                      <label className={`block text-xs font-semibold uppercase mb-2 ${mutedClass}`}>Select Winner</label>
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        {selectedPrediction.options.map(opt => (
                          <button
                            key={opt}
                            onClick={() => setSelectedOutcome(opt)}
                            className={`p-3 rounded-sm border-2 font-semibold transition-all ${
                              selectedOutcome === opt
                                ? 'border-green-500 bg-green-500 text-white'
                                : darkMode ? 'border-slate-600 text-slate-300 hover:border-green-500' : 'border-slate-300 hover:border-green-500'
                            }`}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>

                      {selectedOutcome && (
                        <button
                          onClick={handleResolvePrediction}
                          disabled={loading}
                          className="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-sm disabled:opacity-50"
                        >
                          {loading ? 'Resolving...' : `✅ Confirm Winner: "${selectedOutcome}"`}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* SECTION 2: Create New Prediction */}
              <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-slate-50'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                <h3 className={`font-semibold ${textClass} mb-3`}>➕ Create New Prediction</h3>
                <div className="space-y-3">
                  <div>
                    <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Question</label>
                    <input
                      type="text"
                      value={question}
                      onChange={e => setQuestion(e.target.value)}
                      placeholder=""
                      className={`w-full px-3 py-2 border rounded-sm ${inputClass}`}
                    />
                  </div>

                  <div>
                    <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Options (2-6)</label>
                    <div className="space-y-2">
                      {options.map((opt, idx) => (
                        <input
                          key={idx}
                          type="text"
                          value={opt}
                          onChange={e => {
                            const newOpts = [...options];
                            newOpts[idx] = e.target.value;
                            setOptions(newOpts);
                          }}
                          placeholder={idx < 2 ? `Option ${idx + 1} (required)` : `Option ${idx + 1} (optional)`}
                          className={`w-full px-3 py-2 border rounded-sm ${inputClass}`}
                        />
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Days Until Betting Ends</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min="1"
                        max="14"
                        value={daysUntilEnd}
                        onChange={e => setDaysUntilEnd(parseInt(e.target.value))}
                        className="flex-1"
                      />
                      <span className={`text-lg font-semibold ${textClass} w-20`}>{daysUntilEnd} days</span>
                    </div>
                    <p className={`text-xs ${mutedClass} mt-1`}>
                      Ends: {endDate.toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}
                    </p>
                  </div>

                  <button
                    onClick={handleCreatePrediction}
                    disabled={loading}
                    className="w-full py-3 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-sm disabled:opacity-50"
                  >
                    {loading ? 'Creating...' : '➕ Create Prediction'}
                  </button>
                </div>
              </div>

              {/* SECTION 3: All Predictions List */}
              <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                <div className="flex justify-between items-center mb-3">
                  <h3 className={`font-semibold ${textClass}`}>📋 All Predictions ({predictions.length})</h3>
                  <button
                    onClick={loadAllBets}
                    disabled={betsLoading}
                    className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded-sm disabled:opacity-50"
                  >
                    {betsLoading ? '...' : '🔄 Refresh Bets'}
                  </button>
                </div>

                {predictions.length === 0 ? (
                  <p className={`text-center py-4 ${mutedClass}`}>No predictions yet</p>
                ) : (
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {predictions.map(p => (
                      <div key={p.id} className={`p-3 rounded-sm border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-semibold ${p.resolved ? 'text-green-500' : 'text-amber-500'}`}>
                                {p.resolved ? '✅ Resolved' : '⏳ Active'}
                              </span>
                            </div>
                            <div className={`font-semibold ${textClass} mt-1`}>{p.question}</div>
                            <div className={`text-xs ${mutedClass} mt-1`}>
                              Options: {p.options.join(', ')}
                            </div>
                            {p.resolved && (
                              <div className="text-xs text-green-500 mt-1">Winner: {p.outcome}</div>
                            )}
                            <div className={`text-xs ${mutedClass} mt-1`}>
                              Pool: ${Object.values(p.pools || {}).reduce((a, b) => a + b, 0).toFixed(0)}
                            </div>
                          </div>
                          <button
                            onClick={() => handleDeletePrediction(p.id)}
                            disabled={loading}
                            className="px-3 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded-sm"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* SECTION 4: Bets Summary */}
              {allBets.length > 0 && (
                <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                  <h3 className={`font-semibold ${textClass} mb-3`}>🎲 Bets Summary ({allBets.length} total bets)</h3>
                  <div className="space-y-3 max-h-64 overflow-y-auto">
                    {(() => {
                      const byPrediction = {};
                      allBets.forEach(bet => {
                        if (!byPrediction[bet.predictionId]) {
                          byPrediction[bet.predictionId] = {
                            question: bet.question,
                            totalAmount: 0,
                            betCount: 0,
                            byOption: {}
                          };
                        }
                        byPrediction[bet.predictionId].totalAmount += bet.amount;
                        byPrediction[bet.predictionId].betCount += 1;
                        if (!byPrediction[bet.predictionId].byOption[bet.option]) {
                          byPrediction[bet.predictionId].byOption[bet.option] = 0;
                        }
                        byPrediction[bet.predictionId].byOption[bet.option] += bet.amount;
                      });

                      return Object.entries(byPrediction).map(([predId, data]) => (
                        <div key={predId} className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700' : 'bg-slate-50'}`}>
                          <div className={`font-semibold ${textClass} text-sm`}>{data.question}</div>
                          <div className={`text-xs ${mutedClass} mt-1`}>
                            {data.betCount} bets • Total: ${data.totalAmount.toFixed(0)}
                          </div>
                          <div className="flex flex-wrap gap-2 mt-2">
                            {Object.entries(data.byOption).map(([opt, amt]) => (
                              <span key={opt} className={`text-xs px-2 py-1 rounded ${darkMode ? 'bg-slate-600' : 'bg-slate-200'}`}>
                                {opt}: ${amt.toFixed(0)}
                              </span>
                            ))}
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* HOLDERS TAB */}
          {activeTab === 'holders' && (
            <div className="space-y-4">
              <div className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-purple-50'}`}>
                <p className={`text-sm ${mutedClass}`}>
                  📊 View all users who hold shares of a specific character.
                </p>
              </div>

              <div>
                <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Select Character</label>
                <select
                  value={holdersTicker}
                  onChange={e => {
                    setHoldersTicker(e.target.value);
                    loadHolders(e.target.value);
                  }}
                  className={`w-full px-3 py-2 border rounded-sm ${inputClass}`}
                >
                  <option value="">Select character...</option>
                  {CHARACTERS.map(c => (
                    <option key={c.ticker} value={c.ticker}>
                      ${c.ticker} - {c.name}
                    </option>
                  ))}
                </select>
              </div>

              {holdersTicker && (
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <h3 className={`font-semibold ${textClass}`}>
                      ${holdersTicker} Holders ({holdersData.length})
                    </h3>
                    <button
                      onClick={() => loadHolders(holdersTicker)}
                      disabled={holdersLoading}
                      className="px-3 py-1 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded-sm disabled:opacity-50"
                    >
                      {holdersLoading ? '...' : '🔄 Refresh'}
                    </button>
                  </div>

                  {holdersLoading ? (
                    <p className={`text-center py-4 ${mutedClass}`}>Loading holders...</p>
                  ) : holdersData.length === 0 ? (
                    <p className={`text-center py-4 ${mutedClass}`}>No one holds ${holdersTicker}</p>
                  ) : (
                    <>
                      {/* Summary */}
                      <div className={`p-3 rounded-sm mb-3 ${darkMode ? 'bg-slate-800' : 'bg-slate-100'}`}>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div>
                            <p className={`text-xs ${mutedClass}`}>Holders</p>
                            <p className={`font-bold ${textClass}`}>{holdersData.length}</p>
                          </div>
                          <div>
                            <p className={`text-xs ${mutedClass}`}>Total Shares</p>
                            <p className={`font-bold ${textClass}`}>
                              {holdersData.reduce((sum, h) => sum + h.shares, 0)}
                            </p>
                          </div>
                          <div>
                            <p className={`text-xs ${mutedClass}`}>Total Value</p>
                            <p className={`font-bold text-green-500`}>
                              ${holdersData.reduce((sum, h) => sum + h.value, 0).toFixed(2)}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Holders List */}
                      <div className="space-y-1 max-h-80 overflow-y-auto">
                        {holdersData.map((holder, idx) => (
                          <div 
                            key={holder.userId}
                            className={`p-2 rounded-sm flex justify-between items-center ${
                              darkMode ? 'bg-slate-800 hover:bg-slate-700' : 'bg-white hover:bg-slate-50'
                            } ${idx === 0 ? 'border-2 border-yellow-500' : ''}`}
                          >
                            <div>
                              <span className={`font-semibold ${textClass}`}>
                                {idx === 0 && '👑 '}{holder.displayName}
                              </span>
                              {holder.costBasis && (
                                <span className={`text-xs ${mutedClass} ml-2`}>
                                  (avg: ${holder.costBasis.toFixed(2)})
                                </span>
                              )}
                            </div>
                            <div className="text-right">
                              <span className={`font-bold ${textClass}`}>{holder.shares}</span>
                              <span className={`text-xs ${mutedClass} ml-1`}>shares</span>
                              <p className={`text-xs text-green-500`}>${holder.value.toFixed(2)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* USERS TAB */}
          {activeTab === 'users' && (
            <div className="space-y-4">
              <div className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-slate-100'}`}>
                <p className={`text-sm ${mutedClass}`}>
                  👥 Browse, search, and manage users. Click "Load" to fetch all users.
                </p>
              </div>

              <div className="flex gap-2 flex-wrap">
                <input
                  type="text"
                  value={userSearchQuery}
                  onChange={e => { handleUserSearch(e.target.value); setUsersPage(0); }}
                  placeholder="Search by name or ID..."
                  className={`flex-1 min-w-[150px] px-3 py-2 border rounded-sm ${inputClass}`}
                />
                <button
                  onClick={handleLoadAllUsers}
                  disabled={loading}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-sm disabled:opacity-50"
                >
                  {loading ? '...' : '🔄 Load'}
                </button>
                <button
                  onClick={handleRecalculatePortfolios}
                  disabled={loading}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-sm disabled:opacity-50"
                  title="Recalculate all portfolio values based on current prices"
                >
                  {loading ? '...' : '📊 Recalc'}
                </button>
                <button
                  onClick={() => { setDeleteMode(!deleteMode); setSelectedForDeletion(new Set()); }}
                  className={`px-4 py-2 font-semibold rounded-sm ${
                    deleteMode 
                      ? 'bg-red-600 hover:bg-red-700 text-white' 
                      : darkMode ? 'bg-slate-600 hover:bg-slate-500 text-white' : 'bg-slate-300 hover:bg-slate-400 text-slate-700'
                  }`}
                >
                  {deleteMode ? '✕ Cancel' : '🗑️ Delete Mode'}
                </button>
              </div>

              {/* Delete Mode Controls */}
              {deleteMode && (
                <div className={`p-3 rounded-sm border-2 border-red-500 ${darkMode ? 'bg-red-900/20' : 'bg-red-50'}`}>
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="text-red-500 font-semibold">Delete Mode Active</span>
                      <span className={`ml-2 ${mutedClass}`}>
                        {selectedForDeletion.size} selected
                      </span>
                    </div>
                    <button
                      onClick={deleteSelectedUsers}
                      disabled={loading || selectedForDeletion.size === 0}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-sm disabled:opacity-50"
                    >
                      {loading ? '...' : `🗑️ Delete ${selectedForDeletion.size} Users`}
                    </button>
                  </div>
                  
                  {/* Live selection summary */}
                  {selectedForDeletion.size > 0 && (() => {
                    let totalCash = 0;
                    let totalShares = 0;
                    let totalValue = 0;
                    let totalShortShares = 0;
                    let totalShortValue = 0;
                    
                    for (const userId of selectedForDeletion) {
                      const user = allUsers.find(u => u.id === userId);
                      if (!user) continue;
                      totalCash += user.cash || 0;
                      
                      // Count long holdings
                      if (user.holdings && Object.keys(user.holdings).length > 0) {
                        Object.entries(user.holdings).forEach(([ticker, shares]) => {
                          const shareCount = typeof shares === 'number' ? shares : (shares?.shares || 0);
                          if (shareCount > 0) {
                            totalShares += shareCount;
                            const character = CHARACTERS.find(c => c.ticker === ticker);
                            const price = prices[ticker] || character?.basePrice || 0;
                            totalValue += shareCount * price;
                          }
                        });
                      }
                      
                      // Count short positions
                      if (user.shorts && Object.keys(user.shorts).length > 0) {
                        Object.entries(user.shorts).forEach(([ticker, position]) => {
                          if (position && position.shares > 0) {
                            totalShortShares += position.shares;
                            totalShortValue += position.margin || 0;
                          }
                        });
                      }
                    }
                    
                    return (
                      <div className={`mt-2 pt-2 border-t ${darkMode ? 'border-red-800' : 'border-red-300'} text-xs`}>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <span className={mutedClass}>Cash: </span>
                            <span className="text-green-500 font-semibold">${totalCash.toFixed(2)}</span>
                          </div>
                          <div>
                            <span className={mutedClass}>Shares: </span>
                            <span className={`font-semibold ${textClass}`}>{totalShares}</span>
                          </div>
                          <div>
                            <span className={mutedClass}>Value: </span>
                            <span className="text-cyan-500 font-semibold">${totalValue.toFixed(2)}</span>
                          </div>
                        </div>
                        {totalShortShares > 0 && (
                          <div className="grid grid-cols-3 gap-2 mt-1">
                            <div>
                              <span className={mutedClass}>Shorts: </span>
                              <span className="text-orange-500 font-semibold">{totalShortShares}</span>
                            </div>
                            <div>
                              <span className={mutedClass}>Collateral: </span>
                              <span className="text-orange-500 font-semibold">${totalShortValue.toFixed(2)}</span>
                            </div>
                            <div></div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  
                  <p className={`text-xs ${mutedClass} mt-2`}>
                    Click on users to select them for deletion. Admin accounts cannot be deleted.
                  </p>
                </div>
              )}

              {allUsers.length > 0 && (
                <div className={`text-xs ${mutedClass}`}>
                  Showing {Math.min(usersPage * USERS_PER_PAGE + 1, userSearchResults.length)}-{Math.min((usersPage + 1) * USERS_PER_PAGE, userSearchResults.length)} of {userSearchResults.length} users
                  {userSearchQuery && ` (filtered from ${allUsers.length})`}
                </div>
              )}

              {/* Selected User Detail */}
              {selectedUser && !deleteMode && (
                <div className={`p-4 rounded-sm border-2 border-teal-500 ${darkMode ? 'bg-slate-700' : 'bg-teal-50'}`}>
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h3 className={`font-bold text-lg ${textClass}`}>{selectedUser.displayName}</h3>
                      <p className={`text-xs ${mutedClass} font-mono`}>{selectedUser.id}</p>
                    </div>
                    <button 
                      onClick={() => setSelectedUser(null)}
                      className={`text-xl ${mutedClass} hover:text-red-500`}
                    >×</button>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className={`p-2 rounded ${darkMode ? 'bg-slate-600' : 'bg-white'}`}>
                      <div className={`text-xs ${mutedClass}`}>Cash</div>
                      <div className={`font-bold text-green-500`}>${selectedUser.cash.toFixed(2)}</div>
                    </div>
                    <div className={`p-2 rounded ${darkMode ? 'bg-slate-600' : 'bg-white'}`}>
                      <div className={`text-xs ${mutedClass}`}>Portfolio</div>
                      <div className={`font-bold ${textClass}`}>${selectedUser.portfolioValue.toFixed(2)}</div>
                    </div>
                    <div className={`p-2 rounded ${darkMode ? 'bg-slate-600' : 'bg-white'}`}>
                      <div className={`text-xs ${mutedClass}`}>Peak Value</div>
                      <div className={`font-bold text-cyan-500`}>${(selectedUser.peakPortfolioValue || 0).toFixed(2)}</div>
                    </div>
                    <div className={`p-2 rounded ${darkMode ? 'bg-slate-600' : 'bg-white'}`}>
                      <div className={`text-xs ${mutedClass}`}>Total P&L</div>
                      <div className={`font-bold ${selectedUser.portfolioValue >= 1000 ? 'text-green-500' : 'text-red-500'}`}>
                        {selectedUser.portfolioValue >= 1000 ? '+' : ''}${(selectedUser.portfolioValue - 1000).toFixed(2)}
                      </div>
                    </div>
                  </div>

                  {/* Financial Breakdown */}
                  {(() => {
                    const txLog = selectedUser.transactionLog || [];

                    // Calculate profit sources
                    let tradingProfit = 0;
                    let betProfit = 0;
                    let checkinBonus = 0;
                    let totalTrades = 0;
                    let profitableTrades = 0;
                    let totalBets = 0;
                    let wonBets = 0;

                    txLog.forEach(tx => {
                      if (tx.type === 'SELL') {
                        totalTrades++;
                        const profit = (tx.totalRevenue || 0) - (tx.totalCost || 0);
                        tradingProfit += profit;
                        if (profit > 0) profitableTrades++;
                      }
                      if (tx.type === 'SHORT_CLOSE') {
                        totalTrades++;
                        const profit = tx.totalProfit || 0;
                        tradingProfit += profit;
                        if (profit > 0) profitableTrades++;
                      }
                      if (tx.type === 'CHECKIN') {
                        checkinBonus += tx.bonus || 0;
                      }
                      if (tx.type === 'BET') {
                        totalBets++;
                      }
                    });

                    // Count bet wins from bets object
                    Object.values(selectedUser.bets || {}).forEach(bet => {
                      if (bet.paid && bet.payout > 0) {
                        betProfit += (bet.payout - bet.amount);
                        wonBets++;
                      } else if (bet.paid) {
                        betProfit -= bet.amount;
                      }
                    });

                    const holdingsValue = Object.entries(selectedUser.holdings || {}).reduce((sum, [ticker, shares]) => {
                      const shareCount = typeof shares === 'number' ? shares : (shares?.shares || 0);
                      return sum + (prices[ticker] || 0) * shareCount;
                    }, 0);

                    const totalCostBasis = Object.entries(selectedUser.costBasis || {}).reduce((sum, [ticker, cost]) => {
                      const shareCount = typeof selectedUser.holdings[ticker] === 'number' ? selectedUser.holdings[ticker] : (selectedUser.holdings[ticker]?.shares || 0);
                      if (shareCount > 0) return sum + cost;
                      return sum;
                    }, 0);

                    const unrealizedGains = holdingsValue - totalCostBasis;

                    return (
                      <div className={`p-3 rounded mb-4 ${darkMode ? 'bg-slate-600' : 'bg-white'}`}>
                        <h4 className={`text-xs font-semibold uppercase ${mutedClass} mb-3`}>💰 Money Breakdown</h4>

                        <div className="space-y-2 text-sm">
                          {/* Trading Stats */}
                          <div className="flex justify-between">
                            <span className={mutedClass}>Trading Realized P&L:</span>
                            <span className={`font-bold ${tradingProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                              {tradingProfit >= 0 ? '+' : ''}${tradingProfit.toFixed(2)}
                            </span>
                          </div>
                          {totalTrades > 0 && (
                            <div className="flex justify-between pl-4">
                              <span className={`text-xs ${mutedClass}`}>
                                {totalTrades} trades • {profitableTrades} wins ({((profitableTrades / totalTrades) * 100).toFixed(0)}%)
                              </span>
                              <span className={`text-xs ${mutedClass}`}>
                                avg: ${(tradingProfit / totalTrades).toFixed(2)}/trade
                              </span>
                            </div>
                          )}

                          {/* Unrealized Gains */}
                          <div className="flex justify-between">
                            <span className={mutedClass}>Holdings Unrealized:</span>
                            <span className={`font-bold ${unrealizedGains >= 0 ? 'text-cyan-500' : 'text-orange-500'}`}>
                              {unrealizedGains >= 0 ? '+' : ''}${unrealizedGains.toFixed(2)}
                            </span>
                          </div>
                          <div className="flex justify-between pl-4">
                            <span className={`text-xs ${mutedClass}`}>
                              Cost basis: ${totalCostBasis.toFixed(2)} → Value: ${holdingsValue.toFixed(2)}
                            </span>
                          </div>

                          {/* Betting */}
                          {totalBets > 0 && (
                            <>
                              <div className="flex justify-between">
                                <span className={mutedClass}>Betting Net:</span>
                                <span className={`font-bold ${betProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                  {betProfit >= 0 ? '+' : ''}${betProfit.toFixed(2)}
                                </span>
                              </div>
                              <div className="flex justify-between pl-4">
                                <span className={`text-xs ${mutedClass}`}>
                                  {wonBets}/{totalBets} bets won ({totalBets > 0 ? ((wonBets / totalBets) * 100).toFixed(0) : 0}%)
                                </span>
                              </div>
                            </>
                          )}

                          {/* Check-ins */}
                          {checkinBonus > 0 && (
                            <div className="flex justify-between">
                              <span className={mutedClass}>Check-in Bonuses:</span>
                              <span className="font-bold text-blue-500">+${checkinBonus.toFixed(2)}</span>
                            </div>
                          )}

                          {/* Total */}
                          <div className={`flex justify-between pt-2 border-t ${darkMode ? 'border-slate-500' : 'border-slate-300'}`}>
                            <span className={`font-semibold ${textClass}`}>Total Income:</span>
                            <span className={`font-bold ${(tradingProfit + betProfit + checkinBonus) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                              {(tradingProfit + betProfit + checkinBonus) >= 0 ? '+' : ''}${(tradingProfit + betProfit + checkinBonus).toFixed(2)}
                            </span>
                          </div>

                          {/* Activity Stats */}
                          <div className={`pt-2 border-t ${darkMode ? 'border-slate-500' : 'border-slate-300'}`}>
                            <div className="flex justify-between text-xs">
                              <span className={mutedClass}>Total Trades:</span>
                              <span className={textClass}>{selectedUser.totalTrades || 0}</span>
                            </div>
                            <div className="flex justify-between text-xs">
                              <span className={mutedClass}>Check-ins:</span>
                              <span className={textClass}>{selectedUser.totalCheckins || 0}</span>
                            </div>
                            <div className="flex justify-between text-xs">
                              <span className={mutedClass}>Crew:</span>
                              <span className={textClass}>{selectedUser.crew || 'None'}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Margin/Loan Info */}
                  {(selectedUser.marginEnabled || selectedUser.activeLoan) && (
                    <div className={`p-2 rounded mb-4 ${darkMode ? 'bg-amber-900/30' : 'bg-amber-50'}`}>
                      <h4 className={`text-xs font-semibold uppercase text-amber-500 mb-2`}>Debt Info</h4>
                      {selectedUser.marginEnabled && (
                        <div className="text-sm flex justify-between">
                          <span className={mutedClass}>Margin Used:</span>
                          <span className="text-amber-500 font-bold">${(selectedUser.marginUsed || 0).toFixed(2)}</span>
                        </div>
                      )}
                      {selectedUser.activeLoan && (
                        <div className="text-sm flex justify-between">
                          <span className={mutedClass}>Active Loan:</span>
                          <span className="text-red-500 font-bold">${selectedUser.activeLoan.principal?.toFixed(2) || '?'}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Holdings */}
                  {Object.keys(selectedUser.holdings).length > 0 && (
                    <div className="mb-4">
                      <h4 className={`text-xs font-semibold uppercase ${mutedClass} mb-2`}>Holdings (with P&L)</h4>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {Object.entries(selectedUser.holdings)
                          .map(([ticker, shares]) => {
                            const shareCount = typeof shares === 'number' ? shares : (shares?.shares || 0);
                            if (shareCount <= 0) return null;

                            const currentPrice = prices[ticker] || 0;
                            const currentValue = currentPrice * shareCount;
                            const costBasis = selectedUser.costBasis?.[ticker] || 0;
                            const unrealizedPL = currentValue - costBasis;
                            const unrealizedPct = costBasis > 0 ? ((unrealizedPL / costBasis) * 100) : 0;

                            return { ticker, shareCount, currentPrice, currentValue, costBasis, unrealizedPL, unrealizedPct };
                          })
                          .filter(h => h !== null)
                          .sort((a, b) => b.unrealizedPL - a.unrealizedPL)
                          .map(({ ticker, shareCount, currentPrice, currentValue, costBasis, unrealizedPL, unrealizedPct }) => (
                            <div key={ticker} className={`text-sm p-2 rounded ${darkMode ? 'bg-slate-700' : 'bg-slate-100'}`}>
                              <div className="flex justify-between items-start">
                                <div>
                                  <span className={`font-semibold ${textClass}`}>{ticker}</span>
                                  <span className={`ml-2 text-xs ${mutedClass}`}>{shareCount} shares</span>
                                </div>
                                <span className={`font-bold ${unrealizedPL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                  {unrealizedPL >= 0 ? '+' : ''}${unrealizedPL.toFixed(2)}
                                </span>
                              </div>
                              <div className={`text-xs ${mutedClass} mt-1`}>
                                Cost: ${costBasis.toFixed(2)} → Value: ${currentValue.toFixed(2)} ({unrealizedPct >= 0 ? '+' : ''}{unrealizedPct.toFixed(1)}%)
                              </div>
                              <div className={`text-xs ${mutedClass}`}>
                                Current price: ${currentPrice.toFixed(2)}
                              </div>
                            </div>
                          ))
                        }
                      </div>
                    </div>
                  )}

                  {/* Shorts */}
                  {Object.keys(selectedUser.shorts).length > 0 && (
                    <div className="mb-4">
                      <h4 className={`text-xs font-semibold uppercase text-red-400 mb-2`}>Short Positions</h4>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {Object.entries(selectedUser.shorts).map(([ticker, shortData]) => {
                          if (!shortData || shortData.shares <= 0) return null;
                          const currentPrice = prices[ticker] || shortData.entryPrice;
                          const pnl = (shortData.entryPrice - currentPrice) * shortData.shares;
                          const pnlPct = shortData.entryPrice > 0 ? ((pnl / (shortData.entryPrice * shortData.shares)) * 100) : 0;
                          return (
                            <div key={ticker} className={`text-sm p-2 rounded ${darkMode ? 'bg-slate-700' : 'bg-slate-100'}`}>
                              <div className="flex justify-between items-start">
                                <div>
                                  <span className="text-red-400 font-semibold">{ticker}</span>
                                  <span className={`ml-2 text-xs ${mutedClass}`}>{shortData.shares} shares short</span>
                                </div>
                                <span className={`font-bold ${pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                  {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                                </span>
                              </div>
                              <div className={`text-xs ${mutedClass} mt-1`}>
                                Entry: ${shortData.entryPrice?.toFixed(2)} → Current: ${currentPrice.toFixed(2)} ({pnl >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%)
                              </div>
                              <div className={`text-xs ${mutedClass}`}>
                                Margin held: ${shortData.margin?.toFixed(2) || '0.00'}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Bets */}
                  {Object.keys(selectedUser.bets).length > 0 && (
                    <div>
                      <h4 className={`text-xs font-semibold uppercase ${mutedClass} mb-2`}>Bets</h4>
                      <div className="space-y-1 max-h-32 overflow-y-auto">
                        {Object.entries(selectedUser.bets).map(([predId, bet]) => (
                          <div key={predId} className={`text-sm ${textClass}`}>
                            <div className="flex justify-between">
                              <span className="font-mono text-xs">{predId}</span>
                              <span className="text-teal-500">${bet.amount}</span>
                            </div>
                            <div className={`text-xs ${mutedClass}`}>
                              {bet.option} 
                              {bet.paid && (
                                <span className={bet.payout > 0 ? 'text-green-500 ml-2' : 'text-red-400 ml-2'}>
                                  {bet.payout > 0 ? `Won $${bet.payout.toFixed(2)}` : 'Lost'}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Transaction Log */}
                  {selectedUser.transactionLog && selectedUser.transactionLog.length > 0 && (
                    <div className="mb-4">
                      <h4 className={`text-xs font-semibold uppercase text-cyan-400 mb-2`}>Transaction Log (Last {selectedUser.transactionLog.length})</h4>
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {[...selectedUser.transactionLog].reverse().map((tx, i) => (
                          <div key={i} className={`text-xs p-2 rounded ${darkMode ? 'bg-slate-700' : 'bg-slate-100'}`}>
                            <div className="flex justify-between items-start">
                              <span className={`font-semibold ${
                                tx.type === 'BUY' ? 'text-green-500' :
                                tx.type === 'SELL' ? 'text-red-400' :
                                tx.type === 'SHORT_OPEN' ? 'text-orange-500' :
                                tx.type === 'SHORT_CLOSE' ? 'text-amber-400' :
                                tx.type === 'CHECKIN' ? 'text-cyan-400' :
                                tx.type === 'BET' ? 'text-purple-400' :
                                'text-zinc-400'
                              }`}>
                                {tx.type}
                              </span>
                              <span className={mutedClass}>
                                {new Date(tx.timestamp).toLocaleString()}
                              </span>
                            </div>
                            <div className={`${textClass} mt-1`}>
                              {tx.type === 'BUY' && `${tx.shares} ${tx.ticker} @ $${tx.pricePerShare?.toFixed(2)} = $${tx.totalCost?.toFixed(2)}`}
                              {tx.type === 'SELL' && `${tx.shares} ${tx.ticker} @ $${tx.pricePerShare?.toFixed(2)} = $${tx.totalRevenue?.toFixed(2)} (${tx.profitPercent >= 0 ? '+' : ''}${tx.profitPercent}%)`}
                              {tx.type === 'SHORT_OPEN' && `${tx.shares} ${tx.ticker} @ $${tx.entryPrice?.toFixed(2)}, margin $${tx.marginRequired?.toFixed(2)}`}
                              {tx.type === 'SHORT_CLOSE' && `${tx.shares} ${tx.ticker}, P&L: $${tx.totalProfit?.toFixed(2)}`}
                              {tx.type === 'CHECKIN' && `+$${tx.bonus} daily bonus`}
                              {tx.type === 'BET' && `$${tx.amount} on "${tx.option}"`}
                            </div>
                            <div className={`${mutedClass} mt-1`}>
                              Cash: ${tx.cashBefore?.toFixed(2)} → ${tx.cashAfter?.toFixed(2)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* User List */}
              {!selectedUser && userSearchResults.length > 0 && (
                <>
                  <div className="space-y-1">
                    {userSearchResults
                      .slice(usersPage * USERS_PER_PAGE, (usersPage + 1) * USERS_PER_PAGE)
                      .map((u, i) => {
                        const isSelected = selectedForDeletion.has(u.id);
                        const isAdmin = ADMIN_UIDS.includes(u.id);
                        
                        return (
                          <div 
                            key={u.id}
                            onClick={() => {
                              if (deleteMode) {
                                if (!isAdmin) toggleUserForDeletion(u.id);
                              } else {
                                setSelectedUser(u);
                              }
                            }}
                            className={`p-2 rounded-sm cursor-pointer flex justify-between items-center ${
                              deleteMode && isSelected
                                ? 'bg-red-500/30 border border-red-500'
                                : deleteMode && isAdmin
                                ? `${darkMode ? 'bg-slate-800 opacity-50' : 'bg-slate-200 opacity-50'} cursor-not-allowed`
                                : darkMode ? 'hover:bg-slate-700' : 'hover:bg-slate-100'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              {deleteMode && (
                                <span className={`text-lg ${isSelected ? 'text-red-500' : mutedClass}`}>
                                  {isSelected ? '☑' : isAdmin ? '🔒' : '☐'}
                                </span>
                              )}
                              <div>
                                <span className={`font-semibold ${textClass}`}>{u.displayName}</span>
                                {isAdmin && <span className="ml-2 text-xs text-amber-500">👑 Admin</span>}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className={`text-sm font-bold ${textClass}`}>${u.portfolioValue.toFixed(2)}</div>
                              <div className={`text-xs ${mutedClass}`}>Cash: ${u.cash.toFixed(2)}</div>
                            </div>
                          </div>
                        );
                      })}
                  </div>

                  {/* Pagination */}
                  {userSearchResults.length > USERS_PER_PAGE && (
                    <div className="flex justify-center items-center gap-2 pt-2">
                      <button
                        onClick={() => setUsersPage(0)}
                        disabled={usersPage === 0}
                        className={`px-2 py-1 text-xs rounded-sm ${
                          usersPage === 0 ? 'opacity-30 cursor-not-allowed' : ''
                        } ${darkMode ? 'bg-slate-700 text-zinc-300' : 'bg-slate-200 text-zinc-600'}`}
                      >
                        ««
                      </button>
                      <button
                        onClick={() => setUsersPage(p => Math.max(0, p - 1))}
                        disabled={usersPage === 0}
                        className={`px-3 py-1 text-xs rounded-sm ${
                          usersPage === 0 ? 'opacity-30 cursor-not-allowed' : ''
                        } ${darkMode ? 'bg-slate-700 text-zinc-300' : 'bg-slate-200 text-zinc-600'}`}
                      >
                        ‹ Prev
                      </button>
                      <span className={`px-3 py-1 text-sm ${textClass}`}>
                        Page {usersPage + 1} of {Math.ceil(userSearchResults.length / USERS_PER_PAGE)}
                      </span>
                      <button
                        onClick={() => setUsersPage(p => Math.min(Math.ceil(userSearchResults.length / USERS_PER_PAGE) - 1, p + 1))}
                        disabled={usersPage >= Math.ceil(userSearchResults.length / USERS_PER_PAGE) - 1}
                        className={`px-3 py-1 text-xs rounded-sm ${
                          usersPage >= Math.ceil(userSearchResults.length / USERS_PER_PAGE) - 1 ? 'opacity-30 cursor-not-allowed' : ''
                        } ${darkMode ? 'bg-slate-700 text-zinc-300' : 'bg-slate-200 text-zinc-600'}`}
                      >
                        Next ›
                      </button>
                      <button
                        onClick={() => setUsersPage(Math.ceil(userSearchResults.length / USERS_PER_PAGE) - 1)}
                        disabled={usersPage >= Math.ceil(userSearchResults.length / USERS_PER_PAGE) - 1}
                        className={`px-2 py-1 text-xs rounded-sm ${
                          usersPage >= Math.ceil(userSearchResults.length / USERS_PER_PAGE) - 1 ? 'opacity-30 cursor-not-allowed' : ''
                        } ${darkMode ? 'bg-slate-700 text-zinc-300' : 'bg-slate-200 text-zinc-600'}`}
                      >
                        »»
                      </button>
                    </div>
                  )}
                </>
              )}

              {allUsers.length === 0 && (
                <p className={`text-center ${mutedClass} py-8`}>
                  Click "Load" to fetch all users
                </p>
              )}
            </div>
          )}

          {/* TRADES TAB */}
          {activeTab === 'trades' && (
            <div className="space-y-4">
              <div className={`p-3 rounded-sm ${darkMode ? 'bg-yellow-900/20' : 'bg-yellow-50'}`}>
                <p className={`text-sm ${mutedClass}`}>
                  💹 View trade history across all users. Filter by time period, trade type, or ticker.
                </p>
              </div>

              {/* Filters */}
              <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                <div className="flex flex-wrap gap-3 items-end">
                  {/* Time Period */}
                  <div>
                    <label className={`text-xs ${mutedClass} block mb-1`}>Time Period</label>
                    <select
                      value={tradeTimePeriod}
                      onChange={(e) => setTradeTimePeriod(e.target.value)}
                      className={`px-3 py-2 rounded-sm border text-sm ${darkMode ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-slate-300'}`}
                    >
                      <option value="24h">Last 24 Hours</option>
                      <option value="week">Last 7 Days</option>
                      <option value="month">Last 30 Days</option>
                      <option value="all">All Time</option>
                    </select>
                  </div>

                  {/* Trade Type */}
                  <div>
                    <label className={`text-xs ${mutedClass} block mb-1`}>Trade Type</label>
                    <select
                      value={tradeTypeFilter}
                      onChange={(e) => setTradeTypeFilter(e.target.value)}
                      className={`px-3 py-2 rounded-sm border text-sm ${darkMode ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-slate-300'}`}
                    >
                      <option value="all">All Types</option>
                      <option value="BUY">Buy</option>
                      <option value="SELL">Sell</option>
                      <option value="SHORT_OPEN">Short Open</option>
                      <option value="SHORT_CLOSE">Short Close</option>
                    </select>
                  </div>

                  {/* Ticker Filter */}
                  <div>
                    <label className={`text-xs ${mutedClass} block mb-1`}>Ticker (optional)</label>
                    <input
                      type="text"
                      value={tradeFilterTicker}
                      onChange={(e) => setTradeFilterTicker(e.target.value.toUpperCase())}
                      placeholder="e.g. LUFFY"
                      className={`w-24 px-3 py-2 rounded-sm border text-sm ${darkMode ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-slate-300'}`}
                    />
                  </div>

                  {/* Load Button */}
                  <button
                    onClick={() => loadRecentTrades(tradeTimePeriod, tradeTypeFilter, tradeFilterTicker)}
                    disabled={tradesLoading}
                    className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white font-semibold rounded-sm disabled:opacity-50"
                  >
                    {tradesLoading ? 'Loading...' : '🔍 Load Trades'}
                  </button>
                </div>
              </div>

              {/* Trade Stats Summary */}
              {recentTrades.length > 0 && (
                <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                  <div className="grid grid-cols-5 gap-4 text-center">
                    <div>
                      <p className="text-xl font-bold text-yellow-500">{recentTrades.length}</p>
                      <p className={`text-xs ${mutedClass}`}>Total Trades</p>
                    </div>
                    <div>
                      <p className="text-xl font-bold text-green-500">{recentTrades.filter(t => t.type === 'BUY').length}</p>
                      <p className={`text-xs ${mutedClass}`}>Buys</p>
                    </div>
                    <div>
                      <p className="text-xl font-bold text-red-400">{recentTrades.filter(t => t.type === 'SELL').length}</p>
                      <p className={`text-xs ${mutedClass}`}>Sells</p>
                    </div>
                    <div>
                      <p className="text-xl font-bold text-orange-500">{recentTrades.filter(t => t.type === 'SHORT_OPEN').length}</p>
                      <p className={`text-xs ${mutedClass}`}>Shorts Opened</p>
                    </div>
                    <div>
                      <p className="text-xl font-bold text-purple-500">{recentTrades.filter(t => t.type === 'SHORT_CLOSE').length}</p>
                      <p className={`text-xs ${mutedClass}`}>Shorts Closed</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Trades Feed */}
              <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                <h3 className={`font-semibold mb-3 ${textClass}`}>Trade Feed</h3>

                {tradesLoading ? (
                  <p className={`text-center ${mutedClass} py-8`}>Loading trades...</p>
                ) : recentTrades.length === 0 ? (
                  <p className={`text-center ${mutedClass} py-8`}>No trades found. Click "Load Trades" to fetch.</p>
                ) : (
                  <div className="space-y-2 max-h-[500px] overflow-y-auto">
                    {recentTrades.map((trade, i) => (
                      <div
                        key={`${trade.userId}-${trade.timestamp}-${i}`}
                        className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-slate-50'} flex justify-between items-center`}
                      >
                        <div className="flex items-center gap-3">
                          {/* Trade Type Badge */}
                          <span className={`px-2 py-1 rounded text-xs font-bold ${
                            trade.type === 'BUY' ? 'bg-green-500/20 text-green-500' :
                            trade.type === 'SELL' ? 'bg-red-500/20 text-red-400' :
                            trade.type === 'SHORT_OPEN' ? 'bg-orange-500/20 text-orange-500' :
                            'bg-purple-500/20 text-purple-500'
                          }`}>
                            {trade.type === 'SHORT_OPEN' ? 'SHORT' : trade.type === 'SHORT_CLOSE' ? 'COVER' : trade.type}
                          </span>

                          {/* Trade Details */}
                          <div>
                            <p className={textClass}>
                              <span className="font-semibold">{trade.userName}</span>
                              <span className={mutedClass}> {trade.type === 'BUY' ? 'bought' : trade.type === 'SELL' ? 'sold' : trade.type === 'SHORT_OPEN' ? 'shorted' : 'covered'} </span>
                              <span className="font-bold text-cyan-500">{trade.shares}</span>
                              <span className={mutedClass}> shares of </span>
                              <span className="font-bold">${trade.ticker}</span>
                            </p>
                            <p className={`text-xs ${mutedClass}`}>
                              @ ${trade.price?.toFixed(2)} • Total: ${trade.total?.toFixed(2)}
                              {trade.profit !== null && trade.profit !== undefined && (
                                <span className={trade.profit >= 0 ? 'text-green-500 ml-2' : 'text-red-400 ml-2'}>
                                  P/L: {trade.profit >= 0 ? '+' : ''}${trade.profit.toFixed(2)}
                                </span>
                              )}
                            </p>
                          </div>
                        </div>

                        {/* Timestamp */}
                        <div className="text-right">
                          <p className={`text-xs ${mutedClass}`}>
                            {new Date(trade.timestamp).toLocaleDateString()}
                          </p>
                          <p className={`text-xs ${mutedClass}`}>
                            {new Date(trade.timestamp).toLocaleTimeString()}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STATS TAB */}
          {activeTab === 'stats' && (
            <div className="space-y-4">
              <div className={`p-3 rounded-sm ${darkMode ? 'bg-cyan-900/20' : 'bg-cyan-50'}`}>
                <div className="flex justify-between items-center">
                  <p className={`text-sm ${mutedClass}`}>
                    📈 Market overview and platform statistics
                  </p>
                  <button
                    onClick={loadMarketStats}
                    disabled={statsLoading}
                    className="px-3 py-1 text-xs bg-cyan-600 hover:bg-cyan-700 text-white rounded-sm disabled:opacity-50"
                  >
                    {statsLoading ? '...' : '🔄 Refresh'}
                  </button>
                </div>
              </div>

              {statsLoading ? (
                <p className={`text-center py-8 ${mutedClass}`}>Loading market stats...</p>
              ) : !marketStats ? (
                <p className={`text-center py-8 ${mutedClass}`}>Click refresh to load stats</p>
              ) : (
                <>
                  {/* User Stats */}
                  <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                    <h3 className={`font-semibold mb-3 ${textClass}`}>👥 Users</h3>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="text-center">
                        <p className={`text-2xl font-bold ${textClass}`}>{marketStats.totalUsers}</p>
                        <p className={`text-xs ${mutedClass}`}>Total Users</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold text-green-500">{marketStats.activeUsers24h}</p>
                        <p className={`text-xs ${mutedClass}`}>Active (24h)</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold text-cyan-500">{marketStats.activeUsers7d}</p>
                        <p className={`text-xs ${mutedClass}`}>Active (7d)</p>
                      </div>
                    </div>
                  </div>

                  {/* Financial Stats */}
                  <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                    <h3 className={`font-semibold mb-3 ${textClass}`}>💰 Financials</h3>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="flex justify-between">
                        <span className={mutedClass}>Total Cash in System:</span>
                        <span className="font-bold text-green-500">${marketStats.totalCashInSystem.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className={mutedClass}>Total Portfolio Value:</span>
                        <span className={`font-bold ${textClass}`}>${marketStats.totalPortfolioValue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className={mutedClass}>Total Market Cap:</span>
                        <span className="font-bold text-cyan-500">${marketStats.totalMarketCap.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className={mutedClass}>Total Shares Held:</span>
                        <span className={`font-bold ${textClass}`}>{marketStats.totalSharesHeld.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className={mutedClass}>Margin Used:</span>
                        <span className="font-bold text-amber-500">${marketStats.totalMarginUsed.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className={mutedClass}>Users with Margin:</span>
                        <span className={`font-bold ${textClass}`}>{marketStats.usersWithMargin}</span>
                      </div>
                    </div>
                  </div>

                  {/* Activity Stats */}
                  <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                    <h3 className={`font-semibold mb-3 ${textClass}`}>📊 Activity</h3>
                    
                    {/* 24h Activity */}
                    <div className={`p-3 rounded-sm mb-3 ${darkMode ? 'bg-cyan-900/20' : 'bg-cyan-50'}`}>
                      <h4 className="text-cyan-500 font-semibold text-sm mb-2">Last 24 Hours</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                        <div className="text-center">
                          <p className="text-xl font-bold text-cyan-500">{marketStats.trades24h || 0}</p>
                          <p className={`text-xs ${mutedClass}`}>Trades</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xl font-bold text-green-500">${(marketStats.volume24h || 0).toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}</p>
                          <p className={`text-xs ${mutedClass}`}>Volume</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xl font-bold text-amber-500">{marketStats.checkins24h || 0}</p>
                          <p className={`text-xs ${mutedClass}`}>Check-ins</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xl font-bold text-purple-500">{marketStats.bets24h || 0}</p>
                          <p className={`text-xs ${mutedClass}`}>Bets</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
                        <div className="flex justify-between">
                          <span className={mutedClass}>Buys:</span>
                          <span className="text-green-500 font-semibold">{marketStats.buys24h || 0}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className={mutedClass}>Sells:</span>
                          <span className="text-red-400 font-semibold">{marketStats.sells24h || 0}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className={mutedClass}>Shorts:</span>
                          <span className="text-orange-500 font-semibold">{marketStats.shorts24h || 0}</span>
                        </div>
                      </div>
                    </div>

                    {/* Top Traded 24h */}
                    {marketStats.topTraded24h && marketStats.topTraded24h.length > 0 && (
                      <div className="mb-3">
                        <h4 className={`text-xs font-semibold uppercase ${mutedClass} mb-2`}>Most Traded (24h)</h4>
                        <div className="space-y-1">
                          {marketStats.topTraded24h.map((item, i) => (
                            <div key={item.ticker} className="flex justify-between text-sm">
                              <span className={textClass}>${item.ticker}</span>
                              <span className="font-bold text-cyan-500">${item.volume.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* All Time */}
                    <div className={`pt-3 border-t ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                      <h4 className={`text-xs font-semibold uppercase ${mutedClass} mb-2`}>All Time</h4>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div className="flex justify-between">
                          <span className={mutedClass}>Total Trades:</span>
                          <span className={`font-bold ${textClass}`}>{marketStats.totalTradesAllTime.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className={mutedClass}>Total Bets:</span>
                          <span className={`font-bold ${textClass}`}>{marketStats.totalBetsPlaced.toLocaleString()}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Top Held Characters */}
                  <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                    <h3 className={`font-semibold mb-3 ${textClass}`}>🏆 Most Held Characters</h3>
                    <div className="space-y-2">
                      {marketStats.topHeld.map((item, i) => {
                        const char = CHARACTERS.find(c => c.ticker === item.ticker);
                        return (
                          <div key={item.ticker} className="flex justify-between items-center">
                            <span className={textClass}>
                              <span className={mutedClass}>{i + 1}.</span> {char?.name || item.ticker} <span className={mutedClass}>(${item.ticker})</span>
                            </span>
                            <span className="font-bold text-cyan-500">{item.shares.toLocaleString()} shares</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Price Movers */}
                  <div className="grid grid-cols-2 gap-4">
                    {/* Top Gainers */}
                    <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                      <h3 className={`font-semibold mb-3 text-green-500`}>📈 Top Gainers</h3>
                      <div className="space-y-1">
                        {marketStats.topGainers.map((item, i) => (
                          <div key={item.ticker} className="flex justify-between text-sm">
                            <span className={textClass}>${item.ticker}</span>
                            <span className="font-bold text-green-500">+{item.change.toFixed(1)}%</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Top Losers */}
                    <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                      <h3 className={`font-semibold mb-3 text-red-500`}>📉 Top Losers</h3>
                      <div className="space-y-1">
                        {marketStats.topLosers.map((item, i) => (
                          <div key={item.ticker} className="flex justify-between text-sm">
                            <span className={textClass}>${item.ticker}</span>
                            <span className="font-bold text-red-500">{item.change.toFixed(1)}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Crew Membership */}
                  <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                    <h3 className={`font-semibold mb-3 ${textClass}`}>🏴 Crew Membership</h3>
                    <div className="grid grid-cols-3 gap-2">
                      {Object.entries(marketStats.crewCounts).sort((a, b) => b[1] - a[1]).map(([crewId, count]) => (
                        <div key={crewId} className="flex justify-between text-sm">
                          <span className={textClass}>{crewId}</span>
                          <span className="font-bold text-purple-500">{count}</span>
                        </div>
                      ))}
                    </div>
                    {Object.keys(marketStats.crewCounts).length === 0 && (
                      <p className={`text-sm ${mutedClass}`}>No crew memberships yet</p>
                    )}
                  </div>

                  <p className={`text-xs ${mutedClass} text-center`}>
                    Last updated: {new Date(marketStats.lastUpdated).toLocaleString()}
                  </p>
                </>
              )}

              {/* Orphan Cleanup Section */}
              <div className={`p-4 rounded-sm ${darkMode ? 'bg-red-900/20 border border-red-800' : 'bg-red-50 border border-red-200'}`}>
                <h3 className={`font-semibold mb-3 text-red-500`}>🧹 Orphaned Account Cleanup</h3>
                <p className={`text-xs ${mutedClass} mb-3`}>
                  Find and remove user documents that have zero activity (no trades, no checkins, default $1000 cash).
                  These are likely bot accounts or users who were deleted from Firebase Auth.
                </p>
                
                <button
                  onClick={scanForOrphanedUsers}
                  disabled={loading}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-sm disabled:opacity-50 mr-2"
                >
                  {loading ? 'Scanning...' : '🔍 Scan for Orphans'}
                </button>
                
                {orphanScanComplete && (
                  <span className={`text-sm ${mutedClass}`}>
                    Found {orphanedUsers.length} suspicious accounts
                  </span>
                )}

                {orphanedUsers.length > 0 && (
                  <div className="mt-4">
                    <div className="flex justify-between items-center mb-2">
                      <span className={`text-sm font-semibold ${textClass}`}>
                        {orphanedUsers.length} Orphaned Accounts
                      </span>
                      <button
                        onClick={deleteAllOrphanedUsers}
                        disabled={loading}
                        className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-sm disabled:opacity-50"
                      >
                        🗑️ Delete All ({orphanedUsers.length})
                      </button>
                    </div>
                    
                    <div className="max-h-60 overflow-y-auto space-y-1">
                      {orphanedUsers.slice(0, 100).map(u => (
                        <div 
                          key={u.id} 
                          className={`p-2 rounded-sm flex justify-between items-center text-sm ${
                            darkMode ? 'bg-slate-800' : 'bg-white'
                          }`}
                        >
                          <div>
                            <span className={textClass}>{u.displayName}</span>
                            <span className={`text-xs ${mutedClass} ml-2`}>
                              ${u.cash.toFixed(0)} • {u.totalTrades} trades
                            </span>
                          </div>
                          <button
                            onClick={() => deleteOrphanedUser(u.id)}
                            className="px-2 py-1 bg-red-500 hover:bg-red-600 text-white text-xs rounded-sm"
                          >
                            🗑️
                          </button>
                        </div>
                      ))}
                      {orphanedUsers.length > 100 && (
                        <p className={`text-xs ${mutedClass} text-center py-2`}>
                          Showing first 100 of {orphanedUsers.length}. Use "Delete All" for the rest.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* RECOVERY TAB */}
          {activeTab === 'recovery' && (
            <div className="space-y-4">
              <div className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-slate-100'}`}>
                <p className={`text-sm ${mutedClass} mb-2`}>
                  🔧 Manually process payouts for predictions that failed to auto-pay. Enter a prediction ID to scan for bets.
                </p>
              </div>

              {/* Prediction ID Input */}
              <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                <h3 className={`font-semibold mb-3 ${textClass}`}>1. Enter Prediction ID</h3>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={recoveryPredictionId}
                    onChange={(e) => setRecoveryPredictionId(e.target.value)}
                    placeholder="e.g., pred_1737500000000"
                    className={`flex-1 px-3 py-2 rounded-sm border ${darkMode ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-slate-300'}`}
                  />
                  <button
                    onClick={handleScanForBets}
                    disabled={loading || !recoveryPredictionId.trim()}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-sm disabled:opacity-50"
                  >
                    {loading ? 'Scanning...' : '🔍 Scan for Bets'}
                  </button>
                </div>
              </div>

              {/* Bets Found */}
              {recoveryBets.length > 0 && (
                <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                  <h3 className={`font-semibold mb-3 ${textClass}`}>2. Bets Found ({recoveryBets.length})</h3>

                  {/* Summary */}
                  <div className={`p-3 rounded-sm mb-3 ${darkMode ? 'bg-slate-700/50' : 'bg-slate-100'}`}>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className={mutedClass}>Total Pool: </span>
                        <span className="font-bold text-green-500">${recoveryBets.reduce((sum, b) => sum + b.amount, 0).toLocaleString()}</span>
                      </div>
                      <div>
                        <span className={mutedClass}>Options: </span>
                        <span className={textClass}>{recoveryOptions.join(', ')}</span>
                      </div>
                      <div>
                        <span className={mutedClass}>Already Paid: </span>
                        <span className="font-bold text-cyan-500">{recoveryBets.filter(b => b.paid).length}</span>
                      </div>
                      <div>
                        <span className={mutedClass}>Unpaid: </span>
                        <span className="font-bold text-orange-500">{recoveryBets.filter(b => !b.paid).length}</span>
                      </div>
                    </div>
                  </div>

                  {/* Bet List */}
                  <div className="max-h-48 overflow-y-auto mb-3 space-y-1">
                    {recoveryBets.map((bet, i) => (
                      <div key={bet.userId} className={`flex justify-between items-center text-sm p-2 rounded ${darkMode ? 'bg-slate-700/30' : 'bg-slate-50'}`}>
                        <span className={textClass}>
                          {bet.displayName}
                          {bet.paid && <span className="ml-2 text-xs text-green-500">(paid: ${bet.payout})</span>}
                        </span>
                        <span>
                          <span className={`font-semibold ${bet.option === recoveryWinner ? 'text-green-500' : mutedClass}`}>
                            {bet.option}
                          </span>
                          <span className="ml-2 font-bold text-cyan-500">${bet.amount}</span>
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Select Winner */}
                  <h3 className={`font-semibold mb-2 ${textClass}`}>3. Select Winning Option</h3>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {recoveryOptions.map(option => (
                      <button
                        key={option}
                        onClick={() => setRecoveryWinner(option)}
                        className={`px-4 py-2 rounded-sm font-semibold transition-colors ${
                          recoveryWinner === option
                            ? 'bg-green-600 text-white'
                            : darkMode ? 'bg-slate-700 text-slate-300 hover:bg-slate-600' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                        }`}
                      >
                        {option}
                        <span className="ml-2 text-xs opacity-75">
                          (${recoveryBets.filter(b => b.option === option).reduce((sum, b) => sum + b.amount, 0)})
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* Action Buttons */}
                  <h3 className={`font-semibold mb-2 ${textClass}`}>4. Process</h3>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleProcessRecovery('payout')}
                      disabled={loading || !recoveryWinner}
                      className="flex-1 px-4 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-sm disabled:opacity-50"
                    >
                      {loading ? 'Processing...' : `💰 Pay Winners (${recoveryWinner || 'select option'})`}
                    </button>
                    <button
                      onClick={() => handleProcessRecovery('refund')}
                      disabled={loading}
                      className="px-4 py-3 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-sm disabled:opacity-50"
                    >
                      {loading ? 'Processing...' : '↩️ Refund All'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default AdminPanel;
