import * as Sentry from '@sentry/react';
import React, { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
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
  addDoc,
  deleteDoc,
  deleteField
} from 'firebase/firestore';
import { auth, db, deleteAccountFunction, claimPredictionPayoutFunction, chargeMarginInterestFunction, syncPortfolioFunction, createPriceAlertFunction, deletePriceAlertFunction } from './firebase';
import { CHARACTERS, CHARACTER_MAP } from './characters';
import { CREWS, CREW_MAP, getWeekId } from './crews';
import { containsProfanity, getProfanityMessage } from './utils/profanity';
import { isWeeklyHalt, getReviewChanges } from './utils/marketHours';
import LimitOrders from './components/LimitOrders';
import MarketIndex from './components/MarketIndex';
import ErrorBoundary from './components/common/ErrorBoundary';

// Eagerly-loaded modals (shown immediately / on critical auth flows)
import LoginModal from './components/modals/LoginModal';
import UsernameModal from './components/modals/UsernameModal';
import EmailVerificationModal from './components/modals/EmailVerificationModal';

// Lazy-loaded — only downloaded when the user actually opens them
const AdminPanel        = lazy(() => import('./AdminPanel'));
const LadderGame        = lazy(() => import('./components/LadderGame'));
const AboutModal        = lazy(() => import('./components/modals/AboutModal'));
const CrewSelectionModal = lazy(() => import('./components/modals/CrewSelectionModal'));
const PinShopModal      = lazy(() => import('./components/modals/PinShopModal'));
const DailyMissionsModal = lazy(() => import('./components/modals/DailyMissionsModal'));
const AchievementsModal = lazy(() => import('./components/modals/AchievementsModal'));
const MarginModal       = lazy(() => import('./components/modals/MarginModal'));
const MarginTutorialModal = lazy(() => import('./components/modals/MarginTutorialModal'));
const TradeActionModal  = lazy(() => import('./components/modals/TradeActionModal'));
const ChartModal        = lazy(() => import('./components/modals/ChartModal'));
const PortfolioModal    = lazy(() => import('./components/modals/PortfolioModal'));
const TradeHistoryModal = lazy(() => import('./components/modals/TradeHistoryModal'));
const StockPage         = lazy(() => import('./pages/StockPage'));

// Import other components
import CheckInButton from './components/CheckInButton';
import CharacterCard from './components/CharacterCard';
import { ToastNotification, ToastContainer } from './components/ToastNotification';
import NotificationPanel from './components/NotificationPanel';
import OnboardingTutorial from './components/OnboardingTutorial';
import PriceAlertModal from './components/modals/PriceAlertModal';
import PortfolioAnalytics from './components/PortfolioAnalytics';
import InstallPrompt from './components/InstallPrompt';
import NewCharactersBoard from './components/NewCharactersBoard';
import PredictionCard from './components/PredictionCard';
import IPOHypeCard from './components/IPOHypeCard';
import IPOActiveCard from './components/IPOActiveCard';
import { useModalManager } from './hooks/useModalManager';
import { useTradeManagement } from './hooks/useTradeManagement';
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

// Import AppContext
import { AppProvider } from './context/AppContext';
import { getThemeClasses } from './utils/theme';

// Import from new modular structure
import {
  ADMIN_UIDS,
  ITEMS_PER_PAGE,
  STARTING_CASH,
  IPO_TOTAL_SHARES,
  MIN_PRICE,
} from './constants';
import {
  getCurrentPrice,
  getBidAskPrices,
  calculateMarginStatus,
  calculatePortfolioValue,
  calculatePriceImpactDollars,
} from './utils/calculations';
import { formatCurrency, formatChange } from './utils/formatters';
import { toMillis } from './utils/date';


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
// LEADERBOARD MODAL
// ============================================

// LeaderboardModal - now imported from components/modals/



const inputClass = 'bg-zinc-950 border-zinc-700 text-zinc-100';

// ============================================
// MAIN APP
// ============================================

