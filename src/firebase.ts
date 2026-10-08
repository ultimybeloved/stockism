import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, TwitterAuthProvider, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// Fail loudly if required build-time settings are missing, so a misconfigured Vercel
// build throws a clear error instead of silently shipping a broken app to real users.
const REQUIRED_ENV = {
  VITE_FIREBASE_API_KEY: firebaseConfig.apiKey,
  VITE_FIREBASE_AUTH_DOMAIN: firebaseConfig.authDomain,
  VITE_FIREBASE_PROJECT_ID: firebaseConfig.projectId,
  VITE_FIREBASE_APP_ID: firebaseConfig.appId,
};
const missingEnv = Object.entries(REQUIRED_ENV)
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (missingEnv.length > 0) {
  throw new Error(`Missing required env vars: ${missingEnv.join(', ')}. Set them in the Vercel project settings.`);
}

const app = initializeApp(firebaseConfig);

// Sandbox mode: when running against the local Firebase emulators (started via
// `npm run dev:emulator`), point all services at localhost and skip App Check —
// reCAPTCHA can't validate localhost, and the emulator doesn't enforce it anyway.
// Off by default, so a plain `npm run dev` and all production builds keep using
// the real backend exactly as before.
const USE_EMULATOR = import.meta.env.VITE_USE_EMULATOR === 'true';

if (!USE_EMULATOR) {
  // Local dev: bypass App Check using a fixed debug token from .env.local.
  // Register the same UUID under Firebase Console → App Check → Apps → Manage
  // debug tokens. Pinning a fixed token (instead of `true`) prevents the SDK
  // from regenerating a new unregistered token on every reload.
  if (import.meta.env.DEV && import.meta.env.VITE_APPCHECK_DEBUG_TOKEN) {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      import.meta.env.VITE_APPCHECK_DEBUG_TOKEN;
  }

  if (!import.meta.env.VITE_RECAPTCHA_SITE_KEY) {
    throw new Error(
      'Missing VITE_RECAPTCHA_SITE_KEY — App Check cannot initialize. Set it in the Vercel project settings.',
    );
  }
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(import.meta.env.VITE_RECAPTCHA_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  });
}

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('email');
googleProvider.addScope('profile');
export const twitterProvider = new TwitterAuthProvider();
export const db = getFirestore(app);
export const functions = getFunctions(app);

if (USE_EMULATOR) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);

  console.warn('🧪 SANDBOX MODE — connected to local Firebase emulators, not production.');
}

// Cloud Functions
//
// Each callable is typed as callable<Request, Response>('name'). The shapes live in
// src/api/types.ts; a callable left as callable('name') has an untyped response
// until the code that reads it is converted.
import type * as Api from './api/types';

const callable = <Req = unknown, Res = unknown>(name: string) => httpsCallable<Req, Res>(functions, name);

export const createUserFunction = callable('createUser');
export const checkUsernameFunction = callable<{ displayName: string }, { available: boolean }>('checkUsername');
export const deleteAccountFunction = callable<{ confirmUsername: string }>('deleteAccount');
export const changeDisplayNameFunction = callable('changeDisplayName');
export const purchaseCosmeticFunction = callable<{ cosmeticId: string }>('purchaseCosmetic');
export const createBotsFunction = callable<Record<string, never>, Api.CreateBotsResponse>('createBots');
export const fixBasePriceCliffsFunction = callable<Record<string, never>, Api.FixCliffsResponse>('fixBasePriceCliffs');
export const triggerManualBackupFunction = callable<void, { filename?: string }>('triggerManualBackup');
export const listBackupsFunction = callable<void, { backups?: Api.BackupFile[]; total?: number }>('listBackups');
export const restoreBackupFunction = callable<{ backupName: string }, { tickersRestored?: number }>('restoreBackup');
export const broadcastNotificationFunction = callable<
  { title: string; message: string; predictionId?: string },
  { sent?: number }
>('broadcastNotification');
// Trade execution & anti-exploit
export const executeTradeFunction = callable<Api.ExecuteTradeRequest, Api.ExecuteTradeResponse>('executeTrade');
export const sweepDustPositionsFunction = callable<void, Api.SweepDustResponse>('sweepDustPositions');
export const banUserFunction = callable<{ userId: string; reason: string }>('banUser');
// Daily checkin
export const dailyCheckinFunction = callable<Record<string, never>, Api.DailyCheckinResponse>('dailyCheckin');
// Ladder game
export const playLadderGameFunction = callable<Api.PlayLadderRequest, Api.PlayLadderResponse>('playLadderGame');
export const depositToLadderGameFunction = callable<{ amount: number }>('depositToLadderGame');
export const withdrawFromLadderGameFunction = callable<{ amount: number }, Api.LadderWithdrawResponse>(
  'withdrawFromLadderGame',
);
export const getLadderLeaderboardFunction = callable<void, Api.LadderLeaderboardResponse>('getLadderLeaderboard');
export const triggerDailyMarketSummaryFunction = callable<Record<string, never>, Api.JobResult>(
  'triggerDailyMarketSummary',
);
export const triggerReviewChangesFunction = callable<Record<string, never>, { tickerCount?: number }>(
  'triggerReviewChanges',
);
export const triggerCollapseReviewHistoryFunction = callable<
  Record<string, never>,
  { tidied?: number; folded?: number }
