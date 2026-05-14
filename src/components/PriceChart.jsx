import React, { useState, useEffect, useMemo, useRef } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAppContext } from '../context/AppContext';

const TIME_RANGES = [
  { key: '1d', label: 'Today', hours: 24 },
  { key: '7d', label: '7 Days', hours: 168 },
  { key: '1m', label: '1 Month', hours: 720 },
  { key: '3m', label: '3 Months', hours: 2160 },
  { key: '1y', label: '1 Year', hours: 8760 },
  { key: 'all', label: 'All Time', hours: Infinity },
];

const SVG_W = 600;
const SVG_H = 300;
const PAD_X = 50;
const PAD_Y = 30;
const CHART_W = SVG_W - PAD_X * 2;
const CHART_H = SVG_H - PAD_Y * 2;

const getX = (i, total) => PAD_X + (i / Math.max(total - 1, 1)) * CHART_W;
const getY = (price, min, range) => PAD_Y + CHART_H - ((price - min) / range) * CHART_H;

const PriceChart = ({ ticker, basePrice, currentPrice, timeRange, chartType = 'area', onHover }) => {
  const { darkMode, userData, priceHistory } = useAppContext();
  const colorBlindMode = userData?.colorBlindMode || false;
  const [archivedHistory, setArchivedHistory] = useState([]);
  const [loadingArchive, setLoadingArchive] = useState(false);
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const chartRef = useRef(null);

  useEffect(() => {
    const needsArchive = ['1m', '3m', '1y', 'all'].includes(timeRange);
    if (needsArchive && archivedHistory.length === 0) {
      setLoadingArchive(true);
      getDoc(doc(db, 'market', 'current', 'price_history', ticker))
        .then(snap => { if (snap.exists()) setArchivedHistory(snap.data().history || []); })
        .catch(() => {})
        .finally(() => setLoadingArchive(false));
    }
  }, [timeRange, ticker, archivedHistory.length]);

  const currentData = useMemo(() => {
    const range = TIME_RANGES.find(r => r.key === timeRange);
    const cutoff = range.hours === Infinity ? 0 : Date.now() - range.hours * 3600000;
    const mainHistory = priceHistory[ticker] || [];
    const needsArchive = ['1m', '3m', '1y', 'all'].includes(timeRange);

    let fullHistory;
    if (needsArchive) {
      const seen = new Set();
      fullHistory = [...archivedHistory, ...mainHistory]
        .filter(p => { if (seen.has(p.timestamp)) return false; seen.add(p.timestamp); return true; })
        .sort((a, b) => a.timestamp - b.timestamp);
    } else {
      fullHistory = [...mainHistory].sort((a, b) => a.timestamp - b.timestamp);
    }

    let data = fullHistory
      .filter(p => p.timestamp >= cutoff)
      .map(p => ({
        ...p,
        fullDate: new Date(p.timestamp).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
        }),
      }));

    if (data.length < 2) {
      const now = Date.now();
      const startTime = range.hours === Infinity ? now - 7 * 86400000 : now - range.hours * 3600000;
      let startPrice = basePrice;
      for (let i = fullHistory.length - 1; i >= 0; i--) {
        if (fullHistory[i].timestamp <= cutoff) { startPrice = fullHistory[i].price; break; }
      }
      if (startPrice === basePrice && fullHistory.length > 0) startPrice = fullHistory[0].price;
      const latestPrice = fullHistory.length > 0 ? fullHistory[fullHistory.length - 1].price : currentPrice;
      data = [
        { timestamp: startTime, price: startPrice, fullDate: new Date(startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) },
        { timestamp: now, price: latestPrice, fullDate: 'Now' },
      ];
    }
    return data;
  }, [priceHistory, archivedHistory, ticker, basePrice, currentPrice, timeRange]);

  const prices = currentData.map(d => d.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice || 1;

  const firstPrice = currentData[0]?.price || currentPrice;
  const lastPrice = currentData[currentData.length - 1]?.price || currentPrice;
  const isUp = lastPrice >= firstPrice;

  const upColor = colorBlindMode ? '#14b8a6' : '#22c55e';
  const downColor = colorBlindMode ? '#a855f7' : '#ef4444';
  const strokeColor = isUp ? upColor : downColor;
  const fillColor = isUp
    ? (colorBlindMode ? 'rgba(20,184,166,0.1)' : 'rgba(34,197,94,0.1)')
    : (colorBlindMode ? 'rgba(168,85,247,0.1)' : 'rgba(239,68,68,0.1)');

  const pathData = currentData.map((d, i) =>
    `${i === 0 ? 'M' : 'L'} ${getX(i, currentData.length)} ${getY(d.price, minPrice, priceRange)}`
  ).join(' ');

  const areaPath = currentData.length > 0
    ? `${pathData} L ${getX(currentData.length - 1, currentData.length)} ${PAD_Y + CHART_H} L ${PAD_X} ${PAD_Y + CHART_H} Z`
    : '';

  const handleMove = (e) => {
    if (!chartRef.current || currentData.length === 0) return;
    if (e.touches) e.preventDefault();
    const rect = chartRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const svgX = ((clientX - rect.left) / rect.width) * SVG_W;
    const idx = Math.max(0, Math.min(currentData.length - 1,
      Math.round(((svgX - PAD_X) / CHART_W) * (currentData.length - 1))
    ));
    const p = currentData[idx];
    if (p) {
      const point = { ...p, x: getX(idx, currentData.length), y: getY(p.price, minPrice, priceRange) };
      setHoveredPoint(point);
      onHover?.(p);
    }
  };

  return (
    <div className="relative">
      {loadingArchive && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 z-10">
          <span className="text-zinc-400 text-sm">Loading history...</span>
        </div>
      )}
      <svg
        ref={chartRef}
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        className="w-full cursor-crosshair"
        style={{ touchAction: 'none' }}
        onMouseMove={handleMove}
        onMouseLeave={() => { setHoveredPoint(null); onHover?.(null); }}
        onTouchStart={e => { e.preventDefault(); handleMove(e); }}
        onTouchMove={handleMove}
        onTouchEnd={() => { setHoveredPoint(null); onHover?.(null); }}
      >
        {/* Grid */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
          const y = PAD_Y + ratio * CHART_H;
          const price = maxPrice - ratio * priceRange;
          return (
            <g key={i}>
              <line x1={PAD_X} y1={y} x2={SVG_W - PAD_X} y2={y}
                stroke={darkMode ? '#334155' : '#e2e8f0'} strokeWidth="1" />
              <text x={PAD_X - 8} y={y + 4} textAnchor="end"
                fill={darkMode ? '#64748b' : '#94a3b8'} fontSize="10">
                ${price.toFixed(0)}
              </text>
            </g>
          );
        })}

        {/* Area */}
        {chartType === 'area' && <path d={areaPath} fill={fillColor} />}

        {/* Line */}
        {(chartType === 'area' || chartType === 'line') && (
          <path d={pathData} fill="none" stroke={strokeColor} strokeWidth="2" />
        )}

        {/* Bar */}
        {chartType === 'bar' && currentData.map((d, i) => {
          const x = getX(i, currentData.length);
          const y = getY(d.price, minPrice, priceRange);
          const barBottom = PAD_Y + CHART_H;
          const prevPrice = i > 0 ? currentData[i - 1].price : d.price;
          const barUp = d.price >= prevPrice;
          const barW = Math.max(1, (CHART_W / currentData.length) * 0.75);
          return (
            <rect key={i} x={x - barW / 2} y={y} width={barW}
              height={Math.max(1, barBottom - y)}
              fill={barUp ? upColor : downColor} opacity={0.75} />
          );
        })}

        {/* Hover dot + line */}
        {hoveredPoint && (
          <>
            <line x1={hoveredPoint.x} y1={PAD_Y} x2={hoveredPoint.x} y2={PAD_Y + CHART_H}
              stroke={darkMode ? '#475569' : '#cbd5e1'} strokeDasharray="4" />
            <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r={5}
              fill={strokeColor} stroke={darkMode ? '#1e293b' : '#ffffff'} strokeWidth={2} />
          </>
        )}
      </svg>

      {/* Tooltip */}
      {hoveredPoint && (
        <div
          className={`absolute pointer-events-none px-3 py-2 rounded-sm shadow-lg text-sm z-10 ${
            darkMode ? 'bg-zinc-800 text-zinc-100' : 'bg-white text-slate-900 border'
          }`}
          style={{
            left: `${(hoveredPoint.x / SVG_W) * 100}%`,
            top: `${(hoveredPoint.y / SVG_H) * 100}%`,
            transform: 'translate(-50%, -130%)',
          }}
        >
          <div className="font-bold text-orange-400">${hoveredPoint.price.toFixed(2)}</div>
          <div className="text-xs opacity-60">{hoveredPoint.fullDate}</div>
        </div>
      )}
    </div>
  );
};

export { TIME_RANGES };
export default PriceChart;
