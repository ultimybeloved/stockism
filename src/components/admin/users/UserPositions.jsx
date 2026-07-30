// Extracted from UsersTab.jsx, which was past the 400-line component limit.
const UserPositions = ({ darkMode, textClass, mutedClass, prices, selectedUser }) => (
  <>
    {/* Holdings */}
    {Object.keys(selectedUser.holdings).length > 0 && (
      <div className="mb-4">
        <h4 className={`text-xs font-semibold uppercase ${mutedClass} mb-2`}>Holdings (with P&L)</h4>
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {Object.entries(selectedUser.holdings)
            .map(([ticker, shares]) => {
              const shareCount = typeof shares === 'number' ? shares : (shares?.shares || 0);
              if (shareCount <= 0) return null;

              const currentPrice = prices[ticker] || 0;
              const currentValue = currentPrice * shareCount;
              const avgCost = selectedUser.costBasis?.[ticker] || 0;
              const totalCost = avgCost * shareCount;
              const unrealizedPL = currentValue - totalCost;
              const unrealizedPct = avgCost > 0 ? (((currentPrice - avgCost) / avgCost) * 100) : 0;

              return { ticker, shareCount, currentPrice, currentValue, totalCost, avgCost, unrealizedPL, unrealizedPct };
            })
            .filter(h => h !== null)
            .sort((a, b) => b.unrealizedPL - a.unrealizedPL)
            .map(({ ticker, shareCount, currentPrice, currentValue, totalCost, avgCost, unrealizedPL, unrealizedPct }) => (
              <div key={ticker} className={`text-sm p-2 rounded ${darkMode ? 'bg-slate-700' : 'bg-slate-100'}`}>
                <div className="flex justify-between items-start">
                  <div>
                    <span className={`font-semibold ${textClass}`}>{ticker}</span>
                    <span className={`ml-2 text-xs ${mutedClass}`}>{shareCount} shares</span>
                  </div>
                  <span className={`font-bold ${unrealizedPL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {unrealizedPL >= 0 ? '+' : '-'}${Math.abs(unrealizedPL).toFixed(2)}
                  </span>
                </div>
                <div className={`text-xs ${mutedClass} mt-1`}>
                  Avg cost: ${avgCost.toFixed(2)} → Price: ${currentPrice.toFixed(2)} ({unrealizedPct >= 0 ? '+' : ''}{unrealizedPct.toFixed(1)}%)
                </div>
                <div className={`text-xs ${mutedClass}`}>
                  Total cost: ${totalCost.toFixed(2)} → Value: ${currentValue.toFixed(2)}
                </div>
              </div>
            ))
          }
        </div>
      </div>
    )}

    {/* Shorts */}
    {Object.keys(selectedUser.shorts).length > 0 && (
      <div className="mb-4">
        <h4 className={`text-xs font-semibold uppercase text-red-400 mb-2`}>Short Positions</h4>
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {Object.entries(selectedUser.shorts).map(([ticker, shortData]) => {
            if (!shortData || shortData.shares <= 0) return null;
            const entryPrice = shortData.costBasis || shortData.entryPrice || 0;
            const currentPrice = prices[ticker] || entryPrice;
            const pnl = (entryPrice - currentPrice) * shortData.shares;
            const pnlPct = entryPrice > 0 ? ((pnl / (entryPrice * shortData.shares)) * 100) : 0;
            return (
              <div key={ticker} className={`text-sm p-2 rounded ${darkMode ? 'bg-slate-700' : 'bg-slate-100'}`}>
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-red-400 font-semibold">{ticker}</span>
                    <span className={`ml-2 text-xs ${mutedClass}`}>{shortData.shares} shares short</span>
                  </div>
                  <span className={`font-bold ${pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {pnl >= 0 ? '+' : '-'}${Math.abs(pnl).toFixed(2)}
                  </span>
                </div>
                <div className={`text-xs ${mutedClass} mt-1`}>
                  Entry: ${entryPrice?.toFixed(2)} → Current: ${currentPrice.toFixed(2)} ({pnl >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%)
                </div>
                <div className={`text-xs ${mutedClass}`}>
                  Margin held: ${shortData.margin?.toFixed(2) || '0.00'}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    )}

    {/* Bets */}
    {Object.keys(selectedUser.bets).length > 0 && (
      <div>
        <h4 className={`text-xs font-semibold uppercase ${mutedClass} mb-2`}>Bets</h4>
        <div className="space-y-1 max-h-32 overflow-y-auto">
          {Object.entries(selectedUser.bets).map(([predId, bet]) => (
            <div key={predId} className={`text-sm ${textClass}`}>
              <div className="flex justify-between">
                <span className="font-mono text-xs">{predId}</span>
                <span className="text-teal-500">${bet.amount}</span>
              </div>
              <div className={`text-xs ${mutedClass}`}>
                {bet.option}
                {bet.paid && (
                  <span className={bet.payout > 0 ? 'text-green-500 ml-2' : 'text-red-400 ml-2'}>
                    {bet.payout > 0 ? `Won $${bet.payout.toFixed(2)}` : 'Lost'}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    )}

  </>
);

export default UserPositions;
