import { useState } from 'react';
import { doc, getDoc, runTransaction } from 'firebase/firestore';
import { db } from '../../../firebase';
import {
  triggerEventSettlementsFunction,
  cancelEventMarketFunction,
  adminCancelPredictionFunction,
} from '../../../api/callables';
import type { AdminHookDeps } from '../utils/adminShared';
import { errorMessage } from '../../../utils/errors';
import { logPanelAction } from '../utils/panelLog';
import type { PredictionDoc } from '../../../types';

// Predictions tab: resolve, extend/reopen, cancel-refund, and delete.
// getEndTime comes from the create-form hook so both share the same end-time rule.
export function useAdminPredictionManage({
  showMessage,
  setLoading,
  getEndTime,
}: Pick<AdminHookDeps, 'showMessage' | 'setLoading'> & { getEndTime: (days: number) => number }) {
  // Resolve prediction state
  const [selectedPrediction, setSelectedPrediction] = useState<PredictionDoc | null>(null);
  const [selectedOutcomes, setSelectedOutcomes] = useState<string[]>([]);

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
      // Read and write in one transaction: players' bets and long-term market
      // trades update this same list, and rewriting it from an earlier read
      // erased any that landed in between (charged, but missing from the pool).
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(predictionsRef);
        const currentList: PredictionDoc[] = snap.exists() ? snap.data().list || [] : [];
        const updatedList = currentList.map((p) =>
          p.id === selectedPrediction.id
            ? { ...p, resolved: true, outcomes: selectedOutcomes, outcome: selectedOutcomes[0] }
            : p,
        );
        tx.update(predictionsRef, { list: updatedList });
      });
      await logPanelAction({
        action: 'resolve_prediction',
        after: { id: selectedPrediction.id, question: selectedPrediction.question, outcomes: selectedOutcomes },
      });

      const label = selectedOutcomes.length === 1 ? `"${selectedOutcomes[0]}"` : `"${selectedOutcomes.join('" & "')}"`;
      showMessage('success', `Resolved! Winner(s): ${label}`);
      if (selectedPrediction?.type === 'event') {
        try {
          await triggerEventSettlementsFunction();
        } catch (e) {
          // Resolved, but not paid out yet: say so instead of reporting success.
          console.error('Settlement trigger failed', e);
          showMessage('error', 'Resolved, but paying out failed just now. It retries on its own within 30 minutes.');
        }
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
  const handleDeletePrediction = async (predictionId: string) => {
    if (!confirm('Are you sure you want to delete this prediction?')) return;

    setLoading(true);
    try {
      const predictionsRef = doc(db, 'predictions', 'current');
      // One transaction, so a bet landing mid-delete can't slip past the check
      // below or be erased by the rewrite.
      const { blocked, currentList } = await runTransaction(db, async (tx) => {
        const snap = await tx.get(predictionsRef);
        const list: PredictionDoc[] = snap.exists() ? snap.data().list || [] : [];

        // Deleting takes the prediction away from everyone who put money in: their
        // stakes were taken when they bet, and claiming then fails with "not found".
        // Only allow it once nobody's money is in it, or after Cancel has refunded them.
        const target = list.find((p) => p.id === predictionId);
        if (target && !target.cancelled) {
          const staked =
            Object.values(target.pools || {}).reduce((sum, v) => sum + (Number(v) || 0), 0) +
            (target.yesPool || 0) +
            (target.noPool || 0) -
            (target.seedTotal || 0);
          if (target.type === 'event' || staked > 0.005) return { blocked: true, currentList: list };
        }
        tx.update(predictionsRef, { list: list.filter((p) => p.id !== predictionId) });
        return { blocked: false, currentList: list };
      });
      if (blocked) {
        showMessage('error', 'Players have money in this one. Cancel it first (that refunds them), then delete.');
        setLoading(false);
        return;
      }
      await logPanelAction({
        action: 'delete_prediction',
        before: currentList.find((p) => p.id === predictionId) || { id: predictionId },
      });

      showMessage('success', 'Prediction deleted');
      setSelectedPrediction(null);
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to delete prediction');
    }
    setLoading(false);
  };

  const handleCancelPrediction = async (predictionId: string) => {
    if (!confirm('Cancel this market and refund everyone their stake?')) return;

    setLoading(true);
    try {
      const predictionsRef = doc(db, 'predictions', 'current');
      const snap = await getDoc(predictionsRef);
      const currentList: PredictionDoc[] = snap.exists() ? snap.data().list || [] : [];
      const prediction = currentList.find((p) => p.id === predictionId);

      // Long-term (event) markets hold money in eventPositions, not bets — refund
      // server-side where the full user scan and per-user transactions live.
      if (prediction?.type === 'event') {
        const res = await cancelEventMarketFunction({ marketId: predictionId });
        const { refunded = 0, total = 0 } = res?.data || {};
        showMessage(
          'success',
          `Market cancelled — ${refunded} holder${refunded !== 1 ? 's' : ''} refunded ($${Math.round(total).toLocaleString()})`,
        );
        setSelectedPrediction(null);
        setLoading(false);
        return;
      }

      // Weekly predictions: the server marks it cancelled and refunds every
      // stake, with ledger entries and an admin history record.
      const res = await adminCancelPredictionFunction({ predictionId });
      const { refunded = 0, total = 0 } = res?.data || {};
      showMessage(
        'success',
        `Prediction cancelled: ${refunded} bettor${refunded !== 1 ? 's' : ''} refunded ($${Math.round(total).toLocaleString()})`,
      );
      setSelectedPrediction(null);
    } catch (err) {
      console.error(err);
      showMessage('error', `Cancel failed: ${errorMessage(err)}`);
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
      // One transaction, for the same reason as resolve above.
      const currentList = await runTransaction(db, async (tx) => {
        const snap = await tx.get(predictionsRef);
        const list: PredictionDoc[] = snap.exists() ? snap.data().list || [] : [];
        const updatedList = list.map((p) =>
          p.id === extendPredictionId
            ? { ...p, endsAt: getEndTime(extendDays), allowAdditionalBets: allowAdditionalBets, reopened: true }
            : p,
        );
        tx.update(predictionsRef, { list: updatedList });
        return list;
      });

      const pred = currentList.find((p) => p.id === extendPredictionId);
      await logPanelAction({
        action: 'extend_prediction',
        before: { id: extendPredictionId, question: pred?.question, endsAt: pred?.endsAt },
        after: { endsAt: getEndTime(extendDays), allowAdditionalBets },
      });
      showMessage(
        'success',
        `Extended "${pred?.question}" by ${extendDays} days${allowAdditionalBets ? ' • Additional bets allowed' : ''}`,
      );
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
    selectedPrediction,
    setSelectedPrediction,
    selectedOutcomes,
    setSelectedOutcomes,
    handleResolvePrediction,
    handleDeletePrediction,
    handleCancelPrediction,
    extendPredictionId,
    setExtendPredictionId,
    extendDays,
    setExtendDays,
    allowAdditionalBets,
    setAllowAdditionalBets,
    handleExtendPrediction,
  };
}
