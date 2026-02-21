import React, { useState, useMemo } from 'react';
import SimpleLineChart from './charts/SimpleLineChart';
import { CHARACTERS } from '../characters';

const nonETFCharacters = CHARACTERS.filter(c => !c.isETF);

const TIME_RANGES = [
  { key: '1d', label: 'Today', hours: 24 },
  { key: '7d', label: '7 Days', hours: 168 },
  { key: '1m', label: '1 Month', hours: 720 },
  { key: '3m', label: '3 Months', hours: 2160 },
  { key: 'all', label: 'All Time', hours: Infinity },
];

const getTimestamp = (entry) => {
  if (typeof entry.timestamp === 'number') return entry.timestamp;
  if (entry.timestamp?.seconds) return entry.timestamp.seconds * 1000;
  return null;
};

const computeIndex = (prices, characters) => {
  let sum = 0;
  let count = 0;
  for (const char of characters) {
    const price = prices?.[char.ticker];
    const base = char.basePrice;
    if (base > 0) {
      sum += (price != null ? price : base) / base;
      count++;
    }
  }
  return count > 0 ? 1000 * (sum / count) : 1000;
};

const computeIndexAtTime = (priceHistory, t) => {
  let sum = 0;
  let count = 0;
  for (const char of nonETFCharacters) {
    const base = char.basePrice;
    if (base <= 0) continue;
    const history = priceHistory?.[char.ticker];
    if (!history || history.length === 0) {
      sum += 1;
      count++;
      continue;
    }
    let nearest = null;
    for (let j = history.length - 1; j >= 0; j--) {
      const ts = getTimestamp(history[j]);
      if (ts != null && ts <= t) {
        nearest = history[j].price;
        break;
      }
    }
    sum += (nearest != null ? nearest : base) / base;
    count++;
  }
  return count > 0 ? 1000 * (sum / count) : 1000;
};

const buildIndexSeries = (priceHistory, currentIndex, hours) => {
  if (!priceHistory || Object.keys(priceHistory).length === 0) return [];

  const now = Date.now();
  const cutoff = hours === Infinity ? 0 : now - hours * 60 * 60 * 1000;

  // Determine interval based on time range for ~100-150 points
  let interval;
  if (hours <= 24) interval = 30 * 60 * 1000;        // 30 min
  else if (hours <= 168) interval = 2 * 60 * 60 * 1000;   // 2 hours
  else if (hours <= 720) interval = 8 * 60 * 60 * 1000;   // 8 hours
  else if (hours <= 2160) interval = 24 * 60 * 60 * 1000; // 1 day
  else interval = 24 * 60 * 60 * 1000;                     // 1 day

  // For "all time", find earliest data point
  let start = cutoff || now - 30 * 24 * 60 * 60 * 1000; // default 30 days back
  if (hours === Infinity) {
    for (const char of nonETFCharacters) {
      const history = priceHistory?.[char.ticker];
      if (history && history.length > 0) {
        const ts = getTimestamp(history[0]);
        if (ts && ts < start) start = ts;
      }
    }
  } else {
    start = cutoff;
  }

  const points = [];
  for (let t = start; t <= now; t += interval) {
    points.push({ timestamp: t, price: computeIndexAtTime(priceHistory, t) });
  }
  // Always include current
  points.push({ timestamp: now, price: currentIndex });
  return points;
};

