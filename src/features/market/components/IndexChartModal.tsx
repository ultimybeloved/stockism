import { getThemeClasses } from '../../../utils/theme';
import { TIME_RANGES } from '../../../utils/marketIndex';

export interface IndexPoint {
  timestamp: number;
  price: number;
}

export interface IndexHoverPoint {
  price: number;
  x: number;
  y: number;
  fullDate: string;
}

interface IndexChartModalProps {
  chartData: IndexPoint[];
  currentIndex: number;
  timeRange: string;
  setTimeRange: (key: string) => void;
  hoveredPoint: IndexHoverPoint | null;
  setHoveredPoint: (point: IndexHoverPoint | null) => void;
  darkMode: boolean;
  colorBlindMode: boolean;
  onClose: () => void;
}

// The market index's full chart: range picker, area chart, and hover readout.
const IndexChartModal = ({
  chartData,
  currentIndex,
  timeRange,
  setTimeRange,
  hoveredPoint,
  setHoveredPoint,
  darkMode,
  colorBlindMode,
  onClose,
}: IndexChartModalProps) => {
  const { textClass, mutedClass, bgClass, overlayClass, modalShellClass, cardEdgeClass } = getThemeClasses(darkMode);

  if (chartData.length < 2) return null;

  const indexValues = chartData.map((d) => d.price);
  const minVal = Math.min(...indexValues);
  const maxVal = Math.max(...indexValues);
  const valRange = maxVal - minVal || 1;

  // Two or more points from here on (checked above).
  const firstVal = chartData[0]!.price;
  const lastVal = chartData[chartData.length - 1]!.price;
  const periodChange = firstVal > 0 ? ((lastVal - firstVal) / firstVal) * 100 : 0;
  const isUp = lastVal >= firstVal;

  const strokeColor = colorBlindMode ? (isUp ? '#14b8a6' : '#a855f7') : isUp ? '#22c55e' : '#ef4444';
  const fillColor = colorBlindMode
    ? isUp
      ? 'rgba(20, 184, 166, 0.1)'
      : 'rgba(168, 85, 247, 0.1)'
    : isUp
      ? 'rgba(34, 197, 94, 0.1)'
      : 'rgba(239, 68, 68, 0.1)';

  const svgWidth = 600;
  const svgHeight = 300;
  const paddingX = 50;
  const paddingY = 30;
  const chartWidth = svgWidth - paddingX * 2;
  const chartHeight = svgHeight - paddingY * 2;

  const firstTs = chartData[0]!.timestamp;
  const lastTs = chartData[chartData.length - 1]!.timestamp;
  const timeSpan = lastTs - firstTs || 1;

  const getX = (ts: number) => paddingX + ((ts - firstTs) / timeSpan) * chartWidth;
  const getY = (val: number) => paddingY + chartHeight - ((val - minVal) / valRange) * chartHeight;

  const pathData = chartData
    .map((d, i) => {
      const x = getX(d.timestamp);
      const y = getY(d.price);
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');

  const areaPath = `${pathData} L ${getX(lastTs)} ${paddingY + chartHeight} L ${paddingX} ${paddingY + chartHeight} Z`;

  const rangeLabel = TIME_RANGES.find((t) => t.key === timeRange)?.label;

  return (
    <div className={`${overlayClass} z-50`} onClick={onClose}>
      <div className={`${modalShellClass} max-w-3xl overflow-hidden`} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={`p-4 border-b ${cardEdgeClass}`}>
          <div className="flex justify-between items-start">
            <div>
              <div className={`text-xs font-semibold tracking-wider mb-1 ${mutedClass}`}>STOCKISM MARKET INDEX</div>
              <div className="flex items-baseline gap-3 mt-1">
                <span className={`text-2xl font-bold ${textClass}`}>
                  {currentIndex.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span
                  className={`text-sm font-semibold ${colorBlindMode ? (isUp ? 'text-teal-500' : 'text-purple-500') : isUp ? 'text-green-500' : 'text-red-500'}`}
                >
                  {isUp ? '\u25B2' : '\u25BC'} {isUp ? '+' : ''}
                  {periodChange.toFixed(2)}% ({rangeLabel})
                </span>
              </div>
            </div>
            <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-500 text-xl`}>
              &times;
            </button>
          </div>
        </div>

        {/* Time Range Selector */}
        <div
          className={`px-4 py-2 border-b ${darkMode ? 'border-zinc-800 bg-zinc-900/50' : 'border-amber-200 bg-amber-50'}`}
        >
          <div className="flex gap-1">
            {TIME_RANGES.map((range) => (
              <button
                key={range.key}
                onClick={() => setTimeRange(range.key)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-sm transition-colors ${
                  timeRange === range.key
                    ? 'bg-orange-600 text-white'
                    : darkMode
                      ? 'text-zinc-400 hover:bg-zinc-800'
                      : 'text-zinc-600 hover:bg-slate-200'
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>

        {/* Chart */}
        <div className={`p-4 ${bgClass}`}>
          <div className="relative">
            <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full">
              {/* Grid lines */}
              {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
                const y = paddingY + ratio * chartHeight;
                const val = maxVal - ratio * valRange;
                return (
                  <g key={i}>
                    <line
                      x1={paddingX}
                      y1={y}
                      x2={svgWidth - paddingX}
                      y2={y}
                      stroke={darkMode ? '#334155' : '#e2e8f0'}
                      strokeWidth="1"
                    />
                    <text
                      x={paddingX - 8}
                      y={y + 4}
                      textAnchor="end"
                      fill={darkMode ? '#64748b' : '#94a3b8'}
                      fontSize="10"
                    >
                      {val.toFixed(0)}
                    </text>
                  </g>
                );
              })}

              {/* Base line at 1000 */}
              {minVal < 1000 && maxVal > 1000 && (
                <>
                  <line
                    x1={paddingX}
                    y1={getY(1000)}
                    x2={svgWidth - paddingX}
                    y2={getY(1000)}
                    stroke={darkMode ? '#f59e0b' : '#d97706'}
                    strokeWidth="1"
                    strokeDasharray="4"
                    opacity="0.5"
                  />
                  <text
                    x={svgWidth - paddingX + 4}
                    y={getY(1000) + 4}
                    fill={darkMode ? '#f59e0b' : '#d97706'}
                    fontSize="9"
                    opacity="0.7"
                  >
                    BASE
                  </text>
                </>
              )}

              <path d={areaPath} fill={fillColor} />
              <path d={pathData} fill="none" stroke={strokeColor} strokeWidth="2" />

              {/* Endpoint dots */}
              <circle
                cx={getX(firstTs)}
                cy={getY(firstVal)}
                r={4}
                fill={darkMode ? '#1e293b' : '#f8fafc'}
                stroke={strokeColor}
                strokeWidth={2}
              />
              <circle
                cx={getX(lastTs)}
                cy={getY(lastVal)}
                r={4}
                fill={darkMode ? '#1e293b' : '#f8fafc'}
                stroke={strokeColor}
                strokeWidth={2}
              />

              {/* Hover indicator */}
              {hoveredPoint && (
                <>
                  <line
                    x1={hoveredPoint.x}
                    y1={paddingY}
                    x2={hoveredPoint.x}
                    y2={paddingY + chartHeight}
                    stroke={darkMode ? '#475569' : '#cbd5e1'}
                    strokeDasharray="4"
                  />
                  <circle
                    cx={hoveredPoint.x}
                    cy={hoveredPoint.y}
                    r={6}
                    fill={strokeColor}
                    stroke={darkMode ? '#1e293b' : '#fff'}
                    strokeWidth={2}
                  />
                </>
              )}
            </svg>

            {/* Hover overlay */}
            <div
              className="absolute inset-0 cursor-pointer"
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const mouseX = ((e.clientX - rect.left) / rect.width) * svgWidth;

                let leftPoint: IndexPoint | null = null;
                let rightPoint: IndexPoint | null = null;
                for (let i = 0; i < chartData.length - 1; i++) {
                  const left = chartData[i]!;
                  const right = chartData[i + 1]!;
                  if (mouseX >= getX(left.timestamp) && mouseX <= getX(right.timestamp)) {
                    leftPoint = left;
                    rightPoint = right;
                    break;
                  }
                }

                if (leftPoint && rightPoint) {
                  const x1 = getX(leftPoint.timestamp);
                  const x2 = getX(rightPoint.timestamp);
                  const ratio = (mouseX - x1) / (x2 - x1);
                  const interpolated = leftPoint.price + ratio * (rightPoint.price - leftPoint.price);
                  const closerPoint = ratio < 0.5 ? leftPoint : rightPoint;
                  setHoveredPoint({
                    price: interpolated,
                    x: mouseX,
                    y: getY(interpolated),
                    fullDate: new Date(closerPoint.timestamp).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    }),
                  });
                } else {
                  setHoveredPoint(null);
                }
              }}
              onMouseLeave={() => setHoveredPoint(null)}
            />

            {/* Tooltip */}
            {hoveredPoint && (
              <div
                className={`absolute pointer-events-none px-3 py-2 rounded-sm shadow-lg text-sm z-10 ${
                  darkMode ? 'bg-zinc-800 text-zinc-100' : 'bg-white text-slate-900 border'
                }`}
                style={{
                  left: `${(hoveredPoint.x / svgWidth) * 100}%`,
                  top: `${(hoveredPoint.y / svgHeight) * 100}%`,
                  transform: 'translate(-50%, -130%)',
                }}
              >
                <div className="font-bold text-orange-400">
                  {hoveredPoint.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className={`text-xs ${mutedClass}`}>{hoveredPoint.fullDate}</div>
              </div>
            )}
          </div>
        </div>

        {/* Stats Footer */}
        <div className={`p-4 border-t ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
          <div className="grid grid-cols-4 gap-4 text-center">
            <div>
              <div className={`text-xs ${mutedClass} uppercase`}>Open</div>
              <div className={`font-semibold ${textClass}`}>
                {firstVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            <div>
              <div className={`text-xs ${mutedClass} uppercase`}>High</div>
              <div className={`font-semibold ${colorBlindMode ? 'text-teal-500' : 'text-green-500'}`}>
                {maxVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            <div>
              <div className={`text-xs ${mutedClass} uppercase`}>Low</div>
              <div className={`font-semibold ${colorBlindMode ? 'text-purple-500' : 'text-red-500'}`}>
                {minVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            <div>
              <div className={`text-xs ${mutedClass} uppercase`}>Current</div>
              <div className={`font-semibold ${textClass}`}>
                {currentIndex.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default IndexChartModal;
