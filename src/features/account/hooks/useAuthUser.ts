import { useState, useEffect, useRef, useCallback } from 'react';
import * as Sentry from '@sentry/react';
import { onAuthStateChanged, applyActionCode, signInWithCustomToken } from 'firebase/auth';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../../../firebase';
import type { User } from 'firebase/auth';
import type { Unsubscribe } from 'firebase/firestore';
import type { AppContextValue } from '../../../context/AppContext';
import type { UserData } from '../../../types';

// Auth state, the user-doc subscription, and the auth-adjacent URL flows
// (Discord OAuth redirect, email verification action codes).
export function useAuthUser({
  setDarkMode,
  showNotification,
}: {
  setDarkMode: (dark: boolean) => void;
  showNotification: AppContextValue['showNotification'];
}) {
  const [user, setUser] = useState<User | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [needsUsername, setNeedsUsername] = useState(false);
  // Discord signups come back with their Discord name as a starting suggestion
  // for the name picker. Only a prefill — createUser re-validates server-side.
  const [suggestedName, setSuggestedName] = useState('');
  const [needsEmailVerification, setNeedsEmailVerification] = useState(false);
  const [loading, setLoading] = useState(true);

  // Ref to store user data listener unsubscribe function
  const userDataUnsubscribeRef = useRef<Unsubscribe | null>(null);

  // Handle Discord OAuth redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const discordToken = params.get('discord_token');
    const discordError = params.get('discord_error');
    const discordName = params.get('discord_name');
    if (discordName) setSuggestedName(discordName);

    if (discordToken) {
      // Sign in with custom token from Discord OAuth
      signInWithCustomToken(auth, discordToken)
        .then(() => {
          window.history.replaceState({}, document.title, window.location.pathname);
        })
        .catch((error) => {
          console.error('Discord sign-in error:', error);
        });
    } else if (discordError) {
      showNotification('error', 'Discord sign-in failed. Please try again or use a different sign-in method.');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [showNotification]);

  // Listen to auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      // Clean up previous user data listener
      if (userDataUnsubscribeRef.current) {
        userDataUnsubscribeRef.current();
        userDataUnsubscribeRef.current = null;
      }

      setUser(firebaseUser);
      Sentry.setUser(firebaseUser ? { id: firebaseUser.uid, email: firebaseUser.email ?? undefined } : null);
      if (firebaseUser) {
        // Check if email is verified (only for email/password providers)
        const isEmailProvider = firebaseUser.providerData.some((p) => p.providerId === 'password');
        if (isEmailProvider && !firebaseUser.emailVerified) {
          // Email not verified - block access
          setNeedsEmailVerification(true);
          setNeedsUsername(false);
          setUserData(null);
          setLoading(false);
          return;
        }

        setNeedsEmailVerification(false);

        // Listen to user data
        const userDocRef = doc(db, 'users', firebaseUser.uid);
        const userSnap = await getDoc(userDocRef);

        if (!userSnap.exists()) {
          // New user - prompt for username (don't auto-create yet)
          setNeedsUsername(true);
          setUserData(null);
        } else {
          setNeedsUsername(false);
          const data = userSnap.data() as UserData;
          setUserData(data);

          // Sync dark mode from Firestore if user has a saved preference
          if (data.darkMode !== undefined) {
            setDarkMode(data.darkMode);
            localStorage.setItem('stockism_darkMode', String(data.darkMode));
          }

          // Subscribe to user data changes - store unsubscribe for cleanup
          userDataUnsubscribeRef.current = onSnapshot(userDocRef, (snap) => {
            if (snap.exists()) setUserData(snap.data() as UserData);
          });
        }
      } else {
        setUserData(null);
        setNeedsUsername(false);
        setNeedsEmailVerification(false);
      }
      setLoading(false);
    });
    return () => {
      unsubscribe();
      // Clean up user data listener on unmount
      if (userDataUnsubscribeRef.current) {
        userDataUnsubscribeRef.current();
      }
    };
    // setDarkMode is a stable setState; run once on mount like the original.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle Firebase email action codes (verification links)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode');
    const oobCode = urlParams.get('oobCode');

    if (mode === 'verifyEmail' && oobCode) {
      applyActionCode(auth, oobCode)
        .then(() => {
          // Verification successful - reload user and redirect
          if (auth.currentUser) {
            auth.currentUser.reload().then(() => {
              // Clear URL params and reload to update state
              window.history.replaceState({}, '', window.location.pathname);
              window.location.reload();
            });
          } else {
            window.history.replaceState({}, '', window.location.pathname);
            window.location.reload();
          }
        })
        .catch((error) => {
          console.error('Email verification failed:', error);
          // Could show error to user - link expired or already used
        });
    }
  }, []);

  // After the UsernameModal creates the user doc: fetch it, adopt it, and
  // (re)subscribe to changes. Used as the modal's onComplete.
  const adoptUserDoc = useCallback(async (uid: string) => {
    setNeedsUsername(false);
    const userDocRef = doc(db, 'users', uid);
    const userSnap = await getDoc(userDocRef);
    if (userSnap.exists()) {
      setUserData(userSnap.data() as UserData);
      // Subscribe to changes (clean up any existing listener first)
      userDataUnsubscribeRef.current?.();
      userDataUnsubscribeRef.current = onSnapshot(userDocRef, (snap) => {
        if (snap.exists()) setUserData(snap.data() as UserData);
      });
    }
  }, []);

  return { user, userData, setUserData, needsUsername, needsEmailVerification, loading, adoptUserDoc, suggestedName };
}
