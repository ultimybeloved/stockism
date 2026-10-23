import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import SimpleLineChart from '../../../shared/components/charts/SimpleLineChart';
import IndexChartModal, { type IndexHoverPoint } from './IndexChartModal';
import { useIndexHistory } from '../hooks/useIndexHistory';
import { themeClasses } from '../../../utils/theme';
import { nonETFCharacters, TIME_RANGES, computeIndex, buildIndexSeries } from '../../../utils/marketIndex';
import type { PriceHistory, PriceMap } from '../../../types';
import { pressable } from '../../../utils/a11y';

interface MarketIndexProps {
  prices: PriceMap;
  priceHistory: PriceHistory;
  colorBlindMode?: boolean;
}

const MarketIndex = ({ prices, priceHistory, colorBlindMode = false }: MarketIndexProps) => {
  const [expanded, setExpanded] = useState(false);
  const [timeRange, setTimeRange] = useState('7d');
  const [hoveredPoint, setHoveredPoint] = useState<IndexHoverPoint | null>(null);

  const { cardClass } = themeClasses;
  const { index30dAgo, divisor, recorded } = useIndexHistory();

  const currentIndex = useMemo(() => computeIndex(prices, nonETFCharacters, divisor), [prices, divisor]);

  // 24h sparkline data
  const { change24h, changePct24h, sparklineData } = useMemo(() => {
    const points = buildIndexSeries(priceHistory, currentIndex, 24, divisor, recorded);
    if (points.length === 0) return { change24h: 0, changePct24h: 0, sparklineData: [] };
    const idx24hAgo = points[0]!.price;
    const change = currentIndex - idx24hAgo;
    const pct = idx24hAgo !== 0 ? (change / idx24hAgo) * 100 : 0;
    return { change24h: change, changePct24h: pct, sparklineData: points };
  }, [priceHistory, currentIndex, divisor, recorded]);

  // Expanded chart data
  const chartData = useMemo(() => {
    if (!expanded) return [];
    const range = TIME_RANGES.find((r) => r.key === timeRange) ?? TIME_RANGES[0]!;
    return buildIndexSeries(priceHistory, currentIndex, range.hours, divisor, recorded);
  }, [expanded, timeRange, priceHistory, currentIndex, divisor, recorded]);

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
      {/* Small card: the one market-wide number. Click for the full chart. */}
      <div
        className={`${cardClass} border rounded-sm px-4 py-3 mb-4 cursor-pointer hover:border-orange-600 transition-colors flex items-center gap-4`}
        {...pressable(() => setExpanded(true))}
      >
        <div className="min-w-0">
          <div className="text-[10px] font-semibold tracking-wider light:text-zinc-500 dark:text-zinc-400">
            MARKET INDEX
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold tabular-nums light:text-zinc-900 dark:text-white">
              {currentIndex.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className={`text-xs font-semibold tabular-nums ${changeColor}`}>
              {isUp ? '▲' : '▼'} {isUp ? '+' : ''}
              {changePct24h.toFixed(2)}%
            </span>
            {change30dPct != null && (
              <span className={`text-[11px] tabular-nums ${thirtyColor}`}>
                {thirtyIsUp ? '+' : ''}
                {change30dPct.toFixed(1)}% 30d
              </span>
            )}
          </div>
        </div>
        {sparklineData.length >= 2 && (
          <div className="ml-auto w-24 shrink-0">
            <SimpleLineChart data={sparklineData} colorBlindMode={colorBlindMode} width={96} height={32} />
          </div>
        )}
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
