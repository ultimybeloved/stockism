import { getThemeClasses } from '../../utils/theme';
import { formatCurrency } from '../../utils/formatters';
import { formatShares } from './shared';
import { SHORT_MARGIN_CALL_THRESHOLD, SHORT_MARGIN_WARNING_THRESHOLD } from '../../constants/economy';

// A single short-position row in the portfolio modal (collapsed summary + expanded
// stats / equity ratio / cover controls).
const ShortRow = ({
  item,
  isExpanded,
  onToggle,
  coverAmounts,
  setCoverAmounts,
  onCover,
  darkMode,
  colorBlindMode,
}) => {
  const { textClass, mutedClass } = getThemeClasses(darkMode);
  const isAtRisk = item.equityRatio < SHORT_MARGIN_WARNING_THRESHOLD;
  const liqPrice = item.liquidationPrice;
  const pctToLiq = liqPrice && item.currentPrice > 0 ? ((liqPrice - item.currentPrice) / item.currentPrice) * 100 : null;

  return (
    <div className={`rounded-sm border ${
      isAtRisk
        ? 'border-orange-500 bg-orange-500/10'
        : darkMode ? 'border-zinc-800 bg-zinc-900/50' : 'border-amber-200 bg-amber-50'
    }`}>
      {/* Main Row - Clickable */}
      <div
        className="p-3 cursor-pointer hover:bg-opacity-80"
        onClick={() => onToggle(item.ticker)}
      >
        <div className="flex justify-between items-center">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-orange-500 font-mono font-semibold">${item.ticker}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded ${darkMode ? 'bg-orange-900/50 text-orange-400' : 'bg-orange-100 text-orange-500'}`}>SHORT</span>
              <span className={`text-sm ${mutedClass}`}>{item.character?.name}</span>
              <span className={`text-xs ${mutedClass}`}>
                {isExpanded ? '▼' : '▶'}
              </span>
            </div>
            <div className={`text-sm ${mutedClass} mt-0.5`}>
              {formatShares(item.shares)} shares shorted
              {isAtRisk && <span className="text-orange-500 ml-2">⚠️ Margin Warning</span>}
            </div>
            {liqPrice && (
              <div className={`text-xs mt-0.5 ${isAtRisk ? 'text-orange-500 font-semibold' : mutedClass}`}>
                Force-cover if it hits {formatCurrency(liqPrice)}{pctToLiq != null && pctToLiq > 0 ? ` (${pctToLiq.toFixed(0)}% above current)` : ''}
              </div>
            )}
          </div>
          <div className="text-right">
            <div className={`font-semibold ${item.totalPL >= 0 ? (colorBlindMode ? 'text-teal-500' : 'text-green-500') : (colorBlindMode ? 'text-purple-500' : 'text-red-500')}`}>
              {item.totalPL >= 0 ? '+' : ''}{formatCurrency(item.totalPL)}
            </div>
            <div className={`text-xs ${item.totalPL >= 0 ? (colorBlindMode ? 'text-teal-500' : 'text-green-500') : (colorBlindMode ? 'text-purple-500' : 'text-red-500')}`}>
              {item.totalPL >= 0 ? '▲' : '▼'} {Math.abs(item.totalPLPercent).toFixed(2)}%
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
              <div className={`text-xs ${mutedClass}`}>Entry Price</div>
              <div className={`font-semibold ${textClass}`}>{formatCurrency(item.entryPrice)}</div>
            </div>
            <div className={`p-2 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-white'}`}>
              <div className={`text-xs ${mutedClass}`}>Current Price</div>
              <div className={`font-semibold ${textClass}`}>{formatCurrency(item.currentPrice)}</div>
            </div>
            <div className={`p-2 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-white'}`}>
              <div className={`text-xs ${mutedClass}`}>Margin Posted</div>
              <div className={`font-semibold ${textClass}`}>{formatCurrency(item.margin)}</div>
            </div>
            <div className={`p-2 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-white'}`}>
              <div className={`text-xs ${mutedClass}`}>Current Equity</div>
              <div className={`font-semibold ${item.equity >= item.margin ? (colorBlindMode ? 'text-teal-500' : 'text-green-500') : (colorBlindMode ? 'text-purple-500' : 'text-red-500')}`}>
                {formatCurrency(item.equity)}
              </div>
            </div>
          </div>

          {/* Equity Ratio Bar */}
          <div className="mb-3">
            <div className={`text-xs ${mutedClass} mb-1 flex justify-between`}>
              <span>Equity Ratio: {(item.equityRatio * 100).toFixed(1)}%</span>
              <span className={isAtRisk ? 'text-orange-500' : (colorBlindMode ? 'text-teal-500' : 'text-green-500')}>
                {liqPrice ? `Force-cover at ${formatCurrency(liqPrice)}` : 'Healthy'}
              </span>
            </div>
            <div className={`h-2 rounded-full ${darkMode ? 'bg-zinc-800' : 'bg-zinc-200'}`}>
              <div
                className={`h-full rounded-full ${
                  item.equityRatio < SHORT_MARGIN_CALL_THRESHOLD ? (colorBlindMode ? 'bg-purple-500' : 'bg-red-500') :
                  item.equityRatio < SHORT_MARGIN_WARNING_THRESHOLD ? 'bg-orange-500' : (colorBlindMode ? 'bg-teal-500' : 'bg-green-500')
                }`}
                style={{ width: `${Math.min(100, Math.max(0, item.equityRatio * 100))}%` }}
              />
            </div>
          </div>

          {/* Cover Controls */}
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="1"
              max={item.shares}
              value={coverAmounts[item.ticker] === '' ? '' : (coverAmounts[item.ticker] || 1)}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '') {
                  setCoverAmounts(prev => ({ ...prev, [item.ticker]: '' }));
                } else {
                  const num = parseInt(val) || 0;
                  setCoverAmounts(prev => ({
                    ...prev,
                    [item.ticker]: Math.min(item.shares, Math.max(0, num))
                  }));
                }
              }}
              onBlur={() => {
                const current = coverAmounts[item.ticker];
                if (current === '' || current < 1) {
                  setCoverAmounts(prev => ({ ...prev, [item.ticker]: 1 }));
                }
              }}
              onClick={(e) => e.stopPropagation()}
              className={`w-20 px-2 py-1 text-sm text-center rounded-sm border ${
                darkMode ? 'bg-zinc-950 border-zinc-700 text-zinc-100' : 'bg-white border-amber-200'
              }`}
            />
            <button
              onClick={(e) => { e.stopPropagation(); onCover(item.ticker, Math.max(1, coverAmounts[item.ticker] || 1)); }}
              className="px-4 py-1.5 text-xs font-semibold uppercase bg-green-600 hover:bg-green-700 text-white rounded-sm"
            >
              Cover
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onCover(item.ticker, item.shares); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-sm ${
                darkMode ? 'bg-zinc-800 text-zinc-300 hover:bg-slate-600' : 'bg-slate-200 text-zinc-600 hover:bg-slate-300'
              }`}
            >
              Cover All
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ShortRow;
