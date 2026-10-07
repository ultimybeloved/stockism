import { useState } from 'react';
import { doc, getDoc, updateDoc, collection, getDocs, arrayUnion, increment } from 'firebase/firestore';
import { grantedDaysFor } from '../../utils/seasonWeeks';
import { db } from '../../firebase';
import type { AdminHookDeps } from './adminShared';
import { errorMessage } from '../../utils/errors';
import type { FieldValue } from 'firebase/firestore';
import type { PredictionDoc, UserData } from '../../types';

export interface RecoveryBetRow {
  userId: string;
  displayName: string;
  option: string;
  amount: number;
  paid: boolean;
  payout: number;
  cash: number;
  predictionWins: number;
  achievements: string[];
}

// The stuck-payout recovery tool: scan every user for bets on one prediction,
// then settle it by hand. Composed into useAdminBets.
export function useAdminBetRecovery({ showMessage, setLoading }: Pick<AdminHookDeps, 'showMessage' | 'setLoading'>) {
  const [recoveryPredictionId, setRecoveryPredictionId] = useState('');
  const [recoveryBets, setRecoveryBets] = useState<RecoveryBetRow[]>([]);
  const [recoveryWinner, setRecoveryWinner] = useState('');
  const [recoveryOptions, setRecoveryOptions] = useState<string[]>([]);

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

      const bets: RecoveryBetRow[] = [];
      const optionsFound = new Set<string>();

      snapshot.forEach((doc) => {
        const userData = doc.data() as UserData;
        const userBet = userData.bets?.[recoveryPredictionId.trim()];
        if (userBet) {
          bets.push({
            userId: doc.id,
            displayName: userData.displayName || 'Unknown',
            option: userBet.option as string,
            amount: userBet.amount as number,
            paid: userBet.paid || false,
            payout: userBet.payout || 0,
            cash: userData.cash || 0,
            predictionWins: userData.predictionWins || 0,
            achievements: userData.achievements || [],
          });
          optionsFound.add(userBet.option as string);
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
      .filter((b) => b.option === recoveryWinner)
      .reduce((sum, bet) => sum + bet.amount, 0);

    if (winningPool === 0) {
      showMessage('error', 'No bets found for that option');
      return;
    }

    if (
      !window.confirm(
        `Pay correct winners for "${recoveryWinner}"?\n\n` +
          `Total pool: $${totalPool.toFixed(2)}\nWinning pool: $${winningPool.toFixed(2)}\n` +
          `${recoveryBets.filter((b) => b.option === recoveryWinner).length} winners will be paid.\n\n` +
          `This ignores any previous payout. Losers are NOT touched.`,
      )
    )
      return;

    setLoading(true);
    try {
      let paid = 0;
      for (const bet of recoveryBets) {
        if (bet.option !== recoveryWinner) continue;
        const userShare = bet.amount / winningPool;
        const payout = Math.round(userShare * totalPool * 100) / 100;

        const newPredictionWins = (bet.predictionWins || 0) + 1;
        const currentAchievements = bet.achievements || [];
        const newAchievements: string[] = [];
        if (newPredictionWins >= 3 && !currentAchievements.includes('ORACLE')) newAchievements.push('ORACLE');
        if (newPredictionWins >= 10 && !currentAchievements.includes('PROPHET')) newAchievements.push('PROPHET');
        if (
          winningPool > 0 &&
          totalPool > 0 &&
          winningPool / totalPool < 0.2 &&
          !currentAchievements.includes('UNDERDOG')
        )
          newAchievements.push('UNDERDOG');

        const updateData: Record<string, number | boolean | FieldValue> = {
          cash: bet.cash + payout,
          [`bets.${predId}.paid`]: true,
          [`bets.${predId}.payout`]: payout,
          predictionWins: newPredictionWins,
          // Booked like the server's predictionFlowUpdate, so a recovery payout
          // never counts as a trading gain on season or percent boards.
          grantedValue: increment(payout),
          predictionFlowValue: increment(payout),
          grantedDays: increment(grantedDaysFor(payout)),
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
        const currentList: PredictionDoc[] = snap.data().list || [];
        const updatedList = currentList.map((p) =>
          p.id === predId ? { ...p, resolved: true, outcome: recoveryWinner } : p,
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
      showMessage('error', `Failed: ${errorMessage(err)}`);
    }
    setLoading(false);
  };

  return {
    recoveryPredictionId,
    setRecoveryPredictionId,
    recoveryBets,
    setRecoveryBets,
    recoveryOptions,
    setRecoveryOptions,
    recoveryWinner,
    setRecoveryWinner,
    handleScanForBets,
    handleOverridePayout,
  };
}
