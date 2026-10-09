import { useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import {
  adminSetCrewFunction,
  adminGrantAchievementFunction,
  adminSetMarginFunction,
  adminSetHoldingFunction,
} from '../../../api/callables';
import type { AdminHookDeps } from '../utils/adminShared';
import { errorMessage } from '../../../utils/errors';
import type { HttpsCallableResult } from 'firebase/functions';
import type { AdminUser } from '../utils/adminShared';

// Direct edits to one user's game state — the fixes that used to mean opening
// the Firebase console. Backed by functions/src/admin/adminUserEdit.js.
export function useAdminUserEdit({
  showMessage,
  setLoading,
  setSelectedUser,
}: Pick<AdminHookDeps, 'showMessage' | 'setLoading' | 'setSelectedUser'>) {
  const [editTicker, setEditTicker] = useState('');
  const [editShares, setEditShares] = useState('');
  const [editCostBasis, setEditCostBasis] = useState('');

  // The callables change fields the open user card is displaying, so re-read the
  // doc rather than guessing at the new shape in local state.
  const refreshSelectedUser = async (userId: string) => {
    const snap = await getDoc(doc(db, 'users', userId));
    if (snap.exists()) setSelectedUser({ id: snap.id, ...snap.data() } as AdminUser);
  };

  const run = async <T>(
    action: () => Promise<HttpsCallableResult<T>>,
    successMessage: (data: T) => string,
  ): Promise<T | null> => {
    setLoading(true);
    try {
      const result = await action();
      showMessage('success', successMessage(result.data));
      return result.data;
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed: ${errorMessage(err)}`);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const handleSetCrew = async (userId: string, displayName: string, crewId: string | null, crewName?: string) => {
    const label = crewId ? `move ${displayName} to ${crewName}` : `remove ${displayName} from their crew`;
    if (
      !confirm(`Really ${label}?\n\nNo switch penalty, no rejoin lockout. They lose crew head status if they have it.`)
    )
      return;
    const data = await run(
      () => adminSetCrewFunction({ userId, crewId: crewId || null }),
      (d) => (d.unchanged ? `${displayName} is already there` : `${displayName} → ${crewName || 'no crew'}`),
    );
    if (data) await refreshSelectedUser(userId);
  };

  const handleGrantAchievement = async (
    userId: string,
    displayName: string,
    achievementId: string,
    achievementName: string,
  ) => {
    if (!achievementId) {
      showMessage('error', 'Pick an achievement first');
      return;
    }
    const data = await run(
      () => adminGrantAchievementFunction({ userId, achievementId }),
      (d) =>
        d.alreadyEarned ? `${displayName} already has ${achievementName}` : `Gave ${achievementName} to ${displayName}`,
    );
    if (data) await refreshSelectedUser(userId);
  };

  const handleSetMargin = async (userId: string, displayName: string, enabled: boolean, clearDebt: boolean) => {
    const bits = [enabled ? 'enable margin' : 'disable margin'];
    if (clearDebt) bits.push('wipe what they owe');
    if (
      !confirm(
        `${bits.join(' and ')} for ${displayName}?${clearDebt ? '\n\nForgiven debt is not repaid from their cash.' : ''}`,
      )
    )
      return;
    const data = await run(
      () => adminSetMarginFunction({ userId, enabled, clearDebt }),
      (d) =>
        `Margin ${d.marginEnabled ? 'on' : 'off'} for ${displayName}${d.clearedDebt ? ` (cleared $${d.previousMarginUsed.toFixed(2)})` : ''}`,
    );
    if (data) await refreshSelectedUser(userId);
  };

  const handleSetHolding = async (userId: string, displayName: string) => {
    const ticker = editTicker.trim().toUpperCase();
    const shares = Number(editShares);
    if (!ticker) {
      showMessage('error', 'Pick a ticker');
      return;
    }
    if (!isFinite(shares) || shares < 0) {
      showMessage('error', 'Shares must be 0 or more');
      return;
    }
    const basis = editCostBasis.trim() === '' ? null : Number(editCostBasis);
    if (basis !== null && (!isFinite(basis) || basis < 0)) {
      showMessage('error', 'Cost basis must be 0 or more');
      return;
    }
    if (
      !confirm(
        shares === 0
          ? `Remove ${displayName}'s entire ${ticker} position?`
          : `Set ${displayName}'s ${ticker} to ${shares} shares${basis !== null ? ` at $${basis} cost basis` : ''}?`,
      )
    )
      return;

    const data = await run(
      () => adminSetHoldingFunction({ userId, ticker, shares, costBasis: basis }),
      (d) => `${ticker}: ${d.previousShares} → ${d.shares} shares. Hit Sync to refresh their portfolio value.`,
    );
    if (data) {
      setEditTicker('');
      setEditShares('');
      setEditCostBasis('');
      await refreshSelectedUser(userId);
    }
  };

  return {
    handleSetCrew,
    handleGrantAchievement,
    handleSetMargin,
    handleSetHolding,
    editTicker,
    setEditTicker,
    editShares,
    setEditShares,
    editCostBasis,
    setEditCostBasis,
  };
}
