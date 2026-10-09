import { createContext, useContext, type ReactNode } from 'react';
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

export interface ThemeContextValue {
  darkMode: boolean;
}

/** The signed-in player (all null/empty for a guest) and the toast helper. */
export interface SessionContextValue {
  user: User | null;
  userData: UserData | null;
  holdings: ShareMap;
  shorts: ShortMap;
  costBasis: Record<string, number>;
  getColorBlindColors: (isPositive: boolean) => ChangeColors;
  showNotification: (type: NotificationKind, message: string, image?: string | null) => void;
}

/** Live market state. Changes on every price tick. */
export interface MarketContextValue {
  prices: PriceMap;
  priceHistory: PriceHistory;
  predictions: PredictionDoc[];
  marketData: MarketData | null;
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

export type AppContextValue = ThemeContextValue & SessionContextValue & MarketContextValue;

/**
 * Shared state for the whole app, in three contexts so a component only
 * re-renders for what it reads: a price tick re-renders market readers, not
 * every component that only needs the theme or the player.
 */
const ThemeContext = createContext<ThemeContextValue | null>(null);
const SessionContext = createContext<SessionContextValue | null>(null);
const MarketContext = createContext<MarketContextValue | null>(null);

const required = <T,>(value: T | null, hook: string): T => {
  if (!value) throw new Error(`${hook} must be used within AppProvider`);
  return value;
};

export const useTheme = (): ThemeContextValue => required(useContext(ThemeContext), 'useTheme');
export const useSession = (): SessionContextValue => required(useContext(SessionContext), 'useSession');
export const useMarket = (): MarketContextValue => required(useContext(MarketContext), 'useMarket');

export function AppProvider({
  theme,
  session,
  market,
  children,
}: {
  theme: ThemeContextValue;
  session: SessionContextValue;
  market: MarketContextValue;
  children: ReactNode;
}) {
  return (
    <ThemeContext.Provider value={theme}>
      <SessionContext.Provider value={session}>
        <MarketContext.Provider value={market}>{children}</MarketContext.Provider>
      </SessionContext.Provider>
    </ThemeContext.Provider>
  );
}
