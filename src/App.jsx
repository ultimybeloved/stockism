import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import { CHARACTERS } from './characters';
import { computeRarityTiers } from './utils/rarity';
import ErrorBoundary from './components/common/ErrorBoundary';
import AppModals from './components/AppModals';

// Eagerly-loaded modals (shown immediately / on critical auth flows)
import DiscordWallModal from './components/modals/DiscordWallModal';

// Lazy-loaded — only downloaded when the user actually opens them
const StockPage         = lazy(() => import('./pages/StockPage'));

// Import other components
import { useModalManager } from './hooks/useModalManager';
import { useDiscordLink } from './hooks/useDiscordLink';
import { useAuthUser } from './hooks/useAuthUser';
import { useMarketData } from './hooks/useMarketData';
import { useUserAlerts } from './hooks/useUserAlerts';
import { useUserActions } from './hooks/useUserActions';
import { useAccountMaintenance } from './hooks/useAccountMaintenance';
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
import { ADMIN_UIDS, UNVERIFIED_STARTING_CASH } from './constants';
import { calculatePortfolioValue } from './utils/calculations';
import { getWeekStart } from './utils/date';
import { newThisWeek } from './utils/marketFilters';


// ============================================
// MAIN APP
// ============================================

function DiscordLinkRedirect({ user, darkMode, bgClass, setShowLoginModal }) {
  const { beginDiscordLink, error: linkError } = useDiscordLink();
  const startedRef = useRef(false);

  useEffect(() => {
    // Ref guard: beginDiscordLink is async, so without it a re-render before the
    // redirect lands would mint a second code and burn the first.
    if (user && !startedRef.current) {
      startedRef.current = true;
      beginDiscordLink();
    }
  }, [user, beginDiscordLink]);

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
      <p className={linkError ? 'text-red-400 text-sm' : mutedClass}>
        {linkError || 'Redirecting to Discord...'}
      </p>
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
  const { user, userData, setUserData, needsUsername, needsEmailVerification, loading, adoptUserDoc, suggestedName } = useAuthUser({ setDarkMode, showNotification });

  // Global market subscriptions: prices, chart history, IPOs, predictions
  const { prices, priceHistory, marketData, dividendTierOverrides, launchedTickers, activeIPOs, predictions, crewStats, storedReviewChanges, siteMessages, marketStatus } = useMarketData();

  // Bell notifications + price alerts (subscriptions and handlers)
  const {
    userNotifications, priceAlerts,
    handleMarkNotificationRead, handleMarkAllNotificationsRead,
    handleClearAllNotifications, handleDeleteNotification,
    handleCreatePriceAlert, handleDeletePriceAlert,
  } = useUserAlerts({ user, showNotification });

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

  // Compute new characters for header notification
  const newCharactersWithData = useMemo(() => {
    const weekStart = getWeekStart();
    return newThisWeek(CHARACTERS, launchedTickers, weekStart).map(char => {
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
  const { handleBet, handleBuyEventShares, handleSellEventShares } = usePredictionManagement({ user, userData, predictions, marketData, showNotification, setUserData, setLoadingKey });
  const { handleBuyIPO } = useIPOManagement({ user, userData, marketData, showNotification, setUserData, setLoadingKey });
  const { handleDailyCheckin, handleBailout } = useDailyOperations({ user, userData, showNotification, setUserData, setLoadingKey });
  const { handlePinAction, handlePurchaseCosmetic, handleEquipCosmetic } = usePinShop({ user, userData, showNotification, setUserData, setLoadingKey });

  // Trade execution + confirmation requests
  const { handleTrade, requestTrade } = useTradeManagement({
    user, userData, prices, marketData, activeIPOs, launchedTickers,
    showNotification, setLoadingKey, setTradeConfirmation, setTradeAnimation,
  });

  // One-shot user actions (watchlist, DRIP, deletion, tutorial/onboarding flags)
  const {
    toggleWatchlist, handleLimitOrderRequest, handleHidePrediction,
    handleToggleDrip, handleDeleteAccount, handleMarginTutorialComplete,
    handleOnboardingComplete,
  } = useUserActions({ user, userData, showNotification, setLimitOrderRequest, setShowPortfolio });

  // Background account upkeep (payout claims, portfolio sync, interest, debt reminders)
  useAccountMaintenance({ user, userData, prices, predictions, showNotification });

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
  const { bgClass, mutedClass, textClass } = getThemeClasses(darkMode);

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
    rarityTiers,
    crewStats,
    storedReviewChanges,
    siteMessages
  }), [darkMode, user, userData, prices, priceHistory, predictions, marketData, getColorBlindColors, showNotification, activeIPOs, ipoRestrictedTickers, launchedTickers, rarityTiers, crewStats, storedReviewChanges, siteMessages]);

  if (loading) {
    return (
      <div className={`min-h-screen ${bgClass} flex items-center justify-center`}>
        <div className={`text-lg ${mutedClass}`}>Loading Stockism...</div>
      </div>
    );
  }

  // Never reached the market data at all. Rendering the app here would fill every
  // price with the character's basePrice, because roughly twenty components fall
  // back to it, and present those invented numbers as live prices. That is what
  // archive crawlers were capturing, and what a player with a stalled connection
  // was being shown. Say so instead.
  //
  // Only triggers when the FIRST read fails. A later failure keeps the real
  // prices already on screen.
  if (marketStatus === 'unavailable') {
    return (
      <div className={`min-h-screen ${bgClass} flex items-center justify-center p-6`}>
        <div className="text-center max-w-sm">
          <p className={`text-lg ${textClass} mb-2`}>Live market data is unavailable</p>
          <p className={`text-sm ${mutedClass} mb-4`}>
            Prices could not be loaded, so none are shown rather than showing
            numbers that are not real. Try again in a moment.
          </p>
          <button onClick={() => window.location.reload()}
            className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold rounded-sm">
            Reload
          </button>
          <p className={`text-xs ${mutedClass} mt-4`}>
            A plain snapshot of the current market is always available at{' '}
            <a href="/snapshot" className="text-orange-500 underline">/snapshot</a>.
          </p>
        </div>
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
            <Route path="/achievements" element={<AchievementsPage onPinAction={isGuest ? undefined : handlePinAction} />} />
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
            <Route path="/profile" element={<ProfilePage onOpenCrewSelection={() => setShowCrewSelection(true)} onDeleteAccount={handleDeleteAccount} onOpenCustomization={() => setShowPinShop(true)} />} />
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
          <AppModals
            actionLoading={actionLoading}
            activeUserData={activeUserData}
            adoptUserDoc={adoptUserDoc}
            betConfirmation={betConfirmation}
            dismissNotification={dismissNotification}
            dividendTierOverrides={dividendTierOverrides}
            handleBailout={handleBailout}
            handleBet={handleBet}
            handleClaimMissionReward={handleClaimMissionReward}
            handleClaimWeeklyMissionReward={handleClaimWeeklyMissionReward}
            handleClearAllNotifications={handleClearAllNotifications}
            handleCreatePriceAlert={handleCreatePriceAlert}
            handleCrewLeave={handleCrewLeave}
            handleCrewSelect={handleCrewSelect}
            handleDeleteNotification={handleDeleteNotification}
            handleDeletePriceAlert={handleDeletePriceAlert}
            handleDisableMargin={handleDisableMargin}
            handleEnableMargin={handleEnableMargin}
            handleEquipCosmetic={handleEquipCosmetic}
            handleLimitOrderRequest={handleLimitOrderRequest}
            handleMarginTutorialComplete={handleMarginTutorialComplete}
            handleMarkAllNotificationsRead={handleMarkAllNotificationsRead}
            handleMarkNotificationRead={handleMarkNotificationRead}
            handleOnboardingComplete={handleOnboardingComplete}
            handlePinAction={handlePinAction}
            handlePurchaseCosmetic={handlePurchaseCosmetic}
            handleRepayMargin={handleRepayMargin}
            handleRerollMissions={handleRerollMissions}
            handleToggleDrip={handleToggleDrip}
            handleTrade={handleTrade}
            isGuest={isGuest}
            needsEmailVerification={needsEmailVerification}
            needsUsername={needsUsername}
            suggestedName={suggestedName}
            notifications={notifications}
            portfolioValue={portfolioValue}
            priceAlerts={priceAlerts}
            requestTrade={requestTrade}
            selectedCharacter={selectedCharacter}
            setBetConfirmation={setBetConfirmation}
            setSelectedCharacter={setSelectedCharacter}
            setShowAbout={setShowAbout}
            setShowAdmin={setShowAdmin}
            setShowBailout={setShowBailout}
            setShowCrewSelection={setShowCrewSelection}
            setShowDailyMissions={setShowDailyMissions}
            setShowLending={setShowLending}
            setShowLoginModal={setShowLoginModal}
            setShowMarginTutorialReview={setShowMarginTutorialReview}
            setShowNotificationPanel={setShowNotificationPanel}
            setShowPinShop={setShowPinShop}
            setShowPortfolio={setShowPortfolio}
            setShowPriceAlertModal={setShowPriceAlertModal}
            setShowTradeHistory={setShowTradeHistory}
            setTradeConfirmation={setTradeConfirmation}
            showAbout={showAbout}
            showAdmin={showAdmin}
            showBailout={showBailout}
            showCrewSelection={showCrewSelection}
            showDailyMissions={showDailyMissions}
            showLending={showLending}
            showLoginModal={showLoginModal}
            showMarginTutorialReview={showMarginTutorialReview}
            showNotificationPanel={showNotificationPanel}
            showPinShop={showPinShop}
            showPortfolio={showPortfolio}
            showPriceAlertModal={showPriceAlertModal}
            showTradeHistory={showTradeHistory}
            tradeConfirmation={tradeConfirmation}
            userNotifications={userNotifications}
          />

          </Suspense>
      </Layout>
    </AppProvider>
  );
}
