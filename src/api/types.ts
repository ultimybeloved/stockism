// Request and response shapes for the Cloud Function callables in src/firebase.ts.
// Each type lists the fields the frontend sends or reads. The backend is the
// source of truth: when a callable's handler changes, update its shape here.

export interface SyncPortfolioResponse {
  newAchievements?: string[];
}

export interface AchievementAlertRequest {
  achievementId: string;
  achievementName: string;
  achievementDescription: string;
}

export interface ClaimPredictionPayoutRequest {
  predictionId: string;
}

export interface ClaimPredictionPayoutResponse {
  won: boolean;
  payout: number;
}

export interface ChargeMarginInterestResponse {
  charged: number;
}

export interface StartDiscordLinkResponse {
  state?: string;
}

export interface SweepDustResponse {
  swept?: number;
  proceeds?: number;
}

export interface BuyIPOSharesRequest {
  ticker: string;
  quantity: number;
}

export interface DailyCheckinResponse {
  reward: number;
  newStreak: number;
  ladderTopUpAmount: number;
  totalCheckins: number;
}

export interface BailoutResponse {
  hadCrew?: boolean;
}

export interface CreatePriceAlertRequest {
  ticker: string;
  targetPrice: number;
  direction: 'above' | 'below' | string;
}

export interface SwitchCrewRequest {
  crewId: string;
  isSwitch: boolean;
}

export interface CrewPenaltyResponse {
  totalTaken: number;
  freeSwitch?: boolean;
}

export interface RepayMarginResponse {
  repaid: number;
  remaining: number;
}

export interface PurchasePinRequest {
  action: 'buyPin' | 'buySlot';
  pinId?: string;
  slotType?: string;
}

export interface ClaimMissionRewardRequest {
  missionId: string;
  type: 'daily' | 'weekly';
  reward: number;
}

export interface ClaimMissionRewardResponse {
  newTotal: number;
}

export interface RerollMissionsResponse {
  rerollSeed: number;
}

export interface PlaceBetRequest {
  predictionId: string;
  option: string;
  amount: number;
}

export interface EventSharesRequest {
  marketId: string;
  outcome: string;
  shares: number;
}

export interface EventSharesResponse {
  cost?: number;
  refund?: number;
  [key: string]: unknown;
}

export interface GetLeaderboardRequest {
  sortBy: string;
  crew?: string;
}

export interface GetLeaderboardResponse {
  leaderboard?: import('../types').LeaderRow[];
  callerRank?: number | null;
}

export interface ExecuteTradeRequest {
  ticker: string;
  action: string;
  amount: number;
  /** Admin only: place the trade on this player's account. */
  actAsUid?: string;
}

export interface ExecuteTradeResponse {
  executionPrice: number;
  priceImpact: number;
  totalCost?: number;
  remainingDailyImpact: number;
  isLastTrade?: boolean;
  shortWarning?: string;
}

export type LadderSide = 'left' | 'right';
export type LadderOutcome = 'odd' | 'even';

export interface PlayLadderRequest {
  startSide: LadderSide;
  bet: LadderOutcome;
  amount: number;
}

export interface PlayLadderResponse {
  rungs: number[];
  result: LadderOutcome;
  won: boolean;
  payout: number;
  newBalance: number;
  currentStreak: number;
}

export interface LadderWithdrawResponse {
  grossAmount?: number;
  totalTax?: number;
  netReceived?: number;
}

export interface LadderLeaderboardResponse {
  leaderboard?: { [key: string]: unknown }[];
}

/** One suspicious account pair from the alt scan. */
export interface AltScanFinding {
  key: string;
  names?: string[];
  severity?: 'high' | string;
  sharedNetworks?: number;
  exclusiveNetworks?: number;
  sharedTickers?: string[];
  sameCrew?: boolean;
  alreadyBanned?: boolean;
}

export interface AltScanResponse {
  scanned: number;
  candidates: number;
  reported: number;
  dryRun?: boolean;
  findings?: AltScanFinding[];
}

export interface SeasonCoordPlayer {
  uid: string;
  name: string;
  excluded?: boolean;
  /** How many coordination alerts named them this season. */
  flags: number;
  tickers: string[];
  partners: { name: string; n: number }[];
}

// ---- Admin tools ----
// Admin results are shown field-by-field in the admin tabs; each type lists the
// fields code reads, and the index signature covers the rest until those tabs
// are converted.

export interface CashLogEntry {
  id: string;
  at?: number;
  userId?: string;
  displayName?: string;
  memo?: string;
  delta: number;
  [key: string]: unknown;
}

export interface CashLogResponse {
  entries?: CashLogEntry[];
  totals?: { [key: string]: unknown } | null;
}

