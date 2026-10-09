import { useState } from 'react';
import { getRecentSignupReportFunction, banUserFunction, addWatchedUserFunction } from '../../../api/callables';
import { errorMessage } from '../../../utils/errors';
import type { SignupReport } from '../../../api/types';
import type { AdminHookDeps } from '../utils/adminShared';

/** The recent-signups report on the watchlist tab, and the ban/watch actions on its rows. */
export function useSignupReport({
  showMessage,
  setLoading,
  onWatched,
}: Pick<AdminHookDeps, 'showMessage' | 'setLoading'> & { onWatched: () => Promise<void> }) {
  const [signupReport, setSignupReport] = useState<SignupReport | null>(null);
  const [signupHours, setSignupHours] = useState(48);

  const loadRecentSignups = async () => {
    setLoading(true);
    try {
      const result = await getRecentSignupReportFunction({ hoursBack: signupHours });
      setSignupReport(result.data);
    } catch (err) {
      showMessage('error', 'Failed to pull signup report: ' + (errorMessage(err) || 'Unknown error'));
    }
    setLoading(false);
  };

  const handleBanFromReport = async (userId: string, displayName: string | undefined) => {
    if (!confirm(`Ban "${displayName}"? Their cash resets to $1,000 and they can no longer trade.`)) return;
    setLoading(true);
    try {
      await banUserFunction({ userId, reason: 'Alt-ring signup (recent signup report)' });
      showMessage('success', `Banned ${displayName}.`);
      await loadRecentSignups();
    } catch (err) {
      showMessage('error', 'Ban failed: ' + (errorMessage(err) || 'Unknown error'));
      setLoading(false);
    }
  };

  const handleWatchFromReport = async (userId: string, displayName: string | undefined) => {
    if (!confirm(`Add "${displayName}" to the watchlist as the ring's reference account?`)) return;
    setLoading(true);
    try {
      await addWatchedUserFunction({ userId, reason: 'Alt-ring (recent signup report)', maxAccountsPerIP: 1 });
      showMessage('success', `Added ${displayName} to watchlist.`);
      await onWatched();
    } catch (err) {
      showMessage('error', 'Add to watchlist failed: ' + (errorMessage(err) || 'Unknown error'));
    }
    setLoading(false);
  };
  return { signupReport, signupHours, setSignupHours, loadRecentSignups, handleBanFromReport, handleWatchFromReport };
}
