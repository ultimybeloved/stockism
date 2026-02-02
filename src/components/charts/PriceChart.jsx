// ============================================
// PriceChart Component
// Detailed interactive price chart with time ranges
// ============================================

import React, { useState, useMemo } from 'react';
import { formatCurrency, formatChange } from '../../utils/formatters';

const TIME_RANGES = [
  { key: '1d', label: 'Today', hours: 24 },
  { key: '7d', label: '7 Days', hours: 168 },
  { key: '1m', label: '1 Month', hours: 720 },
  { key: '3m', label: '3 Months', hours: 2160 },
  { key: '1y', label: '1 Year', hours: 8760 },
  { key: 'all', label: 'All Time', hours: Infinity },
];

/**
 * PriceChart Modal component
 * @param {Object} props
 * @param {Object} props.character - Character data with ticker, name, basePrice
 * @param {number} props.currentPrice - Current price
 * @param {Object} props.priceHistory - Price history object
 * @param {Function} props.onClose - Close handler
 * @param {boolean} props.darkMode - Dark mode flag
 */
const PriceChart = ({
  character,
  currentPrice,
  priceHistory,
  onClose,
  darkMode = false,
  colorBlindMode = false
}) => {
  const [timeRange, setTimeRange] = useState('7d');
  const [hoveredPoint, setHoveredPoint] = useState(null);

  // Derive actual current price from latest history entry to avoid race conditions
  const tickerHistory = priceHistory[character.ticker] || [];
  const actualCurrentPrice = tickerHistory.length > 0
    ? tickerHistory[tickerHistory.length - 1].price
    : (currentPrice || character.basePrice);

  const currentData = useMemo(() => {
    const range = TIME_RANGES.find(r => r.key === timeRange);
    const cutoff = range.hours === Infinity ? 0 : Date.now() - (range.hours * 60 * 60 * 1000);

    let data = tickerHistory
      .filter(point => point.timestamp >= cutoff)
      .map(point => ({
        ...point,
        date: new Date(point.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        fullDate: new Date(point.timestamp).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
        }),
      }));

    // Smart downsampling that preserves visual accuracy
    const maxPoints = 150; // Increased from 100 for better resolution
    if (data.length > maxPoints) {
      const sampled = [data[0]]; // Always keep first point
      const bucketSize = (data.length - 2) / (maxPoints - 2);

      for (let i = 0; i < maxPoints - 2; i++) {
        const bucketStart = Math.floor(i * bucketSize) + 1;
        const bucketEnd = Math.floor((i + 1) * bucketSize) + 1;
        const bucket = data.slice(bucketStart, bucketEnd);

        if (bucket.length === 0) continue;

        // Use the median point to avoid outlier spikes that create invisible hover targets
        const sortedByPrice = [...bucket].sort((a, b) => a.price - b.price);
        const medianIndex = Math.floor(sortedByPrice.length / 2);
        const selectedPoint = sortedByPrice[medianIndex];

        sampled.push(selectedPoint);
      }

      sampled.push(data[data.length - 1]); // Always keep last point
      sampled.sort((a, b) => a.timestamp - b.timestamp); // Ensure chronological order
      data = sampled;
    }

    // If not enough data, create synthetic points
    if (data.length < 2) {
      const now = Date.now();
      const startTime = range.hours === Infinity ? now - (7 * 24 * 60 * 60 * 1000) : now - (range.hours * 60 * 60 * 1000);

      let startPrice = character.basePrice;
      for (let i = tickerHistory.length - 1; i >= 0; i--) {
        if (tickerHistory[i].timestamp <= cutoff) {
          startPrice = tickerHistory[i].price;
          break;
        }
      }
      if (startPrice === character.basePrice && tickerHistory.length > 0) {
        startPrice = tickerHistory[0].price;
      }

      data = [
        {
          timestamp: startTime,
          price: startPrice,
          date: new Date(startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          fullDate: new Date(startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        },
        {
          timestamp: now,
          price: actualCurrentPrice,
          date: 'Now',
          fullDate: new Date(now).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        }
      ];
    }

    return data;
  }, [tickerHistory, character.ticker, character.basePrice, actualCurrentPrice, timeRange]);

  const prices = currentData.map(d => d.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice || 1;

  const firstPrice = currentData[0]?.price || actualCurrentPrice;
  const lastPrice = currentData[currentData.length - 1]?.price || actualCurrentPrice;
  const periodChange = firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;
  const isUp = lastPrice >= firstPrice;

  const svgWidth = 600;
  const svgHeight = 300;
  const paddingX = 50;
  const paddingY = 30;
  const chartWidth = svgWidth - paddingX * 2;
  const chartHeight = svgHeight - paddingY * 2;

  // Use time-based X positioning to prevent tight clustering
  const firstTimestamp = currentData[0]?.timestamp || Date.now();
  const lastTimestamp = currentData[currentData.length - 1]?.timestamp || Date.now();
  const timeSpan = lastTimestamp - firstTimestamp || 1;

  const getX = (timestamp) => paddingX + ((timestamp - firstTimestamp) / timeSpan) * chartWidth;
  const getY = (price) => paddingY + chartHeight - ((price - minPrice) / priceRange) * chartHeight;

  const pathData = currentData.map((d, i) => {
    const x = getX(d.timestamp);
    const y = getY(d.price);
    return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');

  const areaPath = currentData.length > 0
    ? `${pathData} L ${getX(currentData[currentData.length - 1].timestamp)} ${paddingY + chartHeight} L ${paddingX} ${paddingY + chartHeight} Z`
    : '';

  const strokeColor = colorBlindMode
    ? (isUp ? '#14b8a6' : '#a855f7')  // teal-500 / purple-500
    : (isUp ? '#22c55e' : '#ef4444'); // green-500 / red-500
  const fillColor = colorBlindMode
    ? (isUp ? 'rgba(20, 184, 166, 0.1)' : 'rgba(168, 85, 247, 0.1)')  // teal / purple
    : (isUp ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)');   // green / red

  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';
  const bgClass = darkMode ? 'bg-zinc-950' : 'bg-amber-50';

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className={`w-full max-w-3xl ${cardClass} border rounded-sm shadow-xl overflow-hidden`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`p-4 border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
          <div className="flex justify-between items-start">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-orange-600 font-mono text-lg font-semibold">${character.ticker}</span>
                <span className={`text-sm ${mutedClass}`}>{character.name}</span>
              </div>
              <div className="flex items-baseline gap-3 mt-1">
                <span className={`text-2xl font-bold ${textClass}`}>{formatCurrency(actualCurrentPrice)}</span>
                <span className={`text-sm font-semibold ${colorBlindMode ? (isUp ? 'text-teal-500' : 'text-purple-500') : (isUp ? 'text-green-500' : 'text-red-500')}`}>
                  {isUp ? '▲' : '▼'} {formatChange(periodChange)} ({TIME_RANGES.find(t => t.key === timeRange)?.label})
                </span>
              </div>
            </div>
            <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-600 text-xl`}>×</button>
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

        {/* Chart Area */}
        <div className={`p-4 ${bgClass}`}>
          <div className="relative">
            <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full">
              {/* Grid lines */}
              {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
                const y = paddingY + ratio * chartHeight;
                const price = maxPrice - ratio * priceRange;
                return (
                  <g key={i}>
                    <line x1={paddingX} y1={y} x2={svgWidth - paddingX} y2={y}
                      stroke={darkMode ? '#334155' : '#e2e8f0'} strokeWidth="1" />
                    <text x={paddingX - 8} y={y + 4} textAnchor="end"
                      fill={darkMode ? '#64748b' : '#94a3b8'} fontSize="10">
                      ${price.toFixed(0)}
                    </text>
                  </g>
                );
              })}
              <path d={areaPath} fill={fillColor} />
              <path d={pathData} fill="none" stroke={strokeColor} strokeWidth="2" />

              {/* Start and end marker dots */}
              {currentData.length > 0 && (
                <>
                  <circle
                    cx={getX(currentData[0].timestamp)}
                    cy={getY(currentData[0].price)}
                    r={4}
                    fill={darkMode ? '#1e293b' : '#f8fafc'}
                    stroke={strokeColor}
                    strokeWidth={2}
                  />
                  <circle
                    cx={getX(currentData[currentData.length - 1].timestamp)}
                    cy={getY(currentData[currentData.length - 1].price)}
                    r={4}
                    fill={darkMode ? '#1e293b' : '#f8fafc'}
                    stroke={strokeColor}
                    strokeWidth={2}
                  />
                </>
              )}

              {/* Hover indicator dot (follows line exactly) */}
              {hoveredPoint && (
                <circle
                  cx={hoveredPoint.x}
                  cy={hoveredPoint.y}
                  r={6}
                  fill={strokeColor}
                  stroke={darkMode ? '#1e293b' : '#fff'}
                  strokeWidth={2}
                />
              )}

              {/* Hover vertical line */}
              {hoveredPoint && (
                <line
                  x1={hoveredPoint.x}
                  y1={paddingY}
                  x2={hoveredPoint.x}
                  y2={paddingY + chartHeight}
                  stroke={darkMode ? '#475569' : '#cbd5e1'}
                  strokeDasharray="4"
                />
              )}
            </svg>

            {/* Single overlay for hover detection - follows line exactly */}
            <div
              className="absolute inset-0 cursor-pointer"
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const mouseX = ((e.clientX - rect.left) / rect.width) * svgWidth;

                // Find the two points that bracket this X position
                let leftPoint = null;
                let rightPoint = null;

                for (let i = 0; i < currentData.length - 1; i++) {
                  const x1 = getX(currentData[i].timestamp);
                  const x2 = getX(currentData[i + 1].timestamp);

                  if (mouseX >= x1 && mouseX <= x2) {
                    leftPoint = currentData[i];
                    rightPoint = currentData[i + 1];
                    break;
                  }
                }

                if (leftPoint && rightPoint) {
                  // Interpolate price at mouse X position
                  const x1 = getX(leftPoint.timestamp);
                  const x2 = getX(rightPoint.timestamp);
                  const ratio = (mouseX - x1) / (x2 - x1);
                  const interpolatedPrice = leftPoint.price + ratio * (rightPoint.price - leftPoint.price);
                  const interpolatedY = getY(interpolatedPrice);

                  // Use the closer point's timestamp for the date display
                  const closerPoint = ratio < 0.5 ? leftPoint : rightPoint;

                  setHoveredPoint({
                    price: interpolatedPrice,
                    x: mouseX,
                    y: interpolatedY,
                    fullDate: closerPoint.fullDate
                  });
                } else if (mouseX >= paddingX && mouseX <= svgWidth - paddingX) {
                  // Outside data range but in chart area - snap to nearest endpoint
                  const first = currentData[0];
                  const last = currentData[currentData.length - 1];
                  const nearFirst = Math.abs(mouseX - getX(first.timestamp)) < Math.abs(mouseX - getX(last.timestamp));
                  const point = nearFirst ? first : last;
                  setHoveredPoint({ ...point, x: getX(point.timestamp), y: getY(point.price) });
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
                <div className="font-bold text-orange-400">{formatCurrency(hoveredPoint.price)}</div>
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
              <div className={`font-semibold ${textClass}`}>{formatCurrency(firstPrice)}</div>
            </div>
            <div>
              <div className={`text-xs ${mutedClass} uppercase`}>High</div>
              <div className={`font-semibold ${colorBlindMode ? 'text-teal-500' : 'text-green-500'}`}>{formatCurrency(maxPrice)}</div>
            </div>
            <div>
              <div className={`text-xs ${mutedClass} uppercase`}>Low</div>
              <div className={`font-semibold ${colorBlindMode ? 'text-purple-500' : 'text-red-500'}`}>{formatCurrency(minPrice)}</div>
            </div>
            <div>
              <div className={`text-xs ${mutedClass} uppercase`}>Current</div>
              <div className={`font-semibold ${textClass}`}>{formatCurrency(actualCurrentPrice)}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PriceChart;
