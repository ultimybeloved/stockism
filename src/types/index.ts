// Shared domain types for the frontend. These describe the Firestore documents
// the app reads (market/current, users/{uid}, ...) and the shapes passed between
// hooks and components. Fields are added here as files are converted; anything
// not listed yet is reachable through the index signatures on the doc types.

export type Ticker = string;

/** Anything we store as a time: Firestore Timestamp, epoch ms, or ISO string. */
export type TimestampLike =
  | number
  | string
  | Date
  | { toMillis: () => number; toDate?: () => Date; seconds?: number }
  | { toDate: () => Date; seconds?: number }
  | { seconds: number; nanoseconds?: number }
  | null
  | undefined;

export type PriceMap = Record<Ticker, number>;

export interface PricePoint {
  timestamp: number;
  price: number;
  [key: string]: unknown;
}

export type PriceHistory = Record<Ticker, PricePoint[]>;

/** ticker -> share count. Used for holdings and shorts. */
export type ShareMap = Record<Ticker, number>;

export type TradeAction = 'buy' | 'sell' | 'short' | 'cover';

/** users/{uid}.shorts[ticker]. Legacy (pre-v2) shorts have no `system`. */
export interface ShortPosition {
  shares: number;
  costBasis?: number;
  entryPrice?: number;
  margin?: number;
  system?: string;
  [key: string]: unknown;
}

export type ShortMap = Record<Ticker, ShortPosition>;

/** One fill in the rolling 24h per-ticker trade log. */
export interface TradeLogEntry {
  ts: number;
  shares?: number;
  impact?: number;
}

/** A share lockup (IPO or margin) that blocks selling until `until`. */
export interface ShareLock {
  shares?: number;
  until?: number;
}

export interface ActiveCosmetics {
  nameColor?: string | null;
  rowGlow?: string | null;
  rowBackdrop?: string | null;
  rowFrame?: string | null;
}

export interface SeasonTitle {
  id: string;
  text: string;
}

/** users/{uid}. Only the fields typed code reads so far are listed. */
export interface UserData {
  displayName?: string;
  cash?: number;
  holdings?: ShareMap;
  costBasis?: Record<Ticker, number>;
  shorts?: ShortMap;
  marginEnabled?: boolean;
  marginUsed?: number;
  marginCallAt?: TimestampLike;
  peakPortfolioValue?: number;
  totalCheckins?: number;
  totalTrades?: number;
  createdAt?: TimestampLike;
  achievements?: string[];
  bets?: Record<string, { paid?: boolean; [key: string]: unknown }>;
  lastMarginInterestCharge?: number;
  ipoPurchases?: Record<Ticker, number>;
  watchlist?: Ticker[];
  drip?: Record<Ticker, boolean>;
  crewSwitchCooldown?: number;
  checkinStreak?: number;
  crewLockouts?: Record<string, number>;
  darkMode?: boolean;
  isBankrupt?: boolean;
  colorBlindMode?: boolean;
  tickerTradeHistory?: Record<Ticker, Partial<Record<TradeAction, TradeLogEntry[]>>>;
  ipoLockup?: Record<Ticker, ShareLock>;
  marginLockup?: Record<Ticker, ShareLock>;
  extraAchievementSlot?: boolean;
  extraShopSlot?: boolean;
  crew?: string | null;
  isAdmin?: boolean;
  activeCosmetics?: ActiveCosmetics;
  ownedCosmetics?: string[];
  activeTitle?: string | null;
  ownedTitles?: string[];
  titleMeta?: Record<string, string>;
  title?: SeasonTitle;
  lastSynced?: TimestampLike;
  lastActive?: TimestampLike;
  lastTradeTime?: TimestampLike;
  lastCheckin?: TimestampLike;
  [key: string]: unknown;
}

/** One entry in market/ipos.list. */
export interface IPO {
  ticker: string;
  ipoStartsAt: number;
  ipoEndsAt: number;
  sharesRemaining?: number;
  totalShares?: number;
  maxPerUser?: number;
  basePrice: number;
  [key: string]: unknown;
}

/** One row of a leaderboard. */
export interface LeaderRow {
  userId: string;
  portfolioValue?: number;
  marginUsed?: number;
  [key: string]: unknown;
}

/** users/{uid}/priceAlerts/{id}. */
export interface PriceAlert {
  id: string;
  ticker?: string;
  targetPrice?: number;
  direction?: string;
  triggered?: boolean;
  [key: string]: unknown;
}

/** An error thrown by a Firebase callable (or anything else caught). */
export interface CallableErrorLike {
  code?: string;
  message?: string;
}
