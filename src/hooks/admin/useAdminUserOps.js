import { adminSetCashFunction, adminTransferToLadderFunction } from '../../firebase';
import { parseCashInput, describeCashChange } from '../../utils/adminCash';
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

  // One input covers all three modes: a leading + or - adjusts the balance, a
  // bare number replaces it. The confirm step then spells out the resulting
  // arithmetic, so the amount never has to be worked out by hand.
  const handleSetCash = async (userId, displayName, currentCash = 0) => {
    const input = prompt(
      `Cash for ${displayName} — currently $${Number(currentCash).toFixed(2)}\n\n`
      + '  +500   add $500\n'
      + '  -500   subtract $500\n'
      + '   500   set the balance to exactly $500'
    );
    if (input === null) return;

    const parsed = parseCashInput(input, currentCash);
    if (!parsed.ok) {
      showMessage('error', parsed.error);
      return;
    }
    const { mode, amount, before, after } = parsed;

    const memo = prompt(
      `Why? This is recorded against ${displayName} so you can look it up later.\n\n`
      + 'e.g. "prize for weekly contest", "refund for the halt bug"'
    );
    if (memo === null) return;
    if (!memo.trim()) {
      showMessage('error', 'A memo is required');
      return;
    }

    const summary = describeCashChange(parsed, displayName);
    if (!confirm(`${summary}?\n\n$${before.toFixed(2)}  ->  $${after.toFixed(2)}\n\nMemo: ${memo.trim()}`)) return;

    setLoading(true);
    try {
      const result = await adminSetCashFunction({
        userId, mode, amount, memo: memo.trim(),
      });
      const { previousCash, newCash } = result.data;
      showMessage('success', `Cash $${previousCash.toFixed(2)} -> $${newCash.toFixed(2)}`);
      setSelectedUser(prev => prev ? { ...prev, cash: newCash } : prev);
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
