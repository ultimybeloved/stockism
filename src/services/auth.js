// ============================================
// AUTH SERVICE
// Firebase Authentication operations
// ============================================

import {
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from 'firebase/auth';
import { auth, googleProvider, twitterProvider } from '../firebase';
import { createUser, userExists, getUserData } from './user';
import { ADMIN_UIDS } from '../constants/economy';

/**
 * Subscribe to auth state changes
 * @param {Function} callback - Callback with user object or null
 * @returns {Function} Unsubscribe function
 */
export const subscribeToAuthState = (callback) => {
  return onAuthStateChanged(auth, callback);
};

/**
 * Sign in with Google
 * @returns {Object} User object and whether it's a new user
 */
export const signInWithGoogle = async () => {
  const result = await signInWithPopup(auth, googleProvider);
  const user = result.user;

  // Check if user exists in Firestore
  const exists = await userExists(user.uid);

  if (!exists) {
    // Create new user document
    await createUser(user.uid, user.displayName || 'Anonymous');
    return { user, isNewUser: true };
  }

  return { user, isNewUser: false };
};

/**
 * Sign in with Twitter
 * @returns {Object} User object and whether it's a new user
 */
export const signInWithTwitter = async () => {
  const result = await signInWithPopup(auth, twitterProvider);
  const user = result.user;

  // Check if user exists in Firestore
  const exists = await userExists(user.uid);

  if (!exists) {
    // Create new user document
    await createUser(user.uid, user.displayName || 'Anonymous');
    return { user, isNewUser: true };
  }

  return { user, isNewUser: false };
};

/**
 * Sign in with email and password
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Object} User object
 */
export const signInWithEmail = async (email, password) => {
  const result = await signInWithEmailAndPassword(auth, email, password);
  return { user: result.user };
};

/**
 * Create account with email and password
 * @param {string} email - User email
 * @param {string} password - User password
 * @param {string} displayName - Display name for the user
 * @returns {Object} User object
 */
export const createAccountWithEmail = async (email, password, displayName) => {
  const result = await createUserWithEmailAndPassword(auth, email, password);
  const user = result.user;

  // Create user document
  await createUser(user.uid, displayName || email.split('@')[0]);

  return { user, isNewUser: true };
};

/**
 * Sign out current user
 */
export const logout = async () => {
  await signOut(auth);
};

/**
 * Check if user is admin
 * @param {string} userId - Firebase user ID
 */
export const isAdmin = (userId) => {
  return ADMIN_UIDS.includes(userId);
};

/**
 * Get current auth user
 */
export const getCurrentUser = () => {
  return auth.currentUser;
};

/**
 * Get current user's data from Firestore
 */
export const getCurrentUserData = async () => {
  const user = getCurrentUser();
  if (!user) return null;

  return await getUserData(user.uid);
};
