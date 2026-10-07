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

export interface LeaderboardMarginsRequest {
  userIds: string[];
}

export interface LeaderboardMarginsResponse {
  margins?: Record<string, number>;
}
