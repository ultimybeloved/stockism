import { useState } from 'react';
import type { Character } from '../characters';
import type { BetConfirmation } from '../components/modals/BetConfirmModal';
import type { LimitOrderRequest } from './useUserActions';
import type { TradeConfirmation } from './types';

/** The stock whose chart popup is open, and the range it opens on. */
export interface ChartSelection {
  character: Character;
  defaultTimeRange: string;
}

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
  const [showPriceAlertModal, setShowPriceAlertModal] = useState<string | null>(null); // ticker
  const [tradeConfirmation, setTradeConfirmation] = useState<TradeConfirmation | null>(null);
  const [limitOrderRequest, setLimitOrderRequest] = useState<LimitOrderRequest | null>(null);
  const [betConfirmation, setBetConfirmation] = useState<BetConfirmation | null>(null);
  const [selectedCharacter, setSelectedCharacter] = useState<ChartSelection | null>(null);

  return {
    showLoginModal,
    setShowLoginModal,
    showPortfolio,
    setShowPortfolio,
    showTradeHistory,
    setShowTradeHistory,
    showAbout,
    setShowAbout,
    showLending,
    setShowLending,
    showBailout,
    setShowBailout,
    showCrewSelection,
    setShowCrewSelection,
    showPinShop,
    setShowPinShop,
    showDailyMissions,
    setShowDailyMissions,
    showAdmin,
    setShowAdmin,
    showNotificationPanel,
    setShowNotificationPanel,
    showPriceAlertModal,
    setShowPriceAlertModal,
    tradeConfirmation,
    setTradeConfirmation,
    limitOrderRequest,
    setLimitOrderRequest,
    betConfirmation,
    setBetConfirmation,
    selectedCharacter,
    setSelectedCharacter,
  };
}
