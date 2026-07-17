import * as Sentry from '@sentry/react';
import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import {
  onAuthStateChanged,
  applyActionCode,
  signInWithCustomToken
} from 'firebase/auth';
import {
  doc,
  getDoc,
  updateDoc,
  onSnapshot,
  collection,
  query,
  where,
  orderBy,
  limit,
  deleteDoc,
  deleteField
} from 'firebase/firestore';
import { auth, db, executeTradeFunction, achievementAlertFunction, deleteAccountFunction, claimPredictionPayoutFunction, chargeMarginInterestFunction, syncPortfolioFunction, createPriceAlertFunction, deletePriceAlertFunction } from './firebase';
import { fireTradeConfetti } from './utils/confetti';
import { ACHIEVEMENTS } from './constants/achievements';
import { CHARACTERS, CHARACTER_MAP } from './characters';
import { computeRarityTiers } from './utils/rarity';
import { CREWS, CREW_MAP } from './crews';
import { isWeeklyHalt, getReviewChanges } from './utils/marketHours';
import MarketIndex from './components/MarketIndex';
import PredictionsTeaser from './components/PredictionsTeaser';
import ErrorBoundary from './components/common/ErrorBoundary';

// Eagerly-loaded modals (shown immediately / on critical auth flows)
import LoginModal from './components/modals/LoginModal';
import DiscordWallModal from './components/modals/DiscordWallModal';
import UsernameModal from './components/modals/UsernameModal';
import EmailVerificationModal from './components/modals/EmailVerificationModal';

// Lazy-loaded — only downloaded when the user actually opens them
const AdminPanel        = lazy(() => import('./AdminPanel'));
const AboutModal        = lazy(() => import('./components/modals/AboutModal'));
const CrewSelectionModal = lazy(() => import('./components/modals/CrewSelectionModal'));
const PinShopModal      = lazy(() => import('./components/modals/PinShopModal'));
const DailyMissionsModal = lazy(() => import('./components/modals/DailyMissionsModal'));
const MarginModal       = lazy(() => import('./components/modals/MarginModal'));
const MarginTutorialModal = lazy(() => import('./components/modals/MarginTutorialModal'));
const ChartModal        = lazy(() => import('./components/modals/ChartModal'));
const PortfolioModal    = lazy(() => import('./components/modals/PortfolioModal'));
const TradeHistoryModal = lazy(() => import('./components/modals/TradeHistoryModal'));
const StockPage         = lazy(() => import('./pages/StockPage'));

// Import other components
import CheckInButton from './components/CheckInButton';
import CharacterCard from './components/CharacterCard';
import ShortRiskAlert from './components/ShortRiskAlert';
import { ToastContainer } from './components/ToastNotification';
import NotificationPanel from './components/NotificationPanel';
import OnboardingTutorial from './components/OnboardingTutorial';
import PriceAlertModal from './components/modals/PriceAlertModal';
import InstallPrompt from './components/InstallPrompt';
import IPOHypeCard from './components/IPOHypeCard';
import IPOActiveCard from './components/IPOActiveCard';
import { useModalManager } from './hooks/useModalManager';
import { useEscapeKey } from './hooks/useEscapeKey';
import { useMissionManagement } from './hooks/useMissionManagement';
import { useMarginManagement } from './hooks/useMarginManagement';
import { useCrewManagement } from './hooks/useCrewManagement';
import { usePredictionManagement } from './hooks/usePredictionManagement';
import { useIPOManagement } from './hooks/useIPOManagement';
import { useDailyOperations } from './hooks/useDailyOperations';
import { usePinShop } from './hooks/usePinShop';

// Layout is always needed — eagerly loaded
import Layout from './components/layout/Layout';

// Pages are lazy-loaded for route-based code splitting
const LeaderboardPage  = lazy(() => import('./pages/LeaderboardPage'));
const AchievementsPage = lazy(() => import('./pages/AchievementsPage'));
const LadderPage       = lazy(() => import('./pages/LadderPage'));
const ProfilePage      = lazy(() => import('./pages/ProfilePage'));
const PublicProfilePage = lazy(() => import('./pages/PublicProfilePage'));
const PredictionsPage  = lazy(() => import('./pages/PredictionsPage'));

// Import AppContext
import { AppProvider } from './context/AppContext';
import { getThemeClasses } from './utils/theme';

// Import from new modular structure
import {
  ADMIN_UIDS,
  ITEMS_PER_PAGE,
  UNVERIFIED_STARTING_CASH,
  BAILOUT_CASH,
  IPO_TOTAL_SHARES,
  MIN_PRICE,
  NEW_ACCOUNT_IMPACT_PERIOD_DAYS,
  NEW_ACCOUNT_MIN_IMPACT_FACTOR,
  PORTFOLIO_SYNC_MIN_INTERVAL_MS,
} from './constants';
import {
  getCurrentPrice,
  getBidAskPrices,
  calculateMarginStatus,
  calculatePortfolioValue,
  calculatePriceImpactDollars,
} from './utils/calculations';
import { formatCurrency, formatChange } from './utils/formatters';
import { getWeekStart } from './utils/date';


// ============================================
// MARKET MECHANICS HELPERS
// ============================================

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
// PREDICTION/IPO HELPERS
// ============================================

// ============================================
// PREDICTION CARD COMPONENT → moved to src/components/PredictionCard.jsx
// ============================================

// ============================================
// IPO HYPE CARD → moved to src/components/IPOHypeCard.jsx
// ============================================

// ============================================
// IPO ACTIVE CARD → moved to src/components/IPOActiveCard.jsx
// ============================================

// ============================================
// MAIN APP
// ============================================

