import React, { useState, useEffect, useMemo, useRef } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { formatCurrency, formatChange } from '../../utils/formatters';

const ChartModal = ({ character, currentPrice, priceHistory, onClose, darkMode, defaultTimeRange = '1d', colorBlindMode = false }) => {
  const [timeRange, setTimeRange] = useState(defaultTimeRange);
  const [hoveredPoint, setHoveredPoint] = useState(null); // Tracks cursor position data
  const [archivedHistory, setArchivedHistory] = useState([]);
  const [loadingArchive, setLoadingArchive] = useState(false);
  const chartRef = useRef(null);

  // Color blind mode helper
  const getColors = (isPositive) => {
    if (colorBlindMode) {
      return {
        text: isPositive ? 'text-teal-500' : 'text-purple-500'
      };
    } else {
      return {
        text: isPositive ? 'text-green-500' : 'text-red-500'
      };
    }
  };

  const timeRanges = [
    { key: '1d', label: 'Today', hours: 24 },
    { key: '7d', label: '7 Days', hours: 168 },
    { key: '1m', label: '1 Month', hours: 720 },
    { key: '3m', label: '3 Months', hours: 2160 },
    { key: '1y', label: '1 Year', hours: 8760 },
    { key: 'all', label: 'All Time', hours: Infinity },
  ];

  // Fetch archived data for longer time ranges
  useEffect(() => {
    const needsArchive = ['1m', '3m', '1y', 'all'].includes(timeRange);

    if (needsArchive && archivedHistory.length === 0) {
      setLoadingArchive(true);
      const archiveRef = doc(db, 'market', 'current', 'price_history', character.ticker);
      getDoc(archiveRef).then(snap => {
        if (snap.exists()) {
          setArchivedHistory(snap.data().history || []);
        }
        setLoadingArchive(false);
      }).catch(() => setLoadingArchive(false));
    }
  }, [timeRange, character.ticker, archivedHistory.length]);

  const currentData = useMemo(() => {
    const range = timeRanges.find(r => r.key === timeRange);
    const cutoff = range.hours === Infinity ? 0 : Date.now() - (range.hours * 60 * 60 * 1000);

    // Combine main doc history with archived history for longer ranges
    const mainHistory = priceHistory[character.ticker] || [];
    const needsArchive = ['1m', '3m', '1y', 'all'].includes(timeRange);

    let fullHistory;
    if (needsArchive) {
      // Merge and deduplicate by timestamp (archive may overlap with main doc edge)
      const combined = [...archivedHistory, ...mainHistory];
      const seen = new Set();
      fullHistory = combined
        .filter(point => {
          if (seen.has(point.timestamp)) return false;
          seen.add(point.timestamp);
          return true;
        })
        .sort((a, b) => a.timestamp - b.timestamp);
    } else {
      // Sort mainHistory to handle any out-of-order timestamps from rapid trades
      fullHistory = [...mainHistory].sort((a, b) => a.timestamp - b.timestamp);
    }

    let data = fullHistory
      .filter(point => point.timestamp >= cutoff)
      .map(point => ({
        ...point,
        date: new Date(point.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        fullDate: new Date(point.timestamp).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
        }),
      }));

    // If not enough data within the time range, find the closest historical price
    if (data.length < 2) {
      const now = Date.now();
      const startTime = range.hours === Infinity ? now - (7 * 24 * 60 * 60 * 1000) : now - (range.hours * 60 * 60 * 1000);

      // Find the price closest to (but before) the cutoff time from full history
      let startPrice = character.basePrice;
      for (let i = fullHistory.length - 1; i >= 0; i--) {
        if (fullHistory[i].timestamp <= cutoff) {
          startPrice = fullHistory[i].price;
          break;
        }
      }
      // If no history before cutoff, use the earliest available price
      if (startPrice === character.basePrice && fullHistory.length > 0) {
        startPrice = fullHistory[0].price;
      }

      // Derive current price from latest history entry (source of truth)
      const latestPrice = fullHistory.length > 0
        ? fullHistory[fullHistory.length - 1].price
        : currentPrice;

      data = [
        {
          timestamp: startTime,
          price: startPrice,
          date: new Date(startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          fullDate: new Date(startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        },
        {
          timestamp: now,
          price: latestPrice,
          date: 'Now',
          fullDate: new Date(now).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        }
      ];
    }

    return data;
  }, [priceHistory, archivedHistory, character.ticker, character.basePrice, currentPrice, timeRange]);

  const hasData = currentData.length >= 2; // Will always be true now
  const prices = hasData ? currentData.map(d => d.price) : [currentPrice];
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice || 1;

  const firstPrice = currentData[0]?.price || currentPrice;
  const lastPrice = currentData[currentData.length - 1]?.price || currentPrice;
  const periodChange = firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;
  const isUp = lastPrice >= firstPrice;

  // Spatial sampling: filter points by minimum pixel distance to prevent needle clusters
  // while preserving significant price movements (peaks and valleys)
  const svgWidth = 600;
  const svgHeight = 300;
  const paddingX = 50;
  const paddingY = 30;
  const chartWidth = svgWidth - paddingX * 2;
  const chartHeight = svgHeight - paddingY * 2;

  // Position points by index (evenly spaced) to match sparkline
  const getX = (index, total) => paddingX + (index / Math.max(total - 1, 1)) * chartWidth;
  const getY = (price) => paddingY + chartHeight - ((price - minPrice) / priceRange) * chartHeight;

  const pathData = currentData.map((d, i) => {
    const x = getX(i, currentData.length);
    const y = getY(d.price);
    return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');

  const areaPath = currentData.length > 0
    ? `${pathData} L ${getX(currentData.length - 1, currentData.length)} ${paddingY + chartHeight} L ${paddingX} ${paddingY + chartHeight} Z`
    : '';

  // Color blind friendly chart colors
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

  // Robinhood-style: find nearest point to cursor/touch position
  const handleChartHover = (e) => {
    if (!chartRef.current || currentData.length === 0) return;

    // Prevent page scrolling on mobile when interacting with chart
    if (e.touches) {
      e.preventDefault();
    }

    const rect = chartRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const mouseX = clientX - rect.left;
    const svgX = (mouseX / rect.width) * svgWidth;

    // Convert SVG X to index (evenly spaced points)
    const hoveredIndex = Math.round(((svgX - paddingX) / chartWidth) * (currentData.length - 1));
    const clampedIndex = Math.max(0, Math.min(currentData.length - 1, hoveredIndex));
    const nearestPoint = currentData[clampedIndex];

    if (nearestPoint) {
      const x = getX(clampedIndex, currentData.length);
      const y = getY(nearestPoint.price);
      setHoveredPoint({ ...nearestPoint, x, y });
    }
  };

  const handleTouchStart = (e) => {
    e.preventDefault(); // Prevent page scroll
    handleChartHover(e);
  };

  const handleTouchEnd = () => {
    setHoveredPoint(null);
  };

  // Display price: hovered if hovering, otherwise latest
  const displayPrice = hoveredPoint?.price || lastPrice;
  const displayChange = firstPrice > 0 ? ((displayPrice - firstPrice) / firstPrice) * 100 : 0;
  const isDisplayUp = displayPrice >= firstPrice;

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
                <span className={`text-2xl font-bold ${textClass}`}>{formatCurrency(displayPrice)}</span>
                <span className={`text-sm font-semibold ${getColors(isDisplayUp).text}`}>
                  {isDisplayUp ? '▲' : '▼'} {formatChange(displayChange)} ({timeRanges.find(t => t.key === timeRange)?.label})
                </span>
              </div>
            </div>
            <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-600 text-xl`}>×</button>
          </div>
        </div>

        {/* Time Range Selector */}
        <div className={`px-4 py-2 border-b ${darkMode ? 'border-zinc-800 bg-zinc-900/50' : 'border-amber-200 bg-amber-50'}`}>
          <div className="flex gap-1">
            {timeRanges.map(range => (
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
            {loadingArchive && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/20 z-10">
                <span className={`${mutedClass} text-sm`}>Loading history...</span>
              </div>
            )}
            <svg
              ref={chartRef}
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className="w-full cursor-crosshair"
              style={{ touchAction: 'none' }}
              onMouseMove={handleChartHover}
              onMouseLeave={() => setHoveredPoint(null)}
              onTouchStart={handleTouchStart}
              onTouchMove={handleChartHover}
              onTouchEnd={handleTouchEnd}
            >
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

              {/* Hovered point indicator */}
              {hoveredPoint && (
                <circle
                  cx={hoveredPoint.x}
                  cy={hoveredPoint.y}
                  r={5}
                  fill={strokeColor}
                  stroke={darkMode ? '#1e293b' : '#ffffff'}
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
              <div className={`font-semibold ${textClass}`}>{formatCurrency(currentPrice)}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChartModal;
