// Firestore document shapes the backend reads. Fields are added as typed code
// reads them, so a missing field here means nothing typed uses it yet.
import type { Timestamp } from 'firebase-admin/firestore';
import type { ActionHistory } from './impact';

/** A stored moment: a Firestore Timestamp, epoch ms, or an ISO string on older docs. */
export type StoredTime = Timestamp | number | string;

/** One purchase lot in the dividend / exit-loyalty ledger. */
export interface CohortLot {
  shares: number;
  availableAt?: number;
}

/** holdingCohorts[ticker]. Invariant: eligible + sum(pending.shares) === holdings[ticker]. */
export interface Cohort {
  eligible?: number;
  pending?: CohortLot[];
  firstHeldAt?: number;
  [field: string]: unknown;
}

/** ipoLockup[ticker] / marginLockup[ticker]: shares that cannot be sold until `until`. */
export interface Lockup {
  shares?: number;
  until?: number;
}

/** One transactionLog entry (the last 100 actions on the user doc). */
export interface TxLogEntry {
  type: string;
  timestamp?: number;
  totalCost?: number;
  totalRevenue?: number;
  [field: string]: unknown;
}

/** shorts[ticker]. v2 shorts post 100% collateral; legacy ones were paid proceeds up front. */
export interface ShortPosition {
  shares: number;
  margin?: number;
  costBasis?: number;
  system?: string;
  entryPrice?: number;
  openedAt?: unknown;
  [field: string]: unknown;
}

/** One daily grantedSamples entry: cumulative grantedValue at `ts`. */
export interface GrantedSample {
  ts: number;
  total?: number;
}

/** One point on a ticker's price chart (priceHistory[ticker]). */
export interface PricePoint {
  timestamp: number;
  price: number;
  source?: string;
  [field: string]: unknown;
}

/** limitOrders/{orderId}. Stop losses are type STOP_LOSS. */
export interface LimitOrder {
  userId: string;
  ticker: string;
  type: 'BUY' | 'SELL' | 'SHORT' | 'COVER' | 'STOP_LOSS';
  shares: number;
  limitPrice?: number;
  allowPartialFills?: boolean;
  status?: string;
  filledShares?: number;
  createdAt?: StoredTime;
  expiresAt?: number;
  [field: string]: unknown;
}

/** One size division of a season board. max null = no ceiling. */
// Season rules and divisions: defined in the shared rule module rules/seasons.
export type { SeasonDivision, SeasonRules } from './rules/seasons';
import type { SeasonRules } from './rules/seasons';

/** market/season. */
export interface SeasonDoc {
  id: string;
  number?: number;
  name?: string;
  status?: string;
  preseason?: boolean;
  preseasons?: number;
  startedAt?: number;
  indexAtStart?: number;
  checkpointWeeks?: unknown[];
  rules?: Partial<SeasonRules>;
  [field: string]: unknown;
}

/** users/{uid}.seasonBaseline: where a player's season is measured from. */
export interface SeasonBaseline {
  seasonId: string;
  value: number;
  ladder?: number;
  granted?: number;
  grantedDays?: number;
  ladderFlow?: number;
  predictionFlow?: number;
  index?: number;
  pinnedAt?: number;
}

/** users/{uid}.seasonMargin: dollar-days owed on margin, as a running tally. */
export interface MarginTally {
  seasonId: string;
  dd: number;
  amount: number;
  at: number;
}

/**
 * One weekly season record. v net equity, g granted since baseline, x index,
 * c largest character, h all characters, d margin dollar-days, a grantedDays,
 * f side-game flows, t when, w week, s season id.
 */
export interface WeekRecord {
  s: string;
  w: number;
  t: number;
  v: number;
  g?: number;
  x: number;
  c: number;
  h: number;
  d?: number;
  a?: number;
  f?: number;
}

/** users/{uid}. */
export interface UserData {
  createdAt?: StoredTime;
  lastSynced?: StoredTime;
  lastActive?: StoredTime;
  lastTradeTime?: StoredTime;
  lastCheckin?: StoredTime;
  isBot?: boolean;
  isBanned?: boolean;
  isBankrupt?: boolean;
  requiresDiscordLink?: boolean;
  discordId?: string | null;
  crew?: string | null;
  cash?: number;
  holdings?: Record<string, number>;
  shorts?: Record<string, ShortPosition | null | undefined>;
  marginUsed?: number;
  portfolioValue?: number;
  grantedValue?: number;
  grantedSamples?: GrantedSample[];
  costBasis?: Record<string, number>;
  lowestWhileHolding?: Record<string, number>;
  profitByTicker?: Record<string, number>;
  lastHeavySell?: Record<string, Timestamp | number>;
  lastHeavyExit?: Record<string, Timestamp | number>;
  holdingCohorts?: Record<string, Cohort>;
  ipoLockup?: Record<string, Lockup>;
  marginLockup?: Record<string, Lockup>;
  transactionLog?: TxLogEntry[];
  displayName?: string;
  achievements?: string[];
  npcProfit?: number;
  marginEnabled?: boolean;
  peakPortfolioValue?: number;
  tickerTradeHistory?: Record<string, ActionHistory>;
  shortHistory?: Record<string, number[]>;
  lastBuyTime?: Record<string, Timestamp | number>;
  lastTickerTradeTime?: Record<string, Timestamp | number>;
  grantedDays?: number;
  ladderFlowValue?: number;
  predictionFlowValue?: number;
  seasonBaseline?: SeasonBaseline;
  seasonMargin?: MarginTally;
  seasonWeeks?: WeekRecord[];
  seasonTier?: { seasonId: string; tier: string };
  seasonActiveWeeks?: { seasonId: string; weeks?: number; lastWeek?: number | null };
  seasonTopTierExclusion?: { seasonId: string; at?: number };
  [field: string]: unknown;
}

/** ladderGame/{uid}: the ladder game balance. */
export interface LadderData {
  balance?: number;
  nonWithdrawable?: number;
  totalLost?: number;
  chipsMigrated?: boolean;
}
