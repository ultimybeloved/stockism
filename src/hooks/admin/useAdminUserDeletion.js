import { useState } from 'react';
import { doc, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { CHARACTERS } from '../../characters';
import { ADMIN_UIDS } from '../../constants';

// Users tab: multi-select delete mode. Operates on the list state owned by
// useAdminUserList, passed in as deps.
export function useAdminUserDeletion({ showMessage, setLoading, prices, allUsers, setAllUsers, setUserSearchResults }) {
  const [deleteMode, setDeleteMode] = useState(false);
  const [selectedForDeletion, setSelectedForDeletion] = useState(new Set());

  // Toggle user selection for deletion
  const toggleUserForDeletion = (userId) => {
    setSelectedForDeletion(prev => {
      const newSet = new Set(prev);
      if (newSet.has(userId)) {
        newSet.delete(userId);
      } else {
        newSet.add(userId);
      }
      return newSet;
    });
  };

  // Delete selected users
  const deleteSelectedUsers = async () => {
    if (selectedForDeletion.size === 0) {
      showMessage('error', 'No users selected for deletion');
      return;
    }
    
    // Calculate what's being deleted
    let totalCash = 0;
    let totalShares = 0;
    let totalValue = 0;
    let totalShortShares = 0;
    let totalShortCollateral = 0;
    const holdingsSummary = {};
    const shortsSummary = {};
    
    for (const userId of selectedForDeletion) {
      const user = allUsers.find(u => u.id === userId);
      if (!user) continue;
      
      totalCash += user.cash || 0;
      
      // Sum up holdings
      if (user.holdings) {
        Object.entries(user.holdings).forEach(([ticker, shares]) => {
          const shareCount = typeof shares === 'number' ? shares : (shares?.shares || 0);
          if (shareCount > 0) {
            totalShares += shareCount;
            holdingsSummary[ticker] = (holdingsSummary[ticker] || 0) + shareCount;
            const character = CHARACTERS.find(c => c.ticker === ticker);
            const price = prices[ticker] || character?.basePrice || 0;
            totalValue += shareCount * price;
          }
        });
      }
      
      // Sum up shorts
      if (user.shorts) {
        Object.entries(user.shorts).forEach(([ticker, position]) => {
          if (position && position.shares > 0) {
            totalShortShares += position.shares;
            totalShortCollateral += position.margin || 0;
            shortsSummary[ticker] = (shortsSummary[ticker] || 0) + position.shares;
          }
        });
      }
    }
    
    // Build summary message
    const topHoldings = Object.entries(holdingsSummary)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([ticker, shares]) => `${ticker}: ${shares}`)
      .join(', ');
    
    const topShorts = Object.entries(shortsSummary)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([ticker, shares]) => `${ticker}: ${shares}`)
      .join(', ');
    
    let summaryMsg = `DELETE ${selectedForDeletion.size} USERS?\n\n` +
      `💰 Total Cash: $${totalCash.toFixed(2)}\n` +
      `📊 Long Shares: ${totalShares}\n` +
      `💵 Long Value: $${totalValue.toFixed(2)}\n`;
    
    if (totalShortShares > 0) {
      summaryMsg += `🩳 Short Shares: ${totalShortShares}\n` +
        `🔒 Short Collateral: $${totalShortCollateral.toFixed(2)}\n`;
    }
    
    summaryMsg += `\n📈 Top Holdings: ${topHoldings || 'None'}`;
    if (topShorts) {
      summaryMsg += `\n📉 Top Shorts: ${topShorts}`;
    }
    summaryMsg += `\n\nThis cannot be undone!`;
    
    if (!window.confirm(summaryMsg)) return;
    if (!window.confirm(`FINAL CONFIRMATION: Permanently delete ${selectedForDeletion.size} user accounts?`)) return;
    
    setLoading(true);
    let deleted = 0;
    let failed = 0;
    const failedIds = [];
    
    for (const userId of selectedForDeletion) {
      // Don't allow deleting admin
      if (ADMIN_UIDS.includes(userId)) continue;
      
      try {
        await deleteDoc(doc(db, 'users', userId));
        deleted++;
      } catch (err) {
        console.error(`Failed to delete user ${userId}:`, err);
        failed++;
        failedIds.push(userId);
      }
    }
    
    // Remove successfully deleted users from lists
    const successfullyDeleted = new Set([...selectedForDeletion].filter(id => !failedIds.includes(id)));
    setAllUsers(prev => prev.filter(u => !successfullyDeleted.has(u.id)));
    setUserSearchResults(prev => prev.filter(u => !successfullyDeleted.has(u.id)));
    
    // Keep failed ones selected so user can retry
    if (failed > 0) {
      setSelectedForDeletion(new Set(failedIds));
      showMessage('error', `Deleted ${deleted}, but ${failed} failed. Check console for details. Failed IDs still selected.`);
    } else {
      setSelectedForDeletion(new Set());
      setDeleteMode(false);
      showMessage('success', `Deleted ${deleted} users. Removed $${totalCash.toFixed(2)} cash and ${totalShares} shares.`);
    }
    
    setLoading(false);
  };

  return {
    deleteMode, setDeleteMode, selectedForDeletion, setSelectedForDeletion,
    toggleUserForDeletion, deleteSelectedUsers,
  };
}
