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
export const checkUsernameFunction = callable('checkUsername');
export const deleteAccountFunction = callable<{ confirmUsername: string }>('deleteAccount');
export const changeDisplayNameFunction = callable('changeDisplayName');
export const purchaseCosmeticFunction = callable('purchaseCosmetic');
export const createBotsFunction = callable('createBots');
export const fixBasePriceCliffsFunction = callable('fixBasePriceCliffs');
export const triggerManualBackupFunction = callable('triggerManualBackup');
export const listBackupsFunction = callable('listBackups');
export const restoreBackupFunction = callable('restoreBackup');
export const broadcastNotificationFunction = callable('broadcastNotification');
// Trade execution & anti-exploit
export const executeTradeFunction = callable('executeTrade');
export const sweepDustPositionsFunction = callable<void, Api.SweepDustResponse>('sweepDustPositions');
export const banUserFunction = callable('banUser');
// Daily checkin
export const dailyCheckinFunction = callable<Record<string, never>, Api.DailyCheckinResponse>('dailyCheckin');
// Ladder game
export const playLadderGameFunction = callable('playLadderGame');
export const depositToLadderGameFunction = callable('depositToLadderGame');
export const withdrawFromLadderGameFunction = callable('withdrawFromLadderGame');
export const getLadderLeaderboardFunction = callable('getLadderLeaderboard');
export const triggerDailyMarketSummaryFunction = callable('triggerDailyMarketSummary');
export const triggerReviewChangesFunction = callable('triggerReviewChanges');
export const triggerCollapseReviewHistoryFunction = callable('triggerCollapseReviewHistory');
export const triggerDailyFreeStockFunction = callable('triggerDailyFreeStock');
// Leaderboard
export const getLeaderboardFunction = callable('getLeaderboard');
// Admin only: margin debt for the accounts on the board, kept out of the
// world-readable leaderboard cache.
export const getLeaderboardMarginsFunction = callable<Api.LeaderboardMarginsRequest, Api.LeaderboardMarginsResponse>(
  'getLeaderboardMargins',
);
export const getPublicProfileFunction = callable('getPublicProfile');
// Discord alert functions
export const achievementAlertFunction = callable<Api.AchievementAlertRequest>('achievementAlert');
export const ipoAnnouncementAlertFunction = callable('ipoAnnouncementAlert');
// Data archiving functions
export const archivePriceHistoryFunction = callable('archivePriceHistory');
// Secure operations
export const claimMissionRewardFunction = callable('claimMissionReward');
export const rerollMissionsFunction = callable('rerollMissions');
export const purchasePinFunction = callable('purchasePin');
export const placeBetFunction = callable('placeBet');
export const claimPredictionPayoutFunction = callable<
  Api.ClaimPredictionPayoutRequest,
  Api.ClaimPredictionPayoutResponse
