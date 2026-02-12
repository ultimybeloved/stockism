import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, TwitterAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
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

const app = initializeApp(firebaseConfig);

const appCheck = initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider(import.meta.env.VITE_RECAPTCHA_SITE_KEY),
  isTokenAutoRefreshEnabled: true
});

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('email');
googleProvider.addScope('profile');
export const twitterProvider = new TwitterAuthProvider();
export const db = getFirestore(app);
export const functions = getFunctions(app);

// Cloud Functions
export const createUserFunction = httpsCallable(functions, 'createUser');
export const checkUsernameFunction = httpsCallable(functions, 'checkUsername');
export const deleteAccountFunction = httpsCallable(functions, 'deleteAccount');
export const createBotsFunction = httpsCallable(functions, 'createBots');
export const fixBasePriceCliffsFunction = httpsCallable(functions, 'fixBasePriceCliffs');
export const triggerManualBackupFunction = httpsCallable(functions, 'triggerManualBackup');
export const listBackupsFunction = httpsCallable(functions, 'listBackups');
export const restoreBackupFunction = httpsCallable(functions, 'restoreBackup');
// Trade validation & anti-exploit
export const validateTradeFunction = httpsCallable(functions, 'validateTrade');
export const recordTradeFunction = httpsCallable(functions, 'recordTrade');
export const executeTradeFunction = httpsCallable(functions, 'executeTrade');
export const banUserFunction = httpsCallable(functions, 'banUser');
// Daily checkin
export const dailyCheckinFunction = httpsCallable(functions, 'dailyCheckin');
// Ladder game
export const playLadderGameFunction = httpsCallable(functions, 'playLadderGame');
export const depositToLadderGameFunction = httpsCallable(functions, 'depositToLadderGame');
export const getLadderLeaderboardFunction = httpsCallable(functions, 'getLadderLeaderboard');
export const triggerDailyMarketSummaryFunction = httpsCallable(functions, 'triggerDailyMarketSummary');
// Leaderboard
export const getLeaderboardFunction = httpsCallable(functions, 'getLeaderboard');
// Discord alert functions
export const tradeSpikeAlertFunction = httpsCallable(functions, 'tradeSpikeAlert');
export const achievementAlertFunction = httpsCallable(functions, 'achievementAlert');
export const leaderboardChangeAlertFunction = httpsCallable(functions, 'leaderboardChangeAlert');
export const marginLiquidationAlertFunction = httpsCallable(functions, 'marginLiquidationAlert');
export const ipoAnnouncementAlertFunction = httpsCallable(functions, 'ipoAnnouncementAlert');
export const ipoClosingAlertFunction = httpsCallable(functions, 'ipoClosingAlert');
export const bankruptcyAlertFunction = httpsCallable(functions, 'bankruptcyAlert');
export const comebackAlertFunction = httpsCallable(functions, 'comebackAlert');
// Data archiving functions
export const archivePriceHistoryFunction = httpsCallable(functions, 'archivePriceHistory');
export const cleanupAlertedThresholdsFunction = httpsCallable(functions, 'cleanupAlertedThresholds');
// Secure operations
export const claimMissionRewardFunction = httpsCallable(functions, 'claimMissionReward');
export const purchasePinFunction = httpsCallable(functions, 'purchasePin');
export const placeBetFunction = httpsCallable(functions, 'placeBet');
export const claimPredictionPayoutFunction = httpsCallable(functions, 'claimPredictionPayout');
export const createLimitOrderFunction = httpsCallable(functions, 'createLimitOrder');
export const buyIPOSharesFunction = httpsCallable(functions, 'buyIPOShares');
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
// Admin: repair spike victim accounts
export const repairSpikeVictimsFunction = httpsCallable(functions, 'repairSpikeVictims');
// Admin: rename ticker across all data
export const renameTickerFunction = httpsCallable(functions, 'renameTicker');

export default app;
