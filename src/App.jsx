import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import {
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  applyActionCode,
  signInWithCustomToken
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  increment,
  serverTimestamp,
  arrayUnion,
  deleteField,
  runTransaction,
  addDoc
} from 'firebase/firestore';
import { auth, googleProvider, twitterProvider, db, createUserFunction, deleteAccountFunction, validateTradeFunction, recordTradeFunction, tradeSpikeAlertFunction, achievementAlertFunction, leaderboardChangeAlertFunction, marginLiquidationAlertFunction, ipoClosingAlertFunction, bankruptcyAlertFunction, comebackAlertFunction } from './firebase';
import { CHARACTERS, CHARACTER_MAP } from './characters';
import { CREWS, CREW_MAP, SHOP_PINS, SHOP_PINS_LIST, DAILY_MISSIONS, WEEKLY_MISSIONS, PIN_SLOT_COSTS, CREW_DIVIDEND_RATE, getWeekId, getCrewWeeklyMissions } from './crews';
import AdminPanel from './AdminPanel';
import { containsProfanity, getProfanityMessage } from './utils/profanity';
import LadderGame from './components/LadderGame';
import LimitOrders from './components/LimitOrders';

// Import modals
import AboutModal from './components/modals/AboutModal';
import CrewSelectionModal from './components/modals/CrewSelectionModal';
import PinShopModal from './components/modals/PinShopModal';
import DailyMissionsModal from './components/modals/DailyMissionsModal';
import ProfileModal from './components/modals/ProfileModal';
import AchievementsModal from './components/modals/AchievementsModal';
import MarginModal from './components/modals/MarginModal';
import EmailVerificationModal from './components/modals/EmailVerificationModal';
import LoginModal from './components/modals/LoginModal';
import UsernameModal from './components/modals/UsernameModal';
import TradeActionModal from './components/modals/TradeActionModal';
import ChartModal from './components/modals/ChartModal';
import PortfolioModal from './components/modals/PortfolioModal';

// Import other components
import CheckInButton from './components/CheckInButton';
import CharacterCard from './components/CharacterCard';
import { ToastNotification, ToastContainer } from './components/ToastNotification';
import ActivityFeed from './components/ActivityFeed';

// Import Layout and Pages
import Layout from './components/layout/Layout';
import LeaderboardPage from './pages/LeaderboardPage';
import AchievementsPage from './pages/AchievementsPage';
import LadderPage from './pages/LadderPage';
import ProfilePage from './pages/ProfilePage';

// Import AppContext
import { AppProvider } from './context/AppContext';

// Import from new modular structure
import {
  ADMIN_UIDS,
  ITEMS_PER_PAGE,
  STARTING_CASH,
  DAILY_BONUS,
  PRICE_UPDATE_INTERVAL,
  HISTORY_RECORD_INTERVAL,
  IPO_HYPE_DURATION,
  IPO_WINDOW_DURATION,
  IPO_TOTAL_SHARES,
  IPO_MAX_PER_USER,
  IPO_PRICE_JUMP,
  BASE_IMPACT,
  BASE_LIQUIDITY,
  BID_ASK_SPREAD,
  MIN_PRICE,
  MAX_PRICE_CHANGE_PERCENT,
  SHORT_MARGIN_REQUIREMENT,
  SHORT_INTEREST_RATE,
  SHORT_MARGIN_CALL_THRESHOLD,
  SHORT_RATE_LIMIT_HOURS,
  MAX_SHORTS_BEFORE_COOLDOWN,
  MARGIN_CASH_MINIMUM,
  MARGIN_TIERS,
  MARGIN_INTEREST_RATE,
  MARGIN_WARNING_THRESHOLD,
  MARGIN_CALL_THRESHOLD,
  MARGIN_LIQUIDATION_THRESHOLD,
  MARGIN_CALL_GRACE_PERIOD,
  MARGIN_MAINTENANCE_RATIO,
  MAX_DAILY_IMPACT_PER_USER
} from './constants';
import { ACHIEVEMENTS } from './constants/achievements';
import {
  formatCurrency,
  formatChange,
  formatNumber,
  formatTimeRemaining,
  round2
} from './utils/formatters';
import { getTodayDateString, isToday, toMillis, toDateString } from './utils/date';

// Transaction logging - records all significant financial actions for auditing
const logTransaction = async (db, userId, type, details) => {
  try {
    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);
    const userData = userSnap.data() || {};

    const transaction = {
      type, // 'BUY', 'SELL', 'SHORT_OPEN', 'SHORT_CLOSE', 'CHECKIN', 'BET', 'BET_WIN', 'BET_LOSS', 'MARGIN_INTEREST', 'LIQUIDATION', etc.
      timestamp: Date.now(),
      ...details,
      // Snapshot of user state at time of transaction
      cashBefore: details.cashBefore ?? userData.cash ?? 0,
      cashAfter: details.cashAfter ?? 0,
      portfolioBefore: details.portfolioBefore ?? userData.portfolioValue ?? 0,
      portfolioAfter: details.portfolioAfter ?? 0
    };

    // Remove any undefined values (Firestore doesn't support them)
    Object.keys(transaction).forEach(key => {
      if (transaction[key] === undefined) {
        delete transaction[key];
      }
    });

    // Keep last 100 transactions per user
    const transactionLog = userData.transactionLog || [];
    const updatedLog = [...transactionLog, transaction].slice(-100);

    await updateDoc(userRef, { transactionLog: updatedLog });
  } catch (err) {
    console.error('Failed to log transaction:', err);
    // Don't throw - logging failure shouldn't break the actual transaction
  }
};

// Check if user qualifies for margin trading (requires commitment + skill)
const checkMarginEligibility = (userData, isAdmin = false) => {
  if (!userData) return { eligible: false, requirements: [] };

  // Admin bypass - always eligible
  if (isAdmin) {
    return {
      eligible: true,
      requirements: [
        { met: true, label: '10+ daily check-ins', current: '∞', required: 10 },
        { met: true, label: '35+ total trades', current: '∞', required: 35 },
        { met: true, label: '$7,500+ peak portfolio', current: '∞', required: 7500 }
      ]
    };
  }

  const totalCheckins = userData.totalCheckins || 0;
  const totalTrades = userData.totalTrades || 0;
  const peakPortfolio = userData.peakPortfolioValue || 0;

  const requirements = [
    { met: totalCheckins >= 10, label: '10+ daily check-ins', current: totalCheckins, required: 10 },
    { met: totalTrades >= 35, label: '35+ total trades', current: totalTrades, required: 35 },
    { met: peakPortfolio >= 7500, label: '$7,500+ peak portfolio', current: peakPortfolio, required: 7500 }
  ];

  const allMet = requirements.every(r => r.met);

  return {
    eligible: allMet,
    requirements
  };
};

// Helper to get margin tier multiplier based on peak portfolio achievement
const getMarginTierMultiplier = (peakPortfolioValue) => {
  const peak = peakPortfolioValue || 0;
  if (peak >= 30000) return 0.75;
  if (peak >= 15000) return 0.50;
  if (peak >= 7500) return 0.35;
  return 0.25;
};

// Helper to get margin tier name for display
const getMarginTierName = (peakPortfolioValue) => {
  const peak = peakPortfolioValue || 0;
  if (peak >= 30000) return 'Platinum (0.75x)';
  if (peak >= 15000) return 'Gold (0.50x)';
  if (peak >= 7500) return 'Silver (0.35x)';
  return 'Bronze (0.25x)';
};

// Helper: Get current price from priceHistory (source of truth) or fall back to prices object
const getCurrentPrice = (ticker, priceHistory, prices) => {
  const history = priceHistory?.[ticker];
  if (history && history.length > 0) {
    return history[history.length - 1].price;
  }
  return prices?.[ticker] || CHARACTER_MAP[ticker]?.basePrice || 0;
};

// Calculate margin status for a user
const calculateMarginStatus = (userData, prices, priceHistory = {}) => {
  if (!userData || !userData.marginEnabled) {
    return {
      enabled: false,
      marginUsed: 0,
      availableMargin: 0,
      maxBorrowable: 0,
      tierMultiplier: 0,
      tierName: 'N/A',
      portfolioValue: 0,
      totalMaintenanceRequired: 0,
      equityRatio: 1,
      status: 'disabled'
    };
  }

  const cash = userData.cash || 0;
  const holdings = userData.holdings || {};
  const marginUsed = userData.marginUsed || 0;
  const peakPortfolio = userData.peakPortfolioValue || 0;

  // Get tier multiplier based on peak portfolio achievement
  const tierMultiplier = getMarginTierMultiplier(peakPortfolio);
  const tierName = getMarginTierName(peakPortfolio);

  // Calculate total holdings value and maintenance requirement
  let holdingsValue = 0;
  let totalMaintenanceRequired = 0;

  Object.entries(holdings).forEach(([ticker, shares]) => {
    if (shares > 0) {
      const price = getCurrentPrice(ticker, priceHistory, prices);
      const positionValue = price * shares;
      holdingsValue += positionValue;

      // Get character volatility for maintenance ratio
      const character = CHARACTER_MAP[ticker];
      totalMaintenanceRequired += positionValue * MARGIN_MAINTENANCE_RATIO;
    }
  });

  // Portfolio value = cash + holdings - margin debt
  const grossValue = cash + holdingsValue;
  const portfolioValue = grossValue - marginUsed;

  // Equity ratio = portfolio value / gross value (how much you actually own)
  const equityRatio = grossValue > 0 ? portfolioValue / grossValue : 1;

  // NEW: Cash-based borrowing with tiered multipliers
  const maxBorrowable = Math.max(0, cash * tierMultiplier);
  const availableMargin = Math.max(0, maxBorrowable - marginUsed);

  // Determine status
  let status = 'safe';
  if (marginUsed > 0) {
    if (equityRatio <= MARGIN_LIQUIDATION_THRESHOLD) {
      status = 'liquidation';
    } else if (equityRatio <= MARGIN_CALL_THRESHOLD) {
      status = 'margin_call';
    } else if (equityRatio <= MARGIN_WARNING_THRESHOLD) {
      status = 'warning';
    }
  }

  return {
    enabled: true,
    marginUsed,
    availableMargin: Math.round(availableMargin * 100) / 100,
    maxBorrowable: Math.round(maxBorrowable * 100) / 100,
    tierMultiplier,
    tierName,
    portfolioValue: Math.round(portfolioValue * 100) / 100,
    grossValue: Math.round(grossValue * 100) / 100,
    holdingsValue: Math.round(holdingsValue * 100) / 100,
    totalMaintenanceRequired: Math.round(totalMaintenanceRequired * 100) / 100,
    equityRatio: Math.round(equityRatio * 1000) / 1000,
    status,
    marginCallAt: userData.marginCallAt || null
  };
};

// Helper function to check and award achievements after an action
const checkAndAwardAchievements = async (userRef, userData, prices, context = {}) => {
  const currentAchievements = userData.achievements || [];
  const newAchievements = [];
  
  // Calculate current portfolio value (including shorts)
  const holdingsValue = Object.entries(userData.holdings || {})
    .reduce((sum, [ticker, shares]) => sum + (prices[ticker] || 0) * shares, 0);
  
  const shortsValue = Object.entries(userData.shorts || {})
    .reduce((sum, [ticker, position]) => {
      if (!position || position.shares <= 0) return sum;
      const currentPrice = prices[ticker] || position.entryPrice;
      const collateral = position.margin || 0;
      const pnl = (position.entryPrice - currentPrice) * position.shares;
      return sum + collateral + pnl;
    }, 0);
  
  const portfolioValue = (userData.cash || 0) + holdingsValue + shortsValue;
  
  // Calculate total holdings count
  const holdingsCount = Object.values(userData.holdings || {}).filter(shares => shares > 0).length;
  
  // Trade count achievements
  const totalTrades = userData.totalTrades || 0;
  if (totalTrades >= 1 && !currentAchievements.includes('FIRST_BLOOD')) {
    newAchievements.push('FIRST_BLOOD');
  }
  if (totalTrades >= 20 && !currentAchievements.includes('TRADER_20')) {
    newAchievements.push('TRADER_20');
  }
  if (totalTrades >= 100 && !currentAchievements.includes('TRADER_100')) {
    newAchievements.push('TRADER_100');
  }
  
  // Portfolio value achievements
  if (portfolioValue >= 2500 && !currentAchievements.includes('BROKE_2K')) {
    newAchievements.push('BROKE_2K');
  }
  if (portfolioValue >= 5000 && !currentAchievements.includes('BROKE_5K')) {
    newAchievements.push('BROKE_5K');
  }
  if (portfolioValue >= 10000 && !currentAchievements.includes('BROKE_10K')) {
    newAchievements.push('BROKE_10K');
  }
  if (portfolioValue >= 25000 && !currentAchievements.includes('BROKE_25K')) {
    newAchievements.push('BROKE_25K');
  }
  
  // Diversification achievement
  if (holdingsCount >= 5 && !currentAchievements.includes('DIVERSIFIED')) {
    newAchievements.push('DIVERSIFIED');
  }
  
  // Shark achievement (single trade worth $1000+)
  if (context.tradeValue && context.tradeValue >= 1000 && !currentAchievements.includes('SHARK')) {
    newAchievements.push('SHARK');
  }
  
  // Cold Blooded achievement (profitable short cover)
  if (context.shortProfit && context.shortProfit > 0 && !currentAchievements.includes('COLD_BLOODED')) {
    newAchievements.push('COLD_BLOODED');
  }
  
  // Bull Run achievement (sell for 25%+ profit)
  if (context.sellProfitPercent && context.sellProfitPercent >= 25 && !currentAchievements.includes('BULL_RUN')) {
    newAchievements.push('BULL_RUN');
  }
  
  // Diamond Hands achievement (held through 30%+ dip and sold at profit)
  if (context.isDiamondHands && !currentAchievements.includes('DIAMOND_HANDS')) {
    newAchievements.push('DIAMOND_HANDS');
  }
  
  // Update peak portfolio value
  const peakPortfolioValue = Math.max(userData.peakPortfolioValue || 0, portfolioValue);
  
  // Build update object
  const updateData = {};
  
  if (peakPortfolioValue > (userData.peakPortfolioValue || 0)) {
    updateData.peakPortfolioValue = peakPortfolioValue;
  }
  
  if (newAchievements.length > 0) {
    updateData.achievements = arrayUnion(...newAchievements);
  }
  
  // Only update if there's something to update
  if (Object.keys(updateData).length > 0) {
    await updateDoc(userRef, updateData);
  }
  
  return newAchievements;
};

// ============================================
// MARKET MECHANICS HELPERS
// ============================================

// Calculate price impact using square root model (used by real quant funds)
// This models real market microstructure where impact scales with sqrt of order size
const calculatePriceImpact = (currentPrice, shares, liquidity = BASE_LIQUIDITY, userDailyImpact = 0, velocityMultiplier = 1.0) => {
  // Square root model: impact = price * base_impact * sqrt(shares / liquidity)
  // This means: 4x the shares = 2x the impact (not 4x)
  let impact = currentPrice * BASE_IMPACT * Math.sqrt(shares / liquidity);

  // Apply velocity-based multiplier (anti-manipulation)
  // Increases price impact for users who repeatedly trade the same stock
  impact *= velocityMultiplier;

  // Cap the impact at MAX_PRICE_CHANGE_PERCENT per trade to prevent manipulation
  const maxImpact = currentPrice * MAX_PRICE_CHANGE_PERCENT;
  impact = Math.min(impact, maxImpact);

  // Anti-manipulation: Check daily impact limit per user per ticker
  const impactPercent = impact / currentPrice;
  const remainingAllowance = MAX_DAILY_IMPACT_PER_USER - userDailyImpact;

  if (remainingAllowance <= 0) {
    console.log(`[IMPACT LIMIT] User maxed out daily impact on this ticker (${(userDailyImpact * 100).toFixed(2)}%)`);
    return 0; // User maxed out, no impact allowed
  }

  if (impactPercent > remainingAllowance) {
    // Cap at remaining allowance
    console.log(`[IMPACT LIMIT] Capping impact from ${(impactPercent * 100).toFixed(2)}% to ${(remainingAllowance * 100).toFixed(2)}%`);
    return currentPrice * remainingAllowance;
  }

  return impact;
};

// Get effective liquidity for a character (can be customized per character later)
const getCharacterLiquidity = (ticker, tradingVolume = 0) => {
  // Base liquidity + bonus from trading volume
  // More actively traded = more liquid = harder to move
  const volumeBonus = Math.sqrt(tradingVolume) * 0.5;
  return BASE_LIQUIDITY + volumeBonus;
};

// Calculate bid (sell) and ask (buy) prices with spread
const getBidAskPrices = (midPrice) => {
  const halfSpread = midPrice * BID_ASK_SPREAD / 2;
  return {
    bid: midPrice - halfSpread,  // Price you get when selling
    ask: midPrice + halfSpread,  // Price you pay when buying
    spread: halfSpread * 2
  };
};

// ============================================
// SIMPLE LINE CHART COMPONENT
// (utilities are imported from ./utils)
// ============================================
// DETAILED CHART MODAL (imported from modals/)
// ============================================

// ChartModal - now imported from components/modals/

// ============================================
// NEW CHARACTERS BOARD COMPONENT
// ============================================

// Helper to get the start of the current prediction week (Wednesday)
const getWeekStart = () => {
  const now = new Date();
  const day = now.getDay();
  // Wednesday = 3, so we need to go back to the most recent Wednesday
  const daysToSubtract = (day + 4) % 7; // Days since last Wednesday
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - daysToSubtract);
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
};

// Helper to get week identifier for persistence
const getWeekIdentifier = () => {
  return getWeekStart().toISOString().split('T')[0]; // e.g., "2026-01-22"
};

// Helper to get predictions identifier for detecting new predictions
const getPredictionsIdentifier = (predictions) => {
  if (!predictions || predictions.length === 0) return 'none';
  // Create a simple hash based on prediction IDs
  return predictions.map(p => p.id).sort().join(',');
};

// Helper to load collapsed state from localStorage
const loadCollapsedState = (key, weekOrPredictionsId) => {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return true; // Default to expanded
    const { collapsed, identifier } = JSON.parse(stored);
    // If the week/predictions have changed, reset to expanded
    return identifier === weekOrPredictionsId ? collapsed : true;
  } catch {
    return true; // Default to expanded on error
  }
};

// Helper to save collapsed state to localStorage
const saveCollapsedState = (key, collapsed, identifier) => {
  try {
    localStorage.setItem(key, JSON.stringify({ collapsed, identifier }));
  } catch {
    // Ignore localStorage errors
  }
};

