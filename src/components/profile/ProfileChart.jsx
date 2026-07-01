import { useState, useMemo } from 'react';
import { formatCurrency, formatChange } from '../../utils/formatters';
import { getThemeClasses } from '../../utils/theme';

// Keys must match shared TIME_RANGES so the page can fetch history per range.
const TIME_RANGES = [
  { key: '1d', label: '24h', hours: 24 },
  { key: '7d', label: '7D', hours: 168 },
  { key: '1m', label: '1M', hours: 720 },
  { key: 'all', label: 'All', hours: Infinity },
];

// The "Portfolio Value" chart card on the profile page. Range selection is
// controlled by the parent so it can fetch only the history the range needs.
const ProfileChart = ({ portfolioValue, portfolioHistory, darkMode, colorBlindMode, timeRange, onTimeRangeChange }) => {
  const chartTimeRange = timeRange;
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const { textClass } = getThemeClasses(darkMode);

  const chartData = useMemo(() => {
    if (!portfolioHistory || portfolioHistory.length === 0) {
      const now = Date.now();
      return [
        { timestamp: now - 60000, value: portfolioValue, fullDate: 'Now' },
        { timestamp: now, value: portfolioValue, fullDate: 'Now' }
      ];
    }
    // History arrives already bounded to the selected range (fetched per range
    // by the parent), so no client-side cutoff filter is needed.
    let data = portfolioHistory
      .map(point => ({
        ...point,
        fullDate: new Date(point.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      }));
    const maxPoints = 20;
    if (data.length > maxPoints) {
      const step = Math.floor(data.length / maxPoints);
      const sampled = [];
      for (let i = 0; i < data.length; i += step) sampled.push(data[i]);
      if (sampled[sampled.length - 1] !== data[data.length - 1]) sampled.push(data[data.length - 1]);
      data = sampled;
    }
    if (data.length === 1) data = [...data, { timestamp: Date.now(), value: portfolioValue, fullDate: 'Now' }];
    if (data.length === 0) {
      const now = Date.now();
      data = [
        { timestamp: now - 60000, value: portfolioValue, fullDate: 'Now' },
        { timestamp: now, value: portfolioValue, fullDate: 'Now' }
      ];
    }
    return data;
  }, [portfolioHistory, chartTimeRange, portfolioValue]);

  const chartValues = chartData.map(d => d.value);
  const minChartValue = Math.min(...chartValues);
  const maxChartValue = Math.max(...chartValues);
  const chartValueRange = maxChartValue - minChartValue || 1;
  const firstChartValue = chartData[0]?.value || portfolioValue;
  const lastChartValue = chartData[chartData.length - 1]?.value || portfolioValue;
  const periodChange = firstChartValue > 0 ? ((lastChartValue - firstChartValue) / firstChartValue) * 100 : 0;
  const chartIsUp = lastChartValue >= firstChartValue;

  const svgWidth = 500;
  const svgHeight = 150;
  const padX = 40;
  const padY = 20;
  const cw = svgWidth - padX * 2;
  const ch = svgHeight - padY * 2;
  const getChartX = (i) => padX + (i / (chartData.length - 1 || 1)) * cw;
  const getChartY = (v) => padY + ch - ((v - minChartValue) / chartValueRange) * ch;
  const chartPathData = chartData.map((d, i) => `${i === 0 ? 'M' : 'L'} ${getChartX(i)} ${getChartY(d.value)}`).join(' ');
  const chartAreaPath = `${chartPathData} L ${getChartX(chartData.length - 1)} ${padY + ch} L ${padX} ${padY + ch} Z`;
  const chartStroke = colorBlindMode ? (chartIsUp ? '#14b8a6' : '#a855f7') : (chartIsUp ? '#22c55e' : '#ef4444');
  const chartFill = colorBlindMode
    ? (chartIsUp ? 'rgba(20, 184, 166, 0.1)' : 'rgba(168, 85, 247, 0.1)')
    : (chartIsUp ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)');

  return (
    <div className={`p-4 rounded-sm border ${darkMode ? 'bg-zinc-800/50 border-zinc-700' : 'bg-amber-50 border-amber-200'}`}>
      <div className="flex justify-between items-center mb-2">
        <div>
          <h3 className={`font-semibold ${textClass}`}>Portfolio Value</h3>
          <div className="flex items-baseline gap-2">
            <span className={`text-xl font-bold ${textClass}`}>{formatCurrency(hoveredPoint?.value ?? portfolioValue)}</span>
            <span className={`text-sm font-semibold ${colorBlindMode ? (chartIsUp ? 'text-teal-500' : 'text-purple-500') : (chartIsUp ? 'text-green-500' : 'text-red-500')}`}>
              {chartIsUp ? '▲' : '▼'} {formatChange(periodChange)}
            </span>
          </div>
        </div>
        <div className="flex gap-1">
          {TIME_RANGES.map(range => (
            <button
              key={range.key}
              onClick={() => onTimeRangeChange(range.key)}
              className={`px-2 py-1 text-xs font-semibold rounded-sm ${
                chartTimeRange === range.key
                  ? 'bg-orange-600 text-white'
                  : darkMode ? 'text-zinc-400 hover:bg-zinc-700' : 'text-zinc-600 hover:bg-slate-200'
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full">
          {[0, 0.5, 1].map((ratio, i) => {
            const y = padY + ratio * ch;
            const value = maxChartValue - ratio * chartValueRange;
            return (
              <g key={i}>
                <line x1={padX} y1={y} x2={svgWidth - padX} y2={y} stroke={darkMode ? '#334155' : '#e2e8f0'} strokeWidth="1" />
                <text x={padX - 5} y={y + 4} textAnchor="end" fill={darkMode ? '#64748b' : '#94a3b8'} fontSize="9">
                  ${(value / 1000).toFixed(1)}k
                </text>
              </g>
            );
          })}
          <path d={chartAreaPath} fill={chartFill} />
          <path d={chartPathData} fill="none" stroke={chartStroke} strokeWidth="2" />
          {/* Start/end markers */}
          <circle cx={getChartX(0)} cy={getChartY(chartData[0].value)} r={4}
            fill="none" stroke={chartStroke} strokeWidth={2} />
          <circle cx={getChartX(chartData.length - 1)} cy={getChartY(chartData[chartData.length - 1].value)} r={4}
            fill="none" stroke={chartStroke} strokeWidth={2} />
          {hoveredPoint !== null && (
            <>
              <line x1={hoveredPoint.x} y1={padY} x2={hoveredPoint.x} y2={padY + ch}
                stroke={chartStroke} strokeWidth="1" strokeDasharray="4,4" opacity="0.5" />
              <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r={6}
                fill={chartStroke} stroke={chartStroke} strokeWidth={2} />
            </>
          )}
        </svg>
        <div className="absolute inset-0 cursor-crosshair"
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const mouseX = ((e.clientX - rect.left) / rect.width) * svgWidth;
            if (mouseX < padX || mouseX > svgWidth - padX) { setHoveredPoint(null); return; }
            // Find bracketing data points
            let leftIdx = 0;
            for (let i = 0; i < chartData.length - 1; i++) {
              if (getChartX(i + 1) >= mouseX) { leftIdx = i; break; }
              leftIdx = i;
            }
            const rightIdx = Math.min(leftIdx + 1, chartData.length - 1);
            const x1 = getChartX(leftIdx), x2 = getChartX(rightIdx);
            const t = x2 === x1 ? 0 : (mouseX - x1) / (x2 - x1);
            const interpValue = chartData[leftIdx].value + t * (chartData[rightIdx].value - chartData[leftIdx].value);
            const interpY = getChartY(interpValue);
            // Interpolate date
            const ts1 = chartData[leftIdx].timestamp, ts2 = chartData[rightIdx].timestamp;
            const interpTs = ts1 + t * (ts2 - ts1);
            const interpDate = new Date(interpTs).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            setHoveredPoint({ x: mouseX, y: interpY, value: interpValue, fullDate: interpDate });
          }}
          onMouseLeave={() => setHoveredPoint(null)}
        />
        {hoveredPoint !== null && (
          <div className={`absolute pointer-events-none px-3 py-2 rounded-sm shadow-lg text-xs z-10 ${darkMode ? 'bg-zinc-800 text-zinc-100' : 'bg-zinc-900 text-white'}`}
            style={{ left: `${(hoveredPoint.x / svgWidth) * 100}%`, top: `${(hoveredPoint.y / svgHeight) * 100}%`, transform: 'translate(-50%, -130%)' }}>
            <div className="font-bold text-orange-400">{formatCurrency(hoveredPoint.value)}</div>
            <div className="text-zinc-400">{hoveredPoint.fullDate}</div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProfileChart;
