// Extracted from RecoveryTab.jsx, which was past the 400-line component limit.
const RecoverySpikeRepair = ({ darkMode, textClass, mutedClass, scanningSpike, repairingSpike, spikeScanned, spikeVictims, handleScanSpikeVictims, handleRepairAllSpikeVictims, handleRepairSpikeVictim }) => (
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

);

export default RecoverySpikeRepair;
