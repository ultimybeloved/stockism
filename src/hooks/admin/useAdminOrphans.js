import { useState } from 'react';
import { doc, collection, getDocs, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { ADMIN_UIDS } from '../../constants';

// Stats tab: orphaned/abandoned account scan and cleanup.
export function useAdminOrphans({ showMessage, setLoading }) {
  // Orphan cleanup state
  const [orphanedUsers, setOrphanedUsers] = useState([]);
  const [orphanScanComplete, setOrphanScanComplete] = useState(false);

  // Scan for likely orphaned/bot accounts
  const scanForOrphanedUsers = async () => {
    setLoading(true);
    try {
      const usersRef = collection(db, 'users');
      const snapshot = await getDocs(usersRef);
      
      const suspicious = [];

      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        const id = docSnap.id;
        
        // Skip admin accounts
        if (ADMIN_UIDS.includes(id)) return;
        
        // Criteria for likely orphaned/bot accounts:
        // 1. No trades ever AND no checkins AND created more than a day ago
        // 2. Still has exactly starting cash ($1000) and no holdings
        // 3. No activity in over a week
        
        const totalTrades = data.totalTrades || 0;
        const totalCheckins = data.totalCheckins || 0;
        const cash = data.cash || 0;
        const holdings = data.holdings || {};
        const holdingsCount = Object.values(holdings).filter(s => s > 0).length;
        const lastActive = data.lastTradeTime || data.lastCheckin || data.createdAt || 0;
        const createdAt = data.createdAt || 0;
        const portfolioValue = data.portfolioValue || 0;
        
        // Flag as suspicious if:
        // - Zero activity (no trades, no checkins) AND default cash AND no holdings
        const isInactive = totalTrades === 0 && totalCheckins === 0 && holdingsCount === 0;
        const hasDefaultCash = cash === 1000 || (cash >= 999 && cash <= 1001);

        if (isInactive && hasDefaultCash) {
          suspicious.push({
            id,
            displayName: data.displayName || 'Unknown',
            cash,
            portfolioValue,
            totalTrades,
            totalCheckins,
            holdingsCount,
            createdAt,
            lastActive,
            reason: 'Zero activity + default cash'
          });
        }
      });
      
      // Sort by creation date (oldest first)
      suspicious.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      
      setOrphanedUsers(suspicious);
      setOrphanScanComplete(true);
      showMessage('success', `Found ${suspicious.length} likely orphaned/bot accounts`);
    } catch (err) {
      console.error('Failed to scan for orphans:', err);
      showMessage('error', 'Failed to scan for orphaned users');
    }
    setLoading(false);
  };

  // Delete a single orphaned user
  const deleteOrphanedUser = async (userId) => {
    if (!window.confirm(`Delete user ${userId}? This cannot be undone.`)) return;
    
    try {
      await deleteDoc(doc(db, 'users', userId));
      setOrphanedUsers(prev => prev.filter(u => u.id !== userId));
      showMessage('success', `Deleted user ${userId}`);
    } catch (err) {
      console.error('Failed to delete user:', err);
      showMessage('error', 'Failed to delete user');
    }
  };

  // Delete all orphaned users
  const deleteAllOrphanedUsers = async () => {
    if (!window.confirm(`Delete ALL ${orphanedUsers.length} orphaned users? This cannot be undone!`)) return;
    if (!window.confirm(`Are you REALLY sure? This will permanently delete ${orphanedUsers.length} user documents.`)) return;
    
    setLoading(true);
    try {
      let deleted = 0;
      for (const user of orphanedUsers) {
        await deleteDoc(doc(db, 'users', user.id));
        deleted++;
      }
      setOrphanedUsers([]);
      showMessage('success', `Deleted ${deleted} orphaned users`);
    } catch (err) {
      console.error('Failed to delete orphaned users:', err);
      showMessage('error', 'Failed to delete some users');
    }
    setLoading(false);
  };

  return {
    orphanScanComplete, orphanedUsers, scanForOrphanedUsers,
    deleteOrphanedUser, deleteAllOrphanedUsers,
  };
}