const NewCharactersBoard = ({ prices, priceHistory, darkMode, colorBlindMode = false, launchedTickers = [] }) => {
  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';
  
  const weekStart = getWeekStart();
  
  // Find characters added this week
  const newCharacters = CHARACTERS.filter(char => {
    const addedDate = new Date(char.dateAdded);
    // Only show if added this week AND either not IPO-required or already launched
    const isNewThisWeek = addedDate >= weekStart;
    const isAvailable = !char.ipoRequired || launchedTickers.includes(char.ticker);
    return isNewThisWeek && isAvailable;
  }).sort((a, b) => new Date(a.dateAdded) - new Date(b.dateAdded));
  
  if (newCharacters.length === 0) return null;
  
  // Calculate weekly change for each new character
  const getWeeklyChange = (ticker) => {
    const currentPrice = prices[ticker];
    const history = priceHistory[ticker] || [];
    
    if (!currentPrice || history.length === 0) return 0;
    
    // Find price from start of week
    const weekStartTime = weekStart.getTime();
    const startPrice = history.find(h => h.timestamp >= weekStartTime)?.price || history[0]?.price || currentPrice;
    
    return ((currentPrice - startPrice) / startPrice) * 100;
  };
  
  return (
    <div className={`${cardClass} border rounded-sm p-3`}>
      <h3 className={`text-xs font-semibold uppercase tracking-wide mb-2 ${mutedClass}`}>
        🆕 New This Week ({newCharacters.length})
      </h3>
      <div className="max-h-48 overflow-y-auto space-y-1">
        {newCharacters.map(char => {
          const price = prices[char.ticker] || char.basePrice;
          const change = getWeeklyChange(char.ticker);
          return (
            <div key={char.ticker} className={`flex items-center justify-between py-1 border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'} last:border-0`}>
              <div className="min-w-0 flex-1">
                <span className={`text-sm font-semibold ${textClass}`}>{char.name}</span>
                <span className={`text-xs ${mutedClass} ml-1`}>${char.ticker}</span>
              </div>
              <div className="text-right ml-2">
                <span className={`text-sm font-bold ${textClass}`}>${price.toFixed(2)}</span>
                <span className={`text-xs ml-1 ${colorBlindMode ? (change >= 0 ? 'text-teal-500' : 'text-purple-500') : (change >= 0 ? 'text-green-500' : 'text-red-500')}`}>
                  {change >= 0 ? '▲' : '▼'}{Math.abs(change).toFixed(1)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================
// PREDICTION CARD COMPONENT (Multi-Option with Auto-Payout)
// ============================================

const PredictionCard = ({ prediction, userBet, onBet, darkMode, isGuest, onRequestBet, betLimit = 0, isAdmin = false, onHide, userData }) => {
  const [betAmount, setBetAmount] = useState(50);
  const [selectedOption, setSelectedOption] = useState(null);
  const [showBetUI, setShowBetUI] = useState(false);

  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';

  const timeRemaining = prediction.endsAt - Date.now();
  const isActive = timeRemaining > 0 && !prediction.resolved;

  // Support both old (yesPool/noPool) and new (pools object) format
  const options = prediction.options || ['Yes', 'No'];
  const pools = prediction.pools || {
    'Yes': prediction.yesPool || 0,
    'No': prediction.noPool || 0
  };
  const totalPool = options.reduce((sum, opt) => sum + (pools[opt] || 0), 0);

  const getOptionPercent = (option) => {
    if (totalPool === 0) return Math.floor(100 / options.length);
    return Math.floor((pools[option] || 0) / totalPool * 100);
  };

  const calculatePayout = (option, amount) => {
    const myPool = pools[option] || 0;
    const otherPools = totalPool - myPool;
    const newMyPool = myPool + amount;
    const myShare = amount / newMyPool;
    return myShare * (otherPools + newMyPool);
  };

  const handlePlaceBet = () => {
    if (selectedOption && betAmount > 0) {
      // Use request bet to show confirmation
      if (onRequestBet) {
        onRequestBet(prediction.id, selectedOption, betAmount, prediction.question);
      } else {
        onBet(prediction.id, selectedOption, betAmount);
      }
      setShowBetUI(false);
      setSelectedOption(null);
      setBetAmount(50);
    }
  };

  // Check if user already has a bet on this prediction
  const hasExistingBet = !!userBet;

  // Color blind mode support - teal instead of green, purple instead of red
  const colorBlindMode = userData?.colorBlindMode || false;
  const optionColors = [
    colorBlindMode
      ? { bg: 'bg-teal-600', border: 'border-teal-600', text: 'text-teal-500', fill: 'bg-teal-500' }
      : { bg: 'bg-green-600', border: 'border-green-600', text: 'text-green-500', fill: 'bg-green-500' },
    colorBlindMode
      ? { bg: 'bg-purple-600', border: 'border-purple-600', text: 'text-purple-500', fill: 'bg-purple-500' }
      : { bg: 'bg-red-600', border: 'border-red-600', text: 'text-red-500', fill: 'bg-red-500' },
    { bg: 'bg-blue-600', border: 'border-blue-600', text: 'text-blue-500', fill: 'bg-blue-500' },
    { bg: 'bg-amber-600', border: 'border-amber-600', text: 'text-amber-500', fill: 'bg-amber-500' },
    { bg: 'bg-cyan-600', border: 'border-cyan-600', text: 'text-cyan-500', fill: 'bg-cyan-500' },
  ];

  return (
    <div className={`${cardClass} border rounded-sm p-4`}>
      <div className="flex justify-between items-start mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">🔮</span>
            <span className={`text-xs font-semibold uppercase ${isActive ? 'text-orange-500' : prediction.resolved ? 'text-amber-500' : 'text-red-500'}`}>
              {isActive ? 'Active' : prediction.resolved ? 'Resolved' : 'Ended'}
            </span>
            {prediction.reopened && isActive && (
              <span className="text-xs font-semibold uppercase text-blue-500">⏰ Extended</span>
            )}
          </div>
          <h3 className={`font-semibold ${textClass}`}>{prediction.question}</h3>
        </div>
        <div className="text-right">
          <div className={`text-xs ${mutedClass}`}>{isActive ? 'Ends in' : 'Ended'}</div>
          <div className={`text-sm font-semibold ${isActive ? 'text-orange-500' : mutedClass}`}>
            {isActive ? formatTimeRemaining(timeRemaining) : '—'}
          </div>
        </div>
      </div>

      <div className="mb-3">
        <div className={`text-xs ${mutedClass} mb-2`}>Pool: {formatCurrency(totalPool)}</div>
        <div className="space-y-2">
          {options.map((option, idx) => {
            const percent = getOptionPercent(option);
            const colors = optionColors[idx % optionColors.length];
            const isWinner = prediction.resolved && prediction.outcome === option;
            return (
              <div key={option} className="flex items-center gap-2">
                <div className={`w-32 sm:w-40 text-xs font-semibold ${colors.text} ${isWinner ? 'underline' : ''}`} title={option}>
                  {option} {isWinner && '✓'}
                </div>
                <div className="flex-1 h-4 bg-zinc-800 rounded-sm overflow-hidden">
                  <div className={`h-full ${colors.fill} transition-all`} style={{ width: `${percent}%` }} />
                </div>
                <div className={`w-10 text-xs text-right ${mutedClass}`}>{percent}%</div>
              </div>
            );
          })}
        </div>
      </div>

      {userBet && (
        <div className={`mb-3 p-2 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-amber-50'}`}>
          <div className={`text-xs ${mutedClass}`}>Your bet</div>
          <div className={`font-semibold ${optionColors[options.indexOf(userBet.option) % optionColors.length]?.text || 'text-orange-500'}`}>
            {formatCurrency(userBet.amount)} on "{userBet.option}"
          </div>
          {isActive && !prediction.resolved && (() => {
            // Calculate current potential payout
            const myPool = pools[userBet.option] || 0;
            const potentialPayout = myPool > 0 ? (userBet.amount / myPool) * totalPool : userBet.amount;
            return (
              <div className={`text-xs mt-1 ${mutedClass}`}>
                Current potential: <span className="text-orange-500 font-semibold">{formatCurrency(potentialPayout)}</span>
              </div>
            );
          })()}
          {prediction.resolved && (
            <div className={`text-xs mt-1 ${userBet.option === prediction.outcome ? 'text-green-500' : 'text-red-500'}`}>
              {userBet.option === prediction.outcome ? `🎉 Won ${formatCurrency(userBet.payout || 0)}!` : '❌ Lost'}
            </div>
          )}
        </div>
      )}

      {isActive && !isGuest && (
        <>
          {hasExistingBet && !prediction.allowAdditionalBets ? (
            <div className={`text-center py-2 text-sm ${mutedClass} bg-zinc-800/50 rounded-sm`}>
              🔒 You've already placed a bet on this prediction
            </div>
          ) : !showBetUI ? (
            <button onClick={() => {
              setShowBetUI(true);
              // Pre-select their existing option if they're adding to bet
              if (hasExistingBet && prediction.allowAdditionalBets) {
                setSelectedOption(userBet.option);
              }
            }}
              className="w-full py-2 text-sm font-semibold uppercase bg-orange-600 hover:bg-orange-700 text-white rounded-sm">
              {hasExistingBet && prediction.allowAdditionalBets ? 'Add to Bet' : 'Place Bet'}
            </button>
          ) : (
            <div className="space-y-3">
              {hasExistingBet && prediction.allowAdditionalBets && (
                <div className={`text-xs ${mutedClass} bg-blue-500/10 border border-blue-500 rounded-sm p-2`}>
                  💡 You can add more to your existing bet on "<span className="text-blue-500 font-semibold">{userBet.option}</span>" (cannot change or remove)
                </div>
              )}
              <div className={`grid gap-2 ${options.length <= 2 ? 'grid-cols-2' : 'grid-cols-2'}`}>
                {options.map((option, idx) => {
                  const colors = optionColors[idx % optionColors.length];
                  const isLocked = hasExistingBet && prediction.allowAdditionalBets && option !== userBet.option;
                  return (
                    <button
                      key={option}
                      onClick={() => !isLocked && setSelectedOption(option)}
                      disabled={isLocked}
                      className={`py-2 px-2 text-sm font-semibold rounded-sm border-2 transition-all truncate ${
                        isLocked
                          ? 'opacity-30 cursor-not-allowed border-zinc-700 text-zinc-500'
                          : selectedOption === option
                          ? `${colors.bg} border-transparent text-white`
                          : `${colors.border} ${colors.text} hover:opacity-80`
                      }`}>
                      {option}
                    </button>
                  );
                })}
              </div>
              <div>
                <div className={`text-xs ${mutedClass} mb-1`}>Bet Amount</div>
                <div className="flex gap-2">
                  {[25, 50, 100, 250].map(amount => (
                    <button key={amount} onClick={() => setBetAmount(amount)}
                      className={`flex-1 py-1.5 text-xs font-semibold rounded-sm ${
                        betAmount === amount ? 'bg-orange-600 text-white' : darkMode ? 'bg-zinc-800 text-zinc-300' : 'bg-slate-200 text-zinc-600'
                      }`}>
                      ${amount}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  value={betAmount || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '') {
                      setBetAmount(0);
                    } else {
                      const num = parseInt(val);
                      if (!isNaN(num) && num >= 0) {
                        setBetAmount(Math.min(num, betLimit || Infinity));
                      }
                    }
                  }}
                  onFocus={(e) => {
                    if (betAmount === 0) e.target.select();
                  }}
                  className={`w-full mt-2 px-3 py-2 text-sm rounded-sm border ${darkMode ? 'bg-zinc-950 border-zinc-700 text-zinc-100' : 'bg-white border-amber-200'}`}
                  placeholder="Custom amount..."
                />
                {betLimit > 0 && (
                  <div className={`text-xs ${mutedClass} mt-1`}>
                    Your bet limit: <span className="text-orange-500 font-semibold">{formatCurrency(betLimit)}</span>
                    <span className="opacity-70"> (based on market investment)</span>
                  </div>
                )}
              </div>
              {selectedOption && betAmount > 0 && (
                <div className={`text-sm ${mutedClass}`}>
                  Potential payout: <span className="text-orange-500 font-semibold">{formatCurrency(calculatePayout(selectedOption, betAmount))}</span>
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={() => { setShowBetUI(false); setSelectedOption(null); }}
                  className={`flex-1 py-2 text-sm font-semibold rounded-sm ${darkMode ? 'bg-zinc-800 text-zinc-300' : 'bg-slate-200 text-zinc-600'}`}>
                  Cancel
                </button>
                <button onClick={handlePlaceBet} disabled={!selectedOption || betAmount <= 0}
                  className="flex-1 py-2 text-sm font-semibold uppercase bg-orange-600 hover:bg-orange-700 text-white rounded-sm disabled:opacity-50">
                  {hasExistingBet && prediction.allowAdditionalBets ? 'Add to Bet' : 'Confirm'}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {isGuest && isActive && (
        <div className={`text-center text-sm ${mutedClass}`}>Sign in to place bets</div>
      )}

      {prediction.resolved && (
        <div className={`text-center py-2 rounded-sm mt-2 ${optionColors[options.indexOf(prediction.outcome) % optionColors.length]?.bg || 'bg-orange-600'} bg-opacity-20`}>
          <span className={`font-semibold ${optionColors[options.indexOf(prediction.outcome) % optionColors.length]?.text || 'text-orange-500'}`}>
            Winner: {prediction.outcome}
          </span>
        </div>
      )}

      {isAdmin && prediction.resolved && onHide && (
        <button
          onClick={() => onHide(prediction.id)}
          className={`w-full mt-2 py-1 text-xs rounded-sm ${darkMode ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700' : 'bg-slate-200 text-zinc-600 hover:bg-slate-300'}`}
        >
          Hide from feed
        </button>
      )}
    </div>
  );
};

// ============================================
// IPO HYPE CARD (24h announcement phase)
// ============================================

const IPOHypeCard = ({ ipo, darkMode }) => {
  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';
  
  const timeRemaining = ipo.ipoStartsAt - Date.now();
  const character = CHARACTER_MAP[ipo.ticker];
  
  return (
    <div className={`${cardClass} border rounded-sm p-4 relative overflow-hidden`}>
      {/* Animated gradient background */}
      <div className="absolute inset-0 bg-gradient-to-r from-orange-600/10 via-amber-500/10 to-orange-600/10 animate-pulse" />
      
      <div className="relative">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xl">🚀</span>
          <span className="text-xs font-bold uppercase text-orange-500 tracking-wider">IPO Coming Soon</span>
        </div>
        
        <h3 className={`text-lg font-bold ${textClass}`}>
          ${ipo.ticker} - {character?.name}
        </h3>
        
        {character?.description && (
          <p className={`text-sm ${mutedClass} mt-1 line-clamp-2`}>{character.description}</p>
        )}
        
        <div className={`mt-3 p-3 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-amber-50'}`}>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div>
              <p className={`text-xs ${mutedClass}`}>IPO Price</p>
              <p className="text-lg font-bold text-green-500">{formatCurrency(ipo.basePrice)}</p>
            </div>
            <div>
              <p className={`text-xs ${mutedClass}`}>Shares Available</p>
              <p className="text-lg font-bold text-orange-500">{IPO_TOTAL_SHARES}</p>
            </div>
          </div>
        </div>
        
        <div className="mt-3 text-center">
          <p className={`text-xs ${mutedClass}`}>IPO Opens In</p>
          <p className={`text-xl font-bold text-orange-500`}>{formatTimeRemaining(timeRemaining)}</p>
        </div>
        
        <p className={`text-xs ${mutedClass} mt-2 text-center`}>
          Max {IPO_MAX_PER_USER} shares per person • First come, first served
        </p>
      </div>
    </div>
  );
};

// ============================================
// IPO ACTIVE CARD (buying window)
// ============================================

const IPOActiveCard = ({ ipo, userData, onBuyIPO, darkMode, isGuest }) => {
  const [quantity, setQuantity] = useState(1);
  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';
  
  const character = CHARACTER_MAP[ipo.ticker];
  const timeRemaining = ipo.ipoEndsAt - Date.now();
  const sharesRemaining = ipo.sharesRemaining || IPO_TOTAL_SHARES;
  const userIPOPurchases = userData?.ipoPurchases?.[ipo.ticker] || 0;
  const maxCanBuy = Math.min(IPO_MAX_PER_USER - userIPOPurchases, sharesRemaining);
  const totalCost = quantity * ipo.basePrice;
  const canAfford = (userData?.cash || 0) >= totalCost;
  
  const soldOut = sharesRemaining <= 0;
  const userMaxedOut = userIPOPurchases >= IPO_MAX_PER_USER;
  
  return (
    <div className={`${cardClass} border-2 border-green-500 rounded-sm p-4 relative overflow-hidden`}>
      {/* Live indicator */}
      <div className="absolute top-2 right-2 flex items-center gap-1">
        <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        <span className="text-xs font-bold text-green-500">LIVE</span>
      </div>
      
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xl">📈</span>
        <span className="text-xs font-bold uppercase text-green-500 tracking-wider">IPO Now Open</span>
      </div>
      
      <h3 className={`text-lg font-bold ${textClass}`}>
        ${ipo.ticker} - {character?.name}
      </h3>
      
      <div className={`mt-3 p-3 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-amber-50'}`}>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className={`text-xs ${mutedClass}`}>Price</p>
            <p className="text-lg font-bold text-green-500">{formatCurrency(ipo.basePrice)}</p>
          </div>
          <div>
            <p className={`text-xs ${mutedClass}`}>Left</p>
            <p className={`text-lg font-bold ${sharesRemaining <= 20 ? 'text-red-500' : 'text-orange-500'}`}>
              {sharesRemaining}/{IPO_TOTAL_SHARES}
            </p>
          </div>
          <div>
            <p className={`text-xs ${mutedClass}`}>Ends In</p>
            <p className="text-lg font-bold text-amber-500">{formatTimeRemaining(timeRemaining)}</p>
          </div>
        </div>
        
        {/* Progress bar */}
        <div className="mt-2">
          <div className={`h-2 rounded-full ${darkMode ? 'bg-zinc-700' : 'bg-zinc-200'}`}>
            <div 
              className="h-full rounded-full bg-gradient-to-r from-green-500 to-orange-500 transition-all"
              style={{ width: `${((IPO_TOTAL_SHARES - sharesRemaining) / IPO_TOTAL_SHARES) * 100}%` }}
            />
          </div>
        </div>
      </div>
      
      {isGuest ? (
        <p className={`text-center text-sm ${mutedClass} mt-3`}>Sign in to participate in IPO</p>
      ) : soldOut ? (
        <div className="mt-3 text-center">
          <p className="text-red-500 font-bold">🚫 SOLD OUT</p>
          <p className={`text-xs ${mutedClass}`}>Normal trading begins soon with 30% price increase</p>
        </div>
      ) : userMaxedOut ? (
        <div className="mt-3 text-center">
          <p className="text-amber-500 font-semibold">✓ You've reached max IPO allocation</p>
          <p className={`text-xs ${mutedClass}`}>You purchased {userIPOPurchases} shares</p>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="1"
              max={maxCanBuy}
              value={quantity}
              onChange={(e) => setQuantity(Math.min(maxCanBuy, Math.max(1, parseInt(e.target.value) || 1)))}
              className={`w-20 px-2 py-1 text-center rounded-sm border ${darkMode ? 'bg-zinc-950 border-zinc-700 text-zinc-100' : 'bg-white border-amber-200'}`}
            />
            <span className={`text-sm ${mutedClass}`}>shares</span>
            <span className={`text-sm font-semibold ${textClass}`}>= {formatCurrency(totalCost)}</span>
          </div>
          
          <button
            onClick={() => onBuyIPO(ipo.ticker, quantity)}
            disabled={!canAfford || quantity > maxCanBuy}
            className="w-full py-2 text-sm font-bold uppercase bg-green-600 hover:bg-green-700 text-white rounded-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {!canAfford ? 'Insufficient Funds' : `Buy ${quantity} Share${quantity > 1 ? 's' : ''}`}
          </button>
          
          <p className={`text-xs ${mutedClass} text-center`}>
            You can buy up to {maxCanBuy} more shares
          </p>
        </div>
      )}
    </div>
  );
};

// ============================================
// PORTFOLIO MODAL (with chart)
// ============================================

// PortfolioModal - now imported from components/modals/

// ============================================
// LEADERBOARD MODAL
// ============================================

// LeaderboardModal - now imported from components/modals/



const inputClass = 'bg-zinc-950 border-zinc-700 text-zinc-100';

// ============================================
// MAIN APP
// ============================================

export default function App() {
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [prices, setPrices] = useState({});
  const [priceHistory, setPriceHistory] = useState({});
  const [marketData, setMarketData] = useState(null);
  const [launchedTickers, setLaunchedTickers] = useState([]);
  const [darkMode, setDarkMode] = useState(() => {
    // Initialize from localStorage if available
    try {
      const stored = localStorage.getItem('stockism_darkMode');
      if (stored !== null) {
        return stored === 'true';
      }
    } catch (error) {
      console.error('Failed to load dark mode preference:', error);
    }
    return true; // Default to dark mode
  });

  // Handler to toggle dark mode and persist to localStorage + Firestore
  const handleToggleDarkMode = useCallback(() => {
    setDarkMode(prev => {
      const newValue = !prev;
      // Save to localStorage immediately
      localStorage.setItem('stockism_darkMode', newValue);

      // Save to Firestore for signed-in users
      if (user) {
        const userDocRef = doc(db, 'users', user.uid);
        updateDoc(userDocRef, { darkMode: newValue }).catch(err => {
          console.error('Failed to save dark mode preference:', err);
        });
      }

      return newValue;
    });
  }, [user]);

  const [loading, setLoading] = useState(true);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showPortfolio, setShowPortfolio] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showLending, setShowLending] = useState(false);
  const [showBailout, setShowBailout] = useState(false);
  const [showCrewSelection, setShowCrewSelection] = useState(false);
  const [showPinShop, setShowPinShop] = useState(false);
  const [showDailyMissions, setShowDailyMissions] = useState(false);
  // Removed: showLeaderboard, showProfile, showAchievements, showLadderGame, showLadderIntroModal, showLadderSignInModal, skipLadderIntro
  // These features are now accessible via routes: /leaderboard, /profile, /achievements, /ladder
  const [selectedCharacter, setSelectedCharacter] = useState(null);
  const [notifications, setNotifications] = useState([]); // Toast notification queue

  // Handler for viewing charts with default time range
  const handleViewChart = (character, defaultTimeRange = '1d') => {
    setSelectedCharacter({ character, defaultTimeRange });
  };
  const [needsUsername, setNeedsUsername] = useState(false);
  const [needsEmailVerification, setNeedsEmailVerification] = useState(false);
  const [sortBy, setSortBy] = useState('price-high');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [showAll, setShowAll] = useState(false);
  const [predictions, setPredictions] = useState([]);
  const [showAdmin, setShowAdmin] = useState(false);
  const [activeIPOs, setActiveIPOs] = useState([]); // IPOs currently in hype or active phase
  const [tradeConfirmation, setTradeConfirmation] = useState(null); // { ticker, action, amount, price, total }
  const [limitOrderRequest, setLimitOrderRequest] = useState(null); // { ticker, action } - triggers opening trade modal in limit mode
  const [betConfirmation, setBetConfirmation] = useState(null); // { predictionId, option, amount, question }
  const [activityFeed, setActivityFeed] = useState([]); // Array of { id, type, message, timestamp, isGlobal }
  const [showActivityFeed, setShowActivityFeed] = useState(false); // Start minimized
  const [showPredictions, setShowPredictions] = useState(() => {
    // Initialize directly from localStorage - don't check identifier yet
    try {
      const stored = localStorage.getItem('showPredictions');
      if (stored) {
        const { collapsed } = JSON.parse(stored);
        return collapsed;
      }
    } catch {
      // Ignore errors
    }
    return true; // Default to expanded
  });
  const [showNewCharacters, setShowNewCharacters] = useState(() => {
    // Initialize from localStorage based on current week
    return loadCollapsedState('showNewCharacters', getWeekIdentifier());
  });

  // Color blind mode helpers - returns accessible colors
  const getColorBlindColors = useCallback((isPositive) => {
    const colorBlindMode = userData?.colorBlindMode || false;

    if (colorBlindMode) {
      // Color blind friendly: teal (positive) / purple (negative)
      return {
        text: isPositive ? 'text-teal-500' : 'text-purple-500',
        bg: isPositive ? 'bg-teal-600' : 'bg-purple-600',
        bgHover: isPositive ? 'hover:bg-teal-700' : 'hover:bg-purple-700',
        border: isPositive ? 'border-teal-500' : 'border-purple-500'
      };
    } else {
      // Standard: green (positive) / red (negative)
      return {
        text: isPositive ? 'text-green-500' : 'text-red-500',
        bg: isPositive ? 'bg-green-600' : 'bg-red-600',
        bgHover: isPositive ? 'hover:bg-green-700' : 'hover:bg-red-700',
        border: isPositive ? 'border-green-500' : 'border-red-500'
      };
    }
  }, [userData]);

  // Helper to show toast notification
  const showNotification = useCallback((type, message, image = null) => {
    const id = Date.now() + Math.random();
    setNotifications(prev => [...prev, { id, type, message, image }].slice(-5)); // Max 5 toasts
  }, []);

  // Helper to dismiss notification
  const dismissNotification = useCallback((id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  // Helper to add activity to feed
  const addActivity = useCallback((type, message, isGlobal = false) => {
    const activity = {
      id: Date.now() + Math.random(),
      type, // 'trade', 'achievement', 'mission', 'checkin', 'bet', 'global'
      message,
      timestamp: Date.now(),
      isGlobal
    };
    setActivityFeed(prev => [activity, ...prev].slice(0, 50)); // Keep last 50
  }, []);

  // Ref to store user data listener unsubscribe function
  const userDataUnsubscribeRef = useRef(null);

  // Handle Discord OAuth redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const discordToken = params.get('discord_token');

    if (discordToken) {
      // Sign in with custom token from Discord OAuth
      signInWithCustomToken(auth, discordToken)
        .then(() => {
          // Clean up URL
          window.history.replaceState({}, document.title, window.location.pathname);
        })
        .catch((error) => {
          console.error('Discord sign-in error:', error);
        });
    }
  }, []);

  // Listen to auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      // Clean up previous user data listener
      if (userDataUnsubscribeRef.current) {
        userDataUnsubscribeRef.current();
        userDataUnsubscribeRef.current = null;
      }

      setUser(firebaseUser);
      if (firebaseUser) {
        // Check if email is verified (only for email/password providers)
        const isEmailProvider = firebaseUser.providerData.some(p => p.providerId === 'password');
        if (isEmailProvider && !firebaseUser.emailVerified) {
          // Email not verified - block access
          setNeedsEmailVerification(true);
          setNeedsUsername(false);
          setUserData(null);
          setLoading(false);
          return;
        }

        setNeedsEmailVerification(false);

        // Listen to user data
        const userDocRef = doc(db, 'users', firebaseUser.uid);
        const userSnap = await getDoc(userDocRef);

        if (!userSnap.exists()) {
          // New user - prompt for username (don't auto-create yet)
          setNeedsUsername(true);
          setUserData(null);
        } else {
          setNeedsUsername(false);
          const data = userSnap.data();
          setUserData(data);

          // Sync dark mode from Firestore if user has a saved preference
          if (data.darkMode !== undefined) {
            setDarkMode(data.darkMode);
            localStorage.setItem('stockism_darkMode', data.darkMode);
          }

          // Subscribe to user data changes - store unsubscribe for cleanup
          userDataUnsubscribeRef.current = onSnapshot(userDocRef, (snap) => {
            if (snap.exists()) setUserData(snap.data());
          });
        }
      } else {
        setUserData(null);
        setNeedsUsername(false);
        setNeedsEmailVerification(false);
      }
      setLoading(false);
    });
    return () => {
      unsubscribe();
      // Clean up user data listener on unmount
      if (userDataUnsubscribeRef.current) {
        userDataUnsubscribeRef.current();
      }
    };
  }, []);

  // Handle Firebase email action codes (verification links)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode');
    const oobCode = urlParams.get('oobCode');

    if (mode === 'verifyEmail' && oobCode) {
      applyActionCode(auth, oobCode)
        .then(() => {
          // Verification successful - reload user and redirect
          if (auth.currentUser) {
            auth.currentUser.reload().then(() => {
              // Clear URL params and reload to update state
              window.history.replaceState({}, '', window.location.pathname);
              window.location.reload();
            });
          } else {
            window.history.replaceState({}, '', window.location.pathname);
            window.location.reload();
          }
        })
        .catch((error) => {
          console.error('Email verification failed:', error);
          // Could show error to user - link expired or already used
        });
    }
  }, []);

  // Listen to global market data
  useEffect(() => {
    const marketRef = doc(db, 'market', 'current');
    
    const unsubscribe = onSnapshot(marketRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        // Merge stored prices with basePrices for any new characters
        const storedPrices = data.prices || {};
        const launched = data.launchedTickers || [];
        const mergedPrices = {};
        CHARACTERS.forEach(c => {
          // Only include character if it doesn't require IPO, or if it's been launched
          if (!c.ipoRequired || launched.includes(c.ticker)) {
            mergedPrices[c.ticker] = storedPrices[c.ticker] ?? c.basePrice;
          }
        });
        setPrices(mergedPrices);
        setPriceHistory(data.priceHistory || {});
        setMarketData(data);
        setLaunchedTickers(launched);
      } else {
        // Initialize market data if it doesn't exist
        const initialPrices = {};
        const initialHistory = {};
        CHARACTERS.forEach(c => {
          // Skip characters that require IPO - they'll be added when IPO launches
          if (!c.ipoRequired) {
            initialPrices[c.ticker] = c.basePrice;
            initialHistory[c.ticker] = [{ timestamp: Date.now(), price: c.basePrice }];
          }
        });

        setDoc(marketRef, {
          prices: initialPrices,
          priceHistory: initialHistory,
          launchedTickers: [], // Initialize empty launched tickers array
          lastUpdate: serverTimestamp(),
          totalTrades: 0
        }, { merge: true }).catch(err => {
          console.error('Failed to initialize market data:', err);
        });

        setPrices(initialPrices);
        setPriceHistory(initialHistory);
        setLaunchedTickers([]);
      }
    });

    return () => unsubscribe();
  }, []);

  // Auto-add price history entries and run tiered pruning
  useEffect(() => {
    if (!user) return;

    const TWELVE_HOURS = 12 * 60 * 60 * 1000;
    const ONE_DAY = 24 * 60 * 60 * 1000;
    const SEVEN_DAYS = 7 * ONE_DAY;
    const ONE_YEAR = 365 * ONE_DAY;

    // Prune history based on age tiers
    const pruneHistoryTiers = (history, now) => {
      if (!history || history.length === 0) return { mainDoc: [], archive: [] };

      const tier1Cutoff = now - ONE_DAY;       // < 24h: keep all
      const tier2Cutoff = now - SEVEN_DAYS;    // 24h-7d: 1 per hour
      const tier3Cutoff = now - ONE_YEAR;      // 7d-1y: 1 per day (archive)
      // > 1y: 1 per week (archive)

      const tier1 = []; // < 24h - keep all
      const tier2 = []; // 24h-7d - will prune to hourly
      const tier3 = []; // 7d-1y - will prune to daily
      const tier4 = []; // > 1y - will prune to weekly

      // Sort into tiers
      for (const point of history) {
        if (point.timestamp >= tier1Cutoff) {
          tier1.push(point);
        } else if (point.timestamp >= tier2Cutoff) {
          tier2.push(point);
        } else if (point.timestamp >= tier3Cutoff) {
          tier3.push(point);
        } else {
          tier4.push(point);
        }
      }

      // Prune tier 2 to 1 point per hour
      const prunedTier2 = [];
      const seenHours2 = new Set();
      for (const point of tier2.sort((a, b) => b.timestamp - a.timestamp)) {
        const hourKey = Math.floor(point.timestamp / (60 * 60 * 1000));
        if (!seenHours2.has(hourKey)) {
          seenHours2.add(hourKey);
          prunedTier2.push(point);
        }
      }

      // Prune tier 3 to 1 point per day (daily close - last point of each day)
      const prunedTier3 = [];
      const seenDays3 = new Set();
      for (const point of tier3.sort((a, b) => b.timestamp - a.timestamp)) {
        const dayKey = Math.floor(point.timestamp / ONE_DAY);
        if (!seenDays3.has(dayKey)) {
          seenDays3.add(dayKey);
          prunedTier3.push(point);
        }
      }

      // Prune tier 4 to 1 point per week
      const prunedTier4 = [];
      const seenWeeks4 = new Set();
      const ONE_WEEK = 7 * ONE_DAY;
      for (const point of tier4.sort((a, b) => b.timestamp - a.timestamp)) {
        const weekKey = Math.floor(point.timestamp / ONE_WEEK);
        if (!seenWeeks4.has(weekKey)) {
          seenWeeks4.add(weekKey);
          prunedTier4.push(point);
        }
      }

      // Main doc: tier 1 + pruned tier 2 (last 7 days)
      const mainDoc = [...prunedTier2, ...tier1].sort((a, b) => a.timestamp - b.timestamp);

      // Archive: pruned tier 3 + pruned tier 4 (older than 7 days)
      const archive = [...prunedTier4, ...prunedTier3].sort((a, b) => a.timestamp - b.timestamp);

      return { mainDoc, archive };
    };

    const checkAndUpdatePriceHistory = async () => {
      const marketRef = doc(db, 'market', 'current');
      const now = Date.now();

      // First, fetch all archive data outside the transaction
      const archiveData = {};
      for (const character of CHARACTERS) {
        const ticker = character.ticker;
        const archiveRef = doc(db, 'market', 'current', 'price_history', ticker);
        const archiveSnap = await getDoc(archiveRef);
        archiveData[ticker] = archiveSnap.exists() ? (archiveSnap.data().history || []) : [];
      }

      let archiveUpdates = [];

      // Use transaction to prevent race conditions with trade updates
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(marketRef);

        if (!snap.exists()) return;

        const data = snap.data();
        const currentPrices = data.prices || {};
        const currentHistory = data.priceHistory || {};

        const mainDocUpdates = {};

        for (const character of CHARACTERS) {
          const ticker = character.ticker;
          const currentPrice = currentPrices[ticker] || character.basePrice;
          let history = [...(currentHistory[ticker] || [])];

          // Check if we need to add a new 12-hour entry
          const lastEntry = history[history.length - 1];
          const lastTimestamp = lastEntry?.timestamp || 0;
          const needsNewEntry = now - lastTimestamp >= TWELVE_HOURS;

          if (needsNewEntry) {
            history.push({ timestamp: now, price: currentPrice });
          }

          // Combine main doc history with archive for full pruning
          const existingArchive = archiveData[ticker] || [];
          const fullHistory = [...existingArchive, ...history];

          // Run tiered pruning
          const { mainDoc, archive } = pruneHistoryTiers(fullHistory, now);

          // Only update if something changed
          const historyChanged = needsNewEntry ||
            mainDoc.length !== (currentHistory[ticker] || []).length ||
            archive.length !== existingArchive.length;

          if (historyChanged) {
            mainDocUpdates[`priceHistory.${ticker}`] = mainDoc;

            if (archive.length > 0 || existingArchive.length > 0) {
              archiveUpdates.push({ ticker, history: archive });
            }
          }
        }

        // Update main document within transaction
        if (Object.keys(mainDocUpdates).length > 0) {
          transaction.update(marketRef, mainDocUpdates);
          console.log(`Updating price history for ${Object.keys(mainDocUpdates).length} characters`);
        }
      });

      // Update archive sub-collection documents (after transaction completes)
      for (const { ticker, history } of archiveUpdates) {
        const archiveRef = doc(db, 'market', 'current', 'price_history', ticker);
        await setDoc(archiveRef, { history, lastUpdated: now }, { merge: true });
      }

      if (archiveUpdates.length > 0) {
        console.log(`Archived history for ${archiveUpdates.length} characters`);
      }
    };

    // Run immediately on mount
    checkAndUpdatePriceHistory();

    // Then check every hour (will only update if 12h passed for new entries, but prunes on each run)
    const interval = setInterval(checkAndUpdatePriceHistory, 60 * 60 * 1000);

    return () => clearInterval(interval);
  }, [user]);

  // Listen to IPO data
  useEffect(() => {
    const ipoRef = doc(db, 'market', 'ipos');
    
    const unsubscribe = onSnapshot(ipoRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const ipos = data.list || [];
        const now = Date.now();
        
        // Filter to only show active IPOs (in hype or buying phase)
        const activeOnes = ipos.filter(ipo => {
          const inHypePhase = now < ipo.ipoStartsAt;
          const inBuyingPhase = now >= ipo.ipoStartsAt && now < ipo.ipoEndsAt && (ipo.sharesRemaining || IPO_TOTAL_SHARES) > 0;
          return inHypePhase || inBuyingPhase;
        });
        
        setActiveIPOs(activeOnes);
        
        // Check for IPOs that just ended and need price jump
        ipos.forEach(async (ipo) => {
          if (now >= ipo.ipoEndsAt && !ipo.priceJumped) {
            // IPO ended - apply 30% price jump and mark as complete
            const marketRef = doc(db, 'market', 'current');
            const newPrice = Math.round(ipo.basePrice * (1 + IPO_PRICE_JUMP) * 100) / 100;

            await updateDoc(marketRef, {
              [`prices.${ipo.ticker}`]: newPrice,
              [`priceHistory.${ipo.ticker}`]: arrayUnion({ timestamp: now, price: newPrice }),
              launchedTickers: arrayUnion(ipo.ticker) // Mark character as launched
            });

            // Mark IPO as price jumped
            const updatedList = ipos.map(i =>
              i.ticker === ipo.ticker ? { ...i, priceJumped: true } : i
            );
            await updateDoc(ipoRef, { list: updatedList });

            // Calculate IPO stats and send Discord notification
            try {
              const sharesSold = IPO_TOTAL_SHARES - (ipo.sharesRemaining || 0);
              const ipoPrice = ipo.basePrice / 1.3;
              const totalInvested = sharesSold * ipoPrice;

              // Query users to count participants
              const usersSnapshot = await getDocs(collection(db, 'users'));
              let participants = 0;
              usersSnapshot.forEach((userDoc) => {
                const userData = userDoc.data();
                if (userData.holdings && userData.holdings[ipo.ticker] > 0) {
                  participants++;
                }
              });

              const character = CHARACTER_MAP[ipo.ticker];
              await ipoClosingAlertFunction({
                ticker: ipo.ticker,
                characterName: character?.name || ipo.ticker,
                participants,
                totalInvested: Math.round(totalInvested * 100) / 100,
                totalShares: sharesSold
              });
            } catch (discordErr) {
              console.error('Failed to send IPO closing notification:', discordErr);
              // Don't block IPO closing if Discord fails
            }
          }
        });
      }
    });

    return () => unsubscribe();
  }, []);

  // Track lowest prices while holding for Diamond Hands achievement
  useEffect(() => {
    const updateLowestPrices = async () => {
      if (!user || !userData || !prices || Object.keys(prices).length === 0) return;
      
      const holdings = userData.holdings || {};
      const lowestWhileHolding = userData.lowestWhileHolding || {};
      const updates = {};
      
      // Check each held stock
      for (const [ticker, shares] of Object.entries(holdings)) {
        if (shares > 0 && prices[ticker]) {
          const currentPrice = prices[ticker];
          const currentLowest = lowestWhileHolding[ticker];
          
          // If we have a lower price than recorded, update it
          if (currentLowest === undefined || currentPrice < currentLowest) {
            updates[`lowestWhileHolding.${ticker}`] = Math.round(currentPrice * 100) / 100;
          }
        }
      }
      
      // Only update if there are changes
      if (Object.keys(updates).length > 0) {
        const userRef = doc(db, 'users', user.uid);
        await updateDoc(userRef, updates);
      }
    };
    
    updateLowestPrices();
  }, [user, userData?.holdings, prices]);

  // Initialize weekly mission data if new week
  useEffect(() => {
    const initializeWeeklyMissions = async () => {
      if (!user || !userData || !prices || Object.keys(prices).length === 0) return;

      const weekId = getWeekId();
      const weeklyData = userData.weeklyMissions?.[weekId];

      // If no data for this week yet, or no startPortfolioValue set, initialize it
      if (!weeklyData || weeklyData.startPortfolioValue === undefined) {
        // Calculate current portfolio value
        const holdingsValue = Object.entries(userData.holdings || {})
          .reduce((sum, [ticker, shares]) => sum + (prices[ticker] || 0) * shares, 0);
        const currentPortfolioValue = Math.round(((userData.cash || 0) + holdingsValue) * 100) / 100;

        const userRef = doc(db, 'users', user.uid);
        await updateDoc(userRef, {
          [`weeklyMissions.${weekId}.startPortfolioValue`]: currentPortfolioValue
        });
      }
    };

    initializeWeeklyMissions();
  }, [user, userData?.weeklyMissions, prices]);

  // Listen to predictions
  useEffect(() => {
    const predictionsRef = doc(db, 'predictions', 'current');
    
    const unsubscribe = onSnapshot(predictionsRef, (snap) => {
      if (snap.exists()) {
        setPredictions(snap.data().list || []);
      } else {
        // No predictions document - just show empty state
        // Only admins can create predictions via Admin Panel
        setPredictions([]);
      }
    });

    return () => unsubscribe();
  }, []);

  // Handle predictions collapse state - auto-expand when predictions change
  const predictionsLoadedRef = useRef(false);
  const lastPredictionsIdRef = useRef(null);

  useEffect(() => {
    if (predictions.length === 0) return;

    const predictionsId = getPredictionsIdentifier(predictions);

    // First time predictions load
    if (!predictionsLoadedRef.current) {
      predictionsLoadedRef.current = true;
      lastPredictionsIdRef.current = predictionsId;
      return; // Don't change state - useState already loaded from localStorage
    }

    // Check if predictions changed
    if (lastPredictionsIdRef.current !== predictionsId) {
      lastPredictionsIdRef.current = predictionsId;
      setShowPredictions(true); // Auto-expand on new predictions
    }
  }, [predictions]);

  // Persist predictions collapse state
  useEffect(() => {
    const predictionsId = getPredictionsIdentifier(predictions);
    saveCollapsedState('showPredictions', showPredictions, predictionsId);
  }, [showPredictions, predictions]);

  // Handle new characters collapse state - reset on new week
  useEffect(() => {
    const currentWeek = getWeekIdentifier();
    const stored = localStorage.getItem('showNewCharacters');

    if (stored) {
      try {
        const { identifier } = JSON.parse(stored);
        // If week has changed, reset to expanded
        if (identifier !== currentWeek) {
          setShowNewCharacters(true);
        }
      } catch {
        // Ignore errors
      }
    }
  }, []); // Only run on mount

  // Persist new characters collapse state
  useEffect(() => {
    const currentWeek = getWeekIdentifier();
    saveCollapsedState('showNewCharacters', showNewCharacters, currentWeek);
  }, [showNewCharacters]);

  // Auto-process payouts when prediction is resolved
  useEffect(() => {
    const processPayouts = async () => {
      if (!user || !userData || !userData.bets) return;

      for (const prediction of predictions) {
        if (!prediction.resolved || prediction.payoutsProcessed) continue;

        const userBet = userData.bets[prediction.id];
        if (!userBet || userBet.paid) continue;

        try {
          // Check if user won
          if (userBet.option === prediction.outcome) {
            // Calculate payout
            const options = prediction.options || ['Yes', 'No'];
            const pools = prediction.pools || {};
            const winningPool = pools[prediction.outcome] || 0;
            const totalPool = options.reduce((sum, opt) => sum + (pools[opt] || 0), 0);

            // Calculate payout - if pools are somehow 0, at minimum return the bet amount
            let payout = userBet.amount; // Default: return original bet
            if (winningPool > 0 && totalPool > 0) {
              const userShare = userBet.amount / winningPool;
              payout = userShare * totalPool;
            }

            // Calculate new prediction wins count
            const newPredictionWins = (userData.predictionWins || 0) + 1;

            // Check for Oracle/Prophet achievements
            const currentAchievements = userData.achievements || [];
            const newAchievements = [];

            if (newPredictionWins >= 3 && !currentAchievements.includes('ORACLE')) {
              newAchievements.push('ORACLE');
            }
            if (newPredictionWins >= 10 && !currentAchievements.includes('PROPHET')) {
              newAchievements.push('PROPHET');
            }

            // Update user's cash, mark bet as paid, increment wins
            const userRef = doc(db, 'users', user.uid);
            const updateData = {
              cash: userData.cash + payout,
              [`bets.${prediction.id}.paid`]: true,
              [`bets.${prediction.id}.payout`]: payout,
              predictionWins: newPredictionWins
            };

            if (newAchievements.length > 0) {
              updateData.achievements = arrayUnion(...newAchievements);
            }

            await updateDoc(userRef, updateData);
            console.log(`[Payout] Processed winning bet for prediction ${prediction.id}: +${payout}`);

            // Show achievement notification if earned, otherwise payout notification
            if (newAchievements.length > 0) {
              const achievement = ACHIEVEMENTS[newAchievements[0]];
              showNotification('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked! +${formatCurrency(payout)} payout!`);
            } else {
              showNotification('success', `🎉 Prediction payout: +${formatCurrency(payout)}!`);
            }
          } else {
            // Mark losing bet as processed
            const userRef = doc(db, 'users', user.uid);
            await updateDoc(userRef, {
              [`bets.${prediction.id}.paid`]: true,
              [`bets.${prediction.id}.payout`]: 0
            });
            console.log(`[Payout] Processed losing bet for prediction ${prediction.id}`);
          }
        } catch (error) {
          console.error(`[Payout] Failed to process payout for prediction ${prediction.id}:`, error);
          // Don't show error to user - the payout will be retried on next render
        }
      }
    };

    processPayouts();
  }, [user, userData, predictions]);

  // Check for margin calls on short positions
  useEffect(() => {
    const checkMarginCalls = async () => {
      if (!user || !userData || !userData.shorts || Object.keys(prices).length === 0) return;
      
      const shorts = userData.shorts;
      const liquidations = [];
      
      for (const [ticker, position] of Object.entries(shorts)) {
        if (!position || position.shares <= 0) continue;
        
        const currentPrice = prices[ticker];
        if (!currentPrice) continue;
        
        // Calculate current loss on position
        const loss = (currentPrice - position.entryPrice) * position.shares;
        const equityRemaining = position.margin - loss;
        const equityRatio = equityRemaining / (currentPrice * position.shares);
        
        // If equity drops below 25% of position value, liquidate
        if (equityRatio < SHORT_MARGIN_CALL_THRESHOLD) {
          liquidations.push({
            ticker,
            shares: position.shares,
            entryPrice: position.entryPrice,
            currentPrice,
            loss,
            margin: position.margin
          });
        }
      }
      
      // Process liquidations
      if (liquidations.length > 0) {
        const userRef = doc(db, 'users', user.uid);
        const marketRef = doc(db, 'market', 'current');
        let totalLoss = 0;
        const updateData = {};
        
        for (const liq of liquidations) {
          // Force cover at current price (no slippage benefit for liquidation)
          const coverCost = liq.currentPrice * liq.shares;
          const proceeds = liq.entryPrice * liq.shares;
          const netLoss = coverCost - proceeds;
          totalLoss += Math.max(0, netLoss - liq.margin); // Loss beyond margin
          
          // Clear the short position
          updateData[`shorts.${liq.ticker}`] = { shares: 0, entryPrice: 0, margin: 0 };
          
          // Price impact from forced cover (buying pressure) using square root model
          const liquidity = getCharacterLiquidity(liq.ticker);
          const priceImpact = calculatePriceImpact(liq.currentPrice, liq.shares, liquidity);
          const newPrice = liq.currentPrice + priceImpact;
          
          await updateDoc(marketRef, {
            [`prices.${liq.ticker}`]: Math.round(newPrice * 100) / 100,
            [`volume.${liq.ticker}`]: increment(liq.shares)
          });
        }
        
        // Deduct any losses beyond margin from cash (can go negative - triggers bankruptcy)
        const newCash = Math.round((userData.cash - totalLoss) * 100) / 100;
        updateData.cash = newCash;

        // Mark bankruptcy if going negative
        if (newCash < 0) {
          updateData.bankruptAt = Date.now();
        }

        await updateDoc(userRef, updateData);

        const tickerList = liquidations.map(l => l.ticker).join(', ');
        if (newCash < 0) {
          showNotification('error', `💀 BANKRUPT: ${tickerList} liquidated. You owe ${formatCurrency(Math.abs(newCash))}`);
        } else {
          showNotification('error', `⚠️ MARGIN CALL: ${tickerList} position(s) liquidated!`);
        }
      }
    };
    
    checkMarginCalls();
  }, [user, userData, prices]);

  // Calculate sentiment based on price changes
  const getSentiment = useCallback((ticker) => {
    const currentPrice = prices[ticker];
    if (!currentPrice) return 'Neutral';

    const history = priceHistory[ticker] || [];
    const now = Date.now();
    const dayAgo = now - (24 * 60 * 60 * 1000);
    const weekAgo = now - (7 * 24 * 60 * 60 * 1000);

    // Find 24h ago price
    let price24hAgo = currentPrice;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].timestamp <= dayAgo) {
        price24hAgo = history[i].price;
        break;
      }
    }
    if (price24hAgo === currentPrice && history.length > 0) {
      price24hAgo = history[0].price; // Use oldest if no 24h data
    }

    // Find 7d ago price
    let price7dAgo = currentPrice;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].timestamp <= weekAgo) {
        price7dAgo = history[i].price;
        break;
      }
    }
    if (price7dAgo === currentPrice && history.length > 0) {
      price7dAgo = history[0].price; // Use oldest if no 7d data
    }

    // Calculate changes
    const dailyChange = price24hAgo > 0 ? ((currentPrice - price24hAgo) / price24hAgo) * 100 : 0;
    const weeklyChange = price7dAgo > 0 ? ((currentPrice - price7dAgo) / price7dAgo) * 100 : 0;

    // Weighted: 60% daily, 40% weekly
    const weightedChange = (dailyChange * 0.6) + (weeklyChange * 0.4);

    // Thresholds
    if (weightedChange > 3) return 'Strong Buy';
    if (weightedChange > 1) return 'Bullish';
    if (weightedChange < -3) return 'Strong Sell';
    if (weightedChange < -1) return 'Bearish';
    return 'Neutral';
  }, [priceHistory, prices]);

  // Helper function to record price history (called after trades)
  const recordPriceHistory = useCallback(async (ticker, newPrice) => {
    const marketRef = doc(db, 'market', 'current');
    const now = Date.now();
    
    // Get current history
    const snap = await getDoc(marketRef);
    if (snap.exists()) {
      const data = snap.data();
      const currentHistory = data.priceHistory?.[ticker] || [];
      
      // Only record if price changed or last record was > 5 minutes ago
      const lastRecord = currentHistory[currentHistory.length - 1];
      const shouldRecord = !lastRecord || 
        lastRecord.price !== newPrice || 
        (now - lastRecord.timestamp) > 5 * 60 * 1000;
      
      if (shouldRecord) {
        const updatedHistory = [...currentHistory, { timestamp: now, price: newPrice }];

        await updateDoc(marketRef, {
          [`priceHistory.${ticker}`]: updatedHistory
        });
      }
    }
  }, []);

  // Helper function to record user portfolio history
  const recordPortfolioHistory = useCallback(async (userId, portfolioValue) => {
    const userRef = doc(db, 'users', userId);
    const now = Date.now();
    
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const data = snap.data();
      const currentHistory = data.portfolioHistory || [];
      
      // Only record if last record was > 5 minutes ago
      const lastRecord = currentHistory[currentHistory.length - 1];
      const shouldRecord = !lastRecord || (now - lastRecord.timestamp) > 5 * 60 * 1000;
      
      if (shouldRecord) {
        // Keep last 500 records per user
        const updatedHistory = [...currentHistory, { timestamp: now, value: portfolioValue }].slice(-500);
        
        await updateDoc(userRef, {
          portfolioHistory: updatedHistory
        });
      }
    }
  }, []);

  // Handle crew selection
  const handleCrewSelect = useCallback(async (crewId, isSwitch) => {
    if (!user || !userData) return;

    // Block if user is in debt
    if ((userData.cash || 0) < 0) {
      showNotification('error', 'You cannot join a crew while in debt. Pay off your balance first.');
      return;
    }

    // Check if user was exiled from this crew (in crew history)
    const crewHistory = userData.crewHistory || [];
    if (crewHistory.includes(crewId)) {
      const crewName = CREW_MAP[crewId]?.name || 'this crew';
      showNotification('error', `You have been permanently exiled from ${crewName}.`);
      return;
    }

    // Check 24-hour cooldown for joining/switching crews
    const lastChange = userData.lastCrewChange || 0;
    const hoursSinceChange = (Date.now() - lastChange) / (1000 * 60 * 60);
    if (hoursSinceChange < 24) {
      const hoursRemaining = Math.ceil(24 - hoursSinceChange);
      if (isSwitch && userData.crew) {
        showNotification('error', `You can only switch crews once every 24 hours. Try again in ${hoursRemaining}h.`);
      } else if (!userData.crew) {
        showNotification('error', `You cannot join a crew yet. Try again in ${hoursRemaining}h.`);
      }
      return;
    }

    try {
      const userRef = doc(db, 'users', user.uid);
      const now = Date.now();
      const updateData = {
        crew: crewId,
        crewJoinedAt: now,
        crewHistory: arrayUnion(crewId) // Track crew history
      };

      // Only charge penalty if LEAVING a crew to join another (switching)
      if (isSwitch && userData.crew) {
        // Take 15% of cash and 15% of each holding
        const penaltyRate = 0.15;
        const newCash = Math.floor(userData.cash * (1 - penaltyRate));
        const cashTaken = userData.cash - newCash;
        
        const newHoldings = {};
        let holdingsValueTaken = 0;
        
        Object.entries(userData.holdings || {}).forEach(([ticker, shares]) => {
          if (shares > 0) {
            // Take 15% of shares, rounding to nearest (round up if .5 or more)
            const sharesToTake = Math.round(shares * penaltyRate);
            const sharesToKeep = shares - sharesToTake;
            newHoldings[ticker] = sharesToKeep;
            holdingsValueTaken += sharesToTake * (prices[ticker] || 0);
          }
        });

        const totalTaken = cashTaken + holdingsValueTaken;

        updateData.cash = newCash;
        updateData.holdings = newHoldings;
        updateData.portfolioValue = Math.max(0, userData.portfolioValue - totalTaken);
        updateData.lastCrewChange = Date.now();

        const crew = CREW_MAP[crewId];
        await updateDoc(userRef, updateData);

        showNotification('success', `Switched to ${crew.name}! Lost ${formatCurrency(totalTaken)} (15% penalty)`);
      } else {
        // Joining a crew (no existing crew) - no cost
        await updateDoc(userRef, updateData);
        
        const crew = CREW_MAP[crewId];
        showNotification('success', `Welcome to ${crew.name}! ${crew.emblem}`);
      }
      
    } catch (err) {
      console.error('Failed to select crew:', err);
      showNotification('error', 'Failed to join crew');
    }
  }, [user, userData, prices]);

  // Handle leaving crew
  const handleCrewLeave = useCallback(async () => {
    if (!user || !userData || !userData.crew) return;

    // Block if user is in debt
    if ((userData.cash || 0) < 0) {
      showNotification('error', 'You cannot leave your crew while in debt.');
      return;
    }

    try {
      const userRef = doc(db, 'users', user.uid);
      const oldCrew = CREW_MAP[userData.crew];
      
      // Calculate 15% penalty from portfolio
      // Take 15% of cash and 15% of each holding
      const penaltyRate = 0.15;
      const newCash = Math.floor(userData.cash * (1 - penaltyRate));
      const cashTaken = userData.cash - newCash;
      
      const newHoldings = {};
      const holdingsTaken = {};
      let holdingsValueTaken = 0;
      
      Object.entries(userData.holdings || {}).forEach(([ticker, shares]) => {
        if (shares > 0) {
          // Take 15% of shares, rounding to nearest (round up if .5 or more)
          const sharesToTake = Math.round(shares * penaltyRate);
          const sharesToKeep = shares - sharesToTake;
          newHoldings[ticker] = sharesToKeep;
          holdingsTaken[ticker] = sharesToTake;
          holdingsValueTaken += sharesToTake * (prices[ticker] || 0);
        }
      });

      const totalTaken = cashTaken + holdingsValueTaken;
      const newPortfolioValue = userData.portfolioValue - totalTaken;

      // Also update cost basis for remaining shares
      const updateData = {
        crew: null,
        crewJoinedAt: null,
        isCrewHead: false,
        crewHeadColor: null,
        cash: newCash,
        holdings: newHoldings,
        portfolioValue: Math.max(0, newPortfolioValue),
        lastCrewChange: Date.now()
      };

      await updateDoc(userRef, updateData);

      showNotification('warning', `Left ${oldCrew?.name || 'crew'}. Lost ${formatCurrency(totalTaken)} (15% penalty). You cannot join a new crew for 24 hours.`);
    } catch (err) {
      console.error('Failed to leave crew:', err);
      showNotification('error', 'Failed to leave crew');
    }
  }, [user, userData, prices]);

  // Handle pin shop purchases and updates
  const handlePinAction = useCallback(async (action, payload, cost) => {
    if (!user || !userData) return;
    
    try {
      const userRef = doc(db, 'users', user.uid);
      
      if (action === 'buyPin') {
        // Buy a shop pin
        const currentOwned = userData.ownedShopPins || [];
        if (currentOwned.includes(payload)) return;
        
        await updateDoc(userRef, {
          ownedShopPins: arrayUnion(payload),
          cash: userData.cash - cost
        });
        
        const pin = SHOP_PINS[payload];
        const displayIcon = pin.image ? `/pins/${pin.image}` : null;
        const displayText = pin.image ? `Purchased ${pin.name}!` : `Purchased ${pin.emoji} ${pin.name}!`;
        showNotification('success', displayText, displayIcon);
        
      } else if (action === 'setShopPins') {
        // Update displayed shop pins
        await updateDoc(userRef, { displayedShopPins: payload });
        
      } else if (action === 'setAchievementPins') {
        // Update displayed achievement pins
        await updateDoc(userRef, { displayedAchievementPins: payload });
        
      } else if (action === 'toggleCrewPin') {
        // Toggle crew pin visibility (only for non-Crew Heads)
        if (!userData.isCrewHead) {
          await updateDoc(userRef, { displayCrewPin: payload });
        }
        
      } else if (action === 'buySlot') {
        // Buy extra slot
        const field = payload === 'achievement' ? 'extraAchievementSlot' : 'extraShopSlot';
        await updateDoc(userRef, {
          [field]: true,
          cash: userData.cash - cost
        });
        showNotification('success', `Unlocked extra ${payload} pin slot!`);
      }
    } catch (err) {
      console.error('Pin action failed:', err);
      showNotification('error', 'Action failed');
    }
  }, [user, userData]);

  // Handle claiming daily mission rewards
  const handleClaimMissionReward = useCallback(async (missionId, reward) => {
    if (!user || !userData) return;
    
    try {
      const userRef = doc(db, 'users', user.uid);
      const today = getTodayDateString();
      const currentTotalMissions = userData.totalMissionsCompleted || 0;
      const newTotalMissions = currentTotalMissions + 1;
      
      await updateDoc(userRef, {
        [`dailyMissions.${today}.claimed.${missionId}`]: true,
        cash: userData.cash + reward,
        totalMissionsCompleted: newTotalMissions
      });
      
      // Add to activity feed
      addActivity('mission', `📋 Mission complete! +${formatCurrency(reward)}`);
      
      // Check for mission achievements
      const achievements = userData.achievements || [];
      let earnedAchievement = null;
      
      if (newTotalMissions >= 10 && !achievements.includes('MISSION_10')) {
        await updateDoc(userRef, { achievements: arrayUnion('MISSION_10') });
        earnedAchievement = ACHIEVEMENTS.MISSION_10;
      } else if (newTotalMissions >= 50 && !achievements.includes('MISSION_50')) {
        await updateDoc(userRef, { achievements: arrayUnion('MISSION_50') });
        earnedAchievement = ACHIEVEMENTS.MISSION_50;
      } else if (newTotalMissions >= 100 && !achievements.includes('MISSION_100')) {
        await updateDoc(userRef, { achievements: arrayUnion('MISSION_100') });
        earnedAchievement = ACHIEVEMENTS.MISSION_100;
      }
      
      if (earnedAchievement) {
        addActivity('achievement', `🏆 ${earnedAchievement.emoji} ${earnedAchievement.name} unlocked!`);
        showNotification('achievement', `🏆 ${earnedAchievement.emoji} ${earnedAchievement.name} unlocked!`);
      } else {
        showNotification('success', `Claimed ${formatCurrency(reward)} mission reward!`);
      }
    } catch (err) {
      console.error('Failed to claim reward:', err);
      showNotification('error', 'Failed to claim reward');
    }
  }, [user, userData, addActivity]);

  // Handle claiming weekly mission rewards
  const handleClaimWeeklyMissionReward = useCallback(async (missionId, reward) => {
    if (!user || !userData) return;

    try {
      const userRef = doc(db, 'users', user.uid);
      const weekId = getWeekId();
      const currentTotalMissions = userData.totalMissionsCompleted || 0;
      const newTotalMissions = currentTotalMissions + 1;

      await updateDoc(userRef, {
        [`weeklyMissions.${weekId}.claimed.${missionId}`]: true,
        cash: userData.cash + reward,
        totalMissionsCompleted: newTotalMissions
      });

      // Add to activity feed
      addActivity('mission', `📋 Weekly mission complete! +${formatCurrency(reward)}`);

      // Check for mission achievements (same as daily)
      const achievements = userData.achievements || [];
      let earnedAchievement = null;

      if (newTotalMissions >= 10 && !achievements.includes('MISSION_10')) {
        await updateDoc(userRef, { achievements: arrayUnion('MISSION_10') });
        earnedAchievement = ACHIEVEMENTS.MISSION_10;
      } else if (newTotalMissions >= 50 && !achievements.includes('MISSION_50')) {
        await updateDoc(userRef, { achievements: arrayUnion('MISSION_50') });
        earnedAchievement = ACHIEVEMENTS.MISSION_50;
      } else if (newTotalMissions >= 100 && !achievements.includes('MISSION_100')) {
        await updateDoc(userRef, { achievements: arrayUnion('MISSION_100') });
        earnedAchievement = ACHIEVEMENTS.MISSION_100;
      }

      if (earnedAchievement) {
        addActivity('achievement', `🏆 ${earnedAchievement.emoji} ${earnedAchievement.name} unlocked!`);
        showNotification('achievement', `🏆 ${earnedAchievement.emoji} ${earnedAchievement.name} unlocked!`);
      } else {
        showNotification('success', `Claimed ${formatCurrency(reward)} weekly mission reward!`);
      }
    } catch (err) {
      console.error('Failed to claim weekly reward:', err);
      showNotification('error', 'Failed to claim reward');
    }
  }, [user, userData, addActivity]);

  // Request trade confirmation
  const requestTrade = useCallback((ticker, action, amount) => {
    if (!user || !userData) {
      showNotification('info', 'Sign in to start trading!');
      return;
    }
    
    // Check if character is in IPO phase (not tradeable normally)
    const now = Date.now();
    const activeIPO = activeIPOs.find(ipo => ipo.ticker === ticker && !ipo.priceJumped && now < ipo.ipoEndsAt);
    if (activeIPO) {
      const inHypePhase = now < activeIPO.ipoStartsAt;
      showNotification('error', inHypePhase 
        ? `$${ticker} is in IPO hype phase - trading opens soon!` 
        : `$${ticker} is in IPO - buy through the IPO section above!`);
      return;
    }
    
    // Check if character requires IPO but hasn't launched yet
    const character = CHARACTER_MAP[ticker];
    if (character?.ipoRequired && !launchedTickers.includes(ticker)) {
      showNotification('error', `$${ticker} requires an IPO before trading`);
      return;
    }
    
    const asset = CHARACTER_MAP[ticker];
    const price = prices[ticker] || asset?.basePrice || 0;
    
    // Calculate estimated total
    let total = price * amount;
    if (action === 'buy') {
      const priceImpact = calculatePriceImpact(price, amount, getCharacterLiquidity(ticker));
      const { ask } = getBidAskPrices(price + priceImpact);
      total = ask * amount;
    } else if (action === 'sell') {
      const priceImpact = calculatePriceImpact(price, amount, getCharacterLiquidity(ticker));
      const { bid } = getBidAskPrices(Math.max(MIN_PRICE, price - priceImpact));
      total = bid * amount;
    }
    
    setTradeConfirmation({ ticker, action, amount, price, total, name: asset?.name });
  }, [user, userData, prices, activeIPOs]);

  // Handle limit order request from portfolio
  const handleLimitOrderRequest = useCallback((ticker, action) => {
    if (!user || !userData) {
      showNotification('info', 'Sign in to start trading!');
      return;
    }
    setLimitOrderRequest({ ticker, action });
    setShowPortfolio(false); // Close portfolio modal
  }, [user, userData]);

  // Handle trade (executes after confirmation)
  const handleTrade = useCallback(async (ticker, action, amount) => {
    console.log(`[TRADE START] ticker=${ticker}, action=${action}, amount=${amount}`);
    if (!user || !userData) {
      showNotification('info', 'Sign in to start trading!');
      return;
    }

    // Block buying/shorting if user is in debt (selling/covering allowed)
    if ((userData.cash || 0) < 0 && (action === 'buy' || action === 'short')) {
      showNotification('error', 'You cannot open new positions while in debt. Request a bailout to start fresh.');
      return;
    }

    // SECURITY: Server-side validation BEFORE executing trade
    // This enforces cooldown, validates cash/holdings using server timestamp
    let priceImpactMultiplier = 1.0;
    let tradesInLastHour = 0;
    try {
      const validationResult = await validateTradeFunction({ ticker, action, amount });
      if (!validationResult.data.valid) {
        showNotification('error', 'Trade validation failed');
        return;
      }
      console.log('[TRADE VALIDATED]', validationResult.data);

      // Extract velocity multiplier from validation result
      priceImpactMultiplier = validationResult.data.priceImpactMultiplier || 1.0;
      tradesInLastHour = validationResult.data.tradesInLastHour || 0;

      // Show warning if user is approaching velocity limit
      if (priceImpactMultiplier > 1.0) {
        const multiplierPercent = ((priceImpactMultiplier - 1) * 100).toFixed(0);
        showNotification('warning', `⚠️ Repeated trading: Price impact +${multiplierPercent}% (${tradesInLastHour} trades on ${ticker} in last hour)`);
      }
    } catch (error) {
      console.error('[TRADE VALIDATION ERROR]', error);
      const message = error.message || 'Trade validation failed';
      // Extract user-friendly error message
      if (message.includes('Trade cooldown:')) {
        showNotification('error', message.replace(/^.*: /, ''));
      } else if (message.includes('Hold period:')) {
        showNotification('error', message.replace(/^.*: /, ''));
      } else if (message.includes('Short limit')) {
        // Show the full short limit message with time remaining
        showNotification('error', message.replace(/^.*: /, ''));
      } else if (message.includes('Trade velocity limit')) {
        // Show velocity limit error
        showNotification('error', message.replace(/^.*: /, ''));
      } else if (message.includes('Insufficient')) {
        showNotification('error', message.replace(/^.*: /, ''));
      } else {
        showNotification('error', 'Cannot execute trade at this time');
      }
      return;
    }

    // SECURITY: Use server timestamp via Firestore serverTimestamp()
    // This prevents client-side clock manipulation
    const serverTime = serverTimestamp();

    // Trade cooldown - client-side check as backup
    const now = Date.now();
    const lastTrade = toMillis(userData.lastTradeTime);
    const cooldownMs = 3000; // 3 second cooldown

    if (now - lastTrade < cooldownMs) {
      const remaining = Math.ceil((cooldownMs - (now - lastTrade)) / 1000);
      showNotification('error', `Please wait ${remaining}s between trades`);
      return;
    }

    const asset = CHARACTER_MAP[ticker];
    // Use priceHistory as source of truth (prices object can be stale/corrupted)
    const history = priceHistory[ticker];
    let price;
    if (history && history.length > 0) {
      price = history[history.length - 1].price;
    } else {
      price = prices[ticker] || asset?.basePrice;
    }
    if (!price || isNaN(price)) {
      showNotification('error', 'Price unavailable, try again');
      return;
    }
    
    const basePrice = asset?.basePrice || price;
    const userRef = doc(db, 'users', user.uid);
    const marketRef = doc(db, 'market', 'current');

    if (action === 'buy') {
      // Get liquidity for this character
      const liquidity = getCharacterLiquidity(ticker);

      // Get today's date for daily impact tracking
      const todayDate = new Date().toISOString().split('T')[0]; // "2026-01-31"
      const userDailyImpact = userData.dailyImpact?.[todayDate]?.[ticker] || 0;

      // Calculate price impact using square root model (with daily impact limit + velocity multiplier)
      const priceImpact = calculatePriceImpact(price, amount, liquidity, userDailyImpact, priceImpactMultiplier);
      const newMidPrice = price + priceImpact;
      
      // You pay the ASK price (mid + half spread) - this is realistic market friction
      const { ask } = getBidAskPrices(newMidPrice);
      const buyPrice = ask;
      const totalCost = buyPrice * amount;
      
      // Check if user has enough cash or can use margin
      const cashAvailable = userData.cash || 0;
      const marginEnabled = userData.marginEnabled || false;
      const marginUsed = userData.marginUsed || 0;
      const marginStatus = calculateMarginStatus(userData, prices, priceHistory);
      const availableMargin = marginStatus.availableMargin || 0;

      let cashToUse = 0;
      let marginToUse = 0;

      if (cashAvailable >= totalCost) {
        // Can pay with cash only
        cashToUse = totalCost;
        marginToUse = 0;
      } else if (marginEnabled && availableMargin > 0) {
        // Cash-based margin: use all available margin (already capped by cash * tierMultiplier)
        const maxBuyingPower = cashAvailable + availableMargin;

        if (totalCost > maxBuyingPower) {
          showNotification('error', `Insufficient funds! Need ${formatCurrency(totalCost)}. Max buying power: ${formatCurrency(maxBuyingPower)} (${formatCurrency(cashAvailable)} cash + ${formatCurrency(availableMargin)} margin)`);
          return;
        }

        // Use cash first, then margin
        cashToUse = cashAvailable;
        marginToUse = totalCost - cashAvailable;
      } else {
        // Not enough funds even with margin
        if (marginEnabled) {
          showNotification('error', `Insufficient funds! Need ${formatCurrency(totalCost)}, have ${formatCurrency(cashAvailable)} cash`);
        } else {
          showNotification('error', 'Insufficient funds!');
        }
        return;
      }

      // Market settles at new mid price (not ask)
      const settledPrice = Math.round(newMidPrice * 100) / 100;

      // Build market updates
      // SECURITY: Use local timestamp for price history (displayed in charts)
      // but validate on server that trades aren't happening too quickly
      // COLLISION PROTECTION: Prevent timestamp collisions during rapid trades
      const history = priceHistory[ticker] || [];
      const lastTimestamp = history.length > 0 ? history[history.length - 1].timestamp : 0;
      const now = Date.now();
      const priceHistoryTimestamp = now > lastTimestamp ? now : lastTimestamp + 1;
      const marketUpdates = {
        [`prices.${ticker}`]: settledPrice,
        [`volume.${ticker}`]: increment(amount), // Track trading volume
        [`priceHistory.${ticker}`]: arrayUnion({ timestamp: priceHistoryTimestamp, price: settledPrice })
      };

      // Apply trailing stock factor effects (recursive with depth limit)
      const applyTrailingEffects = (sourceTicker, sourceOldPrice, sourceNewPrice, depth = 0, visited = new Set()) => {
        console.log(`[TRAILING] depth=${depth}, ticker=${sourceTicker}, oldPrice=${sourceOldPrice}, newPrice=${sourceNewPrice}, visited=${Array.from(visited).join(',')}`);

        if (depth > 3 || visited.has(sourceTicker)) {
          console.log(`[TRAILING] Skipping ${sourceTicker} - depth=${depth}, inVisited=${visited.has(sourceTicker)}`);
          return; // Max 3 levels deep, prevent cycles
        }
        visited.add(sourceTicker);

        const character = CHARACTER_MAP[sourceTicker];
        if (!character?.trailingFactors) {
          console.log(`[TRAILING] ${sourceTicker} has no trailingFactors`);
          return;
        }

        const priceChangePercent = (sourceNewPrice - sourceOldPrice) / sourceOldPrice;
        console.log(`[TRAILING] ${sourceTicker} price changed ${(priceChangePercent * 100).toFixed(2)}%, processing ${character.trailingFactors.length} followers`);

        character.trailingFactors.forEach(({ ticker: relatedTicker, coefficient }) => {
          // Skip if we've already updated this ticker in this batch
          if (visited.has(relatedTicker)) {
            console.log(`[TRAILING] Skipping ${relatedTicker} - already visited`);
            return;
          }

          // Get current price - check marketUpdates first, then fall back to prices
          const oldRelatedPrice = marketUpdates[`prices.${relatedTicker}`] || prices[relatedTicker];
          if (oldRelatedPrice) {
            const trailingChange = priceChangePercent * coefficient;
            const newRelatedPrice = oldRelatedPrice * (1 + trailingChange);
            const settledRelatedPrice = Math.max(MIN_PRICE, Math.round(newRelatedPrice * 100) / 100);

            console.log(`[TRAILING] Updating ${relatedTicker}: $${oldRelatedPrice} -> $${settledRelatedPrice} (${(trailingChange * 100).toFixed(2)}% from ${sourceTicker})`);

            marketUpdates[`prices.${relatedTicker}`] = settledRelatedPrice;
            marketUpdates[`priceHistory.${relatedTicker}`] = arrayUnion({
              timestamp: priceHistoryTimestamp,
              price: settledRelatedPrice
            });

            // Recursively apply trailing effects with shared visited set (no cloning)
            applyTrailingEffects(relatedTicker, oldRelatedPrice, settledRelatedPrice, depth + 1, visited);
          }
        });
      };

      console.log(`[TRAILING START] About to call applyTrailingEffects for ${ticker}: $${price} -> $${settledPrice}`);
      applyTrailingEffects(ticker, price, settledPrice);
      console.log(`[TRAILING END] Finished applyTrailingEffects for ${ticker}`);

      // Atomic price + history update (prevents data loss if one write fails)
      await updateDoc(marketRef, marketUpdates);

      // Calculate new cost basis (weighted average)
      const currentHoldings = userData.holdings[ticker] || 0;
      const currentCostBasis = userData.costBasis?.[ticker] || 0;
      const newHoldings = currentHoldings + amount;
      const newCostBasis = currentHoldings > 0
        ? ((currentCostBasis * currentHoldings) + (buyPrice * amount)) / newHoldings
        : buyPrice;
      
      // Track lowest price while holding for Diamond Hands achievement
      const currentLowest = userData.lowestWhileHolding?.[ticker];
      const newLowest = currentHoldings === 0 
        ? buyPrice  // First buy, set to buy price
        : Math.min(currentLowest || buyPrice, buyPrice);  // Keep tracking lowest

      // Check if this is a crew member purchase for daily missions
      const today = getTodayDateString();
      const weekId = getWeekId();
      const userCrew = userData.crew;
      const crewMembers = userCrew ? CREW_MAP[userCrew]?.members || [] : [];
      const isBuyingCrewMember = crewMembers.includes(ticker);
      const currentCrewSharesBought = userData.dailyMissions?.[today]?.crewSharesBought || 0;

      // Check if buying a rival (any crew member that's not user's crew)
      const isRival = !isBuyingCrewMember && Object.values(CREWS).some(crew => crew.members.includes(ticker));

      // Check if underdog (price under $20)
      const isUnderdog = price < 20;

      // Calculate trade value for weekly missions
      const tradeValue = amount * buyPrice;

      // Track actual impact applied for anti-manipulation limits
      const rawImpactPercent = Math.abs(priceImpact / price);
      const newDailyImpact = userDailyImpact + rawImpactPercent;

      // Update user with trade count, cost basis, last buy time, and daily/weekly mission progress
      // SECURITY: Use server timestamp for lastTradeTime to prevent race conditions
      const updateData = {
        cash: cashAvailable - cashToUse,
        marginUsed: marginUsed + marginToUse,
        [`holdings.${ticker}`]: newHoldings,
        [`costBasis.${ticker}`]: Math.round(newCostBasis * 100) / 100,
        [`lowestWhileHolding.${ticker}`]: Math.round(newLowest * 100) / 100,
        [`lastBuyTime.${ticker}`]: serverTime,
        [`lastTickerTradeTime.${ticker}`]: serverTime,
        lastTradeTime: serverTime,
        totalTrades: increment(1),
        // Daily impact tracking (anti-manipulation)
        [`dailyImpact.${todayDate}.${ticker}`]: newDailyImpact,
        // Daily missions
        [`dailyMissions.${today}.tradesCount`]: increment(1),
        [`dailyMissions.${today}.tradeVolume`]: increment(amount),
        [`dailyMissions.${today}.boughtAny`]: true,
        // Weekly missions
        [`weeklyMissions.${weekId}.tradeValue`]: increment(tradeValue),
        [`weeklyMissions.${weekId}.tradeVolume`]: increment(amount),
        [`weeklyMissions.${weekId}.tradeCount`]: increment(1),
        [`weeklyMissions.${weekId}.tradingDays.${today}`]: true
      };
      
      // Mark crew member purchase if applicable
      if (isBuyingCrewMember) {
        updateData[`dailyMissions.${today}.boughtCrewMember`] = true;
        updateData[`dailyMissions.${today}.crewSharesBought`] = currentCrewSharesBought + amount;
      }
      
      // Mark rival purchase if applicable
      if (isRival) {
        updateData[`dailyMissions.${today}.boughtRival`] = true;
      }
      
      // Mark underdog purchase if applicable
      if (isUnderdog) {
        updateData[`dailyMissions.${today}.boughtUnderdog`] = true;
      }

      await updateDoc(userRef, updateData);

      await updateDoc(marketRef, { totalTrades: increment(1) });
      
      // Record portfolio history
      const newPortfolioValue = (cashAvailable - cashToUse) + Object.entries(userData.holdings || {})
        .reduce((sum, [t, shares]) => sum + (prices[t] || 0) * (t === ticker ? shares + amount : shares), 0);
      await recordPortfolioHistory(user.uid, Math.round(newPortfolioValue * 100) / 100);
      
      // Log transaction for auditing
      await logTransaction(db, user.uid, 'BUY', {
        ticker,
        shares: amount,
        pricePerShare: buyPrice,
        totalCost,
        cashUsed: cashToUse,
        marginUsed: marginToUse,
        cashBefore: cashAvailable,
        cashAfter: cashAvailable - cashToUse,
        portfolioAfter: Math.round(newPortfolioValue * 100) / 100
      });

      // SECURITY: Record trade in Cloud Functions for auditing & fraud detection
      recordTradeFunction({
        ticker,
        action: 'BUY',
        amount,
        price: buyPrice,
        totalValue: totalCost,
        cashBefore: cashAvailable,
        cashAfter: cashAvailable - cashToUse,
        portfolioAfter: Math.round(newPortfolioValue * 100) / 100
      }).catch(err => console.error('[RECORD TRADE ERROR]', err));

      // Check achievements (pass trade value for Shark achievement)
      const earnedAchievements = await checkAndAwardAchievements(userRef, {
        ...userData,
        cash: cashAvailable - cashToUse,
        holdings: { ...userData.holdings, [ticker]: (userData.holdings[ticker] || 0) + amount },
        totalTrades: (userData.totalTrades || 0) + 1
      }, prices, { tradeValue: totalCost });
      
      const impactPercent = ((newMidPrice - price) / price * 100).toFixed(2);
      
      // Add to activity feed
      const charName = CHARACTERS.find(c => c.ticker === ticker)?.name || ticker;
      addActivity('trade', `Bought ${amount} $${ticker} (${charName}) @ ${formatCurrency(buyPrice)}`);
      
      if (earnedAchievements.length > 0) {
        const achievement = ACHIEVEMENTS[earnedAchievements[0]];
        addActivity('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked!`);
        showNotification('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked! Bought ${amount} ${ticker}`);
        // Send achievement alert to Discord
        try {
          achievementAlertFunction({
            achievementId: earnedAchievements[0],
            achievementName: achievement.name,
            achievementDescription: achievement.description
          }).catch(() => {}); // Fire and forget
        } catch {}
      } else {
        let message = `Bought ${amount} ${ticker} @ ${formatCurrency(buyPrice)} (${impactPercent > 0 ? '+' : ''}${impactPercent}% impact)`;

        // Warn if approaching daily impact limit
        if (newDailyImpact >= MAX_DAILY_IMPACT_PER_USER) {
          message += ' • Daily impact limit reached for this ticker';
        } else if (newDailyImpact >= MAX_DAILY_IMPACT_PER_USER * 0.8) {
          const remaining = ((MAX_DAILY_IMPACT_PER_USER - newDailyImpact) * 100).toFixed(1);
          message += ` • ${remaining}% impact remaining today`;
        }

        showNotification('success', message);
      }

      // Send trade spike alert if price moved 1%+
      if (Math.abs(parseFloat(impactPercent)) >= 1) {
        try {
          tradeSpikeAlertFunction({
            ticker,
            priceBefore: price,
            priceAfter: settledPrice,
            tradeType: 'BUY',
            shares: amount
          }).catch(() => {}); // Fire and forget
        } catch {}
      }

    } else if (action === 'sell') {
      const currentHoldings = userData.holdings[ticker] || 0;
      if (currentHoldings < amount) {
        showNotification('error', 'Not enough shares!');
        return;
      }

      // Holding period check - must hold shares for 45 seconds before selling
      const HOLDING_PERIOD_MS = 45 * 1000; // 45 seconds
      const lastBuyTime = toMillis(userData.lastBuyTime?.[ticker]);
      const timeSinceBuy = now - lastBuyTime;
      
      if (lastBuyTime > 0 && timeSinceBuy < HOLDING_PERIOD_MS) {
        const remainingMs = HOLDING_PERIOD_MS - timeSinceBuy;
        const remainingMins = Math.ceil(remainingMs / 60000);
        const remainingSecs = Math.ceil((remainingMs % 60000) / 1000);
        const timeStr = remainingMins > 1 ? `${remainingMins} min` : `${remainingSecs} sec`;
        showNotification('error', `Hold period: wait ${timeStr} before selling ${ticker}`);
        return;
      }

      // Get liquidity for this character
      const liquidity = getCharacterLiquidity(ticker);

      // Get today's date for daily impact tracking
      const todayDate = new Date().toISOString().split('T')[0]; // "2026-01-31"
      const userDailyImpact = userData.dailyImpact?.[todayDate]?.[ticker] || 0;

      // Calculate price impact using square root model (selling pushes price down, with daily impact limit + velocity multiplier)
      const priceImpact = calculatePriceImpact(price, amount, liquidity, userDailyImpact, priceImpactMultiplier);
      const newMidPrice = Math.max(MIN_PRICE, price - priceImpact);
      
      // You get the BID price (mid - half spread) - market friction
      const { bid } = getBidAskPrices(newMidPrice);
      const sellPrice = Math.max(MIN_PRICE, bid);
      const totalRevenue = sellPrice * amount;

      // Market settles at new mid price
      const settledPrice = Math.round(newMidPrice * 100) / 100;

      // Build market updates
      // SECURITY: Use local timestamp for price history (displayed in charts)
      const priceHistoryTimestamp = Date.now();
      const marketUpdates = {
        [`prices.${ticker}`]: settledPrice,
        [`volume.${ticker}`]: increment(amount),
        [`priceHistory.${ticker}`]: arrayUnion({ timestamp: priceHistoryTimestamp, price: settledPrice })
      };

      // Apply trailing stock factor effects (recursive with depth limit)
      const applyTrailingEffects = (sourceTicker, sourceOldPrice, sourceNewPrice, depth = 0, visited = new Set()) => {
        console.log(`[TRAILING] depth=${depth}, ticker=${sourceTicker}, oldPrice=${sourceOldPrice}, newPrice=${sourceNewPrice}, visited=${Array.from(visited).join(',')}`);

        if (depth > 3 || visited.has(sourceTicker)) {
          console.log(`[TRAILING] Skipping ${sourceTicker} - depth=${depth}, inVisited=${visited.has(sourceTicker)}`);
          return; // Max 3 levels deep, prevent cycles
        }
        visited.add(sourceTicker);

        const character = CHARACTER_MAP[sourceTicker];
        if (!character?.trailingFactors) {
          console.log(`[TRAILING] ${sourceTicker} has no trailingFactors`);
          return;
        }

        const priceChangePercent = (sourceNewPrice - sourceOldPrice) / sourceOldPrice;
        console.log(`[TRAILING] ${sourceTicker} price changed ${(priceChangePercent * 100).toFixed(2)}%, processing ${character.trailingFactors.length} followers`);

        character.trailingFactors.forEach(({ ticker: relatedTicker, coefficient }) => {
          // Skip if we've already updated this ticker in this batch
          if (visited.has(relatedTicker)) {
            console.log(`[TRAILING] Skipping ${relatedTicker} - already visited`);
            return;
          }

          // Get current price - check marketUpdates first, then fall back to prices
          const oldRelatedPrice = marketUpdates[`prices.${relatedTicker}`] || prices[relatedTicker];
          if (oldRelatedPrice) {
            const trailingChange = priceChangePercent * coefficient;
            const newRelatedPrice = oldRelatedPrice * (1 + trailingChange);
            const settledRelatedPrice = Math.max(MIN_PRICE, Math.round(newRelatedPrice * 100) / 100);

            console.log(`[TRAILING] Updating ${relatedTicker}: $${oldRelatedPrice} -> $${settledRelatedPrice} (${(trailingChange * 100).toFixed(2)}% from ${sourceTicker})`);

            marketUpdates[`prices.${relatedTicker}`] = settledRelatedPrice;
            marketUpdates[`priceHistory.${relatedTicker}`] = arrayUnion({
              timestamp: priceHistoryTimestamp,
              price: settledRelatedPrice
            });

            // Recursively apply trailing effects with shared visited set (no cloning)
            applyTrailingEffects(relatedTicker, oldRelatedPrice, settledRelatedPrice, depth + 1, visited);
          }
        });
      };

      console.log(`[TRAILING START] About to call applyTrailingEffects for ${ticker}: $${price} -> $${settledPrice}`);
      applyTrailingEffects(ticker, price, settledPrice);
      console.log(`[TRAILING END] Finished applyTrailingEffects for ${ticker}`);

      // Atomic price + history update
      await updateDoc(marketRef, marketUpdates);

      // Calculate profit percentage for Bull Run achievement
      const costBasis = userData.costBasis?.[ticker] || 0;
      const profitPercent = costBasis > 0 ? ((sellPrice - costBasis) / costBasis) * 100 : 0;
      
      // Check for Diamond Hands - sold at profit after 30%+ dip
      const lowestWhileHolding = userData.lowestWhileHolding?.[ticker] || costBasis;
      const dipPercent = costBasis > 0 ? ((costBasis - lowestWhileHolding) / costBasis) * 100 : 0;
      const isDiamondHands = dipPercent >= 30 && profitPercent > 0;
      
      // Update cost basis if selling all shares, otherwise keep it
      const newHoldings = currentHoldings - amount;
      const costBasisUpdate = newHoldings <= 0 ? 0 : userData.costBasis?.[ticker] || 0;
      const lowestUpdate = newHoldings <= 0 ? null : userData.lowestWhileHolding?.[ticker];

      // Track daily mission progress
      const today = getTodayDateString();
      const weekId = getWeekId();

      // MARGIN DEBT REPAYMENT: Sale proceeds pay down margin debt first
      const currentMarginUsed = userData.marginUsed || 0;
      let marginPayment = 0;
      let cashGain = totalRevenue;

      if (currentMarginUsed > 0) {
        // Pay down margin debt first
        marginPayment = Math.min(totalRevenue, currentMarginUsed);
        cashGain = totalRevenue - marginPayment;
      }

      // Track actual impact applied for anti-manipulation limits
      const rawImpactPercent = Math.abs(priceImpact / price);
      const newDailyImpact = userDailyImpact + rawImpactPercent;

      // Build update data
      // SECURITY: Use server timestamp for lastTradeTime
      const sellUpdateData = {
        cash: userData.cash + cashGain,
        marginUsed: currentMarginUsed - marginPayment,
        [`holdings.${ticker}`]: newHoldings,
        [`costBasis.${ticker}`]: costBasisUpdate,
        [`lastTickerTradeTime.${ticker}`]: serverTime,
        lastTradeTime: serverTime,
        totalTrades: increment(1),
        // Daily impact tracking (anti-manipulation)
        [`dailyImpact.${todayDate}.${ticker}`]: newDailyImpact,
        // Daily missions
        [`dailyMissions.${today}.tradesCount`]: increment(1),
        [`dailyMissions.${today}.tradeVolume`]: increment(amount),
        [`dailyMissions.${today}.soldAny`]: true,
        // Weekly missions
        [`weeklyMissions.${weekId}.tradeValue`]: increment(totalRevenue),
        [`weeklyMissions.${weekId}.tradeVolume`]: increment(amount),
        [`weeklyMissions.${weekId}.tradeCount`]: increment(1),
        [`weeklyMissions.${weekId}.tradingDays.${today}`]: true
      };
      
      // Clear lowestWhileHolding if selling all shares
      if (newHoldings <= 0) {
        sellUpdateData[`lowestWhileHolding.${ticker}`] = deleteField();
      }

      // Update user with trade count and daily mission progress
      await updateDoc(userRef, sellUpdateData);

      await updateDoc(marketRef, { totalTrades: increment(1) });

      // Record portfolio history (using new cash after margin payment)
      const newCash = userData.cash + cashGain;
      const newMarginUsed = currentMarginUsed - marginPayment;
      const newPortfolioValue = newCash + Object.entries(userData.holdings || {})
        .reduce((sum, [t, shares]) => sum + (prices[t] || 0) * (t === ticker ? shares - amount : shares), 0);
      await recordPortfolioHistory(user.uid, Math.round(newPortfolioValue * 100) / 100);

      // Log transaction for auditing
      await logTransaction(db, user.uid, 'SELL', {
        ticker,
        shares: amount,
        pricePerShare: sellPrice,
        totalRevenue,
        costBasis,
        profitPercent: Math.round(profitPercent * 100) / 100,
        cashBefore: userData.cash,
        cashAfter: newCash,
        marginPaid: marginPayment,
        portfolioAfter: Math.round(newPortfolioValue * 100) / 100
      });

      // SECURITY: Record trade in Cloud Functions for auditing & fraud detection
      recordTradeFunction({
        ticker,
        action: 'SELL',
        amount,
        price: sellPrice,
        totalValue: totalRevenue,
        cashBefore: userData.cash,
        cashAfter: newCash,
        portfolioAfter: Math.round(newPortfolioValue * 100) / 100
      }).catch(err => console.error('[RECORD TRADE ERROR]', err));

      // Check achievements (pass profit percent for Bull Run, isDiamondHands for Diamond Hands)
      const earnedAchievements = await checkAndAwardAchievements(userRef, {
        ...userData,
        cash: newCash,
        marginUsed: newMarginUsed,
        holdings: { ...userData.holdings, [ticker]: newHoldings },
        totalTrades: (userData.totalTrades || 0) + 1
      }, prices, { tradeValue: totalRevenue, sellProfitPercent: profitPercent, isDiamondHands });
      
      const impactPercent = ((newMidPrice - price) / price * 100).toFixed(2);
      
      // Add to activity feed
      const charName = CHARACTERS.find(c => c.ticker === ticker)?.name || ticker;
      const profitText = profitPercent >= 0 ? `+${profitPercent.toFixed(1)}%` : `${profitPercent.toFixed(1)}%`;
      addActivity('trade', `Sold ${amount} $${ticker} (${charName}) @ ${formatCurrency(sellPrice)} (${profitText})`);
      
      if (earnedAchievements.length > 0) {
        const achievement = ACHIEVEMENTS[earnedAchievements[0]];
        addActivity('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked!`);
        showNotification('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked! Sold ${amount} ${ticker}`);
        // Send achievement alert to Discord
        try {
          achievementAlertFunction({
            achievementId: earnedAchievements[0],
            achievementName: achievement.name,
            achievementDescription: achievement.description
          }).catch(() => {}); // Fire and forget
        } catch {}
      } else {
        let message = `Sold ${amount} ${ticker} @ ${formatCurrency(sellPrice)} (${impactPercent}% impact)`;
        if (marginPayment > 0) {
          message += ` • Paid ${formatCurrency(marginPayment)} margin debt`;
        }

        // Warn if approaching daily impact limit
        if (newDailyImpact >= MAX_DAILY_IMPACT_PER_USER) {
          message += ' • Daily impact limit reached for this ticker';
        } else if (newDailyImpact >= MAX_DAILY_IMPACT_PER_USER * 0.8) {
          const remaining = ((MAX_DAILY_IMPACT_PER_USER - newDailyImpact) * 100).toFixed(1);
          message += ` • ${remaining}% impact remaining today`;
        }

        showNotification('success', message);
      }

      // Send trade spike alert if price moved 1%+
      if (Math.abs(parseFloat(impactPercent)) >= 1) {
        try {
          tradeSpikeAlertFunction({
            ticker,
            priceBefore: price,
            priceAfter: settledPrice,
            tradeType: 'SELL',
            shares: amount
          }).catch(() => {}); // Fire and forget
        } catch {}
      }

    } else if (action === 'short') {
      // SHORTING: Borrow shares and sell them, hoping to buy back cheaper
      // Get liquidity for this character
      const liquidity = getCharacterLiquidity(ticker);

      // Get today's date for daily impact tracking
      const todayDate = new Date().toISOString().split('T')[0]; // "2026-01-31"
      const userDailyImpact = userData.dailyImpact?.[todayDate]?.[ticker] || 0;

      // Calculate price impact (shorting = selling pressure, with daily impact limit + velocity multiplier)
      const priceImpact = calculatePriceImpact(price, amount, liquidity, userDailyImpact, priceImpactMultiplier);
      const newMidPrice = Math.max(MIN_PRICE, price - priceImpact);
      
      // Entry price is the bid (you're selling borrowed shares)
      const { bid } = getBidAskPrices(newMidPrice);
      const shortPrice = Math.max(MIN_PRICE, bid);
      const marginRequired = shortPrice * amount * SHORT_MARGIN_REQUIREMENT;

      // Check if user has enough cash OR can use margin
      const cashAvailable = userData.cash || 0;
      const marginEnabled = userData.marginEnabled || false;
      const marginStatus = calculateMarginStatus(userData, prices, priceHistory);
      const availableMargin = marginStatus.availableMargin || 0;

      // Cash-based margin: use all available margin (already capped by cash * tierMultiplier)
      const maxAvailableForShort = cashAvailable + (marginEnabled ? availableMargin : 0);

      if (maxAvailableForShort < marginRequired) {
        showNotification('error', `Need ${formatCurrency(marginRequired)} margin (50% of position). Max available: ${formatCurrency(maxAvailableForShort)}`);
        return;
      }

      // Determine how much to use from cash vs margin
      let cashToUse = Math.min(cashAvailable, marginRequired);
      let marginToUse = marginRequired - cashToUse;
      
      const existingShort = userData.shorts?.[ticker] || { shares: 0, entryPrice: 0, margin: 0 };

      const totalShares = existingShort.shares + amount;
      const avgEntryPrice = existingShort.shares > 0
        ? ((existingShort.entryPrice * existingShort.shares) + (shortPrice * amount)) / totalShares
        : shortPrice;

      // Deduct cash and/or margin used
      const newCash = userData.cash - cashToUse;
      const currentMarginUsed = userData.marginUsed || 0;
      const newMarginUsed = currentMarginUsed + marginToUse;

      if (isNaN(newCash) || isNaN(newMarginUsed)) {
        showNotification('error', 'Calculation error, try again');
        return;
      }

      const settledPrice = Math.round(newMidPrice * 100) / 100;

      // Weekly mission tracking for shorts
      const today = getTodayDateString();
      const weekId = getWeekId();

      // Track actual impact applied for anti-manipulation limits
      const rawImpactPercent = Math.abs(priceImpact / price);
      const newDailyImpact = userDailyImpact + rawImpactPercent;

      // Update shortHistory for rate limiting
      const currentShortHistory = userData.shortHistory?.[ticker] || [];
      const updatedShortHistory = [...currentShortHistory, Date.now()].slice(-2); // Keep last 2 timestamps

      // SECURITY: Use server timestamp
      await updateDoc(userRef, {
        cash: newCash,
        marginUsed: newMarginUsed,
        [`shorts.${ticker}`]: {
          shares: totalShares,
          entryPrice: Math.round(avgEntryPrice * 100) / 100,
          margin: existingShort.margin + marginRequired,
          openedAt: existingShort.openedAt || serverTime
        },
        [`lastTickerTradeTime.${ticker}`]: serverTime,
        lastTradeTime: serverTime,
        totalTrades: increment(1),
        // Daily impact tracking (anti-manipulation)
        [`dailyImpact.${todayDate}.${ticker}`]: newDailyImpact,
        // Short history tracking (anti-manipulation rate limiting)
        [`shortHistory.${ticker}`]: updatedShortHistory,
        // Weekly missions
        [`weeklyMissions.${weekId}.tradeValue`]: increment(amount * shortPrice),
        [`weeklyMissions.${weekId}.tradeVolume`]: increment(amount),
        [`weeklyMissions.${weekId}.tradeCount`]: increment(1),
        [`weeklyMissions.${weekId}.tradingDays.${today}`]: true
      });

      // Atomic price + history update
      const priceHistoryTimestamp = Date.now();
      await updateDoc(marketRef, {
        [`prices.${ticker}`]: settledPrice,
        [`volume.${ticker}`]: increment(amount),
        totalTrades: increment(1),
        [`priceHistory.${ticker}`]: arrayUnion({ timestamp: priceHistoryTimestamp, price: settledPrice })
      });

      // Record portfolio history
      const newPortfolioValue = newCash + Object.entries(userData.holdings || {})
        .reduce((sum, [t, shares]) => sum + (prices[t] || 0) * shares, 0);
      await recordPortfolioHistory(user.uid, Math.round(newPortfolioValue * 100) / 100);

      // Log transaction for auditing
      await logTransaction(db, user.uid, 'SHORT_OPEN', {
        ticker,
        shares: amount,
        entryPrice: shortPrice,
        marginRequired,
        cashUsed: cashToUse,
        marginUsed: marginToUse,
        totalShares,
        avgEntryPrice: Math.round(avgEntryPrice * 100) / 100,
        cashBefore: userData.cash,
        cashAfter: newCash,
        marginUsedAfter: newMarginUsed,
        portfolioAfter: Math.round(newPortfolioValue * 100) / 100
      });

      // SECURITY: Record trade in Cloud Functions for auditing & fraud detection
      recordTradeFunction({
        ticker,
        action: 'SHORT',
        amount,
        price: shortPrice,
        totalValue: marginRequired,
        cashBefore: userData.cash,
        cashAfter: newCash,
        portfolioAfter: Math.round(newPortfolioValue * 100) / 100
      }).catch(err => console.error('[RECORD TRADE ERROR]', err));

      // Check achievements
      const earnedAchievements = await checkAndAwardAchievements(userRef, {
        ...userData,
        cash: newCash,
        marginUsed: newMarginUsed,
        totalTrades: (userData.totalTrades || 0) + 1
      }, prices, { tradeValue: marginRequired });

      const impactPercent = ((newMidPrice - price) / price * 100).toFixed(2);
      
      // Add to activity feed
      const charName = CHARACTERS.find(c => c.ticker === ticker)?.name || ticker;
      addActivity('trade', `🩳 Shorted ${amount} $${ticker} (${charName}) @ ${formatCurrency(shortPrice)}`);
      
      if (earnedAchievements.length > 0) {
        const achievement = ACHIEVEMENTS[earnedAchievements[0]];
        addActivity('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked!`);
        showNotification('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked! Shorted ${amount} ${ticker}`);
        try {
          achievementAlertFunction({
            achievementId: earnedAchievements[0],
            achievementName: achievement.name,
            achievementDescription: achievement.description
          }).catch(() => {});
        } catch {}
      } else {
        let shortMessage = `Shorted ${amount} ${ticker} @ ${formatCurrency(shortPrice)} (${impactPercent}% impact)`;
        if (marginToUse > 0) {
          shortMessage += ` • Used ${formatCurrency(marginToUse)} margin`;
        }

        // Warn if approaching daily impact limit
        if (newDailyImpact >= MAX_DAILY_IMPACT_PER_USER) {
          shortMessage += ' • Daily impact limit reached for this ticker';
        } else if (newDailyImpact >= MAX_DAILY_IMPACT_PER_USER * 0.8) {
          const remaining = ((MAX_DAILY_IMPACT_PER_USER - newDailyImpact) * 100).toFixed(1);
          shortMessage += ` • ${remaining}% impact remaining today`;
        }

        // Warn if this is the 2nd short (cooldown now active)
        const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
        const recentShorts = updatedShortHistory.filter(ts => Date.now() - ts < TWELVE_HOURS_MS);
        if (recentShorts.length === 2) {
          shortMessage += ' • ⚠️ Next short on this ticker will be blocked for 12 hours';
        }

        showNotification('success', shortMessage);
      }

      // Send trade spike alert if price moved 1%+
      if (Math.abs(parseFloat(impactPercent)) >= 1) {
        try {
          tradeSpikeAlertFunction({
            ticker,
            priceBefore: price,
            priceAfter: settledPrice,
            tradeType: 'SHORT',
            shares: amount
          }).catch(() => {});
        } catch {}
      }

    } else if (action === 'cover') {
      // COVER: Buy back shares to close short position
      const existingShort = userData.shorts?.[ticker];
      
      if (!existingShort || existingShort.shares < amount) {
        showNotification('error', 'No short position to cover!');
        return;
      }

      // Holding period check - must hold short for 45 seconds before covering
      const HOLDING_PERIOD_MS = 45 * 1000; // 45 seconds
      const openedAt = existingShort.openedAt || 0;
      const timeSinceOpen = now - openedAt;
      
      if (openedAt > 0 && timeSinceOpen < HOLDING_PERIOD_MS) {
        const remainingMs = HOLDING_PERIOD_MS - timeSinceOpen;
        const remainingMins = Math.ceil(remainingMs / 60000);
        const remainingSecs = Math.ceil((remainingMs % 60000) / 1000);
        const timeStr = remainingMins > 1 ? `${remainingMins} min` : `${remainingSecs} sec`;
        showNotification('error', `Hold period: wait ${timeStr} before covering ${ticker}`);
        return;
      }

      // Get liquidity for this character
      const liquidity = getCharacterLiquidity(ticker);

      // Get today's date for daily impact tracking
      const todayDate = new Date().toISOString().split('T')[0]; // "2026-01-31"
      const userDailyImpact = userData.dailyImpact?.[todayDate]?.[ticker] || 0;

      // Calculate price INCREASE (covering = buying pressure, with daily impact limit + velocity multiplier)
      const priceImpact = calculatePriceImpact(price, amount, liquidity, userDailyImpact, priceImpactMultiplier);
      const newMidPrice = price + priceImpact;
      
      // You pay the ASK price to cover (buying back shares)
      const { ask } = getBidAskPrices(newMidPrice);
      const coverPrice = ask;
      
      // Profit/loss = entry price - cover price (per share)
      const profitPerShare = existingShort.entryPrice - coverPrice;
      const profit = profitPerShare * amount;
      
      // Get back margin + profit (or margin - loss)
      const marginReturned = (existingShort.margin / existingShort.shares) * amount;
      const cashBack = marginReturned + profit;
      
      if (userData.cash + cashBack < 0) {
        showNotification('error', 'Insufficient funds to cover losses!');
        return;
      }

      const remainingShares = existingShort.shares - amount;
      const remainingMargin = existingShort.margin - marginReturned;
      const settledPrice = Math.round(newMidPrice * 100) / 100;

      // Weekly mission tracking for covers
      const today = getTodayDateString();
      const weekId = getWeekId();

      // MARGIN DEBT REPAYMENT: Cover proceeds pay down margin debt first
      const currentMarginUsed = userData.marginUsed || 0;
      let coverMarginPayment = 0;
      let coverCashGain = cashBack;

      if (currentMarginUsed > 0 && cashBack > 0) {
        // Pay down margin debt first (only if cashBack is positive)
        coverMarginPayment = Math.min(cashBack, currentMarginUsed);
        coverCashGain = cashBack - coverMarginPayment;
      }

      // Track actual impact applied for anti-manipulation limits
      const rawImpactPercent = Math.abs(priceImpact / price);
      const newDailyImpact = userDailyImpact + rawImpactPercent;

      // Update user: add cash gain after margin payment
      // SECURITY: Use server timestamp
      const updateData = {
        cash: userData.cash + coverCashGain,
        marginUsed: currentMarginUsed - coverMarginPayment,
        [`lastTickerTradeTime.${ticker}`]: serverTime,
        lastTradeTime: serverTime,
        // Daily impact tracking (anti-manipulation)
        [`dailyImpact.${todayDate}.${ticker}`]: newDailyImpact,
        // Weekly missions
        [`weeklyMissions.${weekId}.tradeValue`]: increment(amount * coverPrice),
        [`weeklyMissions.${weekId}.tradeVolume`]: increment(amount),
        [`weeklyMissions.${weekId}.tradeCount`]: increment(1),
        [`weeklyMissions.${weekId}.tradingDays.${today}`]: true
      };

      if (remainingShares <= 0) {
        updateData[`shorts.${ticker}`] = { shares: 0, entryPrice: 0, margin: 0 };
      } else {
        updateData[`shorts.${ticker}`] = {
          shares: remainingShares,
          entryPrice: existingShort.entryPrice,
          margin: remainingMargin,
          openedAt: existingShort.openedAt
        };
      }

      // Add trade count
      updateData.totalTrades = increment(1);

      await updateDoc(userRef, updateData);

      // Atomic price + history update
      const priceHistoryTimestamp = Date.now();
      await updateDoc(marketRef, {
        [`prices.${ticker}`]: settledPrice,
        [`volume.${ticker}`]: increment(amount),
        totalTrades: increment(1),
        [`priceHistory.${ticker}`]: arrayUnion({ timestamp: priceHistoryTimestamp, price: settledPrice })
      });

      // Record portfolio history (using new cash after margin payment)
      const newCoverCash = userData.cash + coverCashGain;
      const newCoverMarginUsed = currentMarginUsed - coverMarginPayment;
      const newPortfolioValue = newCoverCash + Object.entries(userData.holdings || {})
        .reduce((sum, [t, shares]) => sum + (prices[t] || 0) * shares, 0);
      await recordPortfolioHistory(user.uid, Math.round(newPortfolioValue * 100) / 100);

      // Log transaction for auditing
      await logTransaction(db, user.uid, 'SHORT_CLOSE', {
        ticker,
        shares: amount,
        entryPrice: existingShort.entryPrice,
        coverPrice,
        profitPerShare: Math.round(profitPerShare * 100) / 100,
        totalProfit: Math.round(profit * 100) / 100,
        marginReturned: Math.round(marginReturned * 100) / 100,
        cashBack: Math.round(cashBack * 100) / 100,
        marginPaid: coverMarginPayment,
        cashBefore: userData.cash,
        cashAfter: newCoverCash,
        portfolioAfter: Math.round(newPortfolioValue * 100) / 100
      });

      // SECURITY: Record trade in Cloud Functions for auditing & fraud detection
      recordTradeFunction({
        ticker,
        action: 'COVER',
        amount,
        price: coverPrice,
        totalValue: amount * coverPrice,
        cashBefore: userData.cash,
        cashAfter: newCoverCash,
        portfolioAfter: Math.round(newPortfolioValue * 100) / 100
      }).catch(err => console.error('[RECORD TRADE ERROR]', err));

      // Check achievements (pass short profit for Cold Blooded achievement)
      const earnedAchievements = await checkAndAwardAchievements(userRef, {
        ...userData,
        cash: newCoverCash,
        marginUsed: newCoverMarginUsed,
        totalTrades: (userData.totalTrades || 0) + 1
      }, prices, { shortProfit: profit });

      const impactPercent = ((newMidPrice - price) / price * 100).toFixed(2);
      const profitMsg = profit >= 0 ? `+${formatCurrency(profit)}` : formatCurrency(profit);

      // Add to activity feed
      const charName = CHARACTERS.find(c => c.ticker === ticker)?.name || ticker;
      addActivity('trade', `🩳 Covered ${amount} $${ticker} (${charName}) @ ${formatCurrency(coverPrice)} (${profitMsg})`);

      if (earnedAchievements.length > 0 && earnedAchievements.includes('COLD_BLOODED')) {
        const achievement = ACHIEVEMENTS['COLD_BLOODED'];
        addActivity('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked!`);
        showNotification('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked! ${profitMsg} profit from short!`);
        try {
          achievementAlertFunction({
            achievementId: 'COLD_BLOODED',
            achievementName: achievement.name,
            achievementDescription: achievement.description
          }).catch(() => {});
        } catch {}
      } else if (earnedAchievements.length > 0) {
        const achievement = ACHIEVEMENTS[earnedAchievements[0]];
        addActivity('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked!`);
        showNotification('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked!`);
        try {
          achievementAlertFunction({
            achievementId: earnedAchievements[0],
            achievementName: achievement.name,
            achievementDescription: achievement.description
          }).catch(() => {});
        } catch {}
      } else {
        let coverMessage = `Covered ${amount} ${ticker} @ ${formatCurrency(coverPrice)} (${profitMsg}, +${impactPercent}% impact)`;
        if (coverMarginPayment > 0) {
          coverMessage += ` • Paid ${formatCurrency(coverMarginPayment)} margin debt`;
        }

        // Warn if approaching daily impact limit
        if (newDailyImpact >= MAX_DAILY_IMPACT_PER_USER) {
          coverMessage += ' • Daily impact limit reached for this ticker';
        } else if (newDailyImpact >= MAX_DAILY_IMPACT_PER_USER * 0.8) {
          const remaining = ((MAX_DAILY_IMPACT_PER_USER - newDailyImpact) * 100).toFixed(1);
          coverMessage += ` • ${remaining}% impact remaining today`;
        }

        showNotification(profit >= 0 ? 'success' : 'error', coverMessage);
      }

      // Send trade spike alert if price moved 1%+
      if (Math.abs(parseFloat(impactPercent)) >= 1) {
        try {
          tradeSpikeAlertFunction({
            ticker,
            priceBefore: price,
            priceAfter: settledPrice,
            tradeType: 'COVER',
            shares: amount
          }).catch(() => {});
        } catch {}
      }
    }
  }, [user, userData, prices, recordPriceHistory, recordPortfolioHistory, addActivity]);

  // Update portfolio value and record history periodically
  useEffect(() => {
    if (!user || !userData || Object.keys(prices).length === 0) return;

    const updatePortfolio = async () => {
      // Calculate holdings value
      const holdingsValue = Object.entries(userData.holdings || {})
        .reduce((sum, [ticker, shares]) => sum + (prices[ticker] || 0) * shares, 0);

      // Calculate shorts value (collateral + P&L)
      const shortsValue = Object.entries(userData.shorts || {})
        .reduce((sum, [ticker, position]) => {
          if (!position || position.shares <= 0) return sum;
          const currentPrice = prices[ticker] || position.entryPrice;
          const collateral = position.margin || 0;
          // P&L = (entry price - current price) * shares (profit when price goes down)
          const pnl = (position.entryPrice - currentPrice) * position.shares;
          return sum + collateral + pnl;
        }, 0);

      const portfolioValue = userData.cash + holdingsValue + shortsValue;
      const roundedValue = Math.round(portfolioValue * 100) / 100;
      const userRef = doc(db, 'users', user.uid);

      // Update current portfolio value
      try {
        await updateDoc(userRef, { portfolioValue: roundedValue });
      } catch (error) {
        console.error('[PORTFOLIO UPDATE ERROR]', error);
      }

      // Also record to history periodically (every 10 minutes max)
      const currentHistory = userData.portfolioHistory || [];
      const lastRecord = currentHistory[currentHistory.length - 1];
      const now = Date.now();
      const tenMinutes = 10 * 60 * 1000;

      // Record if: no history yet, OR last record was 10+ minutes ago, OR value changed significantly (>1%)
      const valueChanged = lastRecord && Math.abs(roundedValue - lastRecord.value) / lastRecord.value > 0.01;
      const timeElapsed = !lastRecord || (now - lastRecord.timestamp) > tenMinutes;

      if (!lastRecord || timeElapsed || valueChanged) {
        const updatedHistory = [...currentHistory, { timestamp: now, value: roundedValue }].slice(-500);
        try {
          await updateDoc(userRef, { portfolioHistory: updatedHistory });
        } catch (error) {
          console.error('[PORTFOLIO HISTORY ERROR]', error);
        }
      }

      // Check for bankruptcy (portfolio value <= $100)
      if (roundedValue <= 100 && !userData.isBankrupt && userData.displayName) {
        try {
          await bankruptcyAlertFunction({
            username: userData.displayName,
            finalValue: roundedValue
          });
          // Mark user as bankrupt to avoid duplicate alerts
          await updateDoc(userRef, { isBankrupt: true });
        } catch (discordErr) {
          console.error('Failed to send bankruptcy alert:', discordErr);
        }
      }

      // Check for comeback (recovered 100%+ from a low point in last 30 days)
      if (currentHistory.length > 0 && roundedValue >= 1000) {
        const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
        const recentHistory = currentHistory.filter(h => h.timestamp >= thirtyDaysAgo);

        if (recentHistory.length > 0) {
          const lowestPoint = Math.min(...recentHistory.map(h => h.value));
          const recoveryPercent = ((roundedValue - lowestPoint) / lowestPoint) * 100;

          // If recovered 100%+ and low point was under $500, and haven't sent alert recently
          if (recoveryPercent >= 100 && lowestPoint <= 500 && !userData.comebackAlertSent) {
            try {
              await comebackAlertFunction({
                username: userData.displayName,
                lowPoint: Math.round(lowestPoint * 100) / 100,
                currentValue: roundedValue
              });
              // Mark as sent with timestamp to avoid spam
              await updateDoc(userRef, {
                comebackAlertSent: true,
                lastComebackAlert: now
              });
            } catch (discordErr) {
              console.error('Failed to send comeback alert:', discordErr);
            }
          }
        }
      }
    };

    updatePortfolio();
  }, [user, userData, prices]);

  // Margin monitoring - check for margin calls and auto-liquidation
  useEffect(() => {
    if (!user || !userData || !userData.marginEnabled || !prices || Object.keys(prices).length === 0) return;
    
    const marginUsed = userData.marginUsed || 0;
    if (marginUsed <= 0) return; // No margin debt, nothing to check
    
    const checkMarginStatus = async () => {
      const status = calculateMarginStatus(userData, prices, priceHistory);
      const userRef = doc(db, 'users', user.uid);
      const now = Date.now();
      
      if (status.status === 'liquidation') {
        // AUTO-LIQUIDATION: Sell positions to cover margin debt
        console.log('MARGIN LIQUIDATION TRIGGERED', status);
        
        // Get holdings sorted by value (sell largest first)
        const holdings = userData.holdings || {};
        const sortedHoldings = Object.entries(holdings)
          .filter(([_, shares]) => shares > 0)
          .map(([ticker, shares]) => ({
            ticker,
            shares,
            value: (prices[ticker] || 0) * shares
          }))
          .sort((a, b) => b.value - a.value);
        
        let totalRecovered = 0;
        const updateData = {};

        // Sell ALL positions to cover margin debt
        for (const position of sortedHoldings) {
          const sellValue = position.value * 0.95; // 5% slippage on forced liquidation
          totalRecovered += sellValue;
          updateData[`holdings.${position.ticker}`] = 0;
          updateData[`costBasis.${position.ticker}`] = 0;
        }

        // Calculate final cash position (can go negative if debt > recovered)
        const currentCash = userData.cash || 0;
        const totalAvailable = currentCash + totalRecovered;
        const finalCash = totalAvailable - marginUsed;

        updateData.cash = Math.round(finalCash * 100) / 100;
        updateData.marginUsed = 0; // Debt is now reflected in negative cash
        updateData.marginCallAt = null;
        updateData.lastLiquidation = now;
        updateData.marginEnabled = false; // Disable margin after liquidation

        // If going into debt, mark bankruptcy timestamp
        if (finalCash < 0) {
          updateData.bankruptAt = now;
        }

        await updateDoc(userRef, updateData);

        if (finalCash < 0) {
          showNotification('error', `💀 BANKRUPT: All positions liquidated. You owe ${formatCurrency(Math.abs(finalCash))}`);
        } else {
          showNotification('error', `💀 MARGIN LIQUIDATION: All positions sold. ${formatCurrency(finalCash)} remaining.`);
        }

        // Send liquidation alert to Discord
        try {
          marginLiquidationAlertFunction({
            lossAmount: totalRecovered,
            portfolioBefore: status.portfolioValue,
            portfolioAfter: Math.max(0, finalCash)
          }).catch(() => {});
        } catch {}

      } else if (status.status === 'margin_call' && !userData.marginCallAt) {
        // First margin call - set grace period
        await updateDoc(userRef, { marginCallAt: now });
        
        showNotification('error', `🚨 MARGIN CALL! Deposit funds or sell positions within 24h to avoid liquidation.`);
        
      } else if (status.status === 'margin_call' && userData.marginCallAt) {
        // Check if grace period expired
        const gracePeriodEnd = userData.marginCallAt + MARGIN_CALL_GRACE_PERIOD;
        if (now >= gracePeriodEnd) {
          // Grace period expired - trigger liquidation on next check
          // (The liquidation branch above will handle it)
        }
      } else if (status.status === 'warning') {
        // Just a warning, no action needed but could show notification
      } else if (status.status === 'safe' && userData.marginCallAt) {
        // Recovered from margin call
        await updateDoc(userRef, { marginCallAt: null });
      }
    };
    
    // Check immediately and every 30 seconds
    checkMarginStatus();
    const interval = setInterval(checkMarginStatus, 30000);
    
    return () => clearInterval(interval);
  }, [user, userData?.marginEnabled, userData?.marginUsed, userData?.marginCallAt, prices]);

  // Daily margin interest (charged at midnight or on login)
  useEffect(() => {
    if (!user || !userData || !userData.marginEnabled) return;
    
    const marginUsed = userData.marginUsed || 0;
    if (marginUsed <= 0) return;
    
    const lastInterestCharge = userData.lastMarginInterestCharge || 0;
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    
    // Charge interest if it's been more than 24 hours
    if (now - lastInterestCharge >= oneDayMs) {
      const chargeInterest = async () => {
        const interest = marginUsed * MARGIN_INTEREST_RATE;
        const userRef = doc(db, 'users', user.uid);
        
        await updateDoc(userRef, {
          marginUsed: marginUsed + interest,
          lastMarginInterestCharge: now
        });
        
        console.log(`Margin interest charged: ${formatCurrency(interest)}`);
      };
      
      chargeInterest();
    }
  }, [user, userData?.marginEnabled, userData?.marginUsed, userData?.lastMarginInterestCharge]);

  // Bankruptcy notification system - remind every 5 minutes
  useEffect(() => {
    if (!user || !userData) return;

    const cash = userData.cash || 0;
    if (cash >= 0) return; // Not in debt

    const showBankruptcyReminder = () => {
      const debtAmount = Math.abs(cash);
      showNotification('warning', `💸 You are ${formatCurrency(debtAmount)} in debt. Accept a bailout to reset to $500, but you'll be exiled from your crew forever.`);
    };

    // Show immediately on login/becoming bankrupt
    showBankruptcyReminder();

    // Then every 5 minutes
    const interval = setInterval(showBankruptcyReminder, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [user, userData?.cash]);

  // Check leaderboard position for achievements (runs every 30 seconds)
  useEffect(() => {
    if (!user || !userData) return;
    
    // Make sure userData belongs to the current user (prevent cross-account issues)
    if (userData.oddsSnaps && Object.keys(userData).length < 3) return; // Incomplete data
    
    const checkLeaderboardAchievements = async () => {
      try {
        // Re-verify we have the right user data
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) return;

        const currentUserData = userSnap.data();
        const currentAchievements = currentUserData.achievements || [];
        const currentPortfolioValue = currentUserData.portfolioValue || 0;

        // Skip if already has all leaderboard achievements
        if (currentAchievements.includes('TOP_1')) return;

        // CRITICAL: Require minimum portfolio value to qualify for leaderboard achievements
        // Prevents new accounts or tied low-value accounts from getting achievements
        const MIN_PORTFOLIO_FOR_LEADERBOARD = 5000;
        if (currentPortfolioValue < MIN_PORTFOLIO_FOR_LEADERBOARD) return;

        // Fetch top users to check position (excluding bots)
        const q = query(
          collection(db, 'users'),
          orderBy('portfolioValue', 'desc'),
          limit(20) // Fetch extra to account for bots
        );
        const snapshot = await getDocs(q);
        const topUsers = snapshot.docs
          .filter(doc => !doc.data().isBot && (doc.data().portfolioValue || 0) >= MIN_PORTFOLIO_FOR_LEADERBOARD) // Filter out bots and low-value accounts
          .slice(0, 10) // Get top 10 real users
          .map(doc => doc.id);

        const userPosition = topUsers.indexOf(user.uid);

        if (userPosition === -1) return; // Not in top 10

        const newAchievements = [];
        const rank = userPosition + 1;
        
        // Check for leaderboard achievements
        if (rank <= 10 && !currentAchievements.includes('TOP_10')) {
          newAchievements.push('TOP_10');
        }
        if (rank <= 3 && !currentAchievements.includes('TOP_3')) {
          newAchievements.push('TOP_3');
        }
        if (rank === 1 && !currentAchievements.includes('TOP_1')) {
          newAchievements.push('TOP_1');
        }
        
        if (newAchievements.length > 0) {
          await updateDoc(userRef, {
            achievements: arrayUnion(...newAchievements)
          });
          
          // Show notification for highest achievement earned
          const highestAchievement = newAchievements.includes('TOP_1') ? 'TOP_1' 
            : newAchievements.includes('TOP_3') ? 'TOP_3' : 'TOP_10';
          const achievement = ACHIEVEMENTS[highestAchievement];
          showNotification('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked! You're #${rank} on the leaderboard!`);
        }
      } catch (err) {
        console.error('Failed to check leaderboard achievements:', err);
      }
    };
    
    // Check immediately and then every 30 seconds
    checkLeaderboardAchievements();
    const interval = setInterval(checkLeaderboardAchievements, 30000);
    
    return () => clearInterval(interval);
  }, [user, userData?.achievements]);

  // Daily checkin
  const handleDailyCheckin = useCallback(async () => {
    if (!user || !userData) {
      showNotification('info', 'Sign in to claim your daily bonus!');
      return;
    }

    const today = new Date().toDateString();
    const lastCheckinStr = toDateString(userData.lastCheckin);
    if (lastCheckinStr === today) {
      showNotification('error', 'Already checked in today!');
      return;
    }

    const userRef = doc(db, 'users', user.uid);
    const newTotalCheckins = (userData.totalCheckins || 0) + 1;

    // Check for check-in achievements
    const newAchievements = [];
    const currentAchievements = userData.achievements || [];

    if (newTotalCheckins >= 7 && !currentAchievements.includes('DEDICATED_7')) {
      newAchievements.push('DEDICATED_7');
    }
    if (newTotalCheckins >= 14 && !currentAchievements.includes('DEDICATED_14')) {
      newAchievements.push('DEDICATED_14');
    }
    if (newTotalCheckins >= 30 && !currentAchievements.includes('DEDICATED_30')) {
      newAchievements.push('DEDICATED_30');
    }
    if (newTotalCheckins >= 100 && !currentAchievements.includes('DEDICATED_100')) {
      newAchievements.push('DEDICATED_100');
    }

    // Weekly check-in tracking
    const weekId = getWeekId();

    const updateData = {
      cash: userData.cash + DAILY_BONUS,
      lastCheckin: today,
      totalCheckins: newTotalCheckins,
      [`dailyMissions.${getTodayDateString()}.checkedIn`]: true,
      // Weekly missions - track check-in days
      [`weeklyMissions.${weekId}.checkinDays.${today}`]: true
    };

    if (newAchievements.length > 0) {
      updateData.achievements = arrayUnion(...newAchievements);
    }

    // Check ladder game balance and top up to $100 if needed (only for existing players)
    let ladderTopUp = 0;
    try {
      const ladderRef = doc(db, 'ladderGameUsers', user.uid);
      const ladderDoc = await getDoc(ladderRef);

      // Only top up if they've played before and are below $100
      if (ladderDoc.exists()) {
        const currentLadderBalance = ladderDoc.data().balance || 0;
        if (currentLadderBalance < 100) {
          ladderTopUp = 100 - currentLadderBalance;
          await updateDoc(ladderRef, { balance: 100 });
        }
      }
      // If they've never played, let LadderGame component create their account with $500
    } catch (error) {
      console.error('[LADDER TOP-UP ERROR]', error);
      // Don't fail the entire check-in if ladder top-up fails
    }

    try {
      await updateDoc(userRef, updateData);
    } catch (error) {
      console.error('[CHECKIN ERROR]', error);
      showNotification('error', 'Failed to check in. Please try again.');
      return;
    }

    // Log transaction for auditing
    await logTransaction(db, user.uid, 'CHECKIN', {
      bonus: DAILY_BONUS,
      totalCheckins: newTotalCheckins,
      cashBefore: userData.cash,
      cashAfter: userData.cash + DAILY_BONUS,
      ladderTopUp
    });

    // Add to activity feed
    let activityMsg = `Daily check-in: +${formatCurrency(DAILY_BONUS)}!`;
    if (ladderTopUp > 0) {
      activityMsg += ` | Ladder Game: +${formatCurrency(ladderTopUp)} (topped to $100)`;
    }
    addActivity('checkin', `${activityMsg} (Day ${newTotalCheckins})`);

    // Show achievement notification if earned
    if (newAchievements.length > 0) {
      const achievement = ACHIEVEMENTS[newAchievements[0]];
      addActivity('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked!`);
      showNotification('achievement', `🏆 Achievement Unlocked: ${achievement.emoji} ${achievement.name}!`);
    } else {
      let notificationMsg = `Daily check-in: +${formatCurrency(DAILY_BONUS)}!`;
      if (ladderTopUp > 0) {
        notificationMsg += ` | Ladder Game topped to $100!`;
      }
      showNotification('success', notificationMsg);
    }
  }, [user, userData, addActivity]);

  // Handle IPO purchase
  const handleBuyIPO = useCallback(async (ticker, quantity) => {
    if (!user || !userData) {
      showNotification('info', 'Sign in to participate in IPO!');
      return;
    }

    const ipoRef = doc(db, 'market', 'ipos');
    const ipoSnap = await getDoc(ipoRef);
    if (!ipoSnap.exists()) {
      showNotification('error', 'IPO not found');
      return;
    }

    const ipoData = ipoSnap.data();
    const ipo = ipoData.list?.find(i => i.ticker === ticker);
    
    if (!ipo) {
      showNotification('error', 'IPO not found');
      return;
    }

    const now = Date.now();
    if (now < ipo.ipoStartsAt) {
      showNotification('error', 'IPO has not started yet!');
      return;
    }
    
    if (now >= ipo.ipoEndsAt) {
      showNotification('error', 'IPO has ended!');
      return;
    }

    const sharesRemaining = ipo.sharesRemaining ?? IPO_TOTAL_SHARES;
    if (sharesRemaining <= 0) {
      showNotification('error', 'IPO sold out!');
      return;
    }

    const userIPOPurchases = userData.ipoPurchases?.[ticker] || 0;
    if (userIPOPurchases + quantity > IPO_MAX_PER_USER) {
      showNotification('error', `Max ${IPO_MAX_PER_USER} shares per person!`);
      return;
    }

    if (quantity > sharesRemaining) {
      showNotification('error', `Only ${sharesRemaining} shares left!`);
      return;
    }

    const totalCost = ipo.basePrice * quantity;
    if (userData.cash < totalCost) {
      showNotification('error', 'Insufficient funds!');
      return;
    }

    try {
      const userRef = doc(db, 'users', user.uid);
      const marketRef = doc(db, 'market', 'current');
      
      // Update user's holdings, cash, and IPO purchases
      const currentHoldings = userData.holdings?.[ticker] || 0;
      const currentCostBasis = userData.costBasis?.[ticker] || ipo.basePrice;
      const newHoldings = currentHoldings + quantity;
      const newCostBasis = ((currentCostBasis * currentHoldings) + (ipo.basePrice * quantity)) / newHoldings;
      
      await updateDoc(userRef, {
        cash: userData.cash - totalCost,
        [`holdings.${ticker}`]: newHoldings,
        [`costBasis.${ticker}`]: Math.round(newCostBasis * 100) / 100,
        [`ipoPurchases.${ticker}`]: userIPOPurchases + quantity,
        [`lastBuyTime.${ticker}`]: now,
        totalTrades: (userData.totalTrades || 0) + 1
      });
      
      // Update IPO shares remaining
      const updatedList = ipoData.list.map(i => 
        i.ticker === ticker ? { ...i, sharesRemaining: sharesRemaining - quantity } : i
      );
      await updateDoc(ipoRef, { list: updatedList });
      
      // Initialize price if not set (first IPO purchase sets the price)
      const marketSnap = await getDoc(marketRef);
      const marketPrices = marketSnap.data()?.prices || {};
      if (!marketPrices[ticker]) {
        await updateDoc(marketRef, {
          [`prices.${ticker}`]: ipo.basePrice,
          [`priceHistory.${ticker}`]: [{ timestamp: now, price: ipo.basePrice }]
        });
      }
      
      const character = CHARACTER_MAP[ticker];
      
      // Add to activity feed
      addActivity('trade', `🚀 IPO: Bought ${quantity} $${ticker} (${character?.name || ticker}) @ ${formatCurrency(ipo.basePrice)}`);
      
      showNotification('success', `🚀 IPO: Bought ${quantity} ${character?.name || ticker} shares @ ${formatCurrency(ipo.basePrice)}!`);
      
    } catch (err) {
      console.error('IPO purchase failed:', err);
      showNotification('error', 'IPO purchase failed!');
    }
  }, [user, userData, addActivity]);

  // Handle prediction bet
  const handleBet = useCallback(async (predictionId, option, amount) => {
    if (!user || !userData) {
      showNotification('info', 'Sign in to place bets!');
      return;
    }

    if (userData.cash < amount) {
      showNotification('error', 'Insufficient funds!');
      return;
    }

    // Calculate total $ user has spent buying/shorting stocks
    // costBasis tracks the actual money spent on each stock
    const totalSpentOnStocks = Object.entries(userData.holdings || {}).reduce((sum, [ticker, shares]) => {
      const costBasis = userData.costBasis?.[ticker] || 0;
      return sum + (costBasis * shares);
    }, 0);

    // Also count margin used for shorts
    const totalShortMargin = Object.values(userData.shorts || {}).filter(short => short).reduce((sum, short) => {
      return sum + (short.margin || 0);
    }, 0);

    // Bet limit = total spent on market (buys + short margin)
    const totalInvested = totalSpentOnStocks + totalShortMargin;
    
    // If user has never invested, they can't bet
    if (totalInvested <= 0) {
      showNotification('error', 'You must invest in the market before placing bets!');
      return;
    }
    
    // Bet limit is capped by both investment and available cash
    const betLimit = Math.min(totalInvested, userData.cash);
    
    // Check if this bet exceeds the limit
    if (amount > betLimit) {
      if (totalInvested > userData.cash) {
        showNotification('error', `Insufficient funds! You have ${formatCurrency(userData.cash)}`);
      } else {
        showNotification('error', `Bet limit: ${formatCurrency(totalInvested)} (total you've invested in stocks)`);
      }
      return;
    }

    const prediction = predictions.find(p => p.id === predictionId);
    if (!prediction || prediction.resolved || prediction.endsAt < Date.now()) {
      showNotification('error', 'Betting has ended!');
      return;
    }

    // Check if user already bet on a different option
    const existingBet = userData.bets?.[predictionId];
    if (existingBet && existingBet.option !== option) {
      showNotification('error', `You already bet on "${existingBet.option}"!`);
      return;
    }

    try {
      const predictionsRef = doc(db, 'predictions', 'current');
      const userRef = doc(db, 'users', user.uid);

      // Update prediction pools
      const updatedPredictions = predictions.map(p => {
        if (p.id === predictionId) {
          const newPools = { ...(p.pools || {}) };
          newPools[option] = (newPools[option] || 0) + amount;
          return { ...p, pools: newPools };
        }
        return p;
      });

      const newBetAmount = (existingBet?.amount || 0) + amount;

      await updateDoc(predictionsRef, { list: updatedPredictions });
      await updateDoc(userRef, {
        cash: userData.cash - amount,
        [`bets.${predictionId}`]: {
          option,
          amount: newBetAmount,
          placedAt: Date.now(),
          question: prediction.question // Store question for history
        },
        [`dailyMissions.${getTodayDateString()}.placedBet`]: true
      });

      // Log transaction for auditing
      await logTransaction(db, user.uid, 'BET', {
        predictionId,
        option,
        amount,
        totalBetAmount: newBetAmount,
        question: prediction.question,
        cashBefore: userData.cash,
        cashAfter: userData.cash - amount
      });

      // Add to activity feed
      addActivity('bet', `🔮 Bet ${formatCurrency(amount)} on "${option}"`);

      showNotification('success', `Bet ${formatCurrency(amount)} on "${option}"!`);
    } catch (error) {
      console.error('Bet placement failed:', error);
      showNotification('error', `Bet failed: ${error.message}`);
    }
  }, [user, userData, predictions, addActivity]);

  // Hide prediction from feed (admin only)
  const handleHidePrediction = useCallback(async (predictionId) => {
    if (!user || !ADMIN_UIDS.includes(user.uid)) return;

    try {
      const predictionsRef = doc(db, 'predictions', 'current');
      const snap = await getDoc(predictionsRef);
      if (snap.exists()) {
        const data = snap.data();
        const updatedList = (data.list || []).map(p =>
          p.id === predictionId ? { ...p, hidden: true } : p
        );
        await updateDoc(predictionsRef, { list: updatedList });
        showNotification('success', 'Prediction hidden from feed');
      }
    } catch (err) {
      console.error('Failed to hide prediction:', err);
      showNotification('error', 'Failed to hide prediction');
    }
  }, [user]);

  // Logout
  const handleLogout = () => signOut(auth);

  // Delete account
  const handleDeleteAccount = useCallback(async (confirmUsername) => {
    if (!user) return;

    try {
      // Call Cloud Function to delete account
      await deleteAccountFunction({ confirmUsername });
      showNotification('success', 'Account deleted successfully');
    } catch (err) {
      console.error('Failed to delete account:', err);
      const errorMessage = err?.message || 'Failed to delete account. Please try again.';
      showNotification('error', errorMessage);
      throw err;
    }
  }, [user, showNotification]);

  // Enable margin trading
  const handleEnableMargin = useCallback(async () => {
    if (!user || !userData) return;
    
    const isAdmin = ADMIN_UIDS.includes(user.uid);
    const eligibility = checkMarginEligibility(userData, isAdmin);
    if (!eligibility.eligible) {
      showNotification('error', 'Not eligible for margin trading!');
      return;
    }
    
    const userRef = doc(db, 'users', user.uid);
    await updateDoc(userRef, {
      marginEnabled: true,
      marginUsed: 0,
      marginEnabledAt: Date.now()
    });
    
    showNotification('success', '📊 Margin trading enabled! You now have extra buying power.');
  }, [user, userData]);

  // Disable margin trading
  const handleDisableMargin = useCallback(async () => {
    if (!user || !userData) return;
    
    if ((userData.marginUsed || 0) >= 0.01) {
      showNotification('error', 'Repay all margin debt before disabling!');
      return;
    }
    
    const userRef = doc(db, 'users', user.uid);
    await updateDoc(userRef, {
      marginEnabled: false,
      marginUsed: 0
    });
    
    showNotification('success', 'Margin trading disabled.');
    setShowLending(false);
  }, [user, userData]);

  // Repay margin
  const handleRepayMargin = useCallback(async (amount) => {
    if (!user || !userData) return;
    
    const marginUsed = userData.marginUsed || 0;
    if (marginUsed <= 0) {
      showNotification('error', 'No margin debt to repay!');
      return;
    }
    
    if (amount > userData.cash) {
      showNotification('error', 'Insufficient funds!');
      return;
    }
    
    const repayAmount = Math.min(amount, marginUsed);
    const newMarginUsed = marginUsed - repayAmount;
    const userRef = doc(db, 'users', user.uid);
    
    await updateDoc(userRef, {
      cash: userData.cash - repayAmount,
      // Ensure exactly 0 if fully repaid (avoid floating point issues)
      marginUsed: newMarginUsed < 0.01 ? 0 : Math.round(newMarginUsed * 100) / 100,
      marginCallAt: null // Clear margin call if repaying
    });
    
    if (repayAmount >= marginUsed) {
      showNotification('success', `Margin fully repaid! Paid ${formatCurrency(repayAmount)}`);
    } else {
      showNotification('success', `Repaid ${formatCurrency(repayAmount)}. Remaining debt: ${formatCurrency(newMarginUsed)}`);
    }
  }, [user, userData]);

  // Bankruptcy bailout - reset to $500 but exile from all past crews
  const handleBailout = useCallback(async () => {
    if (!user || !userData) return;

    const cash = userData.cash || 0;
    if (cash >= 0) {
      showNotification('error', 'You are not in debt.');
      return;
    }

    try {
      const userRef = doc(db, 'users', user.uid);
      const currentCrew = userData.crew;
      const crewHistory = userData.crewHistory || [];

      // Add current crew to history if not already there (will be exiled)
      const updatedHistory = currentCrew && !crewHistory.includes(currentCrew)
        ? [...crewHistory, currentCrew]
        : crewHistory;

      await updateDoc(userRef, {
        cash: 500,
        holdings: {},
        shorts: {},
        costBasis: {},
        portfolioValue: 500,
        marginEnabled: false,
        marginUsed: 0,
        bankruptAt: null,
        crew: null,
        crewJoinedAt: null,
        isCrewHead: false,
        crewHeadColor: null,
        crewHistory: updatedHistory,
        lastBailout: Date.now()
      });

      if (currentCrew) {
        const crewName = CREW_MAP[currentCrew]?.name || 'your crew';
        showNotification('warning', `Bailout accepted. You've been exiled from ${crewName} and all previous crews. Starting fresh with $500.`);
      } else {
        showNotification('success', 'Bailout accepted. Starting fresh with $500.');
      }
    } catch (err) {
      console.error('Bailout failed:', err);
      showNotification('error', 'Bailout failed. Please try again.');
    }
  }, [user, userData]);

  // Guest data
  const guestData = { cash: STARTING_CASH, holdings: {}, shorts: {}, bets: {}, portfolioValue: STARTING_CASH };
  const activeUserData = userData || guestData;
  const isGuest = !user;

  // Get user's bet for a prediction
  const getUserBet = (predictionId) => activeUserData.bets?.[predictionId] || null;

  // Portfolio calculations
  const holdingsValue = Object.entries(activeUserData.holdings || {})
    .reduce((sum, [ticker, shares]) => sum + (prices[ticker] || 0) * shares, 0);
  
  const shortsValue = Object.entries(activeUserData.shorts || {})
    .reduce((sum, [ticker, position]) => {
      if (!position || position.shares <= 0) return sum;
      const currentPrice = prices[ticker] || position.entryPrice;
      const collateral = position.margin || 0;
      // P&L = (entry price - current price) * shares (profit when price goes down)
      const pnl = (position.entryPrice - currentPrice) * position.shares;
      return sum + collateral + pnl;
    }, 0);
  
  const portfolioValue = activeUserData.cash + holdingsValue + shortsValue;

  // Helper to calculate 24h price change
  const get24hChange = useCallback((ticker) => {
    const currentPrice = prices[ticker] || CHARACTER_MAP[ticker]?.basePrice || 0;
    const history = priceHistory[ticker] || [];
    const dayAgo = Date.now() - (24 * 60 * 60 * 1000);
    
    if (history.length === 0) return 0;
    
    // Find price from ~24 hours ago, or use oldest available
    let price24hAgo = history[0].price; // Default to oldest point
    
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].timestamp <= dayAgo) {
        price24hAgo = history[i].price;
        break;
      }
    }
    
    return price24hAgo > 0 ? ((currentPrice - price24hAgo) / price24hAgo) * 100 : 0;
  }, [prices, priceHistory]);

  // Get list of tickers currently in IPO (hype or active phase) - these shouldn't be tradeable
  const ipoRestrictedTickers = useMemo(() => {
    const now = Date.now();
    return activeIPOs
      .filter(ipo => !ipo.priceJumped && now < ipo.ipoEndsAt) // In hype or buying phase
      .map(ipo => ipo.ticker);
  }, [activeIPOs]);

  // Filter and sort
  const filteredCharacters = useMemo(() => {
    let filtered = CHARACTERS.filter(c => {
      // Search filter
      const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.ticker.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchesSearch) return false;

      // Hide characters that require IPO and haven't launched yet
      if (c.ipoRequired) {
        // Check if this character has been launched (added to launchedTickers)
        if (!launchedTickers.includes(c.ticker)) {
          return false; // IPO required but not launched - hide from trading
        }
      }

      // Also hide characters currently in IPO phase (shouldn't happen with above, but safety check)
      if (ipoRestrictedTickers.includes(c.ticker)) return false;

      return true;
    });

    // Calculate 24h price changes from actual history
    const priceChanges = {};
    CHARACTERS.forEach(c => {
      priceChanges[c.ticker] = get24hChange(c.ticker);
    });
    
    // Calculate trade activity (number of price history entries) for "active" sort
    const getTradeActivity = (ticker) => {
      const history = priceHistory[ticker] || [];
      const now = Date.now();
      const weekAgo = now - (7 * 24 * 60 * 60 * 1000);
      const dayAgo = now - (24 * 60 * 60 * 1000);
      
      // Count entries in the last week and last day
      let weekTrades = 0;
      let dayTrades = 0;
      
      for (const entry of history) {
        if (entry.timestamp >= weekAgo) {
          weekTrades++;
          if (entry.timestamp >= dayAgo) {
            dayTrades++;
          }
        }
      }
      
      return { weekTrades, dayTrades };
    };

    switch (sortBy) {
      case 'price-high': filtered.sort((a, b) => getCurrentPrice(b.ticker, priceHistory, prices) - getCurrentPrice(a.ticker, priceHistory, prices)); break;
      case 'price-low': filtered.sort((a, b) => getCurrentPrice(a.ticker, priceHistory, prices) - getCurrentPrice(b.ticker, priceHistory, prices)); break;
      case 'change-high':
        // Top gainers - highest positive % change first
        filtered.sort((a, b) => (priceChanges[b.ticker] || 0) - (priceChanges[a.ticker] || 0));
        break;
      case 'change-low':
        // Top losers - lowest (most negative) % change first
        filtered.sort((a, b) => (priceChanges[a.ticker] || 0) - (priceChanges[b.ticker] || 0));
        break;
      case 'active':
        filtered.sort((a, b) => {
          const activityA = getTradeActivity(a.ticker);
          const activityB = getTradeActivity(b.ticker);

          // Primary: most trades today (last 24h)
          if (activityB.dayTrades !== activityA.dayTrades) {
            return activityB.dayTrades - activityA.dayTrades;
          }
          // Secondary: most trades in last week
          if (activityB.weekTrades !== activityA.weekTrades) {
            return activityB.weekTrades - activityA.weekTrades;
          }
          // Tertiary: alphabetical by ticker
          return a.ticker.localeCompare(b.ticker);
        });
        break;
      case 'ticker': filtered.sort((a, b) => a.ticker.localeCompare(b.ticker)); break;
      case 'newest': filtered.sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded)); break;
      case 'oldest': filtered.sort((a, b) => new Date(a.dateAdded) - new Date(b.dateAdded)); break;
    }
    return filtered;
  }, [searchQuery, sortBy, prices, priceHistory, get24hChange, activeIPOs, ipoRestrictedTickers]);

  const totalPages = Math.ceil(filteredCharacters.length / ITEMS_PER_PAGE);
  const displayedCharacters = showAll ? filteredCharacters : filteredCharacters.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  // Styling - Orange/Yellow theme inspired by logo
  const bgClass = darkMode ? 'bg-zinc-950' : 'bg-amber-50';
  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-zinc-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';
  const inputClassStyle = darkMode ? 'bg-zinc-950 border-zinc-700 text-zinc-100' : 'bg-white border-amber-300 text-zinc-900';

  if (loading) {
    return (
      <div className={`min-h-screen ${bgClass} flex items-center justify-center`}>
        <div className={`text-lg ${mutedClass}`}>Loading Stockism...</div>
      </div>
    );
  }

  // Create context value for AppProvider
  const contextValue = {
    darkMode,
    user,
    userData,
    prices,
    priceHistory,
    predictions,
    holdings: userData?.holdings || {},
    shorts: userData?.shorts || {},
    costBasis: userData?.costBasis || {},
    marketData,
    getColorBlindColors,
    showNotification,
    activeIPOs,
    ipoRestrictedTickers,
    launchedTickers
  };

  return (
    <AppProvider value={contextValue}>
      <Layout
        darkMode={darkMode}
        setDarkMode={handleToggleDarkMode}
        user={user}
        userData={userData}
        onShowAdminPanel={() => setShowAdmin(true)}
          isGuest={isGuest}
          onShowLogin={() => setShowLoginModal(true)}
        >
          <Routes>
            <Route path="/" element={
              <div className={`min-h-screen ${bgClass} p-4`}>
                <div className="max-w-6xl mx-auto">
                  {/* Sub-header buttons */}
                  <div className="flex flex-wrap gap-2 mb-4 justify-center">
                    <button
                      onClick={() => setShowDailyMissions(true)}
                      className={`px-3 py-1.5 text-sm font-medium rounded-sm border transition-colors ${
                        darkMode
                          ? 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800'
                          : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      📋 Missions
                    </button>
                    {user && !isGuest && (
                      <button
                        onClick={() => setShowPinShop(true)}
                        className={`px-3 py-1.5 text-sm font-medium rounded-sm border transition-colors ${
                          darkMode
                            ? 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800'
                            : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        📌 Pins
                      </button>
                    )}
                    {(!userData?.crew || isGuest) && (
                      <button
                        onClick={() => setShowCrewSelection(true)}
                        className={`px-3 py-1.5 text-sm font-medium rounded-sm border transition-colors ${
                          darkMode
                            ? 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800'
                            : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        👥 Crews
                      </button>
                    )}
                    {user && !isGuest && (
                      <button
                        onClick={() => setShowLending(true)}
                        className={`px-3 py-1.5 text-sm font-medium rounded-sm border transition-colors ${
                          darkMode
                            ? 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800'
                            : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        💰 Margin
                      </button>
                    )}
                    <button
                      onClick={() => setShowAbout(true)}
                      className={`px-3 py-1.5 text-sm font-medium rounded-sm border transition-colors ${
                        darkMode
                          ? 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800'
                          : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      ℹ️ About
                    </button>
                  </div>

                  {/* Guest Banner */}
                  {isGuest && (
                    <div className={`mb-4 p-3 rounded-sm text-sm ${darkMode ? 'bg-zinc-900 border border-zinc-800 text-zinc-300' : 'bg-amber-50 border border-amber-200 text-amber-800'}`}>
                      👋 Browsing as guest. <button onClick={() => setShowLoginModal(true)} className="font-semibold text-orange-600 hover:underline">Sign in</button> to trade and save progress!
                    </div>
                  )}

                  {/* IPO Announcements */}
        {activeIPOs.length > 0 && (
          <div className="mb-4">
            <h2 className={`text-sm font-semibold uppercase tracking-wide mb-3 ${mutedClass}`}>🚀 IPO</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {activeIPOs.map(ipo => {
                const now = Date.now();
                const inHypePhase = now < ipo.ipoStartsAt;
                
                return inHypePhase ? (
                  <IPOHypeCard key={ipo.ticker} ipo={ipo} darkMode={darkMode} />
                ) : (
                  <IPOActiveCard 
                    key={ipo.ticker} 
                    ipo={ipo} 
                    userData={userData}
                    onBuyIPO={handleBuyIPO}
                    darkMode={darkMode}
                    isGuest={isGuest}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Weekly Predictions & New Characters */}
        <div className="mb-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Predictions - takes 2 columns */}
          {predictions.length > 0 && (
            <div className="lg:col-span-2">
              <button
                onClick={() => setShowPredictions(!showPredictions)}
                className={`w-full flex items-center justify-between px-4 py-3 mb-3 rounded-sm transition-all ${
                  darkMode
                    ? 'bg-zinc-900/50 hover:bg-zinc-800/70 border border-zinc-800'
                    : 'bg-amber-50 hover:bg-amber-100 border border-amber-200'
                }`}
              >
                <span className={`text-sm font-semibold uppercase tracking-wide ${mutedClass}`}>
                  🔮 Weekly Predictions
                </span>
                <svg
                  className={`w-5 h-5 transition-transform ${showPredictions ? 'rotate-180' : ''} ${mutedClass}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showPredictions && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fadeIn">
                  {predictions.filter(p => !p.hidden && (!p.resolved || Date.now() - p.endsAt < 7 * 24 * 60 * 60 * 1000)).map(prediction => {
                    // Calculate bet limit = total $ spent on stocks, capped by cash
                    const totalSpentOnStocks = Object.entries(userData?.holdings || {}).reduce((sum, [ticker, shares]) => {
                      const costBasis = userData?.costBasis?.[ticker] || 0;
                      return sum + (costBasis * shares);
                    }, 0);
                    const totalShortMargin = Object.values(userData?.shorts || {}).filter(short => short).reduce((sum, short) => sum + (short.margin || 0), 0);
                    const totalInvested = totalSpentOnStocks + totalShortMargin;
                    const betLimit = Math.min(totalInvested, userData?.cash || 0);

                    return (
                      <PredictionCard
                        key={prediction.id}
                        prediction={prediction}
                        userBet={getUserBet(prediction.id)}
                        onBet={handleBet}
                        onRequestBet={(predictionId, option, amount, question) => setBetConfirmation({ predictionId, option, amount, question })}
                        darkMode={darkMode}
                        isGuest={isGuest}
                        betLimit={betLimit}
                        isAdmin={user && ADMIN_UIDS.includes(user.uid)}
                        onHide={handleHidePrediction}
                        userData={userData}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* New Characters Board - takes 1 column */}
          <div className={predictions.length === 0 ? 'lg:col-span-3' : ''}>
            <button
              onClick={() => setShowNewCharacters(!showNewCharacters)}
              className={`w-full flex items-center justify-between px-4 py-3 mb-3 rounded-sm transition-all ${
                darkMode
                  ? 'bg-zinc-900/50 hover:bg-zinc-800/70 border border-zinc-800'
                  : 'bg-amber-50 hover:bg-amber-100 border border-amber-200'
              }`}
            >
              <span className={`text-sm font-semibold uppercase tracking-wide ${mutedClass}`}>
                ✨ New This Week
              </span>
              <svg
                className={`w-5 h-5 transition-transform ${showNewCharacters ? 'rotate-180' : ''} ${mutedClass}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showNewCharacters && (
              <div className="animate-fadeIn">
                <NewCharactersBoard
                  prices={prices}
                  priceHistory={priceHistory}
                  darkMode={darkMode}
                  colorBlindMode={userData?.colorBlindMode || false}
                  launchedTickers={launchedTickers}
                />
              </div>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div className={`${cardClass} border rounded-sm p-4 ${(activeUserData.cash || 0) < 0 ? (userData?.colorBlindMode ? 'border-purple-500' : 'border-red-500') : ''}`}>
            <p className={`text-xs font-semibold uppercase ${mutedClass}`}>Cash</p>
            <p className={`text-2xl font-bold ${(activeUserData.cash || 0) < 0 ? (userData?.colorBlindMode ? 'text-purple-500' : 'text-red-500') : textClass}`}>
              {(activeUserData.cash || 0) < 0 ? '-' : ''}{formatCurrency(Math.abs(activeUserData.cash || 0))}
            </p>
            {(activeUserData.cash || 0) < 0 && (
              <button
                onClick={() => setShowBailout(true)}
                className={`mt-2 w-full py-1.5 text-xs font-semibold rounded-sm text-white ${userData?.colorBlindMode ? 'bg-purple-600 hover:bg-purple-700' : 'bg-red-600 hover:bg-red-700'}`}
              >
                💸 In Debt - Request Bailout
              </button>
            )}
            {(activeUserData.cash || 0) >= 0 && activeUserData.marginEnabled && (() => {
              const marginStatus = calculateMarginStatus(activeUserData, prices, priceHistory);
              return (
                <div className="text-xs mt-1 space-y-0.5">
                  <div className={mutedClass}>
                    Tier: <span className="text-amber-500 font-semibold">{marginStatus.tierName}</span>
                  </div>
                  <div className={mutedClass}>
                    Available: <span className="text-amber-500 font-semibold">{formatCurrency(marginStatus.availableMargin)}</span>
                    <span className={mutedClass}> (of {formatCurrency(marginStatus.maxBorrowable)} max)</span>
                  </div>
                  {activeUserData.marginUsed > 0 && (
                    <div className="text-orange-500">
                      Used: {formatCurrency(activeUserData.marginUsed)} debt • 0.5% daily
                    </div>
                  )}
                </div>
              );
            })()}
            <CheckInButton
              isGuest={isGuest}
              lastCheckin={userData?.lastCheckin}
              onCheckin={handleDailyCheckin}
              darkMode={darkMode}
            />
          </div>
          <div className={`${cardClass} border rounded-sm p-4 cursor-pointer hover:border-orange-600`} onClick={() => !isGuest && setShowPortfolio(true)}>
            <p className={`text-xs font-semibold uppercase ${mutedClass}`}>Portfolio Value</p>
            <p className={`text-2xl font-bold ${textClass}`}>{formatCurrency(portfolioValue)}</p>
            {(() => {
              const now = Date.now();
              const oneDayAgo = now - (24 * 60 * 60 * 1000);
              const portfolioHistory = activeUserData.portfolioHistory || [];

              // Find portfolio value closest to 24h ago
              let value24hAgo = null;
              if (portfolioHistory.length > 0) {
                // Find the closest record to 24h ago
                const closest = portfolioHistory.reduce((prev, curr) => {
                  return Math.abs(curr.timestamp - oneDayAgo) < Math.abs(prev.timestamp - oneDayAgo) ? curr : prev;
                });
                // Only use if it's within 26 hours (to account for gaps in data)
                if (Math.abs(closest.timestamp - oneDayAgo) < 26 * 60 * 60 * 1000) {
                  value24hAgo = closest.value;
                }
              }

              const change24h = value24hAgo ? portfolioValue - value24hAgo : 0;
              const changePercent24h = value24hAgo && value24hAgo > 0 ? ((change24h / value24hAgo) * 100) : 0;

              const colors24h = getColorBlindColors(change24h >= 0);

              return (
                <>
                  {value24hAgo && (
                    <p className={`text-xs ${colors24h.text}`}>
                      {change24h >= 0 ? '▲' : '▼'} {formatCurrency(Math.abs(change24h))} ({formatChange(changePercent24h)}) 24h
                    </p>
                  )}
                  <p className={`text-xs ${mutedClass}`}>
                    {portfolioValue >= STARTING_CASH ? '▲' : '▼'} {((portfolioValue - STARTING_CASH) / STARTING_CASH * 100).toFixed(2)}% from start
                    {!isGuest && <span className="text-orange-600 ml-2">→ View chart</span>}
                  </p>
                </>
              );
            })()}
          </div>
          <div className={`${cardClass} border rounded-sm p-4`}>
            <div className="flex justify-between items-start mb-2">
              <p className={`text-xs font-semibold uppercase ${mutedClass}`}>Holdings</p>
              {!isGuest && (
                <button
                  onClick={() => setShowPortfolio(true)}
                  className="text-xs text-orange-600 hover:text-orange-500"
                >
                  View All →
                </button>
              )}
            </div>
            {(() => {
              const holdings = activeUserData.holdings || {};
              const costBasis = activeUserData.costBasis || {};
              const holdingsArray = Object.entries(holdings)
                .filter(([_, shares]) => shares > 0)
                .map(([ticker, shares]) => {
                  const character = CHARACTER_MAP[ticker];
                  const currentPrice = prices[ticker] || character?.basePrice || 0;
                  const avgCost = costBasis[ticker] || character?.basePrice || currentPrice;
                  const value = currentPrice * shares;
                  const totalCost = avgCost * shares;
                  const unrealizedPL = value - totalCost;
                  return { ticker, shares, value, unrealizedPL, character };
                })
                .sort((a, b) => b.value - a.value);

              const totalUnrealizedPL = holdingsArray.reduce((sum, h) => sum + h.unrealizedPL, 0);
              const topHoldings = holdingsArray.slice(0, 3);

              if (holdingsArray.length === 0) {
                return (
                  <p className={`text-sm ${mutedClass}`}>No holdings yet</p>
                );
              }

              return (
                <div className="space-y-2">
                  {topHoldings.map(h => {
                    const plColors = getColorBlindColors(h.unrealizedPL >= 0);
                    return (
                      <div key={h.ticker} className="flex justify-between items-center text-xs">
                        <span className={textClass}>${h.ticker} × {h.shares}</span>
                        <span className={plColors.text}>
                          {h.unrealizedPL >= 0 ? '+' : ''}{formatCurrency(h.unrealizedPL)}
                        </span>
                      </div>
                    );
                  })}
                  <div className={`pt-2 border-t ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
                    <div className="flex justify-between items-center text-xs">
                      <span className={mutedClass}>Total Unrealized P/L:</span>
                      <span className={`font-bold ${getColorBlindColors(totalUnrealizedPL >= 0).text}`}>
                        {totalUnrealizedPL >= 0 ? '+' : ''}{formatCurrency(totalUnrealizedPL)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-xs mt-1">
                      <span className={mutedClass}>{holdingsArray.length} position{holdingsArray.length !== 1 ? 's' : ''}</span>
                      <span className={mutedClass}>{Object.values(holdings).reduce((a, b) => a + b, 0)} total shares</span>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Controls */}
        <div className={`${cardClass} border rounded-sm p-4 mb-4`}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <select value={sortBy} onChange={(e) => { setSortBy(e.target.value); setCurrentPage(1); }}
              className={`px-3 py-2 text-sm rounded-sm border ${inputClassStyle}`}>
              <option value="price-high">Price: High</option>
              <option value="price-low">Price: Low</option>
              <option value="change-high">Top Gainers</option>
              <option value="change-low">Top Losers</option>
              <option value="active">Most Active</option>
              <option value="ticker">Ticker A-Z</option>
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
            </select>
            <input type="text" placeholder="Search..." value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              className={`px-3 py-2 text-sm rounded-sm border ${inputClassStyle}`} />
            <div className="flex items-center justify-center gap-2">
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={showAll || currentPage === 1}
                className={`px-3 py-2 text-sm rounded-sm border ${darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 hover:bg-amber-50'} disabled:opacity-50`}>
                Prev
              </button>
              <span className={`text-sm ${mutedClass}`}>{currentPage}/{totalPages}</span>
              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={showAll || currentPage === totalPages}
                className={`px-3 py-2 text-sm rounded-sm border ${darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 hover:bg-amber-50'} disabled:opacity-50`}>
                Next
              </button>
            </div>
            <button onClick={() => setShowAll(!showAll)}
              className={`px-3 py-2 text-sm font-semibold rounded-sm ${showAll ? 'bg-amber-500 text-white' : `border ${darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 hover:bg-amber-50'}`}`}>
              {showAll ? 'Show Pages' : 'Show All'}
            </button>
          </div>
        </div>

        {/* Character Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayedCharacters.map(character => (
            <CharacterCard
              key={character.ticker}
              character={character}
              price={(() => {
                // Use priceHistory as source of truth, fall back to prices object
                const history = priceHistory[character.ticker];
                if (history && history.length > 0) {
                  return history[history.length - 1].price;
                }
                return prices[character.ticker] || character.basePrice;
              })()}
              priceChange={get24hChange(character.ticker)}
              sentiment={getSentiment(character.ticker)}
              holdings={activeUserData.holdings?.[character.ticker] || 0}
              shortPosition={activeUserData.shorts?.[character.ticker]}
              onTrade={requestTrade}
              onViewChart={handleViewChart}
              priceHistory={priceHistory}
              darkMode={darkMode}
              userCash={activeUserData.cash || 0}
              userData={activeUserData}
              prices={prices}
              user={user}
              limitOrderRequest={limitOrderRequest}
              onClearLimitOrderRequest={() => setLimitOrderRequest(null)}
            />
          ))}
        </div>

        {/* Bottom Pagination */}
        {!showAll && totalPages > 1 && (
          <div className={`${cardClass} border rounded-sm p-4 mt-4`}>
            <div className="flex justify-center items-center gap-4">
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                className={`px-4 py-2 text-sm font-semibold rounded-sm border ${darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 hover:bg-amber-50'} disabled:opacity-50`}>
                Previous
              </button>
              <span className={`text-sm ${mutedClass}`}>Page {currentPage} of {totalPages}</span>
              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
                className={`px-4 py-2 text-sm font-semibold rounded-sm border ${darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 hover:bg-amber-50'} disabled:opacity-50`}>
                Next
              </button>
            </div>
          </div>
        )}
                </div>
              </div>
            } />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="/achievements" element={<AchievementsPage />} />
            <Route path="/ladder" element={<LadderPage />} />
            <Route path="/profile" element={<ProfilePage onOpenCrewSelection={() => setShowCrewSelection(true)} onDeleteAccount={handleDeleteAccount} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>

          {/* Global Modals - rendered outside Routes */}
          {showLoginModal && <LoginModal onClose={() => setShowLoginModal(false)} darkMode={darkMode} />}
          {needsEmailVerification && user && <EmailVerificationModal user={user} darkMode={darkMode} userData={userData} />}
          {needsUsername && user && (
            <UsernameModal
              user={user}
              onComplete={async () => {
                setNeedsUsername(false);
                // Refresh user data
                const userDocRef = doc(db, 'users', user.uid);
                const userSnap = await getDoc(userDocRef);
                if (userSnap.exists()) {
                  setUserData(userSnap.data());
                  // Subscribe to changes
                  onSnapshot(userDocRef, (snap) => {
                    if (snap.exists()) setUserData(snap.data());
                  });
                }
              }}
              darkMode={darkMode}
            />
          )}
          {showAbout && <AboutModal onClose={() => setShowAbout(false)} darkMode={darkMode} userData={userData} />}
          {showLending && !isGuest && (
            <MarginModal
              onClose={() => setShowLending(false)}
              darkMode={darkMode}
              userData={userData}
              prices={prices}
              priceHistory={priceHistory}
              onEnableMargin={handleEnableMargin}
              onDisableMargin={handleDisableMargin}
              onRepayMargin={handleRepayMargin}
              isAdmin={user && ADMIN_UIDS.includes(user.uid)}
            />
          )}
          {showCrewSelection && (
        <CrewSelectionModal
          onClose={() => setShowCrewSelection(false)}
          onSelect={handleCrewSelect}
          onLeave={handleCrewLeave}
          darkMode={darkMode}
          userData={userData}
          isGuest={isGuest}
        />
      )}
      {showPinShop && !isGuest && (
        <PinShopModal
          onClose={() => setShowPinShop(false)}
          darkMode={darkMode}
          userData={userData}
          onPurchase={handlePinAction}
        />
      )}
      {showDailyMissions && (
        <DailyMissionsModal
          onClose={() => setShowDailyMissions(false)}
          darkMode={darkMode}
          userData={userData}
          prices={prices}
          onClaimReward={handleClaimMissionReward}
          onClaimWeeklyReward={handleClaimWeeklyMissionReward}
          portfolioValue={portfolioValue}
          isGuest={isGuest}
        />
      )}
      {showBailout && !isGuest && (userData?.cash || 0) < 0 && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={() => setShowBailout(false)}>
          <div
            className={`w-full max-w-md ${darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200'} border rounded-sm shadow-xl p-6`}
            onClick={e => e.stopPropagation()}
          >
            <div className="text-center mb-4">
              <div className="text-4xl mb-2">💸</div>
              <h2 className={`text-xl font-bold ${darkMode ? 'text-zinc-100' : 'text-slate-900'}`}>Bankruptcy Bailout</h2>
            </div>

            <div className={`p-4 rounded-sm mb-4 ${userData?.colorBlindMode ? (darkMode ? 'bg-purple-900/30 border border-purple-700' : 'bg-purple-50 border border-purple-200') : (darkMode ? 'bg-red-900/30 border border-red-700' : 'bg-red-50 border border-red-200')}`}>
              <p className={`text-center font-semibold ${userData?.colorBlindMode ? (darkMode ? 'text-purple-400' : 'text-purple-600') : (darkMode ? 'text-red-400' : 'text-red-600')}`}>
                You are {formatCurrency(Math.abs(userData?.cash || 0))} in debt
              </p>
            </div>

            <div className={`text-sm ${darkMode ? 'text-zinc-300' : 'text-slate-600'} mb-4 space-y-2`}>
              <p>Accept a bailout to clear your debt and restart with <strong className={userData?.colorBlindMode ? 'text-teal-500' : 'text-green-500'}>$500</strong>.</p>
              <p className="text-amber-500 font-semibold">⚠️ Consequences:</p>
              <ul className="list-disc ml-5 space-y-1">
                <li>You will be <strong>permanently exiled</strong> from your current crew</li>
                <li>You can <strong>never rejoin</strong> any crew you've been part of</li>
                <li>All holdings and shorts will be cleared</li>
              </ul>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowBailout(false)}
                className={`flex-1 py-2 rounded-sm border ${darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 hover:bg-amber-50'}`}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  await handleBailout();
                  setShowBailout(false);
                }}
                className={`flex-1 py-2 rounded-sm text-white font-semibold ${userData?.colorBlindMode ? 'bg-teal-600 hover:bg-teal-700' : 'bg-green-600 hover:bg-green-700'}`}
              >
                Accept Bailout
              </button>
            </div>
          </div>
        </div>
      )}
      {showAdmin && (
        <AdminPanel
          user={user}
          predictions={predictions}
          prices={prices}
          darkMode={darkMode}
          onClose={() => setShowAdmin(false)}
        />
      )}
      
      {/* Activity Feed */}
      {!isGuest && (
        <ActivityFeed
          activities={activityFeed}
          isOpen={showActivityFeed}
          onToggle={() => setShowActivityFeed(prev => !prev)}
          darkMode={darkMode}
        />
      )}
      
      {/* Toast Notifications */}
      <ToastContainer
        notifications={notifications}
        onDismiss={dismissNotification}
        darkMode={darkMode}
      />
      
      {showPortfolio && !isGuest && (
        <PortfolioModal
          holdings={activeUserData.holdings || {}}
          shorts={activeUserData.shorts || {}}
          prices={prices}
          portfolioHistory={userData?.portfolioHistory || []}
          currentValue={portfolioValue}
          onClose={() => setShowPortfolio(false)}
          onTrade={requestTrade}
          onLimitSell={handleLimitOrderRequest}
          darkMode={darkMode}
          costBasis={userData?.costBasis || {}}
          priceHistory={priceHistory}
          colorBlindMode={userData?.colorBlindMode || false}
          user={user}
        />
      )}
      {selectedCharacter && (
        <ChartModal
          character={selectedCharacter.character || selectedCharacter}
          currentPrice={prices[(selectedCharacter.character || selectedCharacter).ticker] || (selectedCharacter.character || selectedCharacter).basePrice}
          priceHistory={priceHistory}
          onClose={() => setSelectedCharacter(null)}
          darkMode={darkMode}
          defaultTimeRange={selectedCharacter.defaultTimeRange || '1d'}
          colorBlindMode={userData?.colorBlindMode || false}
        />
      )}

      {/* Trade Confirmation Modal */}
      {tradeConfirmation && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[60]" onClick={() => setTradeConfirmation(null)}>
          <div 
            className={`w-full max-w-sm ${darkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-amber-200'} border rounded-sm shadow-xl p-5`}
            onClick={e => e.stopPropagation()}
          >
            <h3 className={`text-lg font-semibold mb-4 ${darkMode ? 'text-zinc-100' : 'text-slate-900'}`}>
              Confirm {tradeConfirmation.action === 'buy' ? 'Purchase' : tradeConfirmation.action === 'sell' ? 'Sale' : 'Short'}
            </h3>
            <div className={`space-y-2 mb-5 ${darkMode ? 'text-zinc-300' : 'text-slate-700'}`}>
              <div className="flex justify-between">
                <span>Stock:</span>
                <span className="font-semibold text-orange-500">${tradeConfirmation.ticker}</span>
              </div>
              <div className="flex justify-between">
                <span>Action:</span>
                <span className={`font-semibold ${tradeConfirmation.action === 'buy' ? 'text-green-500' : 'text-red-500'}`}>
                  {tradeConfirmation.action.toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Shares:</span>
                <span className="font-semibold">{tradeConfirmation.amount}</span>
              </div>
              <div className="flex justify-between">
                <span>Est. Price/Share:</span>
                <span className="font-semibold">{formatCurrency(tradeConfirmation.total / tradeConfirmation.amount)}</span>
              </div>
              <div className={`flex justify-between pt-2 border-t ${darkMode ? 'border-zinc-700' : 'border-amber-200'}`}>
                <span className="font-semibold">Est. Total:</span>
                <span className={`font-bold ${tradeConfirmation.action === 'buy' ? 'text-red-500' : 'text-green-500'}`}>
                  {tradeConfirmation.action === 'buy' ? '-' : '+'}{formatCurrency(tradeConfirmation.total)}
                </span>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setTradeConfirmation(null)}
                className={`flex-1 py-2 rounded-sm font-semibold ${darkMode ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  handleTrade(tradeConfirmation.ticker, tradeConfirmation.action, tradeConfirmation.amount);
                  setTradeConfirmation(null);
                }}
                className={`flex-1 py-2 rounded-sm font-semibold text-white ${
                  tradeConfirmation.action === 'buy' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                Confirm {tradeConfirmation.action === 'buy' ? 'Buy' : 'Sell'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bet Confirmation Modal */}
      {betConfirmation && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[60]" onClick={() => setBetConfirmation(null)}>
          <div 
            className={`w-full max-w-sm ${darkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-amber-200'} border rounded-sm shadow-xl p-5`}
            onClick={e => e.stopPropagation()}
          >
            <h3 className={`text-lg font-semibold mb-4 ${darkMode ? 'text-zinc-100' : 'text-slate-900'}`}>
              Confirm Bet
            </h3>
            <div className={`space-y-2 mb-5 ${darkMode ? 'text-zinc-300' : 'text-slate-700'}`}>
              <div className="mb-3">
                <span className={`text-sm ${darkMode ? 'text-zinc-400' : 'text-slate-500'}`}>Question:</span>
                <p className={`font-medium ${darkMode ? 'text-zinc-100' : 'text-slate-900'}`}>{betConfirmation.question}</p>
              </div>
              <div className="flex justify-between">
                <span>Your Pick:</span>
                <span className="font-semibold text-orange-500">"{betConfirmation.option}"</span>
              </div>
              <div className={`flex justify-between pt-2 border-t ${darkMode ? 'border-zinc-700' : 'border-amber-200'}`}>
                <span className="font-semibold">Bet Amount:</span>
                <span className="font-bold text-red-500">-{formatCurrency(betConfirmation.amount)}</span>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setBetConfirmation(null)}
                className={`flex-1 py-2 rounded-sm font-semibold ${darkMode ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  handleBet(betConfirmation.predictionId, betConfirmation.option, betConfirmation.amount);
                  setBetConfirmation(null);
                }}
                className="flex-1 py-2 rounded-sm font-semibold text-white bg-orange-600 hover:bg-orange-700"
              >
                Place Bet
              </button>
            </div>
          </div>
        </div>
      )}

      </Layout>
    </AppProvider>
  );
}
