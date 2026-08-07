import { useState } from 'react';
import { doc, getDoc, updateDoc, collection, getDocs } from 'firebase/firestore';
import { db, reinstateUserFunction } from '../../firebase';

// Bankruptcy recovery: the bankrupt-user list, reinstating one, and the manual
// rollback to a past transaction. Composed into useAdminUserOps.
export function useAdminBankruptcy({ showMessage, setLoading, setSelectedUser }) {
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

  return { bankruptLoaded, bankruptUsers, loadBankruptUsers, handleReinstateUser, handleRollbackUser };
}
