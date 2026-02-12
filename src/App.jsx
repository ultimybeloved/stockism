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
  serverTimestamp,
  arrayUnion,
  runTransaction,
  addDoc
} from 'firebase/firestore';
import { auth, googleProvider, twitterProvider, db, createUserFunction, deleteAccountFunction, validateTradeFunction, executeTradeFunction, recordTradeFunction, tradeSpikeAlertFunction, achievementAlertFunction, leaderboardChangeAlertFunction, marginLiquidationAlertFunction, ipoClosingAlertFunction, bankruptcyAlertFunction, comebackAlertFunction, getLeaderboardFunction, dailyCheckinFunction, claimMissionRewardFunction, purchasePinFunction, placeBetFunction, claimPredictionPayoutFunction, buyIPOSharesFunction, repayMarginFunction, bailoutFunction, leaveCrewFunction, switchCrewFunction, toggleMarginFunction, chargeMarginInterestFunction, syncPortfolioFunction } from './firebase';
import { CHARACTERS, CHARACTER_MAP } from './characters';
import { CREWS, CREW_MAP, SHOP_PINS, DAILY_MISSIONS, WEEKLY_MISSIONS, PIN_SLOT_COSTS, CREW_DIVIDEND_RATE, getWeekId, getCrewWeeklyMissions } from './crews';
import AdminPanel from './AdminPanel';
import { containsProfanity, getProfanityMessage } from './utils/profanity';
import { isWeeklyHalt } from './utils/marketHours';
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
  MAX_DAILY_IMPACT_PER_USER,
  NEW_ACCOUNT_IMPACT_PERIOD_DAYS,
  NEW_ACCOUNT_MIN_IMPACT_FACTOR
} from './constants';
import { ACHIEVEMENTS } from './constants/achievements';
import {
  formatCurrency,
  formatChange,
  formatNumber,
  formatTimeRemaining,
  round2
} from './utils/formatters';
import { getTodayDateString, isToday, toMillis, toDateString, toUTCDateString } from './utils/date';

