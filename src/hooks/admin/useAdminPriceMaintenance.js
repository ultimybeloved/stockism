import { doc, getDoc, setDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db } from '../../firebase';
import { CHARACTERS } from '../../characters';
import { priceHistoryDocRef } from './adminShared';

// Stats tab price maintenance: history cleanup, price/history sync, full reset.
export function useAdminPriceMaintenance({ showMessage, setLoading }) {
  // Clean up recent base price entries from history (fixes reset pollution)
  const handleCleanupBasePrices = async () => {
    if (!window.confirm('⚠️ CLEAN UP BASE PRICES?\n\nThis will remove any recent entries that match base prices.')) {
      return;
    }

    setLoading(true);
    try {
      const histSnap = await getDoc(priceHistoryDocRef());

      if (!histSnap.exists()) {
        showMessage('error', 'Price history document not found');
        return;
      }

      const priceHistory = histSnap.data() || {};
      const cleanedHistory = {};
      let tickersCleaned = 0;
      let entriesRemoved = 0;

      // For each ticker, remove recent entries that match base price
      CHARACTERS.forEach(char => {
        const history = priceHistory[char.ticker];
        if (history && history.length > 1) {
          const filtered = history.filter((entry, i) => {
            // Keep all entries except the last one if it matches base price exactly
            if (i === history.length - 1 && Math.abs(entry.price - char.basePrice) < 0.01) {
              entriesRemoved++;
              return false;
            }
            return true;
          });

          if (filtered.length !== history.length) {
            tickersCleaned++;
            cleanedHistory[char.ticker] = filtered;
          }
        }
      });

      if (Object.keys(cleanedHistory).length > 0) {
        await updateDoc(priceHistoryDocRef(), cleanedHistory);
        showMessage('success', `✅ Cleaned ${tickersCleaned} tickers, removed ${entriesRemoved} base price entries!`);
      } else {
        showMessage('info', 'No base price entries found to clean.');
      }
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to cleanup: ' + err.message);
    }
    setLoading(false);
  };

  // Sync current prices to match the latest price history entry
  const handleSyncPricesToHistory = async () => {
    setLoading(true);
    try {
      const marketRef = doc(db, 'market', 'current');
      const histSnap = await getDoc(priceHistoryDocRef());

      if (!histSnap.exists()) {
        showMessage('error', 'Price history document not found');
        return;
      }

      const priceHistory = histSnap.data() || {};
      const updatedPrices = {};

      // For each ticker, set current price to the last history entry
      Object.entries(priceHistory).forEach(([ticker, history]) => {
        if (history && history.length > 0) {
          const latestEntry = history[history.length - 1];
          updatedPrices[ticker] = latestEntry.price;
        }
      });

      // Update all prices at once
      await updateDoc(marketRef, {
        prices: updatedPrices
      });

      showMessage('success', `✅ Synced ${Object.keys(updatedPrices).length} prices to match latest history!`);
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to sync prices: ' + err.message);
    }
    setLoading(false);
  };

  // Reset ALL prices to base prices
  const handleResetAllPrices = async () => {
    if (!window.confirm('⚠️ RESET ALL PRICES TO BASE? This will reset the entire market!')) {
      return;
    }

    setLoading(true);
    try {
      const marketRef = doc(db, 'market', 'current');
      const now = Date.now();

      const resetPrices = {};
      const resetHistory = {};

      CHARACTERS.forEach(char => {
        resetPrices[char.ticker] = char.basePrice;
        // APPEND a reset point — never wipe the chart record (history is the
        // permanent story of the market; a reset is just another event in it)
        resetHistory[char.ticker] = arrayUnion({ timestamp: now, price: char.basePrice, source: 'admin_reset' });
      });

      await updateDoc(marketRef, { prices: resetPrices });
      await setDoc(priceHistoryDocRef(), resetHistory, { merge: true });

      showMessage('success', `✅ Reset ${CHARACTERS.length} characters to base prices!`);
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to reset prices: ' + err.message);
    }
    setLoading(false);
  };


  return { handleCleanupBasePrices, handleSyncPricesToHistory, handleResetAllPrices };
}
