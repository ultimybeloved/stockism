import { useState, useMemo, Suspense, useCallback } from 'react';
import AppModals from './app/AppModals';
import AppRoutes from './app/AppRoutes';
import BackgroundTasks from './app/BackgroundTasks';
import DiscordWallModal from './features/account/components/DiscordWallModal';
import Layout from './shared/components/layout/Layout';
import InAppBrowserBanner from './app/InAppBrowserBanner';
import { LoadingScreen, MarketUnavailableScreen } from './app/StatusScreens';
import { useModalManager } from './shared/hooks/useModalManager';
import { useAuthUser } from './features/account/hooks/useAuthUser';
import { useUserAlerts } from './features/notifications/hooks/useUserAlerts';
import { useUserActions } from './features/account/hooks/useUserActions';
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
import { AppProvider, useMarketAccess, type SessionContextValue, type ThemeContextValue } from './context/AppContext';
import { getChangeColors } from './utils/theme';
import { ADMIN_UIDS, UNVERIFIED_STARTING_CASH } from './constants';
import type { Character } from './characters';
import type { UserData } from './types';
import type { TradeAnimation } from './shared/hooks/types';

// What a signed-out visitor sees in place of an account.
const GUEST_DATA: UserData = {
  cash: UNVERIFIED_STARTING_CASH,
  holdings: {},
  shorts: {},
  costBasis: {},
  bets: {},
  portfolioValue: UNVERIFIED_STARTING_CASH,
};

// The app root, under MarketDataProvider (main.tsx): the player's session, the
// action hooks, the theme and session contexts, the page shell and the modal
// stack. Each hook owns its own state; this file wires them together. It reads
// no live market values, so a price tick does not re-render it: the handlers
// read the market at click time through getMarket.
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

  // Market load status, and the latest market value for handlers to read
  const { marketStatus, getMarket } = useMarketAccess();

  // Bell notifications + price alerts (subscriptions and handlers)
  const alerts = useUserAlerts({ user, showNotification });

  const handleToggleDarkMode = useDarkModeToggle(user, setDarkMode);
  const getColorBlindColors = useCallback(
    (isPositive: boolean) => getChangeColors(isPositive, userData?.colorBlindMode || false),
    [userData],
  );

  // Action hooks. They take state directly because this component IS the
  // session provider, so it can't read its own context.
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
    getMarket,
    showNotification,
    setUserData,
    setLoadingKey,
  });
  const { handleBuyIPO } = useIPOManagement({
    user,
    userData,
    getMarket,
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
    getMarket,
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

  const activeUserData = userData || GUEST_DATA;
  const isGuest = !user;
  const isAdmin = !!user && ADMIN_UIDS.includes(user.uid);

  // The theme and session values, each memoized on its own inputs.
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

  const showLogin = () => setShowLoginModal(true);

  // BackgroundTasks (payout claims, portfolio sync, interest, debt reminders)
  // runs behind the status screens too, as it did when it lived in this file.
  return (
    <AppProvider theme={themeValue} session={sessionValue}>
      <BackgroundTasks />
      {loading ? (
        <LoadingScreen />
      ) : marketStatus === 'unavailable' ? (
        <MarketUnavailableScreen />
      ) : (
        <>
          <DiscordWallModal />
          <Layout
            setDarkMode={handleToggleDarkMode}
            onShowAdminPanel={() => setShowAdmin(true)}
            isGuest={isGuest}
            onShowLogin={showLogin}
            notificationCount={alerts.userNotifications.filter((n) => !n.read).length}
            onToggleNotifications={() => setShowNotificationPanel((prev) => !prev)}
          >
            <InAppBrowserBanner />
            <AppRoutes
              home={{
                isGuest,
                activeUserData,
                actionLoading,
                onCheckin: handleDailyCheckin,
                onBuyIPO: handleBuyIPO,
                onTrade: requestTrade,
                onViewChart: handleViewChart,
                onToggleWatchlist: toggleWatchlist,
                tradeAnimation,
                limitOrderRequest,
                onClearLimitOrderRequest: () => setLimitOrderRequest(null),
                onSetAlert: (ticker) => setShowPriceAlertModal(ticker),
                onShowMissions: () => setShowDailyMissions(true),
                onShowPinShop: () => setShowPinShop(true),
                onShowCrews: () => setShowCrewSelection(true),
                onShowMargin: () => setShowLending(true),
                onShowAbout: () => setShowAbout(true),
                onShowLogin: showLogin,
                onShowPortfolio: () => setShowPortfolio(true),
                onShowBailout: () => setShowBailout(true),
              }}
              predictions={{
                isGuest,
                isAdmin,
                onBet: handleBet,
                onRequestBet: (predictionId, option, amount, question) =>
                  setBetConfirmation({ predictionId, option, amount, question }),
                onHidePrediction: handleHidePrediction,
                onBuyEventShares: handleBuyEventShares,
                onSellEventShares: handleSellEventShares,
              }}
              profile={{
                onOpenCrewSelection: () => setShowCrewSelection(true),
                onDeleteAccount: handleDeleteAccount,
                onOpenCustomization: () => setShowPinShop(true),
              }}
              onPinAction={isGuest ? undefined : pinShop.handlePinAction}
              onTrade={requestTrade}
              onShowLogin={showLogin}
            />

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
                requestTrade={requestTrade}
                showMarginTutorialReview={showMarginTutorialReview}
                setShowMarginTutorialReview={setShowMarginTutorialReview}
              />
            </Suspense>
          </Layout>
        </>
      )}
    </AppProvider>
  );
}
