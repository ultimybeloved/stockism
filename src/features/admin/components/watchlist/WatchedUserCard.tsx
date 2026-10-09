import type { AdminCommonProps } from '../types';
import type { WatchedUser } from '../../../../api/types';
import type { useAdminWatchlist } from '../../hooks/useAdminWatchlist';

type WatchedUserCardProps = AdminCommonProps &
  Pick<
    ReturnType<typeof useAdminWatchlist>,
    | 'handleRemoveWatchedUser'
    | 'watchLinkTarget'
    | 'setWatchLinkTarget'
    | 'watchLinkAltId'
    | 'setWatchLinkAltId'
    | 'handleLinkAlt'
    | 'watchAddIPTarget'
    | 'setWatchAddIPTarget'
    | 'watchAddIPValue'
    | 'setWatchAddIPValue'
    | 'handleAddWatchedIP'
  > & { wu: WatchedUser };

/** One watched player: their linked alts and known addresses, with forms to add either. */
const WatchedUserCard = ({
  darkMode,
  textClass,
  mutedClass,
  inputClass,
  loading,
  wu,
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
}: WatchedUserCardProps) => (
  <div className={`p-3 rounded-sm border ${darkMode ? 'bg-slate-800 border-slate-600' : 'bg-white border-slate-200'}`}>
    <div className="flex justify-between items-start mb-2">
      <div>
        <span className={`text-sm font-bold ${textClass}`}>{wu.displayName}</span>
        <span className={`text-xs ml-2 ${mutedClass}`}>({wu.id})</span>
      </div>
      <button
        onClick={() => handleRemoveWatchedUser(wu.id)}
        className="text-xs text-red-500 hover:text-red-700 font-semibold"
      >
        Remove
      </button>
    </div>

    {wu.reason && <div className={`text-xs mb-2 ${mutedClass}`}>Reason: {wu.reason}</div>}

    <div className={`text-xs mb-2 ${mutedClass}`}>
      Max accounts/IP: <span className="font-bold text-red-400">{wu.maxAccountsPerIP}</span>
    </div>

    {/* Linked Accounts */}
    <div className="mb-2">
      <div className={`text-xs font-semibold mb-1 ${textClass}`}>Linked Accounts ({wu.linkedAccounts.length}):</div>
      {wu.linkedAccounts.length === 0 ? (
        <div className={`text-xs ${mutedClass}`}>None yet</div>
      ) : (
        <div className="space-y-1">
          {wu.linkedAccounts.map((alt, i) => (
            <div key={i} className={`text-xs flex gap-2 items-center ${mutedClass}`}>
              <span className="font-mono">{alt.displayName || alt.uid}</span>
              <span
                className={`px-1 rounded text-[10px] ${alt.linkedVia === 'ip' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'}`}
              >
                {alt.linkedVia}
              </span>
              {alt.ip && <span className="font-mono text-[10px]">{alt.ip}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Link Alt button */}
      {watchLinkTarget === wu.id ? (
        <div className="flex gap-1 mt-1">
          <input
            type="text"
            value={watchLinkAltId}
            onChange={(e) => setWatchLinkAltId(e.target.value)}
            placeholder="Alt Account UID"
            className={`flex-1 px-2 py-1 text-xs border rounded-sm ${inputClass}`}
          />
          <button
            onClick={() => handleLinkAlt(wu.id)}
            disabled={loading}
            className="px-2 py-1 bg-purple-600 text-white text-xs rounded-sm hover:bg-purple-700 disabled:opacity-50"
          >
            Link
          </button>
          <button
            onClick={() => {
              setWatchLinkTarget(null);
              setWatchLinkAltId('');
            }}
            className={`px-2 py-1 text-xs ${mutedClass}`}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setWatchLinkTarget(wu.id)}
          className="mt-1 text-xs text-purple-400 hover:text-purple-300"
        >
          + Link Alt Account
        </button>
      )}
    </div>

    {/* Known IPs */}
    <div>
      <div className={`text-xs font-semibold mb-1 ${textClass}`}>Known IPs ({Object.keys(wu.knownIPs).length}):</div>
      {Object.keys(wu.knownIPs).length === 0 ? (
        <div className={`text-xs ${mutedClass}`}>None tracked</div>
      ) : (
        <div className="space-y-0.5">
          {Object.entries(wu.knownIPs).map(([ipId, ipData]) => (
            <div key={ipId} className={`text-xs font-mono ${mutedClass}`}>
              {ipId.replace(/_/g, '.')}
              {ipData.accounts && ipData.accounts.length > 1 && (
                <span className="ml-1 text-red-400">({ipData.accounts.length} accounts)</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add IP button */}
      {watchAddIPTarget === wu.id ? (
        <div className="flex gap-1 mt-1">
          <input
            type="text"
            value={watchAddIPValue}
            onChange={(e) => setWatchAddIPValue(e.target.value)}
            placeholder="IP address (e.g. 1.2.3.4)"
            className={`flex-1 px-2 py-1 text-xs border rounded-sm ${inputClass}`}
          />
          <button
            onClick={() => handleAddWatchedIP(wu.id)}
            disabled={loading}
            className="px-2 py-1 bg-orange-600 text-white text-xs rounded-sm hover:bg-orange-700 disabled:opacity-50"
          >
            Add
          </button>
          <button
            onClick={() => {
              setWatchAddIPTarget(null);
              setWatchAddIPValue('');
            }}
            className={`px-2 py-1 text-xs ${mutedClass}`}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setWatchAddIPTarget(wu.id)}
          className="mt-1 text-xs text-orange-400 hover:text-orange-300"
        >
          + Add IP
        </button>
      )}
    </div>
  </div>
);

export default WatchedUserCard;
