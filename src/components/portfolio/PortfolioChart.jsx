import { useRef } from 'react';
import { formatCurrency, formatAxisLabels } from '../../utils/formatters';

// The collapsible portfolio value chart (time-range buttons + interactive SVG).
// Presentational: receives the prepared chartData and derived bounds, owns only
// the local SVG ref. hoveredPoint is lifted to the parent so the header value can
// reflect the hovered point.
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
  darkMode,
  colorBlindMode,
}) => {
  const svgRef = useRef(null);

  // SVG chart dimensions
  const svgWidth = 500;
  const svgHeight = 150;
  const paddingX = 40;
  const paddingY = 20;
  const chartWidth = svgWidth - paddingX * 2;
  const chartHeight = svgHeight - paddingY * 2;

  const getX = (index) => paddingX + (index / (chartData.length - 1 || 1)) * chartWidth;
  const getY = (value) => paddingY + chartHeight - ((value - minValue) / valueRange) * chartHeight;

  const pathData = chartData.map((d, i) => {
    const x = getX(i);
    const y = getY(d.value);
    return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');

  const areaPath = chartData.length > 0
    ? `${pathData} L ${getX(chartData.length - 1)} ${paddingY + chartHeight} L ${paddingX} ${paddingY + chartHeight} Z`
    : '';

  // Color blind friendly chart colors
  const strokeColor = colorBlindMode
    ? (isUp ? '#14b8a6' : '#a855f7')  // teal-500 / purple-500
    : (isUp ? '#22c55e' : '#ef4444'); // green-500 / red-500
  const fillColor = colorBlindMode
    ? (isUp ? 'rgba(20, 184, 166, 0.1)' : 'rgba(168, 85, 247, 0.1)')  // teal / purple
    : (isUp ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)');   // green / red

  return (
    <div className={`border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
      <div className="flex items-center justify-between px-4 py-2">
        <button
          onClick={() => setShowChart(!showChart)}
          className={`text-xs font-semibold ${darkMode ? 'text-zinc-500' : 'text-zinc-500'} hover:text-orange-500`}
        >
          {showChart ? '▼ Hide Chart' : '▶ Show Chart'}
        </button>
        {showChart && (
          <div className="flex gap-1">
            {timeRanges.map(range => (
              <button
                key={range.key}
                onClick={() => setTimeRange(range.key)}
                className={`px-2 py-1 text-xs font-semibold rounded-sm ${
                  timeRange === range.key
                    ? 'bg-orange-600 text-white'
                    : darkMode ? 'text-zinc-400 hover:bg-zinc-800' : 'text-zinc-600 hover:bg-slate-200'
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {showChart && loadingHistory && (
        <div className={`px-4 pb-4 ${darkMode ? 'bg-zinc-950/50' : 'bg-amber-50'} h-32 flex items-center justify-center`}>
          <span className={`text-xs ${darkMode ? 'text-zinc-500' : 'text-zinc-500'}`}>Loading...</span>
        </div>
      )}

      {showChart && !loadingHistory && (
        <div className={`px-4 pb-4 ${darkMode ? 'bg-zinc-950/50' : 'bg-amber-50'} relative`}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full"
          >
            {/* Grid lines */}
            {(() => {
              const ratios = [0, 0.5, 1];
              const labels = formatAxisLabels(ratios.map((r) => maxValue - r * valueRange), { kilo: true });
              return ratios.map((ratio, i) => {
                const y = paddingY + ratio * chartHeight;
                return (
                  <g key={i}>
                    <line x1={paddingX} y1={y} x2={svgWidth - paddingX} y2={y}
                      stroke={darkMode ? '#334155' : '#e2e8f0'} strokeWidth="1" />
                    {labels[i] && (
                      <text x={paddingX - 5} y={y + 4} textAnchor="end"
                        fill={darkMode ? '#64748b' : '#94a3b8'} fontSize="9">
                        {labels[i]}
                      </text>
                    )}
                  </g>
                );
              });
            })()}

            {/* Area fill */}
            <path d={areaPath} fill={fillColor} />

            {/* Line */}
            <path d={pathData} fill="none" stroke={strokeColor} strokeWidth="2" />

            {/* Start/end markers */}
            <circle cx={getX(0)} cy={getY(chartData[0].value)} r={4}
              fill="none" stroke={strokeColor} strokeWidth={2} />
            <circle cx={getX(chartData.length - 1)} cy={getY(chartData[chartData.length - 1].value)} r={4}
              fill="none" stroke={strokeColor} strokeWidth={2} />

            {/* Hover elements */}
            {hoveredPoint !== null && (
              <>
                <line x1={hoveredPoint.x} y1={paddingY} x2={hoveredPoint.x} y2={paddingY + chartHeight}
                  stroke={strokeColor} strokeWidth="1" strokeDasharray="4,4" opacity="0.5" />
                <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r={6}
                  fill={strokeColor} stroke={strokeColor} strokeWidth={2} />
              </>
            )}
          </svg>

          {/* Smooth hover overlay */}
          <div className="absolute inset-0 cursor-crosshair"
            onMouseMove={(e) => {
              const rect = svgRef.current ? svgRef.current.getBoundingClientRect() : e.currentTarget.getBoundingClientRect();
              const mouseX = ((e.clientX - rect.left) / rect.width) * svgWidth;
              if (mouseX < paddingX || mouseX > svgWidth - paddingX) { setHoveredPoint(null); return; }
              let leftIdx = 0;
              for (let i = 0; i < chartData.length - 1; i++) {
                if (getX(i + 1) >= mouseX) { leftIdx = i; break; }
                leftIdx = i;
              }
              const rightIdx = Math.min(leftIdx + 1, chartData.length - 1);
              const x1 = getX(leftIdx), x2 = getX(rightIdx);
              const t = x2 === x1 ? 0 : (mouseX - x1) / (x2 - x1);
              const interpValue = chartData[leftIdx].value + t * (chartData[rightIdx].value - chartData[leftIdx].value);
              const interpY = getY(interpValue);
              const ts1 = chartData[leftIdx].timestamp, ts2 = chartData[rightIdx].timestamp;
              const interpTs = ts1 + t * (ts2 - ts1);
              const interpDate = new Date(interpTs).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
              setHoveredPoint({ x: mouseX, y: interpY, value: interpValue, fullDate: interpDate });
            }}
            onMouseLeave={() => setHoveredPoint(null)}
          />

          {/* Tooltip */}
          {hoveredPoint !== null && (
            <div
              className={`absolute pointer-events-none px-3 py-2 rounded-sm shadow-lg text-xs z-10 ${
                darkMode ? 'bg-zinc-800 text-zinc-100' : 'bg-zinc-900 text-white'
              }`}
              style={{
                left: `${(hoveredPoint.x / svgWidth) * 100}%`,
                top: `${(hoveredPoint.y / svgHeight) * 100}%`,
                transform: 'translate(-50%, -130%)'
              }}
            >
              <div className="font-bold text-orange-400">{formatCurrency(hoveredPoint.value)}</div>
              <div className="text-zinc-400">{hoveredPoint.fullDate}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PortfolioChart;
