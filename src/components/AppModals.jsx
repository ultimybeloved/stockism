import { lazy } from 'react';
import { useAppContext } from '../context/AppContext';
import { CHARACTER_MAP } from '../characters';
import { ADMIN_UIDS } from '../constants';
import { ToastContainer } from './ToastNotification';
import InstallPrompt from './InstallPrompt';
import LoginModal from './modals/LoginModal';
import UsernameModal from './modals/UsernameModal';
import EmailVerificationModal from './modals/EmailVerificationModal';
import NotificationPanel from './NotificationPanel';
import OnboardingTutorial from './OnboardingTutorial';
import PriceAlertModal from './modals/PriceAlertModal';
import TradeConfirmModal from './modals/TradeConfirmModal';
import BetConfirmModal from './modals/BetConfirmModal';
import BailoutModal from './modals/BailoutModal';

const AdminPanel         = lazy(() => import('../AdminPanel'));
const AboutModal         = lazy(() => import('./modals/AboutModal'));
const CrewSelectionModal = lazy(() => import('./modals/CrewSelectionModal'));
const PinShopModal       = lazy(() => import('./modals/PinShopModal'));
const DailyMissionsModal = lazy(() => import('./modals/DailyMissionsModal'));
const MarginModal        = lazy(() => import('./modals/MarginModal'));
const MarginTutorialModal = lazy(() => import('./modals/MarginTutorialModal'));
const ChartModal         = lazy(() => import('./modals/ChartModal'));
const PortfolioModal     = lazy(() => import('./modals/PortfolioModal'));
const TradeHistoryModal  = lazy(() => import('./modals/TradeHistoryModal'));

// The whole modal stack, lifted out of App.jsx to hold it under the 500-line
// limit. App.jsx still owns the modal STATE (useModalManager) and the handlers;
// this component only decides what is on screen. Values already in context are
// read from context rather than drilled.
const AppModals = ({
  actionLoading,
  activeUserData,
  adoptUserDoc,
  betConfirmation,
  dismissNotification,
  dividendTierOverrides,
  handleBailout,
  handleBet,
  handleClaimMissionReward,
  handleClaimWeeklyMissionReward,
  handleClearAllNotifications,
  handleCreatePriceAlert,
  handleCrewLeave,
  handleCrewSelect,
  handleDeleteNotification,
  handleDeletePriceAlert,
  handleDisableMargin,
  handleEnableMargin,
  handleEquipCosmetic,
  handleLimitOrderRequest,
  handleMarginTutorialComplete,
  handleMarkAllNotificationsRead,
  handleMarkNotificationRead,
  handleOnboardingComplete,
  handlePinAction,
  handlePurchaseCosmetic,
  handleRepayMargin,
  handleRerollMissions,
  handleToggleDrip,
  handleTrade,
  isGuest,
  needsEmailVerification,
  needsUsername,
  suggestedName,
  notifications,
  portfolioValue,
  priceAlerts,
  requestTrade,
  selectedCharacter,
  setBetConfirmation,
  setSelectedCharacter,
  setShowAbout,
  setShowAdmin,
  setShowBailout,
  setShowCrewSelection,
  setShowDailyMissions,
  setShowLending,
  setShowLoginModal,
  setShowMarginTutorialReview,
  setShowNotificationPanel,
  setShowPinShop,
  setShowPortfolio,
  setShowPriceAlertModal,
  setShowTradeHistory,
  setTradeConfirmation,
  showAbout,
  showAdmin,
  showBailout,
  showCrewSelection,
  showDailyMissions,
  showLending,
  showLoginModal,
  showMarginTutorialReview,
  showNotificationPanel,
  showPinShop,
  showPortfolio,
  showPriceAlertModal,
  showTradeHistory,
  tradeConfirmation,
  userNotifications,
}) => {
  const { darkMode, user, userData, prices, predictions, marketData } = useAppContext();

  return (
    <>
      {showLoginModal && <LoginModal onClose={() => setShowLoginModal(false)} darkMode={darkMode} />}
      {needsEmailVerification && user && <EmailVerificationModal user={user} darkMode={darkMode} userData={userData} />}
      {needsUsername && user && (
        <UsernameModal
          user={user}
          suggestedName={suggestedName}
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
      portfolioValue={portfolioValue}
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
    </>
  );
};

export default AppModals;
