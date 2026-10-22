// Request/response shapes for the admin command panel's callables
// (functions/src/admin/adminPlayerFile.ts, adminDashboard.ts, adminMoneyFlow.ts,
// adminBulk.ts). Times are milliseconds.
import type { LedgerDay } from '../rules/ledgerFlow';
import type { UserData } from '../types';

export type Row = Record<string, unknown> & { id: string };

export interface PlayerNote {
  id: string;
  text: string;
  at: number;
  by: string;
}

export interface WelcomeStreakDoc {
  day?: number;
  lastClaimDay?: string | null;
  uid?: string;
  completedAt?: number;
}

export interface DiscordActivityDoc {
  discordId: string;
  username?: string | null;
  globalName?: string | null;
  lastAt?: number;
  lastCommand?: string;
  lastGuildId?: string | null;
  total?: number;
  counts?: Record<string, number>;
  lastByCommand?: Record<string, number>;
  firstAt?: number | null;
  linked?: { uid: string; displayName: string | null } | null;
}

export interface PlayerFileResponse {
  uid: string;
  user: UserData & Record<string, unknown>;
  auth: {
    email: string | null;
    emailVerified: boolean;
    disabled: boolean;
    providers: string[];
    createdAt: number | null;
    lastSignInAt: number | null;
    lastRefreshAt: number | null;
  } | null;
  ledger: Row[];
  trades: Row[];
  eventTrades: Row[];
  adminActions: Row[];
  giftsSent: Row[];
  giftsReceived: Row[];
  notes: PlayerNote[];
  welcome: WelcomeStreakDoc | null;
  discordActivity: DiscordActivityDoc | null;
  ladder: Record<string, unknown> | null;
  limitOrders: Row[];
  preMarketOrders: Row[];
  priceAlerts: Row[];
  watched: Record<string, unknown> | null;
  watchAlerts: Row[];
  history: Row[];
  notifications: Row[];
  confirmedManipulator?: boolean;
  /** discordBindings rows: id is the Discord ID, written on a self-unlink. */
  pastDiscords?: Row[];
}

export interface GuardLogEntry {
  at: number;
  ticker: string;
  from: number;
  to: number;
  reason: string;
  uids: string[];
}

export interface MarketGuardResponse {
  confirmed: { uid: string; name: string; at: number }[];
  candidates: {
    uid: string;
    name: string;
    flags: number;
    tight: number;
    last: number;
    confirmed: boolean;
    partners: { name: string; n: number }[];
  }[];
  guardLog: GuardLogEntry[];
  botsUpdatedAt: number | null;
}

export interface BotRun {
  at: number;
  moves: number;
  guard: number;
  picked: number;
  active: number;
}

export interface BotStock {
  ticker: string;
  name: string;
  price: number;
  kind: 'normal' | 'neglected' | 'neglected_still' | 'held' | null;
  phase: string;
  until: number;
  botDrift: number;
  holdDrift: number;
  movesToday: number;
}

export interface BotActivityResponse {
  updatedAt: number | null;
  runLog: BotRun[];
  moves: { at: number; ticker: string; from: number; to: number; guard: boolean }[];
  stocks: BotStock[];
}

export type MarketGuardRequest = { action: 'list' } | { action: 'set'; uid: string; confirmed: boolean };

export interface DashboardJob {
  job: string;
  label: string;
  last: number | null;
  maxAgeHours: number;
  late: boolean;
}

export interface DashboardResponse {
  generatedAt: number;
  players: {
    total: number | null;
    signups24h: number | null;
    signups7d: number | null;
    active24h: number | null;
    active7d: number | null;
    linked: number | null;
    banned: number | null;
  };
  welcome: { started: number | null; done: number | null };
  alerts: { open: number | null };
  jobs: DashboardJob[];
  today: LedgerDay | null;
  newest: { uid: string; displayName?: string; createdAt?: number; discordId?: string; isBanned?: boolean }[];
}

export type WelcomeStatus = 'done' | 'claimed_today' | 'due_today' | 'paused';

export interface WelcomeRow {
  discordId: string;
  uid: string | null;
  displayName: string | null;
  discordUsername: string | null;
  isBanned: boolean;
  day: number;
  lastClaimDay: string | null;
  completedAt: number | null;
  startedAt: number | null;
  paid: number;
  status: WelcomeStatus;
}

export interface WelcomeTrackerResponse {
  rows: WelcomeRow[];
  linked: number | null;
  days: number;
  rewards: number[];
  generatedAt: number;
}

export interface MoneyFlowResponse {
  days: LedgerDay[];
  generatedAt: number;
}

export interface DiscordActivityResponse {
  activity: DiscordActivityDoc[];
  unlinked: { discordId: string; username: string | null; globalName: string | null; joinedAt: number | null }[] | null;
  memberCount: number | null;
  linkedCount: number;
  generatedAt: number;
}

export type BulkActionRequest =
  | { action: 'cash'; uids: string[]; amount: number; memo: string }
  | { action: 'message'; uids: string[]; title: string; message: string; discord: boolean };

export interface BulkActionResponse {
  done: number;
  dms?: number;
  failed: { uid: string; reason: string }[];
}

/** adminCutAccount: the preview, or what was applied. Money in dollars. */
export interface CutAccountResponse {
  skipped: boolean;
  preview: boolean;
  before?: number;
  after?: number;
  cash?: number;
  newCash?: number;
  stocks?: number;
  newStocks?: number;
  debt?: number;
  newDebt?: number;
  event?: number;
  dropPercent?: number;
  /** The bell (and DM) text the player gets. */
  message: string | null;
  dmSent?: boolean;
}

export interface CoTraderPerson {
  uid: string;
  name: string | null;
  deleted: boolean;
}

export interface CoTradersResponse {
  days: number;
  /** The player's own trades in the window. */
  trades: number;
  rows: (CoTraderPerson & {
    /** Their trades that traded the same stock the same way within 10 minutes. */
    matches: number;
    ownTrades: number;
    sharedFlags: number;
    tickers: string[];
    value: number;
  })[];
  /** Shared a coordinated-pressure flag but never traded alongside in the window. */
  flagOnly: (CoTraderPerson & { sharedFlags: number })[];
}
