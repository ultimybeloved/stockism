import { useCallback } from 'react';
import { doc, getDoc, updateDoc, deleteField } from 'firebase/firestore';
import { db, deleteAccountFunction } from '../firebase';
import { ADMIN_UIDS } from '../constants';
import { errorMessage as messageOf } from '../utils/errors';
import type { User } from 'firebase/auth';
import type { AppContextValue, LooseDoc } from '../context/AppContext';
import type { UserData } from '../types';

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
  setShowPortfolio,
}: {
  user: User | null;
  userData: UserData | null;
  showNotification: AppContextValue['showNotification'];
  setLimitOrderRequest: (request: LimitOrderRequest | null) => void;
  setShowPortfolio: (show: boolean) => void;
}) {
  // Watchlist toggle
  const toggleWatchlist = useCallback(
    async (ticker: string) => {
      if (!user || !userData) return;
      const current = userData.watchlist || [];
      const updated = current.includes(ticker) ? current.filter((t) => t !== ticker) : [...current, ticker];
      try {
        await updateDoc(doc(db, 'users', user.uid), { watchlist: updated });
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
      setShowPortfolio(false); // Close portfolio modal
    },
    [user, userData, showNotification, setLimitOrderRequest, setShowPortfolio],
  );

  // Hide prediction from feed (admin only)
  const handleHidePrediction = useCallback(
    async (predictionId: string) => {
      if (!user || !ADMIN_UIDS.includes(user.uid)) return;

      try {
        const predictionsRef = doc(db, 'predictions', 'current');
        const snap = await getDoc(predictionsRef);
        if (snap.exists()) {
          const data = snap.data();
          const updatedList = ((data.list as LooseDoc[] | undefined) || []).map((p) =>
            p.id === predictionId ? { ...p, hidden: true } : p,
          );
          await updateDoc(predictionsRef, { list: updatedList });
          showNotification('success', 'Prediction hidden from feed');
        }
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
