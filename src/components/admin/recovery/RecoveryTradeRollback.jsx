// Extracted from RecoveryTab.jsx, which was past the 400-line component limit.
const RecoveryTradeRollback = ({ darkMode, textClass, mutedClass, inputClass, loading, tradeFilterTicker, setTradeFilterTicker, sortedCharacters, prices, selectedTickerHistory, setSelectedTickerHistory, getPriceHistoryForTicker, rollbackTimestamp, setRollbackTimestamp, rollbackConfirm, setRollbackConfirm, executeFullRollback }) => (
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
);

export default RecoveryTradeRollback;
