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
}

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
