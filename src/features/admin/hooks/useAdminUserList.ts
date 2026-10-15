import { useState, useRef } from 'react';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import { withUserDefaults } from '../utils/adminShared';
import type { AdminHookDeps, AdminUser } from '../utils/adminShared';
import type { UserData } from '../../../types';
import { sharesOf } from '../../../utils/holdings';
import { pickListFields } from '../utils/playerRows';

// Players: load the player list (the table filters and sorts it) and the
// selected player's full document.
export function useAdminUserList({
  showMessage,
  setLoading,
  prices,
}: Pick<AdminHookDeps, 'showMessage' | 'setLoading' | 'prices'>) {
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [allUsers, setAllUsers] = useState<AdminUser[]>([]);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);

  // Load all users for search
  const handleLoadAllUsers = async () => {
    setLoading(true);
    try {
      const usersRef = collection(db, 'users');
      const snapshot = await getDocs(usersRef);

      // Deliberately trimmed to the table's columns: this loads the whole
      // collection, so rows stay small. selectUser fetches the full document.
      const users: AdminUser[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        users.push({ id: doc.id, ...pickListFields(data), ...withUserDefaults(data) });
      });

      setAllUsers(users);
      setLoadedAt(Date.now());
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to load users');
    }
    setLoading(false);
  };

  // Open a user's card. handleLoadAllUsers trims every user to the columns the
  // table needs, so the detail panel would otherwise be missing anything not on
  // that list — achievements, crew head status, pins. Show the trimmed row
  // straight away so the card opens instantly, then swap in the real document.
  const selectingRef = useRef<string | null>(null);
  const selectUser = async (target: AdminUser | string | null) => {
    // A bare uid (from a name clicked anywhere in the panel) opens with the
    // loaded row if there is one, else a blank card until the document lands.
    const user =
      typeof target === 'string'
        ? allUsers.find((u) => u.id === target) || { id: target, ...withUserDefaults({ displayName: 'Loading...' }) }
        : target;
    if (!user) {
      selectingRef.current = null;
      setSelectedUser(null);
      return;
    }
    setSelectedUser(user);
    selectingRef.current = user.id;
    try {
      const snap = await getDoc(doc(db, 'users', user.id));
      // A quicker click on another user wins; don't swap this one back in.
      if (selectingRef.current !== user.id) return;
      // Raw document first so fields the list never loaded (achievements,
      // isCrewHead, pins) come through, then the defaults fill the blanks.
      if (snap.exists()) {
        const data = snap.data();
        setSelectedUser({ ...data, id: snap.id, ...withUserDefaults(data) });
      }
    } catch (err) {
      console.error('Failed to load full user document:', err);
    }
  };

  // Helper: Calculate live portfolio value for a user
  const calculateLivePortfolioValue = (userData: UserData): number | null => {
    if (!prices || Object.keys(prices).length === 0) return null;

    const holdings = userData.holdings || {};
    const shorts = userData.shorts || {};
    const cash = userData.cash || 0;

    // Calculate holdings value
    let holdingsValue = 0;
    for (const [ticker, holdingData] of Object.entries(holdings)) {
      const currentPrice = prices[ticker] || 0;
      const shares = sharesOf(holdingData);
      holdingsValue += currentPrice * shares;
    }

    // Calculate shorts value (collateral + P&L)
    let shortsValue = 0;
    for (const [ticker, position] of Object.entries(shorts)) {
      if (!position || typeof position !== 'object') continue;
      const shares = position.shares || 0;
      if (shares <= 0) continue;
      const entryPrice = position.costBasis || position.entryPrice || 0;
      const currentPrice = prices[ticker] || entryPrice;
      const collateral = position.margin || 0;
      if ((position.system ?? 'v2') === 'v2') {
        // v2: margin + unrealized P&L (no proceeds in cash)
        shortsValue += collateral + (entryPrice - currentPrice) * shares;
      } else {
        // Legacy: margin collateral - cost to buy back shares
        shortsValue += collateral - currentPrice * shares;
      }
    }

    return Math.round((cash + holdingsValue + shortsValue) * 100) / 100;
  };

  return {
    handleLoadAllUsers,
    allUsers,
    setAllUsers,
    loadedAt,
    selectedUser,
    setSelectedUser,
    selectUser,
    calculateLivePortfolioValue,
  };
}
