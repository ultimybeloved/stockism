import { useState } from 'react';
import {
  getWatchlistFunction,
  addWatchedUserFunction,
  removeWatchedUserFunction,
  linkAltAccountFunction,
  addWatchedIPFunction,
  auditUsernamesFunction,
  getIpTrackingHealthFunction,
} from '../../../api/callables';
import type { AdminHookDeps } from '../utils/adminShared';
import { errorMessage } from '../../../utils/errors';
import type { IpHealthReport, WatchedUser, WatchlistAlert } from '../../../api/types';
import { useSignupReport } from './useSignupReport';

// Watchlist tab: IP/alt-account watchlist, signup reports, username audits.
export function useAdminWatchlist({ showMessage, setLoading }: Pick<AdminHookDeps, 'showMessage' | 'setLoading'>) {
  // Watchlist state
  const [watchedUsers, setWatchedUsers] = useState<WatchedUser[]>([]);
  const [watchlistAlerts, setWatchlistAlerts] = useState<WatchlistAlert[]>([]);
  const [watchlistLoaded, setWatchlistLoaded] = useState(false);
  const [watchAddUserId, setWatchAddUserId] = useState('');
  const [watchAddReason, setWatchAddReason] = useState('');
  const [watchAddMaxAccounts, setWatchAddMaxAccounts] = useState(1);
  const [watchLinkAltId, setWatchLinkAltId] = useState('');
  const [watchLinkTarget, setWatchLinkTarget] = useState<string | null>(null);
  const [watchAddIPValue, setWatchAddIPValue] = useState('');
  const [watchAddIPTarget, setWatchAddIPTarget] = useState<string | null>(null);
  const [ipHealth, setIpHealth] = useState<IpHealthReport | null>(null);

  // ============================================
  // WATCHLIST HANDLERS
  // ============================================

  const loadWatchlist = async () => {
    setLoading(true);
    try {
      const result = await getWatchlistFunction();
      setWatchedUsers(result.data.watchedUsers || []);
      setWatchlistAlerts(result.data.alerts || []);
      setWatchlistLoaded(true);
    } catch (err) {
      showMessage('error', 'Failed to load watchlist: ' + (errorMessage(err) || 'Unknown error'));
    }
    setLoading(false);
  };

  const signups = useSignupReport({ showMessage, setLoading, onWatched: loadWatchlist });

  const loadIpHealth = async () => {
    setLoading(true);
    try {
      const result = await getIpTrackingHealthFunction();
      setIpHealth(result.data);
    } catch (err) {
      showMessage('error', 'Failed to load defense health: ' + (errorMessage(err) || 'Unknown error'));
    }
    setLoading(false);
  };

  const handleAuditUsernames = async () => {
    if (!confirm('Reserve a unique name for every account and flag any duplicates? Safe to run anytime.')) return;
    setLoading(true);
    try {
      const result = await auditUsernamesFunction({});
      const r = result.data;
      showMessage(
        'success',
        `${r.reservationsWritten} reserved, ${r.usersUpdated} fixed, ${r.conflicts.length} duplicate(s) flagged.`,
      );
      await loadWatchlist();
    } catch (err) {
      showMessage('error', 'Username audit failed: ' + (errorMessage(err) || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  const handleAddWatchedUser = async () => {
    if (!watchAddUserId.trim()) return showMessage('error', 'Enter a user ID.');
    setLoading(true);
    try {
      const result = await addWatchedUserFunction({
        userId: watchAddUserId.trim(),
        reason: watchAddReason.trim(),
        maxAccountsPerIP: watchAddMaxAccounts,
      });
      showMessage(
        'success',
        `Added "${result.data.displayName}" to watchlist. Found ${result.data.knownIPCount} known IPs.`,
      );
      setWatchAddUserId('');
      setWatchAddReason('');
      setWatchAddMaxAccounts(1);
      await loadWatchlist();
    } catch (err) {
      showMessage('error', 'Failed: ' + (errorMessage(err) || 'Unknown error'));
    }
    setLoading(false);
  };

  const handleRemoveWatchedUser = async (userId: string) => {
    if (!confirm('Remove this user from the watchlist?')) return;
    setLoading(true);
    try {
      await removeWatchedUserFunction({ userId });
      showMessage('success', 'Removed from watchlist.');
      await loadWatchlist();
    } catch (err) {
      showMessage('error', 'Failed: ' + (errorMessage(err) || 'Unknown error'));
    }
    setLoading(false);
  };

  const handleLinkAlt = async (watchedUserId: string) => {
    if (!watchLinkAltId.trim()) return showMessage('error', 'Enter an alt account ID.');
    setLoading(true);
    try {
      const result = await linkAltAccountFunction({
        watchedUserId,
        altAccountId: watchLinkAltId.trim(),
      });
      showMessage('success', `Linked "${result.data.altName}" as alt.`);
      setWatchLinkAltId('');
      setWatchLinkTarget(null);
      await loadWatchlist();
    } catch (err) {
      showMessage('error', 'Failed: ' + (errorMessage(err) || 'Unknown error'));
    }
    setLoading(false);
  };

  const handleAddWatchedIP = async (userId: string) => {
    if (!watchAddIPValue.trim()) return showMessage('error', 'Enter an IP address.');
    setLoading(true);
    try {
      await addWatchedIPFunction({ userId, ip: watchAddIPValue.trim() });
      showMessage('success', 'IP added to watchlist.');
      setWatchAddIPValue('');
      setWatchAddIPTarget(null);
      await loadWatchlist();
    } catch (err) {
      showMessage('error', 'Failed: ' + (errorMessage(err) || 'Unknown error'));
    }
    setLoading(false);
  };

  return {
    watchAddUserId,
    setWatchAddUserId,
    watchAddReason,
    setWatchAddReason,
    watchAddMaxAccounts,
    setWatchAddMaxAccounts,
    handleAddWatchedUser,
    handleAuditUsernames,
    ...signups,
    watchedUsers,
    watchlistLoaded,
    handleRemoveWatchedUser,
    watchLinkTarget,
    setWatchLinkTarget,
    watchLinkAltId,
    setWatchLinkAltId,
    handleLinkAlt,
    watchAddIPTarget,
    setWatchAddIPTarget,
    watchAddIPValue,
    setWatchAddIPValue,
    handleAddWatchedIP,
    watchlistAlerts,
    loadWatchlist,
    ipHealth,
    loadIpHealth,
  };
}
