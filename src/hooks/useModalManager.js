import { useState } from 'react';

export function useModalManager() {
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showPortfolio, setShowPortfolio] = useState(false);
  const [showTradeHistory, setShowTradeHistory] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showLending, setShowLending] = useState(false);
  const [showBailout, setShowBailout] = useState(false);
  const [showCrewSelection, setShowCrewSelection] = useState(false);
  const [showPinShop, setShowPinShop] = useState(false);
  const [showDailyMissions, setShowDailyMissions] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showNotificationPanel, setShowNotificationPanel] = useState(false);
  const [showPriceAlertModal, setShowPriceAlertModal] = useState(null); // ticker string or null
  const [tradeConfirmation, setTradeConfirmation] = useState(null); // { ticker, action, amount, price, total }
  const [limitOrderRequest, setLimitOrderRequest] = useState(null); // { ticker, action }
  const [betConfirmation, setBetConfirmation] = useState(null); // { predictionId, option, amount, question }
  const [selectedCharacter, setSelectedCharacter] = useState(null); // { character, defaultTimeRange }

  return {
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
  };
}
