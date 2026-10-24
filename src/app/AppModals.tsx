import { lazy } from 'react';
import { useSession, useMarket } from '../context/AppContext';

import { ADMIN_UIDS } from '../constants';
import { calculatePortfolioValue } from '../utils/calculations';
import { ToastContainer } from '../shared/components/ToastNotification';
import InstallPrompt from './InstallPrompt';
import LoginModal from '../features/account/components/LoginModal';
import UsernameModal from '../features/account/components/UsernameModal';
import EmailVerificationModal from '../features/account/components/EmailVerificationModal';
import NotificationPanel from '../features/notifications/components/NotificationPanel';
import OnboardingTutorial from '../features/account/components/OnboardingTutorial';
import PriceAlertModal from '../features/market/components/PriceAlertModal';
import WatchlistPicker from '../features/market/components/WatchlistPicker';
import TradeConfirmModal from '../features/trading/components/TradeConfirmModal';
import BailoutModal from '../features/margin/components/BailoutModal';
import TradeLauncher from '../features/trading/components/TradeLauncher';
import { CHARACTER_MAP } from '../characters';
import type { OrderFormMode } from '../features/trading/components/TradeActionModal';

import type { TradeAction, UserData } from '../types';
import type { useModalManager } from '../shared/hooks/useModalManager';
import type { useMissionManagement } from '../features/missions/hooks/useMissionManagement';
import type { useMarginManagement } from '../features/margin/hooks/useMarginManagement';
import type { useCrewManagement } from '../features/crews/hooks/useCrewManagement';
import type { usePinShop } from '../features/profile/hooks/usePinShop';
import type { useUserAlerts } from '../features/notifications/hooks/useUserAlerts';
import type { useAuthUser } from '../features/account/hooks/useAuthUser';
import type { useToasts } from '../shared/hooks/useToasts';
import type { useTradeManagement } from '../features/trading/hooks/useTradeManagement';
import type { useDailyOperations } from '../features/missions/hooks/useDailyOperations';
import type { useUserActions } from '../features/account/hooks/useUserActions';

const AdminPanel = lazy(() => import('../features/admin/components/AdminPanel'));
const AboutModal = lazy(() => import('../features/about/components/AboutModal'));
const CrewSelectionModal = lazy(() => import('../features/crews/components/CrewSelectionModal'));
const PinShopModal = lazy(() => import('../features/profile/components/PinShopModal'));
const MarginModal = lazy(() => import('../features/margin/components/MarginModal'));
const MarginTutorialModal = lazy(() => import('../features/margin/components/MarginTutorialModal'));
const ChartModal = lazy(() => import('../features/market/components/ChartModal'));
const TradeHistoryModal = lazy(() => import('../features/trading/components/TradeHistoryModal'));

type Hook<F extends (...args: never[]) => unknown> = ReturnType<F>;

type AppModalsProps = Hook<typeof useModalManager> &
  Hook<typeof useMissionManagement> &
  Pick<Hook<typeof useMarginManagement>, 'handleEnableMargin' | 'handleDisableMargin' | 'handleRepayMargin'> &
  Hook<typeof useCrewManagement> &
  Hook<typeof usePinShop> &
  Hook<typeof useUserAlerts> &
  Pick<Hook<typeof useAuthUser>, 'adoptUserDoc' | 'needsEmailVerification' | 'needsUsername' | 'suggestedName'> &
  Pick<Hook<typeof useToasts>, 'notifications' | 'dismissNotification'> &
  Pick<Hook<typeof useTradeManagement>, 'handleTrade' | 'requestTrade'> &
  Pick<Hook<typeof useDailyOperations>, 'handleBailout'> &
  Pick<Hook<typeof useUserActions>, 'handleMarginTutorialComplete' | 'handleOnboardingComplete'> & {
    actionLoading: Record<string, boolean | undefined>;
    activeUserData: UserData;
    isGuest: boolean;
    showMarginTutorialReview: boolean;
    setShowMarginTutorialReview: (show: boolean) => void;
  };

