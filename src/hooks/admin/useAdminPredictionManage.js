import { useState } from 'react';
import { doc, updateDoc, getDoc, collection, getDocs } from 'firebase/firestore';
import { db, triggerEventSettlementsFunction, cancelEventMarketFunction } from '../../firebase';

// Predictions tab: resolve, extend/reopen, cancel-refund, and delete.
// getEndTime comes from the create-form hook so both share the same end-time rule.
export function useAdminPredictionManage({ showMessage, setLoading, getEndTime }) {
  // Resolve prediction state
  const [selectedPrediction, setSelectedPrediction] = useState(null);
  const [selectedOutcomes, setSelectedOutcomes] = useState([]);

  // Extend/Reopen prediction state
  const [extendPredictionId, setExtendPredictionId] = useState('');
  const [extendDays, setExtendDays] = useState(7);
  const [allowAdditionalBets, setAllowAdditionalBets] = useState(false);

  // Resolve prediction
  const handleResolvePrediction = async () => {
    if (!selectedPrediction || selectedOutcomes.length === 0) {
      showMessage('error', 'Please select a prediction and at least one winning option');
      return;
    }

    setLoading(true);
    try {
      const predictionsRef = doc(db, 'predictions', 'current');
      const snap = await getDoc(predictionsRef);
      const currentList = snap.exists() ? (snap.data().list || []) : [];

      const updatedList = currentList.map(p => {
        if (p.id === selectedPrediction.id) {
          return {
            ...p,
            resolved: true,
            outcomes: selectedOutcomes,
            outcome: selectedOutcomes[0]
          };
        }
        return p;
      });

      await updateDoc(predictionsRef, { list: updatedList });

      const label = selectedOutcomes.length === 1 ? `"${selectedOutcomes[0]}"` : `"${selectedOutcomes.join('" & "')}"`;
      showMessage('success', `Resolved! Winner(s): ${label}`);
      if (selectedPrediction?.type === 'event') {
        try { await triggerEventSettlementsFunction(); } catch (e) { console.error('Settlement trigger failed', e); }
      }
      setSelectedPrediction(null);
      setSelectedOutcomes([]);
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to resolve prediction');
    }
    setLoading(false);
  };

  // Delete prediction
  const handleDeletePrediction = async (predictionId) => {
    if (!confirm('Are you sure you want to delete this prediction?')) return;

    setLoading(true);
    try {
      const predictionsRef = doc(db, 'predictions', 'current');
      const snap = await getDoc(predictionsRef);
      const currentList = snap.exists() ? (snap.data().list || []) : [];

      const updatedList = currentList.filter(p => p.id !== predictionId);

      await updateDoc(predictionsRef, { list: updatedList });

      showMessage('success', 'Prediction deleted');
      setSelectedPrediction(null);
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to delete prediction');
    }
    setLoading(false);
  };

  const handleCancelPrediction = async (predictionId) => {
    if (!confirm('Cancel this market and refund everyone their stake?')) return;

    setLoading(true);
    try {
      const predictionsRef = doc(db, 'predictions', 'current');
      const snap = await getDoc(predictionsRef);
      const currentList = snap.exists() ? (snap.data().list || []) : [];
      const prediction = currentList.find(p => p.id === predictionId);

      // Long-term (event) markets hold money in eventPositions, not bets — refund
      // server-side where the full user scan and per-user transactions live.
      if (prediction?.type === 'event') {
        const res = await cancelEventMarketFunction({ marketId: predictionId });
        const { refunded = 0, total = 0 } = res?.data || {};
        showMessage('success', `Market cancelled — ${refunded} holder${refunded !== 1 ? 's' : ''} refunded ($${Math.round(total).toLocaleString()})`);
        setSelectedPrediction(null);
        setLoading(false);
        return;
      }

      // Weekly predictions: mark cancelled and refund bets from the client.
      const updatedList = currentList.map(p =>
        p.id === predictionId ? { ...p, cancelled: true, cancelledAt: Date.now() } : p
      );
      await updateDoc(predictionsRef, { list: updatedList });

      // Refund all unpaid bettors
      const usersSnap = await getDocs(collection(db, 'users'));
      let refunded = 0;
      for (const userDoc of usersSnap.docs) {
        const userData = userDoc.data();
        const bet = userData.bets?.[predictionId];
        if (!bet || bet.paid) continue;
        try {
          await updateDoc(doc(db, 'users', userDoc.id), {
            cash: (userData.cash || 0) + bet.amount,
            [`bets.${predictionId}.paid`]: true,
            [`bets.${predictionId}.payout`]: bet.amount,
            [`bets.${predictionId}.refunded`]: true,
          });
          refunded++;
        } catch (e) {
          console.error('Failed to refund', userDoc.id, e);
        }
      }

      showMessage('success', `Prediction cancelled — ${refunded} bettor${refunded !== 1 ? 's' : ''} refunded`);
    } catch (err) {
      console.error(err);
      showMessage('error', 'Cancel failed');
    }
    setLoading(false);
  };

  // Extend/Reopen prediction deadline
  const handleExtendPrediction = async () => {
    if (!extendPredictionId) {
      showMessage('error', 'Please select a prediction');
      return;
    }

    setLoading(true);
    try {
      const predictionsRef = doc(db, 'predictions', 'current');
      const snap = await getDoc(predictionsRef);
      const currentList = snap.exists() ? (snap.data().list || []) : [];

      const updatedList = currentList.map(p => {
        if (p.id === extendPredictionId) {
          return {
            ...p,
            endsAt: getEndTime(extendDays),
            allowAdditionalBets: allowAdditionalBets,
            reopened: true
          };
        }
        return p;
      });

      await updateDoc(predictionsRef, { list: updatedList });

      const pred = currentList.find(p => p.id === extendPredictionId);
      showMessage('success', `Extended "${pred?.question}" by ${extendDays} days${allowAdditionalBets ? ' • Additional bets allowed' : ''}`);
      setExtendPredictionId('');
      setExtendDays(7);
      setAllowAdditionalBets(false);
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to extend prediction');
    }
    setLoading(false);
  };

  return {
    selectedPrediction, setSelectedPrediction, selectedOutcomes, setSelectedOutcomes,
    handleResolvePrediction, handleDeletePrediction, handleCancelPrediction,
    extendPredictionId, setExtendPredictionId, extendDays, setExtendDays,
    allowAdditionalBets, setAllowAdditionalBets, handleExtendPrediction,
  };
}
