import { useState } from 'react';
import { doc, getDoc, updateDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { priceHistoryDocRef } from './adminShared';
import type { AdminHookDeps } from './adminShared';
import { errorMessage } from '../../utils/errors';
import type { RenameTickerResponse } from '../../api/types';
import type { LoggedTransaction, PriceHistory, UserData } from '../../types';

export interface TickerHistoryRow {
  timestamp: number;
  price: number;
  date: string;
}

// Recovery tab: full market rollback, price-history viewer, ticker rename state.
export function useAdminRecoveryTools({ showMessage, setLoading }: Pick<AdminHookDeps, 'showMessage' | 'setLoading'>) {
  const [rollbackTimestamp, setRollbackTimestamp] = useState('');
  const [rollbackConfirm, setRollbackConfirm] = useState(false);
  const [selectedTickerHistory, setSelectedTickerHistory] = useState<TickerHistoryRow[]>([]);

  // Rename ticker state
  const [renameOldTicker, setRenameOldTicker] = useState('');
  const [renameNewTicker, setRenameNewTicker] = useState('');
  const [renameResult, setRenameResult] = useState<RenameTickerResponse | null>(null);

  // FULL MARKET ROLLBACK - Reverses all trades after a timestamp
  const executeFullRollback = async (rollbackTimestamp: number) => {
    setLoading(true);
    try {
      const usersRef = collection(db, 'users');
      const usersSnapshot = await getDocs(usersRef);
      const marketRef = doc(db, 'market', 'current');
      const histSnap = await getDoc(priceHistoryDocRef());
      const priceHistory: PriceHistory = histSnap.exists() ? histSnap.data() || {} : {};

      let tradesReversed = 0;
      let usersAffected = 0;
      const priceRollbacks: Record<string, number> = {};

      // First, find prices at the rollback timestamp
      for (const [ticker, history] of Object.entries(priceHistory)) {
        if (!history || history.length === 0) continue;

        // Find the price at or before the rollback timestamp
        let priceAtRollback = history[0]?.price || 100; // Default to first price or 100
        for (let i = history.length - 1; i >= 0; i--) {
          const point = history[i]!;
          if (point.timestamp <= rollbackTimestamp) {
            priceAtRollback = point.price;
            break;
          }
        }
        priceRollbacks[ticker] = priceAtRollback;
      }

      // Process each user
      for (const userDoc of usersSnapshot.docs) {
        const userData = userDoc.data() as UserData;
        const userId = userDoc.id;
        const transactionLog = userData.transactionLog || [];

        // Find trades after rollback timestamp
        const tradesToReverse = transactionLog.filter(
          (tx: LoggedTransaction) =>
            tx.timestamp > rollbackTimestamp && ['BUY', 'SELL', 'SHORT_OPEN', 'SHORT_CLOSE'].includes(tx.type),
        );

        if (tradesToReverse.length === 0) continue;

        usersAffected++;
        tradesReversed += tradesToReverse.length;

        // Calculate reversals
        let cashAdjustment = 0;
        const holdingsAdjustments: Record<string, number> = {};
        const shortsAdjustments: Record<string, number> = {};

        for (const tx of tradesToReverse) {
          const ticker = tx.ticker as string;

          switch (tx.type) {
            case 'BUY':
              // Reverse buy: remove shares, refund cash
              holdingsAdjustments[ticker] = (holdingsAdjustments[ticker] || 0) - (tx.shares || tx.amount || 0);
              cashAdjustment += tx.totalCost || 0;
              break;
            case 'SELL':
              // Reverse sell: add shares back, remove cash received
              holdingsAdjustments[ticker] = (holdingsAdjustments[ticker] || 0) + (tx.shares || tx.amount || 0);
              cashAdjustment -= tx.totalRevenue || 0;
              break;
            case 'SHORT_OPEN':
              // Reverse short open: remove short position, refund margin
              shortsAdjustments[ticker] = (shortsAdjustments[ticker] || 0) - (tx.shares || 0);
              cashAdjustment += tx.marginRequired || 0;
              break;
            case 'SHORT_CLOSE':
              // Reverse short close: restore short position, remove cash returned
              shortsAdjustments[ticker] = (shortsAdjustments[ticker] || 0) + (tx.shares || 0);
              cashAdjustment -= tx.cashBack || 0;
              break;
          }
        }

        // Build update object
        const userRef = doc(db, 'users', userId);
        const updateData: Record<string, unknown> = {
          cash: (userData.cash || 0) + cashAdjustment,
          // Remove trades after rollback from log
          transactionLog: transactionLog.filter((tx) => tx.timestamp <= rollbackTimestamp),
        };

        // Apply holdings adjustments
        for (const [ticker, adjustment] of Object.entries(holdingsAdjustments)) {
          const currentHolding = userData.holdings?.[ticker] || 0;
          const newHolding = Math.max(0, currentHolding + adjustment);
          updateData[`holdings.${ticker}`] = newHolding;
        }

        // Apply shorts adjustments (simplified - may need more complex logic)
        for (const [ticker, adjustment] of Object.entries(shortsAdjustments)) {
          const currentShort = userData.shorts?.[ticker]?.shares || 0;
          const newShortShares = Math.max(0, currentShort + adjustment);
          if (newShortShares === 0) {
            updateData[`shorts.${ticker}`] = { shares: 0, margin: 0, entryPrice: 0 };
          }
        }

        await updateDoc(userRef, updateData);
      }

      // Now rollback all prices AND clean price history
      const priceUpdates: Record<string, number> = {};
      for (const [ticker, price] of Object.entries(priceRollbacks)) {
        priceUpdates[`prices.${ticker}`] = price;
      }

      // Also trim price history to remove bad data after rollback point
      const historyUpdates: PriceHistory = {};
      for (const [ticker, history] of Object.entries(priceHistory)) {
        if (!history || history.length === 0) continue;
        // Keep only entries at or before the rollback timestamp
        const cleanedHistory = history.filter((h) => h.timestamp <= rollbackTimestamp);
        if (cleanedHistory.length !== history.length) {
          historyUpdates[ticker] = cleanedHistory;
        }
      }

      if (Object.keys(priceUpdates).length > 0) {
        await updateDoc(marketRef, priceUpdates);
      }
      if (Object.keys(historyUpdates).length > 0) {
        await updateDoc(priceHistoryDocRef(), historyUpdates);
      }

      const historyTrimmed = Object.keys(historyUpdates).length;
      showMessage(
        'success',
        `Rollback complete! Reversed ${tradesReversed} trades for ${usersAffected} users. Prices restored. ${historyTrimmed > 0 ? `Cleaned history for ${historyTrimmed} tickers.` : ''}`,
      );
    } catch (err) {
      console.error('Full rollback failed:', err);
      showMessage('error', 'Rollback failed: ' + errorMessage(err));
    }
    setLoading(false);
  };

  // Get price history for investigation
  const getPriceHistoryForTicker = async (ticker: string): Promise<TickerHistoryRow[]> => {
    try {
      const histSnap = await getDoc(priceHistoryDocRef());
      const history: PriceHistory[string] = (histSnap.data() || {})[ticker] || [];
      return history.slice(-1000).map((h) => ({
        timestamp: h.timestamp,
        price: h.price,
        date: new Date(h.timestamp).toLocaleString(),
      }));
    } catch (err) {
      console.error('Failed to get price history:', err);
      return [];
    }
  };

  return {
    rollbackTimestamp,
    setRollbackTimestamp,
    rollbackConfirm,
    setRollbackConfirm,
    executeFullRollback,
    selectedTickerHistory,
    setSelectedTickerHistory,
    getPriceHistoryForTicker,
    renameOldTicker,
    setRenameOldTicker,
    renameNewTicker,
    setRenameNewTicker,
    renameResult,
    setRenameResult,
  };
}
