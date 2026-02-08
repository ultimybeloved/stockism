// ============================================
// MARKET SERVICE
// Firebase operations for market data
// ============================================

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp
} from 'firebase/firestore';
import { db } from '../firebase';
import { CHARACTERS } from '../characters';

/**
 * Get market document reference
 */
export const getMarketRef = () => doc(db, 'market', 'current');

/**
 * Get IPO document reference
 */
export const getIPORef = () => doc(db, 'market', 'ipos');

/**
 * Subscribe to real-time market data updates
 * @param {Function} onData - Callback with (prices, priceHistory, marketData)
 * @param {Function} onError - Error callback
 * @returns {Function} Unsubscribe function
 */
export const subscribeToMarket = (onData, onError) => {
  const marketRef = getMarketRef();

  return onSnapshot(marketRef, (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      const storedPrices = data.prices || {};

      // Merge with base prices for any missing tickers
      const mergedPrices = {};
      CHARACTERS.forEach(c => {
        mergedPrices[c.ticker] = storedPrices[c.ticker] ?? c.basePrice;
      });

      onData(mergedPrices, data.priceHistory || {}, data);
    } else {
      // Initialize market data if it doesn't exist
      initializeMarket();

      // Return initial prices while waiting for creation
      const initialPrices = {};
      CHARACTERS.forEach(c => {
        initialPrices[c.ticker] = c.basePrice;
      });
      onData(initialPrices, {}, null);
    }
  }, onError);
};

/**
 * Initialize market data (called when market doc doesn't exist)
 * Uses getDoc check + merge: true to prevent race conditions from multiple concurrent initializations
 */
export const initializeMarket = async () => {
  const marketRef = getMarketRef();

  // Check if document already exists to prevent race condition
  const existingDoc = await getDoc(marketRef);
  if (existingDoc.exists()) {
    const data = existingDoc.data();
    return { prices: data.prices || {}, priceHistory: data.priceHistory || {} };
  }

  const initialPrices = {};
  const initialHistory = {};

  CHARACTERS.forEach(c => {
    initialPrices[c.ticker] = c.basePrice;
    initialHistory[c.ticker] = [{ timestamp: Date.now(), price: c.basePrice }];
  });

  // Use merge: true as additional safety - if another process created the doc
  // between our check and this write, we won't overwrite their data
  await setDoc(marketRef, {
    prices: initialPrices,
    priceHistory: initialHistory,
    lastUpdate: serverTimestamp(),
    totalTrades: 0
  }, { merge: true });

  return { prices: initialPrices, priceHistory: initialHistory };
};

/**
 * Get current market data (one-time read)
 */
export const getMarketData = async () => {
  const marketRef = getMarketRef();
  const snap = await getDoc(marketRef);

  if (snap.exists()) {
    return snap.data();
  }

  return null;
};

/**
 * Subscribe to IPO data updates
 * @param {Function} onData - Callback with IPO list
 * @param {Function} onError - Error callback
 * @returns {Function} Unsubscribe function
 */
export const subscribeToIPOs = (onData, onError) => {
  const ipoRef = getIPORef();

  return onSnapshot(ipoRef, (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      onData(data.list || []);
    } else {
      onData([]);
    }
  }, onError);
};

/**
 * Update IPO list
 * @param {Array} ipoList - Updated IPO list
 */
export const updateIPOList = async (ipoList) => {
  const ipoRef = getIPORef();
  await updateDoc(ipoRef, { list: ipoList });
};
