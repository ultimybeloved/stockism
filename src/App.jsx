import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { doc, getDoc, updateDoc, deleteField } from 'firebase/firestore';
import { db, deleteAccountFunction, claimPredictionPayoutFunction, chargeMarginInterestFunction, syncPortfolioFunction } from './firebase';
import { CHARACTERS, CHARACTER_MAP } from './characters';
import { computeRarityTiers } from './utils/rarity';
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
import { ToastContainer } from './components/ToastNotification';
import NotificationPanel from './components/NotificationPanel';
import OnboardingTutorial from './components/OnboardingTutorial';
import PriceAlertModal from './components/modals/PriceAlertModal';
import TradeConfirmModal from './components/modals/TradeConfirmModal';
import BetConfirmModal from './components/modals/BetConfirmModal';
import BailoutModal from './components/modals/BailoutModal';
import InstallPrompt from './components/InstallPrompt';
import { useModalManager } from './hooks/useModalManager';
import { useAuthUser } from './hooks/useAuthUser';
import { useMarketData } from './hooks/useMarketData';
import { useUserAlerts } from './hooks/useUserAlerts';
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
import HomePage from './pages/HomePage';
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
  UNVERIFIED_STARTING_CASH,
  BAILOUT_CASH,
  PORTFOLIO_SYNC_MIN_INTERVAL_MS,
} from './constants';
import { calculatePortfolioValue } from './utils/calculations';
import { formatCurrency } from './utils/formatters';
import { getWeekStart } from './utils/date';


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

export default function App() {
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
  // Helper to show toast notification
  const showNotification = useCallback((type, message, image = null) => {
    const id = Date.now() + Math.random();
    setNotifications(prev => [...prev, { id, type, message, image }].slice(-5)); // Max 5 toasts
  }, []);

  // Helper to dismiss notification
  const dismissNotification = useCallback((id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  // Auth state + user doc subscription (and auth-adjacent URL flows)
  const { user, userData, setUserData, needsUsername, needsEmailVerification, loading, adoptUserDoc } = useAuthUser({ setDarkMode, showNotification });

  // Global market subscriptions: prices, chart history, IPOs, predictions
  const { prices, priceHistory, marketData, dividendTierOverrides, launchedTickers, activeIPOs, predictions } = useMarketData();

  // Bell notifications + price alerts (subscriptions and handlers)
  const {
    userNotifications, priceAlerts,
    handleMarkNotificationRead, handleMarkAllNotificationsRead,
    handleClearAllNotifications, handleDeleteNotification,
    handleCreatePriceAlert, handleDeletePriceAlert,
  } = useUserAlerts({ user, showNotification });

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

  // Business-logic hooks — called here, after showNotification + all state are defined  // Business-logic hooks — called here, after showNotification + all state are defined
  // These receive state directly because App.jsx IS the context provider (can't consume its own context)
  const { handleClaimMissionReward, handleRerollMissions, handleClaimWeeklyMissionReward } = useMissionManagement({ user, userData, showNotification, setUserData, setLoadingKey });
  const { handleEnableMargin, handleDisableMargin, handleRepayMargin } = useMarginManagement({ user, userData, showNotification, setUserData, setLoadingKey, setShowLending });
  const { handleCrewSelect, handleCrewLeave } = useCrewManagement({ user, userData, showNotification, setUserData, setLoadingKey });
  const { handleBet, handleBuyEventShares, handleSellEventShares } = usePredictionManagement({ user, userData, predictions, showNotification, setUserData, setLoadingKey });
  const { handleBuyIPO } = useIPOManagement({ user, userData, marketData, showNotification, setUserData, setLoadingKey });
  const { handleDailyCheckin, handleBailout } = useDailyOperations({ user, userData, showNotification, setUserData, setLoadingKey });
  const { handlePinAction, handlePurchaseCosmetic, handleEquipCosmetic } = usePinShop({ user, userData, showNotification, setUserData, setLoadingKey });

  // Trade execution + confirmation requests
  const { handleTrade, requestTrade } = useTradeManagement({
    user, userData, prices, marketData, activeIPOs, launchedTickers,
    showNotification, setLoadingKey, setTradeConfirmation, setTradeAnimation,
  });

  const handleOnboardingComplete = useCallback(async () => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'users', user.uid), { onboardingComplete: true });
    } catch (err) {
      console.error('Failed to complete onboarding:', err);
    }
  }, [user]);

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

  // Get list of tickers currently in IPO (hype or active phase) - these shouldn't be tradeable
  const ipoRestrictedTickers = useMemo(() => {
    const now = Date.now();
    return activeIPOs
      .filter(ipo => !ipo.priceJumped && now < ipo.ipoEndsAt) // In hype or buying phase
      .map(ipo => ipo.ticker);
  }, [activeIPOs]);

  // Styling - Orange/Yellow theme inspired by logo
  const { bgClass, mutedClass } = getThemeClasses(darkMode);

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
              <HomePage
                isGuest={isGuest}
                activeUserData={activeUserData}
                portfolioValue={portfolioValue}
                actionLoading={actionLoading}
                onCheckin={handleDailyCheckin}
                onBuyIPO={handleBuyIPO}
                onTrade={requestTrade}
                onViewChart={handleViewChart}
                onToggleWatchlist={toggleWatchlist}
                tradeAnimation={tradeAnimation}
                limitOrderRequest={limitOrderRequest}
                onClearLimitOrderRequest={() => setLimitOrderRequest(null)}
                onSetAlert={(ticker) => setShowPriceAlertModal(ticker)}
                onShowMissions={() => setShowDailyMissions(true)}
                onShowPinShop={() => setShowPinShop(true)}
                onShowCrews={() => setShowCrewSelection(true)}
                onShowMargin={() => setShowLending(true)}
                onShowAbout={() => setShowAbout(true)}
                onShowLogin={() => setShowLoginModal(true)}
                onShowPortfolio={() => setShowPortfolio(true)}
                onShowBailout={() => setShowBailout(true)}
              />
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
              onComplete={() => adoptUserDoc(user.uid)}
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
        <BailoutModal
          onCancel={() => setShowBailout(false)}
          onConfirm={async () => {
            await handleBailout();
            setShowBailout(false);
          }}
          loading={actionLoading.bailout}
        />
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
        <TradeConfirmModal
          confirmation={tradeConfirmation}
          onCancel={() => setTradeConfirmation(null)}
          onConfirm={async () => {
            await handleTrade(tradeConfirmation.ticker, tradeConfirmation.action, tradeConfirmation.amount);
            setTradeConfirmation(null);
          }}
          loading={actionLoading.trade}
        />
      )}

      {/* Bet Confirmation Modal */}
      {betConfirmation && (
        <BetConfirmModal
          confirmation={betConfirmation}
          onCancel={() => setBetConfirmation(null)}
          onConfirm={async () => {
            await handleBet(betConfirmation.predictionId, betConfirmation.option, betConfirmation.amount);
            setBetConfirmation(null);
          }}
          loading={actionLoading.placeBet}
        />
      )}

          </Suspense>
      </Layout>
    </AppProvider>
  );
}
