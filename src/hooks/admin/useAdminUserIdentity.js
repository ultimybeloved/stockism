import { useState } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db, adminSetDiscordWallFunction, adminUnlinkDiscordFunction } from '../../firebase';

// Who a user is, as far as the site is concerned: their Discord link, the
// suspected-alt wall, and their display name. Composed into useAdminUserOps.
export function useAdminUserIdentity({ showMessage, setLoading, setSelectedUser }) {
  const [newDisplayName, setNewDisplayName] = useState('');

  const handleToggleDiscordWall = async (userId, displayName, currentValue) => {
    const turningOn = !currentValue;
    if (!confirm(`${turningOn ? 'Require Discord verification for' : 'Clear the Discord wall on'} ${displayName}?`)) return;
    setLoading(true);
    try {
      const result = await adminSetDiscordWallFunction({ userId, value: turningOn });
      const note = turningOn && result.data.alreadyLinked ? ' (they are already linked, so the wall stays inactive)' : '';
      showMessage('success', `${turningOn ? 'Flagged' : 'Cleared'} ${displayName}${note}`);
      setSelectedUser(prev => prev ? { ...prev, requiresDiscordLink: turningOn } : prev);
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed: ${err.message}`);
    }
    setLoading(false);
  };

  // Players can't relink a different Discord themselves (that used to free the
  // old one for another account), so losing a Discord account comes here.
  const handleUnlinkDiscord = async (userId, displayName, discordUsername) => {
    if (!confirm(`Unlink Discord${discordUsername ? ` (${discordUsername})` : ''} from ${displayName}?\n\nThey will be able to link a different Discord. This does NOT give them the starting-cash bonus again.`)) return;
    setLoading(true);
    try {
      const result = await adminUnlinkDiscordFunction({ userId });
      showMessage('success', result.data.alreadyUnlinked
        ? `${displayName} had no Discord linked`
        : `Unlinked Discord from ${displayName}`);
      setSelectedUser(prev => prev ? { ...prev, discordId: null, discordUsername: null } : prev);
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed: ${err.message}`);
    }
    setLoading(false);
  };

  // Change user's display name
  const handleChangeDisplayName = async (userId, newName) => {
    if (!newName || newName.trim().length === 0) {
      showMessage('error', 'Display name cannot be empty');
      return;
    }

    if (!confirm(`Change display name to "${newName}"?`)) {
      return;
    }

    setLoading(true);
    try {
      const userRef = doc(db, 'users', userId);
      await updateDoc(userRef, {
        displayName: newName.trim(),
        displayNameLower: newName.trim().toLowerCase()
      });

      showMessage('success', `Changed display name to "${newName}"!`);
      setNewDisplayName('');

      // Refresh selected user data
      const updatedSnap = await getDoc(userRef);
      if (updatedSnap.exists()) {
        setSelectedUser({ id: updatedSnap.id, ...updatedSnap.data() });
      }
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed to change name: ${err.message}`);
    }
    setLoading(false);
  };

  return {
    handleToggleDiscordWall, handleUnlinkDiscord,
    newDisplayName, setNewDisplayName, handleChangeDisplayName,
  };
}
