import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, TwitterAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';

const firebaseConfig = {
  apiKey: "AIzaSyA7h7BCmgIUkJHLENTRjCj6i43BV6ly5DA",
  authDomain: "stockism-abb28.firebaseapp.com",
  projectId: "stockism-abb28",
  storageBucket: "stockism-abb28.firebasestorage.app",
  messagingSenderId: "765989843498",
  appId: "1:765989843498:web:332d3470293741bb9fc953",
  measurementId: "G-HNL7JPVXPV"
};

const app = initializeApp(firebaseConfig);

// Initialize App Check with reCAPTCHA v3
const appCheck = initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider('YOUR_RECAPTCHA_SITE_KEY'),
  isTokenAutoRefreshEnabled: true
});

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
// Request email scope explicitly
googleProvider.addScope('email');
googleProvider.addScope('profile');

export const twitterProvider = new TwitterAuthProvider();

export const db = getFirestore(app);
export default app;
