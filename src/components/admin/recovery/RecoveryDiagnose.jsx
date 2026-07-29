// Extracted from RecoveryTab.jsx, which was past the 400-line component limit.
const RecoveryDiagnose = ({ darkMode, textClass, mutedClass, diagnosisIds, setDiagnosisIds, diagnosing, diagnosisResults, handleDiagnoseUsers }) => (
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

);

export default RecoveryDiagnose;
