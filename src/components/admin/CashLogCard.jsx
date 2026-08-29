import { formatUTCDateTime } from '../../utils/formatters';

const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Every manual cash change, newest first. Answers "what have I handed out
// lately", and with the search box, "how much have I given this one player".
//
// The memo column is your own internal note. It is never shown to the player:
// they only ever see the amount.
export default function CashLogCard({
  darkMode, textClass, mutedClass, inputClass,
  cashLogEntries, cashLogVisibleTotals,
  cashLogSearch, setCashLogSearch,
  cashLogOnlyGrants, setCashLogOnlyGrants,
  cashLogLoading, cashLogLoaded, loadCashLog,
}) {
  const rowBorder = darkMode ? 'border-slate-700' : 'border-slate-200';

  return (
    <div className={`p-4 rounded-sm border ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
      <div className="flex items-start justify-between mb-3 gap-3">
        <div>
          <h3 className={`font-semibold ${textClass}`}>💸 Cash I Have Handed Out</h3>
          <p className={`text-xs ${mutedClass}`}>
            Every manual balance change. Your memo stays private, players only see the amount.
          </p>
        </div>
        <button
          onClick={loadCashLog}
          disabled={cashLogLoading}
          className="px-3 py-1.5 text-xs font-semibold rounded-sm bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-50 shrink-0"
        >
          {cashLogLoading ? 'Loading…' : cashLogLoaded ? 'Refresh' : 'Load log'}
        </button>
      </div>

      {cashLogLoaded && (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <input
              value={cashLogSearch}
              onChange={(e) => setCashLogSearch(e.target.value)}
              placeholder="Search player or memo"
              className={`flex-1 min-w-[12rem] px-3 py-2 text-sm rounded-sm border ${inputClass}`}
            />
            <label className={`flex items-center gap-2 text-xs ${textClass}`}>
              <input
                type="checkbox"
                checked={cashLogOnlyGrants}
                onChange={(e) => setCashLogOnlyGrants(e.target.checked)}
              />
              Only money given
            </label>
          </div>

          <div className={`flex flex-wrap gap-4 mb-3 text-sm ${textClass}`}>
            <span>Given: <strong className="text-green-500">{money(cashLogVisibleTotals.granted)}</strong></span>
            {!cashLogOnlyGrants && (
              <span>Taken back: <strong className="text-red-500">{money(cashLogVisibleTotals.takenBack)}</strong></span>
            )}
            <span className={mutedClass}>{cashLogVisibleTotals.count} change{cashLogVisibleTotals.count === 1 ? '' : 's'}</span>
          </div>

          {cashLogEntries.length === 0 ? (
            <p className={`text-sm ${mutedClass}`}>Nothing matches.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className={`text-left text-xs ${mutedClass} border-b ${rowBorder}`}>
                    <th className="py-2 pr-3 font-semibold">When</th>
                    <th className="py-2 pr-3 font-semibold">Player</th>
                    <th className="py-2 pr-3 font-semibold text-right">Change</th>
                    <th className="py-2 pr-3 font-semibold text-right">New balance</th>
                    <th className="py-2 font-semibold">Memo (private)</th>
                  </tr>
                </thead>
                <tbody>
                  {cashLogEntries.map((e) => (
                    <tr key={e.id} className={`border-b ${rowBorder}`}>
                      <td className={`py-2 pr-3 whitespace-nowrap text-xs ${mutedClass}`}>
                        {e.at ? formatUTCDateTime(e.at) : 'unknown'}
                      </td>
                      <td className={`py-2 pr-3 ${textClass}`}>
                        {e.displayName || <span className={mutedClass}>{e.userId}</span>}
                      </td>
                      <td className={`py-2 pr-3 text-right font-semibold whitespace-nowrap ${e.delta > 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {e.delta > 0 ? '+' : ''}{money(e.delta)}
                      </td>
                      <td className={`py-2 pr-3 text-right whitespace-nowrap ${mutedClass}`}>{money(e.newCash)}</td>
                      <td className={`py-2 ${mutedClass}`}>{e.memo || "none"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
