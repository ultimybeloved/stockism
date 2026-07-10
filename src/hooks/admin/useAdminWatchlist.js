import { useState } from 'react';
import {
  getWatchlistFunction, getRecentSignupReportFunction, banUserFunction,
  addWatchedUserFunction, removeWatchedUserFunction, linkAltAccountFunction,
  addWatchedIPFunction, auditUsernamesFunction, getIpTrackingHealthFunction,
} from '../../firebase';

// Watchlist tab: IP/alt-account watchlist, signup reports, username audits.
export function useAdminWatchlist({ showMessage, setLoading }) {

  // Watchlist state
  const [watchedUsers, setWatchedUsers] = useState([]);
  const [watchlistAlerts, setWatchlistAlerts] = useState([]);
  const [watchlistLoaded, setWatchlistLoaded] = useState(false);
  const [signupReport, setSignupReport] = useState(null);
  const [signupHours, setSignupHours] = useState(48);
  const [watchAddUserId, setWatchAddUserId] = useState('');
  const [watchAddReason, setWatchAddReason] = useState('');
  const [watchAddMaxAccounts, setWatchAddMaxAccounts] = useState(1);
  const [watchLinkAltId, setWatchLinkAltId] = useState('');
  const [watchLinkTarget, setWatchLinkTarget] = useState(null);
  const [watchAddIPValue, setWatchAddIPValue] = useState('');
  const [watchAddIPTarget, setWatchAddIPTarget] = useState(null);
  const [ipHealth, setIpHealth] = useState(null);

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
      showMessage('error', 'Failed to load watchlist: ' + (err.message || 'Unknown error'));
    }
    setLoading(false);
  };

  const loadIpHealth = async () => {
    setLoading(true);
    try {
      const result = await getIpTrackingHealthFunction();
      setIpHealth(result.data);
    } catch (err) {
      showMessage('error', 'Failed to load defense health: ' + (err.message || 'Unknown error'));
    }
    setLoading(false);
  };

  const loadRecentSignups = async () => {
    setLoading(true);
    try {
      const result = await getRecentSignupReportFunction({ hoursBack: signupHours });
      setSignupReport(result.data);
    } catch (err) {
      showMessage('error', 'Failed to pull signup report: ' + (err.message || 'Unknown error'));
    }
    setLoading(false);
  };

  const handleBanFromReport = async (userId, displayName) => {
    if (!confirm(`Ban "${displayName}"? Their cash resets to $1,000 and they can no longer trade.`)) return;
    setLoading(true);
    try {
      await banUserFunction({ userId, reason: 'Alt-ring signup (recent signup report)' });
      showMessage('success', `Banned ${displayName}.`);
      await loadRecentSignups();
    } catch (err) {
      showMessage('error', 'Ban failed: ' + (err.message || 'Unknown error'));
      setLoading(false);
    }
  };

  const handleWatchFromReport = async (userId, displayName) => {
    if (!confirm(`Add "${displayName}" to the watchlist as the ring's reference account?`)) return;
    setLoading(true);
    try {
      await addWatchedUserFunction({ userId, reason: 'Alt-ring (recent signup report)', maxAccountsPerIP: 1 });
      showMessage('success', `Added ${displayName} to watchlist.`);
      await loadWatchlist();
    } catch (err) {
      showMessage('error', 'Add to watchlist failed: ' + (err.message || 'Unknown error'));
    }
    setLoading(false);
  };

  const handleAuditUsernames = async () => {
    if (!confirm('Reserve a unique name for every account and flag any duplicates? Safe to run anytime.')) return;
    setLoading(true);
    try {
      const result = await auditUsernamesFunction({});
      const r = result.data;
      showMessage('success', `${r.reservationsWritten} reserved, ${r.usersUpdated} fixed, ${r.conflicts.length} duplicate(s) flagged.`);
      await loadWatchlist();
    } catch (err) {
      showMessage('error', 'Username audit failed: ' + (err.message || 'Unknown error'));
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
        maxAccountsPerIP: watchAddMaxAccounts
      });
      showMessage('success', `Added "${result.data.displayName}" to watchlist. Found ${result.data.knownIPCount} known IPs.`);
      setWatchAddUserId('');
      setWatchAddReason('');
      setWatchAddMaxAccounts(1);
      await loadWatchlist();
    } catch (err) {
      showMessage('error', 'Failed: ' + (err.message || 'Unknown error'));
    }
    setLoading(false);
  };

  const handleRemoveWatchedUser = async (userId) => {
    if (!confirm('Remove this user from the watchlist?')) return;
    setLoading(true);
    try {
      await removeWatchedUserFunction({ userId });
      showMessage('success', 'Removed from watchlist.');
      await loadWatchlist();
    } catch (err) {
      showMessage('error', 'Failed: ' + (err.message || 'Unknown error'));
    }
    setLoading(false);
  };

  const handleLinkAlt = async (watchedUserId) => {
    if (!watchLinkAltId.trim()) return showMessage('error', 'Enter an alt account ID.');
    setLoading(true);
    try {
      const result = await linkAltAccountFunction({
        watchedUserId,
        altAccountId: watchLinkAltId.trim()
      });
      showMessage('success', `Linked "${result.data.altName}" as alt.`);
      setWatchLinkAltId('');
      setWatchLinkTarget(null);
      await loadWatchlist();
    } catch (err) {
      showMessage('error', 'Failed: ' + (err.message || 'Unknown error'));
    }
    setLoading(false);
  };

  const handleAddWatchedIP = async (userId) => {
    if (!watchAddIPValue.trim()) return showMessage('error', 'Enter an IP address.');
    setLoading(true);
    try {
      await addWatchedIPFunction({ userId, ip: watchAddIPValue.trim() });
      showMessage('success', 'IP added to watchlist.');
      setWatchAddIPValue('');
      setWatchAddIPTarget(null);
      await loadWatchlist();
    } catch (err) {
      showMessage('error', 'Failed: ' + (err.message || 'Unknown error'));
    }
    setLoading(false);
  };

  return {
    watchAddUserId, setWatchAddUserId, watchAddReason, setWatchAddReason,
    watchAddMaxAccounts, setWatchAddMaxAccounts, handleAddWatchedUser,
    handleAuditUsernames, signupReport, signupHours, setSignupHours,
    loadRecentSignups, handleBanFromReport, handleWatchFromReport,
    watchedUsers, watchlistLoaded, handleRemoveWatchedUser,
    watchLinkTarget, setWatchLinkTarget, watchLinkAltId, setWatchLinkAltId,
    handleLinkAlt, watchAddIPTarget, setWatchAddIPTarget,
    watchAddIPValue, setWatchAddIPValue, handleAddWatchedIP,
    watchlistAlerts, loadWatchlist,
    ipHealth, loadIpHealth,
  };
}
