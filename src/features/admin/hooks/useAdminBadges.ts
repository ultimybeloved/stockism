import { useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../../firebase';
import { removeAchievementFunction } from '../../../api/callables';
import type { AdminHookDeps } from '../utils/adminShared';
import { errorMessage } from '../../../utils/errors';
import type { UserData } from '../../../types';

export interface BadgeUserRow {
  id: string;
  displayName: string;
  achievements: string[];
  achievementDates: Record<string, number | string>;
  portfolioValue: number;
  isBot: boolean;
}

// Badges tab: per-user achievement listing and revocation.
export function useAdminBadges({ showMessage, setLoading }: Pick<AdminHookDeps, 'showMessage' | 'setLoading'>) {
  // Badges tab state
  const [badgeUsers, setBadgeUsers] = useState<BadgeUserRow[]>([]);
  const [badgesLoaded, setBadgesLoaded] = useState(false);
  const [expandedBadge, setExpandedBadge] = useState<string | null>(null);

  // Load users for badges tab
  const loadBadgeUsers = async () => {
    if (badgesLoaded) return;
    setLoading(true);
    try {
      const snapshot = await getDocs(collection(db, 'users'));
      const users: BadgeUserRow[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data() as UserData & { achievementDates?: Record<string, number | string> };
        if ((data.achievements || []).length > 0) {
          users.push({
            id: doc.id,
            displayName: data.displayName || 'Unknown',
            achievements: data.achievements || [],
            achievementDates: data.achievementDates || {},
            portfolioValue: data.portfolioValue || 0,
            isBot: data.isBot || false,
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

  const handleRemoveAchievement = async (userId: string, achievementId: string, displayName: string) => {
    if (!confirm(`Remove ${achievementId} from ${displayName}?`)) return;
    setLoading(true);
    try {
      await removeAchievementFunction({ userId, achievementId });
      // Update local state
      setBadgeUsers((prev) =>
        prev
          .map((u) => {
            if (u.id !== userId) return u;
            const updated = { ...u, achievements: u.achievements.filter((a) => a !== achievementId) };
            const dates = { ...u.achievementDates };
            delete dates[achievementId];
            updated.achievementDates = dates;
            return updated;
          })
          .filter((u) => u.achievements.length > 0),
      );
      showMessage('success', `Removed ${achievementId} from ${displayName}`);
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed to remove: ${errorMessage(err)}`);
    }
    setLoading(false);
  };

  return {
    badgesLoaded,
    badgeUsers,
    expandedBadge,
    setExpandedBadge,
    loadBadgeUsers,
    handleRemoveAchievement,
  };
}
