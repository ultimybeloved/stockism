import { useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { aggregateMarketStats } from './aggregateMarketStats';
import type { AdminHookDeps } from './adminShared';

// Stats tab: aggregate market statistics.
export function useAdminStats({ showMessage, prices }: Pick<AdminHookDeps, 'showMessage' | 'prices'>) {
  // Market Stats state
  const [marketStats, setMarketStats] = useState<ReturnType<typeof aggregateMarketStats> | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // Load market stats
  const loadMarketStats = async () => {
    setStatsLoading(true);
    try {
      const usersRef = collection(db, 'users');
      const snapshot = await getDocs(usersRef);
      setMarketStats(aggregateMarketStats(snapshot, prices));
    } catch (err) {
      console.error('Failed to load market stats:', err);
      showMessage('error', 'Failed to load market stats');
    }
    setStatsLoading(false);
  };

  return { statsLoading, marketStats, loadMarketStats };
}
