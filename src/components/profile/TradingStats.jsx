import { formatCurrency } from '../../utils/formatters';
import { calculatePortfolioValue } from '../../utils/calculations';
import { getThemeClasses } from '../../utils/theme';

// Stats summary (trades / predictions / bets) and the trading-stats breakdown.
// Computes its own biggest / best / worst / most-shares holdings.
const TradingStats = ({ userData, holdings, shorts, prices, costBasis, predictionWins, betsPlaced, darkMode }) => {
  const { textClass, mutedClass } = getThemeClasses(darkMode);

  const joinDate = userData?.createdAt?.toDate?.() || null;
  // The stored peak only updates on backend sync, so never show it below the
  // live current value — a "peak" under the current number reads as broken.
  const peakPortfolio = Math.max(
    userData?.peakPortfolioValue || 1000,
    calculatePortfolioValue(userData, prices || {})
  );

  // Find biggest holding by value
  let biggestHolding = null;
  let biggestValue = 0;
  Object.entries(holdings || {}).forEach(([ticker, shares]) => {
    if (shares > 0) {
      const currentPrice = prices[ticker] || 0;
      const value = shares * currentPrice;
      if (value > biggestValue) {
        biggestValue = value;
        biggestHolding = { ticker, shares, value };
      }
    }
  });

  // Find best and worst performing stocks
  let bestStock = null;
  let worstStock = null;
  let bestReturn = -Infinity;
  let worstReturn = Infinity;

  Object.entries(holdings || {}).forEach(([ticker, shares]) => {
    if (shares > 0) {
      const currentPrice = prices[ticker] || 0;
      const avgCost = costBasis[ticker] || currentPrice;
      const returnPercent = avgCost > 0 ? ((currentPrice - avgCost) / avgCost) * 100 : 0;

      if (returnPercent > bestReturn) {
        bestReturn = returnPercent;
        bestStock = { ticker, returnPercent, currentPrice, avgCost, shares };
      }
      if (returnPercent < worstReturn) {
        worstReturn = returnPercent;
        worstStock = { ticker, returnPercent, currentPrice, avgCost, shares };
      }
    }
  });

  // Find most shares held
  let mostShares = null;
  let maxShares = 0;
  Object.entries(holdings || {}).forEach(([ticker, shares]) => {
    if (shares > maxShares) {
      maxShares = shares;
      mostShares = { ticker, shares };
    }
  });

  return (
    <>
      {/* Stats Summary */}
      <div className={`p-4 rounded-sm ${darkMode ? 'bg-zinc-800/50' : 'bg-amber-50'}`}>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className={`text-2xl font-bold text-orange-500`}>{userData?.totalTrades || 0}</p>
            <p className={`text-xs ${mutedClass}`}>Total Trades</p>
          </div>
          <div>
            <p className={`text-2xl font-bold text-orange-500`}>{predictionWins}</p>
            <p className={`text-xs ${mutedClass}`}>Correct Predictions</p>
          </div>
          <div>
            <p className={`text-2xl font-bold ${textClass}`}>{betsPlaced}</p>
            <p className={`text-xs ${mutedClass}`}>Bets Placed</p>
          </div>
        </div>
      </div>

      {/* Trading Stats */}
      <div className={`p-4 rounded-sm border ${darkMode ? 'bg-zinc-800/50 border-zinc-700' : 'bg-amber-50 border-amber-200'}`}>
        <h3 className={`font-semibold ${textClass} mb-3`}>📊 Trading Stats</h3>
        <div className="space-y-2 text-sm">
          {joinDate && (
            <div className="flex justify-between">
              <span className={mutedClass}>Joined:</span>
              <span className={textClass}>{joinDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className={mutedClass}>Peak Portfolio:</span>
            <span className={`font-semibold ${textClass}`}>{formatCurrency(peakPortfolio)}</span>
          </div>
          {biggestHolding && (
            <div className="flex justify-between">
              <span className={mutedClass}>Biggest Holding:</span>
              <span className={`font-semibold ${textClass}`}>
                ${biggestHolding.ticker} ({biggestHolding.shares} shares, {formatCurrency(biggestValue)})
              </span>
            </div>
          )}
          {mostShares && mostShares.shares > 0 && (
            <div className="flex justify-between">
              <span className={mutedClass}>Most Shares:</span>
              <span className={`font-semibold ${textClass}`}>
                ${mostShares.ticker} ({mostShares.shares} shares)
              </span>
            </div>
          )}
          {bestStock && bestStock.returnPercent !== 0 && (
            <div className="flex justify-between">
              <span className={mutedClass}>Best Performer:</span>
              <span className={`font-semibold ${bestStock.returnPercent >= 0 ? (userData?.colorBlindMode ? 'text-teal-500' : 'text-green-500') : (userData?.colorBlindMode ? 'text-purple-500' : 'text-red-500')}`}>
                ${bestStock.ticker} ({bestStock.returnPercent >= 0 ? '+' : ''}{bestStock.returnPercent.toFixed(1)}%)
              </span>
            </div>
          )}
          {worstStock && worstStock.returnPercent !== 0 && worstStock.ticker !== bestStock?.ticker && (
            <div className="flex justify-between">
              <span className={mutedClass}>Worst Performer:</span>
              <span className={`font-semibold ${worstStock.returnPercent >= 0 ? (userData?.colorBlindMode ? 'text-teal-500' : 'text-green-500') : (userData?.colorBlindMode ? 'text-purple-500' : 'text-red-500')}`}>
                ${worstStock.ticker} ({worstStock.returnPercent >= 0 ? '+' : ''}{worstStock.returnPercent.toFixed(1)}%)
              </span>
            </div>
          )}
          {Object.keys(holdings || {}).length === 0 && Object.keys(shorts || {}).length === 0 && (
            <p className={`text-xs ${mutedClass} text-center py-2`}>No active positions yet</p>
          )}
        </div>
      </div>
    </>
  );
};

export default TradingStats;
