import { CHARACTERS } from '../../characters';

const StatsTab = ({
  darkMode,
  textClass,
  mutedClass,
  loading,
  statsLoading,
  marketStats,
  loadMarketStats,
  handleCleanupBasePrices,
  handleSyncPricesToHistory,
  handleResetAllPrices,
  orphanScanComplete,
  orphanedUsers,
  scanForOrphanedUsers,
  deleteAllOrphanedUsers,
  deleteOrphanedUser,
}) => {
  return (
    <div className="space-y-4">
      <div className={`p-3 rounded-sm ${darkMode ? 'bg-cyan-900/20' : 'bg-cyan-50'}`}>
        <div className="flex justify-between items-center">
          <p className={`text-sm ${mutedClass}`}>
            📈 Market overview and platform statistics
          </p>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={handleCleanupBasePrices}
              disabled={loading}
              className="px-3 py-1 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded-sm disabled:opacity-50"
              title="Remove recent base price entries from history"
            >
              {loading ? '...' : '🧹 Cleanup Base Prices'}
            </button>
            <button
              onClick={handleSyncPricesToHistory}
              disabled={loading}
              className="px-3 py-1 text-xs bg-orange-600 hover:bg-orange-700 text-white rounded-sm disabled:opacity-50"
              title="Sync current prices to match latest price history"
            >
              {loading ? '...' : '🔄 Sync Prices to History'}
            </button>
            <button
              onClick={handleResetAllPrices}
              disabled={loading}
              className="px-3 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded-sm disabled:opacity-50"
              title="Reset ALL character prices to base prices"
            >
              {loading ? '...' : '🔄 Reset All Prices'}
            </button>
            <button
              onClick={loadMarketStats}
              disabled={statsLoading}
              className="px-3 py-1 text-xs bg-cyan-600 hover:bg-cyan-700 text-white rounded-sm disabled:opacity-50"
            >
              {statsLoading ? '...' : '🔄 Refresh Stats'}
            </button>
          </div>
        </div>
      </div>

      {statsLoading ? (
        <p className={`text-center py-8 ${mutedClass}`}>Loading market stats...</p>
      ) : !marketStats ? (
        <p className={`text-center py-8 ${mutedClass}`}>Click refresh to load stats</p>
      ) : (
        <>
          {/* User Stats */}
          <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
            <h3 className={`font-semibold mb-3 ${textClass}`}>👥 Users</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center">
                <p className={`text-2xl font-bold ${textClass}`}>{marketStats.totalUsers}</p>
                <p className={`text-xs ${mutedClass}`}>Total Users</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-green-500">{marketStats.activeUsers24h}</p>
                <p className={`text-xs ${mutedClass}`}>Active (24h)</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-cyan-500">{marketStats.activeUsers7d}</p>
                <p className={`text-xs ${mutedClass}`}>Active (7d)</p>
              </div>
            </div>
          </div>

          {/* Financial Stats */}
          <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
            <h3 className={`font-semibold mb-3 ${textClass}`}>💰 Financials</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex justify-between">
                <span className={mutedClass}>Total Cash in System:</span>
                <span className="font-bold text-green-500">${marketStats.totalCashInSystem.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
              </div>
              <div className="flex justify-between">
                <span className={mutedClass}>Total Portfolio Value:</span>
                <span className={`font-bold ${textClass}`}>${marketStats.totalPortfolioValue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
              </div>
              <div className="flex justify-between">
                <span className={mutedClass}>Total Market Cap:</span>
                <span className="font-bold text-cyan-500">${marketStats.totalMarketCap.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
              </div>
              <div className="flex justify-between">
                <span className={mutedClass}>Total Shares Held:</span>
                <span className={`font-bold ${textClass}`}>{marketStats.totalSharesHeld.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className={mutedClass}>Margin Used:</span>
                <span className="font-bold text-amber-500">${marketStats.totalMarginUsed.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
              </div>
              <div className="flex justify-between">
                <span className={mutedClass}>Users with Margin:</span>
                <span className={`font-bold ${textClass}`}>{marketStats.usersWithMargin}</span>
              </div>
            </div>
          </div>

          {/* Activity Stats */}
          <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
            <h3 className={`font-semibold mb-3 ${textClass}`}>📊 Activity</h3>

            {/* 24h Activity */}
            <div className={`p-3 rounded-sm mb-3 ${darkMode ? 'bg-cyan-900/20' : 'bg-cyan-50'}`}>
              <h4 className="text-cyan-500 font-semibold text-sm mb-2">Last 24 Hours</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div className="text-center">
                  <p className="text-xl font-bold text-cyan-500">{marketStats.trades24h || 0}</p>
                  <p className={`text-xs ${mutedClass}`}>Trades</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-bold text-green-500">${(marketStats.volume24h || 0).toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}</p>
                  <p className={`text-xs ${mutedClass}`}>Volume</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-bold text-amber-500">{marketStats.checkins24h || 0}</p>
                  <p className={`text-xs ${mutedClass}`}>Check-ins</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-bold text-purple-500">{marketStats.bets24h || 0}</p>
                  <p className={`text-xs ${mutedClass}`}>Bets</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
                <div className="flex justify-between">
                  <span className={mutedClass}>Buys:</span>
                  <span className="text-green-500 font-semibold">{marketStats.buys24h || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className={mutedClass}>Sells:</span>
                  <span className="text-red-400 font-semibold">{marketStats.sells24h || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className={mutedClass}>Shorts:</span>
                  <span className="text-orange-500 font-semibold">{marketStats.shorts24h || 0}</span>
                </div>
              </div>
            </div>

            {/* Top Traded 24h */}
            {marketStats.topTraded24h && marketStats.topTraded24h.length > 0 && (
              <div className="mb-3">
                <h4 className={`text-xs font-semibold uppercase ${mutedClass} mb-2`}>Most Traded (24h)</h4>
                <div className="space-y-1">
                  {marketStats.topTraded24h.map((item) => (
                    <div key={item.ticker} className="flex justify-between text-sm">
                      <span className={textClass}>${item.ticker}</span>
                      <span className="font-bold text-cyan-500">${item.volume.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* All Time */}
            <div className={`pt-3 border-t ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
              <h4 className={`text-xs font-semibold uppercase ${mutedClass} mb-2`}>All Time</h4>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex justify-between">
                  <span className={mutedClass}>Total Trades:</span>
                  <span className={`font-bold ${textClass}`}>{marketStats.totalTradesAllTime.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className={mutedClass}>Total Bets:</span>
                  <span className={`font-bold ${textClass}`}>{marketStats.totalBetsPlaced.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Top Held Characters */}
          <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
            <h3 className={`font-semibold mb-3 ${textClass}`}>🏆 Most Held Characters</h3>
            <div className="space-y-2">
              {marketStats.topHeld.map((item, i) => {
                const char = CHARACTERS.find(c => c.ticker === item.ticker);
                return (
                  <div key={item.ticker} className="flex justify-between items-center">
                    <span className={textClass}>
                      <span className={mutedClass}>{i + 1}.</span> {char?.name || item.ticker} <span className={mutedClass}>(${item.ticker})</span>
                    </span>
                    <span className="font-bold text-cyan-500">{item.shares.toLocaleString()} shares</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Price Movers */}
          <div className="grid grid-cols-2 gap-4">
            {/* Top Gainers */}
            <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
              <h3 className={`font-semibold mb-3 text-green-500`}>📈 Top Gainers</h3>
              <div className="space-y-1">
                {marketStats.topGainers.map((item) => (
                  <div key={item.ticker} className="flex justify-between text-sm">
                    <span className={textClass}>${item.ticker}</span>
                    <span className="font-bold text-green-500">+{item.change.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Top Losers */}
            <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
              <h3 className={`font-semibold mb-3 text-red-500`}>📉 Top Losers</h3>
              <div className="space-y-1">
                {marketStats.topLosers.map((item) => (
                  <div key={item.ticker} className="flex justify-between text-sm">
                    <span className={textClass}>${item.ticker}</span>
                    <span className="font-bold text-red-500">{item.change.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Crew Membership */}
          <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
            <h3 className={`font-semibold mb-3 ${textClass}`}>🏴 Crew Membership</h3>
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(marketStats.crewCounts).sort((a, b) => b[1] - a[1]).map(([crewId, count]) => (
                <div key={crewId} className="flex justify-between text-sm">
                  <span className={textClass}>{crewId}</span>
                  <span className="font-bold text-purple-500">{count}</span>
                </div>
              ))}
            </div>
            {Object.keys(marketStats.crewCounts).length === 0 && (
              <p className={`text-sm ${mutedClass}`}>No crew memberships yet</p>
            )}
          </div>

          <p className={`text-xs ${mutedClass} text-center`}>
            Last updated: {new Date(marketStats.lastUpdated).toLocaleString()}
          </p>
        </>
      )}

      {/* Orphan Cleanup Section */}
      <div className={`p-4 rounded-sm ${darkMode ? 'bg-red-900/20 border border-red-800' : 'bg-red-50 border border-red-200'}`}>
        <h3 className={`font-semibold mb-3 text-red-500`}>🧹 Orphaned Account Cleanup</h3>
        <p className={`text-xs ${mutedClass} mb-3`}>
          Find and remove user documents that have zero activity (no trades, no checkins, default $1000 cash).
          These are likely bot accounts or users who were deleted from Firebase Auth.
        </p>

        <button
          onClick={scanForOrphanedUsers}
          disabled={loading}
          className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-sm disabled:opacity-50 mr-2"
        >
          {loading ? 'Scanning...' : '🔍 Scan for Orphans'}
        </button>

        {orphanScanComplete && (
          <span className={`text-sm ${mutedClass}`}>
            Found {orphanedUsers.length} suspicious accounts
          </span>
        )}

        {orphanedUsers.length > 0 && (
          <div className="mt-4">
            <div className="flex justify-between items-center mb-2">
              <span className={`text-sm font-semibold ${textClass}`}>
                {orphanedUsers.length} Orphaned Accounts
              </span>
              <button
                onClick={deleteAllOrphanedUsers}
                disabled={loading}
                className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-sm disabled:opacity-50"
              >
                🗑️ Delete All ({orphanedUsers.length})
              </button>
            </div>

            <div className="max-h-60 overflow-y-auto space-y-1">
              {orphanedUsers.slice(0, 100).map(u => (
                <div
                  key={u.id}
                  className={`p-2 rounded-sm flex justify-between items-center text-sm ${
                    darkMode ? 'bg-slate-800' : 'bg-white'
                  }`}
                >
                  <div>
                    <span className={textClass}>{u.displayName}</span>
                    <span className={`text-xs ${mutedClass} ml-2`}>
                      ${u.cash.toFixed(0)} • {u.totalTrades} trades
                    </span>
                  </div>
                  <button
                    onClick={() => deleteOrphanedUser(u.id)}
                    className="px-2 py-1 bg-red-500 hover:bg-red-600 text-white text-xs rounded-sm"
                  >
                    🗑️
                  </button>
                </div>
              ))}
              {orphanedUsers.length > 100 && (
                <p className={`text-xs ${mutedClass} text-center py-2`}>
                  Showing first 100 of {orphanedUsers.length}. Use "Delete All" for the rest.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default StatsTab;
