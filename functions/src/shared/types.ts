// Firestore document shapes the backend reads. Fields are added as typed code
// reads them, so a missing field here means nothing typed uses it yet.
import type { Timestamp } from 'firebase-admin/firestore';

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

/** ipoLockup[ticker] / marginLockup[ticker]: shares that cannot be sold until . */
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
  [field: string]: unknown;
}

/** ladderGame/{uid}: the ladder game balance. */
export interface LadderData {
  balance?: number;
  nonWithdrawable?: number;
  totalLost?: number;
  chipsMigrated?: boolean;
}
