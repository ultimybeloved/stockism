import { useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import {
  listBackupsFunction,
  restoreBackupFunction,
  triggerManualBackupFunction,
  adminTransferAccountFunction,
} from '../../../api/callables';
import { errorMessage } from '../../../utils/errors';
import type { BackupFile } from '../../../api/types';
import type { AdminHookDeps } from '../utils/adminShared';

// Recovery tab: backup list/restore, manual backup and whole-account data transfer.
export function useAdminBackups({
  showMessage,
  setMessage,
  setLoading,
  handleSyncPricesToHistory,
}: Pick<AdminHookDeps, 'showMessage' | 'setMessage' | 'setLoading'> & {
  handleSyncPricesToHistory: () => Promise<void>;
}) {
  // Backup restore state
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);

  // User data transfer state
  const [oldUserId, setOldUserId] = useState('');
  const [newUserId, setNewUserId] = useState('');
  const [transferring, setTransferring] = useState(false);

  // List available backups
  const handleListBackups = async () => {
    setLoadingBackups(true);
    try {
      const result = await listBackupsFunction();
      setBackups(result.data.backups || []);
      showMessage('success', `Found ${result.data.total} backups`);
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to list backups: ' + errorMessage(err));
    }
    setLoadingBackups(false);
  };

  // Restore from backup
  const handleRestoreBackup = async (backupName: string) => {
    if (
      !window.confirm(
        `RESTORE FROM BACKUP?\n\nThis will restore price history from:\n${backupName}\n\nCurrent prices will be synced to match the latest history point.`,
      )
    ) {
      return;
    }

    setRestoringBackup(true);
    try {
      const result = await restoreBackupFunction({ backupName });
      showMessage('success', `Restored ${result.data.tickersRestored} tickers from backup!`);

      // Now sync current prices to match latest history
      await handleSyncPricesToHistory();

      // Refresh backups list
      await handleListBackups();
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to restore backup: ' + errorMessage(err));
    }
    setRestoringBackup(false);
  };

  const handleManualBackup = async () => {
    if (!window.confirm('Create a manual backup of market data?')) return;
    setLoading(true);
    setMessage(null);
    try {
      const result = await triggerManualBackupFunction();
      setMessage({ type: 'success', text: `Backup created: ${result.data.filename}` });
    } catch (error) {
      setMessage({ type: 'error', text: `Backup failed: ${errorMessage(error)}` });
    } finally {
      setLoading(false);
    }
  };

  // Transfer all data from old user to new user
  const handleTransferUserData = async () => {
    if (!oldUserId.trim() || !newUserId.trim()) {
      showMessage('error', 'Please enter both old and new user IDs');
      return;
    }

    if (oldUserId.trim() === newUserId.trim()) {
      showMessage('error', 'Old and new user IDs cannot be the same');
      return;
    }

    setTransferring(true);
    try {
      const oldUserRef = doc(db, 'users', oldUserId.trim());
      const newUserRef = doc(db, 'users', newUserId.trim());

      // Get old user data
      const oldUserSnap = await getDoc(oldUserRef);
      if (!oldUserSnap.exists()) {
        showMessage('error', `Old user ID not found: ${oldUserId}`);
        setTransferring(false);
        return;
      }

      // Get new user data (to show what will be overwritten)
      const newUserSnap = await getDoc(newUserRef);
      if (!newUserSnap.exists()) {
        showMessage('error', `New user ID not found: ${newUserId}`);
        setTransferring(false);
        return;
      }

      const oldData = oldUserSnap.data();
      const newData = newUserSnap.data();

      // One confirmation up front. The server copies everything, moves the name
      // and ladder balance, and then always removes the old account, so money and
      // shares can never end up on both.
      if (
        !confirm(
          `TRANSFER ACCOUNT

Move ALL data from the old account to the new one?

OLD USER: ${oldData.displayName || 'Unknown'}
Portfolio: $${(oldData.portfolioValue || 0).toLocaleString()}
Check-ins: ${oldData.totalCheckins || 0}

NEW USER: ${newData.displayName || 'Unknown'}
Portfolio: $${(newData.portfolioValue || 0).toLocaleString()}
Check-ins: ${newData.totalCheckins || 0}

The new account is REPLACED by the old one, and the old account is then DELETED.

This cannot be undone. Continue?`,
        )
      ) {
        setTransferring(false);
        return;
      }

      await adminTransferAccountFunction({ fromUserId: oldUserId.trim(), toUserId: newUserId.trim() });
      showMessage('success', `Moved ${oldData.displayName} to the new account. The old account was removed.`);

      setOldUserId('');
      setNewUserId('');
    } catch (err) {
      console.error(err);
      showMessage('error', `Transfer failed: ${errorMessage(err)}`);
    }
    setTransferring(false);
  };

  return {
    loadingBackups,
    backups,
    handleListBackups,
    restoringBackup,
    handleRestoreBackup,
    handleManualBackup,
    oldUserId,
    setOldUserId,
    newUserId,
    setNewUserId,
    transferring,
    handleTransferUserData,
  };
}
