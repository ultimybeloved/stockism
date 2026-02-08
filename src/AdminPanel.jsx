import React, { useState } from 'react';
import { doc, updateDoc, getDoc, setDoc, collection, getDocs, deleteDoc, runTransaction, arrayUnion } from 'firebase/firestore';
import { db, createBotsFunction, triggerManualBackupFunction, listBackupsFunction, restoreBackupFunction, banUserFunction, tradeSpikeAlertFunction, ipoAnnouncementAlertFunction, removeAchievementFunction, reinstateUserFunction, adminSetCashFunction, repairSpikeVictimsFunction } from './firebase';
import { CHARACTERS, CHARACTER_MAP } from './characters';
import { ADMIN_UIDS, MIN_PRICE } from './constants';
import { ACHIEVEMENTS } from './constants/achievements';
import { initializeMarket } from './services/market';

const AdminPanel = ({ user, predictions, prices, darkMode, onClose }) => {
  const [activeTab, setActiveTab] = useState('users');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  
  // Badges tab state
  const [badgeUsers, setBadgeUsers] = useState([]);
  const [badgesLoaded, setBadgesLoaded] = useState(false);
  const [expandedBadge, setExpandedBadge] = useState(null);

  // Create prediction form state
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '', '', '', '', '']);
  const [daysUntilEnd, setDaysUntilEnd] = useState(7);
  
  // Calculate end time at 13:55 UTC (7:55 AM CST) on target day (5 min before chapter release)
  const getEndTime = (days) => {
    const now = new Date();
    const target = new Date(now);
    target.setDate(target.getDate() + days);
    target.setUTCHours(13, 55, 0, 0);
    return target.getTime();
  };
  
  const endDate = new Date(getEndTime(daysUntilEnd));
  
  // Resolve prediction state
  const [selectedPrediction, setSelectedPrediction] = useState(null);
  const [selectedOutcome, setSelectedOutcome] = useState('');

  // Extend/Reopen prediction state
  const [extendPredictionId, setExtendPredictionId] = useState('');
  const [extendDays, setExtendDays] = useState(7);
  const [allowAdditionalBets, setAllowAdditionalBets] = useState(false);

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

  // Spike victim repair state
  const [spikeVictims, setSpikeVictims] = useState([]);
  const [spikeScanned, setSpikeScanned] = useState(false);
  const [scanningSpike, setScanningSpike] = useState(false);
  const [repairingSpike, setRepairingSpike] = useState(false);
  const [diagnosisResults, setDiagnosisResults] = useState([]);
  const [diagnosisIds, setDiagnosisIds] = useState('');
  const [diagnosing, setDiagnosing] = useState(false);

  // Price history cleanup state
  const [futureEntries, setFutureEntries] = useState([]);

  // Backup restore state
  const [backups, setBackups] = useState([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [scanningHistory, setScanningHistory] = useState(false);

  // Check-in fraud detection state
  const [fraudUsers, setFraudUsers] = useState([]);
  const [scanningFraud, setScanningFraud] = useState(false);

  // Trade fraud detection state
  const [tradeFraudUsers, setTradeFraudUsers] = useState([]);
  const [scanningTradeFraud, setScanningTradeFraud] = useState(false);

  // User data transfer state
  const [oldUserId, setOldUserId] = useState('');
  const [newUserId, setNewUserId] = useState('');
  const [transferring, setTransferring] = useState(false);

  // Manual rollback state
  const [rollbackTarget, setRollbackTarget] = useState(null);
  const [newDisplayName, setNewDisplayName] = useState('');

  // Bot management state
  const [bots, setBots] = useState([]);
  const [botsLoading, setBotsLoading] = useState(false);

  // User search state
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userSearchResults, setUserSearchResults] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [allUsers, setAllUsers] = useState([]);
  const [usersPage, setUsersPage] = useState(0);
  const [deleteMode, setDeleteMode] = useState(false);
  const [selectedForDeletion, setSelectedForDeletion] = useState(new Set());
  const [userSortBy, setUserSortBy] = useState('portfolio-high'); // 'portfolio-high', 'portfolio-low', 'cash-high', 'cash-low'
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
  const [tradeBotFilter, setTradeBotFilter] = useState('real'); // 'real', 'bots', 'all'
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

  // Price adjustment modal state
  const [showPriceModal, setShowPriceModal] = useState(false);
  const [priceModalSearch, setPriceModalSearch] = useState('');
  const [selectedPriceCharacter, setSelectedPriceCharacter] = useState(null);
  const [priceAdjustPercent, setPriceAdjustPercent] = useState('');

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

  // Load users for badges tab
  const loadBadgeUsers = async () => {
    if (badgesLoaded) return;
    setLoading(true);
    try {
      const snapshot = await getDocs(collection(db, 'users'));
      const users = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        if ((data.achievements || []).length > 0) {
          users.push({
            id: doc.id,
            displayName: data.displayName || 'Unknown',
            achievements: data.achievements || [],
            achievementDates: data.achievementDates || {},
            portfolioValue: data.portfolioValue || 0,
            isBot: data.isBot || false
          });
        }
      });
      setBadgeUsers(users);
      setBadgesLoaded(true);
      showMessage('success', `Loaded ${users.length} users with achievements`);
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to load badge data');
    }
    setLoading(false);
  };

  const handleRemoveAchievement = async (userId, achievementId, displayName) => {
    if (!confirm(`Remove ${achievementId} from ${displayName}?`)) return;
    setLoading(true);
    try {
      await removeAchievementFunction({ userId, achievementId });
      // Update local state
      setBadgeUsers(prev => prev.map(u => {
        if (u.id !== userId) return u;
        const updated = { ...u, achievements: u.achievements.filter(a => a !== achievementId) };
        const dates = { ...u.achievementDates };
        delete dates[achievementId];
        updated.achievementDates = dates;
        return updated;
      }).filter(u => u.achievements.length > 0));
      showMessage('success', `Removed ${achievementId} from ${displayName}`);
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed to remove: ${err.message}`);
    }
    setLoading(false);
  };

  // Load bankrupt users for recovery tab
  const [bankruptUsers, setBankruptUsers] = useState([]);
  const [bankruptLoaded, setBankruptLoaded] = useState(false);

  const loadBankruptUsers = async () => {
    if (bankruptLoaded) return;
    setLoading(true);
    try {
      const snapshot = await getDocs(collection(db, 'users'));
      const users = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.isBankrupt && !data.isBot) {
          users.push({
            id: doc.id,
            displayName: data.displayName || 'Unknown',
            cash: data.cash || 0,
            portfolioValue: data.portfolioValue || 0,
            bankruptAt: data.bankruptAt || null,
            totalTrades: data.totalTrades || 0,
            crew: data.crew || null,
            holdings: data.holdings || {},
            shorts: data.shorts || {}
          });
        }
      });
      users.sort((a, b) => (b.bankruptAt || 0) - (a.bankruptAt || 0));
      setBankruptUsers(users);
      setBankruptLoaded(true);
      showMessage('success', `Found ${users.length} bankrupt users`);
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to load bankrupt users');
    }
    setLoading(false);
  };

  const handleReinstateUser = async (userId, displayName) => {
    if (!confirm(`Reinstate ${displayName}? They'll get $1,000 cash and be un-bankrupted.`)) return;
    setLoading(true);
    try {
      await reinstateUserFunction({ userId });
      setBankruptUsers(prev => prev.filter(u => u.id !== userId));
      showMessage('success', `Reinstated ${displayName}`);
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed: ${err.message}`);
    }
    setLoading(false);
  };

  const handleSetCash = async (userId, displayName) => {
    const input = prompt(`Set cash for ${displayName}.\nEnter new cash amount:`);
    if (input === null) return;
    const cash = parseFloat(input);
    if (isNaN(cash) || cash < 0) {
      showMessage('error', 'Invalid cash amount');
      return;
    }
    if (!confirm(`Set ${displayName}'s cash to $${cash.toFixed(2)}?`)) return;
    setLoading(true);
    try {
      const result = await adminSetCashFunction({ userId, cash });
      showMessage('success', `Cash set to $${cash.toFixed(2)} (was $${result.data.previousCash})`);
      setSelectedUser(prev => prev ? { ...prev, cash } : prev);
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed: ${err.message}`);
    }
    setLoading(false);
  };

  // Spike victim repair handlers
  const handleScanSpikeVictims = async () => {
    setScanningSpike(true);
    try {
      const result = await repairSpikeVictimsFunction({ mode: 'scan' });
      setSpikeVictims(result.data.victims || []);
      setSpikeScanned(true);
      showMessage('success', `Found ${(result.data.victims || []).length} spike victims`);
    } catch (err) {
      console.error(err);
      showMessage('error', `Scan failed: ${err.message}`);
    }
    setScanningSpike(false);
  };

  const handleRepairSpikeVictim = async (victim) => {
    if (!confirm(`Repair ${victim.displayName}?\nCash: $${victim.currentCash.toFixed(2)} → $${victim.correctedCash.toFixed(2)}${victim.tookBailout ? '\nWill restore ' + victim.holdingsCount + ' stock holdings' : ''}`)) return;
    setRepairingSpike(true);
    try {
      await repairSpikeVictimsFunction({ mode: 'repair', userId: victim.userId, victims: victim });
      setSpikeVictims(prev => prev.filter(v => v.userId !== victim.userId));
      showMessage('success', `Repaired ${victim.displayName}`);
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed to repair ${victim.displayName}: ${err.message}`);
    }
    setRepairingSpike(false);
  };

  const handleRepairAllSpikeVictims = async () => {
    if (spikeVictims.length === 0) return;
    if (!confirm(`Repair ALL ${spikeVictims.length} spike victims? This will restore their cash and clear bankruptcy.`)) return;
    setRepairingSpike(true);
    try {
      const result = await repairSpikeVictimsFunction({ mode: 'repairAll', victims: spikeVictims });
      const successes = (result.data.results || []).filter(r => r.success).length;
      const failures = (result.data.results || []).filter(r => !r.success).length;
      setSpikeVictims([]);
      showMessage('success', `Repaired ${successes} users${failures > 0 ? `, ${failures} failed` : ''}`);
    } catch (err) {
      console.error(err);
      showMessage('error', `Repair all failed: ${err.message}`);
    }
    setRepairingSpike(false);
  };

  const handleDiagnoseUsers = async () => {
    const ids = diagnosisIds.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
    if (ids.length === 0) {
      showMessage('error', 'Enter at least one user ID');
      return;
    }
    setDiagnosing(true);
    try {
      const result = await repairSpikeVictimsFunction({ mode: 'diagnose', userIds: ids });
      setDiagnosisResults(result.data.results || []);
      showMessage('success', `Diagnosed ${(result.data.results || []).length} users`);
    } catch (err) {
      console.error(err);
      showMessage('error', `Diagnose failed: ${err.message}`);
    }
    setDiagnosing(false);
  };

  // Helper function to apply trailing stock effects
  const applyTrailingEffects = (marketUpdates, sourceTicker, sourceOldPrice, sourceNewPrice, timestamp, depth = 0, visited = new Set()) => {
    if (depth > 3 || visited.has(sourceTicker)) {
      return;
    }
    visited.add(sourceTicker);

    const character = CHARACTER_MAP[sourceTicker];
    if (!character?.trailingFactors) {
      return;
    }

    const priceChangePercent = (sourceNewPrice - sourceOldPrice) / (sourceOldPrice || 1);

    character.trailingFactors.forEach(({ ticker: relatedTicker, coefficient }) => {
      // Skip if we've already updated this ticker in this batch
      if (visited.has(relatedTicker)) {
        return;
      }

      // Get the current price - check marketUpdates first, then fall back to prices
      const oldRelatedPrice = marketUpdates[`prices.${relatedTicker}`] || prices[relatedTicker];
      if (oldRelatedPrice) {
        const trailingChange = priceChangePercent * coefficient;
        const newRelatedPrice = oldRelatedPrice * (1 + trailingChange);
        const settledRelatedPrice = Math.max(MIN_PRICE, Math.round(newRelatedPrice * 100) / 100);

        console.log(`[ADMIN TRAILING] ${relatedTicker}: $${oldRelatedPrice} -> $${settledRelatedPrice} (${(trailingChange * 100).toFixed(2)}% from ${sourceTicker})`);

        marketUpdates[`prices.${relatedTicker}`] = settledRelatedPrice;
        marketUpdates[`priceHistory.${relatedTicker}`] = arrayUnion({
          timestamp,
          price: settledRelatedPrice
        });

        // Recursively apply trailing effects with shared visited set (no cloning)
        applyTrailingEffects(marketUpdates, relatedTicker, oldRelatedPrice, settledRelatedPrice, timestamp, depth + 1, visited);
      }
    });
  };

  // Adjust character price
  const handleModalPriceAdjustment = async (character, percentChange) => {
    const currentPrice = prices[character.ticker] || character.basePrice;
    if (!currentPrice) {
      showMessage('error', 'Could not get current price');
      return;
    }

    const percent = parseFloat(percentChange);
    if (isNaN(percent)) {
      showMessage('error', 'Please enter a valid percentage');
      return;
    }

    const targetPrice = Math.round(currentPrice * (1 + percent / 100) * 100) / 100;

    if (targetPrice <= 0) {
      showMessage('error', 'Resulting price would be negative');
      return;
    }

    setLoading(true);
    try {
      const marketRef = doc(db, 'market', 'current');
      const snap = await getDoc(marketRef);
      let now = Date.now();

      if (snap.exists()) {
        const data = snap.data();
        let currentHistory = data.priceHistory?.[character.ticker] || [];

        if (currentHistory.length === 0 && currentPrice) {
          currentHistory = [{ timestamp: now - 1000, price: currentPrice }];
        }

        // Ensure the new timestamp is always greater than the last entry
        const lastTimestamp = currentHistory.length > 0 ? currentHistory[currentHistory.length - 1].timestamp : 0;
        if (now <= lastTimestamp) {
          now = lastTimestamp + 1;
        }

        const updatedHistory = [...currentHistory, { timestamp: now, price: targetPrice }];

        console.log(`Adding price point for ${character.ticker}:`, { timestamp: now, price: targetPrice });
        console.log(`History length: ${currentHistory.length} → ${updatedHistory.length}`);

        // Build market updates with trailing effects
        const marketUpdates = {
          [`prices.${character.ticker}`]: targetPrice,
          [`priceHistory.${character.ticker}`]: updatedHistory
        };

        // Apply trailing stock effects
        console.log(`[ADMIN TRAILING START] Applying effects for ${character.ticker}: $${currentPrice} -> $${targetPrice}`);
        applyTrailingEffects(marketUpdates, character.ticker, currentPrice, targetPrice, now);
        console.log(`[ADMIN TRAILING END] Total updates:`, Object.keys(marketUpdates).length);

        await updateDoc(marketRef, marketUpdates);
      } else {
        await setDoc(marketRef, {
          prices: { [character.ticker]: targetPrice },
          priceHistory: { [character.ticker]: [{ timestamp: now, price: targetPrice }] }
        }, { merge: true });
      }

      const changePercent = ((targetPrice - currentPrice) / currentPrice * 100).toFixed(1);
      const direction = targetPrice > currentPrice ? '📈' : '📉';

      showMessage('success', `${direction} ${character.name}: $${currentPrice.toFixed(2)} → $${targetPrice.toFixed(2)} (${changePercent > 0 ? '+' : ''}${changePercent}%)`);

      // Send spike alert to Discord if 1%+ change
      if (Math.abs(parseFloat(changePercent)) >= 1) {
        try {
          tradeSpikeAlertFunction({
            ticker: character.ticker,
            priceBefore: currentPrice,
            priceAfter: targetPrice,
            tradeType: 'ADJUSTMENT',
            shares: 0
          }).catch(() => {});
        } catch {}
      }

      // Reset modal
      setPriceAdjustPercent('');
      setSelectedPriceCharacter(null);

    } catch (err) {
      console.error('Price adjustment error:', err);
      showMessage('error', 'Failed to adjust price: ' + err.message);
    }

    setLoading(false);
  };

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

        // Build market updates with trailing effects
        const marketUpdates = {
          [`prices.${selectedTicker}`]: targetPrice,
          [`priceHistory.${selectedTicker}`]: updatedHistory
        };

        // Apply trailing stock effects
        console.log(`[ADMIN TRAILING START] Applying effects for ${selectedTicker}: $${currentPrice} -> $${targetPrice}`);
        applyTrailingEffects(marketUpdates, selectedTicker, currentPrice, targetPrice, now);
        console.log(`[ADMIN TRAILING END] Total updates:`, Object.keys(marketUpdates).length);

        await updateDoc(marketRef, marketUpdates);
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

  // List available backups
  const handleListBackups = async () => {
    setLoadingBackups(true);
    try {
      const result = await listBackupsFunction();
      setBackups(result.data.backups || []);
      showMessage('success', `Found ${result.data.total} backups`);
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to list backups: ' + err.message);
    }
    setLoadingBackups(false);
  };

  // Restore from backup
  const handleRestoreBackup = async (backupName) => {
    if (!window.confirm(`⚠️ RESTORE FROM BACKUP?\n\nThis will restore price history from:\n${backupName}\n\nCurrent prices will be synced to match the latest history point.`)) {
      return;
    }

    setRestoringBackup(true);
    try {
      const result = await restoreBackupFunction({ backupName });
      showMessage('success', `✅ Restored ${result.data.tickersRestored} tickers from backup!`);

      // Now sync current prices to match latest history
      await handleSyncPricesToHistory();

      // Refresh backups list
      await handleListBackups();
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to restore backup: ' + err.message);
    }
    setRestoringBackup(false);
  };

  // Clean up recent base price entries from history (fixes reset pollution)
  const handleCleanupBasePrices = async () => {
    if (!window.confirm('⚠️ CLEAN UP BASE PRICES?\n\nThis will remove any recent entries that match base prices.')) {
      return;
    }

    setLoading(true);
    try {
      const marketRef = doc(db, 'market', 'current');
      const snap = await getDoc(marketRef);

      if (!snap.exists()) {
        showMessage('error', 'Market document not found');
        return;
      }

      const data = snap.data();
      const priceHistory = data.priceHistory || {};
      const cleanedHistory = {};
      let tickersCleaned = 0;
      let entriesRemoved = 0;

      // For each ticker, remove recent entries that match base price
      CHARACTERS.forEach(char => {
        const history = priceHistory[char.ticker];
        if (history && history.length > 1) {
          const filtered = history.filter((entry, i) => {
            // Keep all entries except the last one if it matches base price exactly
            if (i === history.length - 1 && Math.abs(entry.price - char.basePrice) < 0.01) {
              entriesRemoved++;
              return false;
            }
            return true;
          });

          if (filtered.length !== history.length) {
            tickersCleaned++;
            cleanedHistory[`priceHistory.${char.ticker}`] = filtered;
          }
        }
      });

      if (Object.keys(cleanedHistory).length > 0) {
        await updateDoc(marketRef, cleanedHistory);
        showMessage('success', `✅ Cleaned ${tickersCleaned} tickers, removed ${entriesRemoved} base price entries!`);
      } else {
        showMessage('info', 'No base price entries found to clean.');
      }
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to cleanup: ' + err.message);
    }
    setLoading(false);
  };

  // Sync current prices to match the latest price history entry
  const handleSyncPricesToHistory = async () => {
    setLoading(true);
    try {
      const marketRef = doc(db, 'market', 'current');
      const snap = await getDoc(marketRef);

      if (!snap.exists()) {
        showMessage('error', 'Market document not found');
        return;
      }

      const data = snap.data();
      const priceHistory = data.priceHistory || {};
      const updatedPrices = {};

      // For each ticker, set current price to the last history entry
      Object.entries(priceHistory).forEach(([ticker, history]) => {
        if (history && history.length > 0) {
          const latestEntry = history[history.length - 1];
          updatedPrices[ticker] = latestEntry.price;
        }
      });

      // Update all prices at once
      await updateDoc(marketRef, {
        prices: updatedPrices
      });

      showMessage('success', `✅ Synced ${Object.keys(updatedPrices).length} prices to match latest history!`);
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to sync prices: ' + err.message);
    }
    setLoading(false);
  };

  // Reset ALL prices to base prices
  const handleResetAllPrices = async () => {
    if (!window.confirm('⚠️ RESET ALL PRICES TO BASE? This will reset the entire market!')) {
      return;
    }

    setLoading(true);
    try {
      const marketRef = doc(db, 'market', 'current');
      const now = Date.now();

      const resetPrices = {};
      const resetHistory = {};

      CHARACTERS.forEach(char => {
        resetPrices[char.ticker] = char.basePrice;
        resetHistory[char.ticker] = [{ timestamp: now, price: char.basePrice }];
      });

      await updateDoc(marketRef, {
        prices: resetPrices,
        priceHistory: resetHistory
      });

      showMessage('success', `✅ Reset ${CHARACTERS.length} characters to base prices!`);
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to reset prices: ' + err.message);
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

      // Send Discord announcement
      try {
        await ipoAnnouncementAlertFunction({
          ticker: ipoTicker,
          characterName: character.name,
          basePrice: character.basePrice,
          ipoPrice: character.basePrice / 1.3,
          endsAt: ipoEndsAt
        });
      } catch (discordErr) {
        console.error('Failed to send IPO announcement to Discord:', discordErr);
        // Don't block IPO creation if Discord fails
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
      return history.slice(-1000).map(h => ({
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
        const totalShortMargin = Object.values(data.shorts || {}).filter(short => short).reduce((sum, short) => sum + (short.margin || 0), 0);
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

  // Extend/Reopen prediction deadline
  const handleExtendPrediction = async () => {
    if (!extendPredictionId) {
      showMessage('error', 'Please select a prediction');
      return;
    }

    setLoading(true);
    try {
      const predictionsRef = doc(db, 'predictions', 'current');
      const snap = await getDoc(predictionsRef);
      const currentList = snap.exists() ? (snap.data().list || []) : [];

      const updatedList = currentList.map(p => {
        if (p.id === extendPredictionId) {
          return {
            ...p,
            endsAt: getEndTime(extendDays),
            allowAdditionalBets: allowAdditionalBets,
            reopened: true
          };
        }
        return p;
      });

      await updateDoc(predictionsRef, { list: updatedList });

      const pred = currentList.find(p => p.id === extendPredictionId);
      showMessage('success', `Extended "${pred?.question}" by ${extendDays} days${allowAdditionalBets ? ' • Additional bets allowed' : ''}`);
      setExtendPredictionId('');
      setExtendDays(7);
      setAllowAdditionalBets(false);
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to extend prediction');
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
          isBankrupt: data.isBankrupt || false,
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

      setAllUsers(users);
      setUserSearchResults(sortUsers(users));
      showMessage('success', `Loaded ${users.length} users`);
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to load users');
    }
    setLoading(false);
  };

  // Helper: Calculate live portfolio value for a user
  const calculateLivePortfolioValue = (userData) => {
    if (!prices || Object.keys(prices).length === 0) return null;

    const holdings = userData.holdings || {};
    const shorts = userData.shorts || {};
    const cash = userData.cash || 0;

    // Calculate holdings value
    let holdingsValue = 0;
    for (const [ticker, holdingData] of Object.entries(holdings)) {
      const currentPrice = prices[ticker] || 0;
      const shares = typeof holdingData === 'number' ? holdingData : (holdingData?.shares || 0);
      holdingsValue += currentPrice * shares;
    }

    // Calculate shorts value (collateral + P&L)
    let shortsValue = 0;
    for (const [ticker, position] of Object.entries(shorts)) {
      if (!position || typeof position !== 'object') continue;
      const shares = position.shares || 0;
      if (shares <= 0) continue;
      const entryPrice = position.costBasis || position.entryPrice || 0;
      const currentPrice = prices[ticker] || entryPrice;
      const collateral = position.margin || 0;
      const pnl = (entryPrice - currentPrice) * shares;
      shortsValue += collateral + pnl;
    }

    return Math.round((cash + holdingsValue + shortsValue) * 100) / 100;
  };

  // Sync portfolio value for a single user
  const handleSyncSingleUser = async (userId) => {
    if (!prices || Object.keys(prices).length === 0) {
      showMessage('error', 'No price data available');
      return;
    }

    setLoading(true);
    try {
      const userRef = doc(db, 'users', userId);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        showMessage('error', 'User not found');
        return;
      }

      const userData = userSnap.data();
      const newPortfolioValue = calculateLivePortfolioValue(userData);

      if (newPortfolioValue === null) {
        showMessage('error', 'Cannot calculate portfolio value');
        return;
      }

      await updateDoc(userRef, {
        portfolioValue: newPortfolioValue,
        lastSyncedAt: new Date()
      });

      showMessage('success', `Synced ${userData.displayName}'s portfolio`);

      // Update selected user and reload users list
      if (selectedUser && selectedUser.id === userId) {
        setSelectedUser({ ...userData, id: userId, portfolioValue: newPortfolioValue, lastSyncedAt: new Date() });
      }
      await handleLoadAllUsers();
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed to sync: ${err.message}`);
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
        const newPortfolioValue = calculateLivePortfolioValue(userData);

        if (newPortfolioValue === null) continue;

        // Only update if different
        if (Math.abs(newPortfolioValue - (userData.portfolioValue || 0)) > 0.01) {
          await updateDoc(doc(db, 'users', userDoc.id), {
            portfolioValue: newPortfolioValue,
            lastSyncedAt: new Date()
          });
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
  // Apply sorting to users
  const sortUsers = (users) => {
    const sorted = [...users];
    switch (userSortBy) {
      case 'portfolio-high':
        return sorted.sort((a, b) => (b.portfolioValue || 0) - (a.portfolioValue || 0));
      case 'portfolio-low':
        return sorted.sort((a, b) => (a.portfolioValue || 0) - (b.portfolioValue || 0));
      case 'cash-high':
        return sorted.sort((a, b) => (b.cash || 0) - (a.cash || 0));
      case 'cash-low':
        return sorted.sort((a, b) => (a.cash || 0) - (b.cash || 0));
      default:
        return sorted;
    }
  };

  const handleUserSearch = (query) => {
    setUserSearchQuery(query);
    if (!query.trim()) {
      setUserSearchResults(sortUsers(allUsers));
      return;
    }

    const filtered = allUsers.filter(u =>
      u.displayName.toLowerCase().includes(query.toLowerCase()) ||
      u.id.toLowerCase().includes(query.toLowerCase())
    );
    setUserSearchResults(sortUsers(filtered));
  };

  // Handle sort change
  const handleUserSortChange = (newSort) => {
    setUserSortBy(newSort);
    // Re-apply current search with new sort
    handleUserSearch(userSearchQuery);
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

  // Scan for future price history entries
  const handleScanFutureEntries = async () => {
    setScanningHistory(true);
    try {
      const marketRef = doc(db, 'market', 'current');
      const marketSnap = await getDoc(marketRef);

      if (!marketSnap.exists()) {
        showMessage('error', 'Market data not found');
        setScanningHistory(false);
        return;
      }

      const priceHistory = marketSnap.data().priceHistory || {};
      const now = Date.now();
      const futureFound = [];

      // Check each ticker's price history
      for (const [ticker, history] of Object.entries(priceHistory)) {
        if (!Array.isArray(history)) continue;

        const badEntries = history.filter(entry => entry.timestamp > now);
        if (badEntries.length > 0) {
          futureFound.push({
            ticker,
            count: badEntries.length,
            entries: badEntries.map(e => ({
              timestamp: e.timestamp,
              price: e.price,
              date: new Date(e.timestamp).toLocaleString()
            }))
          });
        }
      }

      setFutureEntries(futureFound);
      showMessage('success', `Scan complete. Found ${futureFound.reduce((sum, t) => sum + t.count, 0)} future entries across ${futureFound.length} tickers.`);
    } catch (err) {
      console.error(err);
      showMessage('error', `Scan failed: ${err.message}`);
    }
    setScanningHistory(false);
  };

  // Remove future price history entries
  const handleCleanupFutureEntries = async () => {
    if (futureEntries.length === 0) return;

    if (!confirm(`This will remove ${futureEntries.reduce((sum, t) => sum + t.count, 0)} future price history entries. Continue?`)) {
      return;
    }

    setLoading(true);
    try {
      const marketRef = doc(db, 'market', 'current');
      const marketSnap = await getDoc(marketRef);

      if (!marketSnap.exists()) {
        showMessage('error', 'Market data not found');
        setLoading(false);
        return;
      }

      const priceHistory = marketSnap.data().priceHistory || {};
      const now = Date.now();
      const updates = {};

      // Clean each ticker's history
      for (const [ticker, history] of Object.entries(priceHistory)) {
        if (!Array.isArray(history)) continue;

        const cleanedHistory = history.filter(entry => entry.timestamp <= now);
        if (cleanedHistory.length !== history.length) {
          updates[`priceHistory.${ticker}`] = cleanedHistory;
        }
      }

      if (Object.keys(updates).length > 0) {
        await updateDoc(marketRef, updates);
        showMessage('success', `Cleaned up ${futureEntries.reduce((sum, t) => sum + t.count, 0)} future entries!`);
        setFutureEntries([]);
      } else {
        showMessage('info', 'No changes needed');
      }
    } catch (err) {
      console.error(err);
      showMessage('error', `Cleanup failed: ${err.message}`);
    }
    setLoading(false);
  };

  // Scan for check-in fraud (future dates)
  const handleScanCheckinFraud = async () => {
    setScanningFraud(true);
    try {
      const usersRef = collection(db, 'users');
      const usersSnap = await getDocs(usersRef);

      const now = new Date();
      const todayString = now.toISOString().split('T')[0]; // YYYY-MM-DD
      const fraudFound = [];

      usersSnap.forEach(doc => {
        const user = doc.data();
        const dailyMissions = user.dailyMissions || {};
        const futureCheckins = [];

        // Check each date in dailyMissions
        for (const [dateStr, missions] of Object.entries(dailyMissions)) {
          if (missions.checkedIn) {
            const checkinDate = new Date(dateStr);
            if (checkinDate > now) {
              futureCheckins.push({
                date: dateStr,
                daysInFuture: Math.ceil((checkinDate - now) / (1000 * 60 * 60 * 24))
              });
            }
          }
        }

        if (futureCheckins.length > 0) {
          const fraudulentBonus = futureCheckins.length * 300; // $300 per check-in
          const correctedCheckins = (user.totalCheckins || 0) - futureCheckins.length;
          const legitimateCash = 1000 + (correctedCheckins * 300); // $1000 starting + legitimate bonuses
          fraudFound.push({
            userId: doc.id,
            displayName: user.displayName || 'Unknown',
            cash: user.cash || 0,
            portfolioValue: user.portfolioValue || 0,
            totalCheckins: user.totalCheckins || 0,
            futureCheckins,
            fraudulentBonus,
            correctedCheckins,
            legitimateCash
          });
        }
      });

      // Sort by amount of fraud
      fraudFound.sort((a, b) => b.fraudulentBonus - a.fraudulentBonus);

      setFraudUsers(fraudFound);
      showMessage('success', `Scan complete. Found ${fraudFound.length} users with future check-ins totaling $${fraudFound.reduce((sum, u) => sum + u.fraudulentBonus, 0).toLocaleString()}`);
    } catch (err) {
      console.error(err);
      showMessage('error', `Scan failed: ${err.message}`);
    }
    setScanningFraud(false);
  };

  // Fix a single user's fraudulent check-ins
  const handleFixUserCheckins = async (userId, fraudData) => {
    // Calculate legitimate cash: $1000 starting + (legitimate check-ins × $300)
    const legitimateCash = 1000 + (fraudData.correctedCheckins * 300);

    if (!confirm(`⚠️ NUCLEAR OPTION ⚠️\n\nFix ${fraudData.displayName}'s fraud?\n\nThis will:\n- LIQUIDATE all positions (they used fraudulent money to buy stocks)\n- Reset cash to $${legitimateCash.toLocaleString()} (${fraudData.correctedCheckins} legitimate check-ins × $300)\n- Remove ${fraudData.futureCheckins.length} future check-ins\n\nCurrent portfolio: $${fraudData.cash.toLocaleString()}\nAfter fix: $${legitimateCash.toLocaleString()}\n\nThis cannot be undone!`)) {
      return;
    }

    setLoading(true);
    try {
      const userRef = doc(db, 'users', userId);
      const updates = {
        cash: legitimateCash,
        totalCheckins: fraudData.correctedCheckins,
        holdings: {}, // Liquidate all positions
        shorts: {}, // Close all shorts
        costBasis: {}, // Reset cost basis
        portfolioValue: legitimateCash,
        marginUsed: 0
      };

      // Remove future check-in entries from dailyMissions
      for (const checkin of fraudData.futureCheckins) {
        updates[`dailyMissions.${checkin.date}`] = {}; // Clear the entire day's missions
      }

      await updateDoc(userRef, updates);
      showMessage('success', `Liquidated ${fraudData.displayName}'s account! Reset to $${legitimateCash.toLocaleString()}`);

      // Remove from list
      setFraudUsers(prev => prev.filter(u => u.userId !== userId));
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed to fix user: ${err.message}`);
    }
    setLoading(false);
  };

  // Fix all fraudulent check-ins
  const handleFixAllCheckins = async () => {
    if (fraudUsers.length === 0) return;

    const totalFraud = fraudUsers.reduce((sum, u) => sum + u.fraudulentBonus, 0);
    const totalUsers = fraudUsers.length;

    if (!confirm(`⚠️ NUCLEAR OPTION ⚠️\n\nFix ALL ${totalUsers} users with fraudulent check-ins?\n\nThis will:\n- LIQUIDATE all their positions\n- Reset each to legitimate cash only\n- Remove $${totalFraud.toLocaleString()} from the economy\n\nThis action cannot be undone!`)) {
      return;
    }

    setLoading(true);
    let fixed = 0;
    let failed = 0;

    for (const fraudData of fraudUsers) {
      try {
        const legitimateCash = 1000 + (fraudData.correctedCheckins * 300);
        const userRef = doc(db, 'users', fraudData.userId);
        const updates = {
          cash: legitimateCash,
          totalCheckins: fraudData.correctedCheckins,
          holdings: {},
          shorts: {},
          costBasis: {},
          portfolioValue: legitimateCash,
          marginUsed: 0
        };

        // Remove future check-in entries
        for (const checkin of fraudData.futureCheckins) {
          updates[`dailyMissions.${checkin.date}`] = {};
        }

        await updateDoc(userRef, updates);
        fixed++;
      } catch (err) {
        console.error('Failed to fix', fraudData.displayName, err);
        failed++;
      }
    }

    showMessage('success', `Liquidated ${fixed} users! ${failed > 0 ? `Failed: ${failed}` : ''}`);
    setFraudUsers([]);
    setLoading(false);
  };

  // Scan for trade fraud (future-dated trades)
  const handleScanTradeFraud = async () => {
    setScanningTradeFraud(true);
    try {
      const usersRef = collection(db, 'users');
      const usersSnap = await getDocs(usersRef);

      const now = Date.now();
      const fraudFound = [];

      usersSnap.forEach(doc => {
        const user = doc.data();
        const transactionLog = user.transactionLog || [];
        const futureTrades = [];

        // Check each transaction for future timestamps
        transactionLog.forEach((tx, index) => {
          if (tx.timestamp > now) {
            futureTrades.push({
              index,
              type: tx.type,
              ticker: tx.ticker,
              shares: tx.shares || tx.amount || 0,
              price: tx.pricePerShare || tx.price || 0,
              timestamp: tx.timestamp,
              date: new Date(tx.timestamp).toLocaleString(),
              daysInFuture: ((tx.timestamp - now) / (1000 * 60 * 60 * 24)).toFixed(1)
            });
          }
        });

        if (futureTrades.length > 0) {
          fraudFound.push({
            userId: doc.id,
            displayName: user.displayName || 'Unknown',
            cash: user.cash || 0,
            portfolioValue: user.portfolioValue || 0,
            holdings: user.holdings || {},
            shorts: user.shorts || {},
            futureTrades,
            totalFutureTrades: futureTrades.length
          });
        }
      });

      // Sort by number of future trades
      fraudFound.sort((a, b) => b.totalFutureTrades - a.totalFutureTrades);

      setTradeFraudUsers(fraudFound);
      showMessage('success', `Scan complete. Found ${fraudFound.length} users with ${fraudFound.reduce((sum, u) => sum + u.totalFutureTrades, 0)} future-dated trades`);
    } catch (err) {
      console.error(err);
      showMessage('error', `Scan failed: ${err.message}`);
    }
    setScanningTradeFraud(false);
  };

  // Fix a single user's fraudulent trades
  const handleFixUserTrades = async (userId, fraudData) => {
    if (!confirm(`⚠️ NUCLEAR OPTION ⚠️\n\nFix ${fraudData.displayName}'s future-dated trades?\n\nThis will:\n- LIQUIDATE all positions (they used time travel to make trades)\n- DELETE all future-dated transactions from their log\n- Reset cash to $1000 (starting balance)\n- Reset portfolio value to $1000\n\nCurrent portfolio: $${fraudData.portfolioValue.toLocaleString()}\nFuture trades: ${fraudData.totalFutureTrades}\n\nThis cannot be undone!`)) {
      return;
    }

    setLoading(true);
    try {
      const userRef = doc(db, 'users', userId);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        showMessage('error', 'User not found');
        setLoading(false);
        return;
      }

      const userData = userSnap.data();
      const transactionLog = userData.transactionLog || [];
      const now = Date.now();

      // Filter out all future-dated transactions
      const cleanedLog = transactionLog.filter(tx => tx.timestamp <= now);

      const updates = {
        cash: 1000, // Reset to starting balance
        totalCheckins: 0, // Reset check-ins as well
        holdings: {}, // Liquidate all positions
        shorts: {}, // Close all shorts
        costBasis: {}, // Reset cost basis
        portfolioValue: 1000,
        marginUsed: 0,
        transactionLog: cleanedLog
      };

      await updateDoc(userRef, updates);
      showMessage('success', `Liquidated ${fraudData.displayName}'s account! Removed ${fraudData.totalFutureTrades} future trades. Reset to $1,000`);

      // Remove from list
      setTradeFraudUsers(prev => prev.filter(u => u.userId !== userId));
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed to fix user: ${err.message}`);
    }
    setLoading(false);
  };

  // Fix all users with fraudulent trades
  const handleFixAllTradeFraud = async () => {
    if (tradeFraudUsers.length === 0) return;

    const totalTrades = tradeFraudUsers.reduce((sum, u) => sum + u.totalFutureTrades, 0);
    const totalUsers = tradeFraudUsers.length;

    if (!confirm(`⚠️ NUCLEAR OPTION ⚠️\n\nFix ALL ${totalUsers} users with future-dated trades?\n\nThis will:\n- LIQUIDATE all their positions\n- Remove ${totalTrades} future-dated trades\n- Reset each to $1,000 starting balance\n\nThis action cannot be undone!`)) {
      return;
    }

    setLoading(true);
    let fixed = 0;
    let failed = 0;

    for (const fraudData of tradeFraudUsers) {
      try {
        const userRef = doc(db, 'users', fraudData.userId);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
          failed++;
          continue;
        }

        const userData = userSnap.data();
        const transactionLog = userData.transactionLog || [];
        const now = Date.now();

        // Filter out all future-dated transactions
        const cleanedLog = transactionLog.filter(tx => tx.timestamp <= now);

        const updates = {
          cash: 1000,
          totalCheckins: 0,
          holdings: {},
          shorts: {},
          costBasis: {},
          portfolioValue: 1000,
          marginUsed: 0,
          transactionLog: cleanedLog
        };

        await updateDoc(userRef, updates);
        fixed++;
      } catch (err) {
        console.error('Failed to fix', fraudData.displayName, err);
        failed++;
      }
    }

    showMessage('success', `Liquidated ${fixed} users! ${failed > 0 ? `Failed: ${failed}` : ''}`);
    setTradeFraudUsers([]);
    setLoading(false);
  };

  // Rollback user to a specific transaction timestamp
  const handleRollbackUser = async (userId, transaction) => {
    if (!confirm(`⚠️ ROLLBACK USER ⚠️\n\nRoll back to transaction from ${new Date(transaction.timestamp).toLocaleString()}?\n\nThis will:\n- Set cash to $${transaction.cashAfter?.toLocaleString() || '0'}\n- Set portfolio to $${transaction.portfolioAfter?.toLocaleString() || '0'}\n- You'll need to manually fix holdings/shorts\n\nContinue?`)) {
      return;
    }

    setLoading(true);
    try {
      const userRef = doc(db, 'users', userId);
      await updateDoc(userRef, {
        cash: transaction.cashAfter || 0,
        portfolioValue: transaction.portfolioAfter || 0
      });

      showMessage('success', `Rolled back user to ${new Date(transaction.timestamp).toLocaleString()}!`);
      setRollbackTarget(null);

      // Refresh selected user data
      const updatedSnap = await getDoc(userRef);
      if (updatedSnap.exists()) {
        setSelectedUser({ id: updatedSnap.id, ...updatedSnap.data() });
      }
    } catch (err) {
      console.error(err);
      showMessage('error', `Rollback failed: ${err.message}`);
    }
    setLoading(false);
  };

  // Transfer all data from old user to new user
  const handleTransferUserData = async () => {
    if (!oldUserId.trim() || !newUserId.trim()) {
      showMessage('error', 'Please enter both old and new user IDs');
      return;
    }

    if (oldUserId.trim() === newUserId.trim()) {
      showMessage('error', 'Old and new user IDs cannot be the same');
      return;
    }

    setTransferring(true);
    try {
      const oldUserRef = doc(db, 'users', oldUserId.trim());
      const newUserRef = doc(db, 'users', newUserId.trim());

      // Get old user data
      const oldUserSnap = await getDoc(oldUserRef);
      if (!oldUserSnap.exists()) {
        showMessage('error', `Old user ID not found: ${oldUserId}`);
        setTransferring(false);
        return;
      }

      // Get new user data (to show what will be overwritten)
      const newUserSnap = await getDoc(newUserRef);
      if (!newUserSnap.exists()) {
        showMessage('error', `New user ID not found: ${newUserId}`);
        setTransferring(false);
        return;
      }

      const oldData = oldUserSnap.data();
      const newData = newUserSnap.data();

      // Confirm the transfer
      if (!confirm(`⚠️ TRANSFER USER DATA ⚠️\n\nCopy ALL data from old user to new user?\n\nOLD USER: ${oldData.displayName || 'Unknown'}\nPortfolio: $${(oldData.portfolioValue || 0).toLocaleString()}\nCheck-ins: ${oldData.totalCheckins || 0}\n\nNEW USER: ${newData.displayName || 'Unknown'}\nPortfolio: $${(newData.portfolioValue || 0).toLocaleString()}\nCheck-ins: ${newData.totalCheckins || 0}\n\nThe NEW user's data will be COMPLETELY OVERWRITTEN with the OLD user's data.\n\nContinue?`)) {
        setTransferring(false);
        return;
      }

      // Copy ALL data from old to new (except the user ID itself)
      const dataToTransfer = { ...oldData };

      // Update the new user with all old user's data
      await updateDoc(newUserRef, dataToTransfer);

      showMessage('success', `Successfully transferred data from ${oldData.displayName} to new account!`);

      // Ask if they want to delete the old account
      if (confirm(`Transfer complete!\n\nDo you want to DELETE the old user account?\n\nOld User: ${oldData.displayName}\nID: ${oldUserId}\n\nThis cannot be undone!`)) {
        await deleteDoc(oldUserRef);
        showMessage('success', `Old user account deleted.`);
      }

      setOldUserId('');
      setNewUserId('');
    } catch (err) {
      console.error(err);
      showMessage('error', `Transfer failed: ${err.message}`);
    }
    setTransferring(false);
  };

  // Change user's display name
  const handleChangeDisplayName = async (userId, newName) => {
    if (!newName || newName.trim().length === 0) {
      showMessage('error', 'Display name cannot be empty');
      return;
    }

    if (!confirm(`Change display name to "${newName}"?`)) {
      return;
    }

    setLoading(true);
    try {
      const userRef = doc(db, 'users', userId);
      await updateDoc(userRef, {
        displayName: newName.trim(),
        displayNameLower: newName.trim().toLowerCase()
      });

      showMessage('success', `Changed display name to "${newName}"!`);
      setNewDisplayName('');

      // Refresh selected user data
      const updatedSnap = await getDoc(userRef);
      if (updatedSnap.exists()) {
        setSelectedUser({ id: updatedSnap.id, ...updatedSnap.data() });
      }
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed to change name: ${err.message}`);
    }
    setLoading(false);
  };

  const handleCreateBots = async () => {
    if (!confirm(`Create 20 bot traders?\n\nEach bot will get their starting cash and begin trading automatically.`)) {
      return;
    }

    setBotsLoading(true);
    try {
      const result = await createBotsFunction();
      showMessage('success', result.data.message);
      await handleLoadBots();
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed to create bots: ${err.message}`);
    }
    setBotsLoading(false);
  };

  const handleLoadBots = async () => {
    setBotsLoading(true);
    try {
      const usersRef = collection(db, 'users');
      const usersSnap = await getDocs(usersRef);
      const botList = [];

      usersSnap.forEach(doc => {
        const data = doc.data();
        if (data.isBot) {
          botList.push({ id: doc.id, ...data });
        }
      });

      setBots(botList.sort((a, b) => a.displayName.localeCompare(b.displayName)));
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed to load bots: ${err.message}`);
    }
    setBotsLoading(false);
  };

  const handleDeleteBot = async (botId) => {
    if (!confirm(`Delete bot ${botId}?\n\nThis will remove their account and all holdings.`)) {
      return;
    }

    setLoading(true);
    try {
      await deleteDoc(doc(db, 'users', botId));
      showMessage('success', 'Bot deleted!');
      await handleLoadBots();
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed to delete bot: ${err.message}`);
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
            <div className="flex gap-2">
              <button
                onClick={() => setShowPriceModal(true)}
                className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-sm"
              >
                💰 Adjust Prices
              </button>
              <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-teal-600 text-xl`}>×</button>
            </div>
          </div>
        </div>

        {/* Tabs - Responsive grid layout */}
        <div className={`grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 border-b ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
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
            onClick={() => { setActiveTab('bots'); handleLoadBots(); }}
            className={`py-2.5 text-xs font-semibold transition-colors ${activeTab === 'bots' ? 'text-purple-500 border-b-2 border-purple-500 bg-purple-500/10' : `${mutedClass} hover:bg-slate-500/10`}`}
          >
            🤖 Bots
          </button>
          <button
            onClick={() => { setActiveTab('trades'); loadRecentTrades(tradeTimePeriod, tradeTypeFilter, tradeFilterTicker, tradeBotFilter); }}
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
          <button
            onClick={() => { setActiveTab('badges'); loadBadgeUsers(); }}
            className={`py-2.5 text-xs font-semibold transition-colors ${activeTab === 'badges' ? 'text-amber-500 border-b-2 border-amber-500 bg-amber-500/10' : `${mutedClass} hover:bg-slate-500/10`}`}
          >
            🏅 Badges
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

              {/* SECTION 3: Extend/Reopen Prediction */}
              {predictions.length > 0 && (
                <div className={`p-4 rounded-sm border-2 border-blue-500 ${darkMode ? 'bg-blue-900/20' : 'bg-blue-50'}`}>
                  <h3 className={`font-semibold text-blue-500 mb-3`}>⏰ Extend/Reopen Prediction</h3>
                  <div className="space-y-3">
                    <div>
                      <label className={`block text-xs font-semibold uppercase mb-2 ${mutedClass}`}>Select Prediction</label>
                      <select
                        value={extendPredictionId}
                        onChange={e => setExtendPredictionId(e.target.value)}
                        className={`w-full px-3 py-2 border rounded-sm ${inputClass}`}
                      >
                        <option value="">-- Choose prediction --</option>
                        {predictions.map(p => {
                          const isClosed = p.endsAt < Date.now();
                          const status = p.resolved ? '✅ Resolved' : isClosed ? '🔒 Closed' : '⏳ Active';
                          return (
                            <option key={p.id} value={p.id}>
                              {status} - {p.question}
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    {extendPredictionId && (
                      <>
                        <div>
                          <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Extend By (Days)</label>
                          <div className="flex items-center gap-3">
                            <input
                              type="range"
                              min="1"
                              max="14"
                              value={extendDays}
                              onChange={e => setExtendDays(parseInt(e.target.value))}
                              className="flex-1"
                            />
                            <span className={`text-lg font-semibold ${textClass} w-20`}>{extendDays} days</span>
                          </div>
                          <p className={`text-xs ${mutedClass} mt-1`}>
                            New deadline: {new Date(getEndTime(extendDays)).toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="allowAdditionalBets"
                            checked={allowAdditionalBets}
                            onChange={e => setAllowAdditionalBets(e.target.checked)}
                            className="w-4 h-4 cursor-pointer"
                          />
                          <label htmlFor="allowAdditionalBets" className={`text-sm cursor-pointer ${textClass}`}>
                            Allow users to add to existing bets
                          </label>
                        </div>
                        {allowAdditionalBets && (
                          <p className={`text-xs ${mutedClass} pl-6`}>
                            Users who already bet can add more money to their original choice (cannot change or remove)
                          </p>
                        )}

                        <button
                          onClick={handleExtendPrediction}
                          disabled={loading}
                          className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-sm disabled:opacity-50"
                        >
                          {loading ? 'Extending...' : '⏰ Extend Prediction'}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* SECTION 4: All Predictions List */}
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

              {/* SECTION 5: Bets Summary */}
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
                  📊 View all users who hold shares of a specific character. Click a character to see their holders.
                </p>
              </div>

              <div>
                <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Search Characters</label>
                <input
                  type="text"
                  placeholder="Filter by name or ticker..."
                  value={holdersTicker}
                  onChange={e => setHoldersTicker(e.target.value)}
                  className={`w-full px-3 py-2 border rounded-sm ${inputClass} mb-3`}
                />

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 max-h-96 overflow-y-auto p-2">
                  {CHARACTERS
                    .filter(c => {
                      const searchTerm = holdersTicker.toLowerCase();
                      return !searchTerm ||
                             c.name.toLowerCase().includes(searchTerm) ||
                             c.ticker.toLowerCase().includes(searchTerm);
                    })
                    .map(c => {
                      const currentPrice = prices[c.ticker] || c.basePrice;
                      return (
                        <button
                          key={c.ticker}
                          onClick={() => {
                            setHoldersTicker(c.ticker);
                            loadHolders(c.ticker);
                          }}
                          className={`p-3 rounded-sm text-left transition-all ${
                            darkMode
                              ? 'bg-slate-800 hover:bg-slate-700 border border-slate-700'
                              : 'bg-white hover:bg-blue-50 border border-slate-200'
                          }`}
                        >
                          <div className={`text-xs font-semibold ${mutedClass} mb-1`}>${c.ticker}</div>
                          <div className={`text-sm font-semibold ${textClass} truncate`}>{c.name}</div>
                          <div className={`text-xs text-green-500 mt-1`}>${currentPrice.toFixed(2)}</div>
                        </button>
                      );
                    })}
                </div>
              </div>

              {holdersTicker && CHARACTERS.find(c => c.ticker === holdersTicker) && (
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <h3 className={`font-semibold ${textClass}`}>
                      ${holdersTicker} - {CHARACTERS.find(c => c.ticker === holdersTicker)?.name} ({holdersData.length} holders)
                    </h3>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setHoldersTicker('');
                          setHoldersData([]);
                        }}
                        className="px-3 py-1 text-xs bg-slate-600 hover:bg-slate-700 text-white rounded-sm"
                      >
                        ← Back
                      </button>
                      <button
                        onClick={() => loadHolders(holdersTicker)}
                        disabled={holdersLoading}
                        className="px-3 py-1 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded-sm disabled:opacity-50"
                      >
                        {holdersLoading ? '...' : '🔄 Refresh'}
                      </button>
                    </div>
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
                <select
                  value={userSortBy}
                  onChange={e => handleUserSortChange(e.target.value)}
                  className={`px-3 py-2 border rounded-sm ${inputClass}`}
                >
                  <option value="portfolio-high">Portfolio: High → Low</option>
                  <option value="portfolio-low">Portfolio: Low → High</option>
                  <option value="cash-high">Cash: High → Low</option>
                  <option value="cash-low">Cash: Low → High</option>
                </select>
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
                      <div className="flex items-center justify-between">
                        <div className={`text-xs ${mutedClass}`}>Cash</div>
                        <button
                          onClick={() => handleSetCash(selectedUser.id, selectedUser.displayName || selectedUser.username)}
                          disabled={loading}
                          className="text-[10px] px-1.5 py-0.5 bg-yellow-600 hover:bg-yellow-700 text-white rounded disabled:opacity-50"
                        >Set</button>
                      </div>
                      <div className={`font-bold ${isNaN(selectedUser.cash) ? 'text-red-500' : 'text-green-500'}`}>
                        {isNaN(selectedUser.cash) ? '$NaN' : `$${selectedUser.cash.toFixed(2)}`}
                      </div>
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

                  {/* Sync Status */}
                  {(() => {
                    const liveValue = calculateLivePortfolioValue(selectedUser);
                    const storedValue = selectedUser.portfolioValue || 0;
                    const difference = liveValue !== null ? Math.abs(liveValue - storedValue) : 0;
                    const isOutOfSync = difference > 0.01;
                    const lastSynced = selectedUser.lastSyncedAt;

                    return (
                      <div className={`p-3 rounded mb-4 ${darkMode ? 'bg-slate-600' : 'bg-white'}`}>
                        <div className="flex items-center justify-between mb-2">
                          <h4 className={`text-xs font-semibold uppercase ${mutedClass}`}>🔄 Sync Status</h4>
                          <button
                            onClick={() => handleSyncSingleUser(selectedUser.id)}
                            disabled={loading}
                            className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded disabled:opacity-50"
                          >
                            {loading ? '...' : 'Sync Now'}
                          </button>
                        </div>

                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <div className={`text-xs ${mutedClass}`}>Stored Value</div>
                            <div className={`font-bold ${textClass}`}>${storedValue.toFixed(2)}</div>
                          </div>
                          <div>
                            <div className={`text-xs ${mutedClass}`}>Calculated Value</div>
                            <div className={`font-bold ${liveValue !== null ? (isOutOfSync ? 'text-orange-500' : 'text-green-500') : mutedClass}`}>
                              {liveValue !== null ? `$${liveValue.toFixed(2)}` : 'N/A'}
                            </div>
                          </div>
                          <div>
                            <div className={`text-xs ${mutedClass}`}>Difference</div>
                            <div className={`font-bold ${isOutOfSync ? 'text-red-500' : 'text-green-500'}`}>
                              {liveValue !== null ? `$${difference.toFixed(2)}` : 'N/A'}
                            </div>
                          </div>
                          <div>
                            <div className={`text-xs ${mutedClass}`}>Status</div>
                            <div className={`font-bold text-xs ${isOutOfSync ? 'text-orange-500' : 'text-green-500'}`}>
                              {isOutOfSync ? '⚠️ Out of Sync' : '✅ Synced'}
                            </div>
                          </div>
                        </div>

                        {lastSynced && (
                          <div className={`mt-2 pt-2 border-t ${darkMode ? 'border-slate-500' : 'border-slate-200'} text-xs ${mutedClass}`}>
                            Last synced: {lastSynced instanceof Date ? lastSynced.toLocaleString() : new Date(lastSynced.seconds * 1000).toLocaleString()}
                          </div>
                        )}
                      </div>
                    );
                  })()}

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
                            const avgCost = selectedUser.costBasis?.[ticker] || 0; // This is avg cost per share
                            const totalCost = avgCost * shareCount;
                            const unrealizedPL = currentValue - totalCost;
                            const unrealizedPct = avgCost > 0 ? (((currentPrice - avgCost) / avgCost) * 100) : 0;

                            return { ticker, shareCount, currentPrice, currentValue, totalCost, avgCost, unrealizedPL, unrealizedPct };
                          })
                          .filter(h => h !== null)
                          .sort((a, b) => b.unrealizedPL - a.unrealizedPL)
                          .map(({ ticker, shareCount, currentPrice, currentValue, totalCost, avgCost, unrealizedPL, unrealizedPct }) => (
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
                                Avg cost: ${avgCost.toFixed(2)} → Price: ${currentPrice.toFixed(2)} ({unrealizedPct >= 0 ? '+' : ''}{unrealizedPct.toFixed(1)}%)
                              </div>
                              <div className={`text-xs ${mutedClass}`}>
                                Total cost: ${totalCost.toFixed(2)} → Value: ${currentValue.toFixed(2)}
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
                          const entryPrice = shortData.costBasis || shortData.entryPrice || 0;
                          const currentPrice = prices[ticker] || entryPrice;
                          const pnl = (entryPrice - currentPrice) * shortData.shares;
                          const pnlPct = entryPrice > 0 ? ((pnl / (entryPrice * shortData.shares)) * 100) : 0;
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
                                Entry: ${entryPrice?.toFixed(2)} → Current: ${currentPrice.toFixed(2)} ({pnl >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%)
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

                  {/* Display Name Editor */}
                  <div className={`p-3 rounded mb-4 ${darkMode ? 'bg-slate-600' : 'bg-white'}`}>
                    <h4 className={`text-xs font-semibold uppercase ${mutedClass} mb-2`}>⚙️ Manual Tools</h4>
                    <div className="space-y-2">
                      <div>
                        <label className={`text-xs ${mutedClass} block mb-1`}>Change Display Name:</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={newDisplayName}
                            onChange={(e) => setNewDisplayName(e.target.value)}
                            placeholder={selectedUser.displayName}
                            className={`flex-1 px-2 py-1 text-sm rounded border ${
                              darkMode
                                ? 'bg-slate-700 border-slate-600 text-white'
                                : 'bg-white border-slate-300 text-slate-900'
                            }`}
                          />
                          <button
                            onClick={() => handleChangeDisplayName(selectedUser.id, newDisplayName)}
                            disabled={!newDisplayName || newDisplayName.trim().length === 0}
                            className={`px-3 py-1 text-xs font-semibold rounded ${
                              newDisplayName && newDisplayName.trim().length > 0
                                ? 'bg-blue-600 text-white hover:bg-blue-700'
                                : 'bg-slate-400 text-slate-200 cursor-not-allowed'
                            }`}
                          >
                            Update
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

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
                            <div className={`${mutedClass} mt-1 flex justify-between items-center`}>
                              <span>Cash: ${tx.cashBefore?.toFixed(2)} → ${tx.cashAfter?.toFixed(2)}</span>
                              <button
                                onClick={() => handleRollbackUser(selectedUser.id, tx)}
                                className="ml-2 px-2 py-0.5 text-xs bg-orange-600 text-white rounded hover:bg-orange-700"
                              >
                                ⏮ Rollback
                              </button>
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
                                {(u.isBankrupt || u.portfolioValue <= 100) && <span className="ml-2 text-xs text-red-500">💔 Bankrupt</span>}
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

          {/* BOTS TAB */}
          {activeTab === 'bots' && (
            <div className="space-y-4">
              {/* Bot List */}
              {bots.length > 0 && (
                <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                  <h3 className={`text-sm font-semibold ${textClass} mb-3`}>Active Bots ({bots.length})</h3>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {bots.map(bot => {
                      const holdingsValue = Object.entries(bot.holdings || {}).reduce((sum, [ticker, shares]) => {
                        const shareCount = typeof shares === 'number' ? shares : (shares?.shares || 0);
                        return sum + (prices[ticker] || 0) * shareCount;
                      }, 0);

                      return (
                        <div key={bot.id} className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700' : 'bg-slate-100'}`}>
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className={`font-semibold ${textClass}`}>{bot.displayName}</span>
                                <span className="text-xs px-2 py-0.5 rounded bg-purple-600 text-white">
                                  {bot.botPersonality}
                                </span>
                                {bot.botCrew && (
                                  <span className="text-xs px-2 py-0.5 rounded bg-blue-600 text-white">
                                    {bot.botCrew}
                                  </span>
                                )}
                              </div>
                              <div className="grid grid-cols-4 gap-3 mt-2 text-xs">
                                <div>
                                  <span className={mutedClass}>Cash:</span>
                                  <span className={`ml-1 font-semibold text-green-500`}>
                                    ${bot.cash?.toFixed(2) || '0.00'}
                                  </span>
                                </div>
                                <div>
                                  <span className={mutedClass}>Holdings:</span>
                                  <span className={`ml-1 font-semibold ${textClass}`}>
                                    ${holdingsValue.toFixed(2)}
                                  </span>
                                </div>
                                <div>
                                  <span className={mutedClass}>Portfolio:</span>
                                  <span className={`ml-1 font-semibold ${textClass}`}>
                                    ${bot.portfolioValue?.toFixed(2) || '0.00'}
                                  </span>
                                </div>
                                <div>
                                  <span className={mutedClass}>Trades:</span>
                                  <span className={`ml-1 font-semibold ${textClass}`}>
                                    {bot.totalTrades || 0}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <button
                              onClick={() => handleDeleteBot(bot.id)}
                              className="ml-3 px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {bots.length === 0 && !botsLoading && (
                <p className={`text-center ${mutedClass} py-8`}>
                  No bots found.
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

                  {/* Bot Filter */}
                  <div>
                    <label className={`text-xs ${mutedClass} block mb-1`}>User Type</label>
                    <select
                      value={tradeBotFilter}
                      onChange={(e) => setTradeBotFilter(e.target.value)}
                      className={`px-3 py-2 rounded-sm border text-sm ${darkMode ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-slate-300'}`}
                    >
                      <option value="real">Real Users Only</option>
                      <option value="bots">Bots Only</option>
                      <option value="all">All Trades</option>
                    </select>
                  </div>

                  {/* Load Button */}
                  <button
                    onClick={() => loadRecentTrades(tradeTimePeriod, tradeTypeFilter, tradeFilterTicker, tradeBotFilter)}
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
                              {trade.isBot && (
                                <span className="ml-1 px-1.5 py-0.5 text-xs rounded bg-purple-600 text-white">🤖</span>
                              )}
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
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={handleCleanupBasePrices}
                      disabled={loading}
                      className="px-3 py-1 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded-sm disabled:opacity-50"
                      title="Remove recent base price entries from history"
                    >
                      {loading ? '...' : '🧹 Cleanup Base Prices'}
                    </button>
                    <button
                      onClick={handleSyncPricesToHistory}
                      disabled={loading}
                      className="px-3 py-1 text-xs bg-orange-600 hover:bg-orange-700 text-white rounded-sm disabled:opacity-50"
                      title="Sync current prices to match latest price history"
                    >
                      {loading ? '...' : '🔄 Sync Prices to History'}
                    </button>
                    <button
                      onClick={handleResetAllPrices}
                      disabled={loading}
                      className="px-3 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded-sm disabled:opacity-50"
                      title="Reset ALL character prices to base prices"
                    >
                      {loading ? '...' : '🔄 Reset All Prices'}
                    </button>
                    <button
                      onClick={loadMarketStats}
                      disabled={statsLoading}
                      className="px-3 py-1 text-xs bg-cyan-600 hover:bg-cyan-700 text-white rounded-sm disabled:opacity-50"
                    >
                      {statsLoading ? '...' : '🔄 Refresh Stats'}
                    </button>
                  </div>
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
              {/* Bankrupt Users */}
              <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                <div className="flex justify-between items-center mb-2">
                  <h3 className={`font-semibold ${textClass}`}>💔 Bankrupt Users</h3>
                  <button
                    onClick={loadBankruptUsers}
                    disabled={loading}
                    className="px-3 py-1 text-xs bg-teal-600 hover:bg-teal-700 text-white rounded-sm disabled:opacity-50"
                  >
                    {bankruptLoaded ? 'Refresh' : 'Load'}
                  </button>
                </div>
                {bankruptLoaded && (
                  bankruptUsers.length === 0 ? (
                    <p className={`text-sm ${mutedClass}`}>No bankrupt users found.</p>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {bankruptUsers.map(u => (
                        <div key={u.id} className={`flex items-center justify-between p-2 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-slate-50'}`}>
                          <div>
                            <span className={`font-semibold text-sm ${textClass}`}>{u.displayName}</span>
                            <div className={`text-xs ${mutedClass}`}>
                              Cash: ${(u.cash || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                              {' · '}Portfolio: ${(u.portfolioValue || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                              {' · '}{u.totalTrades} trades
                              {u.crew && <> · Crew: {u.crew}</>}
                              {u.bankruptAt && <> · Bankrupt: {new Date(u.bankruptAt).toLocaleDateString()}</>}
                            </div>
                          </div>
                          <button
                            onClick={() => handleReinstateUser(u.id, u.displayName)}
                            disabled={loading}
                            className="px-3 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded-sm disabled:opacity-50"
                          >
                            Reinstate
                          </button>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>

              {/* Spike Victim Repair */}
              <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                <div className="flex justify-between items-center mb-2">
                  <h3 className={`font-semibold ${textClass}`}>⚡ Spike Victim Repair</h3>
                  <div className="flex gap-2">
                    <button
                      onClick={handleScanSpikeVictims}
                      disabled={scanningSpike || repairingSpike}
                      className="px-3 py-1 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded-sm disabled:opacity-50"
                    >
                      {scanningSpike ? 'Scanning...' : spikeScanned ? 'Re-Scan' : 'Scan'}
                    </button>
                    {spikeVictims.length > 0 && (
                      <button
                        onClick={handleRepairAllSpikeVictims}
                        disabled={repairingSpike}
                        className="px-3 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded-sm disabled:opacity-50"
                      >
                        {repairingSpike ? 'Repairing...' : `Fix All (${spikeVictims.length})`}
                      </button>
                    )}
                  </div>
                </div>
                <p className={`text-xs ${mutedClass} mb-3`}>
                  Finds ALL bankrupt or negative-cash users (non-bot). Shows reason, suggested fix, and recent trades.
                </p>
                {spikeScanned && (
                  spikeVictims.length === 0 ? (
                    <p className={`text-sm ${mutedClass}`}>No damaged accounts found.</p>
                  ) : (
                    <div className="space-y-2 max-h-[500px] overflow-y-auto">
                      {spikeVictims.map(v => (
                        <div key={v.userId} className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-slate-50'}`}>
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center flex-wrap gap-1">
                                <span className={`font-semibold text-sm ${textClass}`}>{v.displayName}</span>
                                {v.isBankrupt && <span className="px-1.5 py-0.5 text-xs bg-red-500/20 text-red-400 rounded">Bankrupt</span>}
                                {v.tookBailout && <span className="px-1.5 py-0.5 text-xs bg-orange-500/20 text-orange-400 rounded">Bailed Out</span>}
                              </div>
                              {v.reason && (
                                <div className={`text-xs mt-0.5 text-purple-400`}>
                                  Reason: {v.reason}
                                </div>
                              )}
                              <div className={`text-xs mt-1 ${mutedClass}`}>
                                Cash: <span className="text-red-400 font-semibold">${(v.currentCash || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                                {v.correctedCash != null && (
                                  <>
                                    {' → '}
                                    <span className="text-green-400 font-semibold">${(v.correctedCash || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                                  </>
                                )}
                                {' · '}{v.totalTrades || 0} trades
                                {v.bankruptAt && <> · Bankrupt: {new Date(v.bankruptAt).toLocaleDateString()}</>}
                              </div>
                              {v.tookBailout && v.holdingsCount > 0 && (
                                <div className={`text-xs mt-0.5 ${mutedClass}`}>
                                  Holdings to restore: {v.holdingsCount} stocks
                                  {v.holdingsToRestore && (
                                    <span className="ml-1 text-blue-400">
                                      ({Object.entries(v.holdingsToRestore).map(([t, s]) => `${t}: ${s}`).join(', ')})
                                    </span>
                                  )}
                                </div>
                              )}
                              {v.trades && v.trades.length > 0 && (
                                <details className="mt-1">
                                  <summary className={`text-xs cursor-pointer ${mutedClass}`}>Recent trades</summary>
                                  <div className="mt-1 space-y-0.5">
                                    {v.trades.map((t, i) => (
                                      <div key={i} className={`text-xs py-0.5 px-1 rounded ${darkMode ? 'bg-slate-800' : 'bg-white'}`}>
                                        <span className={t.action === 'margin_call_cover' ? 'text-red-400 font-semibold' : t.action === 'BUY' ? 'text-green-400' : 'text-orange-400'}>
                                          {t.action}
                                        </span>
                                        {' '}{t.ticker} × {t.shares} @ ${t.price?.toFixed(2)}
                                        {t.pnl != null && <span className={t.pnl >= 0 ? ' text-green-400' : ' text-red-400'}> P&L: ${t.pnl?.toFixed(2)}</span>}
                                        {t.cashBefore != null && <span className={mutedClass}> (${t.cashBefore?.toFixed(2)} → ${t.cashAfter?.toFixed(2)})</span>}
                                        {t.timestamp && <span className={mutedClass}> {new Date(t.timestamp).toLocaleDateString()}</span>}
                                      </div>
                                    ))}
                                  </div>
                                </details>
                              )}
                            </div>
                            {v.correctedCash != null && (
                              <button
                                onClick={() => handleRepairSpikeVictim(v)}
                                disabled={repairingSpike}
                                className="px-3 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded-sm disabled:opacity-50 ml-2 shrink-0"
                              >
                                Fix
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>

              {/* Diagnose Users */}
              <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                <h3 className={`font-semibold mb-2 ${textClass}`}>🔍 Diagnose User Accounts</h3>
                <p className={`text-xs ${mutedClass} mb-2`}>
                  Paste user IDs (comma or newline separated) to see their account state and recent trades.
                </p>
                <textarea
                  value={diagnosisIds}
                  onChange={e => setDiagnosisIds(e.target.value)}
                  placeholder="Paste user IDs here..."
                  rows={3}
                  className={`w-full px-3 py-2 border rounded-sm text-xs font-mono mb-2 ${darkMode ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'}`}
                />
                <button
                  onClick={handleDiagnoseUsers}
                  disabled={diagnosing || !diagnosisIds.trim()}
                  className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-sm disabled:opacity-50 mb-3"
                >
                  {diagnosing ? 'Diagnosing...' : '🔍 Diagnose'}
                </button>
                {diagnosisResults.length > 0 && (
                  <div className="space-y-3">
                    {diagnosisResults.map(u => (
                      <div key={u.userId} className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-slate-50'}`}>
                        {u.error ? (
                          <p className="text-red-400 text-sm">{u.userId}: {u.error}</p>
                        ) : (
                          <>
                            <div className="flex justify-between items-start mb-2">
                              <div>
                                <span className={`font-semibold ${textClass}`}>{u.displayName}</span>
                                <span className={`text-xs ml-2 font-mono ${mutedClass}`}>{u.userId}</span>
                              </div>
                              <div className="flex gap-1">
                                {u.isBankrupt && <span className="px-1.5 py-0.5 text-xs bg-red-500/20 text-red-400 rounded">Bankrupt</span>}
                                {u.lastBailout && <span className="px-1.5 py-0.5 text-xs bg-orange-500/20 text-orange-400 rounded">Bailed Out</span>}
                              </div>
                            </div>
                            <div className={`text-xs ${mutedClass} space-y-0.5`}>
                              <p>Cash: <span className={u.cash < 0 ? 'text-red-400 font-semibold' : 'text-green-400 font-semibold'}>${u.cash?.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span> · Portfolio: ${u.portfolioValue?.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
                              {Object.keys(u.holdings || {}).length > 0 && (
                                <p>Holdings: {Object.entries(u.holdings).map(([t, s]) => `${t}: ${s}`).join(', ')}</p>
                              )}
                              {Object.keys(u.shorts || {}).length > 0 && (
                                <p>Shorts: {Object.entries(u.shorts).map(([t, s]) => `${t}: ${typeof s === 'object' ? s.shares : s}`).join(', ')}</p>
                              )}
                              {u.bankruptAt && <p>Bankrupt at: {new Date(u.bankruptAt).toLocaleString()}</p>}
                              {u.lastBailout && <p>Last bailout: {new Date(u.lastBailout).toLocaleString()}</p>}
                            </div>
                            {u.recentTrades && u.recentTrades.length > 0 && (
                              <details className="mt-2">
                                <summary className={`text-xs cursor-pointer ${mutedClass}`}>Recent trades ({u.totalTrades} total)</summary>
                                <div className="max-h-48 overflow-y-auto mt-1 space-y-0.5">
                                  {u.recentTrades.map((t, i) => (
                                    <div key={i} className={`text-xs py-1 px-2 rounded flex justify-between ${darkMode ? 'bg-slate-800' : 'bg-white'}`}>
                                      <span>
                                        <span className={t.action === 'margin_call_cover' ? 'text-red-400 font-semibold' : t.action === 'BUY' ? 'text-green-400' : 'text-orange-400'}>
                                          {t.action}
                                        </span>
                                        {' '}{t.ticker} × {t.amount} @ ${t.price?.toFixed(2)}
                                        {t.pnl != null && <span className={t.pnl >= 0 ? 'text-green-400' : 'text-red-400'}> P&L: ${t.pnl?.toFixed(2)}</span>}
                                      </span>
                                      <span className={mutedClass}>
                                        {t.cashBefore != null && `$${t.cashBefore?.toFixed(2)} → $${t.cashAfter?.toFixed(2)}`}
                                        {' '}{t.timestamp ? new Date(t.timestamp).toLocaleString() : ''}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            )}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Manual Backup */}
              <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                <h3 className={`font-semibold mb-2 ${textClass}`}>💾 Manual Backup</h3>
                <p className={`text-sm ${mutedClass} mb-3`}>
                  Create an instant backup of all market data (prices, price history, liquidity). Backups are stored in Firebase Storage.
                </p>
                <button
                  onClick={async () => {
                    if (!window.confirm('Create a manual backup of market data?')) {
                      return;
                    }

                    setLoading(true);
                    setMessage(null);

                    try {
                      const result = await triggerManualBackupFunction();
                      setMessage({
                        type: 'success',
                        text: `Backup created: ${result.data.filename}`
                      });
                    } catch (error) {
                      setMessage({
                        type: 'error',
                        text: `Backup failed: ${error.message}`
                      });
                    } finally {
                      setLoading(false);
                    }
                  }}
                  disabled={loading}
                  className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-sm disabled:opacity-50"
                >
                  {loading ? 'Creating Backup...' : '💾 Create Manual Backup'}
                </button>
              </div>

              {/* NaN Account Repair */}
              <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                <h3 className={`font-semibold mb-2 text-red-500`}>🔧 Repair Corrupted Accounts</h3>
                <p className={`text-sm ${mutedClass} mb-3`}>
                  Scans all accounts for NaN/corrupted values in cash, holdings, shorts, and portfolio data. Fixes them automatically.
                </p>
                <button
                  onClick={async () => {
                    setLoading(true);
                    setMessage(null);
                    try {
                      const usersSnap = await getDocs(collection(db, 'users'));
                      const corrupted = [];

                      for (const userDoc of usersSnap.docs) {
                        const data = userDoc.data();
                        const fixes = {};
                        const issues = [];

                        // Check cash
                        if (data.cash !== undefined && (isNaN(data.cash) || !isFinite(data.cash))) {
                          fixes.cash = 0;
                          issues.push(`cash was ${data.cash}`);
                        }

                        // Check portfolioValue
                        if (data.portfolioValue !== undefined && (isNaN(data.portfolioValue) || !isFinite(data.portfolioValue))) {
                          fixes.portfolioValue = fixes.cash !== undefined ? fixes.cash : (data.cash || 0);
                          issues.push(`portfolioValue was ${data.portfolioValue}`);
                        }

                        // Check marginUsed
                        if (data.marginUsed !== undefined && (isNaN(data.marginUsed) || !isFinite(data.marginUsed))) {
                          fixes.marginUsed = 0;
                          issues.push(`marginUsed was ${data.marginUsed}`);
                        }

                        // Check holdings for NaN values
                        if (data.holdings) {
                          const fixedHoldings = {};
                          let holdingsCorrupted = false;
                          for (const [ticker, shares] of Object.entries(data.holdings)) {
                            if (isNaN(shares) || !isFinite(shares)) {
                              fixedHoldings[ticker] = 0;
                              holdingsCorrupted = true;
                              issues.push(`holdings.${ticker} was ${shares}`);
                            }
                          }
                          if (holdingsCorrupted) {
                            for (const [ticker, shares] of Object.entries(data.holdings)) {
                              if (!fixedHoldings.hasOwnProperty(ticker)) fixedHoldings[ticker] = shares;
                            }
                            fixes.holdings = fixedHoldings;
                          }
                        }

                        // Check shorts for NaN values
                        if (data.shorts) {
                          let shortsCorrupted = false;
                          const fixedShorts = {};
                          for (const [ticker, pos] of Object.entries(data.shorts)) {
                            if (!pos || typeof pos !== 'object') continue;
                            const hasNaN = isNaN(pos.shares) || isNaN(pos.entryPrice) || isNaN(pos.margin) ||
                                           !isFinite(pos.shares) || !isFinite(pos.entryPrice) || !isFinite(pos.margin);
                            if (hasNaN) {
                              fixedShorts[ticker] = { shares: 0, entryPrice: 0, margin: 0 };
                              shortsCorrupted = true;
                              issues.push(`shorts.${ticker} had NaN (shares=${pos.shares}, entry=${pos.entryPrice}, margin=${pos.margin})`);
                            }
                          }
                          if (shortsCorrupted) {
                            for (const [ticker, pos] of Object.entries(data.shorts)) {
                              if (!fixedShorts.hasOwnProperty(ticker)) fixedShorts[ticker] = pos;
                            }
                            fixes.shorts = fixedShorts;
                          }
                        }

                        // Check costBasis for NaN
                        if (data.costBasis) {
                          const fixedCostBasis = {};
                          let cbCorrupted = false;
                          for (const [ticker, cost] of Object.entries(data.costBasis)) {
                            if (isNaN(cost) || !isFinite(cost)) {
                              fixedCostBasis[ticker] = 0;
                              cbCorrupted = true;
                              issues.push(`costBasis.${ticker} was ${cost}`);
                            }
                          }
                          if (cbCorrupted) {
                            for (const [ticker, cost] of Object.entries(data.costBasis)) {
                              if (!fixedCostBasis.hasOwnProperty(ticker)) fixedCostBasis[ticker] = cost;
                            }
                            fixes.costBasis = fixedCostBasis;
                          }
                        }

                        if (issues.length > 0) {
                          corrupted.push({
                            uid: userDoc.id,
                            displayName: data.displayName || 'Unknown',
                            issues,
                            fixes
                          });
                        }
                      }

                      if (corrupted.length === 0) {
                        setMessage({ type: 'success', text: 'No corrupted accounts found!' });
                      } else {
                        // Apply fixes
                        let fixed = 0;
                        for (const account of corrupted) {
                          const userRef = doc(db, 'users', account.uid);
                          await updateDoc(userRef, account.fixes);
                          fixed++;
                        }
                        setMessage({
                          type: 'success',
                          text: `Fixed ${fixed} account(s): ${corrupted.map(a => `${a.displayName} (${a.issues.join(', ')})`).join(' | ')}`
                        });
                      }
                    } catch (error) {
                      setMessage({ type: 'error', text: `Scan failed: ${error.message}` });
                    } finally {
                      setLoading(false);
                    }
                  }}
                  disabled={loading}
                  className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-sm disabled:opacity-50"
                >
                  {loading ? 'Scanning...' : '🔧 Scan & Repair All Accounts'}
                </button>
              </div>

              {/* Restore from Backup */}
              <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                <h3 className={`font-semibold mb-2 text-orange-500`}>🔄 Restore Price History</h3>
                <p className={`text-sm ${mutedClass} mb-3`}>
                  Restore price history from a backup. Current prices will be kept, only historical data is restored.
                </p>

                <button
                  onClick={handleListBackups}
                  disabled={loadingBackups}
                  className="w-full px-4 py-2 mb-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-sm disabled:opacity-50"
                >
                  {loadingBackups ? 'Loading...' : '📋 List Available Backups'}
                </button>

                {backups.length > 0 && (
                  <div className={`max-h-64 overflow-y-auto space-y-2 p-3 rounded-sm ${darkMode ? 'bg-slate-900' : 'bg-slate-50'}`}>
                    {backups.map((backup, i) => (
                      <div key={i} className={`p-3 rounded-sm border ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex-1">
                            <p className={`text-xs font-mono ${textClass}`}>{backup.name.split('/').pop()}</p>
                            <p className={`text-xs ${mutedClass}`}>{new Date(backup.created).toLocaleString()}</p>
                            <p className={`text-xs ${mutedClass}`}>{(backup.size / 1024).toFixed(1)} KB</p>
                          </div>
                          <button
                            onClick={() => handleRestoreBackup(backup.name)}
                            disabled={restoringBackup}
                            className="px-3 py-1 text-xs bg-orange-600 hover:bg-orange-700 text-white rounded-sm disabled:opacity-50"
                          >
                            {restoringBackup ? '...' : 'Restore'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* User Data Transfer */}
              <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                <h3 className={`font-semibold mb-2 ${textClass}`}>👤 Transfer User Data</h3>
                <p className={`text-sm ${mutedClass} mb-3`}>
                  Copy all data from one user account to another. Useful when a user lost access to their email.
                  The new user's data will be COMPLETELY OVERWRITTEN.
                </p>

                <div className="space-y-3">
                  <div>
                    <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Old User ID</label>
                    <input
                      type="text"
                      placeholder="User ID with old email/data"
                      value={oldUserId}
                      onChange={(e) => setOldUserId(e.target.value)}
                      className={`w-full px-3 py-2 border rounded-sm text-sm ${darkMode ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'}`}
                      disabled={transferring}
                    />
                  </div>

                  <div>
                    <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>New User ID</label>
                    <input
                      type="text"
                      placeholder="User ID of new account"
                      value={newUserId}
                      onChange={(e) => setNewUserId(e.target.value)}
                      className={`w-full px-3 py-2 border rounded-sm text-sm ${darkMode ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'}`}
                      disabled={transferring}
                    />
                  </div>

                  <div className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-slate-100'}`}>
                    <p className={`text-xs ${mutedClass}`}>
                      <strong>How to find User IDs:</strong>
                      <br/>1. Ask user for their display name (username)
                      <br/>2. Search for them in the Users tab
                      <br/>3. Click on them to view details
                      <br/>4. Copy the User ID from the top of their profile
                      <br/><br/>
                      <strong className="text-orange-500">⚠️ Warning:</strong> This will copy ALL data (cash, holdings, achievements, transactions, etc.) from the old account to the new account. Any data on the new account will be lost.
                    </p>
                  </div>

                  <button
                    onClick={handleTransferUserData}
                    disabled={transferring || !oldUserId.trim() || !newUserId.trim()}
                    className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-sm disabled:opacity-50"
                  >
                    {transferring ? 'Transferring...' : '🔄 Transfer User Data'}
                  </button>
                </div>
              </div>

              {/* TRADE HISTORY & ROLLBACK SECTION */}
              <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                <h3 className={`font-semibold mb-2 ${textClass}`}>🔍 Trade History & Rollback</h3>

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
                      {selectedTickerHistory.slice().reverse().slice(0, 1000).map((h, i, arr) => {
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
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Price Adjustment Modal */}
      {showPriceModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-[60]" onClick={() => setShowPriceModal(false)}>
          <div
            className={`w-full max-w-xl ${cardClass} border rounded-sm shadow-xl overflow-hidden max-h-[85vh] flex flex-col`}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className={`p-4 border-b ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
              <div className="flex justify-between items-center">
                <h2 className={`text-lg font-semibold ${textClass}`}>💰 Adjust Character Prices</h2>
                <button onClick={() => setShowPriceModal(false)} className={`p-2 ${mutedClass} hover:text-teal-600 text-xl`}>×</button>
              </div>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Search */}
              <div>
                <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Search Characters</label>
                <input
                  type="text"
                  placeholder="Search by name or ticker..."
                  value={priceModalSearch}
                  onChange={e => setPriceModalSearch(e.target.value)}
                  className={`w-full px-3 py-2 border rounded-sm ${darkMode ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-slate-300 text-slate-900'}`}
                />
              </div>

              {/* Character List */}
              <div className="space-y-2">
                {CHARACTERS
                  .filter(c => {
                    const search = priceModalSearch.toLowerCase();
                    return !search ||
                           c.name.toLowerCase().includes(search) ||
                           c.ticker.toLowerCase().includes(search);
                  })
                  .map(character => {
                    const currentPrice = prices[character.ticker] || character.basePrice;
                    const isSelected = selectedPriceCharacter?.ticker === character.ticker;

                    return (
                      <div
                        key={character.ticker}
                        className={`p-3 rounded-sm border cursor-pointer transition-all ${
                          isSelected
                            ? darkMode
                              ? 'bg-teal-900/30 border-teal-500'
                              : 'bg-teal-50 border-teal-500'
                            : darkMode
                            ? 'bg-slate-800 border-slate-700 hover:border-slate-600'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                        onClick={() => {
                          if (isSelected) {
                            setSelectedPriceCharacter(null);
                            setPriceAdjustPercent('');
                          } else {
                            setSelectedPriceCharacter(character);
                            setPriceAdjustPercent('');
                          }
                        }}
                      >
                        <div className="flex justify-between items-center mb-2">
                          <div>
                            <div className={`font-semibold ${textClass}`}>{character.name}</div>
                            <div className={`text-xs ${mutedClass}`}>${character.ticker}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-bold text-green-500">${currentPrice.toFixed(2)}</div>
                          </div>
                        </div>

                        {/* Adjustment Controls - Show when selected */}
                        {isSelected && (
                          <div className={`mt-3 pt-3 border-t ${darkMode ? 'border-slate-700' : 'border-slate-200'} space-y-2`}>
                            {/* Quick Buttons */}
                            <div className="grid grid-cols-6 gap-1">
                              {[-50, -25, -10, 10, 25, 50].map(pct => (
                                <button
                                  key={pct}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPriceAdjustPercent(pct.toString());
                                  }}
                                  className={`py-1.5 text-xs font-semibold rounded-sm ${
                                    pct < 0 ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'
                                  } text-white`}
                                >
                                  {pct > 0 ? '+' : ''}{pct}%
                                </button>
                              ))}
                            </div>

                            {/* Custom Input */}
                            <div className="flex gap-2">
                              <input
                                type="number"
                                step="1"
                                value={priceAdjustPercent}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  setPriceAdjustPercent(e.target.value);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                placeholder="Custom % (e.g., -15, 20)"
                                className={`flex-1 px-3 py-2 border rounded-sm text-sm ${darkMode ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-slate-300 text-slate-900'}`}
                              />
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (priceAdjustPercent) {
                                    handleModalPriceAdjustment(character, priceAdjustPercent);
                                  }
                                }}
                                disabled={!priceAdjustPercent || loading}
                                className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-sm disabled:opacity-50"
                              >
                                Apply
                              </button>
                            </div>

                            {/* Preview */}
                            {priceAdjustPercent && !isNaN(parseFloat(priceAdjustPercent)) && (
                              <div className={`text-sm ${mutedClass}`}>
                                Preview: ${currentPrice.toFixed(2)} → $
                                {(Math.round(currentPrice * (1 + parseFloat(priceAdjustPercent) / 100) * 100) / 100).toFixed(2)}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* BADGES TAB */}
      {activeTab === 'badges' && (
        <div className="space-y-4 p-4" onClick={e => e.stopPropagation()}>
          <h3 className={`text-lg font-bold ${darkMode ? 'text-white' : 'text-slate-900'}`}>Achievement Badges</h3>
          {!badgesLoaded ? (
            <p className={mutedClass}>Loading...</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.values(ACHIEVEMENTS).map(ach => {
                const holders = badgeUsers.filter(u => u.achievements.includes(ach.id));
                const isExpanded = expandedBadge === ach.id;
                return (
                  <div key={ach.id} className={`rounded-sm border ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
                    <button
                      onClick={() => setExpandedBadge(isExpanded ? null : ach.id)}
                      className={`w-full text-left p-3 flex items-center justify-between hover:bg-slate-500/10 transition-colors`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{ach.emoji}</span>
                        <div>
                          <div className={`font-semibold text-sm ${darkMode ? 'text-white' : 'text-slate-900'}`}>{ach.name}</div>
                          <div className={`text-xs ${mutedClass}`}>{ach.description}</div>
                        </div>
                      </div>
                      <span className={`text-sm font-bold ${holders.length > 0 ? 'text-amber-500' : mutedClass}`}>
                        {holders.length}
                      </span>
                    </button>
                    {isExpanded && holders.length > 0 && (
                      <div className={`border-t ${darkMode ? 'border-slate-700' : 'border-slate-200'} max-h-64 overflow-y-auto`}>
                        {holders
                          .sort((a, b) => (b.portfolioValue || 0) - (a.portfolioValue || 0))
                          .map(u => (
                          <div key={u.id} className={`px-3 py-2 flex items-center justify-between text-sm ${darkMode ? 'hover:bg-slate-700' : 'hover:bg-slate-50'}`}>
                            <div>
                              <span className={darkMode ? 'text-white' : 'text-slate-900'}>{u.displayName}</span>
                              {u.isBot && <span className="ml-1 text-xs text-purple-400">(bot)</span>}
                              <span className={`ml-2 text-xs ${mutedClass}`}>${(u.portfolioValue || 0).toLocaleString()}</span>
                              {u.achievementDates[ach.id] && (
                                <span className={`ml-2 text-xs ${mutedClass}`}>
                                  {new Date(u.achievementDates[ach.id]).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                            <button
                              onClick={() => handleRemoveAchievement(u.id, ach.id, u.displayName)}
                              className="text-xs px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded-sm"
                              disabled={loading}
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {isExpanded && holders.length === 0 && (
                      <div className={`p-3 text-sm border-t ${darkMode ? 'border-slate-700' : 'border-slate-200'} ${mutedClass}`}>
                        No holders
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AdminPanel;
