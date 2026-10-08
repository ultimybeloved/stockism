import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import SimpleLineChart from './charts/SimpleLineChart';
import IndexChartModal, { type IndexHoverPoint } from './marketIndex/IndexChartModal';
import { useIndexHistory } from '../hooks/useIndexHistory';
import { getThemeClasses } from '../utils/theme';
import { nonETFCharacters, TIME_RANGES, computeIndex, buildIndexSeries } from '../utils/marketIndex';
import type { PriceHistory, PriceMap } from '../types';

interface MarketIndexProps {
  prices: PriceMap;
  priceHistory: PriceHistory;
  darkMode: boolean;
  colorBlindMode?: boolean;
}

const MarketIndex = ({ prices, priceHistory, darkMode, colorBlindMode = false }: MarketIndexProps) => {
  const [expanded, setExpanded] = useState(false);
  const [timeRange, setTimeRange] = useState('7d');
  const [hoveredPoint, setHoveredPoint] = useState<IndexHoverPoint | null>(null);

  const { cardClass } = getThemeClasses(darkMode);
  const { index30dAgo, divisor } = useIndexHistory();

  const currentIndex = useMemo(() => computeIndex(prices, nonETFCharacters, divisor), [prices, divisor]);

  // 24h sparkline data
  const { change24h, changePct24h, sparklineData } = useMemo(() => {
    const points = buildIndexSeries(priceHistory, currentIndex, 24, divisor);
    if (points.length === 0) return { change24h: 0, changePct24h: 0, sparklineData: [] };
    const idx24hAgo = points[0]!.price;
    const change = currentIndex - idx24hAgo;
    const pct = idx24hAgo !== 0 ? (change / idx24hAgo) * 100 : 0;
    return { change24h: change, changePct24h: pct, sparklineData: points };
  }, [priceHistory, currentIndex, divisor]);

  // Expanded chart data
  const chartData = useMemo(() => {
    if (!expanded) return [];
    const range = TIME_RANGES.find((r) => r.key === timeRange) ?? TIME_RANGES[0]!;
    return buildIndexSeries(priceHistory, currentIndex, range.hours, divisor);
  }, [expanded, timeRange, priceHistory, currentIndex, divisor]);

  const isUp = change24h >= 0;
  const upColor = colorBlindMode ? 'text-teal-400' : 'text-green-500';
  const downColor = colorBlindMode ? 'text-purple-400' : 'text-red-500';
  const changeColor = isUp ? upColor : downColor;
  const change30dPct =
    index30dAgo != null && index30dAgo > 0 ? ((currentIndex - index30dAgo) / index30dAgo) * 100 : null;
  const thirtyIsUp = (change30dPct ?? 0) >= 0;
  const thirtyColor = thirtyIsUp ? upColor : downColor;

  return (
    <>
      {/* Banner card */}
      <div
        className={`${cardClass} border rounded-sm p-4 mb-4 cursor-pointer hover:border-orange-600 transition-colors`}
        onClick={() => setExpanded(true)}
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div
              className={`text-xs font-semibold tracking-wider mb-1 ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}
            >
              STOCKISM MARKET INDEX
            </div>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-zinc-900'}`}>
                {currentIndex.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className={`text-sm font-semibold ${changeColor}`}>
                {isUp ? '\u25B2' : '\u25BC'} {isUp ? '+' : ''}
                {change24h.toFixed(2)} ({isUp ? '+' : ''}
                {changePct24h.toFixed(2)}%) 24h
              </span>
            </div>
            {change30dPct != null && (
              <div className={`text-xs mt-0.5 ${thirtyColor}`}>
                {thirtyIsUp ? '\u2191' : '\u2193'} {Math.abs(change30dPct).toFixed(2)}% 30d
              </div>
            )}
          </div>
          {sparklineData.length >= 2 && (
            <div className="w-full sm:w-40 h-10 flex-shrink-0">
              <SimpleLineChart data={sparklineData} colorBlindMode={colorBlindMode} width={160} height={40} />
            </div>
          )}
        </div>
      </div>

      {/* Expanded chart modal — portaled to body so the sticky sidebar's
          stacking context can't layer it under the market column */}
      {expanded &&
        createPortal(
          <IndexChartModal
            chartData={chartData}
            currentIndex={currentIndex}
            timeRange={timeRange}
            setTimeRange={setTimeRange}
            hoveredPoint={hoveredPoint}
            setHoveredPoint={setHoveredPoint}
            darkMode={darkMode}
            colorBlindMode={colorBlindMode}
            onClose={() => {
              setExpanded(false);
              setHoveredPoint(null);
            }}
          />,
          document.body,
        )}
    </>
  );
};

export default MarketIndex;
