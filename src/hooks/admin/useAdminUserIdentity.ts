import { useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import {
  db,
  adminSetDiscordWallFunction,
  adminUnlinkDiscordFunction,
  adminChangeDisplayNameFunction,
} from '../../firebase';
import type { AdminHookDeps } from './adminShared';
import { errorMessage } from '../../utils/errors';
import type { AdminUser } from './adminShared';

// Who a user is, as far as the site is concerned: their Discord link, the
// suspected-alt wall, and their display name. Composed into useAdminUserOps.
// The lost-account recovery tools live in useAdminDiscordRecovery.
export function useAdminUserIdentity({
  showMessage,
  setLoading,
  setSelectedUser,
}: Pick<AdminHookDeps, 'showMessage' | 'setLoading' | 'setSelectedUser'>) {
  const [newDisplayName, setNewDisplayName] = useState('');

  const handleToggleDiscordWall = async (userId: string, displayName: string, currentValue: boolean) => {
    const turningOn = !currentValue;
    if (!confirm(`${turningOn ? 'Require Discord verification for' : 'Clear the Discord wall on'} ${displayName}?`))
      return;
    setLoading(true);
    try {
      const result = await adminSetDiscordWallFunction({ userId, value: turningOn });
      const note =
        turningOn && result.data.alreadyLinked ? ' (they are already linked, so the wall stays inactive)' : '';
      showMessage('success', `${turningOn ? 'Flagged' : 'Cleared'} ${displayName}${note}`);
      setSelectedUser((prev) => (prev ? { ...prev, requiresDiscordLink: turningOn } : prev));
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed: ${errorMessage(err)}`);
    }
    setLoading(false);
  };

  // Players can unlink their own Discord now, but that binds it to their account
  // for good. This is the true release — it clears the binding too, so the
  // Discord can go on a different account.
  const handleUnlinkDiscord = async (userId: string, displayName: string, discordUsername?: string | null) => {
    if (
      !confirm(
        `Unlink Discord${discordUsername ? ` (${discordUsername})` : ''} from ${displayName}?\n\nThe Discord will be free to link to ANY account, including a different one. This does NOT give them the starting-cash bonus again.`,
      )
    )
      return;
    setLoading(true);
    try {
      const result = await adminUnlinkDiscordFunction({ userId });
      showMessage(
        'success',
        result.data.alreadyUnlinked ? `${displayName} had no Discord linked` : `Unlinked Discord from ${displayName}`,
      );
      setSelectedUser((prev) => (prev ? { ...prev, discordId: null, discordUsername: null } : prev));
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed: ${errorMessage(err)}`);
    }
    setLoading(false);
  };

  // Goes through adminChangeDisplayName, NOT a direct write: the username
  // reservation has to move with the name or the old one stays locked and the
  // new one is free for anyone else to claim.
  const handleChangeDisplayName = async (userId: string, newName: string) => {
    if (!newName || newName.trim().length === 0) {
      showMessage('error', 'Display name cannot be empty');
      return;
    }

    if (!confirm(`Change display name to "${newName}"?`)) {
      return;
    }

    setLoading(true);
    try {
      await adminChangeDisplayNameFunction({ userId, displayName: newName.trim() });

      showMessage('success', `Changed display name to "${newName.trim()}"!`);
      setNewDisplayName('');

      // Refresh selected user data
      const updatedSnap = await getDoc(doc(db, 'users', userId));
      if (updatedSnap.exists()) {
        setSelectedUser({ id: updatedSnap.id, ...updatedSnap.data() } as AdminUser);
      }
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed to change name: ${errorMessage(err)}`);
    }
    setLoading(false);
  };

  return {
    handleToggleDiscordWall,
    handleUnlinkDiscord,
    newDisplayName,
    setNewDisplayName,
    handleChangeDisplayName,
  };
}
