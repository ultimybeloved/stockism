import AnnounceCard from './AnnounceCard';
import RecoverySpikeRepair from './recovery/RecoverySpikeRepair';
import RecoveryDiagnose from './recovery/RecoveryDiagnose';
import RecoveryRenameTicker from './recovery/RecoveryRenameTicker';
import RecoveryTradeRollback from './recovery/RecoveryTradeRollback';

const RecoveryTab = ({
  darkMode,
  textClass,
  mutedClass,
  inputClass,
  loading,
  // Bankrupt users
  bankruptLoaded,
  bankruptUsers,
  loadBankruptUsers,
  handleReinstateUser,
  // Spike victims
  scanningSpike,
  repairingSpike,
  spikeScanned,
  spikeVictims,
  handleScanSpikeVictims,
  handleRepairAllSpikeVictims,
  handleRepairSpikeVictim,
  // Diagnose users
  diagnosisIds,
  setDiagnosisIds,
  diagnosing,
  diagnosisResults,
  handleDiagnoseUsers,
  // Manual backup
  handleManualBackup,
  // NaN repair
  handleRepairCorruptedAccounts,
  // Restore from backup
  loadingBackups,
  backups,
  handleListBackups,
  restoringBackup,
  handleRestoreBackup,
  // User data transfer
  oldUserId,
  setOldUserId,
  newUserId,
  setNewUserId,
  transferring,
  handleTransferUserData,
  // Rename ticker
  renameOldTicker,
  setRenameOldTicker,
  renameNewTicker,
  setRenameNewTicker,
  renameResult,
  setRenameResult,
  showMessage,
  renameTickerFunction,
  // Portfolio history reconstruction from trades
  reconstructingHistory,
  reconstructionResult,
  reconstructUid,
  setReconstructUid,
  handleReconstructPortfolioHistory,
  // Trade history & rollback
  tradeFilterTicker,
  setTradeFilterTicker,
  sortedCharacters,
  prices,
  selectedTickerHistory,
  setSelectedTickerHistory,
  getPriceHistoryForTicker,
  rollbackTimestamp,
  setRollbackTimestamp,
  rollbackConfirm,
  setRollbackConfirm,
  executeFullRollback,
}) => {
  return (
    <div className="space-y-4">
      {/* Broadcast announcement to all users */}
      <AnnounceCard darkMode={darkMode} />

      {/* Bankrupt Users */}
      <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
        <div className="flex justify-between items-center mb-2">
          <h3 className={`font-semibold ${textClass}`}>💔 Bankrupt Users</h3>
          <button
            onClick={loadBankruptUsers}
            disabled={loading}
            className="px-3 py-1 text-xs bg-teal-600 hover:bg-teal-700 text-white rounded-sm disabled:opacity-50"
          >
            {bankruptLoaded ? 'Refresh' : 'Load'}
          </button>
        </div>
        {bankruptLoaded && (
          bankruptUsers.length === 0 ? (
            <p className={`text-sm ${mutedClass}`}>No bankrupt users found.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {bankruptUsers.map(u => (
                <div key={u.id} className={`flex items-center justify-between p-2 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-slate-50'}`}>
                  <div>
                    <span className={`font-semibold text-sm ${textClass}`}>{u.displayName}</span>
                    <div className={`text-xs ${mutedClass}`}>
                      Cash: ${(u.cash || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                      {' · '}Portfolio: ${(u.portfolioValue || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                      {' · '}{u.totalTrades} trades
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
          )
        )}
      </div>

      <RecoverySpikeRepair {...{ darkMode, textClass, mutedClass, scanningSpike, repairingSpike, spikeScanned, spikeVictims, handleScanSpikeVictims, handleRepairAllSpikeVictims, handleRepairSpikeVictim }} />
      <RecoveryDiagnose {...{ darkMode, textClass, mutedClass, diagnosisIds, setDiagnosisIds, diagnosing, diagnosisResults, handleDiagnoseUsers }} />
      {/* Manual Backup */}
      <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
        <h3 className={`font-semibold mb-2 ${textClass}`}>💾 Manual Backup</h3>
        <p className={`text-sm ${mutedClass} mb-3`}>
          Create an instant backup of all market data (prices, price history, liquidity). Backups are stored in Firebase Storage.
        </p>
        <button
          onClick={handleManualBackup}
          disabled={loading}
          className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-sm disabled:opacity-50"
        >
          {loading ? 'Creating Backup...' : '💾 Create Manual Backup'}
        </button>
      </div>

      {/* Portfolio History Reconstruction */}
      <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-blue-700' : 'border-blue-300'}`}>
        <h3 className={`font-semibold mb-2 text-blue-500`}>🔁 Reconstruct Portfolio History</h3>
        <p className={`text-sm ${mutedClass} mb-3`}>
          Rebuilds historical portfolio values from the permanent trades collection and price archives. Leave the UID field blank to run for all non-bot users. Runs up to 9 minutes.
        </p>
        <input
          type="text"
          value={reconstructUid}
          onChange={e => setReconstructUid(e.target.value)}
          placeholder="User UID (leave blank for all users)"
          className={`w-full px-3 py-2 mb-3 rounded-sm border text-sm font-mono ${darkMode ? 'bg-slate-700 border-slate-600 text-slate-100 placeholder-slate-500' : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400'} focus:outline-none focus:border-blue-500`}
        />
        {reconstructionResult && (
          <p className={`text-sm mb-3 font-semibold ${reconstructionResult.errors > 0 ? 'text-red-500' : reconstructionResult.running ? 'text-yellow-500' : 'text-green-500'}`}>
            {reconstructionResult.running ? `Batch ${reconstructionResult.batch} — ` : 'Done — '}
            users: {reconstructionResult.usersProcessed}, points: {reconstructionResult.totalPointsWritten}, skipped: {reconstructionResult.usersSkipped}, errors: {reconstructionResult.errors}
          </p>
        )}
        <button
          onClick={handleReconstructPortfolioHistory}
          disabled={reconstructingHistory}
          className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-sm disabled:opacity-50"
        >
          {reconstructingHistory ? `Reconstructing... (batch ${reconstructionResult?.batch || 1})` : '🔁 Reconstruct from Trades'}
        </button>
      </div>

      {/* NaN Account Repair */}
      <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
        <h3 className={`font-semibold mb-2 text-red-500`}>🔧 Repair Corrupted Accounts</h3>
        <p className={`text-sm ${mutedClass} mb-3`}>
          Scans all accounts for NaN/corrupted values in cash, holdings, shorts, and portfolio data. Fixes them automatically.
        </p>
        <button
          onClick={handleRepairCorruptedAccounts}
          disabled={loading}
          className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-sm disabled:opacity-50"
        >
          {loading ? 'Scanning...' : '🔧 Scan & Repair All Accounts'}
        </button>
      </div>

      {/* Restore from Backup */}
      <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
        <h3 className={`font-semibold mb-2 text-orange-500`}>🔄 Restore Price History</h3>
        <p className={`text-sm ${mutedClass} mb-3`}>
          Restore price history from a backup. Current prices will be kept, only historical data is restored.
        </p>

        <button
          onClick={handleListBackups}
          disabled={loadingBackups}
          className="w-full px-4 py-2 mb-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-sm disabled:opacity-50"
        >
          {loadingBackups ? 'Loading...' : '📋 List Available Backups'}
        </button>

        {backups.length > 0 && (
          <div className={`max-h-64 overflow-y-auto space-y-2 p-3 rounded-sm ${darkMode ? 'bg-slate-900' : 'bg-slate-50'}`}>
            {backups.map((backup, i) => (
              <div key={i} className={`p-3 rounded-sm border ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
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
      <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
        <h3 className={`font-semibold mb-2 ${textClass}`}>👤 Transfer User Data</h3>
        <p className={`text-sm ${mutedClass} mb-3`}>
          Copy all data from one user account to another. Useful when a user lost access to their email.
          The new user's data will be COMPLETELY OVERWRITTEN.
        </p>

        <div className="space-y-3">
          <div>
            <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Old User ID</label>
            <input
              type="text"
              placeholder="User ID with old email/data"
              value={oldUserId}
              onChange={(e) => setOldUserId(e.target.value)}
              className={`w-full px-3 py-2 border rounded-sm text-sm ${darkMode ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'}`}
              disabled={transferring}
            />
          </div>

          <div>
            <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>New User ID</label>
            <input
              type="text"
              placeholder="User ID of new account"
              value={newUserId}
              onChange={(e) => setNewUserId(e.target.value)}
              className={`w-full px-3 py-2 border rounded-sm text-sm ${darkMode ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'}`}
              disabled={transferring}
            />
          </div>

          <div className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-slate-100'}`}>
            <p className={`text-xs ${mutedClass}`}>
              <strong>How to find User IDs:</strong>
              <br/>1. Ask user for their display name (username)
              <br/>2. Search for them in the Users tab
              <br/>3. Click on them to view details
              <br/>4. Copy the User ID from the top of their profile
              <br/><br/>
              <strong className="text-orange-500">⚠️ Warning:</strong> This will copy ALL data (cash, holdings, achievements, transactions, etc.) from the old account to the new account. Any data on the new account will be lost.
            </p>
          </div>

          <button
            onClick={handleTransferUserData}
            disabled={transferring || !oldUserId.trim() || !newUserId.trim()}
            className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-sm disabled:opacity-50"
          >
            {transferring ? 'Transferring...' : '🔄 Transfer User Data'}
          </button>
        </div>
      </div>

      <RecoveryRenameTicker {...{ darkMode, textClass, mutedClass, renameOldTicker, setRenameOldTicker, renameNewTicker, setRenameNewTicker, renameResult, setRenameResult, showMessage, renameTickerFunction }} />

      <RecoveryTradeRollback {...{ darkMode, textClass, mutedClass, inputClass, loading, tradeFilterTicker, setTradeFilterTicker, sortedCharacters, prices, selectedTickerHistory, setSelectedTickerHistory, getPriceHistoryForTicker, rollbackTimestamp, setRollbackTimestamp, rollbackConfirm, setRollbackConfirm, executeFullRollback }} />
    </div>
  );
};

export default RecoveryTab;