>('triggerCollapseReviewHistory');
export const triggerDailyFreeStockFunction = callable<Record<string, never>, Api.JobResult>('triggerDailyFreeStock');
// Leaderboard
export const getLeaderboardFunction = callable<Api.GetLeaderboardRequest, Api.GetLeaderboardResponse>('getLeaderboard');
// Admin only: margin debt for the accounts on the board, kept out of the
// world-readable leaderboard cache.
export const getLeaderboardMarginsFunction = callable<Api.LeaderboardMarginsRequest, Api.LeaderboardMarginsResponse>(
  'getLeaderboardMargins',
);
export const getPublicProfileFunction = callable('getPublicProfile');
// Discord alert functions
export const achievementAlertFunction = callable<Api.AchievementAlertRequest>('achievementAlert');
export const ipoAnnouncementAlertFunction = callable<Api.IpoAnnouncementRequest>('ipoAnnouncementAlert');
// Data archiving functions
export const archivePriceHistoryFunction = callable<
  Record<string, never>,
  Api.JobResult & { archivedTickers?: number }
>('archivePriceHistory');
// Secure operations
export const claimMissionRewardFunction = callable<Api.ClaimMissionRewardRequest, Api.ClaimMissionRewardResponse>(
  'claimMissionReward',
);
export const rerollMissionsFunction = callable<void, Api.RerollMissionsResponse>('rerollMissions');
export const purchasePinFunction = callable<Api.PurchasePinRequest>('purchasePin');
export const placeBetFunction = callable<Api.PlaceBetRequest>('placeBet');
export const claimPredictionPayoutFunction = callable<
  Api.ClaimPredictionPayoutRequest,
  Api.ClaimPredictionPayoutResponse
>('claimPredictionPayout');
export const createLimitOrderFunction = callable('createLimitOrder');
export const createPreMarketOrderFunction = callable('createPreMarketOrder');
export const cancelPreMarketOrderFunction = callable('cancelPreMarketOrder');
export const buyIPOSharesFunction = callable<Api.BuyIPOSharesRequest>('buyIPOShares');
// Event prediction markets (long-term, AMM-priced)
export const buyEventSharesFunction = callable<Api.EventSharesRequest, Api.EventSharesResponse>('buyEventShares');
export const sellEventSharesFunction = callable<Api.EventSharesRequest, Api.EventSharesResponse>('sellEventShares');
export const triggerEventSettlementsFunction = callable<void>('triggerEventSettlements');
export const cancelEventMarketFunction = callable<{ marketId: string }, { refunded?: number; total?: number }>(
  'cancelEventMarket',
);
export const repayMarginFunction = callable<{ amount: number }, Api.RepayMarginResponse>('repayMargin');
export const bailoutFunction = callable<Record<string, never>, Api.BailoutResponse>('bailout');
export const leaveCrewFunction = callable<Record<string, never>, Api.CrewPenaltyResponse>('leaveCrew');
export const switchCrewFunction = callable<Api.SwitchCrewRequest, Api.CrewPenaltyResponse>('switchCrew');
export const toggleMarginFunction = callable<{ enable: boolean }>('toggleMargin');
export const chargeMarginInterestFunction = callable<Record<string, never>, Api.ChargeMarginInterestResponse>(
  'chargeMarginInterest',
);
// Server-side portfolio sync
export const claimCrewMissionFunction = callable<{ missionId: string }>('claimCrewMission');
export const syncPortfolioFunction = callable<void, Api.SyncPortfolioResponse>('syncPortfolio');
// Admin: remove achievement from user
export const removeAchievementFunction = callable<{ userId: string; achievementId: string }>('removeAchievement');
// Admin: reinstate bankrupt user
export const reinstateUserFunction = callable<{ userId: string }>('reinstateUser');
// Admin: directly set user cash (for account repairs)
export const adminSetCashFunction = callable<Api.AdminSetCashRequest, { previousCash: number; newCash: number }>(
  'adminSetCash',
);
// Admin: force-transfer cash <-> ladder game balance
export const adminTransferToLadderFunction = callable<
  { userId: string; amount: number },
  { newCash: number; newLadderBalance: number }
