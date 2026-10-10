import { useState, useMemo } from 'react';
import { formatCurrency, formatChange } from '../../../utils/formatters';
import { themeClasses } from '../../../utils/theme';
import type { PortfolioPoint } from '../../portfolio/hooks/usePortfolioHistory';
import ValueLineChart from '../../../shared/components/charts/ValueLineChart';
import {
  formatChartDate,
  sampleSeries,
  summarizeSeries,
  type ChartHoverPoint,
} from '../../../shared/components/charts/valueSeries';

interface ProfileChartPoint {
  timestamp: number;
  value: number;
  fullDate: string;
}

interface ProfileChartProps {
  portfolioValue: number;
  portfolioHistory: PortfolioPoint[];
  colorBlindMode: boolean;
  timeRange: string;
  onTimeRangeChange: (key: string) => void;
}

// Keys must match shared TIME_RANGES so the page can fetch history per range.
const TIME_RANGES = [
  { key: '1d', label: '24h', hours: 24 },
  { key: '7d', label: '7D', hours: 168 },
  { key: '1m', label: '1M', hours: 720 },
  { key: 'all', label: 'All', hours: Infinity },
];

// The "Portfolio Value" chart card on the profile page. Range selection is
// controlled by the parent so it can fetch only the history the range needs.
const ProfileChart = ({
  portfolioValue,
  portfolioHistory,
  colorBlindMode,
  timeRange,
  onTimeRangeChange,
}: ProfileChartProps) => {
  const chartTimeRange = timeRange;
  const [hoveredPoint, setHoveredPoint] = useState<ChartHoverPoint | null>(null);
  const { textClass } = themeClasses;

  const chartData = useMemo((): ProfileChartPoint[] => {
    if (!portfolioHistory || portfolioHistory.length === 0) {
      const now = Date.now();
      return [
        { timestamp: now - 60000, value: portfolioValue, fullDate: 'Now' },
        { timestamp: now, value: portfolioValue, fullDate: 'Now' },
      ];
    }
    // History arrives already bounded to the selected range (fetched per range
    // by the parent), so no client-side cutoff filter is needed.
    let data: ProfileChartPoint[] = portfolioHistory.map((point) => ({
      ...point,
      fullDate: formatChartDate(point.timestamp),
    }));
    data = sampleSeries(data);
    if (data.length === 1) data = [...data, { timestamp: Date.now(), value: portfolioValue, fullDate: 'Now' }];
    if (data.length === 0) {
      const now = Date.now();
      data = [
        { timestamp: now - 60000, value: portfolioValue, fullDate: 'Now' },
        { timestamp: now, value: portfolioValue, fullDate: 'Now' },
      ];
    }
    return data;
    // chartTimeRange isn't read here — the parent refetches portfolioHistory per range.
  }, [portfolioHistory, portfolioValue]);

  const { minValue, maxValue, valueRange, periodChange, isUp: chartIsUp } = summarizeSeries(chartData, portfolioValue);

  return (
    <div className="p-4 rounded-sm border light:bg-amber-50 light:border-amber-200 dark:bg-zinc-800/50 dark:border-zinc-700">
      <div className="flex justify-between items-center mb-2">
        <div>
          <h3 className={`font-semibold ${textClass}`}>Portfolio Value</h3>
          <div className="flex items-baseline gap-2">
            <span className={`text-xl font-bold ${textClass}`}>
              {formatCurrency(hoveredPoint?.value ?? portfolioValue)}
            </span>
            <span
              className={`text-sm font-semibold ${colorBlindMode ? (chartIsUp ? 'text-teal-500' : 'text-purple-500') : chartIsUp ? 'text-green-500' : 'text-red-500'}`}
            >
              {chartIsUp ? '▲' : '▼'} {formatChange(periodChange)}
            </span>
          </div>
        </div>
        <div className="flex gap-1">
          {TIME_RANGES.map((range) => (
            <button
              key={range.key}
              onClick={() => onTimeRangeChange(range.key)}
              className={`px-2 py-1 text-xs font-semibold rounded-sm ${
                chartTimeRange === range.key
                  ? 'bg-orange-600 text-white'
                  : 'light:text-zinc-600 light:hover:bg-slate-200 dark:text-zinc-400 dark:hover:bg-zinc-700'
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>
      <ValueLineChart
        data={chartData}
        minValue={minValue}
        maxValue={maxValue}
        valueRange={valueRange}
        isUp={chartIsUp}
        colorBlindMode={colorBlindMode}
        hoveredPoint={hoveredPoint}
        setHoveredPoint={setHoveredPoint}
        className="relative"
      />
    </div>
  );
};

export default ProfileChart;
