import { useState } from 'react';
import { doc, getDoc, updateDoc, collection, getDocs } from 'firebase/firestore';
import {
  db, reinstateUserFunction, adminSetCashFunction,
  adminTransferToLadderFunction, adminSetDiscordWallFunction,
} from '../../firebase';

// Per-user admin operations: bankrupt list + reinstate (Recovery tab) and
// cash/ladder/Discord-wall actions on the selected user (Users tab).
// setSelectedUser comes from the user-list state so these ops can refresh
// the open user card after acting on it.
export function useAdminUserOps({ showMessage, setLoading, setSelectedUser }) {
  //__STATE__

  // Load bankrupt users for recovery tab
  const [bankruptUsers, setBankruptUsers] = useState([]);
  const [bankruptLoaded, setBankruptLoaded] = useState(false);

  const loadBankruptUsers = async () => {
    if (bankruptLoaded) return;
    setLoading(true);
    try {
      const snapshot = await getDocs(collection(db, 'users'));
      const users = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.isBankrupt && !data.isBot) {
          users.push({
            id: doc.id,
            displayName: data.displayName || 'Unknown',
            cash: data.cash || 0,
            portfolioValue: data.portfolioValue || 0,
            bankruptAt: data.bankruptAt || null,
            totalTrades: data.totalTrades || 0,
            crew: data.crew || null,
            holdings: data.holdings || {},
            shorts: data.shorts || {}
          });
        }
      });
      users.sort((a, b) => (b.bankruptAt || 0) - (a.bankruptAt || 0));
      setBankruptUsers(users);
      setBankruptLoaded(true);
      showMessage('success', `Found ${users.length} bankrupt users`);
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to load bankrupt users');
    }
    setLoading(false);
  };

  const handleReinstateUser = async (userId, displayName) => {
    if (!confirm(`Reinstate ${displayName}? They'll get $1,000 cash and be un-bankrupted.`)) return;
    setLoading(true);
    try {
      await reinstateUserFunction({ userId });
      setBankruptUsers(prev => prev.filter(u => u.id !== userId));
      showMessage('success', `Reinstated ${displayName}`);
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed: ${err.message}`);
    }
    setLoading(false);
  };

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

  const handleToggleDiscordWall = async (userId, displayName, currentValue) => {
    const turningOn = !currentValue;
    if (!confirm(`${turningOn ? 'Require Discord verification for' : 'Clear the Discord wall on'} ${displayName}?`)) return;
    setLoading(true);
    try {
      const result = await adminSetDiscordWallFunction({ userId, value: turningOn });
      const note = turningOn && result.data.alreadyLinked ? ' (they are already linked, so the wall stays inactive)' : '';
      showMessage('success', `${turningOn ? 'Flagged' : 'Cleared'} ${displayName}${note}`);
      setSelectedUser(prev => prev ? { ...prev, requiresDiscordLink: turningOn } : prev);
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed: ${err.message}`);
    }
    setLoading(false);
  };

  // Manual rollback state
  const [newDisplayName, setNewDisplayName] = useState('');

  // Rollback user to a specific transaction timestamp
  const handleRollbackUser = async (userId, transaction) => {
    if (!confirm(`⚠️ ROLLBACK USER ⚠️\n\nRoll back to transaction from ${new Date(transaction.timestamp).toLocaleString()}?\n\nThis will:\n- Set cash to $${transaction.cashAfter?.toLocaleString() || '0'}\n- Set portfolio to $${transaction.portfolioAfter?.toLocaleString() || '0'}\n- You'll need to manually fix holdings/shorts\n\nContinue?`)) {
      return;
    }

    setLoading(true);
    try {
      const userRef = doc(db, 'users', userId);
      await updateDoc(userRef, {
        cash: transaction.cashAfter || 0,
        portfolioValue: transaction.portfolioAfter || 0
      });

      showMessage('success', `Rolled back user to ${new Date(transaction.timestamp).toLocaleString()}!`);

      // Refresh selected user data
      const updatedSnap = await getDoc(userRef);
      if (updatedSnap.exists()) {
        setSelectedUser({ id: updatedSnap.id, ...updatedSnap.data() });
      }
    } catch (err) {
      console.error(err);
      showMessage('error', `Rollback failed: ${err.message}`);
    }
    setLoading(false);
  };


  // Change user's display name
  const handleChangeDisplayName = async (userId, newName) => {
    if (!newName || newName.trim().length === 0) {
      showMessage('error', 'Display name cannot be empty');
      return;
    }

    if (!confirm(`Change display name to "${newName}"?`)) {
      return;
    }

    setLoading(true);
    try {
      const userRef = doc(db, 'users', userId);
      await updateDoc(userRef, {
        displayName: newName.trim(),
        displayNameLower: newName.trim().toLowerCase()
      });

      showMessage('success', `Changed display name to "${newName}"!`);
      setNewDisplayName('');

      // Refresh selected user data
      const updatedSnap = await getDoc(userRef);
      if (updatedSnap.exists()) {
        setSelectedUser({ id: updatedSnap.id, ...updatedSnap.data() });
      }
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed to change name: ${err.message}`);
    }
    setLoading(false);
  };

  return {
    bankruptLoaded, bankruptUsers, loadBankruptUsers, handleReinstateUser,
    handleSetCash, handleTransferToLadder, handleToggleDiscordWall,
    newDisplayName, setNewDisplayName, handleRollbackUser, handleChangeDisplayName,
  };
}
