import React, { useState, useEffect } from 'react';
import { doc, updateDoc, getDoc, setDoc, collection, getDocs, deleteDoc, runTransaction, arrayUnion } from 'firebase/firestore';
import { db, createBotsFunction, triggerManualBackupFunction, listBackupsFunction, restoreBackupFunction, banUserFunction, tradeSpikeAlertFunction, ipoAnnouncementAlertFunction, removeAchievementFunction, reinstateUserFunction, adminSetCashFunction, repairSpikeVictimsFunction, renameTickerFunction, addWatchedUserFunction, removeWatchedUserFunction, linkAltAccountFunction, addWatchedIPFunction, getWatchlistFunction, diagnoseTickerRollbackFunction, recoverTickerFunction, auditUserDropsFunction, runDividendPayoutNowFunction, backfillHoldingCohortsFunction } from './firebase';
import { DEFAULT_DIVIDEND_TIERS, getDividendTier } from './characters';
import { DIVIDEND_RATES } from './constants/economy';
import { CHARACTERS, CHARACTER_MAP } from './characters';
import { ADMIN_UIDS, MIN_PRICE } from './constants';
import { ACHIEVEMENTS } from './constants/achievements';
import { initializeMarket } from './services/market';
import IpoTab from './components/admin/IpoTab';
import PredictionsTab from './components/admin/PredictionsTab';
import HoldersTab from './components/admin/HoldersTab';
import UsersTab from './components/admin/UsersTab';
import BotsTab from './components/admin/BotsTab';
import TradesTab from './components/admin/TradesTab';
import StatsTab from './components/admin/StatsTab';
import RecoveryTab from './components/admin/RecoveryTab';
import BadgesTab from './components/admin/BadgesTab';
import MarketTab from './components/admin/MarketTab';
import WatchlistTab from './components/admin/WatchlistTab';
import DiagnosticTab from './components/admin/DiagnosticTab';
import DividendsTab from './components/admin/DividendsTab';