// The whole modal stack, lifted out of App.tsx to hold it under the 500-line
// limit. App.tsx still owns the modal STATE (useModalManager) and the handlers;
// this component only decides what is on screen. Values already in context are
// read from context rather than drilled. It reads the market, so it re-renders
// on price ticks (App does not).
const AppModals = ({
  actionLoading,
  activeUserData,
  adoptUserDoc,
  dismissNotification,
  handleBailout,
  handleClearAllNotifications,
  handleCreatePriceAlert,
  handleCrewLeave,
  handleCrewSelect,
  handleDeleteNotification,
  handleDeletePriceAlert,
  handleDisableMargin,
  handleEnableMargin,
  handleEquipCosmetic,
  handleSetCosmeticStyle,
  limitOrderRequest,
  setLimitOrderRequest,
  handleMarginTutorialComplete,
  handleMarkAllNotificationsRead,
  handleMarkNotificationRead,
  handleOnboardingComplete,
  handlePinAction,
  handlePurchaseCosmetic,
  handlePurchaseBundle,
  handleGiftCosmetic,
  handleRepayMargin,
  handleTrade,
  isGuest,
  needsEmailVerification,
  needsUsername,
  suggestedName,
  notifications,
  priceAlerts,
  requestTrade,
  selectedCharacter,
  setSelectedCharacter,
  setShowAbout,
  setShowAdmin,
  setShowBailout,
  setShowCrewSelection,
  setShowLending,
  setShowLoginModal,
  setShowMarginTutorialReview,
  setShowNotificationPanel,
  setShowPinShop,
  setShowPriceAlertModal,
  setShowTradeHistory,
  setTradeConfirmation,
  showAbout,
  showAdmin,
  showBailout,
  showCrewSelection,
  showLending,
  showLoginModal,
  showMarginTutorialReview,
  showNotificationPanel,
  showPinShop,
  showPriceAlertModal,
  showTradeHistory,
  tradeConfirmation,
  userNotifications,
}: AppModalsProps) => {
  const { user, userData } = useSession();
  const { prices, predictions, marketData } = useMarket();
  const portfolioValue = calculatePortfolioValue(activeUserData, prices);

  return (
    <>
      {showLoginModal && <LoginModal onClose={() => setShowLoginModal(false)} />}
      {needsEmailVerification && user && <EmailVerificationModal user={user} userData={userData} />}
      {needsUsername && user && (
        <UsernameModal suggestedName={suggestedName} onComplete={() => adoptUserDoc(user.uid)} />
      )}
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
      {user && <WatchlistPicker />}
      {showLending && !isGuest && !userData?.marginTutorialCompleted && (
        <MarginTutorialModal onClose={() => setShowLending(false)} onComplete={handleMarginTutorialComplete} />
      )}
      {showLending && !isGuest && userData?.marginTutorialCompleted && (
        <MarginModal
          onClose={() => setShowLending(false)}
          onEnableMargin={handleEnableMargin}
          onDisableMargin={handleDisableMargin}
          onRepayMargin={handleRepayMargin}
          isAdmin={!!user && ADMIN_UIDS.includes(user.uid)}
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
          onPurchaseBundle={handlePurchaseBundle}
          onGiftCosmetic={handleGiftCosmetic}
          onEquipCosmetic={handleEquipCosmetic}
          onSetCosmeticStyle={handleSetCosmeticStyle}
          portfolioValue={portfolioValue}
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
          marketData={marketData}
          onClose={() => setShowAdmin(false)}
        />
      )}

      {/* Notification Panel */}
      {showNotificationPanel && user && (
        <NotificationPanel
          notifications={userNotifications}
          onClose={() => setShowNotificationPanel(false)}
          onMarkRead={handleMarkNotificationRead}
          onMarkAllRead={handleMarkAllNotificationsRead}
          onClearAll={handleClearAllNotifications}
          onDelete={handleDeleteNotification}
        />
      )}

      {/* Onboarding Tutorial */}
      {user && userData && !userData.onboardingComplete && <OnboardingTutorial onComplete={handleOnboardingComplete} />}

      {/* Price Alert Modal */}
      {showPriceAlertModal && (
        <PriceAlertModal
          ticker={showPriceAlertModal}
          currentPrice={prices[showPriceAlertModal] || 0}
          onClose={() => setShowPriceAlertModal(null)}
          existingAlerts={priceAlerts.filter((a) => a.ticker === showPriceAlertModal)}
          onCreateAlert={handleCreatePriceAlert}
          onDeleteAlert={handleDeletePriceAlert}
        />
      )}

      {/* PWA Install Prompt */}
      <InstallPrompt />

      {/* Toast Notifications */}
      <ToastContainer notifications={notifications} onDismiss={dismissNotification} />

      {showTradeHistory && !isGuest && <TradeHistoryModal onClose={() => setShowTradeHistory(false)} />}
      {selectedCharacter && (
        <ChartModal
          character={selectedCharacter.character}
          currentPrice={prices[selectedCharacter.character.ticker] || selectedCharacter.character.basePrice}
          onClose={() => setSelectedCharacter(null)}
          defaultTimeRange={selectedCharacter.defaultTimeRange || '1d'}
        />
      )}

      {/* A limit or stop-loss order asked for from the portfolio, for any stock,
          whatever page is open. */}
      {limitOrderRequest && CHARACTER_MAP[limitOrderRequest.ticker] && (
        <TradeLauncher
          character={CHARACTER_MAP[limitOrderRequest.ticker]!}
          action={limitOrderRequest.action as TradeAction}
          orderMode={(limitOrderRequest.mode as OrderFormMode) || 'limit'}
          onTrade={requestTrade}
          onClose={() => setLimitOrderRequest(null)}
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
    </>
  );
};

export default AppModals;
