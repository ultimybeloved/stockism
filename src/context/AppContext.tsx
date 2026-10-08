import { createContext, useContext } from 'react';
import type { User } from 'firebase/auth';
import type { ReviewChanges } from '../utils/marketHours';
import type { ChangeColors } from '../utils/theme';
import type { IPO, PredictionDoc, PriceHistory, PriceMap, ShareMap, ShortMap, SiteMessage, UserData } from '../types';

/** market/current. Fields are added as typed code reads them. */
export interface MarketData {
  marketHalted?: boolean;
  haltReason?: string;
  /** ticker -> circuit-breaker pause, while one is running. */
  haltedTickers?: Record<string, { resumeAt?: number }>;
  /** retired ticker -> its current name, kept after a rename. */
  tickerAliases?: Record<string, string>;
  [key: string]: unknown;
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
  predictions: PredictionDoc[];
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
  crewStats: {
    multipliers?: Record<string, number>;
    /** crew -> players active this week. */
    activeCounts?: Record<string, number>;
    [key: string]: unknown;
  } | null;
  /** market/reviewChanges: the last chapter review's moves, rebuilt server-side. */
  storedReviewChanges: { windowEnd?: number; changes?: ReviewChanges } | null;
  /** Stored by admins, so treat every field as possibly missing. */
  siteMessages: Partial<SiteMessage>[];
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
