// Extracted from UsersTab.jsx, which was past the 400-line component limit.
const UserFinancials = ({ darkMode, textClass, mutedClass, loading, prices, selectedUser, calculateLivePortfolioValue, handleSyncSingleUser }) => (
  <>
    {/* Sync Status */}
    {(() => {
      const liveValue = calculateLivePortfolioValue(selectedUser);
      const storedValue = selectedUser.portfolioValue || 0;
      const difference = liveValue !== null ? Math.abs(liveValue - storedValue) : 0;
      const isOutOfSync = difference > 0.01;
      const lastSynced = selectedUser.lastSyncedAt;

      return (
        <div className={`p-3 rounded mb-4 ${darkMode ? 'bg-slate-600' : 'bg-white'}`}>
          <div className="flex items-center justify-between mb-2">
            <h4 className={`text-xs font-semibold uppercase ${mutedClass}`}>🔄 Sync Status</h4>
            <button
              onClick={() => handleSyncSingleUser(selectedUser.id)}
              disabled={loading}
              className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded disabled:opacity-50"
            >
              {loading ? '...' : 'Sync Now'}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className={`text-xs ${mutedClass}`}>Stored Value</div>
              <div className={`font-bold ${textClass}`}>${storedValue.toFixed(2)}</div>
            </div>
            <div>
              <div className={`text-xs ${mutedClass}`}>Calculated Value</div>
              <div className={`font-bold ${liveValue !== null ? (isOutOfSync ? 'text-orange-500' : 'text-green-500') : mutedClass}`}>
                {liveValue !== null ? `$${liveValue.toFixed(2)}` : 'N/A'}
              </div>
            </div>
            <div>
              <div className={`text-xs ${mutedClass}`}>Difference</div>
              <div className={`font-bold ${isOutOfSync ? 'text-red-500' : 'text-green-500'}`}>
                {liveValue !== null ? `$${difference.toFixed(2)}` : 'N/A'}
              </div>
            </div>
            <div>
              <div className={`text-xs ${mutedClass}`}>Status</div>
              <div className={`font-bold text-xs ${isOutOfSync ? 'text-orange-500' : 'text-green-500'}`}>
                {isOutOfSync ? '⚠️ Out of Sync' : '✅ Synced'}
              </div>
            </div>
          </div>

          {lastSynced && (
            <div className={`mt-2 pt-2 border-t ${darkMode ? 'border-slate-500' : 'border-slate-200'} text-xs ${mutedClass}`}>
              Last synced: {lastSynced instanceof Date ? lastSynced.toLocaleString() : new Date(lastSynced.seconds * 1000).toLocaleString()}
            </div>
          )}
        </div>
      );
    })()}

    {/* Financial Breakdown */}
    {(() => {
      const txLog = selectedUser.transactionLog || [];

      let tradingProfit = 0;
      let betProfit = 0;
      let checkinBonus = 0;
      let totalTrades = 0;
      let profitableTrades = 0;
      let totalBets = 0;
      let wonBets = 0;

      txLog.forEach(tx => {
        if (tx.type === 'SELL') {
          totalTrades++;
          const profit = (tx.totalRevenue || 0) - (tx.totalCost || 0);
          tradingProfit += profit;
          if (profit > 0) profitableTrades++;
        }
        if (tx.type === 'SHORT_CLOSE') {
          totalTrades++;
          const profit = tx.totalProfit || 0;
          tradingProfit += profit;
          if (profit > 0) profitableTrades++;
        }
        if (tx.type === 'CHECKIN') {
          checkinBonus += tx.bonus || 0;
        }
        if (tx.type === 'BET') {
          totalBets++;
        }
      });

      Object.values(selectedUser.bets || {}).forEach(bet => {
        if (bet.paid && bet.payout > 0) {
          betProfit += (bet.payout - bet.amount);
          wonBets++;
        } else if (bet.paid) {
          betProfit -= bet.amount;
        }
      });

      const holdingsValue = Object.entries(selectedUser.holdings || {}).reduce((sum, [ticker, shares]) => {
        const shareCount = typeof shares === 'number' ? shares : (shares?.shares || 0);
        return sum + (prices[ticker] || 0) * shareCount;
      }, 0);

      const totalCostBasis = Object.entries(selectedUser.costBasis || {}).reduce((sum, [ticker, cost]) => {
        const h = selectedUser.holdings || {};
        const shareCount = typeof h[ticker] === 'number' ? h[ticker] : (h[ticker]?.shares || 0);
        if (shareCount > 0 && typeof cost === 'number' && !isNaN(cost)) return sum + cost;
        return sum;
      }, 0);

      const unrealizedGains = holdingsValue - totalCostBasis;

      return (
        <div className={`p-3 rounded mb-4 ${darkMode ? 'bg-slate-600' : 'bg-white'}`}>
          <h4 className={`text-xs font-semibold uppercase ${mutedClass} mb-3`}>💰 Money Breakdown</h4>

          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className={mutedClass}>Trading Realized P&L:</span>
              <span className={`font-bold ${tradingProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {tradingProfit >= 0 ? '+' : ''}${tradingProfit.toFixed(2)}
              </span>
            </div>
            {totalTrades > 0 && (
              <div className="flex justify-between pl-4">
                <span className={`text-xs ${mutedClass}`}>
                  {totalTrades} trades • {profitableTrades} wins ({((profitableTrades / totalTrades) * 100).toFixed(0)}%)
                </span>
                <span className={`text-xs ${mutedClass}`}>
                  avg: ${(tradingProfit / totalTrades).toFixed(2)}/trade
                </span>
              </div>
            )}

            <div className="flex justify-between">
              <span className={mutedClass}>Holdings Unrealized:</span>
              <span className={`font-bold ${unrealizedGains >= 0 ? 'text-cyan-500' : 'text-orange-500'}`}>
                {unrealizedGains >= 0 ? '+' : ''}${unrealizedGains.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between pl-4">
              <span className={`text-xs ${mutedClass}`}>
                Cost basis: ${totalCostBasis.toFixed(2)} → Value: ${holdingsValue.toFixed(2)}
              </span>
            </div>

            {totalBets > 0 && (
              <>
                <div className="flex justify-between">
                  <span className={mutedClass}>Betting Net:</span>
                  <span className={`font-bold ${betProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {betProfit >= 0 ? '+' : ''}${betProfit.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between pl-4">
                  <span className={`text-xs ${mutedClass}`}>
                    {wonBets}/{totalBets} bets won ({totalBets > 0 ? ((wonBets / totalBets) * 100).toFixed(0) : 0}%)
                  </span>
                </div>
              </>
            )}

            {checkinBonus > 0 && (
              <div className="flex justify-between">
                <span className={mutedClass}>Check-in Bonuses:</span>
                <span className="font-bold text-blue-500">+${checkinBonus.toFixed(2)}</span>
              </div>
            )}

            <div className={`flex justify-between pt-2 border-t ${darkMode ? 'border-slate-500' : 'border-slate-300'}`}>
              <span className={`font-semibold ${textClass}`}>Total Income:</span>
              <span className={`font-bold ${(tradingProfit + betProfit + checkinBonus) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {(tradingProfit + betProfit + checkinBonus) >= 0 ? '+' : ''}${(tradingProfit + betProfit + checkinBonus).toFixed(2)}
              </span>
            </div>

            <div className={`pt-2 border-t ${darkMode ? 'border-slate-500' : 'border-slate-300'}`}>
              <div className="flex justify-between text-xs">
                <span className={mutedClass}>Total Trades:</span>
                <span className={textClass}>{selectedUser.totalTrades || 0}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className={mutedClass}>Check-ins:</span>
                <span className={textClass}>{selectedUser.totalCheckins || 0}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className={mutedClass}>Crew:</span>
                <span className={textClass}>{selectedUser.crew || 'None'}</span>
              </div>
            </div>
          </div>
        </div>
      );
    })()}

    {/* Margin/Loan Info */}
    {(selectedUser.marginEnabled || selectedUser.activeLoan) && (
      <div className={`p-2 rounded mb-4 ${darkMode ? 'bg-amber-900/30' : 'bg-amber-50'}`}>
        <h4 className={`text-xs font-semibold uppercase text-amber-500 mb-2`}>Debt Info</h4>
        {selectedUser.marginEnabled && (
          <div className="text-sm flex justify-between">
            <span className={mutedClass}>Margin Used:</span>
            <span className="text-amber-500 font-bold">${(selectedUser.marginUsed || 0).toFixed(2)}</span>
          </div>
        )}
        {selectedUser.activeLoan && (
          <div className="text-sm flex justify-between">
            <span className={mutedClass}>Active Loan:</span>
            <span className="text-red-500 font-bold">${selectedUser.activeLoan.principal?.toFixed(2) || '?'}</span>
          </div>
        )}
      </div>
    )}

  </>
);

export default UserFinancials;
