import { useCallback } from 'react';
import { doc, runTransaction, updateDoc, deleteField } from 'firebase/firestore';
import { db } from '../../../firebase';
import { openWatchlistPicker, saveWatchlists } from '../../market/hooks/useWatchlists';
import { getWatchlists, toggleInList } from '../../market/utils/watchlists';
import { deleteAccountFunction } from '../../../api/callables';
import { ADMIN_UIDS } from '../../../constants';
import { errorMessage as messageOf } from '../../../utils/errors';
import type { User } from 'firebase/auth';
import type { AppContextValue, LooseDoc } from '../../../context/AppContext';
import type { UserData } from '../../../types';

export interface LimitOrderRequest {
  ticker: string;
  action: string;
  mode: string;
}

// Small one-shot user actions: watchlist, DRIP, limit-order requests,
// onboarding/tutorial completion, admin prediction hiding, account deletion.
export function useUserActions({
  user,
  userData,
  showNotification,
  setLimitOrderRequest,
}: {
  user: User | null;
  userData: UserData | null;
  showNotification: AppContextValue['showNotification'];
  setLimitOrderRequest: (request: LimitOrderRequest | null) => void;
}) {
  // The star on a stock: with one list it adds or removes the stock; with more,
  // it opens "Save to list" to pick which.
  const toggleWatchlist = useCallback(
    async (ticker: string) => {
      if (!user || !userData) return;
      const lists = getWatchlists(userData);
      if (lists.length > 1) return openWatchlistPicker(ticker);
      try {
        await saveWatchlists(user.uid, toggleInList(lists, lists[0]!.id, ticker));
      } catch (err) {
        console.error('Failed to update watchlist:', err);
      }
    },
    [user, userData],
  );

  // Handle limit order request from portfolio
  const handleLimitOrderRequest = useCallback(
    (ticker: string, action: string, mode?: string) => {
      if (!user || !userData) {
        showNotification('info', 'Sign in to start trading!');
        return;
      }
      setLimitOrderRequest({ ticker, action, mode: mode || 'limit' });
    },
    [user, userData, showNotification, setLimitOrderRequest],
  );

  // Hide prediction from feed (admin only)
  const handleHidePrediction = useCallback(
    async (predictionId: string) => {
      if (!user || !ADMIN_UIDS.includes(user.uid)) return;

      try {
        const predictionsRef = doc(db, 'predictions', 'current');
        // Read and write in one transaction: bets and long-term market trades
        // update this same list, and rewriting it from an earlier read erased any
        // that landed in between (charged, but missing from the pool).
        const hidden = await runTransaction(db, async (tx) => {
          const snap = await tx.get(predictionsRef);
          if (!snap.exists()) return false;
          const updatedList = ((snap.data().list as LooseDoc[] | undefined) || []).map((p) =>
            p.id === predictionId ? { ...p, hidden: true } : p,
          );
          tx.update(predictionsRef, { list: updatedList });
          return true;
        });
        if (hidden) showNotification('success', 'Prediction hidden from feed');
      } catch (err) {
        console.error('Failed to hide prediction:', err);
        showNotification('error', 'Failed to hide prediction');
      }
    },
    [user, showNotification],
  );

  // DRIP toggle
  const handleToggleDrip = useCallback(
    async (ticker: string) => {
      if (!user) return;
      const userRef = doc(db, 'users', user.uid);
      const isEnabled = !!userData?.drip?.[ticker];
      await updateDoc(userRef, { [`drip.${ticker}`]: isEnabled ? deleteField() : true });
    },
    [user, userData],
  );

  // Delete account
  const handleDeleteAccount = useCallback(
    async (confirmUsername: string) => {
      if (!user) return;

      try {
        // Call Cloud Function to delete account
        await deleteAccountFunction({ confirmUsername });
        showNotification('success', 'Account deleted successfully');
      } catch (err) {
        console.error('Failed to delete account:', err);
        const errorMessage = messageOf(err) || 'Failed to delete account. Please try again.';
        showNotification('error', errorMessage);
        throw err;
      }
    },
    [user, showNotification],
  );

  const handleMarginTutorialComplete = useCallback(async () => {
    if (!user) return;
    await updateDoc(doc(db, 'users', user.uid), { marginTutorialCompleted: true });
  }, [user]);

  const handleOnboardingComplete = useCallback(async () => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'users', user.uid), { onboardingComplete: true });
    } catch (err) {
      console.error('Failed to complete onboarding:', err);
    }
  }, [user]);

  return {
    toggleWatchlist,
    handleLimitOrderRequest,
    handleHidePrediction,
    handleToggleDrip,
    handleDeleteAccount,
    handleMarginTutorialComplete,
    handleOnboardingComplete,
  };
}
