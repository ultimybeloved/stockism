import React from 'react';

const DiagnosticTab = ({
  darkMode,
  textClass,
  mutedClass,
  inputClass,
  // Drop Audit
  dropAuditQuery,
  setDropAuditQuery,
  dropAuditRunning,
  handleDropAudit,
  dropAuditResult,
  // Ticker Rollback Diagnostic
  diagTicker,
  setDiagTicker,
  diagStartDate,
  setDiagStartDate,
  diagRunning,
  handleRunDiagnostic,
  diagResult,
  diagUserSort,
  setDiagUserSort,
  // Recovery Tool
  recoveryRollbackDate,
  setRecoveryRollbackDate,
  recoveryRunning,
  recoveryExecuting,
  handleRecoveryPreview,
  recoveryDone,
  recoveryPreview,
  handleRecoveryExecute,
}) => {
  return (
    <div className="space-y-4 overflow-x-hidden" onClick={e => e.stopPropagation()}>

      {/* Drop Audit Section */}
      <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
        <h3 className={`font-semibold mb-3 ${textClass}`}>🎁 Drop Audit</h3>
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label className={`text-xs ${mutedClass} block mb-1`}>Username or UID</label>
            <input
              type="text"
              value={dropAuditQuery}
              onChange={e => setDropAuditQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleDropAudit()}
              placeholder="Enter username or UID..."
              className={`w-full px-2 py-1.5 text-xs border rounded-sm ${inputClass}`}
            />
          </div>
          <button
            onClick={handleDropAudit}
            disabled={dropAuditRunning || !dropAuditQuery.trim()}
            className="px-4 py-1.5 text-xs bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-sm disabled:opacity-50"
          >
            {dropAuditRunning ? 'Auditing...' : 'Audit'}
          </button>
        </div>
      </div>

      {/* Drop Audit Results */}
      {dropAuditResult && (
        <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
          <div className="flex justify-between items-center mb-3">
            <h4 className={`font-semibold ${textClass}`}>{dropAuditResult.displayName}</h4>
            <span className={`text-xs ${mutedClass}`}>{dropAuditResult.uid}</span>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[
              { label: 'Total Claims', value: dropAuditResult.totalClaims, color: 'text-blue-400' },
              { label: 'Expected (1/day)', value: dropAuditResult.expectedClaims, color: 'text-green-400' },
              { label: 'Excess Claims', value: dropAuditResult.excessClaims, color: dropAuditResult.excessClaims > 0 ? 'text-red-400' : 'text-green-400' },
              { label: 'First Claim', value: dropAuditResult.firstClaimDate ? new Date(dropAuditResult.firstClaimDate).toLocaleDateString() : 'Never', color: 'text-purple-400' },
              { label: 'Total Gift Value', value: `$${dropAuditResult.totalGiftedValue.toFixed(2)}`, color: dropAuditResult.totalGiftedValue > 100 ? 'text-red-400' : 'text-yellow-400' },
              { label: 'Current Cash', value: `$${dropAuditResult.cash.toFixed(2)}`, color: 'text-cyan-400' },
            ].map((card, i) => (
              <div key={i} className={`p-2 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-slate-50'} border ${darkMode ? 'border-slate-600' : 'border-slate-200'}`}>
                <div className={`text-xs ${mutedClass}`}>{card.label}</div>
                <div className={`text-sm font-bold ${card.color}`}>{card.value}</div>
              </div>
            ))}
          </div>

          {/* Gifted Shares Breakdown */}
          {Object.keys(dropAuditResult.giftedSharesByTicker).length > 0 && (
            <div className="mb-3">
              <h5 className={`text-xs font-semibold mb-1 ${mutedClass}`}>Gifted Shares by Ticker</h5>
              <div className={`rounded-sm border ${darkMode ? 'border-slate-600' : 'border-slate-200'} overflow-hidden`}>
                <table className="w-full text-xs">
                  <thead>
                    <tr className={darkMode ? 'bg-slate-700' : 'bg-slate-100'}>
                      <th className={`text-left px-2 py-1 ${mutedClass}`}>Ticker</th>
                      <th className={`text-right px-2 py-1 ${mutedClass}`}>Gifted</th>
                      <th className={`text-right px-2 py-1 ${mutedClass}`}>Price</th>
                      <th className={`text-right px-2 py-1 ${mutedClass}`}>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(dropAuditResult.giftedSharesByTicker)
                      .sort((a, b) => b[1].value - a[1].value)
                      .map(([ticker, info]) => (
                        <tr key={ticker} className={`border-t ${darkMode ? 'border-slate-600' : 'border-slate-200'}`}>
                          <td className={`px-2 py-1 font-semibold ${textClass}`}>{ticker}</td>
                          <td className="px-2 py-1 text-right text-amber-400">{info.shares}</td>
                          <td className={`px-2 py-1 text-right ${mutedClass}`}>${info.price.toFixed(2)}</td>
                          <td className="px-2 py-1 text-right text-red-400 font-semibold">${info.value.toFixed(2)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Suspicious Days */}
          {dropAuditResult.suspiciousDays.length > 0 && (
            <div className="mb-3">
              <h5 className={`text-xs font-semibold mb-1 text-red-400`}>Suspicious Days (4+ claims)</h5>
              <div className="flex flex-wrap gap-1">
                {dropAuditResult.suspiciousDays.map(({ day, count }) => (
                  <span key={day} className="px-2 py-0.5 text-xs bg-red-500/20 text-red-400 rounded-sm border border-red-500/30">
                    {day}: {count} claims
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Claims per Day Timeline */}
          {Object.keys(dropAuditResult.claimsByDay).length > 0 && (
            <div>
              <h5 className={`text-xs font-semibold mb-1 ${mutedClass}`}>Claims Timeline</h5>
              <div className={`max-h-40 overflow-y-auto rounded-sm border ${darkMode ? 'border-slate-600 bg-slate-700/30' : 'border-slate-200 bg-slate-50'} p-2`}>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(dropAuditResult.claimsByDay)
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([day, count]) => (
                      <span key={day} className={`px-1.5 py-0.5 text-xs rounded-sm ${count > 3 ? 'bg-red-500/20 text-red-400 border border-red-500/30' : count > 1 ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : `${darkMode ? 'bg-slate-600 text-slate-300' : 'bg-slate-200 text-slate-600'}`}`}>
                        {day.slice(5)}: {count}
                      </span>
                    ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Controls */}
      <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
        <h3 className={`font-semibold mb-3 ${textClass}`}>🔍 Ticker Rollback Diagnostic</h3>
        <div className="flex gap-2 items-end flex-wrap">
          <div>
            <label className={`text-xs ${mutedClass} block mb-1`}>Ticker</label>
            <input
              type="text"
              value={diagTicker}
              onChange={e => setDiagTicker(e.target.value.toUpperCase())}
              className={`w-24 px-2 py-1.5 text-xs border rounded-sm ${inputClass}`}
            />
          </div>
          <div>
            <label className={`text-xs ${mutedClass} block mb-1`}>Start Date (UTC)</label>
            <input
              type="date"
              value={diagStartDate}
              onChange={e => setDiagStartDate(e.target.value)}
              className={`px-2 py-1.5 text-xs border rounded-sm ${inputClass}`}
            />
          </div>
          <button
            onClick={handleRunDiagnostic}
            disabled={diagRunning || !diagTicker}
            className="px-4 py-1.5 text-xs bg-pink-600 hover:bg-pink-700 text-white font-semibold rounded-sm disabled:opacity-50"
          >
            {diagRunning ? 'Running...' : 'Run Diagnostic'}
          </button>
        </div>
      </div>

      {/* Results */}
      {diagResult && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Price Then', value: `$${diagResult.summary.priceAtStart.toFixed(2)}`, color: 'text-blue-400' },
              { label: 'Price Now', value: `$${diagResult.summary.currentPrice.toFixed(2)}`, color: diagResult.summary.priceInflation > 0 ? 'text-red-400' : 'text-green-400', sub: `${diagResult.summary.priceInflation > 0 ? '+' : ''}${diagResult.summary.priceInflation}%` },
              { label: 'Total Users', value: diagResult.summary.totalUsers, color: 'text-purple-400' },
              { label: 'Total Trades', value: diagResult.summary.totalTrades, color: 'text-yellow-400' },
              { label: 'Cash Out (sells)', value: `$${diagResult.summary.totalCashOut.toFixed(2)}`, color: 'text-red-400' },
              { label: 'Into Other Stocks', value: `$${diagResult.summary.cashIntoOtherStocks.toFixed(2)}`, color: 'text-orange-400' },
            ].map((card, i) => (
              <div key={i} className={`p-2 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                <div className={`text-xs ${mutedClass}`}>{card.label}</div>
                <div className={`text-base font-bold ${card.color}`}>
                  {card.value}
                  {card.sub && <span className="text-xs ml-1 opacity-75">{card.sub}</span>}
                </div>
              </div>
            ))}
          </div>

          {/* Ripple Effects */}
          {diagResult.rippleByTicker && diagResult.rippleByTicker.length > 0 && (
            <div className={`p-3 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
              <h4 className={`font-semibold text-sm mb-1 ${textClass}`}>💸 Dirty Money Trail — Where {diagResult.summary.ticker} profits went</h4>
              <div className="space-y-1 max-h-24 overflow-y-auto">
                {diagResult.rippleByTicker.map(r => (
                  <div key={r.ticker} className="flex justify-between items-center text-xs">
                    <span className={`font-semibold ${textClass}`}>{r.ticker}</span>
                    <span className="text-orange-400 font-semibold">${r.amount.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Per-user breakdown */}
          <div className={`p-3 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
            <div className="flex justify-between items-center mb-1">
              <h4 className={`font-semibold text-sm ${textClass}`}>👤 Per-User Breakdown</h4>
              <select
                value={diagUserSort}
                onChange={e => setDiagUserSort(e.target.value)}
                className={`text-xs px-2 py-1 border rounded-sm ${inputClass}`}
              >
                <option value="net">Sort: Net Cash Flow</option>
                <option value="bought">Sort: Most Bought</option>
                <option value="sold">Sort: Most Sold</option>
              </select>
            </div>
            <div className="space-y-2 max-h-[160px] overflow-y-auto">
              {[...diagResult.users]
                .filter(u => !u.isBot && u.totalTrades > 0)
                .sort((a, b) => {
                  if (diagUserSort === 'bought') return b.cashSpent - a.cashSpent;
                  if (diagUserSort === 'sold') return b.cashReceived - a.cashReceived;
                  return b.netCashFlow - a.netCashFlow;
                })
                .map(u => {
                  const isManipulator = u.netCashFlow > 100;
                  const isProfiteer = u.netCashFlow > 0 && u.netCashFlow <= 100;
                  const ripple = diagResult.userRipples?.[u.uid];
                  return (
                    <div key={u.uid} className={`p-2.5 rounded-sm ${
                      isManipulator ? (darkMode ? 'bg-red-900/30 border border-red-800/50' : 'bg-red-50 border border-red-200') :
                      isProfiteer ? (darkMode ? 'bg-yellow-900/20 border border-yellow-800/50' : 'bg-yellow-50 border border-yellow-200') :
                      (darkMode ? 'bg-slate-700/50' : 'bg-slate-50')
                    }`}>
                      <div className="flex items-center justify-between">
                        <span className={`font-semibold text-sm ${textClass}`}>
                          {u.displayName}
                          {isManipulator && <span className="ml-1.5 text-xs text-red-400">⚠️ Big Profiteer</span>}
                        </span>
                        <span className={`font-bold text-sm ${u.netCashFlow > 0 ? 'text-green-400' : u.netCashFlow < 0 ? 'text-red-400' : mutedClass}`}>
                          {u.netCashFlow >= 0 ? '+' : ''}${u.netCashFlow.toFixed(2)}
                        </span>
                      </div>
                      <div className={`text-xs mt-1 ${mutedClass} grid grid-cols-1 sm:grid-cols-2 gap-x-4`}>
                        <span>Bought: {u.sharesBought} shares (${u.cashSpent.toFixed(2)})</span>
                        <span>Sold: {u.sharesSold} shares (${u.cashReceived.toFixed(2)})</span>
                        {u.sharesShorted > 0 && <span>Shorted: {u.sharesShorted} shares (${u.cashFromShorts.toFixed(2)})</span>}
                        {u.sharesCovered > 0 && <span>Covered: {u.sharesCovered} shares (${u.cashToCover.toFixed(2)})</span>}
                        <span>Current: {u.currentHoldings} shares</span>
                        <span>Gifted (drops): ~{u.giftedShares} shares</span>
                        <span>Cash: ${u.currentCash.toFixed(2)}</span>
                        <span>Trades: {u.totalTrades}</span>
                      </div>
                      {ripple && (
                        <div className="mt-1.5 pt-1.5 border-t border-orange-500/30">
                          <div className="text-xs text-orange-400 break-words">
                            💸 Spent ${ripple.spentOnOtherStocks.toFixed(2)} of ${ripple.shroProfit.toFixed(2)} profit on:
                            {' '}{Object.entries(ripple.breakdown).map(([t, amt]) => `${t} ($${amt.toFixed(2)})`).join(', ')}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Recovery Tool */}
          <div className={`p-3 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
            <h4 className={`font-semibold text-sm mb-2 ${textClass}`}>🔧 Ticker Recovery</h4>
            <div className="flex gap-2 items-end mb-3">
              <div>
                <label className={`text-xs ${mutedClass}`}>Roll back price to</label>
                <input
                  type="date"
                  value={recoveryRollbackDate}
                  onChange={e => setRecoveryRollbackDate(e.target.value)}
                  className={`block px-2 py-1 text-sm border rounded-sm ${inputClass}`}
                />
              </div>
              <button
                onClick={handleRecoveryPreview}
                disabled={recoveryRunning || recoveryExecuting}
                className="px-3 py-1 text-sm bg-blue-600 text-white rounded-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {recoveryRunning ? 'Running...' : 'Preview Recovery'}
              </button>
            </div>

            {recoveryDone && (
              <div className="mb-3 p-2 rounded-sm bg-green-900/30 border border-green-700 text-green-400 text-sm font-semibold">
                Recovery executed successfully
              </div>
            )}

            {recoveryPreview && (
              <div className="space-y-3">
                {/* Price Reset */}
                <div className={`p-2 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-slate-50'}`}>
                  <div className={`text-xs font-semibold ${textClass} mb-1`}>Price Reset</div>
                  <div className={`text-sm ${textClass}`}>
                    ${recoveryPreview.priceReset.from.toFixed(2)} → ${recoveryPreview.priceReset.to.toFixed(2)}
                  </div>
                </div>

                {/* History Rewrite */}
                {recoveryPreview.historyRewrite && (
                  <div className={`p-2 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-slate-50'}`}>
                    <div className={`text-xs font-semibold ${textClass} mb-1`}>Price History Rewrite</div>
                    <div className={`text-sm ${textClass}`}>
                      Removing {recoveryPreview.historyRewrite.removedEntries} bad entries, keeping {recoveryPreview.historyRewrite.keptEntries} + adding flat line
                    </div>
                  </div>
                )}

                {/* Clawback Table */}
                {recoveryPreview.clawbacks.length > 0 && (
                  <div>
                    <div className={`text-xs font-semibold ${textClass} mb-1`}>
                      Clawbacks ({recoveryPreview.clawbacks.length} users — ${recoveryPreview.totalClawedBack.toFixed(2)} total)
                      {recoveryPreview.totalUnrecoverable > 0 && (
                        <span className="text-red-400 ml-2">${recoveryPreview.totalUnrecoverable.toFixed(2)} unrecoverable</span>
                      )}
                    </div>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {recoveryPreview.clawbacks.map(cb => (
                        <div key={cb.uid} className={`flex justify-between items-center text-xs p-1.5 rounded-sm ${cb.wasFloored ? (darkMode ? 'bg-red-900/20' : 'bg-red-50') : (darkMode ? 'bg-slate-700/30' : 'bg-slate-50')}`}>
                          <span className={textClass}>{cb.displayName}</span>
                          <div className="text-right">
                            <span className={mutedClass}>${cb.previousCash.toFixed(2)}</span>
                            <span className="mx-1">→</span>
                            <span className="text-red-400 font-semibold">${cb.newCash.toFixed(2)}</span>
                            <span className={`ml-1 ${mutedClass}`}>(-${cb.actualClawback.toFixed(2)})</span>
                            {cb.wasFloored && <span className="ml-1 text-red-400">⚠️</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Holders Affected */}
                {recoveryPreview.holdersAffected.length > 0 && (
                  <div>
                    <div className={`text-xs font-semibold ${textClass} mb-1`}>Holders Affected (value drop from price reset)</div>
                    <div className="max-h-32 overflow-y-auto space-y-1">
                      {recoveryPreview.holdersAffected.map(h => (
                        <div key={h.uid} className={`flex justify-between items-center text-xs p-1.5 rounded-sm ${darkMode ? 'bg-slate-700/30' : 'bg-slate-50'}`}>
                          <span className={textClass}>{h.displayName} ({h.holdings} shares)</span>
                          <span className="text-red-400">-${h.valueDrop.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {recoveryPreview.clawbacks.length === 0 && recoveryPreview.holdersAffected.length === 0 && (
                  <div className={`text-sm ${mutedClass}`}>No users affected by this recovery.</div>
                )}

                {/* Execute Button */}
                {!recoveryDone && (
                  <button
                    onClick={handleRecoveryExecute}
                    disabled={recoveryExecuting}
                    className="w-full px-3 py-2 text-sm bg-red-600 text-white rounded-sm hover:bg-red-700 disabled:opacity-50 font-semibold"
                  >
                    {recoveryExecuting ? 'Executing...' : `Execute Recovery on ${diagTicker}`}
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default DiagnosticTab;
