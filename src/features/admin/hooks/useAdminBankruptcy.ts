import { useState } from 'react';
import { doc, getDoc, updateDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../../../firebase';
import { reinstateUserFunction } from '../../../api/callables';
import type { AdminHookDeps } from '../utils/adminShared';
import { errorMessage } from '../../../utils/errors';
import type { AdminUser } from '../utils/adminShared';
import type { ShareMap, ShortMap, UserData } from '../../../types';

export interface BankruptUserRow {
  id: string;
  displayName: string;
  cash: number;
  portfolioValue: number;
  bankruptAt: number | null;
  totalTrades: number;
  crew: string | null;
  holdings: ShareMap;
  shorts: ShortMap;
}

/** A transactionLog entry that recorded the balance after it. */
interface BalanceSnapshot {
  timestamp: number;
  cashAfter?: number;
  portfolioAfter?: number;
}

// Bankruptcy recovery: the bankrupt-user list, reinstating one, and the manual
// rollback to a past transaction. Composed into useAdminUserOps.
export function useAdminBankruptcy({
  showMessage,
  setLoading,
  setSelectedUser,
}: Pick<AdminHookDeps, 'showMessage' | 'setLoading' | 'setSelectedUser'>) {
  const [bankruptUsers, setBankruptUsers] = useState<BankruptUserRow[]>([]);
  const [bankruptLoaded, setBankruptLoaded] = useState(false);

  const loadBankruptUsers = async () => {
    if (bankruptLoaded) return;
    setLoading(true);
    try {
      const snapshot = await getDocs(collection(db, 'users'));
      const users: BankruptUserRow[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data() as UserData & { bankruptAt?: number };
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
            shorts: data.shorts || {},
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

  const handleReinstateUser = async (userId: string, displayName: string) => {
    if (!confirm(`Reinstate ${displayName}? They'll get $1,000 cash and be un-bankrupted.`)) return;
    setLoading(true);
    try {
      await reinstateUserFunction({ userId });
      setBankruptUsers((prev) => prev.filter((u) => u.id !== userId));
      showMessage('success', `Reinstated ${displayName}`);
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed: ${errorMessage(err)}`);
    }
    setLoading(false);
  };

  // Rollback user to a specific transaction timestamp
  const handleRollbackUser = async (userId: string, transaction: BalanceSnapshot) => {
    if (
      !confirm(
        `⚠️ ROLLBACK USER ⚠️\n\nRoll back to transaction from ${new Date(transaction.timestamp).toLocaleString()}?\n\nThis will:\n- Set cash to $${transaction.cashAfter?.toLocaleString() || '0'}\n- Set portfolio to $${transaction.portfolioAfter?.toLocaleString() || '0'}\n- You'll need to manually fix holdings/shorts\n\nContinue?`,
      )
    ) {
      return;
    }

    setLoading(true);
    try {
      const userRef = doc(db, 'users', userId);
      await updateDoc(userRef, {
        cash: transaction.cashAfter || 0,
        portfolioValue: transaction.portfolioAfter || 0,
      });

      showMessage('success', `Rolled back user to ${new Date(transaction.timestamp).toLocaleString()}!`);

      // Refresh selected user data
      const updatedSnap = await getDoc(userRef);
      if (updatedSnap.exists()) {
        setSelectedUser({ id: updatedSnap.id, ...updatedSnap.data() } as AdminUser);
      }
    } catch (err) {
      console.error(err);
      showMessage('error', `Rollback failed: ${errorMessage(err)}`);
    }
    setLoading(false);
  };

  return { bankruptLoaded, bankruptUsers, loadBankruptUsers, handleReinstateUser, handleRollbackUser };
}
