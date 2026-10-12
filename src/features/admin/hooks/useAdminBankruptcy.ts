import { useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../../firebase';
import { reinstateUserFunction } from '../../../api/callables';
import type { AdminHookDeps } from '../utils/adminShared';
import { errorMessage } from '../../../utils/errors';
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

// Bankruptcy recovery: the bankrupt-user list and reinstating one. Composed into useAdminUserOps.
export function useAdminBankruptcy({ showMessage, setLoading }: Pick<AdminHookDeps, 'showMessage' | 'setLoading'>) {
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

  return { bankruptLoaded, bankruptUsers, loadBankruptUsers, handleReinstateUser };
}
