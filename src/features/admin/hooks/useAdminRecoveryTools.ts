import { useState } from 'react';
import { getDoc } from 'firebase/firestore';
import { priceHistoryDocRef } from '../utils/adminShared';
import type { RenameTickerResponse } from '../../../api/types';
import type { PriceHistory } from '../../../types';

export interface TickerHistoryRow {
  timestamp: number;
  price: number;
  date: string;
}

// Recovery tab: price-history viewer and ticker rename state.
export function useAdminRecoveryTools() {
  const [selectedTickerHistory, setSelectedTickerHistory] = useState<TickerHistoryRow[]>([]);

  // Rename ticker state
  const [renameOldTicker, setRenameOldTicker] = useState('');
  const [renameNewTicker, setRenameNewTicker] = useState('');
  const [renameResult, setRenameResult] = useState<RenameTickerResponse | null>(null);

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
