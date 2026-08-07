import { useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';

// Every user's bets, flattened for the admin Predictions tab. Composed into
// useAdminBets.
export function useAdminBetsList({ showMessage }) {
  const [allBets, setAllBets] = useState([]);
  const [betsLoading, setBetsLoading] = useState(false);

  // Load all bets from all users
  const loadAllBets = async () => {
    setBetsLoading(true);
    try {
      const usersRef = collection(db, 'users');
      const snapshot = await getDocs(usersRef);
      
      const bets = [];
      
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        const userId = docSnap.id;
        const userName = data.displayName || 'Unknown';
        const userBets = data.bets || {};
        
        Object.entries(userBets).forEach(([predictionId, bet]) => {
          bets.push({
            userId,
            userName,
            predictionId,
            option: bet.option,
            amount: bet.amount || 0,
            placedAt: bet.placedAt || 0,
            question: bet.question || 'Unknown',
            paid: bet.paid || false,
            payout: bet.payout || 0
          });
        });
      });
      
      // Sort by most recent first
      bets.sort((a, b) => b.placedAt - a.placedAt);
      
      setAllBets(bets);
      showMessage('success', `Found ${bets.length} total bets`);
    } catch (err) {
      console.error('Failed to load bets:', err);
      showMessage('error', 'Failed to load bets');
    }
    setBetsLoading(false);
  };

  return { betsLoading, allBets, loadAllBets };
}
