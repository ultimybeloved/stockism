import { useState } from 'react';
import { doc, collection, getDocs, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase';

// Bots tab: list and delete bot accounts.
export function useAdminBots({ showMessage, setLoading }) {
  // Bot management state
  const [bots, setBots] = useState([]);
  const [botsLoading, setBotsLoading] = useState(false);

  const handleLoadBots = async () => {
    setBotsLoading(true);
    try {
      const usersRef = collection(db, 'users');
      const usersSnap = await getDocs(usersRef);
      const botList = [];

      usersSnap.forEach(doc => {
        const data = doc.data();
        if (data.isBot) {
          botList.push({ id: doc.id, ...data });
        }
      });

      setBots(botList.sort((a, b) => a.displayName.localeCompare(b.displayName)));
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed to load bots: ${err.message}`);
    }
    setBotsLoading(false);
  };

  const handleDeleteBot = async (botId) => {
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
      showMessage('error', `Failed to delete bot: ${err.message}`);
    }
    setLoading(false);
  };

  return { bots, botsLoading, handleLoadBots, handleDeleteBot };
}
