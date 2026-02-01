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
export const banUserFunction = httpsCallable(functions, 'banUser');
// Ladder game
export const playLadderGameFunction = httpsCallable(functions, 'playLadderGame');
export const depositToLadderGameFunction = httpsCallable(functions, 'depositToLadderGame');
export const getLadderLeaderboardFunction = httpsCallable(functions, 'getLadderLeaderboard');
export const triggerDailyMarketSummaryFunction = httpsCallable(functions, 'triggerDailyMarketSummary');
// Discord alert functions
export const tradeSpikeAlertFunction = httpsCallable(functions, 'tradeSpikeAlert');
export const achievementAlertFunction = httpsCallable(functions, 'achievementAlert');
export const leaderboardChangeAlertFunction = httpsCallable(functions, 'leaderboardChangeAlert');
export const marginLiquidationAlertFunction = httpsCallable(functions, 'marginLiquidationAlert');
export const ipoAnnouncementAlertFunction = httpsCallable(functions, 'ipoAnnouncementAlert');
export const ipoClosingAlertFunction = httpsCallable(functions, 'ipoClosingAlert');
export const bankruptcyAlertFunction = httpsCallable(functions, 'bankruptcyAlert');
export const comebackAlertFunction = httpsCallable(functions, 'comebackAlert');
// Content generation functions
export const listPendingContentFunction = httpsCallable(functions, 'listPendingContent');
export const approveContentFunction = httpsCallable(functions, 'approveContent');
export const rejectContentFunction = httpsCallable(functions, 'rejectContent');
export const generateDramaVideoFunction = httpsCallable(functions, 'generateDramaVideo');
// Data archiving functions
export const archivePriceHistoryFunction = httpsCallable(functions, 'archivePriceHistory');
export const cleanupAlertedThresholdsFunction = httpsCallable(functions, 'cleanupAlertedThresholds');
export const emergencyCleanupFunction = httpsCallable(functions, 'emergencyCleanup');

export default app;
