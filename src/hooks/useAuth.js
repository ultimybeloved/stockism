// ============================================
// useAuth Hook
// Authentication state and methods
// ============================================

import { useState, useEffect, useCallback } from 'react';
import {
  subscribeToAuthState,
  signInWithGoogle,
  signInWithTwitter,
  signInWithEmail,
  createAccountWithEmail,
  logout,
  isAdmin
} from '../services/auth';
import { subscribeToUser } from '../services/user';

/**
 * Custom hook for authentication state and methods
 * @returns {Object} Auth state and methods
 */
export const useAuth = () => {
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Subscribe to auth state changes
  useEffect(() => {
    const unsubscribe = subscribeToAuthState((authUser) => {
      setUser(authUser);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Subscribe to user data when authenticated
  useEffect(() => {
    if (!user) {
      setUserData(null);
      return;
    }

    const unsubscribe = subscribeToUser(
      user.uid,
      (data) => setUserData(data),
      (err) => setError(err.message)
    );

    return () => unsubscribe();
  }, [user]);

  // Sign in with Google
  const loginWithGoogle = useCallback(async () => {
    setError(null);
    try {
      const result = await signInWithGoogle();
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, []);

  // Sign in with Twitter
  const loginWithTwitter = useCallback(async () => {
    setError(null);
    try {
      const result = await signInWithTwitter();
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, []);

  // Sign in with email
  const loginWithEmail = useCallback(async (email, password) => {
    setError(null);
    try {
      const result = await signInWithEmail(email, password);
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, []);

  // Create account with email
  const createAccount = useCallback(async (email, password, displayName) => {
    setError(null);
    try {
      const result = await createAccountWithEmail(email, password, displayName);
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, []);

  // Sign out
  const signOut = useCallback(async () => {
    setError(null);
    try {
      await logout();
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, []);

  // Check if current user is admin
  const checkIsAdmin = useCallback(() => {
    return user ? isAdmin(user.uid) : false;
  }, [user]);

  return {
    user,
    userData,
    loading,
    error,
    isAuthenticated: !!user,
    isAdmin: checkIsAdmin(),
    loginWithGoogle,
    loginWithTwitter,
    loginWithEmail,
    createAccount,
    signOut,
    clearError: () => setError(null)
  };
};

export default useAuth;