>('claimPredictionPayout');
export const createLimitOrderFunction = callable('createLimitOrder');
export const createPreMarketOrderFunction = callable('createPreMarketOrder');
export const cancelPreMarketOrderFunction = callable('cancelPreMarketOrder');
export const buyIPOSharesFunction = callable<Api.BuyIPOSharesRequest>('buyIPOShares');
// Event prediction markets (long-term, AMM-priced)
export const buyEventSharesFunction = callable('buyEventShares');
export const sellEventSharesFunction = callable('sellEventShares');
export const triggerEventSettlementsFunction = callable('triggerEventSettlements');
export const cancelEventMarketFunction = callable('cancelEventMarket');
export const repayMarginFunction = callable<{ amount: number }, Api.RepayMarginResponse>('repayMargin');
export const bailoutFunction = callable<Record<string, never>, Api.BailoutResponse>('bailout');
export const leaveCrewFunction = callable<Record<string, never>, Api.CrewPenaltyResponse>('leaveCrew');
export const switchCrewFunction = callable<Api.SwitchCrewRequest, Api.CrewPenaltyResponse>('switchCrew');
export const toggleMarginFunction = callable<{ enable: boolean }>('toggleMargin');
export const chargeMarginInterestFunction = callable<Record<string, never>, Api.ChargeMarginInterestResponse>(
  'chargeMarginInterest',
);
// Server-side portfolio sync
export const syncPortfolioFunction = callable<void, Api.SyncPortfolioResponse>('syncPortfolio');
// Admin: remove achievement from user
export const removeAchievementFunction = callable('removeAchievement');
// Admin: reinstate bankrupt user
export const reinstateUserFunction = callable('reinstateUser');
// Admin: directly set user cash (for account repairs)
export const adminSetCashFunction = callable('adminSetCash');
// Admin: force-transfer cash <-> ladder game balance
export const adminTransferToLadderFunction = callable('adminTransferToLadder');
// Admin: flag/clear the Discord-link wall on a user
export const adminSetDiscordWallFunction = callable('adminSetDiscordWall');
// Admin: clear a user's Discord link so they can link a different one
export const adminUnlinkDiscordFunction = callable('adminUnlinkDiscord');
// Admin: move a Discord link off a throwaway account onto the player's original one
export const adminMoveDiscordLinkFunction = callable('adminMoveDiscordLink');
// Admin: clear the delete-tombstone / unlink-binding holding a Discord ID hostage
export const adminFreeDiscordFunction = callable('adminFreeDiscord');
// Mints the single-use code that starts the Discord link flow (see useDiscordLink)
export const startDiscordLinkFunction = callable<void, Api.StartDiscordLinkResponse>('startDiscordLink');
// Disconnect your own Discord (Profile → Discord → Unlink)
export const unlinkOwnDiscordFunction = callable<void>('unlinkOwnDiscord');
// Admin: grant/revoke a cosmetic on a user (giveaways)
export const adminGrantCosmeticFunction = callable('adminGrantCosmetic');
// Admin: direct edits to one user's game state (see functions/services/adminUserEdit.js)
export const adminChangeDisplayNameFunction = callable('adminChangeDisplayName');
// Admin: 30-day return distribution, for calibrating season tier thresholds
export const adminReturnDistributionFunction = callable('adminReturnDistribution');
// Seasons — standings are public; the rest are admin-only
export const getSeasonStandingsFunction = callable('getSeasonStandings');
export const adminStartSeasonFunction = callable('adminStartSeason');
export const adminEndSeasonFunction = callable('adminEndSeason');
export const triggerSeasonCheckpointFunction = callable('triggerSeasonCheckpoint');
// Keeping repeat coordinators out of Platinum/Diamond — admin-only
export const getSeasonCoordFlagsFunction = callable('getSeasonCoordFlags');
export const setSeasonTopTierExclusionFunction = callable('setSeasonTopTierExclusion');
export const getCoordProfitFunction = callable('getCoordProfit');
export const adminRemoveCoordProfitFunction = callable('adminRemoveCoordProfit');
// Season dry runs — the weekly rehearsal that runs while no season is on
export const triggerSeasonDryRunFunction = callable('triggerSeasonDryRun');
export const adminSeasonDryRunReportFunction = callable('adminSeasonDryRunReport');
export const adminSetCrewFunction = callable('adminSetCrew');
export const adminGrantAchievementFunction = callable('adminGrantAchievement');
export const adminSetMarginFunction = callable('adminSetMargin');
export const adminSetHoldingFunction = callable('adminSetHolding');
// Admin: repair spike victim accounts
export const repairSpikeVictimsFunction = callable('repairSpikeVictims');
// Admin: rename ticker across all data
export const renameTickerFunction = callable('renameTicker');
export const splitStockFunction = callable('splitStock');
export const setMarketHaltFunction = callable('setMarketHalt');
// Admin: watchlist management
export const addWatchedUserFunction = callable('addWatchedUser');
export const removeWatchedUserFunction = callable('removeWatchedUser');
export const linkAltAccountFunction = callable('linkAltAccount');
export const addWatchedIPFunction = callable('addWatchedIP');
export const getWatchlistFunction = callable('getWatchlist');
export const getIpTrackingHealthFunction = callable('getIpTrackingHealth');
export const getRecentSignupReportFunction = callable('getRecentSignupReport');
// Admin: proactive alt detection
export const triggerAltScanFunction = callable('triggerAltScan');
export const reviewWatchlistAlertFunction = callable('reviewWatchlistAlert');
// Price alerts
export const createPriceAlertFunction = callable<Api.CreatePriceAlertRequest>('createPriceAlert');
export const deletePriceAlertFunction = callable<{ alertId: string }>('deletePriceAlert');
// Admin: ticker rollback diagnostic
export const diagnoseTickerRollbackFunction = callable('diagnoseTickerRollback');
// Admin: ticker recovery (clawback + price reset)
export const recoverTickerFunction = callable('recoverTicker');
// Admin: drop audit
export const auditUserDropsFunction = callable('auditUserDrops');
// Dividends
export const runDividendPayoutNowFunction = callable('runDividendPayoutNow');
// Username reservation audit + portfolio-history repair
export const auditUsernamesFunction = callable('migrateUsernames');
export const reconstructPortfolioHistoryFunction = callable('reconstructPortfolioHistory');
// Admin: initialize prices for new characters
export const initNewCharacterPricesFunction = callable('initNewCharacterPrices');
// Admin: recompute crew underdog multipliers (+ optionally re-post Discord rankings)
export const triggerWeeklyCrewRankingsFunction = callable('triggerWeeklyCrewRankings');
// Admin: re-post the weekly market report to Discord now
export const triggerWeeklyMarketSummaryFunction = callable('triggerWeeklyMarketSummary');
// Admin: write the trade records that old limit/stop-loss/pre-market fills never wrote
export const backfillFillTradeRecordsFunction = callable('backfillFillTradeRecords');

// Admin: Discord message manager (post / edit / delete bot messages from the panel)
export const adminListDiscordChannelsFunction = callable('adminListDiscordChannels');
export const adminListDiscordMessagesFunction = callable('adminListDiscordMessages');
export const adminSendDiscordMessageFunction = callable('adminSendDiscordMessage');
export const adminUpdateDiscordMessageFunction = callable('adminUpdateDiscordMessage');
export const adminDeleteDiscordMessageFunction = callable('adminDeleteDiscordMessage');
export const adminImportDiscordMessageFunction = callable('adminImportDiscordMessage');

// Admin: read the cash adjustment audit log
export const adminListCashLogFunction = callable('adminListCashLog');

export default app;
