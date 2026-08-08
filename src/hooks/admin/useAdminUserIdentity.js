import { useState } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db, adminSetDiscordWallFunction, adminUnlinkDiscordFunction, adminMoveDiscordLinkFunction } from '../../firebase';

// Who a user is, as far as the site is concerned: their Discord link, the
// suspected-alt wall, and their display name. Composed into useAdminUserOps.
export function useAdminUserIdentity({ showMessage, setLoading, setSelectedUser }) {
  const [newDisplayName, setNewDisplayName] = useState('');
  // Account-recovery flow: the throwaway account whose Discord we're taking.
  const [moveSourceId, setMoveSourceId] = useState('');
  const [moveSource, setMoveSource] = useState(null);

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

  // Look up the account whose Discord is about to be moved, so the admin sees
  // exactly what they're about to strip before they confirm. Getting the two
  // accounts the wrong way round is the only real way to misfire this tool.
  const handleLookupMoveSource = async (rawId) => {
    const id = (rawId || '').trim();
    setMoveSource(null);
    if (!id) {
      showMessage('error', 'Paste the new account\'s user ID first');
      return;
    }
    setLoading(true);
    try {
      const snap = await getDoc(doc(db, 'users', id));
      if (!snap.exists()) {
        showMessage('error', 'No account with that ID');
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
    moveSourceId, setMoveSourceId, moveSource, handleLookupMoveSource, handleMoveDiscordLink,
    newDisplayName, setNewDisplayName, handleChangeDisplayName,
  };
}
