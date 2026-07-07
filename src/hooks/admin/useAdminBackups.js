import { useState } from 'react';
import { doc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import {
  db, listBackupsFunction, restoreBackupFunction,
  triggerManualBackupFunction, reconstructPortfolioHistoryFunction,
} from '../../firebase';

// Recovery tab: backup list/restore, manual backup, portfolio-history
// reconstruction, and whole-account data transfer.
export function useAdminBackups({ showMessage, setMessage, setLoading, handleSyncPricesToHistory }) {
  // Backup restore state
  const [backups, setBackups] = useState([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [reconstructingHistory, setReconstructingHistory] = useState(false);
  const [reconstructionResult, setReconstructionResult] = useState(null);
  const [reconstructUid, setReconstructUid] = useState('');

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
      showMessage('error', 'Failed to list backups: ' + err.message);
    }
    setLoadingBackups(false);
  };

  // Restore from backup
  const handleRestoreBackup = async (backupName) => {
    if (!window.confirm(`⚠️ RESTORE FROM BACKUP?\n\nThis will restore price history from:\n${backupName}\n\nCurrent prices will be synced to match the latest history point.`)) {
      return;
    }

    setRestoringBackup(true);
    try {
      const result = await restoreBackupFunction({ backupName });
      showMessage('success', `✅ Restored ${result.data.tickersRestored} tickers from backup!`);

      // Now sync current prices to match latest history
      await handleSyncPricesToHistory();

      // Refresh backups list
      await handleListBackups();
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to restore backup: ' + err.message);
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
      setMessage({ type: 'error', text: `Backup failed: ${error.message}` });
    } finally {
      setLoading(false);
    }
  };

  const handleReconstructPortfolioHistory = async () => {
    const target = reconstructUid.trim() || null;
    const label = target ? `user ${target}` : 'ALL non-bot users (batched)';
    if (!window.confirm(`Reconstruct portfolio history from trades for ${label}?`)) return;
    setReconstructingHistory(true);
    setReconstructionResult(null);

    let totals = { usersProcessed: 0, usersSkipped: 0, totalPointsWritten: 0, errors: 0 };
    let cursor = null;
    let batchNum = 0;

    try {
      do {
        batchNum++;
        const payload = { uid: target || undefined, startAfterUid: cursor || undefined };
        const result = await reconstructPortfolioHistoryFunction(payload);
        const d = result.data;
        totals.usersProcessed += d.usersProcessed || 0;
        totals.usersSkipped += d.usersSkipped || 0;
        totals.totalPointsWritten += d.totalPointsWritten || 0;
        totals.errors += d.errors || 0;
        setReconstructionResult({ ...totals, batch: batchNum, running: !d.done });
        cursor = d.nextCursor || null;
        if (d.done || target) break;
      } while (cursor);
      setReconstructionResult({ ...totals, batch: batchNum, running: false });
    } catch (error) {
      setMessage({ type: 'error', text: `Reconstruction failed: ${error.message}` });
      setReconstructionResult({ ...totals, running: false });
    } finally {
      setReconstructingHistory(false);
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

      // Confirm the transfer
      if (!confirm(`⚠️ TRANSFER USER DATA ⚠️\n\nCopy ALL data from old user to new user?\n\nOLD USER: ${oldData.displayName || 'Unknown'}\nPortfolio: $${(oldData.portfolioValue || 0).toLocaleString()}\nCheck-ins: ${oldData.totalCheckins || 0}\n\nNEW USER: ${newData.displayName || 'Unknown'}\nPortfolio: $${(newData.portfolioValue || 0).toLocaleString()}\nCheck-ins: ${newData.totalCheckins || 0}\n\nThe NEW user's data will be COMPLETELY OVERWRITTEN with the OLD user's data.\n\nContinue?`)) {
        setTransferring(false);
        return;
      }

      // Copy ALL data from old to new (except the user ID itself)
      const dataToTransfer = { ...oldData };

      // Update the new user with all old user's data
      await updateDoc(newUserRef, dataToTransfer);

      showMessage('success', `Successfully transferred data from ${oldData.displayName} to new account!`);

      // Ask if they want to delete the old account
      if (confirm(`Transfer complete!\n\nDo you want to DELETE the old user account?\n\nOld User: ${oldData.displayName}\nID: ${oldUserId}\n\nThis cannot be undone!`)) {
        await deleteDoc(oldUserRef);
        showMessage('success', `Old user account deleted.`);
      }

      setOldUserId('');
      setNewUserId('');
    } catch (err) {
      console.error(err);
      showMessage('error', `Transfer failed: ${err.message}`);
    }
    setTransferring(false);
  };

  return {
    loadingBackups, backups, handleListBackups, restoringBackup, handleRestoreBackup,
    handleManualBackup, reconstructingHistory, reconstructionResult,
    reconstructUid, setReconstructUid, handleReconstructPortfolioHistory,
    oldUserId, setOldUserId, newUserId, setNewUserId, transferring, handleTransferUserData,
  };
}
