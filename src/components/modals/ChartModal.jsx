import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatCurrency, formatChange } from '../../utils/formatters';
import { getThemeClasses } from '../../utils/theme';
import { useAppContext } from '../../context/AppContext';
import PriceChart, { TIME_RANGES } from '../PriceChart';
import { usePriceHistory } from '../../hooks/usePriceHistory';
import { useEscapeKey } from '../../hooks/useEscapeKey';

const ChartModal = ({ character, currentPrice, onClose, defaultTimeRange = '1d' }) => {
  useEscapeKey(onClose);
  const { darkMode, userData } = useAppContext();
  const colorBlindMode = userData?.colorBlindMode || false;
  const [timeRange, setTimeRange] = useState(defaultTimeRange);
  const [hoveredChartPoint, setHoveredChartPoint] = useState(null);
  const { fullHistory } = usePriceHistory(character.ticker);

  const getColors = (isPositive) => ({
    text: colorBlindMode
      ? (isPositive ? 'text-teal-500' : 'text-purple-500')
      : (isPositive ? 'text-green-500' : 'text-red-500')
  });

  const range = TIME_RANGES.find(r => r.key === timeRange);
  const cutoff = range.hours === Infinity ? 0 : Date.now() - range.hours * 3600000;
  const filtered = fullHistory.filter(p => p.timestamp >= cutoff);
  const firstPrice = filtered[0]?.price || (fullHistory.length > 0 ? fullHistory[0].price : currentPrice);
  const lastPrice = filtered.length > 0 ? filtered[filtered.length - 1].price : currentPrice;
  const periodChange = firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;
  const isUp = lastPrice >= firstPrice;

  const { textClass, mutedClass, bgClass, overlayClass, modalShellClass, cardEdgeClass } = getThemeClasses(darkMode);

  return (
    <div className={`${overlayClass} z-50`} onClick={onClose}>
      <div
        className={`${modalShellClass} max-w-3xl overflow-hidden`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`p-4 border-b ${cardEdgeClass}`}>
          <div className="flex justify-between items-start">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-orange-500 font-mono text-lg font-semibold">${character.ticker}</span>
                <span className={`text-sm ${mutedClass}`}>{character.name}</span>
                <Link
                  to={`/stock/${character.ticker}`}
                  onClick={onClose}
                  className={`text-xs ${mutedClass} hover:text-orange-500 underline underline-offset-2`}
                >
                  Full page ↗
                </Link>
              </div>
              <div className="flex items-baseline gap-3 mt-1">
                <span className={`text-2xl font-bold ${textClass}`}>
                  {formatCurrency(hoveredChartPoint ? hoveredChartPoint.price : currentPrice)}
                </span>
                {hoveredChartPoint ? (() => {
                  const hChange = firstPrice > 0 ? ((hoveredChartPoint.price - firstPrice) / firstPrice) * 100 : 0;
                  const hUp = hChange >= 0;
                  return (
                    <span className={`text-sm font-semibold ${getColors(hUp).text}`}>
                      {hUp ? '▲' : '▼'} {formatChange(hChange)} ({range?.label})
                    </span>
                  );
                })() : (
                  <span className={`text-sm font-semibold ${getColors(isUp).text}`}>
                    {isUp ? '▲' : '▼'} {formatChange(periodChange)} ({range?.label})
                  </span>
                )}
              </div>
            </div>
            <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-500 text-xl`}>×</button>
          </div>
        </div>

        {/* Time Range Selector */}
        <div className={`px-4 py-2 border-b ${cardEdgeClass} ${darkMode ? 'bg-zinc-900/50' : 'bg-amber-50'}`}>
          <div className="flex gap-1">
            {TIME_RANGES.map(r => (
              <button
                key={r.key}
                onClick={() => setTimeRange(r.key)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-sm transition-colors ${
                  timeRange === r.key
                    ? 'bg-orange-600 text-white'
                    : darkMode ? 'text-zinc-400 hover:bg-zinc-800' : 'text-zinc-600 hover:bg-slate-200'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* Chart */}
        <div className={`p-4 ${bgClass}`}>
          <PriceChart
            ticker={character.ticker}
            basePrice={character.basePrice}
            currentPrice={currentPrice}
            timeRange={timeRange}
            chartType="area"
            onHover={setHoveredChartPoint}
          />
        </div>

        {/* Stats Footer */}
        <div className={`p-4 border-t ${cardEdgeClass}`}>
          <div className="grid grid-cols-4 gap-4 text-center">
            <div>
              <div className={`text-xs ${mutedClass} uppercase`}>Open</div>
              <div className={`font-semibold ${textClass}`}>{formatCurrency(firstPrice)}</div>
            </div>
            <div>
              <div className={`text-xs ${mutedClass} uppercase`}>High</div>
              <div className={`font-semibold ${colorBlindMode ? 'text-teal-500' : 'text-green-500'}`}>
                {formatCurrency(Math.max(...(filtered.length > 0 ? filtered : [{ price: currentPrice }]).map(p => p.price)))}
              </div>
            </div>
            <div>
              <div className={`text-xs ${mutedClass} uppercase`}>Low</div>
              <div className={`font-semibold ${colorBlindMode ? 'text-purple-500' : 'text-red-500'}`}>
                {formatCurrency(Math.min(...(filtered.length > 0 ? filtered : [{ price: currentPrice }]).map(p => p.price)))}
              </div>
            </div>
            <div>
              <div className={`text-xs ${mutedClass} uppercase`}>Current</div>
              <div className={`font-semibold ${textClass}`}>{formatCurrency(currentPrice)}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChartModal;
