import { doc, getDoc, updateDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';

// Users tab: per-user and bulk portfolio value recalculation. Operates on the
// list state owned by useAdminUserList, passed in as deps.
export function useAdminPortfolioSync({ showMessage, setLoading, prices, selectedUser, setSelectedUser, calculateLivePortfolioValue, handleLoadAllUsers }) {
  // Sync portfolio value for a single user
  const handleSyncSingleUser = async (userId) => {
    if (!prices || Object.keys(prices).length === 0) {
      showMessage('error', 'No price data available');
      return;
    }

    setLoading(true);
    try {
      const userRef = doc(db, 'users', userId);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        showMessage('error', 'User not found');
        return;
      }

      const userData = userSnap.data();
      const newPortfolioValue = calculateLivePortfolioValue(userData);

      if (newPortfolioValue === null) {
        showMessage('error', 'Cannot calculate portfolio value');
        return;
      }

      await updateDoc(userRef, {
        portfolioValue: newPortfolioValue,
        lastSyncedAt: new Date()
      });

      showMessage('success', `Synced ${userData.displayName}'s portfolio`);

      // Update selected user and reload users list
      if (selectedUser && selectedUser.id === userId) {
        setSelectedUser({ ...userData, id: userId, portfolioValue: newPortfolioValue, lastSyncedAt: new Date() });
      }
      await handleLoadAllUsers();
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed to sync: ${err.message}`);
    }
    setLoading(false);
  };

  // Recalculate portfolio values for all users
  const handleRecalculatePortfolios = async () => {
    if (!prices || Object.keys(prices).length === 0) {
      showMessage('error', 'No price data available');
      return;
    }

    setLoading(true);
    try {
      const usersRef = collection(db, 'users');
      const snapshot = await getDocs(usersRef);

      let updated = 0;

      for (const userDoc of snapshot.docs) {
        const userData = userDoc.data();
        const newPortfolioValue = calculateLivePortfolioValue(userData);

        if (newPortfolioValue === null) continue;

        // Only update if different
        if (Math.abs(newPortfolioValue - (userData.portfolioValue || 0)) > 0.01) {
          await updateDoc(doc(db, 'users', userDoc.id), {
            portfolioValue: newPortfolioValue,
            lastSyncedAt: new Date()
          });
          updated++;
        }
      }

      showMessage('success', `Recalculated ${updated} portfolios`);
      // Reload users to see updated values
      await handleLoadAllUsers();
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed to recalculate: ${err.message}`);
    }
    setLoading(false);
  };


  return { handleSyncSingleUser, handleRecalculatePortfolios };
}