const AdminPanel = ({ user, predictions, prices, darkMode, marketData, onClose }) => {
  const [activeTab, setActiveTab] = useState('users');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

  // Dividends tab state
  const [dividendOverrides, setDividendOverrides] = useState({});
  const [dividendConfigLoaded, setDividendConfigLoaded] = useState(false);
  const [dividendSearch, setDividendSearch] = useState('');
  const [dividendRunResult, setDividendRunResult] = useState(null);
  const [dividendActionLoading, setDividendActionLoading] = useState(false);
  const [dividendLastRuns, setDividendLastRuns] = useState([]);

  // Badges tab state
  const [badgeUsers, setBadgeUsers] = useState([]);
  const [badgesLoaded, setBadgesLoaded] = useState(false);
  const [expandedBadge, setExpandedBadge] = useState(null);

  // Market tab state
  const [haltReasonInput, setHaltReasonInput] = useState('');
  const marketHaltStatus = !!marketData?.marketHalted;
  const marketHaltReason = marketData?.haltReason || '';

  // Create prediction form state
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['Yes', 'No', '', '', '', '']);
  const [daysUntilEnd, setDaysUntilEnd] = useState(7);
  const [mayExtend, setMayExtend] = useState(false);
  
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

  // Rename ticker state
  const [renameOldTicker, setRenameOldTicker] = useState('');
  const [renameNewTicker, setRenameNewTicker] = useState('');
  const [renameResult, setRenameResult] = useState(null);
  const [renaming, setRenaming] = useState(false);

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

  // Watchlist state
  const [watchedUsers, setWatchedUsers] = useState([]);
  const [watchlistAlerts, setWatchlistAlerts] = useState([]);
  const [watchlistLoaded, setWatchlistLoaded] = useState(false);
  const [watchAddUserId, setWatchAddUserId] = useState('');
  const [watchAddReason, setWatchAddReason] = useState('');
  const [watchAddMaxAccounts, setWatchAddMaxAccounts] = useState(1);
  const [watchLinkAltId, setWatchLinkAltId] = useState('');
  const [watchLinkTarget, setWatchLinkTarget] = useState(null);
  const [watchAddIPValue, setWatchAddIPValue] = useState('');
  const [watchAddIPTarget, setWatchAddIPTarget] = useState(null);

  // Drop audit state
  const [dropAuditQuery, setDropAuditQuery] = useState('');
  const [dropAuditRunning, setDropAuditRunning] = useState(false);
  const [dropAuditResult, setDropAuditResult] = useState(null);

  // Ticker rollback diagnostic state
  const [diagTicker, setDiagTicker] = useState('SHRO');
  const [diagStartDate, setDiagStartDate] = useState('2026-03-18');
  const [diagRunning, setDiagRunning] = useState(false);
  const [diagResult, setDiagResult] = useState(null);
  const [diagUserSort, setDiagUserSort] = useState('net'); // 'net', 'bought', 'sold'
  const [recoveryPreview, setRecoveryPreview] = useState(null);
  const [recoveryRunning, setRecoveryRunning] = useState(false);
  const [recoveryExecuting, setRecoveryExecuting] = useState(false);
  const [recoveryDone, setRecoveryDone] = useState(false);
  const [recoveryRollbackDate, setRecoveryRollbackDate] = useState('2026-03-18');

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
  const [ipoTotalShares, setIpoTotalShares] = useState(150); // Total shares available
  const [ipoMaxPerUser, setIpoMaxPerUser] = useState(10); // Max shares per user
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
  const mutedClass = darkMode ? 'text-slate-400' : 'text-slate-600';
  const inputClass = darkMode 
    ? 'bg-slate-900 border-slate-600 text-slate-100' 
    : 'bg-white border-slate-300 text-slate-900';

  const showMessage = (type, text) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  // ============================================
  // DIVIDEND HANDLERS
  // ============================================

  const loadDividendConfig = async () => {
    try {
      const ref = doc(db, 'dividendConfig', 'tierOverrides');
      const snap = await getDoc(ref);
      setDividendOverrides(snap.exists() ? (snap.data().tiers || {}) : {});

      const runsSnap = await getDocs(collection(db, 'dividendConfig', 'runs', 'log'));
      const runs = runsSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const ta = a.ranAt?.toMillis ? a.ranAt.toMillis() : 0;
          const tb = b.ranAt?.toMillis ? b.ranAt.toMillis() : 0;
          return tb - ta;
        })
        .slice(0, 5);
      setDividendLastRuns(runs);

      setDividendConfigLoaded(true);
    } catch (err) {
      showMessage('error', 'Failed to load dividend config: ' + (err.message || 'Unknown error'));
    }
  };

  const saveDividendTier = async (ticker, tier) => {
    try {
      const ref = doc(db, 'dividendConfig', 'tierOverrides');
      const next = { ...dividendOverrides };
      if (!tier || tier === 'default') {
        delete next[ticker];
      } else {
        next[ticker] = tier;
      }
      await setDoc(ref, { tiers: next }, { merge: true });
      setDividendOverrides(next);
      showMessage('success', `Saved ${ticker} tier override.`);
    } catch (err) {
      showMessage('error', 'Failed to save tier: ' + (err.message || 'Unknown error'));
    }
  };

  const handleRunDividends = async () => {
    if (!confirm('Run dividend payout NOW? This pays every eligible user immediately.')) return;
    setDividendActionLoading(true);
    setDividendRunResult(null);
    try {
      const result = await runDividendPayoutNowFunction();
      setDividendRunResult(result.data);
      showMessage('success', `Paid ${result.data.usersPaid}/${result.data.usersConsidered} users $${(result.data.totalPaid || 0).toFixed(2)} total.`);
      await loadDividendConfig();
    } catch (err) {
      showMessage('error', 'Payout failed: ' + (err.message || 'Unknown error'));
    } finally {
      setDividendActionLoading(false);
    }
  };

  const handleBackfillCohorts = async (force = false) => {
    const msg = force
      ? 'FORCE-backfill holdingCohorts on ALL users? This OVERWRITES existing cohorts.'
      : 'Backfill holdingCohorts on all users missing the field? Safe — skips users who already have cohorts.';
    if (!confirm(msg)) return;
    setDividendActionLoading(true);
    try {
      const result = await backfillHoldingCohortsFunction({ force });
      showMessage('success', `Backfill: ${result.data.updated} updated, ${result.data.skipped} skipped, ${result.data.scanned} scanned.`);
    } catch (err) {
      showMessage('error', 'Backfill failed: ' + (err.message || 'Unknown error'));
    } finally {
      setDividendActionLoading(false);
    }
  };

  // ============================================
  // WATCHLIST HANDLERS
  // ============================================

  const loadWatchlist = async () => {
    setLoading(true);
    try {
      const result = await getWatchlistFunction();
      setWatchedUsers(result.data.watchedUsers || []);
      setWatchlistAlerts(result.data.alerts || []);
      setWatchlistLoaded(true);
    } catch (err) {
      showMessage('error', 'Failed to load watchlist: ' + (err.message || 'Unknown error'));
    }
    setLoading(false);
  };

  const handleAddWatchedUser = async () => {
    if (!watchAddUserId.trim()) return showMessage('error', 'Enter a user ID.');
    setLoading(true);
    try {
      const result = await addWatchedUserFunction({
        userId: watchAddUserId.trim(),
        reason: watchAddReason.trim(),
        maxAccountsPerIP: watchAddMaxAccounts
      });
      showMessage('success', `Added "${result.data.displayName}" to watchlist. Found ${result.data.knownIPCount} known IPs.`);
      setWatchAddUserId('');
      setWatchAddReason('');
      setWatchAddMaxAccounts(1);
      await loadWatchlist();
    } catch (err) {
      showMessage('error', 'Failed: ' + (err.message || 'Unknown error'));
    }
    setLoading(false);
  };

  const handleRemoveWatchedUser = async (userId) => {
    if (!confirm('Remove this user from the watchlist?')) return;
    setLoading(true);
    try {
      await removeWatchedUserFunction({ userId });
      showMessage('success', 'Removed from watchlist.');
      await loadWatchlist();
    } catch (err) {
      showMessage('error', 'Failed: ' + (err.message || 'Unknown error'));
    }
    setLoading(false);
  };

  const handleLinkAlt = async (watchedUserId) => {
    if (!watchLinkAltId.trim()) return showMessage('error', 'Enter an alt account ID.');
    setLoading(true);
    try {
      const result = await linkAltAccountFunction({
        watchedUserId,
        altAccountId: watchLinkAltId.trim()
      });
      showMessage('success', `Linked "${result.data.altName}" as alt.`);
      setWatchLinkAltId('');
      setWatchLinkTarget(null);
      await loadWatchlist();
    } catch (err) {
      showMessage('error', 'Failed: ' + (err.message || 'Unknown error'));
    }
    setLoading(false);
  };

  const handleAddWatchedIP = async (userId) => {
    if (!watchAddIPValue.trim()) return showMessage('error', 'Enter an IP address.');
    setLoading(true);
    try {
      await addWatchedIPFunction({ userId, ip: watchAddIPValue.trim() });
      showMessage('success', 'IP added to watchlist.');
      setWatchAddIPValue('');
      setWatchAddIPTarget(null);
      await loadWatchlist();
    } catch (err) {
      showMessage('error', 'Failed: ' + (err.message || 'Unknown error'));
    }
    setLoading(false);
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

  // Drop audit handler
  const handleDropAudit = async () => {
    if (!dropAuditQuery.trim()) return;
    setDropAuditRunning(true);
    setDropAuditResult(null);
    try {
      const query = dropAuditQuery.trim();
      const isUid = query.length > 20 && !query.includes(' ');
      const result = await auditUserDropsFunction(isUid ? { uid: query } : { username: query });
      setDropAuditResult(result.data);
      setMessage({ type: 'success', text: `Drop audit complete — ${result.data.totalClaims} claims found` });
    } catch (err) {
      setMessage({ type: 'error', text: `Drop audit failed: ${err.message}` });
    }
    setDropAuditRunning(false);
  };

  // Spike victim repair handlers
  const handleRunDiagnostic = async () => {
    setDiagRunning(true);
    setDiagResult(null);
    try {
      const startTimestamp = new Date(diagStartDate + 'T00:00:00Z').getTime();
      const result = await diagnoseTickerRollbackFunction({ ticker: diagTicker, startTimestamp });
      setDiagResult(result.data);
      setMessage({ type: 'success', text: `Diagnostic complete — ${result.data.summary.totalTrades} trades found` });
    } catch (err) {
      setMessage({ type: 'error', text: `Diagnostic failed: ${err.message}` });
    }
    setDiagRunning(false);
    setRecoveryPreview(null);
    setRecoveryDone(false);
    setRecoveryRollbackDate(diagStartDate);
  };

  const handleRecoveryPreview = async () => {
    if (!recoveryRollbackDate) {
      setMessage({ type: 'error', text: 'Pick a rollback date' });
      return;
    }
    setRecoveryRunning(true);
    setRecoveryPreview(null);
    setRecoveryDone(false);
    try {
      const startTimestamp = new Date(diagStartDate + 'T00:00:00Z').getTime();
      const rollbackToTimestamp = new Date(recoveryRollbackDate + 'T00:00:00Z').getTime();
      const result = await recoverTickerFunction({ ticker: diagTicker, startTimestamp, rollbackToTimestamp, dryRun: true });
      setRecoveryPreview(result.data);
    } catch (err) {
      setMessage({ type: 'error', text: `Recovery preview failed: ${err.message}` });
    }
    setRecoveryRunning(false);
  };

  const handleRecoveryExecute = async () => {
    if (!window.confirm(`EXECUTE RECOVERY on ${diagTicker}? This will claw back cash, reset the price, and rewrite price history. This cannot be undone.`)) return;
    setRecoveryExecuting(true);
    try {
      const startTimestamp = new Date(diagStartDate + 'T00:00:00Z').getTime();
      const rollbackToTimestamp = new Date(recoveryRollbackDate + 'T00:00:00Z').getTime();
      const result = await recoverTickerFunction({ ticker: diagTicker, startTimestamp, rollbackToTimestamp, dryRun: false });
      setRecoveryPreview(result.data);
      setRecoveryDone(true);
      setMessage({ type: 'success', text: `Recovery complete — $${result.data.totalClawedBack.toFixed(2)} clawed back, price reset to $${result.data.priceReset.to.toFixed(2)}` });
    } catch (err) {
      setMessage({ type: 'error', text: `Recovery failed: ${err.message}` });
    }
    setRecoveryExecuting(false);
  };

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
      if (oldRelatedPrice != null) {
        const trailingChange = priceChangePercent * coefficient;
        const newRelatedPrice = oldRelatedPrice * (1 + trailingChange);
        const settledRelatedPrice = Math.max(MIN_PRICE, Math.round(newRelatedPrice * 100) / 100);

        console.log(`[ADMIN TRAILING] ${relatedTicker}: $${oldRelatedPrice} -> $${settledRelatedPrice} (${(trailingChange * 100).toFixed(2)}% from ${sourceTicker})`);

        marketUpdates[`prices.${relatedTicker}`] = settledRelatedPrice;
        marketUpdates[`priceHistory.${relatedTicker}`] = arrayUnion({
          timestamp,
          price: settledRelatedPrice,
          source: 'trailing'
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

        const updatedHistory = [...currentHistory, { timestamp: now, price: targetPrice, source: 'admin_adjust' }];

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
          priceHistory: { [character.ticker]: [{ timestamp: now, price: targetPrice, source: 'admin_adjust' }] }
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
        const updatedHistory = [...currentHistory, { timestamp: now, price: targetPrice, source: 'admin_adjust' }];

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
          priceHistory: { [selectedTicker]: [{ timestamp: now, price: targetPrice, source: 'admin_adjust' }] }
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
        createdAt: Date.now(),
        ...(mayExtend && { mayExtend: true })
      };

      await updateDoc(predictionsRef, {
        list: [...currentList, newPrediction]
      });

      showMessage('success', `Created prediction: "${question.trim()}"`);
      setQuestion('');
      setOptions(['Yes', 'No', '', '', '', '']);
      setDaysUntilEnd(7);
      setMayExtend(false);
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
        sharesRemaining: ipoTotalShares,
        totalShares: ipoTotalShares,
        maxPerUser: ipoMaxPerUser,
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
          ipoPrice: character.basePrice,
          postIpoPrice: Math.round(character.basePrice * 1.15 * 100) / 100,
          startsAt: ipoStartsAt,
          endsAt: ipoEndsAt,
          totalShares: ipoTotalShares,
          maxPerUser: ipoMaxPerUser
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
      if (position.system === 'v2') {
        // v2: margin + unrealized P&L (no proceeds in cash)
        shortsValue += collateral + (entryPrice - currentPrice) * shares;
      } else {
        // Legacy: margin collateral - cost to buy back shares
        shortsValue += collateral - (currentPrice * shares);
      }
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

  // Override previous payout decision — pays correct winners regardless of paid status
  const handleOverridePayout = async () => {
    if (recoveryBets.length === 0) {
      showMessage('error', 'No bets loaded — scan first');
      return;
    }
    if (!recoveryWinner) {
      showMessage('error', 'Select the correct winning option');
      return;
    }

    const predId = recoveryPredictionId.trim();
    const totalPool = recoveryBets.reduce((sum, bet) => sum + bet.amount, 0);
    const winningPool = recoveryBets
      .filter(b => b.option === recoveryWinner)
      .reduce((sum, bet) => sum + bet.amount, 0);

    if (winningPool === 0) {
      showMessage('error', 'No bets found for that option');
      return;
    }

    if (!window.confirm(
      `Pay correct winners for "${recoveryWinner}"?\n\n` +
      `Total pool: $${totalPool.toFixed(2)}\nWinning pool: $${winningPool.toFixed(2)}\n` +
      `${recoveryBets.filter(b => b.option === recoveryWinner).length} winners will be paid.\n\n` +
      `This ignores any previous payout. Losers are NOT touched.`
    )) return;

    setLoading(true);
    try {
      let paid = 0;
      for (const bet of recoveryBets) {
        if (bet.option !== recoveryWinner) continue;
        const userShare = bet.amount / winningPool;
        const payout = Math.round(userShare * totalPool * 100) / 100;

        const newPredictionWins = (bet.predictionWins || 0) + 1;
        const currentAchievements = bet.achievements || [];
        const newAchievements = [];
        if (newPredictionWins >= 3 && !currentAchievements.includes('ORACLE')) newAchievements.push('ORACLE');
        if (newPredictionWins >= 10 && !currentAchievements.includes('PROPHET')) newAchievements.push('PROPHET');
        if (winningPool > 0 && totalPool > 0 && (winningPool / totalPool) < 0.20 && !currentAchievements.includes('UNDERDOG')) newAchievements.push('UNDERDOG');

        const updateData = {
          cash: bet.cash + payout,
          [`bets.${predId}.paid`]: true,
          [`bets.${predId}.payout`]: payout,
          predictionWins: newPredictionWins
        };
        if (newAchievements.length > 0) updateData.achievements = arrayUnion(...newAchievements);

        try {
          await updateDoc(doc(db, 'users', bet.userId), updateData);
          paid++;
        } catch (err) {
          console.error('Failed to pay:', bet.displayName, err);
        }
      }

      // Update prediction outcome in Firestore to reflect the corrected winner
      const predictionsRef = doc(db, 'predictions', 'current');
      const snap = await getDoc(predictionsRef);
      if (snap.exists()) {
        const currentList = snap.data().list || [];
        const updatedList = currentList.map(p =>
          p.id === predId ? { ...p, resolved: true, outcome: recoveryWinner } : p
        );
        await updateDoc(predictionsRef, { list: updatedList });
      }

      showMessage('success', `Paid ${paid} correct winners for "${recoveryWinner}"`);
      setRecoveryBets([]);
      setRecoveryWinner('');
      setRecoveryOptions([]);
      setRecoveryPredictionId('');
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed: ${err.message}`);
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

  const handleManualBackup = async () => {
    if (!window.confirm('Create a manual backup of market data?')) return;
    setLoading(true);
    setMessage(null);
    try {
      const result = await triggerManualBackupFunction();
      setMessage({ type: 'success', text: `Backup created: ${result.data.filename}` });
    } catch (error) {
      setMessage({ type: 'error', text: `Backup failed: ${error.message}` });
    } finally {
      setLoading(false);
    }
  };

  const handleRepairCorruptedAccounts = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const usersSnap = await getDocs(collection(db, 'users'));
      const corrupted = [];

      for (const userDoc of usersSnap.docs) {
        const data = userDoc.data();
        const fixes = {};
        const issues = [];

        if (data.cash !== undefined && (isNaN(data.cash) || !isFinite(data.cash))) {
          fixes.cash = 0;
          issues.push(`cash was ${data.cash}`);
        }
        if (data.portfolioValue !== undefined && (isNaN(data.portfolioValue) || !isFinite(data.portfolioValue))) {
          fixes.portfolioValue = fixes.cash !== undefined ? fixes.cash : (data.cash || 0);
          issues.push(`portfolioValue was ${data.portfolioValue}`);
        }
        if (data.marginUsed !== undefined && (isNaN(data.marginUsed) || !isFinite(data.marginUsed))) {
          fixes.marginUsed = 0;
          issues.push(`marginUsed was ${data.marginUsed}`);
        }
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
        if (data.shorts) {
          let shortsCorrupted = false;
          const fixedShorts = {};
          for (const [ticker, pos] of Object.entries(data.shorts)) {
            if (!pos || typeof pos !== 'object') continue;
            const hasNaN = isNaN(pos.shares) || isNaN(pos.entryPrice) || isNaN(pos.margin) ||
                           !isFinite(pos.shares) || !isFinite(pos.entryPrice) || !isFinite(pos.margin);
            if (hasNaN) {
              fixedShorts[ticker] = { shares: 0, entryPrice: 0, margin: 0, costBasis: 0 };
              shortsCorrupted = true;
              issues.push(`shorts.${ticker} had NaN (shares=${pos.shares}, entry=${pos.entryPrice}, margin=${pos.margin})`);
            } else if (pos.shares > 0 && pos.entryPrice && !pos.costBasis) {
              fixedShorts[ticker] = { ...pos, costBasis: pos.entryPrice };
              shortsCorrupted = true;
              issues.push(`shorts.${ticker} missing costBasis (had entryPrice=${pos.entryPrice})`);
            } else if (pos.shares > 0 && pos.costBasis && !pos.entryPrice) {
              fixedShorts[ticker] = { ...pos, entryPrice: pos.costBasis };
              shortsCorrupted = true;
              issues.push(`shorts.${ticker} missing entryPrice (had costBasis=${pos.costBasis})`);
            }
          }
          if (shortsCorrupted) {
            for (const [ticker, pos] of Object.entries(data.shorts)) {
              if (!fixedShorts.hasOwnProperty(ticker)) fixedShorts[ticker] = pos;
            }
            fixes.shorts = fixedShorts;
          }
        }
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
          corrupted.push({ uid: userDoc.id, displayName: data.displayName || 'Unknown', issues, fixes });
        }
      }

      if (corrupted.length === 0) {
        setMessage({ type: 'success', text: 'No corrupted accounts found!' });
      } else {
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
  };

  const updateMarketHalt = async (halted, reason) => {
    if (halted && !reason.trim()) {
      setMessage({ type: 'error', text: 'Please enter a halt reason.' });
      return;
    }
    setLoading(true);
    try {
      await updateDoc(doc(db, 'market', 'current'), {
        marketHalted: halted,
        haltReason: halted ? reason.trim() : '',
        haltedAt: halted ? Date.now() : null,
        haltedBy: halted ? user.uid : null
      });
      setMessage({ type: 'success', text: halted ? 'Market halted.' : 'Market resumed.' });
      if (halted) setHaltReasonInput('');
    } catch (err) {
      setMessage({ type: 'error', text: halted ? 'Failed to halt market.' : 'Failed to resume market.' });
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

        {/* Tabs - Two-row layout */}
        <div className={`border-b ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
          <div className="flex">
            <button
              onClick={() => { setActiveTab('ipo'); loadIPOs(); }}
              className={`flex-1 text-center py-2.5 text-xs font-semibold transition-colors ${activeTab === 'ipo' ? 'text-orange-500 border-b-2 border-orange-500 bg-orange-500/10' : `${mutedClass} hover:bg-slate-500/10`}`}
            >
              🚀 IPO
            </button>
            <button
              onClick={() => { setActiveTab('predictions'); loadAllBets(); }}
              className={`flex-1 text-center py-2.5 text-xs font-semibold transition-colors ${activeTab === 'predictions' ? 'text-purple-500 border-b-2 border-purple-500 bg-purple-500/10' : `${mutedClass} hover:bg-slate-500/10`}`}
            >
              🎲 Bets {unresolvedPredictions.length > 0 && `(${unresolvedPredictions.length})`}
            </button>
            <button
              onClick={() => setActiveTab('holders')}
              className={`flex-1 text-center py-2.5 text-xs font-semibold transition-colors ${activeTab === 'holders' ? 'text-blue-500 border-b-2 border-blue-500 bg-blue-500/10' : `${mutedClass} hover:bg-slate-500/10`}`}
            >
              📊 Holders
            </button>
            <button
              onClick={() => setActiveTab('users')}
              className={`flex-1 text-center py-2.5 text-xs font-semibold transition-colors ${activeTab === 'users' ? 'text-green-500 border-b-2 border-green-500 bg-green-500/10' : `${mutedClass} hover:bg-slate-500/10`}`}
            >
              👥 Users
            </button>
            <button
              onClick={() => { setActiveTab('bots'); handleLoadBots(); }}
              className={`flex-1 text-center py-2.5 text-xs font-semibold transition-colors ${activeTab === 'bots' ? 'text-purple-500 border-b-2 border-purple-500 bg-purple-500/10' : `${mutedClass} hover:bg-slate-500/10`}`}
            >
              🤖 Bots
            </button>
            <button
              onClick={() => { setActiveTab('trades'); loadRecentTrades(tradeTimePeriod, tradeTypeFilter, tradeFilterTicker, tradeBotFilter); }}
              className={`flex-1 text-center py-2.5 text-xs font-semibold transition-colors ${activeTab === 'trades' ? 'text-yellow-500 border-b-2 border-yellow-500 bg-yellow-500/10' : `${mutedClass} hover:bg-slate-500/10`}`}
            >
              💹 Trades
            </button>
            <button
              onClick={() => setActiveTab('diagnostic')}
              className={`flex-1 text-center py-2.5 text-xs font-semibold transition-colors ${activeTab === 'diagnostic' ? 'text-pink-500 border-b-2 border-pink-500 bg-pink-500/10' : `${mutedClass} hover:bg-slate-500/10`}`}
            >
              🔍 Diag
            </button>
          </div>
          <div className="flex">
            <button
              onClick={() => { setActiveTab('stats'); loadMarketStats(); }}
              className={`flex-1 text-center py-2.5 text-xs font-semibold transition-colors ${activeTab === 'stats' ? 'text-cyan-500 border-b-2 border-cyan-500 bg-cyan-500/10' : `${mutedClass} hover:bg-slate-500/10`}`}
            >
              📈 Stats
            </button>
            <button
              onClick={() => setActiveTab('recovery')}
              className={`flex-1 text-center py-2.5 text-xs font-semibold transition-colors ${activeTab === 'recovery' ? 'text-red-500 border-b-2 border-red-500 bg-red-500/10' : `${mutedClass} hover:bg-slate-500/10`}`}
            >
              🔧 Recovery
            </button>
            <button
              onClick={() => { setActiveTab('badges'); loadBadgeUsers(); }}
              className={`flex-1 text-center py-2.5 text-xs font-semibold transition-colors ${activeTab === 'badges' ? 'text-amber-500 border-b-2 border-amber-500 bg-amber-500/10' : `${mutedClass} hover:bg-slate-500/10`}`}
            >
              🏅 Badges
            </button>
            <button
              onClick={() => setActiveTab('market')}
              className={`flex-1 text-center py-2.5 text-xs font-semibold transition-colors ${activeTab === 'market' ? 'text-blue-500 border-b-2 border-blue-500 bg-blue-500/10' : `${mutedClass} hover:bg-slate-500/10`}`}
            >
              🏛️ Market
            </button>
            <button
              onClick={() => { setActiveTab('watchlist'); if (!watchlistLoaded) loadWatchlist(); }}
              className={`flex-1 text-center py-2.5 text-xs font-semibold transition-colors ${activeTab === 'watchlist' ? 'text-red-500 border-b-2 border-red-500 bg-red-500/10' : `${mutedClass} hover:bg-slate-500/10`}`}
            >
              👁️ Watch
            </button>
            <button
              onClick={() => { setActiveTab('dividends'); loadDividendConfig(); }}
              className={`flex-1 text-center py-2.5 text-xs font-semibold transition-colors ${activeTab === 'dividends' ? 'text-emerald-500 border-b-2 border-emerald-500 bg-emerald-500/10' : `${mutedClass} hover:bg-slate-500/10`}`}
            >
              💵 Dividends
            </button>
          </div>
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
            <IpoTab
              darkMode={darkMode}
              textClass={textClass}
              mutedClass={mutedClass}
              inputClass={inputClass}
              loading={loading}
              ipoTicker={ipoTicker}
              setIpoTicker={setIpoTicker}
              ipoHoursUntilStart={ipoHoursUntilStart}
              setIpoHoursUntilStart={setIpoHoursUntilStart}
              ipoDurationHours={ipoDurationHours}
              setIpoDurationHours={setIpoDurationHours}
              ipoTotalShares={ipoTotalShares}
              setIpoTotalShares={setIpoTotalShares}
              ipoMaxPerUser={ipoMaxPerUser}
              setIpoMaxPerUser={setIpoMaxPerUser}
              ipoEligibleCharacters={ipoEligibleCharacters}
              activeIPOs={activeIPOs}
              handleCreateIPO={handleCreateIPO}
              handleCancelIPO={handleCancelIPO}
            />
          )}
          {/* PREDICTIONS TAB (Consolidated: Create + Resolve + View All + Bets) */}
          {activeTab === 'predictions' && (
            <PredictionsTab
              darkMode={darkMode}
              textClass={textClass}
              mutedClass={mutedClass}
              inputClass={inputClass}
              loading={loading}
              predictions={predictions}
              unresolvedPredictions={unresolvedPredictions}
              selectedPrediction={selectedPrediction}
              setSelectedPrediction={setSelectedPrediction}
              selectedOutcome={selectedOutcome}
              setSelectedOutcome={setSelectedOutcome}
              handleResolvePrediction={handleResolvePrediction}
              question={question}
              setQuestion={setQuestion}
              options={options}
              setOptions={setOptions}
              daysUntilEnd={daysUntilEnd}
              setDaysUntilEnd={setDaysUntilEnd}
              mayExtend={mayExtend}
              setMayExtend={setMayExtend}
              endDate={endDate}
              getEndTime={getEndTime}
              handleCreatePrediction={handleCreatePrediction}
              extendPredictionId={extendPredictionId}
              setExtendPredictionId={setExtendPredictionId}
              extendDays={extendDays}
              setExtendDays={setExtendDays}
              allowAdditionalBets={allowAdditionalBets}
              setAllowAdditionalBets={setAllowAdditionalBets}
              handleExtendPrediction={handleExtendPrediction}
              handleDeletePrediction={handleDeletePrediction}
              loadAllBets={loadAllBets}
              betsLoading={betsLoading}
              allBets={allBets}
              recoveryPredictionId={recoveryPredictionId}
              setRecoveryPredictionId={setRecoveryPredictionId}
              recoveryBets={recoveryBets}
              setRecoveryBets={setRecoveryBets}
              recoveryOptions={recoveryOptions}
              setRecoveryOptions={setRecoveryOptions}
              recoveryWinner={recoveryWinner}
              setRecoveryWinner={setRecoveryWinner}
              handleScanForBets={handleScanForBets}
              handleOverridePayout={handleOverridePayout}
            />
          )}

                    {/* HOLDERS TAB */}
          {activeTab === 'holders' && (
            <HoldersTab
              darkMode={darkMode}
              textClass={textClass}
              mutedClass={mutedClass}
              inputClass={inputClass}
              prices={prices}
              holdersTicker={holdersTicker}
              setHoldersTicker={setHoldersTicker}
              holdersData={holdersData}
              setHoldersData={setHoldersData}
              holdersLoading={holdersLoading}
              loadHolders={loadHolders}
            />
          )}

                    {/* USERS TAB */}
          {activeTab === 'users' && (
            <UsersTab
              darkMode={darkMode}
              textClass={textClass}
              mutedClass={mutedClass}
              inputClass={inputClass}
              loading={loading}
              prices={prices}
              userSearchQuery={userSearchQuery}
              handleUserSearch={handleUserSearch}
              setUsersPage={setUsersPage}
              userSortBy={userSortBy}
              handleUserSortChange={handleUserSortChange}
              handleLoadAllUsers={handleLoadAllUsers}
              handleRecalculatePortfolios={handleRecalculatePortfolios}
              deleteMode={deleteMode}
              setDeleteMode={setDeleteMode}
              setSelectedForDeletion={setSelectedForDeletion}
              selectedForDeletion={selectedForDeletion}
              allUsers={allUsers}
              userSearchResults={userSearchResults}
              usersPage={usersPage}
              USERS_PER_PAGE={25}
              selectedUser={selectedUser}
              setSelectedUser={setSelectedUser}
              calculateLivePortfolioValue={calculateLivePortfolioValue}
              handleSyncSingleUser={handleSyncSingleUser}
              handleSetCash={handleSetCash}
              handleReinstateUser={handleReinstateUser}
              handleChangeDisplayName={handleChangeDisplayName}
              newDisplayName={newDisplayName}
              setNewDisplayName={setNewDisplayName}
              handleRollbackUser={handleRollbackUser}
              toggleUserForDeletion={toggleUserForDeletion}
              deleteSelectedUsers={deleteSelectedUsers}
            />
          )}

                    {/* BOTS TAB */}
          {activeTab === 'bots' && (
            <BotsTab
              darkMode={darkMode}
              textClass={textClass}
              mutedClass={mutedClass}
              loading={loading}
              prices={prices}
              bots={bots}
              botsLoading={botsLoading}
              handleDeleteBot={handleDeleteBot}
            />
          )}

                    {/* TRADES TAB */}
          {activeTab === 'trades' && (
            <TradesTab
              darkMode={darkMode}
              textClass={textClass}
              mutedClass={mutedClass}
              tradeTimePeriod={tradeTimePeriod}
              setTradeTimePeriod={setTradeTimePeriod}
              tradeTypeFilter={tradeTypeFilter}
              setTradeTypeFilter={setTradeTypeFilter}
              tradeFilterTicker={tradeFilterTicker}
              setTradeFilterTicker={setTradeFilterTicker}
              tradeBotFilter={tradeBotFilter}
              setTradeBotFilter={setTradeBotFilter}
              tradesLoading={tradesLoading}
              recentTrades={recentTrades}
              loadRecentTrades={loadRecentTrades}
            />
          )}

                    {/* STATS TAB */}
          {activeTab === 'stats' && (
            <StatsTab
              darkMode={darkMode}
              textClass={textClass}
              mutedClass={mutedClass}
              loading={loading}
              statsLoading={statsLoading}
              marketStats={marketStats}
              loadMarketStats={loadMarketStats}
              handleCleanupBasePrices={handleCleanupBasePrices}
              handleSyncPricesToHistory={handleSyncPricesToHistory}
              handleResetAllPrices={handleResetAllPrices}
              orphanScanComplete={orphanScanComplete}
              orphanedUsers={orphanedUsers}
              scanForOrphanedUsers={scanForOrphanedUsers}
              deleteAllOrphanedUsers={deleteAllOrphanedUsers}
              deleteOrphanedUser={deleteOrphanedUser}
            />
          )}

                    {/* RECOVERY TAB */}
          {activeTab === 'recovery' && (
            <RecoveryTab
              darkMode={darkMode}
              textClass={textClass}
              mutedClass={mutedClass}
              inputClass={inputClass}
              loading={loading}
              bankruptLoaded={bankruptLoaded}
              bankruptUsers={bankruptUsers}
              loadBankruptUsers={loadBankruptUsers}
              handleReinstateUser={handleReinstateUser}
              scanningSpike={scanningSpike}
              repairingSpike={repairingSpike}
              spikeScanned={spikeScanned}
              spikeVictims={spikeVictims}
              handleScanSpikeVictims={handleScanSpikeVictims}
              handleRepairAllSpikeVictims={handleRepairAllSpikeVictims}
              handleRepairSpikeVictim={handleRepairSpikeVictim}
              diagnosisIds={diagnosisIds}
              setDiagnosisIds={setDiagnosisIds}
              diagnosing={diagnosing}
              diagnosisResults={diagnosisResults}
              handleDiagnoseUsers={handleDiagnoseUsers}
              handleManualBackup={handleManualBackup}
              handleRepairCorruptedAccounts={handleRepairCorruptedAccounts}
              loadingBackups={loadingBackups}
              backups={backups}
              handleListBackups={handleListBackups}
              restoringBackup={restoringBackup}
              handleRestoreBackup={handleRestoreBackup}
              oldUserId={oldUserId}
              setOldUserId={setOldUserId}
              newUserId={newUserId}
              setNewUserId={setNewUserId}
              transferring={transferring}
              handleTransferUserData={handleTransferUserData}
              renameOldTicker={renameOldTicker}
              setRenameOldTicker={setRenameOldTicker}
              renameNewTicker={renameNewTicker}
              setRenameNewTicker={setRenameNewTicker}
              renaming={renaming}
              renameResult={renameResult}
              setRenameResult={setRenameResult}
              showMessage={showMessage}
              renameTickerFunction={renameTickerFunction}
              tradeFilterTicker={tradeFilterTicker}
              setTradeFilterTicker={setTradeFilterTicker}
              sortedCharacters={sortedCharacters}
              prices={prices}
              selectedTickerHistory={selectedTickerHistory}
              setSelectedTickerHistory={setSelectedTickerHistory}
              getPriceHistoryForTicker={getPriceHistoryForTicker}
              rollbackTimestamp={rollbackTimestamp}
              setRollbackTimestamp={setRollbackTimestamp}
              rollbackConfirm={rollbackConfirm}
              setRollbackConfirm={setRollbackConfirm}
              executeFullRollback={executeFullRollback}
            />
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
                           c.ticker.toLowerCase().includes(search) ||
                           (c.altNames || []).some(n => n.toLowerCase().includes(search));
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
        <BadgesTab
          darkMode={darkMode}
          textClass={textClass}
          mutedClass={mutedClass}
          loading={loading}
          badgesLoaded={badgesLoaded}
          badgeUsers={badgeUsers}
          expandedBadge={expandedBadge}
          setExpandedBadge={setExpandedBadge}
          handleRemoveAchievement={handleRemoveAchievement}
        />
      )}

            {/* MARKET TAB */}
      {activeTab === 'market' && (
        <MarketTab
          darkMode={darkMode}
          textClass={textClass}
          mutedClass={mutedClass}
          loading={loading}
          setLoading={setLoading}
          setMessage={setMessage}
          user={user}
          prices={prices}
          marketHaltStatus={marketHaltStatus}
          marketHaltReason={marketHaltReason}
          haltReasonInput={haltReasonInput}
          setHaltReasonInput={setHaltReasonInput}
          updateMarketHalt={updateMarketHalt}
        />
      )}

            {/* WATCHLIST TAB */}
      {activeTab === 'watchlist' && (
        <WatchlistTab
          darkMode={darkMode}
          textClass={textClass}
          mutedClass={mutedClass}
          inputClass={inputClass}
          loading={loading}
          watchAddUserId={watchAddUserId}
          setWatchAddUserId={setWatchAddUserId}
          watchAddReason={watchAddReason}
          setWatchAddReason={setWatchAddReason}
          watchAddMaxAccounts={watchAddMaxAccounts}
          setWatchAddMaxAccounts={setWatchAddMaxAccounts}
          handleAddWatchedUser={handleAddWatchedUser}
          watchedUsers={watchedUsers}
          watchlistLoaded={watchlistLoaded}
          handleRemoveWatchedUser={handleRemoveWatchedUser}
          watchLinkTarget={watchLinkTarget}
          setWatchLinkTarget={setWatchLinkTarget}
          watchLinkAltId={watchLinkAltId}
          setWatchLinkAltId={setWatchLinkAltId}
          handleLinkAlt={handleLinkAlt}
          watchAddIPTarget={watchAddIPTarget}
          setWatchAddIPTarget={setWatchAddIPTarget}
          watchAddIPValue={watchAddIPValue}
          setWatchAddIPValue={setWatchAddIPValue}
          handleAddWatchedIP={handleAddWatchedIP}
          watchlistAlerts={watchlistAlerts}
          loadWatchlist={loadWatchlist}
        />
      )}

            {/* DIAGNOSTIC TAB */}
      {activeTab === 'diagnostic' && (
        <DiagnosticTab
          darkMode={darkMode}
          textClass={textClass}
          mutedClass={mutedClass}
          inputClass={inputClass}
          dropAuditQuery={dropAuditQuery}
          setDropAuditQuery={setDropAuditQuery}
          dropAuditRunning={dropAuditRunning}
          handleDropAudit={handleDropAudit}
          dropAuditResult={dropAuditResult}
          diagTicker={diagTicker}
          setDiagTicker={setDiagTicker}
          diagStartDate={diagStartDate}
          setDiagStartDate={setDiagStartDate}
          diagRunning={diagRunning}
          handleRunDiagnostic={handleRunDiagnostic}
          diagResult={diagResult}
          diagUserSort={diagUserSort}
          setDiagUserSort={setDiagUserSort}
          recoveryRollbackDate={recoveryRollbackDate}
          setRecoveryRollbackDate={setRecoveryRollbackDate}
          recoveryRunning={recoveryRunning}
          recoveryExecuting={recoveryExecuting}
          handleRecoveryPreview={handleRecoveryPreview}
          recoveryDone={recoveryDone}
          recoveryPreview={recoveryPreview}
          handleRecoveryExecute={handleRecoveryExecute}
        />
      )}

            {activeTab === 'dividends' && (
        <DividendsTab
          darkMode={darkMode}
          textClass={textClass}
          mutedClass={mutedClass}
          inputClass={inputClass}
          dividendActionLoading={dividendActionLoading}
          handleRunDividends={handleRunDividends}
          handleBackfillCohorts={handleBackfillCohorts}
          loadDividendConfig={loadDividendConfig}
          dividendRunResult={dividendRunResult}
          dividendLastRuns={dividendLastRuns}
          dividendSearch={dividendSearch}
          setDividendSearch={setDividendSearch}
          dividendConfigLoaded={dividendConfigLoaded}
          dividendOverrides={dividendOverrides}
          saveDividendTier={saveDividendTier}
        />
      )}

        </div>
  );
};

export default AdminPanel;
