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
  | { toMillis: () => number; seconds?: number }
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

/** An error thrown by a Firebase callable (or anything else caught). */
export interface CallableErrorLike {
  code?: string;
  message?: string;
}
