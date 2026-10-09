import { useState, useMemo, lazy, Suspense, useCallback } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { CHARACTERS } from './characters';
import { computeRarityTiers } from './utils/rarity';
import ErrorBoundary from './shared/components/ErrorBoundary';
import AppModals from './app/AppModals';
import DiscordWallModal from './features/account/components/DiscordWallModal';
import Layout from './shared/components/layout/Layout';
import DiscordLinkRedirect from './app/DiscordLinkRedirect';
import InAppBrowserBanner from './app/InAppBrowserBanner';
import { LoadingScreen, MarketUnavailableScreen } from './app/StatusScreens';
import { useModalManager } from './shared/hooks/useModalManager';
import { useAuthUser } from './features/account/hooks/useAuthUser';
import { useMarketData } from './features/market/hooks/useMarketData';
import { useUserAlerts } from './features/notifications/hooks/useUserAlerts';
import { useUserActions } from './features/account/hooks/useUserActions';
import { useAccountMaintenance } from './features/account/hooks/useAccountMaintenance';
import { useTradeManagement } from './features/trading/hooks/useTradeManagement';
import { useMissionManagement } from './features/missions/hooks/useMissionManagement';
import { useMarginManagement } from './features/margin/hooks/useMarginManagement';
import { useCrewManagement } from './features/crews/hooks/useCrewManagement';
import { usePredictionManagement } from './features/predictions/hooks/usePredictionManagement';
import { useIPOManagement } from './features/ipo/hooks/useIPOManagement';
import { useDailyOperations } from './features/missions/hooks/useDailyOperations';
import { usePinShop } from './features/profile/hooks/usePinShop';
import { useDarkMode, useDarkModeToggle } from './shared/hooks/useDarkMode';
import { useToasts } from './shared/hooks/useToasts';
import { useActionLoading } from './shared/hooks/useActionLoading';
import { useNewCharacters } from './features/market/hooks/useNewCharacters';
import {
  AppProvider,
  type MarketContextValue,
  type SessionContextValue,
  type ThemeContextValue,
} from './context/AppContext';
import { getChangeColors } from './utils/theme';
import { ADMIN_UIDS, UNVERIFIED_STARTING_CASH } from './constants';
import { calculatePortfolioValue } from './utils/calculations';
import type { Character } from './characters';
import type { UserData } from './types';
import type { TradeAnimation } from './shared/hooks/types';

// The home page loads with the app; every other page downloads on first visit.
import HomePage from './features/market/pages/HomePage';
const StockPage = lazy(() => import('./features/market/pages/StockPage'));
const LeaderboardPage = lazy(() => import('./features/leaderboard/pages/LeaderboardPage'));
const AchievementsPage = lazy(() => import('./features/profile/pages/AchievementsPage'));
const LadderPage = lazy(() => import('./features/ladder/pages/LadderPage'));
const ProfilePage = lazy(() => import('./features/profile/pages/ProfilePage'));
const PublicProfilePage = lazy(() => import('./features/profile/pages/PublicProfilePage'));
const PredictionsPage = lazy(() => import('./features/predictions/pages/PredictionsPage'));

// What a signed-out visitor sees in place of an account.
const GUEST_DATA: UserData = {
  cash: UNVERIFIED_STARTING_CASH,
  holdings: {},
  shorts: {},
  costBasis: {},
  bets: {},
  portfolioValue: UNVERIFIED_STARTING_CASH,
};