>('adminTransferToLadder');
// Admin: flag/clear the Discord-link wall on a user
export const adminSetDiscordWallFunction = callable<{ userId: string; value: boolean }, { alreadyLinked?: boolean }>(
  'adminSetDiscordWall',
);
// Admin: clear a user's Discord link so they can link a different one
export const adminUnlinkDiscordFunction = callable<{ userId: string }, { alreadyUnlinked?: boolean }>(
  'adminUnlinkDiscord',
);
// Admin: move a Discord link off a throwaway account onto the player's original one
export const adminMoveDiscordLinkFunction = callable<
  { sourceUserId: string; targetUserId: string },
  { alreadyMoved?: boolean; discordId?: string }
>('adminMoveDiscordLink');
// Admin: clear the delete-tombstone / unlink-binding holding a Discord ID hostage
export const adminFreeDiscordFunction = callable<
  { discordId: string },
  { clearedTombstone?: boolean; clearedBinding?: boolean }
>('adminFreeDiscord');
// Mints the single-use code that starts the Discord link flow (see useDiscordLink)
export const startDiscordLinkFunction = callable<void, Api.StartDiscordLinkResponse>('startDiscordLink');
// Disconnect your own Discord (Profile → Discord → Unlink)
export const unlinkOwnDiscordFunction = callable<void>('unlinkOwnDiscord');
// Admin: grant/revoke a cosmetic on a user (giveaways)
export const adminGrantCosmeticFunction = callable<{ userId: string; cosmeticId: string; revoke?: boolean }>(
  'adminGrantCosmetic',
);
// Admin: direct edits to one user's game state (see functions/services/adminUserEdit.js)
export const adminChangeDisplayNameFunction = callable<{ userId: string; displayName: string }>(
  'adminChangeDisplayName',
);
// Admin: 30-day return distribution, for calibrating season tier thresholds
export const adminReturnDistributionFunction = callable<Record<string, never>, Api.ReturnDistributionReport>(
  'adminReturnDistribution',
);
// Seasons — standings are public; the rest are admin-only
export const getSeasonStandingsFunction = callable<Record<string, never>, Api.SeasonStandingsResponse>(
  'getSeasonStandings',
);
export const adminStartSeasonFunction = callable<
  { name: string; preseason: boolean; countThisWeek: boolean },
  Api.StartSeasonResponse
>('adminStartSeason');
export const adminEndSeasonFunction = callable<Record<string, never>, Api.EndSeasonResponse>('adminEndSeason');
export const triggerSeasonCheckpointFunction = callable<Record<string, never>, Api.SeasonCheckpointResponse>(
  'triggerSeasonCheckpoint',
);
// Keeping repeat coordinators out of Platinum/Diamond — admin-only
export const getSeasonCoordFlagsFunction = callable<Record<string, never>, { players?: Api.SeasonCoordPlayer[] }>(
  'getSeasonCoordFlags',
);
export const setSeasonTopTierExclusionFunction = callable<{ uid: string; excluded: boolean }>(
  'setSeasonTopTierExclusion',
);
export const getCoordProfitFunction = callable<{ uid: string }, Api.CoordProfitResponse>('getCoordProfit');
export const adminRemoveCoordProfitFunction = callable<Api.RemoveCoordProfitRequest, Api.CoordRemovalPreview>(
  'adminRemoveCoordProfit',
);
// Season dry runs — the weekly rehearsal that runs while no season is on
export const triggerSeasonDryRunFunction = callable<Record<string, never>, { ran?: boolean; reason?: string }>(
  'triggerSeasonDryRun',
);
export const adminSeasonDryRunReportFunction = callable<Record<string, never>, Api.SeasonDryRunReport>(
  'adminSeasonDryRunReport',
);
export const adminSetCrewFunction = callable<{ userId: string; crewId: string | null }, { unchanged?: boolean }>(
  'adminSetCrew',
);
export const adminGrantAchievementFunction = callable<
  { userId: string; achievementId: string },
  { alreadyEarned?: boolean }
>('adminGrantAchievement');
export const adminSetMarginFunction = callable<
  { userId: string; enabled: boolean; clearDebt: boolean },
  { marginEnabled?: boolean; clearedDebt?: boolean; previousMarginUsed: number }
>('adminSetMargin');
export const adminSetHoldingFunction = callable<
  { userId: string; ticker: string; shares: number; costBasis: number | null },
  { previousShares: number; shares: number }
>('adminSetHolding');
// Admin: repair spike victim accounts
export const repairSpikeVictimsFunction = callable<Api.SpikeRepairRequest, Api.SpikeRepairResponse>(
  'repairSpikeVictims',
);
// Admin: rename ticker across all data
export const renameTickerFunction = callable<Api.RenameTickerRequest, Api.RenameTickerResponse>('renameTicker');
export const splitStockFunction = callable<Api.SplitStockRequest, Api.SplitStockResponse>('splitStock');
export const setMarketHaltFunction = callable<{ halted: boolean; reason: string }>('setMarketHalt');
// Admin: watchlist management
export const addWatchedUserFunction = callable<
  { userId: string; reason: string; maxAccountsPerIP: number },
  { displayName?: string; knownIPCount?: number }
