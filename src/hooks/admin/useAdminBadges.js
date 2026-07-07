import { useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db, removeAchievementFunction } from '../../firebase';

// Badges tab: per-user achievement listing and revocation.
export function useAdminBadges({ showMessage, setLoading }) {
  // Badges tab state
  const [badgeUsers, setBadgeUsers] = useState([]);
  const [badgesLoaded, setBadgesLoaded] = useState(false);
  const [expandedBadge, setExpandedBadge] = useState(null);

  // Load users for badges tab
  const loadBadgeUsers = async () => {
    if (badgesLoaded) return;
    setLoading(true);
    try {
      const snapshot = await getDocs(collection(db, 'users'));
      const users = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        if ((data.achievements || []).length > 0) {
          users.push({
            id: doc.id,
            displayName: data.displayName || 'Unknown',
            achievements: data.achievements || [],
            achievementDates: data.achievementDates || {},
            portfolioValue: data.portfolioValue || 0,
            isBot: data.isBot || false
          });
        }
      });
      setBadgeUsers(users);
      setBadgesLoaded(true);
      showMessage('success', `Loaded ${users.length} users with achievements`);
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to load badge data');
    }
    setLoading(false);
  };

  const handleRemoveAchievement = async (userId, achievementId, displayName) => {
    if (!confirm(`Remove ${achievementId} from ${displayName}?`)) return;
    setLoading(true);
    try {
      await removeAchievementFunction({ userId, achievementId });
      // Update local state
      setBadgeUsers(prev => prev.map(u => {
        if (u.id !== userId) return u;
        const updated = { ...u, achievements: u.achievements.filter(a => a !== achievementId) };
        const dates = { ...u.achievementDates };
        delete dates[achievementId];
        updated.achievementDates = dates;
        return updated;
      }).filter(u => u.achievements.length > 0));
      showMessage('success', `Removed ${achievementId} from ${displayName}`);
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed to remove: ${err.message}`);
    }
    setLoading(false);
  };

  return {
    badgesLoaded, badgeUsers, expandedBadge, setExpandedBadge,
    loadBadgeUsers, handleRemoveAchievement,
  };
}
