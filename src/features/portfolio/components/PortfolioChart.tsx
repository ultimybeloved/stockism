import ValueLineChart from '../../../shared/components/charts/ValueLineChart';
import type { PortfolioChartPoint } from '../hooks/usePortfolioChartData';
import type { ChartHoverPoint, TimeRange } from '../utils/shared';

interface PortfolioChartProps {
  chartData: PortfolioChartPoint[];
  minValue: number;
  maxValue: number;
  valueRange: number;
  isUp: boolean;
  hoveredPoint: ChartHoverPoint | null;
  setHoveredPoint: (point: ChartHoverPoint | null) => void;
  showChart: boolean;
  setShowChart: (show: boolean) => void;
  loadingHistory: boolean;
  timeRange: string;
  setTimeRange: (key: string) => void;
  timeRanges: TimeRange[];
  colorBlindMode: boolean;
}

// The collapsible portfolio value chart (time-range buttons + interactive SVG).
// Presentational: receives the prepared chartData and derived bounds and hands
// them to ValueLineChart. hoveredPoint is lifted to the parent so the header value
// can reflect the hovered point.
const PortfolioChart = ({
  chartData,
  minValue,
  maxValue,
  valueRange,
  isUp,
  hoveredPoint,
  setHoveredPoint,
  showChart,
  setShowChart,
  loadingHistory,
  timeRange,
  setTimeRange,
  timeRanges,
  colorBlindMode,
}: PortfolioChartProps) => {
  return (
    <div className="border-b light:border-amber-200 dark:border-zinc-800">
      <div className="flex items-center justify-between px-4 py-2">
        <button
          onClick={() => setShowChart(!showChart)}
          className="text-xs font-semibold light:text-zinc-500 dark:text-zinc-500 hover:text-orange-500"
        >
          {showChart ? '▼ Hide Chart' : '▶ Show Chart'}
        </button>
        {showChart && (
          <div className="flex gap-1">
            {timeRanges.map((range) => (
              <button
                key={range.key}
                onClick={() => setTimeRange(range.key)}
                className={`px-2 py-1 text-xs font-semibold rounded-sm ${
                  timeRange === range.key
                    ? 'bg-orange-600 text-white'
                    : 'light:text-zinc-600 light:hover:bg-slate-200 dark:text-zinc-400 dark:hover:bg-zinc-800'
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {showChart && loadingHistory && (
        <div className="px-4 pb-4 light:bg-amber-50 dark:bg-zinc-950/50 h-32 flex items-center justify-center">
          <span className="text-xs light:text-zinc-500 dark:text-zinc-500">Loading...</span>
        </div>
      )}

      {showChart && !loadingHistory && (
        <ValueLineChart
          data={chartData}
          minValue={minValue}
          maxValue={maxValue}
          valueRange={valueRange}
          isUp={isUp}
          colorBlindMode={colorBlindMode}
          hoveredPoint={hoveredPoint}
          setHoveredPoint={setHoveredPoint}
          className="px-4 pb-4 light:bg-amber-50 dark:bg-zinc-950/50 relative"
        />
      )}
    </div>
  );
};

export default PortfolioChart;
