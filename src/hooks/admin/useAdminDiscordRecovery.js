import { useState } from 'react';
import { doc, getDoc, collection, query, where, limit, getDocs } from 'firebase/firestore';
import { db, adminMoveDiscordLinkFunction, adminFreeDiscordFunction } from '../../firebase';

// Getting a player back into the right account after their Discord login broke.
// Split out of useAdminUserIdentity, which was at its 200-line limit.
//
// Two tools, for two different dead ends:
//   Move link  — their Discord still works but is on the wrong account.
//   Unblock ID — no account holds the Discord, yet it still can't be linked,
//                because the account it was on was deleted (30-day cooldown) or
//                they unlinked it themselves (permanent binding).
export function useAdminDiscordRecovery({ showMessage, setLoading, setSelectedUser }) {
  // The throwaway account whose Discord we're taking.
  const [moveSourceId, setMoveSourceId] = useState('');
  const [moveSource, setMoveSource] = useState(null);
  // Discord ID to release when no account holds it any more.
  const [freeDiscordId, setFreeDiscordId] = useState('');

  // Accepts whatever the admin actually has to hand — the user ID off the user
  // card, the player's display name, or either half of their Discord. Exact
  // matches only, so there's never a question of which account was found.
  const findAccount = async (id) => {
    // Doc ID first. Anything with a slash isn't one and would throw.
    if (!id.includes('/')) {
      const direct = await getDoc(doc(db, 'users', id));
      if (direct.exists()) return direct;
    }
    const users = collection(db, 'users');
    const attempts = [
      query(users, where('displayNameLower', '==', id.toLowerCase()), limit(1)),
      query(users, where('discordUsername', '==', id), limit(1)),
      query(users, where('discordId', '==', id), limit(1)),
    ];
    for (const attempt of attempts) {
      const snap = await getDocs(attempt);
      if (!snap.empty) return snap.docs[0];
    }
    return null;
  };

  // Look up the account whose Discord is about to be moved, so the admin sees
  // exactly what they're about to strip before they confirm. Getting the two
  // accounts the wrong way round is the only real way to misfire this tool.
  const handleLookupMoveSource = async (rawId) => {
    const id = (rawId || '').trim();
    setMoveSource(null);
    if (!id) {
      showMessage('error', 'Enter the new account\'s name, Discord, or user ID first');
      return;
    }
    setLoading(true);
    try {
      const snap = await findAccount(id);
      if (!snap) {
        showMessage('error', `No account matches "${id}". Try their exact display name, Discord username, Discord ID, or the user ID from their user card.`);
      } else {
        const d = snap.data();
        setMoveSource({
          id: snap.id,
          displayName: d.displayName || d.username || '(no name)',
          discordId: d.discordId || null,
          discordUsername: d.discordUsername || null,
          cash: d.cash || 0,
          portfolioValue: d.portfolioValue || 0,
          createdAt: d.createdAt?.toDate?.() || null
        });
      }
    } catch (err) {
      console.error(err);
      showMessage('error', `Lookup failed: ${err.message}`);
    }
    setLoading(false);
  };

  // Moves the Discord link, not the portfolio. The player logs in with their new
  // Discord and lands in their original account.
  const handleMoveDiscordLink = async (targetUserId, targetName) => {
    if (!moveSource) {
      showMessage('error', 'Look up the new account first');
      return;
    }
    if (moveSource.id === targetUserId) {
      showMessage('error', 'That is the same account');
      return;
    }
    if (!moveSource.discordId) {
      showMessage('error', `${moveSource.displayName} has no Discord linked — nothing to move`);
      return;
    }
    if (!confirm(
      `Move Discord ${moveSource.discordUsername || moveSource.discordId} off "${moveSource.displayName}" and onto "${targetName}"?\n\n` +
      `"${targetName}" keeps its own portfolio. Nothing is transferred.\n` +
      `"${moveSource.displayName}" loses its login for good (its data stays for the record).\n\n` +
      `They then log in with that Discord and land in "${targetName}".`
    )) return;
    setLoading(true);
    try {
      const result = await adminMoveDiscordLinkFunction({ sourceUserId: moveSource.id, targetUserId });
      const { alreadyMoved, discordId } = result.data;
      const discordUsername = moveSource.discordUsername;
      showMessage('success', alreadyMoved
        ? `${targetName} was already on that Discord`
        : `Moved ${discordUsername || discordId} to ${targetName}. They can log in with Discord now.`);
      setSelectedUser(prev => prev ? { ...prev, discordId, discordUsername } : prev);
      setMoveSource(null);
      setMoveSourceId('');
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed: ${err.message}`);
    }
    setLoading(false);
  };

  const handleFreeDiscord = async (rawId) => {
    const id = (rawId || '').trim();
    if (!/^\d{5,32}$/.test(id)) {
      showMessage('error', 'Enter a numeric Discord ID (Discord → right-click the user → Copy User ID)');
      return;
    }
    if (!confirm(`Free Discord ID ${id}?\n\nIt will be linkable to any account again.`)) return;
    setLoading(true);
    try {
      const { data } = await adminFreeDiscordFunction({ discordId: id });
      const cleared = [
        data.clearedTombstone && 'delete cooldown',
        data.clearedBinding && 'account binding',
      ].filter(Boolean);
      showMessage('success', cleared.length
        ? `Freed ${id} (cleared ${cleared.join(' and ')}). They can link it now.`
        : `${id} had nothing blocking it — it was already free to link.`);
      setFreeDiscordId('');
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed: ${err.message}`);
    }
    setLoading(false);
  };

  return {
    moveSourceId, setMoveSourceId, moveSource, handleLookupMoveSource, handleMoveDiscordLink,
    freeDiscordId, setFreeDiscordId, handleFreeDiscord,
  };
}
