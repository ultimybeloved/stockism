import { createContext, useContext } from 'react';
import type { User } from 'firebase/auth';
import type { ReviewChanges } from '../utils/marketHours';
import type { IPO, PriceHistory, PriceMap, ShareMap, ShortMap, UserData } from '../types';

/** market/current. Fields are added as typed code reads them. */
export interface MarketData {
  marketHalted?: boolean;
  haltedTickers?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Tailwind classes for gains and losses, honouring color-blind mode. */
export interface ChangeColors {
  text: string;
  bg: string;
  bgHover: string;
  border: string;
}

export type NotificationKind = 'success' | 'error' | 'info' | 'warning' | string;

/** A Firestore doc we haven't typed field-by-field yet. */
export interface LooseDoc {
  id: string;
  [key: string]: unknown;
}

export interface AppContextValue {
  darkMode: boolean;
  user: User | null;
  userData: UserData | null;
  prices: PriceMap;
  priceHistory: PriceHistory;
  predictions: LooseDoc[];
  holdings: ShareMap;
  shorts: ShortMap;
  costBasis: Record<string, number>;
  marketData: MarketData | null;
  getColorBlindColors: (isPositive: boolean) => ChangeColors;
  showNotification: (type: NotificationKind, message: string, image?: string | null) => void;
  activeIPOs: IPO[];
  ipoRestrictedTickers: string[];
  launchedTickers: string[];
  rarityTiers: Record<string, string>;
  crewStats: { multipliers?: Record<string, number>; [key: string]: unknown } | null;
  storedReviewChanges: (ReviewChanges & { windowEnd?: number }) | null;
  siteMessages: LooseDoc[];
}

/**
 * Shared state for the entire application. Gives every page user data, market
 * data and app settings without prop drilling.
 */
const AppContext = createContext<AppContextValue | null>(null);

export const useAppContext = (): AppContextValue => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within AppProvider');
  }
  return context;
};

export const AppProvider = AppContext.Provider;
