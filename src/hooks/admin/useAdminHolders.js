import { useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { CHARACTERS } from '../../characters';

// Holders tab: list every holder of a ticker.
export function useAdminHolders({ showMessage, prices }) {
  // Holders state
  const [holdersTicker, setHoldersTicker] = useState('');
  const [holdersData, setHoldersData] = useState([]); // Array of { userId, displayName, shares, value }
  const [holdersLoading, setHoldersLoading] = useState(false);


  // Load holders for a specific character
  const loadHolders = async (ticker) => {
    if (!ticker) {
      setHoldersData([]);
      return;
    }
    
    setHoldersLoading(true);
    try {
      const usersRef = collection(db, 'users');
      const snapshot = await getDocs(usersRef);
      
      const holders = [];
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
      });
      
      // Sort by shares (highest first)
      holders.sort((a, b) => b.shares - a.shares);
      
      setHoldersData(holders);
    } catch (err) {
      console.error('Failed to load holders:', err);
      showMessage('error', 'Failed to load holders');
    }
    setHoldersLoading(false);
  };

  return {
    holdersTicker, setHoldersTicker, holdersData, setHoldersData,
    holdersLoading, loadHolders,
  };
}
