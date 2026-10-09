import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, TwitterAuthProvider, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
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

export default app;