// The app root: subscriptions, the action hooks, the context value, routes, and
// the modal stack. Each hook owns its own state; this file wires them together.
export default function App() {
  const [darkMode, setDarkMode] = useDarkMode();
  const { actionLoading, setLoadingKey } = useActionLoading();
  const { notifications, showNotification, dismissNotification } = useToasts();
  const modals = useModalManager();
  const {
    setShowLoginModal,
    setShowPortfolio,
    setShowAbout,
    setShowLending,
    setShowBailout,
    setShowCrewSelection,
    setShowPinShop,
    setShowDailyMissions,
    setShowAdmin,
    setShowNotificationPanel,
    setShowPriceAlertModal,
    setTradeConfirmation,
    limitOrderRequest,
    setLimitOrderRequest,
    setBetConfirmation,
    setSelectedCharacter,
  } = modals;

  const [tradeAnimation, setTradeAnimation] = useState<TradeAnimation | null>(null);
  const [showMarginTutorialReview, setShowMarginTutorialReview] = useState(false);

  const handleViewChart = (character: Character, defaultTimeRange = '1d') => {
    setSelectedCharacter({ character, defaultTimeRange });
  };
  // Auth state + user doc subscription (and auth-adjacent URL flows)
  const { user, userData, setUserData, needsUsername, needsEmailVerification, loading, adoptUserDoc, suggestedName } =
    useAuthUser({ setDarkMode, showNotification });

  // Global market subscriptions: prices, chart history, IPOs, predictions
  const {
    prices,
    priceHistory,
    marketData,
    dividendTierOverrides,
    launchedTickers,
    activeIPOs,
    predictions,
    crewStats,
    storedReviewChanges,
    siteMessages,
    marketStatus,
  } = useMarketData();

  // Bell notifications + price alerts (subscriptions and handlers)
  const alerts = useUserAlerts({ user, showNotification });

  const handleToggleDarkMode = useDarkModeToggle(user, setDarkMode);
  const newCharactersWithData = useNewCharacters(prices, priceHistory, launchedTickers);
  const getColorBlindColors = useCallback(
    (isPositive: boolean) => getChangeColors(isPositive, userData?.colorBlindMode || false),
    [userData],
  );

  // Action hooks. They take state directly because this component IS the
  // context provider, so it can't read its own context.
  const missions = useMissionManagement({
    user,
    userData,
    showNotification,
    setUserData,
    setLoadingKey,
  });
  const margin = useMarginManagement({
    user,
    userData,
    showNotification,
    setUserData,
    setLoadingKey,
    setShowLending,
  });
  const crew = useCrewManagement({
    user,
    userData,
    showNotification,
    setUserData,
    setLoadingKey,
  });
  const { handleBet, handleBuyEventShares, handleSellEventShares } = usePredictionManagement({
    user,
    userData,
    predictions,
    marketData,
    showNotification,
    setUserData,
    setLoadingKey,
  });
  const { handleBuyIPO } = useIPOManagement({
    user,
    userData,
    marketData,
    showNotification,
    setUserData,
    setLoadingKey,
  });
  const { handleDailyCheckin, handleBailout } = useDailyOperations({
    user,
    userData,
    showNotification,
    setUserData,
    setLoadingKey,
  });
  const pinShop = usePinShop({
    user,
    userData,
    showNotification,
    setUserData,
    setLoadingKey,
  });

  // Trade execution + confirmation requests
  const { handleTrade, requestTrade } = useTradeManagement({
    user,
    userData,
    prices,
    marketData,
    activeIPOs,
    launchedTickers,
    showNotification,
    setLoadingKey,
    setTradeConfirmation,
    setTradeAnimation,
  });

  // One-shot user actions (watchlist, DRIP, deletion, tutorial/onboarding flags)
  const {
    toggleWatchlist,
    handleLimitOrderRequest,
    handleHidePrediction,
    handleToggleDrip,
    handleDeleteAccount,
    handleMarginTutorialComplete,
    handleOnboardingComplete,
  } = useUserActions({ user, userData, showNotification, setLimitOrderRequest, setShowPortfolio });

  // Background account upkeep (payout claims, portfolio sync, interest, debt reminders)
  useAccountMaintenance({ user, userData, prices, predictions, showNotification });

  const activeUserData = userData || GUEST_DATA;
  const isGuest = !user;
  const isAdmin = !!user && ADMIN_UIDS.includes(user.uid);
  const portfolioValue = calculatePortfolioValue(activeUserData, prices);

  // Get list of tickers currently in IPO (hype or active phase) - these shouldn't be tradeable
  const ipoRestrictedTickers = useMemo(() => {
    const now = Date.now();
    return activeIPOs
      .filter((ipo) => !ipo.priceJumped && now < ipo.ipoEndsAt) // In hype or buying phase
      .map((ipo) => ipo.ticker);
  }, [activeIPOs]);

  // Rarity tiers by market standing — computed once here so every card shares the
  // same ranking instead of each re-ranking the whole roster. See utils/rarity.js.
  const rarityTiers = useMemo(() => computeRarityTiers(CHARACTERS, prices), [prices]);

  // The three context values, each memoized on its own inputs so a price tick
  // leaves the theme and session values (and their readers) untouched.
  const themeValue = useMemo((): ThemeContextValue => ({ darkMode }), [darkMode]);
  const sessionValue = useMemo(
    (): SessionContextValue => ({
      user,
      userData,
      holdings: userData?.holdings || {},
      shorts: userData?.shorts || {},
      costBasis: userData?.costBasis || {},
      getColorBlindColors,
      showNotification,
    }),
    [user, userData, getColorBlindColors, showNotification],
  );
  const marketValue = useMemo(
    (): MarketContextValue => ({
      prices,
      priceHistory,
      predictions,
      marketData,
      activeIPOs,
      ipoRestrictedTickers,
      launchedTickers,
      rarityTiers,
      crewStats,
      storedReviewChanges,
      siteMessages,
    }),
    [
      prices,
      priceHistory,
      predictions,
      marketData,
      activeIPOs,
      ipoRestrictedTickers,
      launchedTickers,
      rarityTiers,
      crewStats,
      storedReviewChanges,
      siteMessages,
    ],
  );

  if (loading) return <LoadingScreen />;
  if (marketStatus === 'unavailable') return <MarketUnavailableScreen />;

  return (
    <AppProvider theme={themeValue} session={sessionValue} market={marketValue}>
      <DiscordWallModal />
      <Layout
        setDarkMode={handleToggleDarkMode}
        onShowAdminPanel={() => setShowAdmin(true)}
        isGuest={isGuest}
        onShowLogin={() => setShowLoginModal(true)}
        notificationCount={alerts.userNotifications.filter((n) => !n.read).length}
        onToggleNotifications={() => setShowNotificationPanel((prev) => !prev)}
        newCharacters={newCharactersWithData}
      >
        <InAppBrowserBanner />
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-64">
              <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
            </div>
          }
        >
          <ErrorBoundary>
            <Routes>
              <Route
                path="/"
                element={
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
                }
              />
              <Route path="/leaderboard" element={<LeaderboardPage />} />
              <Route
                path="/achievements"
                element={<AchievementsPage onPinAction={isGuest ? undefined : pinShop.handlePinAction} />}
              />
              <Route path="/ladder" element={<LadderPage />} />
              <Route
                path="/predictions"
                element={
                  <PredictionsPage
                    predictions={predictions}
                    isGuest={isGuest}
                    isAdmin={isAdmin}
                    onBet={handleBet}
                    onRequestBet={(predictionId, option, amount, question) =>
                      setBetConfirmation({ predictionId, option, amount, question })
                    }
                    onHidePrediction={handleHidePrediction}
                    onBuyEventShares={handleBuyEventShares}
                    onSellEventShares={handleSellEventShares}
                  />
                }
              />
              <Route
                path="/profile"
                element={
                  <ProfilePage
                    onOpenCrewSelection={() => setShowCrewSelection(true)}
                    onDeleteAccount={handleDeleteAccount}
                    onOpenCustomization={() => setShowPinShop(true)}
                  />
                }
              />
              <Route
                path="/link-discord"
                element={<DiscordLinkRedirect onShowLogin={() => setShowLoginModal(true)} />}
              />
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
            {...modals}
            {...missions}
            {...margin}
            {...crew}
            {...pinShop}
            {...alerts}
            actionLoading={actionLoading}
            activeUserData={activeUserData}
            adoptUserDoc={adoptUserDoc}
            dismissNotification={dismissNotification}
            dividendTierOverrides={dividendTierOverrides}
            handleBailout={handleBailout}
            handleBet={handleBet}
            handleLimitOrderRequest={handleLimitOrderRequest}
            handleMarginTutorialComplete={handleMarginTutorialComplete}
            handleOnboardingComplete={handleOnboardingComplete}
            handleToggleDrip={handleToggleDrip}
            handleTrade={handleTrade}
            isGuest={isGuest}
            needsEmailVerification={needsEmailVerification}
            needsUsername={needsUsername}
            suggestedName={suggestedName}
            notifications={notifications}
            portfolioValue={portfolioValue}
            requestTrade={requestTrade}
            showMarginTutorialReview={showMarginTutorialReview}
            setShowMarginTutorialReview={setShowMarginTutorialReview}
          />
        </Suspense>
      </Layout>
    </AppProvider>
  );
}
