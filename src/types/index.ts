// Shared domain types for the frontend. These describe the Firestore documents
// the app reads (market/current, users/{uid}, ...) and the shapes passed between
// hooks and components. Fields are added here as files are converted; anything
// not listed yet is reachable through the index signatures on the doc types.

import type { HoldingCohort } from '../characters';
import type { SeasonBaseline, SeasonWeekRecord } from '../utils/seasonWeeks';

/** users/{uid}.seasonBaseline: the player's numbers when the season pinned them. */
export interface SeasonBaselineDoc extends SeasonBaseline {
  seasonId?: string;
  index?: number;
  granted?: number;
  ladderFlow?: number;
  grantedDays?: number;
  predictionFlow?: number;
}

/** market/season. */
export interface SeasonDoc {
  id: string;
  status: string;
  startedAt: number;
  indexAtStart?: number;
  number?: number;
  preseason?: boolean;
  preseasons?: number;
  rules?: Partial<import('../constants/seasons').SeasonRules>;
  [key: string]: unknown;
}

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

/** One entry in a user's legacy transactionLog (kept for admin analytics). */
export interface LoggedTransaction {
  type: string;
  ticker?: string;
  timestamp: number;
  shares?: number;
  amount?: number;
  pricePerShare?: number;
  price?: number;
  entryPrice?: number;
  totalCost?: number;
  totalRevenue?: number;
  marginRequired?: number;
  cashBack?: number;
  priceImpact?: number;
  newPrice?: number;
  profit?: number;
}

/** users/{uid}.bets[predictionId]. */
export interface UserBet {
  option?: string;
  amount?: number;
  placedAt?: number;
  question?: string;
  paid?: boolean;
  payout?: number;
  [key: string]: unknown;
}

/** users/{uid}.dailyMissions[date] / weeklyMissions[weekId]. */
export interface MissionDayState {
  claimed?: Record<string, boolean>;
  [key: string]: unknown;
}

/** users/{uid}. Only the fields typed code reads so far are listed. */
export interface UserData {
  displayName?: string;
  /** Pre-2026 accounts only; displayName replaced it. */
  username?: string;
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
  bets?: Record<string, UserBet>;
  transactionLog?: LoggedTransaction[];
  isBot?: boolean;
  lastSyncedAt?: TimestampLike;
  lastMarginInterestCharge?: number;
  ipoPurchases?: Record<Ticker, number>;
  watchlist?: Ticker[];
  drip?: Record<Ticker, boolean>;
  crewSwitchCooldown?: number;
  ladderTutorial2Completed?: boolean;
  displayedAchievementPins?: unknown;
  displayedShopPins?: unknown;
  displayCrewPin?: boolean;
  predictionWins?: number;
  portfolioValue?: number;
  grantedValue?: number;
  grantedDays?: number;
  ladderFlowValue?: number;
  predictionFlowValue?: number;
  seasonBaseline?: SeasonBaselineDoc;
  seasonMargin?: { seasonId?: string; dd?: number; amount?: number; at?: number };
  seasonTier?: { seasonId?: string; tier?: string };
  seasonActiveWeeks?: { seasonId?: string; weeks?: number };
  seasonWeeks?: SeasonWeekRecord[];
  seasonTopTierExclusion?: { seasonId?: string };
  ownedShopPins?: string[];
  isCrewHead?: boolean;
  holdingCohorts?: Record<Ticker, HoldingCohort>;
  dailyMissions?: Record<string, MissionDayState>;
  weeklyMissions?: Record<string, MissionDayState & { rerolled?: boolean; rerollSeed?: number }>;
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

/** One entry in predictions/current.list: a weekly bet pool, or an event market (type 'event'). */
export interface PredictionDoc {
  id: string;
  type?: string;
  question?: string;
  options?: string[];
  resolved?: boolean;
  endsAt?: number;
  [key: string]: unknown;
}

/** One line in the announcement bar (config/siteMessages.messages). */
export interface SiteMessage {
  id: string;
  text: string;
  link: string;
  tone: string;
  active: boolean;
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
  priceJumped?: boolean;
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
