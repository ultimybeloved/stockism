// The gift-drop audit panel from the admin Diagnostic tab. Split out when
// DiagnosticTab hit its 400-line limit; it is a self-contained lookup with
// nothing in common with the ticker-rollback tooling it used to sit above.
const DropAuditPanel = ({
  darkMode,
  textClass,
  mutedClass,
  inputClass,
  dropAuditQuery,
  setDropAuditQuery,
  dropAuditRunning,
  handleDropAudit,
  dropAuditResult,
}) => {
  return (
    <>
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
    </>
  );
};

export default DropAuditPanel;
