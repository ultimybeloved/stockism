import { useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { CHARACTERS } from '../../characters';
import { getShortRisk } from '../../utils/calculations';

// Holders tab: list every long holder AND every short seller of a ticker.
// Both come out of one pass over the users collection — the scan already reads
// each full user doc, so the short side costs nothing extra.
export function useAdminHolders({ showMessage, prices }) {
  // Holders state
  const [holdersTicker, setHoldersTicker] = useState('');
  const [holdersData, setHoldersData] = useState([]); // Array of { userId, displayName, shares, value }
  const [shortsData, setShortsData] = useState([]);   // Array of { userId, displayName, shares, entryPrice, ... }
  const [holdersLoading, setHoldersLoading] = useState(false);


  // Load holders for a specific character
  const loadHolders = async (ticker) => {
    if (!ticker) {
      setHoldersData([]);
      setShortsData([]);
      return;
    }

    setHoldersLoading(true);
    try {
      const usersRef = collection(db, 'users');
      const snapshot = await getDocs(usersRef);

      const holders = [];
      const shorts = [];
      const currentPrice = prices[ticker] || CHARACTERS.find(c => c.ticker === ticker)?.basePrice || 0;

      snapshot.forEach(doc => {
        const userData = doc.data();
        const shares = userData.holdings?.[ticker] || 0;

        if (shares > 0) {
          holders.push({
            userId: doc.id,
            displayName: userData.displayName || 'Unknown',
            shares,
            value: shares * currentPrice,
            costBasis: userData.costBasis?.[ticker] || null
          });
        }

        const position = userData.shorts?.[ticker];
        if (position && position.shares > 0) {
          const entryPrice = Number(position.costBasis || position.entryPrice) || 0;
          // Same risk numbers the force-cover scanner uses, so the panel never
          // disagrees with what the server is about to do to this position.
          const risk = getShortRisk(position, currentPrice);
          shorts.push({
            userId: doc.id,
            displayName: userData.displayName || 'Unknown',
            shares: position.shares,
            entryPrice,
            value: position.shares * currentPrice,
            margin: risk?.margin || 0,
            pnl: (entryPrice - currentPrice) * position.shares,
            equityRatio: risk?.equityRatio ?? null,
            liquidationPrice: risk?.liquidationPrice ?? null,
            isAtRisk: !!risk?.isAtRisk,
            isCritical: !!risk?.isCritical,
          });
        }
      });

      // Sort by shares (highest first)
      holders.sort((a, b) => b.shares - a.shares);
      shorts.sort((a, b) => b.shares - a.shares);

      setHoldersData(holders);
      setShortsData(shorts);
    } catch (err) {
      console.error('Failed to load holders:', err);
      showMessage('error', 'Failed to load holders');
    }
    setHoldersLoading(false);
  };

  return {
    holdersTicker, setHoldersTicker, holdersData, setHoldersData,
    shortsData, setShortsData,
    holdersLoading, loadHolders,
  };
}
