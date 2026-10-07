import { useState } from 'react';
import { doc, collection, getDocs, deleteDoc } from 'firebase/firestore';
import { db, createBotsFunction } from '../../firebase';
import type { AdminHookDeps } from './adminShared';
import { errorMessage } from '../../utils/errors';
import type { AdminUser } from './adminShared';
import type { UserData } from '../../types';

// Bots tab: list and delete bot accounts.
export function useAdminBots({ showMessage, setLoading }: Pick<AdminHookDeps, 'showMessage' | 'setLoading'>) {
  // Bot management state
  const [bots, setBots] = useState<AdminUser[]>([]);
  const [botsLoading, setBotsLoading] = useState(false);

  const handleLoadBots = async () => {
    setBotsLoading(true);
    try {
      const usersRef = collection(db, 'users');
      const usersSnap = await getDocs(usersRef);
      const botList: AdminUser[] = [];

      usersSnap.forEach((doc) => {
        const data = doc.data() as UserData;
        if (data.isBot) {
          botList.push({ id: doc.id, ...data });
        }
      });

      setBots(botList.sort((a, b) => (a.displayName as string).localeCompare(b.displayName as string)));
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed to load bots: ${errorMessage(err)}`);
    }
    setBotsLoading(false);
  };

  const handleDeleteBot = async (botId: string) => {
    if (!confirm(`Delete bot ${botId}?\n\nThis will remove their account and all holdings.`)) {
      return;
    }

    setLoading(true);
    try {
      await deleteDoc(doc(db, 'users', botId));
      showMessage('success', 'Bot deleted!');
      await handleLoadBots();
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed to delete bot: ${errorMessage(err)}`);
    }
    setLoading(false);
  };

  // Seed the standard bot roster. Safe to re-run: existing bots are skipped, so
  // this only fills gaps left by deletions rather than duplicating anyone.
  const handleCreateBots = async () => {
    if (!confirm('Create the standard bot roster?\n\nBots that already exist are left alone.')) {
      return;
    }

    setLoading(true);
    try {
      const { data } = await createBotsFunction({});
      if (data.created === 0) {
        showMessage('info', `Nothing to create — all ${data.skipped} bots already exist.`);
      } else {
        showMessage(
          'success',
          `✅ Created ${data.created} bot${data.created === 1 ? '' : 's'}${data.skipped > 0 ? ` (${data.skipped} already existed)` : ''}`,
        );
      }
      await handleLoadBots();
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed to create bots: ${errorMessage(err)}`);
    }
    setLoading(false);
  };

  return { bots, botsLoading, handleLoadBots, handleDeleteBot, handleCreateBots };
}