// Transaction logging - records all significant financial actions for auditing

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
// Calls syncPortfolio Cloud Function which handles achievements, portfolio value, and peak updates server-side
const checkAndAwardAchievements = async () => {
  // Context-based achievements (SHARK, BULL_RUN, DIAMOND_HANDS, COLD_BLOODED) are now
  // awarded server-side in executeTrade. This just triggers a portfolio sync for
  // threshold-based achievements (FIRST_BLOOD, BROKE_5K, etc.)
  try {
    const result = await syncPortfolioFunction();
    return result.data?.newAchievements || [];
  } catch (error) {
    console.error('[ACHIEVEMENT CHECK ERROR]', error);
    return [];
  }
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
  const impactPercent = currentPrice > 0 ? impact / currentPrice : 0;
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

// Calculate reduced price impact for new accounts (anti-manipulation)
const getAccountAgeImpactFactor = (userData) => {
  if (!userData?.createdAt) return 1;
  const createdMs = typeof userData.createdAt?.toMillis === 'function'
    ? userData.createdAt.toMillis()
    : typeof userData.createdAt === 'number' ? userData.createdAt : Date.parse(userData.createdAt);
  if (!createdMs || isNaN(createdMs)) return 1;
  const ageDays = (Date.now() - createdMs) / (1000 * 60 * 60 * 24);
  if (ageDays >= NEW_ACCOUNT_IMPACT_PERIOD_DAYS) return 1;
  return NEW_ACCOUNT_MIN_IMPACT_FACTOR + (1 - NEW_ACCOUNT_MIN_IMPACT_FACTOR) * (ageDays / NEW_ACCOUNT_IMPACT_PERIOD_DAYS);
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
    
    return startPrice > 0 ? ((currentPrice - startPrice) / startPrice) * 100 : 0;
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
                <span className={`text-sm font-bold ${textClass}`}>${(price || 0).toFixed(2)}</span>
                <span className={`text-xs ml-1 ${colorBlindMode ? (change >= 0 ? 'text-teal-500' : 'text-purple-500') : (change >= 0 ? 'text-green-500' : 'text-red-500')}`}>
                  {change >= 0 ? '▲' : '▼'}{Math.abs(change || 0).toFixed(1)}%
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
    const myShare = newMyPool > 0 ? amount / newMyPool : 0;
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
            <div className={`text-xs mt-1 ${userBet.option === prediction.outcome ? (userData?.colorBlindMode ? 'text-teal-500' : 'text-green-500') : (userData?.colorBlindMode ? 'text-purple-500' : 'text-red-500')}`}>
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
  const [actionLoading, setActionLoading] = useState({});
  const setLoadingKey = useCallback((key, value) => {
    setActionLoading(prev => ({ ...prev, [key]: value }));
  }, []);
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
  const [showInAppBanner, setShowInAppBanner] = useState(() => {
    const ua = navigator.userAgent || '';
    return /FBAN|FBAV|Instagram|Discord|Twitter|Snapchat|TikTok|Line|WeChat|MicroMessenger|Pinterest/i.test(ua);
  });

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
    if (!user || !ADMIN_UIDS.includes(user.uid)) return;

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

        // IPO price jumps now handled server-side by processIPOPriceJumps scheduled function
      }
    });

    return () => unsubscribe();
  }, []);

  // Track lowest prices while holding for Diamond Hands achievement
  // lowestWhileHolding tracking now handled server-side in syncPortfolio

  // Weekly mission startPortfolioValue now initialized server-side in syncPortfolio

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
          const result = await claimPredictionPayoutFunction({ predictionId: prediction.id });
          const { won, payout } = result.data;

          if (won) {
            console.log(`[Payout] Processed winning bet for prediction ${prediction.id}: +${payout}`);
            showNotification('success', `🎉 Prediction payout: +${formatCurrency(payout)}!`);
          } else {
            console.log(`[Payout] Processed losing bet for prediction ${prediction.id}`);
          }
        } catch (error) {
          console.error(`[Payout] Failed to process payout for prediction ${prediction.id}:`, error);
        }
      }
    };

    processPayouts();
  }, [user, userData, predictions]);

  // Short margin calls are now handled server-side by checkShortMarginCalls Cloud Function
  // (runs every 5 minutes, uses admin SDK to bypass security rules)

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


  // recordPortfolioHistory removed — now handled server-side by syncPortfolio Cloud Function

  // Handle crew selection (uses Cloud Function for switching to apply 15% penalty server-side)
  const handleCrewSelect = useCallback(async (crewId, isSwitch) => {
    if (!user || !userData) return;

    try {
      if (isSwitch && userData.crew) {
        // Switching crews — penalty handled server-side
        const result = await switchCrewFunction({ crewId, isSwitch: true });
        const { totalTaken } = result.data;
        setUserData(prev => prev ? { ...prev, crew: crewId, cash: (prev.cash || 0) - totalTaken, crewSwitchCooldown: Date.now() } : prev);
        const crew = CREW_MAP[crewId];
        showNotification('success', `Switched to ${crew.name}! Lost ${formatCurrency(totalTaken)} (15% penalty)`);
      } else {
        // First time joining — no penalty, use Cloud Function
        const result = await switchCrewFunction({ crewId, isSwitch: false });
        setUserData(prev => prev ? { ...prev, crew: crewId } : prev);
        const crew = CREW_MAP[crewId];
        showNotification('success', `Welcome to ${crew.name}! ${crew.emblem}`);
      }
    } catch (err) {
      console.error('Failed to select crew:', err);
      const message = err?.message || err?.details || 'Failed to join crew';
      showNotification('error', message);
    }
  }, [user, userData]);

  // Handle leaving crew
  const handleCrewLeave = useCallback(async () => {
    if (!user || !userData || !userData.crew) return;

    if ((userData.cash || 0) < 0) {
      showNotification('error', 'You cannot leave your crew while in debt.');
      return;
    }

    setLoadingKey('leaveCrew', true);
    try {
      const oldCrew = CREW_MAP[userData.crew];
      const result = await leaveCrewFunction({});
      const totalTaken = result.data.totalTaken;

      setUserData(prev => prev ? { ...prev, crew: null, cash: (prev.cash || 0) - totalTaken, crewSwitchCooldown: Date.now() } : prev);
      showNotification('warning', `Left ${oldCrew?.name || 'crew'}. Lost ${formatCurrency(totalTaken)} (15% penalty). You cannot join a new crew for 24 hours.`);
    } catch (err) {
      console.error('Failed to leave crew:', err);
      showNotification('error', 'Failed to leave crew');
    } finally {
      setLoadingKey('leaveCrew', false);
    }
  }, [user, userData]);

  // Handle pin shop purchases and updates
  const handlePinAction = useCallback(async (action, payload, cost) => {
    if (!user || !userData) return;

    if (action === 'buyPin' || action === 'buySlot') setLoadingKey('pinAction', true);
    try {
      const userRef = doc(db, 'users', user.uid);

      if (action === 'buyPin') {
        const currentOwned = userData.ownedShopPins || [];
        if (currentOwned.includes(payload)) return;

        await purchasePinFunction({ action: 'buyPin', pinId: payload });

        setUserData(prev => prev ? { ...prev, ownedShopPins: [...(prev.ownedShopPins || []), payload], cash: (prev.cash || 0) - (cost || 0) } : prev);
        const pin = SHOP_PINS[payload];
        showNotification('success', `Purchased ${pin.name}!`, `/pins/${pin.image}`);

      } else if (action === 'setShopPins') {
        await updateDoc(userRef, { displayedShopPins: payload });

      } else if (action === 'setAchievementPins') {
        await updateDoc(userRef, { displayedAchievementPins: payload });

      } else if (action === 'toggleCrewPin') {
        if (!userData.isCrewHead) {
          await updateDoc(userRef, { displayCrewPin: payload });
        }

      } else if (action === 'buySlot') {
        await purchasePinFunction({ action: 'buySlot', slotType: payload });
        const slotKey = payload === 'shop' ? 'shopPinSlots' : 'achievementPinSlots';
        setUserData(prev => prev ? { ...prev, [slotKey]: (prev[slotKey] || 3) + 1, cash: (prev.cash || 0) - (cost || 0) } : prev);
        showNotification('success', `Unlocked extra ${payload} pin slot!`);
      }
    } catch (err) {
      console.error('Pin action failed:', err);
      showNotification('error', 'Action failed');
    } finally {
      setLoadingKey('pinAction', false);
    }
  }, [user, userData]);

  // Handle claiming daily mission rewards
  const handleClaimMissionReward = useCallback(async (missionId, reward) => {
    if (!user || !userData) return;

    setLoadingKey('claimMission', true);
    try {
      const result = await claimMissionRewardFunction({ missionId, type: 'daily', reward });

      // Optimistic update so button disappears immediately
      const today = getTodayDateString();
      setUserData(prev => prev ? ({
        ...prev,
        cash: (prev.cash || 0) + reward,
        dailyMissions: {
          ...prev.dailyMissions,
          [today]: {
            ...(prev.dailyMissions?.[today] || {}),
            claimed: { ...(prev.dailyMissions?.[today]?.claimed || {}), [missionId]: true }
          }
        }
      }) : prev);

      addActivity('mission', `📋 Mission complete! +${formatCurrency(reward)}`);

      const newTotal = result.data.newTotal;
      const achievements = userData.achievements || [];
      let earnedAchievement = null;
      if (newTotal >= 100 && !achievements.includes('MISSION_100')) earnedAchievement = ACHIEVEMENTS.MISSION_100;
      else if (newTotal >= 50 && !achievements.includes('MISSION_50')) earnedAchievement = ACHIEVEMENTS.MISSION_50;
      else if (newTotal >= 10 && !achievements.includes('MISSION_10')) earnedAchievement = ACHIEVEMENTS.MISSION_10;

      if (earnedAchievement) {
        addActivity('achievement', `🏆 ${earnedAchievement.emoji} ${earnedAchievement.name} unlocked!`);
        showNotification('achievement', `🏆 ${earnedAchievement.emoji} ${earnedAchievement.name} unlocked!`);
      } else {
        showNotification('success', `Claimed ${formatCurrency(reward)} mission reward!`);
      }
    } catch (err) {
      console.error('Failed to claim reward:', err);
      showNotification('error', err.message || 'Failed to claim reward');
    } finally {
      setLoadingKey('claimMission', false);
    }
  }, [user, userData, addActivity, showNotification]);

  // Handle claiming weekly mission rewards
  const handleClaimWeeklyMissionReward = useCallback(async (missionId, reward) => {
    if (!user || !userData) return;

    setLoadingKey('claimWeeklyMission', true);
    try {
      const result = await claimMissionRewardFunction({ missionId, type: 'weekly', reward });

      // Optimistic update so claim button disappears immediately
      const weekId = getWeekId();
      setUserData(prev => prev ? {
        ...prev,
        cash: (prev.cash || 0) + reward,
        weeklyMissions: { ...prev.weeklyMissions, [weekId]: { ...(prev.weeklyMissions?.[weekId] || {}), claimed: { ...(prev.weeklyMissions?.[weekId]?.claimed || {}), [missionId]: true } } }
      } : prev);

      addActivity('mission', `📋 Weekly mission complete! +${formatCurrency(reward)}`);

      const newTotal = result.data.newTotal;
      const achievements = userData.achievements || [];
      let earnedAchievement = null;
      if (newTotal >= 100 && !achievements.includes('MISSION_100')) earnedAchievement = ACHIEVEMENTS.MISSION_100;
      else if (newTotal >= 50 && !achievements.includes('MISSION_50')) earnedAchievement = ACHIEVEMENTS.MISSION_50;
      else if (newTotal >= 10 && !achievements.includes('MISSION_10')) earnedAchievement = ACHIEVEMENTS.MISSION_10;

      if (earnedAchievement) {
        addActivity('achievement', `🏆 ${earnedAchievement.emoji} ${earnedAchievement.name} unlocked!`);
        showNotification('achievement', `🏆 ${earnedAchievement.emoji} ${earnedAchievement.name} unlocked!`);
      } else {
        showNotification('success', `Claimed ${formatCurrency(reward)} weekly mission reward!`);
      }
    } catch (err) {
      console.error('Failed to claim weekly reward:', err);
      showNotification('error', err.message || 'Failed to claim reward');
    } finally {
      setLoadingKey('claimWeeklyMission', false);
    }
  }, [user, userData, addActivity, showNotification]);

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
    
    // Calculate estimated total (with new-account impact reduction)
    const ageFactor = getAccountAgeImpactFactor(userData);
    let total = price * amount;
    if (action === 'buy') {
      const priceImpact = calculatePriceImpact(price, amount, getCharacterLiquidity(ticker)) * ageFactor;
      const { ask } = getBidAskPrices(price + priceImpact);
      total = ask * amount;
    } else if (action === 'sell') {
      const priceImpact = calculatePriceImpact(price, amount, getCharacterLiquidity(ticker)) * ageFactor;
      const { bid } = getBidAskPrices(Math.max(MIN_PRICE, price - priceImpact));
      total = bid * amount;
    } else if (action === 'short') {
      const priceImpact = calculatePriceImpact(price, amount, getCharacterLiquidity(ticker)) * ageFactor;
      const { bid } = getBidAskPrices(Math.max(MIN_PRICE, price - priceImpact));
      total = bid * amount * 0.5; // margin cost only
    } else if (action === 'cover') {
      const priceImpact = calculatePriceImpact(price, amount, getCharacterLiquidity(ticker)) * ageFactor;
      const { ask } = getBidAskPrices(price + priceImpact);
      const shortPos = userData.shorts?.[ticker];
      if (shortPos?.system === 'v2') {
        const costBasis = shortPos.costBasis || 0;
        const totalMargin = shortPos.margin || 0;
        const marginBack = shortPos.shares > 0 ? (totalMargin / shortPos.shares) * amount : 0;
        const profit = (costBasis - ask) * amount;
        total = marginBack + profit;
      } else {
        total = ask * amount;
      }
    }
    
    setTradeConfirmation({ ticker, action, amount, price, total, name: asset?.name });
  }, [user, userData, prices, activeIPOs, launchedTickers, showNotification]);

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

    // Block trades during weekly halt or emergency halt
    if (isWeeklyHalt() || marketData?.marketHalted) {
      showNotification('error', marketData?.marketHalted
        ? `Market closed: ${marketData.haltReason || 'Emergency halt in progress'}`
        : 'Market closed for chapter review. Trading resumes at 21:00 UTC.');
      return;
    }

    // Block buying/shorting if user is in debt (selling/covering allowed)
    if ((userData.cash || 0) < 0 && (action === 'buy' || action === 'short')) {
      showNotification('error', 'You cannot open new positions while in debt. Request a bailout to start fresh.');
      return;
    }

    // SECURITY FIX: Execute trade server-side with atomic transaction
    // Server validates, applies dailyImpact limits, handles trailing effects
    setLoadingKey('trade', true);
    let result;
    try {
      result = await executeTradeFunction({ ticker, action, amount });
      console.log('[TRADE EXECUTED]', result.data);
    } catch (error) {
      console.error('[TRADE EXECUTION ERROR]', error);
      const message = error.message || 'Trade execution failed';

      // Extract user-friendly error messages
      if (message.includes('cooldown:') || message.includes('Hold period:') ||
          message.includes('Short limit') || message.includes('velocity limit') ||
          message.includes('Insufficient') || message.includes('Daily impact limit')) {
        showNotification('error', message.replace(/^.*: /, ''));
      } else {
        showNotification('error', 'Cannot execute trade at this time');
      }
      setLoadingKey('trade', false);
      return;
    }

    // Wrap post-execution processing so setLoadingKey always runs
    try {
    // Extract execution results from server
    const {
      executionPrice,
      newPrice: tradedTickerPrice,
      priceImpact,
      totalCost,
      newCash,
      newHoldings,
      newShorts,
      newMarginUsed,
      priceUpdates, // All affected tickers (including trailing effects)
      remainingDailyImpact,
      shortWarning
    } = result.data;

    const userRef = doc(db, 'users', user.uid);
    const now = Date.now();
    const today = getTodayDateString();
    const weekId = getWeekId();

    if (action === 'buy') {
      // Server handles: price updates, trailing effects, cash/holdings/margin, missions, cost basis
      // Client handles: achievements, activity feed, portfolio history

      // Record portfolio history
      const newPortfolioValue = newCash + Object.entries(newHoldings).reduce((sum, [t, shares]) => {
        const price = priceUpdates[t] || prices[t] || 0;
        return sum + price * shares;
      }, 0);
      // Portfolio history now handled server-side by syncPortfolio

      // Check achievements (context-based ones handled server-side in executeTrade)
      const earnedAchievements = await checkAndAwardAchievements();

      const impactPercent = (prices[ticker] > 0 ? (priceImpact / prices[ticker] * 100) : 0).toFixed(2);

      // Add to activity feed
      const charName = CHARACTERS.find(c => c.ticker === ticker)?.name || ticker;
      addActivity('trade', `Bought ${amount} $${ticker} (${charName}) @ ${formatCurrency(executionPrice)}`);

      if (earnedAchievements.length > 0) {
        const achievement = ACHIEVEMENTS[earnedAchievements[0]];
        addActivity('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked!`);
        showNotification('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked! Bought ${amount} ${ticker}`);
        try {
          achievementAlertFunction({
            achievementId: earnedAchievements[0],
            achievementName: achievement.name,
            achievementDescription: achievement.description
          }).catch(() => {});
        } catch {}
      } else {
        let message = `Bought ${amount} ${ticker} @ ${formatCurrency(executionPrice)} (${impactPercent > 0 ? '+' : ''}${impactPercent}% impact)`;

        // Show remaining daily impact
        if (remainingDailyImpact <= 0) {
          message += ' • Daily impact limit reached';
        } else if (remainingDailyImpact < 0.02) {
          message += ` • ${(remainingDailyImpact * 100).toFixed(1)}% impact remaining`;
        }

        showNotification('success', message);
      }

      // Send trade spike alert if price moved 1%+
      if (Math.abs(parseFloat(impactPercent)) >= 1) {
        try {
          tradeSpikeAlertFunction({
            ticker,
            priceBefore: prices[ticker],
            priceAfter: tradedTickerPrice,
            tradeType: 'BUY',
            shares: amount
          }).catch(() => {});
        } catch {}
      }

    } else if (action === 'sell') {
      // Server already handled: validation, price updates, trailing effects, cash/holdings updates
      // Server handles: missions, cost basis, lowestWhileHolding
      // Client handles: achievements, activity feed, portfolio history

      // Calculate profit metrics for achievements
      const costBasis = userData.costBasis?.[ticker] || 0;
      const profitPercent = costBasis > 0 ? ((executionPrice - costBasis) / costBasis) * 100 : 0;

      // Record portfolio history
      const newPortfolioValue = newCash + Object.entries(newHoldings).reduce((sum, [t, shares]) => {
        const price = priceUpdates[t] || prices[t] || 0;
        return sum + price * shares;
      }, 0);
      // Portfolio history now handled server-side by syncPortfolio



      // Check achievements (context-based ones handled server-side in executeTrade)
      const earnedAchievements = await checkAndAwardAchievements();

      const impactPercent = (prices[ticker] > 0 ? (priceImpact / prices[ticker] * 100) : 0).toFixed(2);
      const charName = CHARACTERS.find(c => c.ticker === ticker)?.name || ticker;
      const profitText = profitPercent >= 0 ? `+${profitPercent.toFixed(1)}%` : `${profitPercent.toFixed(1)}%`;
      addActivity('trade', `Sold ${amount} $${ticker} (${charName}) @ ${formatCurrency(executionPrice)} (${profitText})`);

      if (earnedAchievements.length > 0) {
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
        let message = `Sold ${amount} ${ticker} @ ${formatCurrency(executionPrice)} (${profitText}, ${impactPercent}% impact)`;
        if (remainingDailyImpact <= 0) {
          message += ' • Daily impact limit reached';
        } else if (remainingDailyImpact < 0.02) {
          message += ` • ${(remainingDailyImpact * 100).toFixed(1)}% impact remaining`;
        }
        showNotification('success', message);
      }

      if (Math.abs(parseFloat(impactPercent)) >= 1) {
        try {
          tradeSpikeAlertFunction({
            ticker,
            priceBefore: prices[ticker],
            priceAfter: tradedTickerPrice,
            tradeType: 'SELL',
            shares: amount
          }).catch(() => {});
        } catch {}
      }

    } else if (action === 'short') {
      // Server handles: validation, price updates, trailing effects, cash/holdings/shorts, missions
      // Client handles: achievements, activity feed, portfolio history

      // Record portfolio history
      const newPortfolioValue = newCash + Object.entries(newHoldings).reduce((sum, [t, shares]) => {
        const price = priceUpdates[t] || prices[t] || 0;
        return sum + price * shares;
      }, 0);
      // Portfolio history now handled server-side by syncPortfolio

      // Check achievements (context-based ones handled server-side in executeTrade)
      const earnedAchievements = await checkAndAwardAchievements();

      const impactPercent = (prices[ticker] > 0 ? (priceImpact / prices[ticker] * 100) : 0).toFixed(2);
      const charName = CHARACTERS.find(c => c.ticker === ticker)?.name || ticker;
      addActivity('trade', `Shorted ${amount} $${ticker} (${charName}) @ ${formatCurrency(executionPrice)}`);

      if (earnedAchievements.length > 0) {
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
        let message = `Shorted ${amount} ${ticker} @ ${formatCurrency(executionPrice)} (${impactPercent}% impact)`;
        if (remainingDailyImpact <= 0) {
          message += ' • Daily impact limit reached';
        } else if (remainingDailyImpact < 0.02) {
          message += ` • ${(remainingDailyImpact * 100).toFixed(1)}% impact remaining`;
        }
        showNotification('success', message);
        if (shortWarning) {
          setTimeout(() => showNotification('warning', shortWarning), 1500);
        }
      }

      if (Math.abs(parseFloat(impactPercent)) >= 1) {
        try {
          tradeSpikeAlertFunction({
            ticker,
            priceBefore: prices[ticker],
            priceAfter: tradedTickerPrice,
            tradeType: 'SHORT',
            shares: amount
          }).catch(() => {});
        } catch {}
      }

    } else if (action === 'cover') {
      // Server handles: validation, price updates, trailing effects, cash/shorts, missions
      // Client handles: achievements, activity feed, portfolio history

      // Calculate profit for notifications (with NaN guards)
      const shortPosition = userData.shorts?.[ticker] || {};
      const costBasis = Number(shortPosition.costBasis || shortPosition.entryPrice) || 0;
      const profit = (costBasis - executionPrice) * amount;
      const profitPercent = costBasis > 0 ? ((costBasis - executionPrice) / costBasis) * 100 : 0;
      const safeProfitMsg = isNaN(profit) ? '$0.00' : (profit >= 0 ? `+${formatCurrency(profit)}` : `-${formatCurrency(Math.abs(profit))}`);
      const profitMsg = safeProfitMsg;

      // Record portfolio history
      const newPortfolioValue = newCash + Object.entries(newHoldings).reduce((sum, [t, shares]) => {
        const price = priceUpdates[t] || prices[t] || 0;
        return sum + price * shares;
      }, 0);
      // Portfolio history now handled server-side by syncPortfolio

      // Check achievements (context-based ones handled server-side in executeTrade)
      const isColdBlooded = profitPercent >= 20; // 20%+ profit on short
      const earnedAchievements = await checkAndAwardAchievements();

      const impactPercent = (prices[ticker] > 0 ? (priceImpact / prices[ticker] * 100) : 0).toFixed(2);
      const charName = CHARACTERS.find(c => c.ticker === ticker)?.name || ticker;
      addActivity('trade', `Covered ${amount} $${ticker} (${charName}) @ ${formatCurrency(executionPrice)} (${profitMsg})`);

      if (isColdBlooded && earnedAchievements.includes('COLD_BLOODED')) {
        const achievement = ACHIEVEMENTS['COLD_BLOODED'];
        addActivity('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked!`);
        showNotification('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked!`);
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
        let message = `Covered ${amount} ${ticker} @ ${formatCurrency(executionPrice)} (${profitMsg}, ${impactPercent}% impact)`;
        if (remainingDailyImpact <= 0) {
          message += ' • Daily impact limit reached';
        } else if (remainingDailyImpact < 0.02) {
          message += ` • ${(remainingDailyImpact * 100).toFixed(1)}% impact remaining`;
        }
        showNotification(profit >= 0 ? 'success' : 'error', message);
      }

      if (Math.abs(parseFloat(impactPercent)) >= 1) {
        try {
          tradeSpikeAlertFunction({
            ticker,
            priceBefore: prices[ticker],
            priceAfter: tradedTickerPrice,
            tradeType: 'COVER',
            shares: amount
          }).catch(() => {});
        } catch {}
      }


    }
    } finally {
      setLoadingKey('trade', false);
    }
  }, [user, userData, prices, marketData, addActivity]);

  // Sync portfolio value, history, and achievements via Cloud Function
  // (these fields are blocked from client-side writes by security rules)
  // Debounced to avoid firing on every price tick
  useEffect(() => {
    if (!user || !userData || Object.keys(prices).length === 0) return;

    const timeout = setTimeout(async () => {
      try {
        await syncPortfolioFunction();
      } catch (error) {
        console.error('[PORTFOLIO SYNC ERROR]', error);
      }
    }, 30000);

    return () => clearTimeout(timeout);
  }, [user, userData, prices]);

  // Margin monitoring now handled server-side by checkMarginLending scheduled function (every 5 min)

  // Daily margin interest (charged at midnight or on login)
  useEffect(() => {
    if (!user || !userData || !userData.marginEnabled) return;

    const marginUsed = userData.marginUsed || 0;
    if (marginUsed <= 0) return;

    const lastInterestCharge = userData.lastMarginInterestCharge || 0;
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    if (now - lastInterestCharge >= oneDayMs) {
      chargeMarginInterestFunction({}).then(result => {
        if (result.data.charged > 0) {
          console.log(`Margin interest charged: ${formatCurrency(result.data.charged)}`);
        }
      }).catch(err => console.error('Margin interest charge failed:', err));
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

  // Leaderboard achievements now handled server-side in syncPortfolio

  // Daily checkin (now uses Cloud Function to prevent security rule violations)
  const handleDailyCheckin = useCallback(async () => {
    if (!user || !userData) {
      showNotification('info', 'Sign in to claim your daily bonus!');
      return;
    }

    const today = getTodayDateString(); // UTC YYYY-MM-DD, matches server
    const lastCheckinStr = toUTCDateString(userData.lastCheckin);
    if (lastCheckinStr === today) {
      showNotification('error', 'Already checked in today!');
      return;
    }

    setLoadingKey('checkin', true);
    try {
      // Call Cloud Function (ladder top-up handled server-side)
      const result = await dailyCheckinFunction({});
      const { reward, newStreak, ladderTopUpAmount, totalCheckins } = result.data;

      // Optimistic update so check-in button switches immediately
      setUserData(prev => prev ? { ...prev, lastCheckin: new Date().toISOString(), cash: (prev.cash || 0) + reward, checkinStreak: newStreak, totalCheckins } : prev);

      // Add to activity feed
      let activityMsg = `Daily check-in: +${formatCurrency(reward)}!`;
      if (ladderTopUpAmount > 0) {
        activityMsg += ` | Ladder Game topped up to $100`;
      }
      addActivity('checkin', `${activityMsg} (Day ${totalCheckins})`);

      let notificationMsg = `Daily check-in: +${formatCurrency(reward)}!`;
      if (ladderTopUpAmount > 0) {
        notificationMsg += ` | Ladder Game topped up to $100`;
      }
      showNotification('success', notificationMsg);
    } catch (error) {
      console.error('[CHECKIN ERROR]', error);
      if (error.code === 'failed-precondition' && error.message.includes('Already checked in')) {
        showNotification('error', 'Already checked in today!');
      } else {
        showNotification('error', 'Failed to check in. Please try again.');
      }
    } finally {
      setLoadingKey('checkin', false);
    }
  }, [user, userData, addActivity]);

  // Handle IPO purchase
  const handleBuyIPO = useCallback(async (ticker, quantity) => {
    if (!user || !userData) {
      showNotification('info', 'Sign in to participate in IPO!');
      return;
    }

    if (isWeeklyHalt() || marketData?.marketHalted) {
      showNotification('error', marketData?.marketHalted
        ? `Market closed: ${marketData.haltReason || 'Emergency halt in progress'}`
        : 'Market closed for chapter review. Trading resumes at 21:00 UTC.');
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

    setLoadingKey('buyIPO', true);
    try {
      await buyIPOSharesFunction({ ticker, quantity });

      const totalCostIPO = ipo.basePrice * quantity;
      setUserData(prev => {
        if (!prev) return prev;
        const existing = prev.holdings?.[ticker] || { quantity: 0, avgCost: 0 };
        const newQty = existing.quantity + quantity;
        const newAvg = ((existing.avgCost * existing.quantity) + totalCostIPO) / newQty;
        return { ...prev, cash: (prev.cash || 0) - totalCostIPO, holdings: { ...prev.holdings, [ticker]: { quantity: newQty, avgCost: newAvg } } };
      });

      const character = CHARACTER_MAP[ticker];
      addActivity('trade', `🚀 IPO: Bought ${quantity} $${ticker} (${character?.name || ticker}) @ ${formatCurrency(ipo.basePrice)}`);
      showNotification('success', `🚀 IPO: Bought ${quantity} ${character?.name || ticker} shares @ ${formatCurrency(ipo.basePrice)}!`);
    } catch (err) {
      console.error('IPO purchase failed:', err);
      const msg = err?.message || 'IPO purchase failed!';
      showNotification('error', msg);
    } finally {
      setLoadingKey('buyIPO', false);
    }
  }, [user, userData, marketData, addActivity]);

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

    setLoadingKey('placeBet', true);
    try {
      await placeBetFunction({ predictionId, option, amount });

      setUserData(prev => {
        if (!prev) return prev;
        const existingBet = prev.bets?.[predictionId];
        const newAmount = (existingBet?.amount || 0) + amount;
        return { ...prev, cash: (prev.cash || 0) - amount, bets: { ...prev.bets, [predictionId]: { option, amount: newAmount, paid: false } } };
      });

      addActivity('bet', `🔮 Bet ${formatCurrency(amount)} on "${option}"`);
      showNotification('success', `Bet ${formatCurrency(amount)} on "${option}"!`);
    } catch (error) {
      console.error('Bet placement failed:', error);
      const msg = error?.message || 'Bet failed';
      showNotification('error', msg.includes('Insufficient') ? 'Insufficient funds!' : msg);
    } finally {
      setLoadingKey('placeBet', false);
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

    setLoadingKey('enableMargin', true);
    try {
      await toggleMarginFunction({ enable: true });
      setUserData(prev => prev ? { ...prev, marginEnabled: true } : prev);
      showNotification('success', '📊 Margin trading enabled! You now have extra buying power.');
    } catch (err) {
      showNotification('error', err?.message || 'Failed to enable margin');
    } finally {
      setLoadingKey('enableMargin', false);
    }
  }, [user, userData]);

  // Disable margin trading
  const handleDisableMargin = useCallback(async () => {
    if (!user || !userData) return;

    if ((userData.marginUsed || 0) >= 0.01) {
      showNotification('error', 'Repay all margin debt before disabling!');
      return;
    }

    setLoadingKey('disableMargin', true);
    try {
      await toggleMarginFunction({ enable: false });
      setUserData(prev => prev ? { ...prev, marginEnabled: false } : prev);
      showNotification('success', 'Margin trading disabled.');
      setShowLending(false);
    } catch (err) {
      showNotification('error', err?.message || 'Failed to disable margin');
    } finally {
      setLoadingKey('disableMargin', false);
    }
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

    setLoadingKey('repayMargin', true);
    try {
      const result = await repayMarginFunction({ amount });
      const { repaid, remaining } = result.data;

      setUserData(prev => prev ? { ...prev, cash: (prev.cash || 0) - repaid, marginUsed: remaining } : prev);

      if (remaining === 0) {
        showNotification('success', `Margin fully repaid! Paid ${formatCurrency(repaid)}`);
      } else {
        showNotification('success', `Repaid ${formatCurrency(repaid)}. Remaining debt: ${formatCurrency(remaining)}`);
      }
    } catch (err) {
      showNotification('error', err?.message || 'Failed to repay margin');
    } finally {
      setLoadingKey('repayMargin', false);
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

    setLoadingKey('bailout', true);
    try {
      const currentCrew = userData.crew;
      const result = await bailoutFunction({});

      setUserData(prev => {
        if (!prev) return prev;
        const exiled = [...(prev.exiledCrews || [])];
        if (currentCrew && !exiled.includes(currentCrew)) exiled.push(currentCrew);
        return { ...prev, cash: 500, crew: null, holdings: {}, shorts: {}, marginUsed: 0, marginEnabled: false, exiledCrews: exiled };
      });

      if (result.data.hadCrew) {
        const crewName = CREW_MAP[currentCrew]?.name || 'your crew';
        showNotification('warning', `Bailout accepted. You've been exiled from ${crewName} and all previous crews. Starting fresh with $500.`);
      } else {
        showNotification('success', 'Bailout accepted. Starting fresh with $500.');
      }
    } catch (err) {
      console.error('Bailout failed:', err);
      showNotification('error', 'Bailout failed. Please try again.');
    } finally {
      setLoadingKey('bailout', false);
    }
  }, [user, userData]);

  // Guest data
  const guestData = { cash: STARTING_CASH, holdings: {}, shorts: {}, costBasis: {}, bets: {}, portfolioValue: STARTING_CASH };
  const activeUserData = userData || guestData;
  const isGuest = !user;

  // Get user's bet for a prediction
  const getUserBet = (predictionId) => activeUserData.bets?.[predictionId] || null;

  // Portfolio calculations
  const holdingsValue = Object.entries(activeUserData.holdings || {})
    .reduce((sum, [ticker, shares]) => sum + (prices[ticker] || 0) * shares, 0);
  
  const shortsValue = Object.entries(activeUserData.shorts || {})
    .reduce((sum, [ticker, position]) => {
      if (!position || typeof position !== 'object') return sum;
      const shares = Number(position.shares) || 0;
      if (shares <= 0) return sum;
      const entryPrice = Number(position.costBasis || position.entryPrice) || 0;
      const currentPrice = prices[ticker] || entryPrice;
      const collateral = Number(position.margin) || 0;
      let value;
      if (position.system === 'v2') {
        // v2: margin + unrealized P&L (no proceeds in cash)
        value = collateral + (entryPrice - currentPrice) * shares;
      } else {
        // Legacy: margin collateral - cost to buy back shares
        value = collateral - (currentPrice * shares);
      }
      return sum + (isNaN(value) ? 0 : value);
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
  }, [searchQuery, sortBy, prices, priceHistory, get24hChange, activeIPOs, ipoRestrictedTickers, launchedTickers]);

  const totalPages = Math.ceil(filteredCharacters.length / ITEMS_PER_PAGE);
  const displayedCharacters = showAll ? filteredCharacters : filteredCharacters.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  // Styling - Orange/Yellow theme inspired by logo
  const bgClass = darkMode ? 'bg-zinc-950' : 'bg-amber-50';
  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-zinc-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';
  const inputClassStyle = darkMode ? 'bg-zinc-950 border-zinc-700 text-zinc-100' : 'bg-white border-amber-300 text-zinc-900';

  // Create context value for AppProvider (memoized to prevent unnecessary re-renders)
  const contextValue = useMemo(() => ({
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
  }), [darkMode, user, userData, prices, priceHistory, predictions, marketData, getColorBlindColors, showNotification, activeIPOs, ipoRestrictedTickers, launchedTickers]);

  if (loading) {
    return (
      <div className={`min-h-screen ${bgClass} flex items-center justify-center`}>
        <div className={`text-lg ${mutedClass}`}>Loading Stockism...</div>
      </div>
    );
  }

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
          prices={prices}
          priceHistory={priceHistory}
          marketData={marketData}
        >
          {showInAppBanner && (
            <div className={`mx-4 mt-3 p-3 rounded-sm border text-sm flex items-center justify-between gap-2 ${
              darkMode ? 'bg-amber-900/30 border-amber-700 text-amber-200' : 'bg-amber-50 border-amber-300 text-amber-800'
            }`}>
              <span>For the best experience, open this page in your browser. Trading may not work in this app.</span>
              <button onClick={() => setShowInAppBanner(false)} className="shrink-0 font-bold text-lg leading-none opacity-60 hover:opacity-100">&times;</button>
            </div>
          )}
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
              loading={actionLoading.checkin}
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
                    {portfolioValue >= STARTING_CASH ? '▲' : '▼'} {(STARTING_CASH > 0 ? ((portfolioValue - STARTING_CASH) / STARTING_CASH * 100) : 0).toFixed(2)}% from start
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
              enableLoading={actionLoading.enableMargin}
              disableLoading={actionLoading.disableMargin}
              repayLoading={actionLoading.repayMargin}
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
          leaveLoading={actionLoading.leaveCrew}
        />
      )}
      {showPinShop && !isGuest && (
        <PinShopModal
          onClose={() => setShowPinShop(false)}
          darkMode={darkMode}
          userData={userData}
          onPurchase={handlePinAction}
          purchaseLoading={actionLoading.pinAction}
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
          claimLoading={actionLoading.claimMission}
          claimWeeklyLoading={actionLoading.claimWeeklyMission}
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
                disabled={actionLoading.bailout}
                className={`flex-1 py-2 rounded-sm border ${darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 hover:bg-amber-50'} disabled:opacity-50`}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  await handleBailout();
                  setShowBailout(false);
                }}
                disabled={actionLoading.bailout}
                className={`flex-1 py-2 rounded-sm text-white font-semibold ${userData?.colorBlindMode ? 'bg-teal-600 hover:bg-teal-700' : 'bg-green-600 hover:bg-green-700'} disabled:opacity-50`}
              >
                {actionLoading.bailout ? 'Processing...' : 'Accept Bailout'}
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
          marketData={marketData}
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
                <span className={`font-semibold ${tradeConfirmation.action === 'buy' || tradeConfirmation.action === 'cover' ? 'text-green-500' : 'text-red-500'}`}>
                  {tradeConfirmation.action.toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Shares:</span>
                <span className="font-semibold">{tradeConfirmation.amount}</span>
              </div>
              <div className="flex justify-between">
                <span>{tradeConfirmation.action === 'short' ? 'Margin/Share:' : 'Est. Price/Share:'}</span>
                <span className="font-semibold">{formatCurrency(Math.abs(tradeConfirmation.total) / tradeConfirmation.amount)}</span>
              </div>
              <div className={`flex justify-between pt-2 border-t ${darkMode ? 'border-zinc-700' : 'border-amber-200'}`}>
                <span className="font-semibold">{tradeConfirmation.action === 'short' ? 'Margin Cost:' : tradeConfirmation.action === 'cover' ? 'Est. Return:' : 'Est. Total:'}</span>
                <span className={`font-bold ${
                  tradeConfirmation.action === 'buy' || tradeConfirmation.action === 'short' || (tradeConfirmation.action === 'cover' && tradeConfirmation.total < 0)
                    ? 'text-red-500' : 'text-green-500'
                }`}>
                  {tradeConfirmation.action === 'buy' || tradeConfirmation.action === 'short'
                    ? '-' : tradeConfirmation.total < 0 ? '-' : '+'}{formatCurrency(Math.abs(tradeConfirmation.total))}
                </span>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setTradeConfirmation(null)}
                disabled={actionLoading.trade}
                className={`flex-1 py-2 rounded-sm font-semibold ${darkMode ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'} disabled:opacity-50`}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  await handleTrade(tradeConfirmation.ticker, tradeConfirmation.action, tradeConfirmation.amount);
                  setTradeConfirmation(null);
                }}
                disabled={actionLoading.trade}
                className={`flex-1 py-2 rounded-sm font-semibold text-white ${
                  tradeConfirmation.action === 'buy' || tradeConfirmation.action === 'cover' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
                } disabled:opacity-50`}
              >
                {actionLoading.trade ? 'Executing...' : `Confirm ${tradeConfirmation.action.charAt(0).toUpperCase() + tradeConfirmation.action.slice(1)}`}
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
                disabled={actionLoading.placeBet}
                className={`flex-1 py-2 rounded-sm font-semibold ${darkMode ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'} disabled:opacity-50`}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  await handleBet(betConfirmation.predictionId, betConfirmation.option, betConfirmation.amount);
                  setBetConfirmation(null);
                }}
                disabled={actionLoading.placeBet}
                className="flex-1 py-2 rounded-sm font-semibold text-white bg-orange-600 hover:bg-orange-700 disabled:opacity-50"
              >
                {actionLoading.placeBet ? 'Placing Bet...' : 'Place Bet'}
              </button>
            </div>
          </div>
        </div>
      )}

      </Layout>
    </AppProvider>
  );
}
