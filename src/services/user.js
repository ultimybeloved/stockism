// ============================================
// USER SERVICE
// Firebase operations for user data
// ============================================

import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Subscribe to user data updates
 * @param {string} userId - Firebase user ID
 * @param {Function} onData - Callback with user data
 * @param {Function} onError - Error callback
 * @returns {Function} Unsubscribe function
 */
export const subscribeToUser = (userId, onData, onError) => {
  const userRef = doc(db, 'users', userId);

  return onSnapshot(userRef, (snap) => {
    if (snap.exists()) {
      onData(snap.data());
    } else {
      onData(null);
    }
  }, onError);
};
