import { useState } from 'react';
import { doc, getDoc, setDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db } from '../../../firebase';
import { setMarketHaltFunction } from '../../../api/callables';
import { priceHistoryDocRef } from '../utils/adminShared';
import { recordReviewMoves, loadReviewChanges } from '../utils/reviewChangeTracking';
import { buildTrailingCascade } from '../utils/trailingCascade';
import type { AdminHookDeps } from '../utils/adminShared';
import { errorMessage } from '../../../utils/errors';
import type { FieldValue } from 'firebase/firestore';
import type { Character } from '../../../characters';
import type { ReviewChanges } from '../../../utils/marketHours';
import type { PricePoint } from '../../../types';

// Market tab (emergency halt) + the price adjustment modal.
export function useAdminMarketTools({
  setMessage,
  showMessage,
  setLoading,
  prices,
  marketData,
}: Pick<AdminHookDeps, 'setMessage' | 'showMessage' | 'setLoading' | 'prices' | 'marketData'>) {
  // Price adjustment modal state
  const [showPriceModal, setShowPriceModal] = useState(false);
  const [priceModalSearch, setPriceModalSearch] = useState('');
  const [selectedPriceCharacter, setSelectedPriceCharacter] = useState<Character | null>(null);
  const [priceAdjustPercent, setPriceAdjustPercent] = useState('');
  // What this review has already done to each stock, so the tool can show the
  // knock-on a stock has picked up before you decide what to type.
  const [reviewSoFar, setReviewSoFar] = useState<ReviewChanges>({});

  const openPriceModal = async (open: boolean) => {
    setShowPriceModal(open);
    if (open) setReviewSoFar(await loadReviewChanges().catch(() => ({})));
  };

  // Market tab state
  const [haltReasonInput, setHaltReasonInput] = useState('');
  const marketHaltStatus = !!marketData?.marketHalted;
  const marketHaltReason = marketData?.haltReason || '';

  // Adjust character price
  const handleModalPriceAdjustment = async (character: Character, percentChange: string) => {
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
        const histData = histSnap.exists() ? histSnap.data() || {} : {};
        let currentHistory: PricePoint[] = histData[character.ticker] || [];

        if (currentHistory.length === 0 && currentPrice) {
          currentHistory = [{ timestamp: now - 1000, price: currentPrice }];
        }

        // Ensure the new timestamp is always greater than the last entry
        const lastTimestamp = currentHistory[currentHistory.length - 1]?.timestamp ?? 0;
        if (now <= lastTimestamp) {
          now = lastTimestamp + 1;
        }

        const updatedHistory = [...currentHistory, { timestamp: now, price: targetPrice, source: 'admin_adjust' }];

        console.log(`Adding price point for ${character.ticker}:`, { timestamp: now, price: targetPrice });
        console.log(`History length: ${currentHistory.length} → ${updatedHistory.length}`);

        // Build market updates with trailing effects
        const marketUpdates: Record<string, number> = {
          [`prices.${character.ticker}`]: targetPrice,
        };
        const historyUpdates: Record<string, PricePoint[] | FieldValue> = {
          [character.ticker]: updatedHistory,
        };

        // Ripple the adjustment out through the linked stocks.
        const trailingMoves = buildTrailingCascade({
          ticker: character.ticker,
          oldPrice: currentPrice,
          newPrice: targetPrice,
          prices,
        });
        for (const move of trailingMoves) {
          marketUpdates[`prices.${move.ticker}`] = move.to;
          historyUpdates[move.ticker] = arrayUnion({ timestamp: now, price: move.to, source: 'trailing' });
        }
        console.log(`[ADMIN TRAILING] ${character.ticker} dragged ${trailingMoves.length} linked stocks`);

        await updateDoc(marketRef, marketUpdates);
        await setDoc(priceHistoryDocRef(), historyUpdates, { merge: true });

        // Fold this into the stored chapter-review changes so a follow-up nudge
        // counts as part of the same review, not as drift since it, and so the
        // stocks this dragged along can say where their move came from.
        try {
          await recordReviewMoves({
            direct: { ticker: character.ticker, from: currentPrice, to: targetPrice },
            trailing: trailingMoves,
            at: now,
          });
          setReviewSoFar(await loadReviewChanges());
        } catch (e) {
          console.error('Failed to update stored review changes:', e);
        }
      }

      const changePercent = (((targetPrice - currentPrice) / currentPrice) * 100).toFixed(1);
      const direction = targetPrice > currentPrice ? '📈' : '📉';

      showMessage(
        'success',
        `${direction} ${character.name}: $${currentPrice.toFixed(2)} → $${targetPrice.toFixed(2)} (${Number(changePercent) > 0 ? '+' : ''}${changePercent}%)`,
      );

      // Reset modal
      setPriceAdjustPercent('');
      setSelectedPriceCharacter(null);
    } catch (err) {
      console.error('Price adjustment error:', err);
      showMessage('error', 'Failed to adjust price: ' + errorMessage(err));
    }

    setLoading(false);
  };

  const updateMarketHalt = async (halted: boolean, reason: string) => {
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
    marketHaltStatus,
    marketHaltReason,
    haltReasonInput,
    setHaltReasonInput,
    updateMarketHalt,
    showPriceModal,
    setShowPriceModal: openPriceModal,
    priceModalSearch,
    setPriceModalSearch,
    reviewSoFar,
    selectedPriceCharacter,
    setSelectedPriceCharacter,
    priceAdjustPercent,
    setPriceAdjustPercent,
    handleModalPriceAdjustment,
  };
}
