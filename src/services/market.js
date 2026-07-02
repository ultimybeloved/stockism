// ============================================
// MARKET SERVICE
// Firebase operations for market data
// ============================================

import {
  doc,
  getDoc,
  updateDoc,
  onSnapshot
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

      // Chart history lives in market/priceHistory now (fetched separately);
      // the live subscription only carries the small prices doc.
      onData(mergedPrices, {}, data);
    } else {
      // Market doc missing — show base prices; the backend owns initialization.
      const initialPrices = {};
      CHARACTERS.forEach(c => {
        initialPrices[c.ticker] = c.basePrice;
      });
      onData(initialPrices, {}, null);
    }
  }, onError);
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