function DiscordLinkRedirect({ user, darkMode, bgClass, setShowLoginModal }) {
  useEffect(() => {
    if (user) {
      window.location.href = `https://discord.com/oauth2/authorize?client_id=1467420774477467752&response_type=code&redirect_uri=${encodeURIComponent('https://us-central1-stockism-abb28.cloudfunctions.net/discordLink')}&scope=identify&state=${user.uid}`;
    }
  }, [user]);

  const { cardClass, textClass, mutedClass } = getThemeClasses(darkMode);

  if (!user) {
    return (
      <div className={`min-h-screen ${bgClass} flex items-center justify-center p-4`}>
        <div className={`max-w-sm w-full p-6 rounded-sm border text-center ${cardClass}`}>
          <p className={`text-lg font-semibold mb-3 ${textClass}`}>Link Your Discord</p>
          <p className={`text-sm mb-4 ${mutedClass}`}>Log into Stockism first, then come back to this page.</p>
          <button
            onClick={() => setShowLoginModal(true)}
            className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-sm"
          >
            Log In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${bgClass} flex items-center justify-center`}>
      <p className={mutedClass}>Redirecting to Discord...</p>
    </div>
  );
}

// Triggers server-side achievement check via syncPortfolio
const checkAndAwardAchievements = async () => {
  try {
    const result = await syncPortfolioFunction();
    return result.data?.newAchievements || [];
  } catch (error) {
    console.error('[ACHIEVEMENT CHECK ERROR]', error);
    return [];
  }
};

export default function App() {
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [prices, setPrices] = useState({});
  const [priceHistory, setPriceHistory] = useState({});
  const [marketData, setMarketData] = useState(null);
  const [dividendTierOverrides, setDividendTierOverrides] = useState({});
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
  // Modal state managed by hook
  const {
    showLoginModal, setShowLoginModal,
    showPortfolio, setShowPortfolio,
    showTradeHistory, setShowTradeHistory,
    showAbout, setShowAbout,
    showLending, setShowLending,
    showBailout, setShowBailout,
    showCrewSelection, setShowCrewSelection,
    showPinShop, setShowPinShop,
    showDailyMissions, setShowDailyMissions,
    showAdmin, setShowAdmin,
    showNotificationPanel, setShowNotificationPanel,
    showPriceAlertModal, setShowPriceAlertModal,
    tradeConfirmation, setTradeConfirmation,
    limitOrderRequest, setLimitOrderRequest,
    betConfirmation, setBetConfirmation,
    selectedCharacter, setSelectedCharacter,
  } = useModalManager();

  // The trade/bet confirmations are inline overlays (not components), so they
  // join the Escape stack here; `enabled` registers them only while shown.
  useEscapeKey(() => setTradeConfirmation(null), !!tradeConfirmation);
  useEscapeKey(() => setBetConfirmation(null), !!betConfirmation);

  const [tradeAnimation, setTradeAnimation] = useState(null); // { ticker, action, timestamp }
  const [notifications, setNotifications] = useState([]); // Toast notification queue
  const [showMarginTutorialReview, setShowMarginTutorialReview] = useState(false);

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
  const [marketTab, setMarketTab] = useState('stocks'); // 'stocks', 'etfs', 'watchlist', or 'review'
  const [crewFilter, setCrewFilter] = useState('ALL'); // 'ALL' or crew ID
  const [predictions, setPredictions] = useState([]);
  const [activeIPOs, setActiveIPOs] = useState([]); // IPOs currently in hype or active phase
  const [userNotifications, setUserNotifications] = useState([]);
  const [priceAlerts, setPriceAlerts] = useState([]); // user's active price alerts
  // Compute new characters for header notification
  const newCharactersWithData = useMemo(() => {
    const weekStart = getWeekStart();
    return CHARACTERS.filter(char => {
      const isNewThisWeek = new Date(char.dateAdded) >= weekStart;
      const isAvailable = !char.ipoRequired || launchedTickers.includes(char.ticker);
      return isNewThisWeek && isAvailable;
    }).map(char => {
      const currentPrice = prices[char.ticker] || char.basePrice;
      const history = priceHistory[char.ticker] || [];
      const weekStartTime = weekStart.getTime();
      const startPrice = history.find(h => h.timestamp >= weekStartTime)?.price || history[0]?.price || currentPrice;
      const weeklyChange = startPrice > 0 ? ((currentPrice - startPrice) / startPrice) * 100 : 0;
      return { ...char, currentPrice, weeklyChange };
    });
  }, [prices, priceHistory, launchedTickers]);

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

  // Business-logic hooks — called here, after showNotification + all state are defined
  // These receive state directly because App.jsx IS the context provider (can't consume its own context)
  const { handleClaimMissionReward, handleRerollMissions, handleClaimWeeklyMissionReward } = useMissionManagement({ user, userData, showNotification, setUserData, setLoadingKey });
  const { handleEnableMargin, handleDisableMargin, handleRepayMargin } = useMarginManagement({ user, userData, showNotification, setUserData, setLoadingKey, setShowLending });
  const { handleCrewSelect, handleCrewLeave } = useCrewManagement({ user, userData, showNotification, setUserData, setLoadingKey });
  const { handleBet, handleBuyEventShares, handleSellEventShares } = usePredictionManagement({ user, userData, predictions, showNotification, setUserData, setLoadingKey });
  const { handleBuyIPO } = useIPOManagement({ user, userData, marketData, showNotification, setUserData, setLoadingKey });
  const { handleDailyCheckin, handleBailout } = useDailyOperations({ user, userData, showNotification, setUserData, setLoadingKey });
  const { handlePinAction, handlePurchaseCosmetic, handleEquipCosmetic } = usePinShop({ user, userData, showNotification, setUserData, setLoadingKey });

  // Handle trade (executes after confirmation)
  const handleTrade = useCallback(async (ticker, action, amount) => {
    console.log(`[TRADE START] ticker=${ticker}, action=${action}, amount=${amount}`);
    if (!user || !userData) {
      showNotification('info', 'Sign in to start trading!');
      return;
    }
    if (isWeeklyHalt() || marketData?.marketHalted) {
      showNotification('error', marketData?.marketHalted
        ? `Market closed: ${marketData.haltReason || 'Emergency halt in progress'}`
        : 'Market closed for chapter review. Queue a pre-market order from 20:30 UTC, trading resumes at 21:00 UTC.');
      return;
    }
    if ((userData.cash || 0) < 0 && (action === 'buy' || action === 'short')) {
      showNotification('error', 'You cannot open new positions while in debt. Request a bailout to start fresh.');
      return;
    }

    setLoadingKey('trade', true);
    let result;
    try {
      result = await executeTradeFunction({ ticker, action, amount });
      console.log('[TRADE EXECUTED]', result.data);
    } catch (firstError) {
      const firstMsg = firstError.message || 'Trade execution failed';
      const isContention = firstMsg.includes('busy') || firstMsg.includes('try again') || firstMsg.includes('contention');
      if (isContention) {
        try {
          await new Promise(r => setTimeout(r, 500));
          result = await executeTradeFunction({ ticker, action, amount });
          console.log('[TRADE EXECUTED ON RETRY]', result.data);
        } catch (retryError) {
          console.error('[TRADE RETRY FAILED]', retryError);
          showNotification('warning', 'Market was busy. Please try again.');
          setLoadingKey('trade', false);
          return;
        }
      } else {
        console.error('[TRADE EXECUTION ERROR]', firstError);
        const isInfraError = firstMsg.includes('INTERNAL') || firstMsg.includes('DEADLINE_EXCEEDED') ||
                             firstMsg.includes('UNAVAILABLE') || firstMsg.includes('PERMISSION_DENIED');
        showNotification('error', isInfraError ? 'Cannot execute trade at this time. Please try again.' : firstMsg);
        setLoadingKey('trade', false);
        return;
      }
    }

    try {
      const {
        executionPrice,
        priceImpact,
        totalCost,
        remainingDailyImpact,
        isLastTrade,
        shortWarning
      } = result.data;

      const earnedAchievements = await checkAndAwardAchievements();
      const impactPercent = (prices[ticker] > 0 ? (priceImpact / prices[ticker] * 100) : 0).toFixed(2);

      if (action === 'buy') {
        if (earnedAchievements.length > 0) {
          const achievement = ACHIEVEMENTS[earnedAchievements[0]];
          showNotification('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked! Bought ${amount} ${ticker}`);
          try { achievementAlertFunction({ achievementId: earnedAchievements[0], achievementName: achievement.name, achievementDescription: achievement.description }).catch((e) => Sentry.captureException(e)); } catch (e) { Sentry.captureException(e); }
        } else {
          let message = `Bought ${amount} ${ticker} @ ${formatCurrency(executionPrice)} (${impactPercent > 0 ? '+' : ''}${impactPercent}% impact)`;
          if (isLastTrade) message += ` • This was your last trade on ${ticker} today`;
          else if (remainingDailyImpact <= 0) message += ` • 1 trade remaining on ${ticker} today`;
          else if (remainingDailyImpact < 0.03) message += ` • Approaching daily limit (${(remainingDailyImpact * 100).toFixed(1)}% remaining)`;
          showNotification('success', message);
        }
      } else if (action === 'sell') {
        const costBasis = userData.costBasis?.[ticker] || 0;
        const profitPercent = costBasis > 0 ? ((executionPrice - costBasis) / costBasis) * 100 : 0;
        const profitText = profitPercent >= 0 ? `+${profitPercent.toFixed(1)}%` : `${profitPercent.toFixed(1)}%`;
        if (earnedAchievements.length > 0) {
          const achievement = ACHIEVEMENTS[earnedAchievements[0]];
          showNotification('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked!`);
          try { achievementAlertFunction({ achievementId: earnedAchievements[0], achievementName: achievement.name, achievementDescription: achievement.description }).catch((e) => Sentry.captureException(e)); } catch (e) { Sentry.captureException(e); }
        } else {
          showNotification('success', `Sold ${amount} ${ticker} @ ${formatCurrency(executionPrice)} (${profitText}, ${impactPercent}% impact)`);
        }
      } else if (action === 'short') {
        if (earnedAchievements.length > 0) {
          const achievement = ACHIEVEMENTS[earnedAchievements[0]];
          showNotification('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked!`);
          try { achievementAlertFunction({ achievementId: earnedAchievements[0], achievementName: achievement.name, achievementDescription: achievement.description }).catch((e) => Sentry.captureException(e)); } catch (e) { Sentry.captureException(e); }
        } else {
          let message = `Shorted ${amount} ${ticker} @ ${formatCurrency(executionPrice)} (${impactPercent}% impact)`;
          if (isLastTrade) message += ` • This was your last trade on ${ticker} today`;
          else if (remainingDailyImpact <= 0) message += ` • 1 trade remaining on ${ticker} today`;
          else if (remainingDailyImpact < 0.03) message += ` • Approaching daily limit (${(remainingDailyImpact * 100).toFixed(1)}% remaining)`;
          showNotification('success', message);
          if (shortWarning) setTimeout(() => showNotification('warning', shortWarning), 1500);
        }
      } else if (action === 'cover') {
        const shortPosition = userData.shorts?.[ticker] || {};
        const costBasis = Number(shortPosition.costBasis || shortPosition.entryPrice) || 0;
        const profit = (costBasis - executionPrice) * amount;
        const safeProfitMsg = isNaN(profit) ? '$0.00' : (profit >= 0 ? `+${formatCurrency(profit)}` : `-${formatCurrency(Math.abs(profit))}`);
        const isColdBlooded = profit > 0;
        if (isColdBlooded && earnedAchievements.includes('COLD_BLOODED')) {
          const achievement = ACHIEVEMENTS['COLD_BLOODED'];
          showNotification('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked!`);
          try { achievementAlertFunction({ achievementId: 'COLD_BLOODED', achievementName: achievement.name, achievementDescription: achievement.description }).catch((e) => Sentry.captureException(e)); } catch (e) { Sentry.captureException(e); }
        } else if (earnedAchievements.length > 0) {
          const achievement = ACHIEVEMENTS[earnedAchievements[0]];
          showNotification('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked!`);
          try { achievementAlertFunction({ achievementId: earnedAchievements[0], achievementName: achievement.name, achievementDescription: achievement.description }).catch((e) => Sentry.captureException(e)); } catch (e) { Sentry.captureException(e); }
        } else {
          showNotification(profit >= 0 ? 'success' : 'error', `Covered ${amount} ${ticker} @ ${formatCurrency(executionPrice)} (${safeProfitMsg}, ${impactPercent}% impact)`);
        }
      }

      const totalValue = Math.abs(totalCost || executionPrice * amount);
      setTradeAnimation({ ticker, action, big: totalValue >= 1000, timestamp: Date.now() });
      setTimeout(() => setTradeAnimation(null), 1200);
      fireTradeConfetti(totalValue, action);

    } finally {
      setLoadingKey('trade', false);
    }
  }, [user, userData, prices, marketData, setLoadingKey, showNotification]);

  // Notification handlers
  const handleMarkNotificationRead = useCallback(async (notificationId) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'users', user.uid, 'notifications', notificationId), { read: true });
    } catch (err) {
      console.error('Failed to mark notification read:', err);
    }
  }, [user]);

  // Both act on the exact ids the panel passes (scoped to the active filter tab),
  // so "Clear" / "Mark Read" only touch what the user is actually looking at.
  const handleMarkAllNotificationsRead = useCallback(async (ids) => {
    if (!user || !ids?.length) return;
    try {
      await Promise.all(ids.map(id =>
        updateDoc(doc(db, 'users', user.uid, 'notifications', id), { read: true })
      ));
    } catch (err) {
      console.error('Failed to mark notifications read:', err);
    }
  }, [user]);

  const handleClearAllNotifications = useCallback(async (ids) => {
    if (!user || !ids?.length) return;
    try {
      await Promise.all(ids.map(id =>
        deleteDoc(doc(db, 'users', user.uid, 'notifications', id))
      ));
    } catch (err) {
      console.error('Failed to clear notifications:', err);
    }
  }, [user]);

  const handleDeleteNotification = useCallback(async (notificationId) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'notifications', notificationId));
    } catch (err) {
      console.error('Failed to delete notification:', err);
    }
  }, [user]);

  const handleCreatePriceAlert = useCallback(async ({ ticker, targetPrice, direction }) => {
    try {
      await createPriceAlertFunction({ ticker, targetPrice, direction });
      showNotification('success', `Price alert set for $${ticker}`);
      return true;
    } catch (err) {
      showNotification('error', err.message || 'Failed to create alert');
      return false;
    }
  }, [showNotification]);

  const handleDeletePriceAlert = useCallback(async (alertId) => {
    try {
      await deletePriceAlertFunction({ alertId });
    } catch (err) {
      showNotification('error', err.message || 'Failed to delete alert');
    }
  }, [showNotification]);

  const handleOnboardingComplete = useCallback(async () => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'users', user.uid), { onboardingComplete: true });
    } catch (err) {
      console.error('Failed to complete onboarding:', err);
    }
  }, [user]);

  // Ref to store user data listener unsubscribe function
  const userDataUnsubscribeRef = useRef(null);

  // Handle Discord OAuth redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const discordToken = params.get('discord_token');
    const discordError = params.get('discord_error');

    if (discordToken) {
      // Sign in with custom token from Discord OAuth
      signInWithCustomToken(auth, discordToken)
        .then(() => {
          window.history.replaceState({}, document.title, window.location.pathname);
        })
        .catch((error) => {
          console.error('Discord sign-in error:', error);
        });
    } else if (discordError) {
      showNotification('error', 'Discord sign-in failed. Please try again or use a different sign-in method.');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [showNotification]);

  // Listen to auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      // Clean up previous user data listener
      if (userDataUnsubscribeRef.current) {
        userDataUnsubscribeRef.current();
        userDataUnsubscribeRef.current = null;
      }

      setUser(firebaseUser);
      Sentry.setUser(firebaseUser ? { id: firebaseUser.uid, email: firebaseUser.email } : null);
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

  // Subscribe to user notifications
  useEffect(() => {
    if (!user) { setUserNotifications([]); return; }
    const notifQuery = query(
      collection(db, 'users', user.uid, 'notifications'),
      orderBy('createdAt', 'desc'),
      limit(50)
    );
    const unsub = onSnapshot(notifQuery, (snap) => {
      const notifs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setUserNotifications(notifs);
    }, (err) => {
      console.error('Notification subscription error:', err);
    });
    return () => unsub();
  }, [user]);

  // Subscribe to user price alerts
  useEffect(() => {
    if (!user) { setPriceAlerts([]); return; }
    const alertsQuery = query(
      collection(db, 'users', user.uid, 'priceAlerts'),
      where('triggered', '==', false)
    );
    const unsub = onSnapshot(alertsQuery, (snap) => {
      setPriceAlerts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => {
      console.error('Price alerts subscription error:', err);
    });
    return () => unsub();
  }, [user]);

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

  // Listen to global market data. Chart history lives in its own doc
  // (market/priceHistory) and is fetched ONCE below — the live subscription
  // only carries the small prices doc, so every price tick no longer pushes
  // the full chart history for every stock to every player.
  const prevPricesRef = useRef(null);
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
        setMarketData(data);
        setLaunchedTickers(launched);

        // Extend local chart history from live ticks (the server appends the
        // same points to market/priceHistory; these local ones just keep the
        // charts moving without re-downloading history).
        const prev = prevPricesRef.current;
        if (prev) {
          const ts = Date.now();
          const changed = Object.entries(mergedPrices)
            .filter(([t, p]) => prev[t] !== undefined && prev[t] !== p);
          if (changed.length > 0) {
            setPriceHistory(prevHist => {
              const next = { ...prevHist };
              changed.forEach(([t, p]) => {
                next[t] = [...(next[t] || []), { timestamp: ts, price: p }].slice(-2000);
              });
              return next;
            });
          }
        }
        prevPricesRef.current = mergedPrices;
      } else {
        // Market doc missing (fresh environment) — show base prices; the
        // backend owns market initialization.
        const initialPrices = {};
        CHARACTERS.forEach(c => {
          if (!c.ipoRequired) initialPrices[c.ticker] = c.basePrice;
        });
        setPrices(initialPrices);
        setLaunchedTickers([]);
      }
    });

    return () => unsubscribe();
  }, []);

  // Listen to dividend tier overrides (admin-editable config doc)
  useEffect(() => {
    const ref = doc(db, 'dividendConfig', 'tierOverrides');
    const unsubscribe = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        setDividendTierOverrides(snap.data().tiers || {});
      } else {
        setDividendTierOverrides({});
      }
    }, (err) => {
      // Missing doc is fine — fall back to hardcoded defaults.
      console.warn('dividendConfig/tierOverrides subscription:', err?.message);
    });
    return () => unsubscribe();
  }, []);

  // Fetch chart history once per session from its own doc. Live ticks keep it
  // current locally (see the market subscription above); merging preserves any
  // points that arrived before this fetch resolved.
  useEffect(() => {
    let cancelled = false;
    getDoc(doc(db, 'market', 'priceHistory'))
      .then(snap => {
        if (cancelled || !snap.exists()) return;
        const fetched = snap.data() || {};
        setPriceHistory(prevLocal => {
          const merged = {};
          const tickers = new Set([...Object.keys(fetched), ...Object.keys(prevLocal)]);
          tickers.forEach(t => {
            const base = Array.isArray(fetched[t]) ? fetched[t] : [];
            const seen = new Set(base.map(p => p.timestamp));
            const extra = (prevLocal[t] || []).filter(p => !seen.has(p.timestamp));
            merged[t] = [...base, ...extra].sort((a, b) => a.timestamp - b.timestamp);
          });
          return merged;
        });
      })
      .catch(err => console.error('Failed to load price history:', err));
    return () => { cancelled = true; };
  }, []);

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
          const inBuyingPhase = now >= ipo.ipoStartsAt && now < ipo.ipoEndsAt && (ipo.sharesRemaining ?? (ipo.totalShares || IPO_TOTAL_SHARES)) > 0;
          return inHypePhase || inBuyingPhase;
        });
        
        setActiveIPOs(activeOnes);

      }
    });

    return () => unsubscribe();
  }, []);

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
            // Win surfaces as a persistent bell notification (written server-side), not a toast
            console.log(`[Payout] Processed winning bet for prediction ${prediction.id}: +${payout}`);
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
    const etfFlag = asset?.isETF || false;

    // Calculate estimated total (with new-account impact reduction)
    const ageFactor = getAccountAgeImpactFactor(userData);
    let total = price * amount;
    if (action === 'buy') {
      const priceImpact = calculatePriceImpactDollars(price, amount) * ageFactor;
      const { ask } = getBidAskPrices(price + priceImpact, etfFlag);
      total = ask * amount;
    } else if (action === 'sell') {
      const priceImpact = calculatePriceImpactDollars(price, amount) * ageFactor;
      const { bid } = getBidAskPrices(Math.max(MIN_PRICE, price - priceImpact), etfFlag);
      total = bid * amount;
    } else if (action === 'short') {
      const priceImpact = calculatePriceImpactDollars(price, amount) * ageFactor;
      const { bid } = getBidAskPrices(Math.max(MIN_PRICE, price - priceImpact), etfFlag);
      total = bid * amount * 0.5; // margin cost only
    } else if (action === 'cover') {
      const priceImpact = calculatePriceImpactDollars(price, amount) * ageFactor;
      const { ask } = getBidAskPrices(price + priceImpact, etfFlag);
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
  }, [user, userData, prices, activeIPOs, launchedTickers, showNotification, setTradeConfirmation]);

  // Watchlist toggle
  const toggleWatchlist = useCallback(async (ticker) => {
    if (!user || !userData) return;
    const current = userData.watchlist || [];
    const updated = current.includes(ticker)
      ? current.filter(t => t !== ticker)
      : [...current, ticker];
    try {
      await updateDoc(doc(db, 'users', user.uid), { watchlist: updated });
    } catch (err) {
      console.error('Failed to update watchlist:', err);
    }
  }, [user, userData]);

  // Handle limit order request from portfolio
  const handleLimitOrderRequest = useCallback((ticker, action, mode) => {
    if (!user || !userData) {
      showNotification('info', 'Sign in to start trading!');
      return;
    }
    setLimitOrderRequest({ ticker, action, mode: mode || 'limit' });
    setShowPortfolio(false); // Close portfolio modal
  }, [user, userData, showNotification, setLimitOrderRequest, setShowPortfolio]);


  // Sync portfolio value, history, and achievements via Cloud Function
  // (these fields are blocked from client-side writes by security rules).
  // Debounced, with a minimum interval: the sync's own write updates userData,
  // which re-arms this effect — without the floor every active client would
  // call the backend roughly every 30 seconds for the whole session.
  const lastPortfolioSyncRef = useRef(0);
  useEffect(() => {
    if (!user || !userData || Object.keys(prices).length === 0) return;

    const timeout = setTimeout(async () => {
      if (Date.now() - lastPortfolioSyncRef.current < PORTFOLIO_SYNC_MIN_INTERVAL_MS) return;
      lastPortfolioSyncRef.current = Date.now();
      try {
        await syncPortfolioFunction();
      } catch (error) {
        console.error('[PORTFOLIO SYNC ERROR]', error);
      }
    }, 30000);

    return () => clearTimeout(timeout);
  }, [user, userData, prices]);

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
    // Deliberately narrow deps: re-check only when the margin fields change,
    // not on every userData write (holdings, missions, etc. update constantly).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, userData?.marginEnabled, userData?.marginUsed, userData?.lastMarginInterestCharge]);

  // Bankruptcy notification system - remind every 5 minutes
  useEffect(() => {
    if (!user || !userData) return;

    const cash = userData.cash || 0;
    if (cash >= 0) return; // cash is fine

    const showBankruptcyReminder = () => {
      const debtAmount = Math.abs(cash);
      if (userData.isBankrupt) {
        showNotification('warning', `💸 You're wiped out and ${formatCurrency(debtAmount)} in debt. You can take a bailout to restart with ${formatCurrency(BAILOUT_CASH)}, but it clears your holdings and exiles you from your crew.`);
      } else {
        showNotification('warning', `💸 You're ${formatCurrency(debtAmount)} short on cash. Sell or close a position to free up funds.`);
      }
    };

    // Show immediately on login/becoming bankrupt
    showBankruptcyReminder();

    // Then every 5 minutes
    const interval = setInterval(showBankruptcyReminder, 5 * 60 * 1000);

    return () => clearInterval(interval);
    // Deliberately narrow deps: the 5-minute reminder should re-arm only when
    // cash changes, not on every userData write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, userData?.cash, showNotification]);

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
  }, [user, showNotification]);

  // DRIP toggle
  const handleToggleDrip = useCallback(async (ticker) => {
    if (!user) return;
    const userRef = doc(db, 'users', user.uid);
    const isEnabled = !!(userData?.drip?.[ticker]);
    await updateDoc(userRef, { [`drip.${ticker}`]: isEnabled ? deleteField() : true });
  }, [user, userData]);

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

  const handleMarginTutorialComplete = async () => {
    if (!user) return;
    await updateDoc(doc(db, 'users', user.uid), { marginTutorialCompleted: true });
  };

  // Guest data
  const guestData = { cash: UNVERIFIED_STARTING_CASH, holdings: {}, shorts: {}, costBasis: {}, bets: {}, portfolioValue: UNVERIFIED_STARTING_CASH };
  const activeUserData = userData || guestData;
  const isGuest = !user;

  // Get user's bet for a prediction

  const portfolioValue = calculatePortfolioValue(activeUserData, prices);

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

  // Detect chapter review changes from most recent Thursday halt window
  const reviewChanges = useMemo(() => {
    return getReviewChanges(priceHistory, CHARACTERS);
  }, [priceHistory]);

  const hasReviewChanges = Object.keys(reviewChanges).length > 0;

  // Build crew membership lookup for crew filter
  const crewMembershipMap = useMemo(() => {
    const map = {};
    Object.values(CREWS).forEach(crew => {
      crew.members.forEach(ticker => {
        if (!map[ticker]) map[ticker] = [];
        map[ticker].push(crew.id);
      });
    });
    return map;
  }, []);

  // Filter and sort
  const filteredCharacters = useMemo(() => {
    let filtered = CHARACTERS.filter(c => {
      // Tab filters
      if (marketTab === 'review') {
        if (!reviewChanges[c.ticker]) return false;
      } else if (marketTab === 'watchlist') {
        const watchlist = userData?.watchlist || [];
        if (!watchlist.includes(c.ticker)) return false;
      } else {
        if (marketTab === 'etfs' && !c.isETF) return false;
        if (marketTab === 'stocks' && c.isETF) return false;
      }

      // Crew filter
      if (crewFilter !== 'ALL') {
        const crews = crewMembershipMap[c.ticker] || [];
        if (!crews.includes(crewFilter)) return false;
      }

      // Search filter
      const q = searchQuery.toLowerCase();
      const matchesSearch = c.name.toLowerCase().includes(q) ||
        c.ticker.toLowerCase().includes(q) ||
        (c.altNames || []).some(n => n.toLowerCase().includes(q));
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

    // Review tab defaults to biggest absolute % change
    if (marketTab === 'review' && sortBy === 'price-high') {
      filtered.sort((a, b) => Math.abs(reviewChanges[b.ticker]?.percentChange || 0) - Math.abs(reviewChanges[a.ticker]?.percentChange || 0));
      return filtered;
    }

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
  }, [searchQuery, sortBy, prices, priceHistory, get24hChange, ipoRestrictedTickers, launchedTickers, marketTab, userData?.watchlist, crewFilter, crewMembershipMap, reviewChanges]);

  // Floor at 1 so an empty result set shows "1/1", not "1/0".
  const totalPages = Math.max(1, Math.ceil(filteredCharacters.length / ITEMS_PER_PAGE));
  const displayedCharacters = showAll ? filteredCharacters : filteredCharacters.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  // Styling - Orange/Yellow theme inspired by logo
  const { bgClass, cardClass, mutedClass, borderClass, inputClass: inputClassStyle, ghostBtnClass, raisedClass } = getThemeClasses(darkMode);
  const textClass = darkMode ? 'text-zinc-100' : 'text-zinc-900';

  // Rarity tiers by market standing — computed once here so every card shares the
  // same ranking instead of each re-ranking the whole roster. See utils/rarity.js.
  const rarityTiers = useMemo(() => computeRarityTiers(CHARACTERS, prices), [prices]);

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
    launchedTickers,
    rarityTiers
  }), [darkMode, user, userData, prices, priceHistory, predictions, marketData, getColorBlindColors, showNotification, activeIPOs, ipoRestrictedTickers, launchedTickers, rarityTiers]);

  if (loading) {
    return (
      <div className={`min-h-screen ${bgClass} flex items-center justify-center`}>
        <div className={`text-lg ${mutedClass}`}>Loading Stockism...</div>
      </div>
    );
  }

  return (
    <AppProvider value={contextValue}>
      <DiscordWallModal />
      <Layout
        setDarkMode={handleToggleDarkMode}
        onShowAdminPanel={() => setShowAdmin(true)}
        isGuest={isGuest}
        onShowLogin={() => setShowLoginModal(true)}
        notificationCount={userNotifications.filter(n => !n.read).length}
        onToggleNotifications={() => setShowNotificationPanel(prev => !prev)}
        newCharacters={newCharactersWithData}
      >
          {showInAppBanner && (
            <div className={`mx-4 mt-3 p-3 rounded-sm border text-sm flex items-center justify-between gap-2 ${
              darkMode ? 'bg-amber-900/30 border-amber-700 text-amber-200' : 'bg-amber-50 border-amber-300 text-amber-800'
            }`}>
              <span>For the best experience, open this page in your browser. Trading may not work in this app.</span>
              <button onClick={() => setShowInAppBanner(false)} className="shrink-0 font-bold text-lg leading-none opacity-60 hover:opacity-100">&times;</button>
            </div>
          )}
          <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" /></div>}>
          <ErrorBoundary>
          <Routes>
            <Route path="/" element={
              <div className={`min-h-screen ${bgClass} p-4`}>
                <div className="max-w-6xl lg:max-w-none mx-auto">
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
                        🎨 Customization
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

                  {/* Short margin warning — highest-stakes alert, keep at the top */}
                  <ShortRiskAlert onOpenPortfolio={() => setShowPortfolio(true)} />

                  {/* IPO Announcements */}
        {activeIPOs.length > 0 && (
          <div className="mb-4">
            <h2 className={`text-sm font-semibold uppercase tracking-wide mb-3 ${mutedClass}`}>🚀 IPO</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {activeIPOs.map(ipo => {
                const now = Date.now();
                const inHypePhase = now < ipo.ipoStartsAt;
                
                return inHypePhase ? (
                  <IPOHypeCard key={ipo.ticker} ipo={ipo} />
                ) : (
                  <IPOActiveCard
                    key={ipo.ticker}
                    ipo={ipo}
                    onBuyIPO={handleBuyIPO}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Desktop: market fills the left, dashboard rail pinned on the right with
            its own scroll. Mobile/tablet: everything stacks exactly as before
            (DOM order = mobile order; the order classes flip it on desktop). */}
        <div className="lg:flex lg:items-start lg:gap-6">
        <aside className="lg:order-2 lg:w-96 2xl:w-[30rem] lg:shrink-0 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pl-1">

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-1 gap-4 mb-4">
          <div className={`${cardClass} border rounded-sm p-4 ${(activeUserData.cash || 0) < 0 ? (userData?.colorBlindMode ? 'border-purple-500' : 'border-red-500') : ''}`}>
            <p className={`text-xs font-semibold uppercase ${mutedClass}`}>Cash</p>
            <p className={`text-2xl font-bold ${(activeUserData.cash || 0) < 0 ? (userData?.colorBlindMode ? 'text-purple-500' : 'text-red-500') : isGuest ? mutedClass : textClass}`}>
              {(activeUserData.cash || 0) < 0 ? '-' : ''}{formatCurrency(Math.abs(activeUserData.cash || 0))}
            </p>
            {isGuest && (
              <p className={`text-xs ${mutedClass}`}>Your starting cash when you sign up</p>
            )}
            {(activeUserData.cash || 0) < 0 && !activeUserData.isBankrupt && (
              <p className="mt-2 text-xs text-amber-500">
                Sell or close a position to clear this.
              </p>
            )}
            {activeUserData.isBankrupt && (
              <button
                onClick={() => setShowBailout(true)}
                className={`mt-2 w-full py-1.5 text-xs font-semibold rounded-sm text-white ${userData?.colorBlindMode ? 'bg-purple-600 hover:bg-purple-700' : 'bg-red-600 hover:bg-red-700'}`}
              >
                💸 Wiped Out - Request Bailout
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
              checkinStreak={userData?.checkinStreak || 0}
              onCheckin={handleDailyCheckin}
              onSignIn={() => setShowLoginModal(true)}
              darkMode={darkMode}
              loading={actionLoading.checkin}
            />
          </div>
          <div className={`${cardClass} border rounded-sm p-4 cursor-pointer hover:border-orange-600`} onClick={() => !isGuest && setShowPortfolio(true)}>
            <p className={`text-xs font-semibold uppercase ${mutedClass}`}>Portfolio Value</p>
            <p className={`text-2xl font-bold ${textClass}`}>{formatCurrency(portfolioValue)}</p>
            {(() => {
              const snap24h = activeUserData.portfolioSnapshot24h;
              const value24hAgo = snap24h?.value ?? null;

              const change24h = value24hAgo ? portfolioValue - value24hAgo : 0;
              const changePercent24h = value24hAgo && value24hAgo > 0 ? ((change24h / value24hAgo) * 100) : 0;

              const colors24h = getColorBlindColors(change24h >= 0);

              // Rolling 30-day change — far more meaningful than total % since the
              // account started. Uses the approximate 30d reference snapshot.
              const snap30d = activeUserData.portfolioSnapshot30d;
              const value30dAgo = snap30d?.value ?? null;
              const changePercent30d = value30dAgo && value30dAgo > 0 ? (((portfolioValue - value30dAgo) / value30dAgo) * 100) : null;
              const colors30d = getColorBlindColors((changePercent30d ?? 0) >= 0);

              return (
                <>
                  {value24hAgo && (
                    <p className={`text-xs ${colors24h.text}`}>
                      {change24h >= 0 ? '▲' : '▼'} {formatCurrency(Math.abs(change24h))} ({formatChange(changePercent24h)}) 24h
                    </p>
                  )}
                  <p className={`text-xs ${changePercent30d != null ? colors30d.text : mutedClass}`}>
                    {changePercent30d != null && (changePercent30d >= 0 ? '▲ ' : '▼ ')}
                    {changePercent30d != null ? `${formatChange(changePercent30d)} 30d` : ''}
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

        <PredictionsTeaser predictions={predictions} />

        <MarketIndex
          prices={prices}
          priceHistory={priceHistory}
          darkMode={darkMode}
          colorBlindMode={userData?.colorBlindMode}
        />

        </aside>

        {/* Market column */}
        <div className="lg:order-1 flex-1 min-w-0">

        {/* Market Tab Toggle */}
        <div className="flex flex-wrap gap-2 mb-3">
          <button
            onClick={() => { setMarketTab('stocks'); setCurrentPage(1); setSearchQuery(''); }}
            className={`px-4 py-2 text-sm font-semibold rounded-sm transition-all ${
              marketTab === 'stocks'
                ? 'bg-amber-500 text-white'
                : `border ${ghostBtnClass}`
            }`}
          >
            Stocks
          </button>
          <button
            onClick={() => { setMarketTab('etfs'); setCurrentPage(1); setSearchQuery(''); }}
            className={`px-4 py-2 text-sm font-semibold rounded-sm transition-all ${
              marketTab === 'etfs'
                ? 'bg-purple-600 text-white'
                : `border ${ghostBtnClass}`
            }`}
          >
            ETFs
          </button>
          {user && userData && (
            <button
              onClick={() => { setMarketTab('watchlist'); setCurrentPage(1); setSearchQuery(''); }}
              className={`px-4 py-2 text-sm font-semibold rounded-sm transition-all ${
                marketTab === 'watchlist'
                  ? 'bg-yellow-500 text-white'
                  : `border ${ghostBtnClass}`
              }`}
            >
              Watchlist
            </button>
          )}
          {hasReviewChanges && (
            <button
              onClick={() => { setMarketTab('review'); setCurrentPage(1); setSearchQuery(''); setSortBy('price-high'); }}
              className={`px-4 py-2 text-sm font-semibold rounded-sm transition-all ${
                marketTab === 'review'
                  ? 'bg-emerald-600 text-white'
                  : `border ${darkMode ? 'border-emerald-800 text-emerald-400 hover:bg-zinc-800' : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'}`
              }`}
            >
              Review ({Object.keys(reviewChanges).length})
            </button>
          )}
        </div>

        {/* Crew Filter */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          <button
            onClick={() => { setCrewFilter('ALL'); setCurrentPage(1); }}
            className={`px-2.5 py-1 text-xs rounded-full font-semibold transition-colors ${
              crewFilter === 'ALL'
                ? 'bg-orange-600 text-white'
                : darkMode ? 'bg-zinc-800 text-zinc-300' : 'bg-slate-200 text-zinc-600'
            }`}
          >
            All Crews
          </button>
          {user && userData?.crew && (
            <button
              onClick={() => { setCrewFilter(userData.crew); setCurrentPage(1); }}
              className={`px-2.5 py-1 text-xs rounded-full font-semibold transition-colors ${
                crewFilter === userData.crew
                  ? 'text-white'
                  : darkMode ? 'bg-zinc-800 text-zinc-300' : 'bg-slate-200 text-zinc-600'
              }`}
              style={crewFilter === userData.crew ? { backgroundColor: CREW_MAP[userData.crew]?.color || '#f97316' } : {}}
            >
              My Crew
            </button>
          )}
          {Object.values(CREWS).map(crew => (
            <button
              key={crew.id}
              onClick={() => { setCrewFilter(crew.id); setCurrentPage(1); }}
              className={`px-2.5 py-1 text-xs rounded-full font-semibold flex items-center gap-1 transition-colors ${
                crewFilter === crew.id
                  ? 'text-white'
                  : darkMode ? 'bg-zinc-800 text-zinc-300' : 'bg-slate-200 text-zinc-600'
              }`}
              style={crewFilter === crew.id ? { backgroundColor: crew.color, color: crew.color === '#FFFFFF' || crew.color === '#f3c404' || crew.color === '#f3c803' ? '#000' : '#fff' } : {}}
            >
              {crew.icon ? (
                <img src={crew.icon} alt="" className="w-3.5 h-3.5 rounded-full object-cover" />
              ) : (
                <span>{crew.emblem}</span>
              )}
              <span className="hidden sm:inline">{crew.name}</span>
            </button>
          ))}
        </div>

        {/* Controls */}
        <div className={`${cardClass} ${raisedClass} border rounded-sm p-4 mb-4`}>
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
                className={`px-3 py-2 text-sm rounded-sm border ${ghostBtnClass} disabled:opacity-50`}>
                Prev
              </button>
              <span className={`text-sm ${mutedClass}`}>{currentPage}/{totalPages}</span>
              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={showAll || currentPage === totalPages}
                className={`px-3 py-2 text-sm rounded-sm border ${ghostBtnClass} disabled:opacity-50`}>
                Next
              </button>
            </div>
            <button onClick={() => setShowAll(!showAll)}
              className={`px-3 py-2 text-sm font-semibold rounded-sm ${showAll ? 'bg-amber-500 text-white' : `border ${ghostBtnClass}`}`}>
              {showAll ? 'Show Pages' : 'Show All'}
            </button>
          </div>
        </div>

        {/* Character Grid — auto-fills as many ~300px+ columns as the screen allows */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
          {displayedCharacters.map(character => (
            <CharacterCard
              key={character.ticker}
              character={character}
              price={(() => {
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
              userCash={activeUserData.cash || 0}
              limitOrderRequest={limitOrderRequest}
              onClearLimitOrderRequest={() => setLimitOrderRequest(null)}
              isWatchlisted={(userData?.watchlist || []).includes(character.ticker)}
              onToggleWatchlist={toggleWatchlist}
              tradeAnimation={tradeAnimation?.ticker === character.ticker ? tradeAnimation : null}
              haltInfo={marketData?.haltedTickers?.[character.ticker]}
              onSetAlert={(ticker) => setShowPriceAlertModal(ticker)}
            />
          ))}
        </div>

        {/* Empty state for the grid */}
        {displayedCharacters.length === 0 && (
          <div className={`${cardClass} border rounded-sm p-8 text-center`}>
            <p className={`text-sm ${mutedClass}`}>
              {marketTab === 'watchlist' && !searchQuery
                ? 'Your watchlist is empty. Tap the ☆ on any character to add it.'
                : 'No characters match your search.'}
            </p>
          </div>
        )}

        {/* Bottom Pagination */}
        {!showAll && totalPages > 1 && (
          <div className={`${cardClass} border rounded-sm p-4 mt-4`}>
            <div className="flex justify-center items-center gap-4">
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                className={`px-4 py-2 text-sm font-semibold rounded-sm border ${ghostBtnClass} disabled:opacity-50`}>
                Previous
              </button>
              <span className={`text-sm ${mutedClass}`}>Page {currentPage} of {totalPages}</span>
              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
                className={`px-4 py-2 text-sm font-semibold rounded-sm border ${ghostBtnClass} disabled:opacity-50`}>
                Next
              </button>
            </div>
          </div>
        )}

        </div>
        </div>
                </div>
              </div>
            } />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="/achievements" element={<AchievementsPage />} />
            <Route path="/ladder" element={<LadderPage />} />
            <Route path="/predictions" element={
              <PredictionsPage
                predictions={predictions}
                isGuest={isGuest}
                isAdmin={user && ADMIN_UIDS.includes(user.uid)}
                onBet={handleBet}
                onRequestBet={(predictionId, option, amount, question) => setBetConfirmation({ predictionId, option, amount, question })}
                onHidePrediction={handleHidePrediction}
                onBuyEventShares={handleBuyEventShares}
                onSellEventShares={handleSellEventShares}
              />
            } />
            <Route path="/profile" element={<ProfilePage onOpenCrewSelection={() => setShowCrewSelection(true)} onDeleteAccount={handleDeleteAccount} />} />
            <Route path="/link-discord" element={<DiscordLinkRedirect user={user} darkMode={darkMode} bgClass={bgClass} setShowLoginModal={setShowLoginModal} />} />
            <Route path="/u/:username" element={<PublicProfilePage />} />
            <Route path="/stock/:ticker" element={<StockPage onTrade={requestTrade} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </ErrorBoundary>
          </Suspense>

          {/* Global Modals - rendered outside Routes */}
          {/* Suspense: lazy modals show nothing while their chunk loads (acceptable — they need a user action first) */}
          <Suspense fallback={null}>
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
                  // Subscribe to changes (clean up any existing listener first)
                  userDataUnsubscribeRef.current?.();
                  userDataUnsubscribeRef.current = onSnapshot(userDocRef, (snap) => {
                    if (snap.exists()) setUserData(snap.data());
                  });
                }
              }}
              darkMode={darkMode}
            />
          )}
          {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
          {showLending && !isGuest && !userData?.marginTutorialCompleted && (
            <MarginTutorialModal
              onClose={() => setShowLending(false)}
              onComplete={handleMarginTutorialComplete}
            />
          )}
          {showLending && !isGuest && userData?.marginTutorialCompleted && (
            <MarginModal
              onClose={() => setShowLending(false)}
              onEnableMargin={handleEnableMargin}
              onDisableMargin={handleDisableMargin}
              onRepayMargin={handleRepayMargin}
              isAdmin={user && ADMIN_UIDS.includes(user.uid)}
              enableLoading={actionLoading.enableMargin}
              disableLoading={actionLoading.disableMargin}
              repayLoading={actionLoading.repayMargin}
              onReviewTutorial={() => setShowMarginTutorialReview(true)}
            />
          )}
          {showMarginTutorialReview && (
            <MarginTutorialModal
              onClose={() => setShowMarginTutorialReview(false)}
              onComplete={() => setShowMarginTutorialReview(false)}
              reviewMode
            />
          )}
          {showCrewSelection && (
        <CrewSelectionModal
          onClose={() => setShowCrewSelection(false)}
          onSelect={handleCrewSelect}
          onLeave={handleCrewLeave}
          isGuest={isGuest}
          leaveLoading={actionLoading.leaveCrew}
          selectLoading={actionLoading.selectCrew}
        />
      )}
      {showPinShop && !isGuest && (
        <PinShopModal
          onClose={() => setShowPinShop(false)}
          onPurchase={handlePinAction}
          onPurchaseCosmetic={handlePurchaseCosmetic}
          onEquipCosmetic={handleEquipCosmetic}
          purchaseLoading={actionLoading.pinAction}
        />
      )}
      {showDailyMissions && (
        <DailyMissionsModal
          onClose={() => setShowDailyMissions(false)}
          onClaimReward={handleClaimMissionReward}
          onClaimWeeklyReward={handleClaimWeeklyMissionReward}
          onOpenCrewSelection={() => setShowCrewSelection(true)}
          portfolioValue={portfolioValue}
          isGuest={isGuest}
          claimLoading={actionLoading.claimMission}
          claimWeeklyLoading={actionLoading.claimWeeklyMission}
          onRerollMissions={handleRerollMissions}
          rerollLoading={actionLoading.rerollMissions}
        />
      )}
      {showBailout && !isGuest && userData?.isBankrupt && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={() => setShowBailout(false)}>
          <div
            className={`w-full max-w-md ${cardClass} border rounded-sm shadow-xl p-6`}
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
              <p>Accept a bailout to clear your debt and restart with <strong className={userData?.colorBlindMode ? 'text-teal-500' : 'text-green-500'}>{formatCurrency(BAILOUT_CASH)}</strong>.</p>
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
                className={`flex-1 py-2 rounded-sm border ${ghostBtnClass} disabled:opacity-50`}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  await handleBailout();
                  setShowBailout(false);
                }}
                disabled={actionLoading.bailout}
                className={`flex-1 py-2 rounded-sm text-white font-semibold ${userData?.colorBlindMode ? 'bg-purple-600 hover:bg-purple-700' : 'bg-red-600 hover:bg-red-700'} disabled:opacity-50`}
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
      
      {/* Notification Panel */}
      {showNotificationPanel && user && (
        <NotificationPanel
          darkMode={darkMode}
          notifications={userNotifications}
          onClose={() => setShowNotificationPanel(false)}
          onMarkRead={handleMarkNotificationRead}
          onMarkAllRead={handleMarkAllNotificationsRead}
          onClearAll={handleClearAllNotifications}
          onDelete={handleDeleteNotification}
        />
      )}

      {/* Onboarding Tutorial */}
      {user && userData && !userData.onboardingComplete && (
        <OnboardingTutorial
          onComplete={handleOnboardingComplete}
        />
      )}

      {/* Price Alert Modal */}
      {showPriceAlertModal && (
        <PriceAlertModal
          ticker={showPriceAlertModal}
          currentPrice={prices[showPriceAlertModal] || 0}
          characterName={CHARACTER_MAP[showPriceAlertModal]?.name || showPriceAlertModal}
          darkMode={darkMode}
          onClose={() => setShowPriceAlertModal(null)}
          user={user}
          existingAlerts={priceAlerts.filter(a => a.ticker === showPriceAlertModal)}
          onCreateAlert={handleCreatePriceAlert}
          onDeleteAlert={handleDeletePriceAlert}
        />
      )}

      {/* PWA Install Prompt */}
      <InstallPrompt darkMode={darkMode} />
      
      {/* Toast Notifications */}
      <ToastContainer
        notifications={notifications}
        onDismiss={dismissNotification}
        darkMode={darkMode}
      />
      
      {showPortfolio && !isGuest && (
        <PortfolioModal
          currentValue={portfolioValue}
          onClose={() => setShowPortfolio(false)}
          onTrade={requestTrade}
          onLimitSell={handleLimitOrderRequest}
          onOpenTradeHistory={() => { setShowPortfolio(false); setShowTradeHistory(true); }}
          ipoPurchases={userData?.ipoPurchases || {}}
          holdingCohorts={activeUserData.holdingCohorts || {}}
          dividendTierOverrides={dividendTierOverrides}
          drip={userData?.drip || {}}
          onToggleDrip={handleToggleDrip}
        />
      )}
      {showTradeHistory && !isGuest && (
        <TradeHistoryModal
          onClose={() => setShowTradeHistory(false)}
        />
      )}
      {selectedCharacter && (
        <ChartModal
          character={selectedCharacter.character || selectedCharacter}
          currentPrice={prices[(selectedCharacter.character || selectedCharacter).ticker] || (selectedCharacter.character || selectedCharacter).basePrice}
          onClose={() => setSelectedCharacter(null)}
          defaultTimeRange={selectedCharacter.defaultTimeRange || '1d'}
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
                <span className={`font-semibold ${tradeConfirmation.action === 'buy' || tradeConfirmation.action === 'cover' ? (userData?.colorBlindMode ? 'text-teal-500' : 'text-green-500') : (userData?.colorBlindMode ? 'text-purple-500' : 'text-red-500')}`}>
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
              <div className={`flex justify-between pt-2 border-t ${borderClass}`}>
                <span className="font-semibold">{tradeConfirmation.action === 'short' ? 'Margin Cost:' : tradeConfirmation.action === 'cover' ? (tradeConfirmation.total < 0 ? 'Est. Cost:' : 'Est. Return:') : 'Est. Total:'}</span>
                <span className={`font-bold ${
                  tradeConfirmation.action === 'buy' || tradeConfirmation.action === 'short' || (tradeConfirmation.action === 'cover' && tradeConfirmation.total < 0)
                    ? (userData?.colorBlindMode ? 'text-purple-500' : 'text-red-500') : (userData?.colorBlindMode ? 'text-teal-500' : 'text-green-500')
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
                  tradeConfirmation.action === 'buy' || tradeConfirmation.action === 'cover'
                    ? (userData?.colorBlindMode ? 'bg-teal-600 hover:bg-teal-700' : 'bg-green-600 hover:bg-green-700')
                    : (userData?.colorBlindMode ? 'bg-purple-600 hover:bg-purple-700' : 'bg-red-600 hover:bg-red-700')
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
              <div className={`flex justify-between pt-2 border-t ${borderClass}`}>
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

          </Suspense>
      </Layout>
    </AppProvider>
  );
}
