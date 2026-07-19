import { getThemeClasses } from '../../utils/theme';
import { formatCurrency } from '../../utils/formatters';
import { DIVIDEND_TIER_META, formatShares } from './shared';

// A single long-position row in the portfolio modal (collapsed summary + expanded
// stats / dividend info / sell controls).
const HoldingRow = ({
  item,
  isExpanded,
  onToggle,
  totalValue,
  sellAmounts,
  setSellAmounts,
  onSell,
  onLimitSell,
  drip = {},
  onToggleDrip,
  darkMode,
  colorBlindMode,
}) => {
  const { textClass, mutedClass } = getThemeClasses(darkMode);
  const diversityPercent = totalValue > 0 ? (item.value / totalValue) * 100 : 0;

  return (
    <div className={`rounded-sm border ${darkMode ? 'border-zinc-800 bg-zinc-900/50' : 'border-amber-200 bg-amber-50'}`}>
      {/* Main Row - Clickable */}
      <div
        className="p-3 cursor-pointer hover:bg-opacity-80"
        onClick={() => onToggle(item.ticker)}
      >
        <div className="flex justify-between items-center">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-orange-500 font-mono font-semibold">${item.ticker}</span>
              <span className={`text-sm ${mutedClass}`}>{item.character?.name}</span>
              {item.tierRate > 0 && (
                <span
                  className={`text-xs ${DIVIDEND_TIER_META[item.tier]?.color || 'text-zinc-400'}`}
                  title={`${DIVIDEND_TIER_META[item.tier]?.label}: pays ${(item.tierRate * 100).toFixed(2)}% weekly on eligible shares. Shares held longer pay more, up to 1.5x after 8 weeks.`}
                >
                  {DIVIDEND_TIER_META[item.tier]?.label}
                </span>
              )}
              <span className={`text-xs ${mutedClass}`}>
                {isExpanded ? '▼' : '▶'}
              </span>
            </div>
            <div className={`text-sm ${mutedClass} mt-0.5`}>
              {formatShares(item.shares)} shares • {diversityPercent.toFixed(1)}% of portfolio
            </div>
          </div>
          <div className="text-right">
            <div className={`font-semibold ${textClass}`}>{formatCurrency(item.value)}</div>
            <div className={`text-xs ${item.totalReturnPercent >= 0 ? (colorBlindMode ? 'text-teal-500' : 'text-green-500') : (colorBlindMode ? 'text-purple-500' : 'text-red-500')}`}>
              {item.totalReturnPercent >= 0 ? '▲' : '▼'} {formatCurrency(Math.abs(item.totalReturnDollar))} ({item.totalReturnPercent >= 0 ? '+' : ''}{item.totalReturnPercent.toFixed(2)}%)
            </div>
          </div>
        </div>
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className={`px-3 pb-3 border-t ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-3 mt-3 mb-3">
            <div className={`p-2 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-white'}`}>
              <div className={`text-xs ${mutedClass}`}>Avg Cost / Share</div>
              <div className={`font-semibold ${textClass}`}>{formatCurrency(item.avgCost)}</div>
            </div>
            <div className={`p-2 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-white'}`}>
              <div className={`text-xs ${mutedClass}`}>Current Price</div>
              <div className={`font-semibold ${textClass}`}>{formatCurrency(item.currentPrice)}</div>
            </div>
            <div className={`p-2 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-white'}`}>
              <div className={`text-xs ${mutedClass}`}>Today's Return</div>
              <div className={`font-semibold ${item.todayReturnDollar >= 0 ? (colorBlindMode ? 'text-teal-500' : 'text-green-500') : (colorBlindMode ? 'text-purple-500' : 'text-red-500')}`}>
                {item.todayReturnDollar >= 0 ? '+' : ''}{formatCurrency(item.todayReturnDollar)}
                <span className="text-xs ml-1">({item.todayReturnPercent >= 0 ? '+' : ''}{item.todayReturnPercent.toFixed(2)}%)</span>
              </div>
            </div>
            <div className={`p-2 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-white'}`}>
              <div className={`text-xs ${mutedClass}`}>Total Return</div>
              <div className={`font-semibold ${item.totalReturnDollar >= 0 ? (colorBlindMode ? 'text-teal-500' : 'text-green-500') : (colorBlindMode ? 'text-purple-500' : 'text-red-500')}`}>
                {item.totalReturnDollar >= 0 ? '+' : ''}{formatCurrency(item.totalReturnDollar)}
                <span className="text-xs ml-1">({item.totalReturnPercent >= 0 ? '+' : ''}{item.totalReturnPercent.toFixed(2)}%)</span>
              </div>
            </div>
          </div>

          {/* Portfolio Diversity Bar */}
          <div className="mb-3">
            <div className={`text-xs ${mutedClass} mb-1`}>Portfolio Weight: {diversityPercent.toFixed(1)}%</div>
            <div className={`h-2 rounded-full ${darkMode ? 'bg-zinc-800' : 'bg-zinc-200'}`}>
              <div
                className="h-full rounded-full bg-orange-500"
                style={{ width: `${Math.min(100, diversityPercent)}%` }}
              />
            </div>
          </div>

          {/* Dividend info */}
          {item.tierRate > 0 && (
            <div className={`mb-3 p-2 rounded-sm border ${darkMode ? 'border-zinc-800 bg-zinc-950' : 'border-amber-200 bg-white'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className={`text-xs ${mutedClass} mb-1`}>
                    {DIVIDEND_TIER_META[item.tier]?.label} tier: pays {(item.tierRate * 100).toFixed(2)}% weekly. Shares held longer pay more, up to 1.5x after 8 weeks.
                  </div>
                  <div className={`text-sm ${textClass}`}>
                    {formatShares(item.eligibleShares)} / {formatShares(item.shares)} shares eligible
                    {item.weeklyDividend > 0 && (
                      <span className={`ml-2 ${colorBlindMode ? 'text-teal-500' : 'text-green-500'}`}>
                        → ~{formatCurrency(item.weeklyDividend)} / week
                      </span>
                    )}
                  </div>
                  {item.eligibleShares < item.shares && item.soonestReadyMs && (
                    <div className={`text-xs ${mutedClass} mt-1`}>
                      Next {formatShares(item.shares - item.eligibleShares)} share(s) become eligible in {Math.ceil((item.soonestReadyMs - Date.now()) / (24 * 60 * 60 * 1000))} day(s)
                    </div>
                  )}
                </div>
                {onToggleDrip && (
                  <button
                    onClick={() => onToggleDrip(item.ticker)}
                    title={drip[item.ticker] ? 'DRIP on: dividends auto-buy more shares. Click to turn off.' : 'DRIP off: dividends pay as cash. Click to reinvest automatically.'}
                    className={`shrink-0 text-xs px-2 py-1 rounded font-semibold transition-colors ${
                      drip[item.ticker]
                        ? 'bg-emerald-600 text-white'
                        : darkMode ? 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600' : 'bg-zinc-200 text-zinc-500 hover:bg-zinc-300'
                    }`}
                  >
                    DRIP {drip[item.ticker] ? 'ON' : 'OFF'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Sell Controls */}
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0.01"
              step="0.01"
              max={item.shares}
              value={sellAmounts[item.ticker] === '' ? '' : (sellAmounts[item.ticker] || 1)}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '') {
                  setSellAmounts(prev => ({ ...prev, [item.ticker]: '' }));
                } else {
                  const num = Math.round(parseFloat(val) * 100) / 100 || 0;
                  setSellAmounts(prev => ({
                    ...prev,
                    [item.ticker]: Math.min(item.shares, Math.max(0, num))
                  }));
                }
              }}
              onBlur={() => {
                const current = sellAmounts[item.ticker];
                if (current === '' || current < 0.01) {
                  setSellAmounts(prev => ({ ...prev, [item.ticker]: 1 }));
                }
              }}
              onClick={(e) => e.stopPropagation()}
              className={`w-20 px-2 py-1 text-sm text-center rounded-sm border ${
                darkMode ? 'bg-zinc-950 border-zinc-700 text-zinc-100' : 'bg-white border-amber-200'
              }`}
            />
            <button
              onClick={(e) => { e.stopPropagation(); onSell(item.ticker, Math.max(0.01, sellAmounts[item.ticker] || 1)); }}
              className="px-4 py-1.5 text-xs font-semibold uppercase bg-red-600 hover:bg-red-700 text-white rounded-sm"
            >
              Sell
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onSell(item.ticker, item.shares); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-sm ${
                darkMode ? 'bg-zinc-800 text-zinc-300 hover:bg-slate-600' : 'bg-slate-200 text-zinc-600 hover:bg-slate-300'
              }`}
            >
              Sell All
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onLimitSell && onLimitSell(item.ticker, 'sell'); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-sm border ${
                darkMode ? 'border-red-600 text-red-400 hover:bg-red-950' : 'border-red-600 text-red-600 hover:bg-red-50'
              }`}
            >
              Limit Sell
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onLimitSell && onLimitSell(item.ticker, 'sell', 'stopLoss'); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-sm border ${
                darkMode ? 'border-orange-600 text-orange-400 hover:bg-orange-950' : 'border-orange-600 text-orange-500 hover:bg-orange-50'
              }`}
            >
              Stop Loss
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default HoldingRow;