const MarketIndex = ({ prices, priceHistory, darkMode, colorBlindMode }) => {
  const [expanded, setExpanded] = useState(false);
  const [timeRange, setTimeRange] = useState('7d');
  const [hoveredPoint, setHoveredPoint] = useState(null);

  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const currentIndex = useMemo(() => computeIndex(prices, nonETFCharacters), [prices]);

  // 24h sparkline data
  const { change24h, changePct24h, sparklineData } = useMemo(() => {
    const points = buildIndexSeries(priceHistory, currentIndex, 24);
    if (points.length === 0) return { change24h: 0, changePct24h: 0, sparklineData: [] };
    const idx24hAgo = points[0].price;
    const change = currentIndex - idx24hAgo;
    const pct = idx24hAgo !== 0 ? (change / idx24hAgo) * 100 : 0;
    return { change24h: change, changePct24h: pct, sparklineData: points };
  }, [priceHistory, currentIndex]);

  // Expanded chart data
  const chartData = useMemo(() => {
    if (!expanded) return [];
    const range = TIME_RANGES.find(r => r.key === timeRange);
    return buildIndexSeries(priceHistory, currentIndex, range.hours);
  }, [expanded, timeRange, priceHistory, currentIndex]);

  const fromBasePct = ((currentIndex - 1000) / 1000) * 100;
  const isUp = change24h >= 0;
  const upColor = colorBlindMode ? 'text-teal-400' : 'text-green-500';
  const downColor = colorBlindMode ? 'text-purple-400' : 'text-red-500';
  const changeColor = isUp ? upColor : downColor;
  const baseIsUp = fromBasePct >= 0;
  const baseColor = baseIsUp ? upColor : downColor;

  return (
    <>
      {/* Banner card */}
      <div
        className={`${cardClass} border rounded-sm p-4 mb-4 cursor-pointer hover:border-orange-600 transition-colors`}
        onClick={() => setExpanded(true)}
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className={`text-xs font-semibold tracking-wider mb-1 ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
              STOCKISM MARKET INDEX
            </div>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-zinc-900'}`}>
                {currentIndex.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className={`text-sm font-semibold ${changeColor}`}>
                {isUp ? '\u25B2' : '\u25BC'} {isUp ? '+' : ''}{change24h.toFixed(2)} ({isUp ? '+' : ''}{changePct24h.toFixed(2)}%) 24h
              </span>
            </div>
            <div className={`text-xs mt-0.5 ${baseColor}`}>
              {baseIsUp ? '\u2191' : '\u2193'} {Math.abs(fromBasePct).toFixed(2)}% from base
            </div>
          </div>
          {sparklineData.length >= 2 && (
            <div className="w-full sm:w-40 h-10 flex-shrink-0">
              <SimpleLineChart
                data={sparklineData}
                darkMode={darkMode}
                colorBlindMode={colorBlindMode}
                width={160}
                height={40}
              />
            </div>
          )}
        </div>
      </div>

      {/* Expanded chart modal */}
      {expanded && <IndexChartModal
        chartData={chartData}
        currentIndex={currentIndex}
        timeRange={timeRange}
        setTimeRange={setTimeRange}
        hoveredPoint={hoveredPoint}
        setHoveredPoint={setHoveredPoint}
        darkMode={darkMode}
        colorBlindMode={colorBlindMode}
        onClose={() => { setExpanded(false); setHoveredPoint(null); }}
      />}
    </>
  );
};

const IndexChartModal = ({
  chartData, currentIndex, timeRange, setTimeRange,
  hoveredPoint, setHoveredPoint, darkMode, colorBlindMode, onClose
}) => {
  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';
  const bgClass = darkMode ? 'bg-zinc-950' : 'bg-amber-50';

  if (chartData.length < 2) return null;

  const indexValues = chartData.map(d => d.price);
  const minVal = Math.min(...indexValues);
  const maxVal = Math.max(...indexValues);
  const valRange = maxVal - minVal || 1;

  const firstVal = chartData[0].price;
  const lastVal = chartData[chartData.length - 1].price;
  const periodChange = firstVal > 0 ? ((lastVal - firstVal) / firstVal) * 100 : 0;
  const isUp = lastVal >= firstVal;

  const strokeColor = colorBlindMode
    ? (isUp ? '#14b8a6' : '#a855f7')
    : (isUp ? '#22c55e' : '#ef4444');
  const fillColor = colorBlindMode
    ? (isUp ? 'rgba(20, 184, 166, 0.1)' : 'rgba(168, 85, 247, 0.1)')
    : (isUp ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)');

  const svgWidth = 600;
  const svgHeight = 300;
  const paddingX = 50;
  const paddingY = 30;
  const chartWidth = svgWidth - paddingX * 2;
  const chartHeight = svgHeight - paddingY * 2;

  const firstTs = chartData[0].timestamp;
  const lastTs = chartData[chartData.length - 1].timestamp;
  const timeSpan = lastTs - firstTs || 1;

  const getX = (ts) => paddingX + ((ts - firstTs) / timeSpan) * chartWidth;
  const getY = (val) => paddingY + chartHeight - ((val - minVal) / valRange) * chartHeight;

  const pathData = chartData.map((d, i) => {
    const x = getX(d.timestamp);
    const y = getY(d.price);
    return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');

  const areaPath = `${pathData} L ${getX(lastTs)} ${paddingY + chartHeight} L ${paddingX} ${paddingY + chartHeight} Z`;

  const rangeLabel = TIME_RANGES.find(t => t.key === timeRange)?.label;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className={`w-full max-w-3xl ${cardClass} border rounded-sm shadow-xl overflow-hidden`} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className={`p-4 border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
          <div className="flex justify-between items-start">
            <div>
              <div className={`text-xs font-semibold tracking-wider mb-1 ${mutedClass}`}>STOCKISM MARKET INDEX</div>
              <div className="flex items-baseline gap-3 mt-1">
                <span className={`text-2xl font-bold ${textClass}`}>
                  {currentIndex.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className={`text-sm font-semibold ${colorBlindMode ? (isUp ? 'text-teal-500' : 'text-purple-500') : (isUp ? 'text-green-500' : 'text-red-500')}`}>
                  {isUp ? '\u25B2' : '\u25BC'} {isUp ? '+' : ''}{periodChange.toFixed(2)}% ({rangeLabel})
                </span>
              </div>
            </div>
            <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-600 text-xl`}>&times;</button>
          </div>
        </div>

        {/* Time Range Selector */}
        <div className={`px-4 py-2 border-b ${darkMode ? 'border-zinc-800 bg-zinc-900/50' : 'border-amber-200 bg-amber-50'}`}>
          <div className="flex gap-1">
            {TIME_RANGES.map(range => (
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
                    <line x1={paddingX} y1={y} x2={svgWidth - paddingX} y2={y}
                      stroke={darkMode ? '#334155' : '#e2e8f0'} strokeWidth="1" />
                    <text x={paddingX - 8} y={y + 4} textAnchor="end"
                      fill={darkMode ? '#64748b' : '#94a3b8'} fontSize="10">
                      {val.toFixed(0)}
                    </text>
                  </g>
                );
              })}

              {/* Base line at 1000 */}
              {minVal < 1000 && maxVal > 1000 && (
                <>
                  <line x1={paddingX} y1={getY(1000)} x2={svgWidth - paddingX} y2={getY(1000)}
                    stroke={darkMode ? '#f59e0b' : '#d97706'} strokeWidth="1" strokeDasharray="4" opacity="0.5" />
                  <text x={svgWidth - paddingX + 4} y={getY(1000) + 4}
                    fill={darkMode ? '#f59e0b' : '#d97706'} fontSize="9" opacity="0.7">
                    BASE
                  </text>
                </>
              )}

              <path d={areaPath} fill={fillColor} />
              <path d={pathData} fill="none" stroke={strokeColor} strokeWidth="2" />

              {/* Endpoint dots */}
              <circle cx={getX(firstTs)} cy={getY(firstVal)} r={4}
                fill={darkMode ? '#1e293b' : '#f8fafc'} stroke={strokeColor} strokeWidth={2} />
              <circle cx={getX(lastTs)} cy={getY(lastVal)} r={4}
                fill={darkMode ? '#1e293b' : '#f8fafc'} stroke={strokeColor} strokeWidth={2} />

              {/* Hover indicator */}
              {hoveredPoint && (
                <>
                  <line x1={hoveredPoint.x} y1={paddingY} x2={hoveredPoint.x} y2={paddingY + chartHeight}
                    stroke={darkMode ? '#475569' : '#cbd5e1'} strokeDasharray="4" />
                  <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r={6}
                    fill={strokeColor} stroke={darkMode ? '#1e293b' : '#fff'} strokeWidth={2} />
                </>
              )}
            </svg>

            {/* Hover overlay */}
            <div
              className="absolute inset-0 cursor-pointer"
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const mouseX = ((e.clientX - rect.left) / rect.width) * svgWidth;

                let leftPoint = null;
                let rightPoint = null;
                for (let i = 0; i < chartData.length - 1; i++) {
                  const x1 = getX(chartData[i].timestamp);
                  const x2 = getX(chartData[i + 1].timestamp);
                  if (mouseX >= x1 && mouseX <= x2) {
                    leftPoint = chartData[i];
                    rightPoint = chartData[i + 1];
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
                      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
                    })
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
                  transform: 'translate(-50%, -130%)'
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
              <div className={`font-semibold ${textClass}`}>{firstVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
            <div>
              <div className={`text-xs ${mutedClass} uppercase`}>High</div>
              <div className={`font-semibold ${colorBlindMode ? 'text-teal-500' : 'text-green-500'}`}>{maxVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
            <div>
              <div className={`text-xs ${mutedClass} uppercase`}>Low</div>
              <div className={`font-semibold ${colorBlindMode ? 'text-purple-500' : 'text-red-500'}`}>{minVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
            <div>
              <div className={`text-xs ${mutedClass} uppercase`}>Current</div>
              <div className={`font-semibold ${textClass}`}>{currentIndex.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MarketIndex;
