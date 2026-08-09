import { adminSetCashFunction, adminTransferToLadderFunction } from '../../firebase';
import { useAdminBankruptcy } from './useAdminBankruptcy';
import { useAdminUserIdentity } from './useAdminUserIdentity';
import { useAdminDiscordRecovery } from './useAdminDiscordRecovery';
import { useAdminUserEdit } from './useAdminUserEdit';

// Per-user admin operations. Owns the balance actions (cash, ladder transfer)
// and composes the two sibling hooks so AdminPanel still spreads one object:
//   useAdminBankruptcy    — bankrupt list, reinstate, rollback (Recovery tab)
//   useAdminUserIdentity  — Discord wall, unlink, display name (Users tab)
//   useAdminDiscordRecovery — move a Discord link, unblock a Discord ID (Users tab)
//   useAdminUserEdit      — crew, achievements, margin, holdings (Users tab)
//
// setSelectedUser comes from the user-list state so these ops can refresh the
// open user card after acting on it.
export function useAdminUserOps({ showMessage, setLoading, setSelectedUser }) {
  const bankruptcy = useAdminBankruptcy({ showMessage, setLoading, setSelectedUser });
  const identity = useAdminUserIdentity({ showMessage, setLoading, setSelectedUser });
  const discordRecovery = useAdminDiscordRecovery({ showMessage, setLoading, setSelectedUser });
  const fieldEdits = useAdminUserEdit({ showMessage, setLoading, setSelectedUser });

  const handleSetCash = async (userId, displayName) => {
    const input = prompt(`Set cash for ${displayName}.\nEnter new cash amount:`);
    if (input === null) return;
    const cash = parseFloat(input);
    if (isNaN(cash) || cash < 0) {
      showMessage('error', 'Invalid cash amount');
      return;
    }
    if (!confirm(`Set ${displayName}'s cash to $${cash.toFixed(2)}?`)) return;
    setLoading(true);
    try {
      const result = await adminSetCashFunction({ userId, cash });
      showMessage('success', `Cash set to $${cash.toFixed(2)} (was $${result.data.previousCash})`);
      setSelectedUser(prev => prev ? { ...prev, cash } : prev);
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed: ${err.message}`);
    }
    setLoading(false);
  };

  const handleTransferToLadder = async (userId, displayName) => {
    const input = prompt(`Transfer cash to ${displayName}'s ladder game balance.\nEnter an amount (use a negative number to pull balance back to their cash):`);
    if (input === null) return;
    const amount = parseFloat(input);
    if (isNaN(amount) || amount === 0) {
      showMessage('error', 'Enter a non-zero amount');
      return;
    }
    const verb = amount > 0 ? `move $${amount.toFixed(2)} into` : `pull $${Math.abs(amount).toFixed(2)} out of`;
    if (!confirm(`${verb} ${displayName}'s ladder balance?`)) return;
    setLoading(true);
    try {
      const result = await adminTransferToLadderFunction({ userId, amount });
      showMessage('success', `Done. Cash: $${result.data.newCash.toFixed(2)} • Ladder: $${result.data.newLadderBalance.toFixed(2)}`);
      setSelectedUser(prev => prev ? { ...prev, cash: result.data.newCash } : prev);
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed: ${err.message}`);
    }
    setLoading(false);
  };

  return {
    ...bankruptcy,
    ...identity,
    ...discordRecovery,
    ...fieldEdits,
    handleSetCash,
    handleTransferToLadder,
  };
}
