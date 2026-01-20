import React, { useState } from 'react';
import { doc, updateDoc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { CHARACTERS } from './characters';

// Put your admin user IDs here (your Firebase Auth UID)
// Find your UID in Firebase Console → Authentication → Users
const ADMIN_UIDS = [
  '4usiVxPmHLhmitEKH2HfCpbx4Yi1'
];

const AdminPanel = ({ user, predictions, prices, darkMode, onClose }) => {
  const [activeTab, setActiveTab] = useState('create');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  
  // Create prediction form state
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '', '', '']);
  const [daysUntilEnd, setDaysUntilEnd] = useState(7);
  
  // Calculate end time at 8:55 AM CST on target day
  const getEndTime = (days) => {
    const now = new Date();
    const target = new Date(now);
    target.setDate(target.getDate() + days);
    // Set to 8:55 AM CST (CST is UTC-6)
    // 8:55 AM CST = 14:55 UTC
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
        // Keep last 1000 entries
        const trimmedHistory = updatedHistory.slice(-1000);
        
        console.log('New history length:', trimmedHistory.length);
        console.log('New last entry:', trimmedHistory[trimmedHistory.length - 1]);
        
        await updateDoc(marketRef, {
          [`prices.${selectedTicker}`]: targetPrice,
          [`priceHistory.${selectedTicker}`]: trimmedHistory
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
      setOptions(['', '', '', '']);
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
        lastUpdated: now
      });
    } catch (err) {
      console.error('Failed to load market stats:', err);
      showMessage('error', 'Failed to load market stats');
    }
    setStatsLoading(false);
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
          bets: data.bets || {},
          totalTrades: data.totalTrades || 0,
          isAdmin: data.isAdmin || false
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
        const cash = userData.cash || 0;
        
        // Calculate holdings value
        let holdingsValue = 0;
        for (const [ticker, holdingData] of Object.entries(holdings)) {
          const currentPrice = prices[ticker] || 0;
          // Support both formats: { shares: 5 } or just 5
          const shares = typeof holdingData === 'number' ? holdingData : (holdingData.shares || 0);
          holdingsValue += currentPrice * shares;
          console.log(`${userData.displayName}: ${ticker} = ${shares} shares @ $${currentPrice} = $${currentPrice * shares}`);
        }
        
        const newPortfolioValue = Math.round((cash + holdingsValue) * 100) / 100;
        
        console.log(`${userData.displayName}: cash=$${cash} + holdings=$${holdingsValue} = $${newPortfolioValue} (was $${userData.portfolioValue})`);
        
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
            cash: userData.cash || 0
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
              await updateDoc(userRef, {
                cash: bet.cash + payout,
                [`bets.${predId}.paid`]: true,
                [`bets.${predId}.payout`]: payout
              });
              console.log('Paid winner:', bet.displayName, payout);
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

        {/* Tabs */}
        <div className={`flex border-b ${darkMode ? 'border-slate-700' : 'border-slate-200'} overflow-x-auto`}>
          <button
            onClick={() => setActiveTab('prices')}
            className={`flex-1 py-3 text-sm font-semibold whitespace-nowrap px-2 ${activeTab === 'prices' ? 'text-teal-500 border-b-2 border-teal-500' : mutedClass}`}
          >
            💰 Prices
          </button>
          <button
            onClick={() => { setActiveTab('ipo'); loadIPOs(); }}
            className={`flex-1 py-3 text-sm font-semibold whitespace-nowrap px-2 ${activeTab === 'ipo' ? 'text-orange-500 border-b-2 border-orange-500' : mutedClass}`}
          >
            🚀 IPO
          </button>
          <button
            onClick={() => setActiveTab('create')}
            className={`flex-1 py-3 text-sm font-semibold whitespace-nowrap px-2 ${activeTab === 'create' ? 'text-teal-500 border-b-2 border-teal-500' : mutedClass}`}
          >
            ➕ Pred
          </button>
          <button
            onClick={() => setActiveTab('resolve')}
            className={`flex-1 py-3 text-sm font-semibold whitespace-nowrap px-2 ${activeTab === 'resolve' ? 'text-teal-500 border-b-2 border-teal-500' : mutedClass}`}
          >
            ✅ ({unresolvedPredictions.length})
          </button>
          <button
            onClick={() => setActiveTab('holders')}
            className={`flex-1 py-3 text-sm font-semibold whitespace-nowrap px-2 ${activeTab === 'holders' ? 'text-purple-500 border-b-2 border-purple-500' : mutedClass}`}
          >
            📊 Holders
          </button>
          <button
            onClick={() => setActiveTab('recover')}
            className={`flex-1 py-3 text-sm font-semibold whitespace-nowrap px-2 ${activeTab === 'recover' ? 'text-amber-500 border-b-2 border-amber-500' : mutedClass}`}
          >
            🔧 Fix
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`flex-1 py-3 text-sm font-semibold whitespace-nowrap px-2 ${activeTab === 'users' ? 'text-teal-500 border-b-2 border-teal-500' : mutedClass}`}
          >
            👥 Users
          </button>
          <button
            onClick={() => setActiveTab('manage')}
            className={`flex-1 py-3 text-sm font-semibold whitespace-nowrap px-2 ${activeTab === 'manage' ? 'text-teal-500 border-b-2 border-teal-500' : mutedClass}`}
          >
            📋 All
          </button>
          <button
            onClick={() => { setActiveTab('stats'); loadMarketStats(); }}
            className={`flex-1 py-3 text-sm font-semibold whitespace-nowrap px-2 ${activeTab === 'stats' ? 'text-cyan-500 border-b-2 border-cyan-500' : mutedClass}`}
          >
            📈 Stats
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

          {/* CREATE TAB */}
          {activeTab === 'create' && (
            <div className="space-y-4">
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
                <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Options (2-4)</label>
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
                      placeholder={idx < 2 ? '(required)' : '(optional)'}
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
                  Ends: {endDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })} at 8:55 AM CST
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

          {/* RESOLVE TAB */}
          {activeTab === 'resolve' && (
            <div className="space-y-4">
              {unresolvedPredictions.length === 0 ? (
                <p className={`text-center py-8 ${mutedClass}`}>No predictions to resolve</p>
              ) : (
                <>
                  <div>
                    <label className={`block text-xs font-semibold uppercase mb-2 ${mutedClass}`}>Select Prediction</label>
                    <div className="space-y-2">
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
                  </div>

                  {selectedPrediction && (
                    <div>
                      <label className={`block text-xs font-semibold uppercase mb-2 ${mutedClass}`}>Select Winner</label>
                      <div className="grid grid-cols-2 gap-2">
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
                    </div>
                  )}

                  {selectedPrediction && selectedOutcome && (
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

          {/* MANAGE TAB */}
          {activeTab === 'manage' && (
            <div className="space-y-3">
              {predictions.length === 0 ? (
                <p className={`text-center py-8 ${mutedClass}`}>No predictions yet</p>
              ) : (
                predictions.map(p => (
                  <div key={p.id} className={`p-3 rounded-sm border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-semibold ${p.resolved ? 'text-green-500' : 'text-amber-500'}`}>
                            {p.resolved ? '✅ Resolved' : '⏳ Active'}
                          </span>
                          <span className={`text-xs ${mutedClass}`}>{p.id}</span>
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
                ))
              )}
            </div>
          )}

          {/* RECOVER TAB */}
          {activeTab === 'recover' && (
            <div className="space-y-4">
              <div className={`p-3 rounded-sm ${darkMode ? 'bg-amber-900/20 border border-amber-700' : 'bg-amber-50 border border-amber-200'}`}>
                <p className={`text-sm text-amber-500`}>
                  ⚠️ Use this to recover bets from a lost/deleted prediction. 
                  Enter the prediction ID to find all users who placed bets.
                </p>
              </div>

              <div>
                <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Prediction ID</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={recoveryPredictionId}
                    onChange={e => setRecoveryPredictionId(e.target.value)}
                    placeholder="pred_1"
                    className={`flex-1 px-3 py-2 border rounded-sm ${inputClass}`}
                  />
                  <button
                    onClick={handleScanForBets}
                    disabled={loading}
                    className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-sm disabled:opacity-50"
                  >
                    {loading ? '...' : '🔍 Scan'}
                  </button>
                </div>
              </div>

              {recoveryBets.length > 0 && (
                <>
                  <div className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-slate-100'}`}>
                    <h4 className={`font-semibold ${textClass} mb-2`}>Found {recoveryBets.length} Bets</h4>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {recoveryBets.map((bet, i) => (
                        <div key={i} className={`text-sm flex justify-between ${bet.paid ? 'text-slate-500' : textClass}`}>
                          <span className={bet.paid ? 'line-through' : ''}>{bet.displayName}</span>
                          <span>
                            <span className="text-teal-500">${bet.amount}</span>
                            {' on '}
                            <span className="font-semibold">{bet.option}</span>
                            {bet.paid && (
                              <span className={`ml-2 text-xs ${bet.payout > 0 ? 'text-green-500' : 'text-red-400'}`}>
                                {bet.payout > 0 ? `(won $${bet.payout.toFixed(2)})` : '(lost)'}
                              </span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className={`mt-2 pt-2 border-t ${darkMode ? 'border-slate-600' : 'border-slate-300'}`}>
                      <div className="flex justify-between text-sm">
                        <span className={mutedClass}>Total Pool:</span>
                        <span className={`font-bold ${textClass}`}>
                          ${recoveryBets.reduce((sum, b) => sum + b.amount, 0).toFixed(2)}
                        </span>
                      </div>
                      <div className={`text-xs ${mutedClass} mt-1`}>
                        Options: {recoveryOptions.join(', ')}
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className={`block text-xs font-semibold uppercase mb-2 ${mutedClass}`}>Select Winner (for payout)</label>
                    <div className="flex flex-wrap gap-2">
                      {recoveryOptions.map(opt => (
                        <button
                          key={opt}
                          onClick={() => setRecoveryWinner(opt)}
                          className={`px-4 py-2 rounded-sm border-2 font-semibold transition-all ${
                            recoveryWinner === opt
                              ? 'border-green-500 bg-green-500 text-white'
                              : darkMode ? 'border-slate-600 text-slate-300 hover:border-green-500' : 'border-slate-300 hover:border-green-500'
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => handleProcessRecovery('refund')}
                      disabled={loading}
                      className="py-3 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-sm disabled:opacity-50"
                    >
                      {loading ? '...' : '💰 Refund All'}
                    </button>
                    <button
                      onClick={() => handleProcessRecovery('payout')}
                      disabled={loading || !recoveryWinner}
                      className="py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-sm disabled:opacity-50"
                    >
                      {loading ? '...' : `✅ Payout Winners`}
                    </button>
                  </div>
                  
                  <p className={`text-xs ${mutedClass}`}>
                    <strong>Refund All:</strong> Returns original bet amount to everyone.<br/>
                    <strong>Payout Winners:</strong> Winners split the total pool (select winner first).
                  </p>
                </>
              )}
            </div>
          )}

          {/* USERS TAB */}
          {activeTab === 'users' && (
            <div className="space-y-4">
              <div className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-slate-100'}`}>
                <p className={`text-sm ${mutedClass}`}>
                  👥 Search and view user details. Click "Load Users" first.
                </p>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={userSearchQuery}
                  onChange={e => handleUserSearch(e.target.value)}
                  placeholder="Search by name or ID..."
                  className={`flex-1 px-3 py-2 border rounded-sm ${inputClass}`}
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
              </div>

              {userSearchResults.length > 0 && (
                <div className={`text-xs ${mutedClass} mb-2`}>
                  Showing {userSearchResults.length} of {allUsers.length} users
                </div>
              )}

              {/* Selected User Detail */}
              {selectedUser && (
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
                  </div>

                  {/* Holdings */}
                  {Object.keys(selectedUser.holdings).length > 0 && (
                    <div className="mb-4">
                      <h4 className={`text-xs font-semibold uppercase ${mutedClass} mb-2`}>Holdings</h4>
                      <div className="space-y-1 max-h-32 overflow-y-auto">
                        {Object.entries(selectedUser.holdings).map(([ticker, data]) => (
                          <div key={ticker} className={`text-sm flex justify-between ${textClass}`}>
                            <span>{ticker}</span>
                            <span>{data.shares} @ ${data.avgCost?.toFixed(2) || '?'}</span>
                          </div>
                        ))}
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
                </div>
              )}

              {/* User List */}
              {!selectedUser && userSearchResults.length > 0 && (
                <div className="space-y-1 max-h-96 overflow-y-auto">
                  {userSearchResults.slice(0, 50).map((u, i) => (
                    <div 
                      key={u.id}
                      onClick={() => setSelectedUser(u)}
                      className={`p-2 rounded-sm cursor-pointer flex justify-between items-center ${
                        darkMode ? 'hover:bg-slate-700' : 'hover:bg-slate-100'
                      }`}
                    >
                      <div>
                        <span className={`font-semibold ${textClass}`}>{u.displayName}</span>
                        {u.isAdmin && <span className="ml-2 text-xs text-amber-500">👑</span>}
                      </div>
                      <div className="text-right">
                        <div className={`text-sm font-bold ${textClass}`}>${u.portfolioValue.toFixed(2)}</div>
                        <div className={`text-xs ${mutedClass}`}>Cash: ${u.cash.toFixed(2)}</div>
                      </div>
                    </div>
                  ))}
                  {userSearchResults.length > 50 && (
                    <p className={`text-center text-xs ${mutedClass} py-2`}>
                      Showing first 50 results. Use search to narrow down.
                    </p>
                  )}
                </div>
              )}

              {allUsers.length === 0 && (
                <p className={`text-center ${mutedClass} py-8`}>
                  Click "Load" to fetch all users
                </p>
              )}
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
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="flex justify-between">
                        <span className={mutedClass}>Total Trades (All Time):</span>
                        <span className={`font-bold ${textClass}`}>{marketStats.totalTradesAllTime.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className={mutedClass}>Total Bets Placed:</span>
                        <span className={`font-bold ${textClass}`}>{marketStats.totalBetsPlaced.toLocaleString()}</span>
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminPanel;
