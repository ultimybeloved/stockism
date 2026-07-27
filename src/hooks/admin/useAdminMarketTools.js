import { useState } from 'react';
import { doc, getDoc, setDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db, setMarketHaltFunction } from '../../firebase';
import { CHARACTER_MAP } from '../../characters';
import { MIN_PRICE } from '../../constants';
import { priceHistoryDocRef } from './adminShared';

// Market tab (emergency halt) + the price adjustment modal.
export function useAdminMarketTools({ setMessage, showMessage, setLoading, prices, marketData }) {
  // Price adjustment modal state
  const [showPriceModal, setShowPriceModal] = useState(false);
  const [priceModalSearch, setPriceModalSearch] = useState('');
  const [selectedPriceCharacter, setSelectedPriceCharacter] = useState(null);
  const [priceAdjustPercent, setPriceAdjustPercent] = useState('');

  // Market tab state
  const [haltReasonInput, setHaltReasonInput] = useState('');
  const marketHaltStatus = !!marketData?.marketHalted;
  const marketHaltReason = marketData?.haltReason || '';

  // Helper function to apply trailing stock effects
  const applyTrailingEffects = (marketUpdates, historyUpdates, sourceTicker, sourceOldPrice, sourceNewPrice, timestamp, depth = 0, visited = new Set()) => {
    if (depth > 3 || visited.has(sourceTicker)) {
      return;
    }
    visited.add(sourceTicker);

    const character = CHARACTER_MAP[sourceTicker];
    if (!character?.trailingFactors) {
      return;
    }

    const priceChangePercent = (sourceNewPrice - sourceOldPrice) / (sourceOldPrice || 1);

    character.trailingFactors.forEach(({ ticker: relatedTicker, coefficient }) => {
      // Skip if we've already updated this ticker in this batch
      if (visited.has(relatedTicker)) {
        return;
      }

      // Get the current price - check marketUpdates first, then fall back to prices
      const oldRelatedPrice = marketUpdates[`prices.${relatedTicker}`] || prices[relatedTicker];
      if (oldRelatedPrice != null) {
        const trailingChange = priceChangePercent * coefficient;
        const newRelatedPrice = oldRelatedPrice * (1 + trailingChange);
        const settledRelatedPrice = Math.max(MIN_PRICE, Math.round(newRelatedPrice * 100) / 100);

        console.log(`[ADMIN TRAILING] ${relatedTicker}: $${oldRelatedPrice} -> $${settledRelatedPrice} (${(trailingChange * 100).toFixed(2)}% from ${sourceTicker})`);

        marketUpdates[`prices.${relatedTicker}`] = settledRelatedPrice;
        historyUpdates[relatedTicker] = arrayUnion({
          timestamp,
          price: settledRelatedPrice,
          source: 'trailing'
        });

        // Recursively apply trailing effects with shared visited set (no cloning)
        applyTrailingEffects(marketUpdates, historyUpdates, relatedTicker, oldRelatedPrice, settledRelatedPrice, timestamp, depth + 1, visited);
      }
    });
  };

  // Adjust character price
  const handleModalPriceAdjustment = async (character, percentChange) => {
    const currentPrice = prices[character.ticker] || character.basePrice;
    if (!currentPrice) {
      showMessage('error', 'Could not get current price');
      return;
    }

    const percent = parseFloat(percentChange);
    if (isNaN(percent)) {
      showMessage('error', 'Please enter a valid percentage');
      return;
    }

    const targetPrice = Math.round(currentPrice * (1 + percent / 100) * 100) / 100;

    if (targetPrice <= 0) {
      showMessage('error', 'Resulting price would be negative');
      return;
    }

    setLoading(true);
    try {
      const marketRef = doc(db, 'market', 'current');
      const histSnap = await getDoc(priceHistoryDocRef());
      let now = Date.now();

      {
        const histData = histSnap.exists() ? (histSnap.data() || {}) : {};
        let currentHistory = histData[character.ticker] || [];

        if (currentHistory.length === 0 && currentPrice) {
          currentHistory = [{ timestamp: now - 1000, price: currentPrice }];
        }

        // Ensure the new timestamp is always greater than the last entry
        const lastTimestamp = currentHistory.length > 0 ? currentHistory[currentHistory.length - 1].timestamp : 0;
        if (now <= lastTimestamp) {
          now = lastTimestamp + 1;
        }

        const updatedHistory = [...currentHistory, { timestamp: now, price: targetPrice, source: 'admin_adjust' }];

        console.log(`Adding price point for ${character.ticker}:`, { timestamp: now, price: targetPrice });
        console.log(`History length: ${currentHistory.length} → ${updatedHistory.length}`);

        // Build market updates with trailing effects
        const marketUpdates = {
          [`prices.${character.ticker}`]: targetPrice
        };
        const historyUpdates = {
          [character.ticker]: updatedHistory
        };

        // Apply trailing stock effects
        console.log(`[ADMIN TRAILING START] Applying effects for ${character.ticker}: $${currentPrice} -> $${targetPrice}`);
        applyTrailingEffects(marketUpdates, historyUpdates, character.ticker, currentPrice, targetPrice, now);
        console.log(`[ADMIN TRAILING END] Total updates:`, Object.keys(marketUpdates).length);

        await updateDoc(marketRef, marketUpdates);
        await setDoc(priceHistoryDocRef(), historyUpdates, { merge: true });
      }

      const changePercent = ((targetPrice - currentPrice) / currentPrice * 100).toFixed(1);
      const direction = targetPrice > currentPrice ? '📈' : '📉';

      showMessage('success', `${direction} ${character.name}: $${currentPrice.toFixed(2)} → $${targetPrice.toFixed(2)} (${changePercent > 0 ? '+' : ''}${changePercent}%)`);



      // Reset modal
      setPriceAdjustPercent('');
      setSelectedPriceCharacter(null);

    } catch (err) {
      console.error('Price adjustment error:', err);
      showMessage('error', 'Failed to adjust price: ' + err.message);
    }

    setLoading(false);
  };

  const updateMarketHalt = async (halted, reason) => {
    if (halted && !reason.trim()) {
      setMessage({ type: 'error', text: 'Please enter a halt reason.' });
      return;
    }
    setLoading(true);
    try {
      // Cloud Function sets the flag AND posts the Discord market-status alert in one step
      await setMarketHaltFunction({ halted, reason: reason.trim() });
      setMessage({ type: 'success', text: halted ? 'Market halted.' : 'Market resumed.' });
      if (halted) setHaltReasonInput('');
    } catch (err) {
      setMessage({ type: 'error', text: halted ? 'Failed to halt market.' : 'Failed to resume market.' });
    }
    setLoading(false);
  };

  return {
    marketHaltStatus, marketHaltReason, haltReasonInput, setHaltReasonInput, updateMarketHalt,
    showPriceModal, setShowPriceModal, priceModalSearch, setPriceModalSearch,
    selectedPriceCharacter, setSelectedPriceCharacter,
    priceAdjustPercent, setPriceAdjustPercent, handleModalPriceAdjustment,
  };
}