export interface DropAuditResponse {
  uid: string;
  displayName?: string;
  cash: number;
  totalClaims: number;
  expectedClaims: number;
  excessClaims: number;
  firstClaimDate?: string;
  totalGiftedValue: number;
  claimsByDay: Record<string, number>;
  suspiciousDays: { day: string; count: number }[];
  giftedSharesByTicker: Record<string, { shares: number; price: number; value: number }>;
}

export interface SignupMember {
  uid: string;
  displayName?: string;
  email?: string;
  createdAt?: number;
  hasDiscord?: boolean;
  isBanned?: boolean;
  requiresDiscordLink?: boolean;
  signupIp?: string;
}

export interface SignupCluster {
  key: string;
  count: number;
  members: SignupMember[];
}

export interface SignupReport {
  windowHours: number;
  totalSignups: number;
  clustersByIp: SignupCluster[];
  clustersByDomain: SignupCluster[];
  clustersByGmail: SignupCluster[];
}

/** One row of the 30-day return distribution: everyone, or one size division. */
export interface ReturnDistributionRow {
  id: string;
  label: string;
  min?: number;
  max?: number | null;
  count: number;
  cuts?: Record<string, number | null>;
  median?: number | null;
  positive: number;
  excessCuts?: Record<string, number | null>;
  excessMedian?: number | null;
  beatMarket: number;
}

export interface ReturnDistributionReport {
  overall: Omit<ReturnDistributionRow, 'id' | 'label'>;
  divisions: ReturnDistributionRow[];
  totalDocs: number;
  minBaseline: number;
  marketLast30?: number;
  skipped: { staleWindow: number; noSnapshot: number; belowBaseline: number; bots: number; banned: number };
  grantCoverage?: { exact: number; lowerBound: number; none: number; grantedTotal: number };
}

/** One player as the season dry run would score them. */
export interface DryRunPlayer {
  uid: string;
  name: string;
  division: string;
  returnPercent: number;
  excess: number;
  beatWeeks: number;
  weeks: number;
  peakConcentration: number;
  tier: string | null;
}

export interface SeasonDryRunReport {
  weeks: number;
  reports: number;
  from?: string;
  to?: string;
  players?: number;
  marketPercent?: number;
  belowFloor?: number;
  divisions?: { id: string; label: string; players: number; platinum: number; diamond: number }[];
  tierCounts: Record<string, number>;
  scored: DryRunPlayer[];
}

export interface TickerDiagnosticResponse {
  summary: { totalTrades: number; [key: string]: unknown };
  [key: string]: unknown;
}

export interface TickerRecoveryRequest {
  ticker: string;
  startTimestamp: number;
  rollbackToTimestamp: number;
  dryRun: boolean;
}

export interface TickerRecoveryResponse {
  totalClawedBack: number;
  priceReset: { to: number; [key: string]: unknown };
  [key: string]: unknown;
}

/** One flagged push a player traded in, and what it made them. */
export interface CoordPush {
  ticker: string;
  days: string[];
  lockedIn: number;
  gainSince: number;
  trades: number;
}

export interface CoordProfitResponse {
  suggested: number;
  pushes: CoordPush[];
  preview?: CoordRemovalPreview | null;
  preferTickers?: string[];
}

/** What removing an amount would take (or took): shares first, then cash, then margin debt. */
export interface CoordRemovalPreview {
  amount?: number;
  shares: { ticker: string; shares: number }[];
  fromCash: number;
  toDebt: number;
  equityRatioAfter: number;
  marginCallLine: number;
}

export interface RemoveCoordProfitRequest {
  uid: string;
  amount: number;
  memo?: string;
  preview?: boolean;
  preferTickers?: string[];
}

export interface CreateBotsResponse {
  created: number;
  skipped: number;
}

export interface SpikeVictim {
  userId: string;
  displayName: string;
  currentCash?: number;
  correctedCash?: number;
  isBankrupt?: boolean;
  tookBailout?: boolean;
  reason?: string;
  totalTrades?: number;
  bankruptAt?: number;
  holdingsCount?: number;
  holdingsToRestore?: Record<string, number>;
  trades?: {
    action?: string;
    ticker?: string;
    shares?: number;
    price?: number;
    cashBefore?: number;
    cashAfter?: number;
    pnl?: number;
    timestamp?: number;
  }[];
}

export interface SpikeRepairRequest {
  mode: 'scan' | 'repair' | 'repairAll' | 'diagnose';
  userId?: string;
  userIds?: string[];
  victims?: SpikeVictim | SpikeVictim[];
}

/** One player's diagnosis from the spike-repair tool. */
export interface SpikeDiagnosis {
  userId: string;
  success?: boolean;
  error?: string;
  displayName?: string;
  cash?: number;
  portfolioValue?: number;
  isBankrupt?: boolean;
  bankruptAt?: number;
  lastBailout?: number;
  holdings?: Record<string, number>;
  shorts?: Record<string, number | { shares?: number }>;
  totalTrades?: number;
  recentTrades?: {
    action?: string;
    ticker?: string;
    amount?: number;
    price?: number;
    cashBefore?: number;
    cashAfter?: number;
    pnl?: number;
    timestamp?: number;
  }[];
}

