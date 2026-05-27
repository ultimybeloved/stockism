import React from 'react';

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
  renaming,
  renameResult,
  setRenameResult,
  showMessage,
  renameTickerFunction,
  // Portfolio history migration
  migratingPortfolioHistory,
  portfolioMigrationResult,
  handleMigratePortfolioHistory,
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

      {/* Spike Victim Repair */}
      <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
        <div className="flex justify-between items-center mb-2">
          <h3 className={`font-semibold ${textClass}`}>⚡ Spike Victim Repair</h3>
          <div className="flex gap-2">
            <button
              onClick={handleScanSpikeVictims}
              disabled={scanningSpike || repairingSpike}
              className="px-3 py-1 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded-sm disabled:opacity-50"
            >
              {scanningSpike ? 'Scanning...' : spikeScanned ? 'Re-Scan' : 'Scan'}
            </button>
            {spikeVictims.length > 0 && (
              <button
                onClick={handleRepairAllSpikeVictims}
                disabled={repairingSpike}
                className="px-3 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded-sm disabled:opacity-50"
              >
                {repairingSpike ? 'Repairing...' : `Fix All (${spikeVictims.length})`}
              </button>
            )}
          </div>
        </div>
        <p className={`text-xs ${mutedClass} mb-3`}>
          Finds ALL bankrupt or negative-cash users (non-bot). Shows reason, suggested fix, and recent trades.
        </p>
        {spikeScanned && (
          spikeVictims.length === 0 ? (
            <p className={`text-sm ${mutedClass}`}>No damaged accounts found.</p>
          ) : (
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {spikeVictims.map(v => (
                <div key={v.userId} className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-slate-50'}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center flex-wrap gap-1">
                        <span className={`font-semibold text-sm ${textClass}`}>{v.displayName}</span>
                        {v.isBankrupt && <span className="px-1.5 py-0.5 text-xs bg-red-500/20 text-red-400 rounded">Bankrupt</span>}
                        {v.tookBailout && <span className="px-1.5 py-0.5 text-xs bg-orange-500/20 text-orange-400 rounded">Bailed Out</span>}
                      </div>
                      {v.reason && (
                        <div className={`text-xs mt-0.5 text-purple-400`}>
                          Reason: {v.reason}
                        </div>
                      )}
                      <div className={`text-xs mt-1 ${mutedClass}`}>
                        Cash: <span className="text-red-400 font-semibold">${(v.currentCash || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                        {v.correctedCash != null && (
                          <>
                            {' → '}
                            <span className="text-green-400 font-semibold">${(v.correctedCash || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                          </>
                        )}
                        {' · '}{v.totalTrades || 0} trades
                        {v.bankruptAt && <> · Bankrupt: {new Date(v.bankruptAt).toLocaleDateString()}</>}
                      </div>
                      {v.tookBailout && v.holdingsCount > 0 && (
                        <div className={`text-xs mt-0.5 ${mutedClass}`}>
                          Holdings to restore: {v.holdingsCount} stocks
                          {v.holdingsToRestore && (
                            <span className="ml-1 text-blue-400">
                              ({Object.entries(v.holdingsToRestore).map(([t, s]) => `${t}: ${s}`).join(', ')})
                            </span>
                          )}
                        </div>
                      )}
                      {v.trades && v.trades.length > 0 && (
                        <details className="mt-1">
                          <summary className={`text-xs cursor-pointer ${mutedClass}`}>Recent trades</summary>
                          <div className="mt-1 space-y-0.5">
                            {v.trades.map((t, i) => (
                              <div key={i} className={`text-xs py-0.5 px-1 rounded ${darkMode ? 'bg-slate-800' : 'bg-white'}`}>
                                <span className={t.action === 'margin_call_cover' ? 'text-red-400 font-semibold' : t.action === 'BUY' ? 'text-green-400' : 'text-orange-400'}>
                                  {t.action}
                                </span>
                                {' '}{t.ticker} × {t.shares} @ ${t.price?.toFixed(2)}
                                {t.pnl != null && <span className={t.pnl >= 0 ? ' text-green-400' : ' text-red-400'}> P&L: ${t.pnl?.toFixed(2)}</span>}
                                {t.cashBefore != null && <span className={mutedClass}> (${t.cashBefore?.toFixed(2)} → ${t.cashAfter?.toFixed(2)})</span>}
                                {t.timestamp && <span className={mutedClass}> {new Date(t.timestamp).toLocaleDateString()}</span>}
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                    {v.correctedCash != null && (
                      <button
                        onClick={() => handleRepairSpikeVictim(v)}
                        disabled={repairingSpike}
                        className="px-3 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded-sm disabled:opacity-50 ml-2 shrink-0"
                      >
                        Fix
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* Diagnose Users */}
      <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
        <h3 className={`font-semibold mb-2 ${textClass}`}>🔍 Diagnose User Accounts</h3>
        <p className={`text-xs ${mutedClass} mb-2`}>
          Paste user IDs (comma or newline separated) to see their account state and recent trades.
        </p>
        <textarea
          value={diagnosisIds}
          onChange={e => setDiagnosisIds(e.target.value)}
          placeholder="Paste user IDs here..."
          rows={3}
          className={`w-full px-3 py-2 border rounded-sm text-xs font-mono mb-2 ${darkMode ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'}`}
        />
        <button
          onClick={handleDiagnoseUsers}
          disabled={diagnosing || !diagnosisIds.trim()}
          className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-sm disabled:opacity-50 mb-3"
        >
          {diagnosing ? 'Diagnosing...' : '🔍 Diagnose'}
        </button>
        {diagnosisResults.length > 0 && (
          <div className="space-y-3">
            {diagnosisResults.map(u => (
              <div key={u.userId} className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-slate-50'}`}>
                {u.error ? (
                  <p className="text-red-400 text-sm">{u.userId}: {u.error}</p>
                ) : (
                  <>
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <span className={`font-semibold ${textClass}`}>{u.displayName}</span>
                        <span className={`text-xs ml-2 font-mono ${mutedClass}`}>{u.userId}</span>
                      </div>
                      <div className="flex gap-1">
                        {u.isBankrupt && <span className="px-1.5 py-0.5 text-xs bg-red-500/20 text-red-400 rounded">Bankrupt</span>}
                        {u.lastBailout && <span className="px-1.5 py-0.5 text-xs bg-orange-500/20 text-orange-400 rounded">Bailed Out</span>}
                      </div>
                    </div>
                    <div className={`text-xs ${mutedClass} space-y-0.5`}>
                      <p>Cash: <span className={u.cash < 0 ? 'text-red-400 font-semibold' : 'text-green-400 font-semibold'}>${u.cash?.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span> · Portfolio: ${u.portfolioValue?.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
                      {Object.keys(u.holdings || {}).length > 0 && (
                        <p>Holdings: {Object.entries(u.holdings).map(([t, s]) => `${t}: ${s}`).join(', ')}</p>
                      )}
                      {Object.keys(u.shorts || {}).length > 0 && (
                        <p>Shorts: {Object.entries(u.shorts).map(([t, s]) => `${t}: ${typeof s === 'object' ? s.shares : s}`).join(', ')}</p>
                      )}
                      {u.bankruptAt && <p>Bankrupt at: {new Date(u.bankruptAt).toLocaleString()}</p>}
                      {u.lastBailout && <p>Last bailout: {new Date(u.lastBailout).toLocaleString()}</p>}
                    </div>
                    {u.recentTrades && u.recentTrades.length > 0 && (
                      <details className="mt-2">
                        <summary className={`text-xs cursor-pointer ${mutedClass}`}>Recent trades ({u.totalTrades} total)</summary>
                        <div className="max-h-48 overflow-y-auto mt-1 space-y-0.5">
                          {u.recentTrades.map((t, i) => (
                            <div key={i} className={`text-xs py-1 px-2 rounded flex justify-between ${darkMode ? 'bg-slate-800' : 'bg-white'}`}>
                              <span>
                                <span className={t.action === 'margin_call_cover' ? 'text-red-400 font-semibold' : t.action === 'BUY' ? 'text-green-400' : 'text-orange-400'}>
                                  {t.action}
                                </span>
                                {' '}{t.ticker} × {t.amount} @ ${t.price?.toFixed(2)}
                                {t.pnl != null && <span className={t.pnl >= 0 ? 'text-green-400' : 'text-red-400'}> P&L: ${t.pnl?.toFixed(2)}</span>}
                              </span>
                              <span className={mutedClass}>
                                {t.cashBefore != null && `$${t.cashBefore?.toFixed(2)} → $${t.cashAfter?.toFixed(2)}`}
                                {' '}{t.timestamp ? new Date(t.timestamp).toLocaleString() : ''}
                              </span>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

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

      {/* Portfolio History Migration */}
      <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-orange-700' : 'border-orange-300'}`}>
        <h3 className={`font-semibold mb-2 text-orange-500`}>📦 Migrate Portfolio History</h3>
        <p className={`text-sm ${mutedClass} mb-3`}>
          One-time migration: moves all existing portfolioHistory arrays into permanent subcollections. Run once, then the button can be ignored.
        </p>
        {portfolioMigrationResult && (
          <p className={`text-sm mb-3 font-semibold ${portfolioMigrationResult.errors > 0 ? 'text-red-500' : 'text-green-500'}`}>
            Done — migrated: {portfolioMigrationResult.migrated}, skipped: {portfolioMigrationResult.skipped}, errors: {portfolioMigrationResult.errors}
          </p>
        )}
        <button
          onClick={handleMigratePortfolioHistory}
          disabled={migratingPortfolioHistory || !!portfolioMigrationResult}
          className="w-full px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-sm disabled:opacity-50"
        >
          {migratingPortfolioHistory ? 'Migrating... (may take a minute)' : portfolioMigrationResult ? 'Migration complete' : '📦 Run Portfolio History Migration'}
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

      {/* RENAME TICKER */}
      <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
        <h3 className={`font-semibold mb-2 ${textClass}`}>🔄 Rename Ticker</h3>
        <p className={`text-xs ${mutedClass} mb-3`}>
          Rename a ticker across ALL Firestore data (market prices, user holdings, trades, limit orders, IP tracking).
          Always do a Dry Run first. The market will be automatically halted during execution.
        </p>

        <div className="flex gap-2 mb-3">
          <div className="flex-1">
            <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Old Ticker</label>
            <input
              type="text"
              placeholder="e.g. JSN"
              value={renameOldTicker}
              onChange={e => setRenameOldTicker(e.target.value.toUpperCase())}
              className={`w-full px-3 py-2 border rounded-sm text-sm font-mono ${darkMode ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'}`}
              disabled={renaming}
            />
          </div>
          <div className="flex items-end pb-0.5">
            <span className={`text-lg ${mutedClass}`}>→</span>
          </div>
          <div className="flex-1">
            <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>New Ticker</label>
            <input
              type="text"
              placeholder="e.g. JASON"
              value={renameNewTicker}
              onChange={e => setRenameNewTicker(e.target.value.toUpperCase())}
              className={`w-full px-3 py-2 border rounded-sm text-sm font-mono ${darkMode ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'}`}
              disabled={renaming}
            />
          </div>
        </div>

        <div className="flex gap-2 mb-3">
          <button
            onClick={async () => {
              if (!renameOldTicker.trim() || !renameNewTicker.trim()) {
                showMessage('error', 'Enter both old and new ticker');
                return;
              }
              setRenameResult(null);
              try {
                const result = await renameTickerFunction({ oldTicker: renameOldTicker.trim(), newTicker: renameNewTicker.trim(), dryRun: true });
                setRenameResult(result.data);
              } catch (err) {
                showMessage('error', `Dry run failed: ${err.message}`);
              }
            }}
            disabled={renaming || !renameOldTicker.trim() || !renameNewTicker.trim()}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-sm disabled:opacity-50"
          >
            {renaming ? 'Running...' : '🔍 Dry Run'}
          </button>
          <button
            onClick={async () => {
              if (!renameResult || !renameResult.dryRun) {
                showMessage('error', 'Run a dry run first');
                return;
              }
              if (!window.confirm(`RENAME ${renameOldTicker} → ${renameNewTicker}?\n\nThis will modify ${renameResult.totalDocsToModify} documents.\nThe market will be halted during execution.\n\nAre you sure?`)) {
                return;
              }
              try {
                const result = await renameTickerFunction({ oldTicker: renameOldTicker.trim(), newTicker: renameNewTicker.trim(), dryRun: false });
                setRenameResult(result.data);
                showMessage('success', `Renamed ${renameOldTicker} → ${renameNewTicker} successfully! ${result.data.totalDocsModified} docs modified.`);
              } catch (err) {
                showMessage('error', `Rename failed: ${err.message}`);
              }
            }}
            disabled={renaming || !renameResult?.dryRun}
            className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-sm disabled:opacity-50"
          >
            {renaming ? 'Executing...' : '⚡ Execute Rename'}
          </button>
        </div>

        {renameResult && (
          <div className={`p-3 rounded-sm ${renameResult.dryRun ? (darkMode ? 'bg-blue-900/30 border border-blue-700' : 'bg-blue-50 border border-blue-300') : (darkMode ? 'bg-green-900/30 border border-green-700' : 'bg-green-50 border border-green-300')}`}>
            <p className={`text-sm font-semibold mb-2 ${renameResult.dryRun ? 'text-blue-400' : 'text-green-400'}`}>
              {renameResult.dryRun ? '🔍 Dry Run Preview' : '✅ Rename Complete'}
            </p>
            <p className={`text-xs ${textClass}`}>
              <strong>{renameResult.oldTicker}</strong> → <strong>{renameResult.newTicker}</strong>
            </p>
            <div className={`text-xs ${mutedClass} mt-1 space-y-0.5`}>
              <p>Market doc: 1</p>
              <p>User docs: {renameResult.breakdown?.users || 0}</p>
              <p>Trade records: {renameResult.breakdown?.trades || 0}</p>
              <p>Limit orders: {renameResult.breakdown?.limitOrders || 0}</p>
              <p>IP tracking docs: {renameResult.breakdown?.ipTracking || 0}</p>
              <p className={`font-semibold ${textClass} mt-1`}>Total: {renameResult.totalDocsToModify || renameResult.totalDocsModified || 0} documents</p>
            </div>
          </div>
        )}
      </div>

      {/* TRADE HISTORY & ROLLBACK SECTION */}
      <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
        <h3 className={`font-semibold mb-2 ${textClass}`}>🔍 Trade History & Rollback</h3>

        {/* Ticker selector for investigation */}
        <div className="mb-3">
          <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Investigate Ticker</label>
          <div className="flex gap-2">
            <select
              value={tradeFilterTicker}
              onChange={e => { setTradeFilterTicker(e.target.value); setSelectedTickerHistory([]); }}
              className={`flex-1 px-3 py-2 border rounded-sm ${inputClass}`}
            >
              <option value="">-- Select Ticker --</option>
              {sortedCharacters.map(c => (
                <option key={c.ticker} value={c.ticker}>
                  {c.name} (${c.ticker}) - ${(prices[c.ticker] || c.basePrice).toFixed(2)}
                </option>
              ))}
            </select>
            <button
              onClick={async () => {
                if (tradeFilterTicker) {
                  const history = await getPriceHistoryForTicker(tradeFilterTicker);
                  setSelectedTickerHistory(history);
                }
              }}
              disabled={!tradeFilterTicker}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-sm disabled:opacity-50"
            >
              Load History
            </button>
          </div>
        </div>

        {/* Price History Display */}
        {selectedTickerHistory.length > 0 && (
          <div className={`p-3 rounded-sm mb-3 ${darkMode ? 'bg-slate-800' : 'bg-slate-100'}`}>
            <div className="flex justify-between items-center mb-2">
              <span className={`text-sm font-semibold ${textClass}`}>
                ${tradeFilterTicker} Price History ({selectedTickerHistory.length} entries)
              </span>
              <span className={`text-xs ${mutedClass}`}>Click timestamp to set rollback point</span>
            </div>
            <div className="max-h-48 overflow-y-auto space-y-1">
              {selectedTickerHistory.slice().reverse().slice(0, 1000).map((h, i, arr) => {
                const prevPrice = arr[i + 1]?.price;
                const change = prevPrice ? ((h.price - prevPrice) / prevPrice * 100) : 0;
                return (
                  <div
                    key={i}
                    className={`text-xs flex justify-between items-center py-1.5 px-2 rounded cursor-pointer hover:bg-blue-500/20 ${darkMode ? 'bg-slate-700' : 'bg-white'}`}
                    onClick={() => setRollbackTimestamp(h.timestamp.toString())}
                  >
                    <span className={mutedClass}>{new Date(h.timestamp).toLocaleString()}</span>
                    <div className="flex items-center gap-3">
                      <span className={`font-semibold ${textClass}`}>${h.price.toFixed(2)}</span>
                      {change !== 0 && (
                        <span className={`font-semibold ${change > 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {change > 0 ? '+' : ''}{change.toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Rollback Controls */}
        <div className={`p-3 rounded-sm ${darkMode ? 'bg-red-900/30 border border-red-700' : 'bg-red-50 border border-red-300'}`}>
          <h4 className="font-semibold text-red-500 mb-2">⚠️ Rollback Trades</h4>
          <p className={`text-xs ${mutedClass} mb-3`}>
            This will reverse ALL trades after the selected timestamp and restore prices.
          </p>

          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={rollbackTimestamp}
              onChange={e => setRollbackTimestamp(e.target.value)}
              placeholder="Timestamp (click history above)"
              className={`flex-1 px-3 py-2 border rounded-sm text-sm ${inputClass}`}
            />
          </div>

          {rollbackTimestamp && (
            <p className={`text-sm ${textClass} mb-2`}>
              Rollback to: <span className="text-orange-500 font-semibold">{new Date(parseInt(rollbackTimestamp)).toLocaleString()}</span>
            </p>
          )}

          <label className={`flex items-center gap-2 text-sm ${textClass} mb-3`}>
            <input
              type="checkbox"
              checked={rollbackConfirm}
              onChange={e => setRollbackConfirm(e.target.checked)}
              className="w-4 h-4"
            />
            I understand this will reverse ALL trades and cannot be undone
          </label>

          <button
            onClick={() => {
              if (rollbackTimestamp && rollbackConfirm) {
                executeFullRollback(parseInt(rollbackTimestamp));
              }
            }}
            disabled={loading || !rollbackTimestamp || !rollbackConfirm}
            className="w-full py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-sm disabled:opacity-50"
          >
            {loading ? 'Rolling back...' : '⚠️ Execute Full Rollback'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RecoveryTab;
