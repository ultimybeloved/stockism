import { createContext, useContext, type ReactNode } from 'react';
import type { User } from 'firebase/auth';
import type { ReviewChanges } from '../utils/marketHours';
import type { ChangeColors } from '../utils/theme';
import type { EventMarketDoc, IPO, PriceHistory, PriceMap, ShareMap, ShortMap, SiteMessage, UserData } from '../types';

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
  /** predictions/current.list: weekly predictions and event markets together. */
  predictions: EventMarketDoc[];
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
  /** dividendConfig/tierOverrides: admin overrides of the rarity dividend tiers. */
  dividendTierOverrides: Record<string, string>;
}

export type MarketStatus = 'loading' | 'ready' | 'unavailable';

/**
 * Market access that does not change on a price tick: the load status, and a
 * getter for the latest market value. Handlers read prices at click time
 * through getMarket, so the components holding them don't re-render per tick.
 */
export interface MarketAccessValue {
  marketStatus: MarketStatus;
  getMarket: () => MarketContextValue;
}

export type AppContextValue = ThemeContextValue & SessionContextValue & MarketContextValue;

/**
 * Shared state for the whole app, in separate contexts so a component only
 * re-renders for what it reads: a price tick re-renders market readers, not
 * every component that only needs the theme or the player.
 *
 * MarketProvider (src/app/MarketDataProvider.tsx) sits above App, which owns
 * the player and provides AppProvider. So App never holds live prices itself.
 */
const ThemeContext = createContext<ThemeContextValue | null>(null);
const SessionContext = createContext<SessionContextValue | null>(null);
const MarketContext = createContext<MarketContextValue | null>(null);
const MarketAccessContext = createContext<MarketAccessValue | null>(null);

const required = <T,>(value: T | null, hook: string, provider: string): T => {
  if (!value) throw new Error(`${hook} must be used within ${provider}`);
  return value;
};

export const useTheme = (): ThemeContextValue => required(useContext(ThemeContext), 'useTheme', 'AppProvider');
export const useSession = (): SessionContextValue => required(useContext(SessionContext), 'useSession', 'AppProvider');
export const useMarket = (): MarketContextValue => required(useContext(MarketContext), 'useMarket', 'MarketProvider');
export const useMarketAccess = (): MarketAccessValue =>
  required(useContext(MarketAccessContext), 'useMarketAccess', 'MarketProvider');

export function AppProvider({
  theme,
  session,
  children,
}: {
  theme: ThemeContextValue;
  session: SessionContextValue;
  children: ReactNode;
}) {
  return (
    <ThemeContext.Provider value={theme}>
      <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
    </ThemeContext.Provider>
  );
}

export function MarketProvider({
  market,
  access,
  children,
}: {
  market: MarketContextValue;
  access: MarketAccessValue;
  children: ReactNode;
}) {
  return (
    <MarketAccessContext.Provider value={access}>
      <MarketContext.Provider value={market}>{children}</MarketContext.Provider>
    </MarketAccessContext.Provider>
  );
}