export interface SpikeRepairResponse {
  victims?: SpikeVictim[];
  results?: SpikeDiagnosis[];
}

export interface PreflightCheck {
  id: string;
  label: string;
  pass: boolean;
  detail?: string;
}

/** What renameTicker returns from a dry run, an execute, or a resume. */
export interface RenameTickerRequest {
  oldTicker: string;
  newTicker: string;
  mode: 'dryRun' | 'execute' | 'resume' | 'abort';
}

export interface RenameTickerResponse {
  success?: boolean;
  paused?: boolean;
  nextPhase?: string;
  alreadyComplete?: boolean;
  dryRun?: boolean;
  blocked?: boolean;
  oldTicker?: string;
  newTicker?: string;
  breakdown?: Record<string, number>;
  notRewritten?: string[];
  checks?: PreflightCheck[];
  [key: string]: unknown;
}

/** market/renameJournal: progress of the rename in flight, if any. */
export interface RenameJournal {
  old?: string;
  new?: string;
  status?: string;
  lastError?: string;
  phases?: Record<string, { status?: string; done?: number }>;
}

export interface AdminSetCashRequest {
  userId: string;
  mode: 'add' | 'subtract' | 'set';
  amount: number;
  memo: string;
}

export interface IpoAnnouncementRequest {
  ticker: string;
  characterName: string;
  ipoPrice: number;
  postIpoPrice: number;
  startsAt: number;
  endsAt: number;
  totalShares: number;
  maxPerUser: number;
}

export interface DividendRunResponse {
  usersPaid: number;
  usersConsidered: number;
  totalPaid?: number;
  [key: string]: unknown;
}

export interface FixCliffsResponse {
  tickersFixed: number;
  tickersSkipped: number;
  fixed?: { ticker: string; percentChange: number }[];
}

export interface SplitStockRequest {
  ticker: string;
  ratio: number;
  mode: 'dryRun' | 'execute' | 'resume' | 'abort';
}

export interface SplitStockResponse {
  ticker?: string;
  ratio?: number;
  priceNow?: number;
  dryRun?: boolean;
  blocked?: boolean;
  success?: boolean;
  paused?: boolean;
  nextPhase?: string;
  alreadyComplete?: boolean;
  breakdown?: { holders: number; shorts: number; limitOrders: number; priceAlerts: number; trades: number };
  checks?: PreflightCheck[];
  [key: string]: unknown;
}

export interface StartSeasonResponse {
  preseason?: boolean;
  number?: number;
  name: string;
  playersPinned: number;
  [key: string]: unknown;
}

export interface EndSeasonResponse {
  tierCounts?: Record<string, number>;
  totalScored: number;
  awarded: number;
}

export interface SeasonCheckpointResponse {
  ran: boolean;
  weeks?: number;
  scored?: number;
  promoted?: number;
  reason?: string;
}

/** Shape-only results the admin tabs render; fields typed as the tabs convert. */
export type AdminReport = { [key: string]: unknown };

export interface WatchlistResponse {
  watchedUsers?: AdminReport[];
  alerts?: AdminReport[];
}

export interface AuditUsernamesResponse {
  reservationsWritten: number;
  usersUpdated: number;
  conflicts: unknown[];
}

export interface ReconstructHistoryResponse {
  usersProcessed?: number;
  usersSkipped?: number;
  totalPointsWritten?: number;
  errors?: number;
  done?: boolean;
  nextCursor?: string | null;
}

/** What the manual-trigger callables for scheduled jobs return. */
export interface JobResult {
  success?: boolean;
  error?: string;
}

export interface CrewRankingsResponse {
  multipliers?: Record<string, number>;
  configured?: boolean;
  problems?: string[];
  configuredCount?: number;
  added?: number;
  removed?: number;
}

export interface DiscordChannel {
  id: string;
  name?: string;
  [key: string]: unknown;
}

export interface DiscordMessagePayload {
  channelId: string;
  channelName: string;
  label: string;
  content: string;
  embed: import('../hooks/admin/discordDraft').DraftEmbed | null;
  buttons: import('../hooks/admin/discordDraft').DraftButton[];
  allowMentions: boolean;
}

/** A tracked bot message as the server returns it. */
export type TrackedDiscordMessage = import('../hooks/admin/discordDraft').StoredDiscordMessage & {
  messageId?: string;
  imported?: boolean;
  channelName?: string;
  updatedAt?: number;
  [key: string]: unknown;
};

export interface LeaderboardMarginsRequest {
  userIds: string[];
}

export interface LeaderboardMarginsResponse {
  margins?: Record<string, number>;
}
