import RecoveryRenameTicker from './recovery/RecoveryRenameTicker';
import RecoverySplitStock from './recovery/RecoverySplitStock';
import RecoveryPriceHistory from './recovery/RecoveryPriceHistory';

import type { AdminCommonProps } from './types';
import type { ShowMessage } from '../utils/adminShared';
import type { useAdminBankruptcy } from '../hooks/useAdminBankruptcy';
import type { useAdminBackups } from '../hooks/useAdminBackups';
import type { useAdminRecoveryTools } from '../hooks/useAdminRecoveryTools';
import type { renameTickerFunction as RenameTickerFn } from '../../../api/callables';
import type { Character } from '../../../characters';
import type { PriceMap } from '../../../types';
import { useTheme } from '../../../context/AppContext';
import AdminIcon from './AdminIcon';

type RecoveryTabProps = AdminCommonProps &
  ReturnType<typeof useAdminBankruptcy> &
  ReturnType<typeof useAdminBackups> &
  ReturnType<typeof useAdminRecoveryTools> & {
    showMessage: ShowMessage;
    renameTickerFunction: typeof RenameTickerFn;
    tradeFilterTicker: string;
    setTradeFilterTicker: (ticker: string) => void;
    sortedCharacters: Character[];
    prices: PriceMap;
  };

