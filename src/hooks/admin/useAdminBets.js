import { useState } from 'react';
import { doc, getDoc, updateDoc, collection, getDocs, arrayUnion } from 'firebase/firestore';
import { db } from '../../firebase';

// Predictions tab: bet listing plus the stuck-payout recovery tool.
export function useAdminBets({ showMessage, setLoading }) {
  // All Bets state
  const [allBets, setAllBets] = useState([]);
  const [betsLoading, setBetsLoading] = useState(false);

  // Recovery tool state
  const [recoveryPredictionId, setRecoveryPredictionId] = useState('');
  const [recoveryBets, setRecoveryBets] = useState([]);
  const [recoveryWinner, setRecoveryWinner] = useState('');
  const [recoveryOptions, setRecoveryOptions] = useState([]);

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

  // Scan all users for bets on a specific prediction ID
  const handleScanForBets = async () => {
    if (!recoveryPredictionId.trim()) {
      showMessage('error', 'Please enter a prediction ID (e.g., pred_1)');
      return;
    }

    setLoading(true);
    try {
      const usersRef = collection(db, 'users');
      const snapshot = await getDocs(usersRef);
      
      const bets = [];
      const optionsFound = new Set();
      
      snapshot.forEach(doc => {
        const userData = doc.data();
        const userBet = userData.bets?.[recoveryPredictionId.trim()];
        if (userBet) {
          bets.push({
            userId: doc.id,
            displayName: userData.displayName || 'Unknown',
            option: userBet.option,
            amount: userBet.amount,
            paid: userBet.paid || false,
            payout: userBet.payout || 0,
            cash: userData.cash || 0,
            predictionWins: userData.predictionWins || 0,
            achievements: userData.achievements || []
          });
          optionsFound.add(userBet.option);
        }
      });

      setRecoveryBets(bets);
      setRecoveryOptions(Array.from(optionsFound));
      
      if (bets.length === 0) {
        showMessage('error', `No bets found for prediction "${recoveryPredictionId}"`);
      } else {
        showMessage('success', `Found ${bets.length} bets across ${optionsFound.size} options`);
      }
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to scan users');
    }
    setLoading(false);
  };

  // Override previous payout decision — pays correct winners regardless of paid status
  const handleOverridePayout = async () => {
    if (recoveryBets.length === 0) {
      showMessage('error', 'No bets loaded — scan first');
      return;
    }
    if (!recoveryWinner) {
      showMessage('error', 'Select the correct winning option');
      return;
    }

    const predId = recoveryPredictionId.trim();
    const totalPool = recoveryBets.reduce((sum, bet) => sum + bet.amount, 0);
    const winningPool = recoveryBets
      .filter(b => b.option === recoveryWinner)
      .reduce((sum, bet) => sum + bet.amount, 0);

    if (winningPool === 0) {
      showMessage('error', 'No bets found for that option');
      return;
    }

    if (!window.confirm(
      `Pay correct winners for "${recoveryWinner}"?\n\n` +
      `Total pool: $${totalPool.toFixed(2)}\nWinning pool: $${winningPool.toFixed(2)}\n` +
      `${recoveryBets.filter(b => b.option === recoveryWinner).length} winners will be paid.\n\n` +
      `This ignores any previous payout. Losers are NOT touched.`
    )) return;

    setLoading(true);
    try {
      let paid = 0;
      for (const bet of recoveryBets) {
        if (bet.option !== recoveryWinner) continue;
        const userShare = bet.amount / winningPool;
        const payout = Math.round(userShare * totalPool * 100) / 100;

        const newPredictionWins = (bet.predictionWins || 0) + 1;
        const currentAchievements = bet.achievements || [];
        const newAchievements = [];
        if (newPredictionWins >= 3 && !currentAchievements.includes('ORACLE')) newAchievements.push('ORACLE');
        if (newPredictionWins >= 10 && !currentAchievements.includes('PROPHET')) newAchievements.push('PROPHET');
        if (winningPool > 0 && totalPool > 0 && (winningPool / totalPool) < 0.20 && !currentAchievements.includes('UNDERDOG')) newAchievements.push('UNDERDOG');

        const updateData = {
          cash: bet.cash + payout,
          [`bets.${predId}.paid`]: true,
          [`bets.${predId}.payout`]: payout,
          predictionWins: newPredictionWins
        };
        if (newAchievements.length > 0) updateData.achievements = arrayUnion(...newAchievements);

        try {
          await updateDoc(doc(db, 'users', bet.userId), updateData);
          paid++;
        } catch (err) {
          console.error('Failed to pay:', bet.displayName, err);
        }
      }

      // Update prediction outcome in Firestore to reflect the corrected winner
      const predictionsRef = doc(db, 'predictions', 'current');
      const snap = await getDoc(predictionsRef);
      if (snap.exists()) {
        const currentList = snap.data().list || [];
        const updatedList = currentList.map(p =>
          p.id === predId ? { ...p, resolved: true, outcome: recoveryWinner } : p
        );
        await updateDoc(predictionsRef, { list: updatedList });
      }

      showMessage('success', `Paid ${paid} correct winners for "${recoveryWinner}"`);
      setRecoveryBets([]);
      setRecoveryWinner('');
      setRecoveryOptions([]);
      setRecoveryPredictionId('');
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed: ${err.message}`);
    }
    setLoading(false);
  };

  return {
    betsLoading, allBets, loadAllBets,
    recoveryPredictionId, setRecoveryPredictionId, recoveryBets, setRecoveryBets,
    recoveryOptions, setRecoveryOptions, recoveryWinner, setRecoveryWinner,
    handleScanForBets, handleOverridePayout,
  };
}
