import RecentSignups from './watchlist/RecentSignups';
import AltScanCard from './watchlist/AltScanCard';
import DefenseHealthCard from './watchlist/DefenseHealthCard';
import WatchedUserCard from './watchlist/WatchedUserCard';
import WatchlistAlerts from './watchlist/WatchlistAlerts';
import type { AdminCommonProps } from './types';
import type { useAdminWatchlist } from '../hooks/useAdminWatchlist';
import type { useAltScan } from '../hooks/useAltScan';

type WatchlistTabProps = AdminCommonProps &
  ReturnType<typeof useAdminWatchlist> & {
    altScanning: ReturnType<typeof useAltScan>['scanning'];
    altScanResult: ReturnType<typeof useAltScan>['result'];
    runAltScan: ReturnType<typeof useAltScan>['runScan'];
    markAlertReviewed: ReturnType<typeof useAltScan>['markReviewed'];
  };

const WatchlistTab = ({
  darkMode,
  textClass,
  mutedClass,
  inputClass,
  loading,
  signupReport,
  signupHours,
  setSignupHours,
  loadRecentSignups,
  handleBanFromReport,
  handleWatchFromReport,
  watchAddUserId,
  setWatchAddUserId,
  watchAddReason,
  setWatchAddReason,
  watchAddMaxAccounts,
  setWatchAddMaxAccounts,
  handleAddWatchedUser,
  handleAuditUsernames,
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
  altScanning,
  altScanResult,
  runAltScan,
  markAlertReviewed,
}: WatchlistTabProps) => {
  return (
    <div className="space-y-4">
      <AltScanCard
        darkMode={darkMode}
        textClass={textClass}
        mutedClass={mutedClass}
        scanning={altScanning}
        result={altScanResult}
        runScan={runAltScan}
      />

      <DefenseHealthCard
        darkMode={darkMode}
        textClass={textClass}
        mutedClass={mutedClass}
        loading={loading}
        ipHealth={ipHealth}
        loadIpHealth={loadIpHealth}
      />

      {/* Recent Signups / Alt Ring report */}
      <RecentSignups
        darkMode={darkMode}
        textClass={textClass}
        mutedClass={mutedClass}
        inputClass={inputClass}
        loading={loading}
        signupReport={signupReport}
        signupHours={signupHours}
        setSignupHours={setSignupHours}
        loadRecentSignups={loadRecentSignups}
        onBan={handleBanFromReport}
        onWatch={handleWatchFromReport}
      />

      {/* Add to Watchlist */}
      <div className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-red-50'}`}>
        <h3 className={`text-sm font-bold mb-2 ${textClass}`}>Add User to Watchlist</h3>
        <div className="space-y-2">
          <input
            type="text"
            value={watchAddUserId}
            onChange={(e) => setWatchAddUserId(e.target.value)}
            placeholder="User ID (from Firestore)"
            className={`w-full px-2 py-1.5 text-xs border rounded-sm ${inputClass}`}
          />
          <input
            type="text"
            value={watchAddReason}
            onChange={(e) => setWatchAddReason(e.target.value)}
            placeholder="Reason (e.g., Doxxing, alt abuse)"
            className={`w-full px-2 py-1.5 text-xs border rounded-sm ${inputClass}`}
          />
          <div className="flex gap-2 items-center">
            <label className={`text-xs ${mutedClass}`}>Max accounts per IP:</label>
            <input
              type="number"
              min="1"
              max="10"
              value={watchAddMaxAccounts}
              onChange={(e) => setWatchAddMaxAccounts(Number(e.target.value))}
              className={`w-16 px-2 py-1.5 text-xs border rounded-sm ${inputClass}`}
            />
            <button
              onClick={handleAddWatchedUser}
              disabled={loading || !watchAddUserId.trim()}
              className="ml-auto px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-sm disabled:opacity-50"
            >
              {loading ? 'Adding...' : 'Add to Watchlist'}
            </button>
          </div>
        </div>
      </div>

      {/* Username Integrity */}
      <div className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-blue-50'}`}>
        <h3 className={`text-sm font-bold mb-1 ${textClass}`}>Username Integrity</h3>
        <p className={`text-xs mb-2 ${mutedClass}`}>
          Reserves a unique name for every account and flags duplicates (same name, different capitalization). Any
          duplicates show up in the alerts below. Safe to run anytime.
        </p>
        <button
          onClick={handleAuditUsernames}
          disabled={loading}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-sm disabled:opacity-50"
        >
          {loading ? 'Working...' : 'Reserve & Audit Usernames'}
        </button>
      </div>

      {/* Watched Users List */}
      {watchedUsers.length === 0 && watchlistLoaded && (
        <div className={`p-3 text-center text-xs ${mutedClass}`}>No watched users.</div>
      )}

      {watchedUsers.map((wu) => (
        <WatchedUserCard
          key={wu.id}
          {...{ darkMode, textClass, mutedClass, inputClass, loading, wu }}
          {...{ handleRemoveWatchedUser, watchLinkTarget, setWatchLinkTarget, watchLinkAltId, setWatchLinkAltId }}
          {...{ handleLinkAlt, watchAddIPTarget, setWatchAddIPTarget, watchAddIPValue, setWatchAddIPValue }}
          handleAddWatchedIP={handleAddWatchedIP}
        />
      ))}

      <WatchlistAlerts
        darkMode={darkMode}
        textClass={textClass}
        mutedClass={mutedClass}
        alerts={watchlistAlerts}
        markAlertReviewed={markAlertReviewed}
      />

      {/* Refresh button */}
      <button
        onClick={loadWatchlist}
        disabled={loading}
        className={`w-full py-2 text-xs font-semibold rounded-sm ${darkMode ? 'bg-slate-700 hover:bg-slate-600 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'} disabled:opacity-50`}
      >
        {loading ? 'Loading...' : 'Refresh Watchlist'}
      </button>
    </div>
  );
};

export default WatchlistTab;