const RecoveryTab = ({
  textClass,
  mutedClass,
  inputClass,
  loading,
  bankruptLoaded,
  bankruptUsers,
  loadBankruptUsers,
  handleReinstateUser,
  handleManualBackup,
  loadingBackups,
  backups,
  handleListBackups,
  restoringBackup,
  handleRestoreBackup,
  oldUserId,
  setOldUserId,
  newUserId,
  setNewUserId,
  transferring,
  handleTransferUserData,
  renameOldTicker,
  setRenameOldTicker,
  renameNewTicker,
  setRenameNewTicker,
  renameResult,
  setRenameResult,
  showMessage,
  renameTickerFunction,
  tradeFilterTicker,
  setTradeFilterTicker,
  sortedCharacters,
  prices,
  selectedTickerHistory,
  setSelectedTickerHistory,
  getPriceHistoryForTicker,
}: RecoveryTabProps) => {
  const { darkMode } = useTheme();
  return (
    <div className="space-y-4">
      {/* Bankrupt Users */}
      <div className="p-4 rounded-sm light:bg-white dark:bg-slate-800 border light:border-slate-200 dark:border-slate-700">
        <div className="flex justify-between items-center mb-2">
          <h3 className={`font-semibold ${textClass}`}>
            <AdminIcon name="bankrupt" />
            Bankrupt Users
          </h3>
          <button
            onClick={loadBankruptUsers}
            disabled={loading}
            className="px-3 py-1 text-xs bg-teal-600 hover:bg-teal-700 text-white rounded-sm disabled:opacity-50"
          >
            {bankruptLoaded ? 'Refresh' : 'Load'}
          </button>
        </div>
        {bankruptLoaded &&
          (bankruptUsers.length === 0 ? (
            <p className={`text-sm ${mutedClass}`}>No bankrupt users found.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {bankruptUsers.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center justify-between p-2 rounded-sm light:bg-slate-50 dark:bg-slate-700/50"
                >
                  <div>
                    <span className={`font-semibold text-sm ${textClass}`}>{u.displayName}</span>
                    <div className={`text-xs ${mutedClass}`}>
                      Cash: $
                      {(u.cash || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      {' · '}Portfolio: $
                      {(u.portfolioValue || 0).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                      {' · '}
                      {u.totalTrades} trades
                      {u.crew && <> · Crew: {u.crew}</>}
                      {u.bankruptAt && <> · Bankrupt: {new Date(u.bankruptAt).toLocaleDateString()}</>}
                    </div>
                  </div>
                  <button
                    onClick={() => handleReinstateUser(u.id, u.displayName)}
                    disabled={loading}
                    className="px-3 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded-sm disabled:opacity-50"
                  >
                    Reinstate
                  </button>
                </div>
              ))}
            </div>
          ))}
      </div>

      {/* Manual Backup */}
      <div className="p-4 rounded-sm light:bg-white dark:bg-slate-800 border light:border-slate-200 dark:border-slate-700">
        <h3 className={`font-semibold mb-2 ${textClass}`}>
          <AdminIcon name="save" />
          Manual Backup
        </h3>
        <p className={`text-sm ${mutedClass} mb-3`}>
          Create an instant backup of all market data (prices, price history, liquidity). Backups are stored in Firebase
          Storage.
        </p>
        <button
          onClick={handleManualBackup}
          disabled={loading}
          className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-sm disabled:opacity-50"
        >
          {loading ? (
            'Creating Backup...'
          ) : (
            <>
              <AdminIcon name="save" />
              Create Manual Backup
            </>
          )}
        </button>
      </div>

      {/* Restore from Backup */}
      <div className="p-4 rounded-sm light:bg-white dark:bg-slate-800 border light:border-slate-200 dark:border-slate-700">
        <h3 className="font-semibold mb-2 text-orange-500">
          <AdminIcon name="reroll" />
          Restore Price History
        </h3>
        <p className={`text-sm ${mutedClass} mb-3`}>
          Restore price history from a backup. Current prices will be kept, only historical data is restored.
        </p>

        <button
          onClick={handleListBackups}
          disabled={loadingBackups}
          className="w-full px-4 py-2 mb-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-sm disabled:opacity-50"
        >
          {loadingBackups ? (
            'Loading...'
          ) : (
            <>
              <AdminIcon name="missions" />
              List Available Backups
            </>
          )}
        </button>

        {backups.length > 0 && (
          <div className="max-h-64 overflow-y-auto space-y-2 p-3 rounded-sm light:bg-slate-50 dark:bg-slate-900">
            {backups.map((backup, i) => (
              <div
                key={i}
                className="p-3 rounded-sm border light:bg-white light:border-slate-200 dark:bg-slate-800 dark:border-slate-700"
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="flex-1">
                    <p className={`text-xs font-mono ${textClass}`}>{backup.name.split('/').pop()}</p>
                    <p className={`text-xs ${mutedClass}`}>{new Date(backup.created).toLocaleString()}</p>
                    <p className={`text-xs ${mutedClass}`}>{(backup.size / 1024).toFixed(1)} KB</p>
                  </div>
                  <button
                    onClick={() => handleRestoreBackup(backup.name)}
                    disabled={restoringBackup}
                    className="px-3 py-1 text-xs bg-orange-600 hover:bg-orange-700 text-white rounded-sm disabled:opacity-50"
                  >
                    {restoringBackup ? '...' : 'Restore'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* User Data Transfer */}
      <div className="p-4 rounded-sm light:bg-white dark:bg-slate-800 border light:border-slate-200 dark:border-slate-700">
        <h3 className={`font-semibold mb-2 ${textClass}`}>
          <AdminIcon name="profile" />
          Transfer User Data
        </h3>
        <p className={`text-sm ${mutedClass} mb-3`}>
          Copy all data from one user account to another. Useful when a user lost access to their email. The new user's
          data will be COMPLETELY OVERWRITTEN.
        </p>

        <div className="space-y-3">
          <div>
            <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Old User ID</label>
            <input
              aria-label="Old user ID"
              type="text"
              placeholder="User ID with old email/data"
              value={oldUserId}
              onChange={(e) => setOldUserId(e.target.value)}
              className="w-full px-3 py-2 border rounded-sm text-sm light:bg-white light:border-slate-200 light:text-slate-900 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100"
              disabled={transferring}
            />
          </div>

          <div>
            <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>New User ID</label>
            <input
              aria-label="New user ID"
              type="text"
              placeholder="User ID of new account"
              value={newUserId}
              onChange={(e) => setNewUserId(e.target.value)}
              className="w-full px-3 py-2 border rounded-sm text-sm light:bg-white light:border-slate-200 light:text-slate-900 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100"
              disabled={transferring}
            />
          </div>

          <div className="p-3 rounded-sm light:bg-slate-100 dark:bg-slate-700/50">
            <p className={`text-xs ${mutedClass}`}>
              <strong>How to find User IDs:</strong>
              <br />
              1. Ask user for their display name (username)
              <br />
              2. Search for them in Players
              <br />
              3. Click on them to view details
              <br />
              4. Copy the User ID from the top of their profile
              <br />
              <br />
              <strong className="text-orange-500">
                <AdminIcon name="warning" />
                Warning:
              </strong>{' '}
              This will copy ALL data (cash, holdings, achievements, transactions, etc.) from the old account to the new
              account. Any data on the new account will be lost.
            </p>
          </div>

          <button
            onClick={handleTransferUserData}
            disabled={transferring || !oldUserId.trim() || !newUserId.trim()}
            className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-sm disabled:opacity-50"
          >
            {transferring ? (
              'Transferring...'
            ) : (
              <>
                <AdminIcon name="reroll" />
                Transfer User Data
              </>
            )}
          </button>
        </div>
      </div>

      <RecoveryRenameTicker
        {...{
          darkMode,
          textClass,
          mutedClass,
          renameOldTicker,
          setRenameOldTicker,
          renameNewTicker,
          setRenameNewTicker,
          renameResult,
          setRenameResult,
          showMessage,
          renameTickerFunction,
        }}
      />
      <RecoverySplitStock {...{ darkMode, textClass, mutedClass, showMessage }} />

      <RecoveryPriceHistory
        {...{
          darkMode,
          textClass,
          mutedClass,
          inputClass,
          loading,
          tradeFilterTicker,
          setTradeFilterTicker,
          sortedCharacters,
          prices,
          selectedTickerHistory,
          setSelectedTickerHistory,
          getPriceHistoryForTicker,
        }}
      />
    </div>
  );
};

export default RecoveryTab;