>('addWatchedUser');
export const removeWatchedUserFunction = callable<{ userId: string }>('removeWatchedUser');
export const linkAltAccountFunction = callable<{ watchedUserId: string; altAccountId: string }, { altName?: string }>(
  'linkAltAccount',
);
export const addWatchedIPFunction = callable<{ userId: string; ip: string }>('addWatchedIP');
export const getWatchlistFunction = callable<void, Api.WatchlistResponse>('getWatchlist');
export const getIpTrackingHealthFunction = callable<void, Api.IpHealthReport>('getIpTrackingHealth');
export const getRecentSignupReportFunction = callable<{ hoursBack: number }, Api.SignupReport>('getRecentSignupReport');
// Admin: proactive alt detection
export const triggerAltScanFunction = callable<{ dryRun: boolean }, Api.AltScanResponse>('triggerAltScan');
export const reviewWatchlistAlertFunction = callable<{ alertId: string }>('reviewWatchlistAlert');
// Price alerts
export const createPriceAlertFunction = callable<Api.CreatePriceAlertRequest>('createPriceAlert');
export const deletePriceAlertFunction = callable<{ alertId: string }>('deletePriceAlert');
// Admin: ticker rollback diagnostic
export const diagnoseTickerRollbackFunction = callable<
  { ticker: string; startTimestamp: number },
  Api.TickerDiagnosticResponse
>('diagnoseTickerRollback');
// Admin: ticker recovery (clawback + price reset)
export const recoverTickerFunction = callable<Api.TickerRecoveryRequest, Api.TickerRecoveryResponse>('recoverTicker');
// Admin: drop audit
export const auditUserDropsFunction = callable<{ uid?: string; username?: string }, Api.DropAuditResponse>(
  'auditUserDrops',
);
// Dividends
export const runDividendPayoutNowFunction = callable<void, Api.DividendRunResponse>('runDividendPayoutNow');
// Username reservation audit + portfolio-history repair
export const auditUsernamesFunction = callable<Record<string, never>, Api.AuditUsernamesResponse>('migrateUsernames');
export const reconstructPortfolioHistoryFunction = callable<
  { uid?: string; startAfterUid?: string },
  Api.ReconstructHistoryResponse
>('reconstructPortfolioHistory');
// Admin: initialize prices for new characters
export const initNewCharacterPricesFunction = callable<void, { initialized: { ticker: string }[]; message: string }>(
  'initNewCharacterPrices',
);
// Admin: recompute crew underdog multipliers (+ optionally re-post Discord rankings)
export const triggerWeeklyCrewRankingsFunction = callable<
  { skipDiscord?: boolean; rolesOnly?: boolean; dryRun?: boolean },
  Api.CrewRankingsResponse
>('triggerWeeklyCrewRankings');
// Admin: re-post the weekly market report to Discord now
export const triggerWeeklyMarketSummaryFunction = callable<
  Record<string, never>,
  Api.JobResult & { posted?: boolean; weeklyTrades?: number; activeUsers?: number }
>('triggerWeeklyMarketSummary');
// Admin: write the trade records that old limit/stop-loss/pre-market fills never wrote
export const backfillFillTradeRecordsFunction = callable<
  Record<string, never>,
  { limitOrders?: { written?: number }; preMarketOrders?: { written?: number } }
>('backfillFillTradeRecords');

// Admin: Discord message manager (post / edit / delete bot messages from the panel)
export const adminListDiscordChannelsFunction = callable<void, { channels?: Api.DiscordChannel[]; reason?: string }>(
  'adminListDiscordChannels',
);
export const adminListDiscordMessagesFunction = callable<void, { messages?: Api.TrackedDiscordMessage[] }>(
  'adminListDiscordMessages',
);
export const adminSendDiscordMessageFunction = callable<
  Api.DiscordMessagePayload,
  { message: Api.TrackedDiscordMessage }
>('adminSendDiscordMessage');
export const adminUpdateDiscordMessageFunction = callable<
  Api.DiscordMessagePayload & { id: string },
  { message: Api.TrackedDiscordMessage }
>('adminUpdateDiscordMessage');
export const adminDeleteDiscordMessageFunction = callable<{ id: string; forget: boolean }>('adminDeleteDiscordMessage');
export const adminImportDiscordMessageFunction = callable<
  { channelId: string; messageId: string; label?: string },
  { message: Api.TrackedDiscordMessage; alreadyTracked?: boolean }
>('adminImportDiscordMessage');

// Admin: read the cash adjustment audit log
export const adminListCashLogFunction = callable<Record<string, never>, Api.CashLogResponse>('adminListCashLog');

export default app;
