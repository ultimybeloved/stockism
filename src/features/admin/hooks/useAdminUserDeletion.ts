import { adminDeleteUserFunction } from '../../../api/callables';
import { ADMIN_UIDS } from '../../../constants';
import { summarizeForDeletion } from '../utils/deletionSummary';
import type { Dispatch, SetStateAction } from 'react';
import type { AdminHookDeps, AdminUser } from '../utils/adminShared';

// Delete one account from its player file, after two confirmations that spell
// out what goes with it. (Bulk delete mode was removed on 2026-10-14.)
export function useAdminUserDeletion({
  showMessage,
  setLoading,
  prices,
  setAllUsers,
}: Pick<AdminHookDeps, 'showMessage' | 'setLoading' | 'prices'> & {
  setAllUsers: Dispatch<SetStateAction<AdminUser[]>>;
}) {
  /** Resolves true once the account is gone. */
  const deleteUser = async (user: AdminUser): Promise<boolean> => {
    if (ADMIN_UIDS.includes(user.id)) {
      showMessage('error', 'Admin accounts cannot be deleted here');
      return false;
    }
    const { totalCash, totalShares, totalValue, totalShortShares, totalShortCollateral, holdingsSummary } =
      summarizeForDeletion([user.id], [user], prices);
    const top = Object.entries(holdingsSummary)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([ticker, shares]) => `${ticker}: ${shares}`)
      .join(', ');
    let summary =
      `DELETE ${user.displayName}?\n\n` +
      `Cash: $${totalCash.toFixed(2)}\n` +
      `Long shares: ${totalShares} (worth $${totalValue.toFixed(2)})\n`;
    if (totalShortShares > 0) {
      summary += `Short shares: ${totalShortShares} (collateral $${totalShortCollateral.toFixed(2)})\n`;
    }
    summary += `Top holdings: ${top || 'None'}\n\nThis cannot be undone.`;
    if (!window.confirm(summary)) return false;
    if (!window.confirm(`FINAL CONFIRMATION: permanently delete ${user.displayName}?`)) return false;

    setLoading(true);
    try {
      await adminDeleteUserFunction({ userId: user.id });
      setAllUsers((prev) => prev.filter((u) => u.id !== user.id));
      showMessage(
        'success',
        `Deleted ${user.displayName}. Removed $${totalCash.toFixed(2)} cash and ${totalShares} shares.`,
      );
      return true;
    } catch (err) {
      console.error(`Failed to delete user ${user.id}:`, err);
      showMessage('error', `Could not delete ${user.displayName}. Check the console.`);
      return false;
    } finally {
      setLoading(false);
    }
  };

  return { deleteUser };
}
