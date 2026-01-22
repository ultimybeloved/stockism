// ============================================
// USER SERVICE
// Firebase operations for user data
// ============================================

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  increment,
  arrayUnion,
  deleteField
} from 'firebase/firestore';
import { db } from '../firebase';
import { STARTING_CASH } from '../constants/economy';

/**
 * Get user document reference
 * @param {string} userId - Firebase user ID
 */
export const getUserRef = (userId) => doc(db, 'users', userId);

/**
 * Subscribe to user data updates
 * @param {string} userId - Firebase user ID
 * @param {Function} onData - Callback with user data
 * @param {Function} onError - Error callback
 * @returns {Function} Unsubscribe function
 */
export const subscribeToUser = (userId, onData, onError) => {
  const userRef = getUserRef(userId);

  return onSnapshot(userRef, (snap) => {
    if (snap.exists()) {
      onData(snap.data());
    } else {
      onData(null);
    }
  }, onError);
};

/**
 * Create new user document
 * @param {string} userId - Firebase user ID
 * @param {string} displayName - User's display name
 */
export const createUser = async (userId, displayName) => {
  const userRef = getUserRef(userId);

  const userData = {
    displayName: displayName || 'Anonymous',
    cash: STARTING_CASH,
    holdings: {},
    portfolioValue: STARTING_CASH,
    totalTrades: 0,
    totalCheckins: 0,
    achievements: [],
    createdAt: Date.now()
  };

  await setDoc(userRef, userData);
  return userData;
};

/**
 * Get user data (one-time read)
 * @param {string} userId - Firebase user ID
 */
export const getUserData = async (userId) => {
  const userRef = getUserRef(userId);
  const snap = await getDoc(userRef);

  if (snap.exists()) {
    return snap.data();
  }

  return null;
};

/**
 * Update user data
 * @param {string} userId - Firebase user ID
 * @param {Object} updates - Fields to update
 */
export const updateUser = async (userId, updates) => {
  const userRef = getUserRef(userId);
  await updateDoc(userRef, updates);
};

/**
 * Award achievement to user
 * @param {string} userId - Firebase user ID
 * @param {string} achievementId - Achievement ID to award
 */
export const awardAchievement = async (userId, achievementId) => {
  const userRef = getUserRef(userId);
  await updateDoc(userRef, {
    achievements: arrayUnion(achievementId)
  });
};

/**
 * Award multiple achievements to user
 * @param {string} userId - Firebase user ID
 * @param {Array} achievementIds - Achievement IDs to award
 */
export const awardAchievements = async (userId, achievementIds) => {
  if (achievementIds.length === 0) return;

  const userRef = getUserRef(userId);
  await updateDoc(userRef, {
    achievements: arrayUnion(...achievementIds)
  });
};

/**
 * Update user portfolio value
 * @param {string} userId - Firebase user ID
 * @param {number} portfolioValue - New portfolio value
 */
export const updatePortfolioValue = async (userId, portfolioValue) => {
  const userRef = getUserRef(userId);
  await updateDoc(userRef, {
    portfolioValue: Math.round(portfolioValue * 100) / 100
  });
};

/**
 * Record portfolio history entry
 * @param {string} userId - Firebase user ID
 * @param {number} portfolioValue - Current portfolio value
 */
export const recordPortfolioHistory = async (userId, portfolioValue) => {
  const userRef = getUserRef(userId);
  const now = Date.now();

  const snap = await getDoc(userRef);
  if (snap.exists()) {
    const data = snap.data();
    const currentHistory = data.portfolioHistory || [];

    // Only record if last record was > 5 minutes ago
    const lastRecord = currentHistory[currentHistory.length - 1];
    const shouldRecord = !lastRecord || (now - lastRecord.timestamp) > 5 * 60 * 1000;

    if (shouldRecord) {
      // Keep last 500 records per user
      const updatedHistory = [...currentHistory, { timestamp: now, value: portfolioValue }].slice(-500);

      await updateDoc(userRef, {
        portfolioHistory: updatedHistory
      });
    }
  }
};

/**
 * Log transaction for auditing
 * @param {string} userId - Firebase user ID
 * @param {string} type - Transaction type (BUY, SELL, etc.)
 * @param {Object} details - Transaction details
 */
export const logTransaction = async (userId, type, details) => {
  try {
    const userRef = getUserRef(userId);
    const snap = await getDoc(userRef);
    const userData = snap.data() || {};

    const transaction = {
      type,
      timestamp: Date.now(),
      ...details,
      cashBefore: details.cashBefore ?? userData.cash,
      cashAfter: details.cashAfter,
      portfolioBefore: details.portfolioBefore ?? userData.portfolioValue,
      portfolioAfter: details.portfolioAfter
    };

    // Keep last 100 transactions per user
    const transactionLog = userData.transactionLog || [];
    const updatedLog = [...transactionLog, transaction].slice(-100);

    await updateDoc(userRef, { transactionLog: updatedLog });
  } catch (err) {
    console.error('Failed to log transaction:', err);
    // Don't throw - logging failure shouldn't break the actual transaction
  }
};

/**
 * Increment user's trade count
 * @param {string} userId - Firebase user ID
 */
export const incrementTrades = async (userId) => {
  const userRef = getUserRef(userId);
  await updateDoc(userRef, {
    totalTrades: increment(1)
  });
};

/**
 * Update user's holdings
 * @param {string} userId - Firebase user ID
 * @param {string} ticker - Stock ticker
 * @param {number} shares - New share count
 * @param {Object} additionalUpdates - Additional fields to update
 */
export const updateHoldings = async (userId, ticker, shares, additionalUpdates = {}) => {
  const userRef = getUserRef(userId);

  const updates = {
    [`holdings.${ticker}`]: shares,
    ...additionalUpdates
  };

  // Clean up if shares is 0 or negative
  if (shares <= 0) {
    updates[`holdings.${ticker}`] = deleteField();
    updates[`costBasis.${ticker}`] = deleteField();
    updates[`lowestWhileHolding.${ticker}`] = deleteField();
  }

  await updateDoc(userRef, updates);
};

/**
 * Check if user exists
 * @param {string} userId - Firebase user ID
 */
export const userExists = async (userId) => {
  const userRef = getUserRef(userId);
  const snap = await getDoc(userRef);
  return snap.exists();
};
