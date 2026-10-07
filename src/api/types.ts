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

export interface LeaderboardMarginsRequest {
  userIds: string[];
}

export interface LeaderboardMarginsResponse {
  margins?: Record<string, number>;
}
