
const TradesTab = ({
  darkMode,
  textClass,
  mutedClass,
  tradeTimePeriod,
  setTradeTimePeriod,
  tradeTypeFilter,
  setTradeTypeFilter,
  tradeFilterTicker,
  setTradeFilterTicker,
  tradeBotFilter,
  setTradeBotFilter,
  tradesLoading,
  recentTrades,
  loadRecentTrades,
}) => {
  return (
    <div className="space-y-4">
      <div className={`p-3 rounded-sm ${darkMode ? 'bg-yellow-900/20' : 'bg-yellow-50'}`}>
        <p className={`text-sm ${mutedClass}`}>
          💹 View trade history across all users. Filter by time period, trade type, or ticker.
        </p>
      </div>

      {/* Filters */}
      <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
        <div className="flex flex-wrap gap-3 items-end">
          {/* Time Period */}
          <div>
            <label className={`text-xs ${mutedClass} block mb-1`}>Time Period</label>
            <select
              value={tradeTimePeriod}
              onChange={(e) => setTradeTimePeriod(e.target.value)}
              className={`px-3 py-2 rounded-sm border text-sm ${darkMode ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-slate-300'}`}
            >
              <option value="24h">Last 24 Hours</option>
              <option value="week">Last 7 Days</option>
              <option value="month">Last 30 Days</option>
              <option value="all">All Time</option>
            </select>
          </div>

          {/* Trade Type */}
          <div>
            <label className={`text-xs ${mutedClass} block mb-1`}>Trade Type</label>
            <select
              value={tradeTypeFilter}
              onChange={(e) => setTradeTypeFilter(e.target.value)}
              className={`px-3 py-2 rounded-sm border text-sm ${darkMode ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-slate-300'}`}
            >
              <option value="all">All Types</option>
              <option value="BUY">Buy</option>
              <option value="SELL">Sell</option>
              <option value="SHORT_OPEN">Short Open</option>
              <option value="SHORT_CLOSE">Short Close</option>
            </select>
          </div>

          {/* Ticker Filter */}
          <div>
            <label className={`text-xs ${mutedClass} block mb-1`}>Ticker (optional)</label>
            <input
              type="text"
              value={tradeFilterTicker}
              onChange={(e) => setTradeFilterTicker(e.target.value.toUpperCase())}
              placeholder="e.g. LUFFY"
              className={`w-24 px-3 py-2 rounded-sm border text-sm ${darkMode ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-slate-300'}`}
            />
          </div>

          {/* Bot Filter */}
          <div>
            <label className={`text-xs ${mutedClass} block mb-1`}>User Type</label>
            <select
              value={tradeBotFilter}
              onChange={(e) => setTradeBotFilter(e.target.value)}
              className={`px-3 py-2 rounded-sm border text-sm ${darkMode ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-slate-300'}`}
            >
              <option value="real">Real Users Only</option>
              <option value="bots">Bots Only</option>
              <option value="all">All Trades</option>
            </select>
          </div>

          {/* Load Button */}
          <button
            onClick={() => loadRecentTrades(tradeTimePeriod, tradeTypeFilter, tradeFilterTicker, tradeBotFilter)}
            disabled={tradesLoading}
            className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white font-semibold rounded-sm disabled:opacity-50"
          >
            {tradesLoading ? 'Loading...' : '🔍 Load Trades'}
          </button>
        </div>
      </div>

      {/* Trade Stats Summary */}
      {recentTrades.length > 0 && (
        <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
          <div className="grid grid-cols-5 gap-4 text-center">
            <div>
              <p className="text-xl font-bold text-yellow-500">{recentTrades.length}</p>
              <p className={`text-xs ${mutedClass}`}>Total Trades</p>
            </div>
            <div>
              <p className="text-xl font-bold text-green-500">{recentTrades.filter(t => t.type === 'BUY').length}</p>
              <p className={`text-xs ${mutedClass}`}>Buys</p>
            </div>
            <div>
              <p className="text-xl font-bold text-red-400">{recentTrades.filter(t => t.type === 'SELL').length}</p>
              <p className={`text-xs ${mutedClass}`}>Sells</p>
            </div>
            <div>
              <p className="text-xl font-bold text-orange-500">{recentTrades.filter(t => t.type === 'SHORT_OPEN').length}</p>
              <p className={`text-xs ${mutedClass}`}>Shorts Opened</p>
            </div>
            <div>
              <p className="text-xl font-bold text-purple-500">{recentTrades.filter(t => t.type === 'SHORT_CLOSE').length}</p>
              <p className={`text-xs ${mutedClass}`}>Shorts Closed</p>
            </div>
          </div>
        </div>
      )}

      {/* Trades Feed */}
      <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
        <h3 className={`font-semibold mb-3 ${textClass}`}>Trade Feed</h3>

        {tradesLoading ? (
          <p className={`text-center ${mutedClass} py-8`}>Loading trades...</p>
        ) : recentTrades.length === 0 ? (
          <p className={`text-center ${mutedClass} py-8`}>No trades found. Click "Load Trades" to fetch.</p>
        ) : (
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {recentTrades.map((trade, i) => (
              <div
                key={`${trade.userId}-${trade.timestamp}-${i}`}
                className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-slate-50'} flex justify-between items-center`}
              >
                <div className="flex items-center gap-3">
                  {/* Trade Type Badge */}
                  <span className={`px-2 py-1 rounded text-xs font-bold ${
                    trade.type === 'BUY' ? 'bg-green-500/20 text-green-500' :
                    trade.type === 'SELL' ? 'bg-red-500/20 text-red-400' :
                    trade.type === 'SHORT_OPEN' ? 'bg-orange-500/20 text-orange-500' :
                    'bg-purple-500/20 text-purple-500'
                  }`}>
                    {trade.type === 'SHORT_OPEN' ? 'SHORT' : trade.type === 'SHORT_CLOSE' ? 'COVER' : trade.type}
                  </span>

                  {/* Trade Details */}
                  <div>
                    <p className={textClass}>
                      <span className="font-semibold">{trade.userName}</span>
                      {trade.isBot && (
                        <span className="ml-1 px-1.5 py-0.5 text-xs rounded bg-purple-600 text-white">🤖</span>
                      )}
                      <span className={mutedClass}> {trade.type === 'BUY' ? 'bought' : trade.type === 'SELL' ? 'sold' : trade.type === 'SHORT_OPEN' ? 'shorted' : 'covered'} </span>
                      <span className="font-bold text-cyan-500">{trade.shares}</span>
                      <span className={mutedClass}> shares of </span>
                      <span className="font-bold">${trade.ticker}</span>
                    </p>
                    <p className={`text-xs ${mutedClass}`}>
                      @ ${trade.price?.toFixed(2)} • Total: ${trade.total?.toFixed(2)}
                      {trade.profit !== null && trade.profit !== undefined && (
                        <span className={trade.profit >= 0 ? 'text-green-500 ml-2' : 'text-red-400 ml-2'}>
                          P/L: {trade.profit >= 0 ? '+' : ''}${trade.profit.toFixed(2)}
                        </span>
                      )}
                    </p>
                  </div>
                </div>

                {/* Timestamp */}
                <div className="text-right">
                  <p className={`text-xs ${mutedClass}`}>
                    {new Date(trade.timestamp).toLocaleDateString()}
                  </p>
                  <p className={`text-xs ${mutedClass}`}>
                    {new Date(trade.timestamp).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default TradesTab;