function DiscordLinkRedirect({ user, darkMode, bgClass, setShowLoginModal }) {
  useEffect(() => {
    if (user) {
      window.location.href = `https://discord.com/oauth2/authorize?client_id=1467420774477467752&response_type=code&redirect_uri=${encodeURIComponent('https://us-central1-stockism-abb28.cloudfunctions.net/discordLink')}&scope=identify&state=${user.uid}`;
    }
  }, [user]);

  if (!user) {
    return (
      <div className={`min-h-screen ${bgClass} flex items-center justify-center p-4`}>
        <div className={`max-w-sm w-full p-6 rounded-sm border text-center ${darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200'}`}>
          <p className={`text-lg font-semibold mb-3 ${darkMode ? 'text-zinc-100' : 'text-slate-900'}`}>Link Your Discord</p>
          <p className={`text-sm mb-4 ${darkMode ? 'text-zinc-400' : 'text-zinc-600'}`}>Log into Stockism first, then come back to this page.</p>
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
      <p className={darkMode ? 'text-zinc-400' : 'text-zinc-600'}>Redirecting to Discord...</p>
    </div>
  );
}

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
    showPredictions, setShowPredictions,
    showPriceAlertModal, setShowPriceAlertModal,
    tradeConfirmation, setTradeConfirmation,
    limitOrderRequest, setLimitOrderRequest,
    betConfirmation, setBetConfirmation,
    selectedCharacter, setSelectedCharacter,
  } = useModalManager();

  const [tradeAnimation, setTradeAnimation] = useState(null); // { ticker, action, timestamp }
  const [notifications, setNotifications] = useState([]); // Toast notification queue
  const [showMarginTutorialReview, setShowMarginTutorialReview] = useState(false);

  // Business-logic hooks — each owns one feature domain
  const { handleTrade } = useTradeManagement({ setLoadingKey, setTradeAnimation });
  const { handleClaimMissionReward, handleRerollMissions, handleClaimWeeklyMissionReward } = useMissionManagement({ setUserData, setLoadingKey });
  const { handleEnableMargin, handleDisableMargin, handleRepayMargin } = useMarginManagement({ setUserData, setLoadingKey, setShowLending });
  const { handleCrewSelect, handleCrewLeave } = useCrewManagement({ setUserData, setLoadingKey });
  const { handleBet } = usePredictionManagement({ setUserData, setLoadingKey });
  const { handleBuyIPO } = useIPOManagement({ setUserData, setLoadingKey });
  const { handleDailyCheckin, handleBailout } = useDailyOperations({ setUserData, setLoadingKey });
  const { handlePinAction, handlePurchaseCosmetic, handleEquipCosmetic } = usePinShop({ setUserData, setLoadingKey });

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

  // Notification handlers
  const handleMarkNotificationRead = useCallback(async (notificationId) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'users', user.uid, 'notifications', notificationId), { read: true });
    } catch (err) {
      console.error('Failed to mark notification read:', err);
    }
  }, [user]);

  const handleMarkAllNotificationsRead = useCallback(async () => {
    if (!user) return;
    try {
      const batch = [];
      for (const n of userNotifications.filter(n => !n.read)) {
        batch.push(updateDoc(doc(db, 'users', user.uid, 'notifications', n.id), { read: true }));
      }
      await Promise.all(batch);
    } catch (err) {
      console.error('Failed to mark all read:', err);
    }
  }, [user, userNotifications]);

  const handleClearAllNotifications = useCallback(async () => {
    if (!user) return;
    try {
      const promises = userNotifications.map(n =>
        deleteDoc(doc(db, 'users', user.uid, 'notifications', n.id))
      );
      await Promise.all(promises);
    } catch (err) {
      console.error('Failed to clear notifications:', err);
    }
  }, [user, userNotifications]);

  const handleCreatePriceAlert = useCallback(async ({ ticker, targetPrice, direction }) => {
    try {
      await createPriceAlertFunction({ ticker, targetPrice, direction });
      showNotification('success', `Price alert set for $${ticker}`);
    } catch (err) {
      showNotification('error', err.message || 'Failed to create alert');
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
      alert('Discord sign-in failed. Please try again or use a different sign-in method.');
      window.history.replaceState({}, document.title, window.location.pathname);
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
  }, [user, userData, prices, activeIPOs, launchedTickers, showNotification]);

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
  }, [user, userData, showNotification]);


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

  // DRIP toggle
  const handleToggleDrip = useCallback(async (ticker) => {
    if (!user) return;
    const userRef = doc(db, 'users', user.uid);
    const isEnabled = !!(userData?.drip?.[ticker]);
    await updateDoc(userRef, { [`drip.${ticker}`]: isEnabled ? deleteField() : true });
  }, [user, userData]);

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

  const handleMarginTutorialComplete = async () => {
    if (!user) return;
    await updateDoc(doc(db, 'users', user.uid), { marginTutorialCompleted: true });
  };

  // Guest data
  const guestData = { cash: STARTING_CASH, holdings: {}, shorts: {}, costBasis: {}, bets: {}, portfolioValue: STARTING_CASH };
  const activeUserData = userData || guestData;
  const isGuest = !user;

  // Get user's bet for a prediction
  const getUserBet = (predictionId) => activeUserData.bets?.[predictionId] || null;

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
  }, [searchQuery, sortBy, prices, priceHistory, get24hChange, activeIPOs, ipoRestrictedTickers, launchedTickers, marketTab, userData?.watchlist, crewFilter, crewMembershipMap, reviewChanges]);

  const totalPages = Math.ceil(filteredCharacters.length / ITEMS_PER_PAGE);
  const displayedCharacters = showAll ? filteredCharacters : filteredCharacters.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  // Styling - Orange/Yellow theme inspired by logo
  const { bgClass, cardClass, mutedClass, inputClass: inputClassStyle } = getThemeClasses(darkMode);
  const textClass = darkMode ? 'text-zinc-100' : 'text-zinc-900';

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

        {/* Weekly Predictions */}
        {predictions.length > 0 && (
          <div className="mb-4">
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
            {showPredictions && (() => {
              const visiblePredictions = predictions.filter(p => !p.hidden && (!p.resolved || Date.now() - p.endsAt < 7 * 24 * 60 * 60 * 1000)).slice(0, 4);
              const colClass = [
                'grid-cols-1',
                'grid-cols-1 sm:grid-cols-2',
                'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
                'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
              ][visiblePredictions.length - 1] || 'grid-cols-1';
              return (
              <div className={`grid ${colClass} gap-4 animate-fadeIn`}>
                {visiblePredictions.map(prediction => {
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
                      isGuest={isGuest}
                      betLimit={betLimit}
                      isAdmin={user && ADMIN_UIDS.includes(user.uid)}
                      onHide={handleHidePrediction}
                    />
                  );
                })}
              </div>
              );
            })()}
          </div>
        )}

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
              const snap24h = activeUserData.portfolioSnapshot24h;
              const value24hAgo = snap24h?.value ?? null;

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

        <MarketIndex
          prices={prices}
          priceHistory={priceHistory}
          darkMode={darkMode}
          colorBlindMode={userData?.colorBlindMode}
        />

        {/* Market Tab Toggle */}
        <div className="flex flex-wrap gap-2 mb-3">
          <button
            onClick={() => { setMarketTab('stocks'); setCurrentPage(1); setSearchQuery(''); }}
            className={`px-4 py-2 text-sm font-semibold rounded-sm transition-all ${
              marketTab === 'stocks'
                ? 'bg-amber-500 text-white'
                : `border ${darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 text-zinc-600 hover:bg-amber-50'}`
            }`}
          >
            Stocks
          </button>
          <button
            onClick={() => { setMarketTab('etfs'); setCurrentPage(1); setSearchQuery(''); }}
            className={`px-4 py-2 text-sm font-semibold rounded-sm transition-all ${
              marketTab === 'etfs'
                ? 'bg-purple-600 text-white'
                : `border ${darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 text-zinc-600 hover:bg-amber-50'}`
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
                  : `border ${darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 text-zinc-600 hover:bg-amber-50'}`
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
                  // Subscribe to changes
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
          portfolioValue={portfolioValue}
          isGuest={isGuest}
          claimLoading={actionLoading.claimMission}
          claimWeeklyLoading={actionLoading.claimWeeklyMission}
          onRerollMissions={handleRerollMissions}
          rerollLoading={actionLoading.rerollMissions}
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
      
      {/* Notification Panel */}
      {showNotificationPanel && user && (
        <NotificationPanel
          darkMode={darkMode}
          notifications={userNotifications}
          onClose={() => setShowNotificationPanel(false)}
          onMarkRead={handleMarkNotificationRead}
          onMarkAllRead={handleMarkAllNotificationsRead}
          onClearAll={handleClearAllNotifications}
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
              <div className={`flex justify-between pt-2 border-t ${darkMode ? 'border-zinc-700' : 'border-amber-200'}`}>
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

          </Suspense>
      </Layout>
    </AppProvider>
  );
}
