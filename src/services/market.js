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
  increment,
  serverTimestamp,
  arrayUnion
} from 'firebase/firestore';
import { db } from '../firebase';
import { CHARACTERS } from '../characters';

const MARKET_DOC_PATH = 'market/current';
const IPO_DOC_PATH = 'market/ipos';

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
 * Uses merge: true to prevent overwriting existing data
 */
export const initializeMarket = async () => {
  const marketRef = getMarketRef();
  const initialPrices = {};
  const initialHistory = {};

  CHARACTERS.forEach(c => {
    initialPrices[c.ticker] = c.basePrice;
    initialHistory[c.ticker] = [{ timestamp: Date.now(), price: c.basePrice }];
  });

  await setDoc(marketRef, {
    prices: initialPrices,
    priceHistory: initialHistory,
    lastUpdate: serverTimestamp(),
    totalTrades: 0
  }, { merge: true });

  return { prices: initialPrices, priceHistory: initialHistory };
};

/**
 * Update price and record history atomically
 * @param {string} ticker - Stock ticker
 * @param {number} newPrice - New price
 * @param {number} volumeChange - Change in volume (number of shares traded)
 */
export const updatePriceAtomic = async (ticker, newPrice, volumeChange = 0) => {
  const marketRef = getMarketRef();
  const now = Date.now();

  const updates = {
    [`prices.${ticker}`]: newPrice,
    [`priceHistory.${ticker}`]: arrayUnion({ timestamp: now, price: newPrice })
  };

  if (volumeChange > 0) {
    updates[`volume.${ticker}`] = increment(volumeChange);
  }

  await updateDoc(marketRef, updates);
};

/**
 * Update multiple prices atomically
 * @param {Object} priceUpdates - Map of ticker -> newPrice
 * @param {Object} volumeChanges - Map of ticker -> volumeChange
 */
export const updatePricesAtomic = async (priceUpdates, volumeChanges = {}) => {
  const marketRef = getMarketRef();
  const now = Date.now();

  const updates = {};

  Object.entries(priceUpdates).forEach(([ticker, price]) => {
    updates[`prices.${ticker}`] = price;
    updates[`priceHistory.${ticker}`] = arrayUnion({ timestamp: now, price });

    if (volumeChanges[ticker]) {
      updates[`volume.${ticker}`] = increment(volumeChanges[ticker]);
    }
  });

  if (Object.keys(updates).length > 0) {
    await updateDoc(marketRef, updates);
  }
};

/**
 * Increment total trades counter
 */
export const incrementTotalTrades = async () => {
  const marketRef = getMarketRef();
  await updateDoc(marketRef, {
    totalTrades: increment(1)
  });
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
