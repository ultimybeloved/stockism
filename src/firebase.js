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
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

// Fail loudly if required build-time settings are missing, so a misconfigured Vercel
// build throws a clear error instead of silently shipping a broken app to real users.
const REQUIRED_ENV = {
  VITE_FIREBASE_API_KEY: firebaseConfig.apiKey,
  VITE_FIREBASE_AUTH_DOMAIN: firebaseConfig.authDomain,
  VITE_FIREBASE_PROJECT_ID: firebaseConfig.projectId,
  VITE_FIREBASE_APP_ID: firebaseConfig.appId,
};
const missingEnv = Object.entries(REQUIRED_ENV).filter(([, v]) => !v).map(([k]) => k);
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
    // eslint-disable-next-line no-undef
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN;
  }

  if (!import.meta.env.VITE_RECAPTCHA_SITE_KEY) {
    throw new Error('Missing VITE_RECAPTCHA_SITE_KEY — App Check cannot initialize. Set it in the Vercel project settings.');
  }
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(import.meta.env.VITE_RECAPTCHA_SITE_KEY),
    isTokenAutoRefreshEnabled: true
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
  // eslint-disable-next-line no-console
  console.warn('🧪 SANDBOX MODE — connected to local Firebase emulators, not production.');
}

// Cloud Functions
export const createUserFunction = httpsCallable(functions, 'createUser');
export const checkUsernameFunction = httpsCallable(functions, 'checkUsername');
export const deleteAccountFunction = httpsCallable(functions, 'deleteAccount');
export const changeDisplayNameFunction = httpsCallable(functions, 'changeDisplayName');
export const purchaseCosmeticFunction = httpsCallable(functions, 'purchaseCosmetic');
export const createBotsFunction = httpsCallable(functions, 'createBots');
export const fixBasePriceCliffsFunction = httpsCallable(functions, 'fixBasePriceCliffs');
export const triggerManualBackupFunction = httpsCallable(functions, 'triggerManualBackup');
export const listBackupsFunction = httpsCallable(functions, 'listBackups');
export const restoreBackupFunction = httpsCallable(functions, 'restoreBackup');
export const broadcastNotificationFunction = httpsCallable(functions, 'broadcastNotification');
// Trade execution & anti-exploit
export const executeTradeFunction = httpsCallable(functions, 'executeTrade');
export const sweepDustPositionsFunction = httpsCallable(functions, 'sweepDustPositions');
export const banUserFunction = httpsCallable(functions, 'banUser');
// Daily checkin
export const dailyCheckinFunction = httpsCallable(functions, 'dailyCheckin');
// Ladder game
export const playLadderGameFunction = httpsCallable(functions, 'playLadderGame');
export const depositToLadderGameFunction = httpsCallable(functions, 'depositToLadderGame');
export const withdrawFromLadderGameFunction = httpsCallable(functions, 'withdrawFromLadderGame');
export const getLadderLeaderboardFunction = httpsCallable(functions, 'getLadderLeaderboard');
export const triggerDailyMarketSummaryFunction = httpsCallable(functions, 'triggerDailyMarketSummary');
// Leaderboard
export const getLeaderboardFunction = httpsCallable(functions, 'getLeaderboard');
export const getPublicProfileFunction = httpsCallable(functions, 'getPublicProfile');
// Discord alert functions
export const achievementAlertFunction = httpsCallable(functions, 'achievementAlert');
export const ipoAnnouncementAlertFunction = httpsCallable(functions, 'ipoAnnouncementAlert');
// Data archiving functions
export const archivePriceHistoryFunction = httpsCallable(functions, 'archivePriceHistory');
export const cleanupAlertedThresholdsFunction = httpsCallable(functions, 'cleanupAlertedThresholds');
// Secure operations
export const claimMissionRewardFunction = httpsCallable(functions, 'claimMissionReward');
export const rerollMissionsFunction = httpsCallable(functions, 'rerollMissions');
export const purchasePinFunction = httpsCallable(functions, 'purchasePin');
export const placeBetFunction = httpsCallable(functions, 'placeBet');
export const claimPredictionPayoutFunction = httpsCallable(functions, 'claimPredictionPayout');
export const createLimitOrderFunction = httpsCallable(functions, 'createLimitOrder');
export const createPreMarketOrderFunction = httpsCallable(functions, 'createPreMarketOrder');
export const cancelPreMarketOrderFunction = httpsCallable(functions, 'cancelPreMarketOrder');
export const buyIPOSharesFunction = httpsCallable(functions, 'buyIPOShares');
// Event prediction markets (long-term, AMM-priced)
export const buyEventSharesFunction = httpsCallable(functions, 'buyEventShares');
export const sellEventSharesFunction = httpsCallable(functions, 'sellEventShares');
export const triggerEventSettlementsFunction = httpsCallable(functions, 'triggerEventSettlements');
export const cancelEventMarketFunction = httpsCallable(functions, 'cancelEventMarket');
export const repayMarginFunction = httpsCallable(functions, 'repayMargin');
export const bailoutFunction = httpsCallable(functions, 'bailout');
export const leaveCrewFunction = httpsCallable(functions, 'leaveCrew');
export const switchCrewFunction = httpsCallable(functions, 'switchCrew');
export const toggleMarginFunction = httpsCallable(functions, 'toggleMargin');
export const chargeMarginInterestFunction = httpsCallable(functions, 'chargeMarginInterest');
// Server-side portfolio sync
export const syncPortfolioFunction = httpsCallable(functions, 'syncPortfolio');
// Admin: remove achievement from user
export const removeAchievementFunction = httpsCallable(functions, 'removeAchievement');
// Admin: reinstate bankrupt user
export const reinstateUserFunction = httpsCallable(functions, 'reinstateUser');
// Admin: directly set user cash (for account repairs)
export const adminSetCashFunction = httpsCallable(functions, 'adminSetCash');
// Admin: force-transfer cash <-> ladder game balance
export const adminTransferToLadderFunction = httpsCallable(functions, 'adminTransferToLadder');
// Admin: flag/clear the Discord-link wall on a user
export const adminSetDiscordWallFunction = httpsCallable(functions, 'adminSetDiscordWall');
// Admin: grant/revoke a cosmetic on a user (giveaways)
export const adminGrantCosmeticFunction = httpsCallable(functions, 'adminGrantCosmetic');
// Admin: repair spike victim accounts
export const repairSpikeVictimsFunction = httpsCallable(functions, 'repairSpikeVictims');
// Admin: rename ticker across all data
export const renameTickerFunction = httpsCallable(functions, 'renameTicker');
export const setMarketHaltFunction = httpsCallable(functions, 'setMarketHalt');
// Admin: watchlist management
export const addWatchedUserFunction = httpsCallable(functions, 'addWatchedUser');
export const removeWatchedUserFunction = httpsCallable(functions, 'removeWatchedUser');
export const linkAltAccountFunction = httpsCallable(functions, 'linkAltAccount');
export const addWatchedIPFunction = httpsCallable(functions, 'addWatchedIP');
export const getWatchlistFunction = httpsCallable(functions, 'getWatchlist');
export const getIpTrackingHealthFunction = httpsCallable(functions, 'getIpTrackingHealth');
export const getRecentSignupReportFunction = httpsCallable(functions, 'getRecentSignupReport');
// Price alerts
export const createPriceAlertFunction = httpsCallable(functions, 'createPriceAlert');
export const deletePriceAlertFunction = httpsCallable(functions, 'deletePriceAlert');
// Admin: ticker rollback diagnostic
export const diagnoseTickerRollbackFunction = httpsCallable(functions, 'diagnoseTickerRollback');
// Admin: ticker recovery (clawback + price reset)
export const recoverTickerFunction = httpsCallable(functions, 'recoverTicker');
// Admin: drop audit
export const auditUserDropsFunction = httpsCallable(functions, 'auditUserDrops');
// Dividends
export const runDividendPayoutNowFunction = httpsCallable(functions, 'runDividendPayoutNow');
// Username reservation audit + portfolio-history repair
export const auditUsernamesFunction = httpsCallable(functions, 'migrateUsernames');
export const reconstructPortfolioHistoryFunction = httpsCallable(functions, 'reconstructPortfolioHistory');
// Admin: initialize prices for new characters
export const initNewCharacterPricesFunction = httpsCallable(functions, 'initNewCharacterPrices');
// Admin: recompute crew underdog multipliers (+ optionally re-post Discord rankings)
export const triggerWeeklyCrewRankingsFunction = httpsCallable(functions, 'triggerWeeklyCrewRankings');

export default app;
