import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, TwitterAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
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

const appCheck = initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider('6Lf-LEwsAAAAADc8tvjTERwlELg-EQIg0ag80whE'),
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

export default app;
