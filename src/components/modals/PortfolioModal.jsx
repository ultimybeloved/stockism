import React, { useState, useMemo, useEffect } from 'react';
import { CHARACTER_MAP } from '../../characters';
import { formatCurrency, formatChange, formatNumber } from '../../utils/formatters';
import LimitOrders from '../LimitOrders';
import { db } from '../../firebase';
import { collection, query, where, orderBy, getDocs, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { useAppContext } from '../../context/AppContext';

const SimpleLineChart = ({ data, darkMode, colorBlindMode = false }) => {
  if (!data || data.length < 2) return null;

  const prices = data.map(d => d.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice || 1;

  const width = 100;
  const height = 32;
  const padding = 2;

  const points = data.map((d, i) => {
    const x = padding + (i / (data.length - 1)) * (width - padding * 2);
    const y = height - padding - ((d.price - minPrice) / priceRange) * (height - padding * 2);
    return `${x},${y}`;
  }).join(' ');

  const firstPrice = data[0]?.price || 0;
  const lastPrice = data[data.length - 1]?.price || 0;
  const isUp = lastPrice >= firstPrice;

  // Color blind friendly colors: teal (up) / purple (down)
  const strokeColor = colorBlindMode
    ? (isUp ? '#14b8a6' : '#a855f7')  // teal-500 / purple-500
    : (isUp ? '#22c55e' : '#ef4444'); // green-500 / red-500

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-10">
      <polyline
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.5"
        points={points}
      />
    </svg>
  );
};

const PortfolioModal = ({ holdings, shorts, prices, portfolioHistory, currentValue, onClose, onTrade, onLimitSell, darkMode, costBasis, priceHistory, colorBlindMode = false, user }) => {
  const { showNotification } = useAppContext();
  const [sellAmounts, setSellAmounts] = useState({});
  const [coverAmounts, setCoverAmounts] = useState({});
  const [showChart, setShowChart] = useState(true);
  const [timeRange, setTimeRange] = useState('1d');
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [expandedTicker, setExpandedTicker] = useState(null);
  const [expandedShortTicker, setExpandedShortTicker] = useState(null);
  const [pendingOrders, setPendingOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';

  // Helper to get price from 24h ago
  const getPrice24hAgo = (ticker) => {
    const history = priceHistory?.[ticker] || [];
    if (history.length === 0) return prices[ticker] || CHARACTER_MAP[ticker]?.basePrice || 0;

    const dayAgo = Date.now() - (24 * 60 * 60 * 1000);
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].timestamp <= dayAgo) {
        return history[i].price;
      }
    }
    return history[0]?.price || prices[ticker] || 0;
  };

  const portfolioItems = useMemo(() => {
    return Object.entries(holdings)
      .filter(([_, shares]) => shares > 0)
      .map(([ticker, shares]) => {
        const character = CHARACTER_MAP[ticker];
        const currentPrice = prices[ticker] || character?.basePrice || 0;
        const value = currentPrice * shares;
        const avgCost = costBasis?.[ticker] || character?.basePrice || currentPrice;
        const totalCost = avgCost * shares;

        // Total return (from avg cost)
        const totalReturnDollar = value - totalCost;
        const totalReturnPercent = totalCost > 0 ? ((value - totalCost) / totalCost) * 100 : 0;

        // Today's return (from 24h ago price)
        const price24hAgo = getPrice24hAgo(ticker);
        const value24hAgo = price24hAgo * shares;
        const todayReturnDollar = value - value24hAgo;
        const todayReturnPercent = value24hAgo > 0 ? ((value - value24hAgo) / value24hAgo) * 100 : 0;

        return {
          ticker,
          shares,
          character,
          currentPrice,
          value,
          avgCost,
          totalCost,
          totalReturnDollar,
          totalReturnPercent,
          todayReturnDollar,
          todayReturnPercent
        };
      })
      .sort((a, b) => b.value - a.value);
  }, [holdings, prices, costBasis, priceHistory]);

  const shortItems = useMemo(() => {
    return Object.entries(shorts || {})
      .filter(([_, position]) => position && position.shares > 0)
      .map(([ticker, position]) => {
        const character = CHARACTER_MAP[ticker];
        const currentPrice = prices[ticker] || character?.basePrice || position.costBasis || position.entryPrice || 0;
        const entryPrice = Number(position.costBasis || position.entryPrice) || 0;
        const shares = Number(position.shares) || 0;
        const margin = Number(position.margin) || 0;

        // P/L calculation: profit when price goes down
        const profitPerShare = entryPrice - currentPrice;
        const totalPL = profitPerShare * shares;
        const totalPLPercent = entryPrice > 0 ? (profitPerShare / entryPrice) * 100 : 0;

        // Current equity in the position
        const equity = margin + totalPL;
        const safeEquity = isNaN(equity) ? margin : equity;
        const equityRatio = currentPrice > 0 && shares > 0 ? safeEquity / (currentPrice * shares) : 1;
        const positionValue = safeEquity;

        return {
          ticker,
          character,
          shares,
          entryPrice,
          currentPrice,
          margin,
          totalPL: isNaN(totalPL) ? 0 : totalPL,
          totalPLPercent: isNaN(totalPLPercent) ? 0 : totalPLPercent,
          equity: safeEquity,
          equityRatio: isNaN(equityRatio) ? 1 : equityRatio,
          positionValue,
          openedAt: position.openedAt
        };
      })
      .sort((a, b) => b.positionValue - a.positionValue);
  }, [shorts, prices]);

  const totalShortsValue = shortItems.reduce((sum, item) => sum + item.positionValue, 0);

  const totalValue = portfolioItems.reduce((sum, item) => sum + item.value, 0);
  const totalCostBasis = portfolioItems.reduce((sum, item) => sum + item.totalCost, 0);
  const overallTotalReturn = totalValue - totalCostBasis;
  const overallTotalReturnPercent = totalCostBasis > 0 ? ((totalValue - totalCostBasis) / totalCostBasis) * 100 : 0;
  const overallTodayReturn = portfolioItems.reduce((sum, item) => sum + item.todayReturnDollar, 0);

  const handleSell = (ticker, amount) => {
    onTrade(ticker, 'sell', amount);
  };

  const handleCover = (ticker, amount) => {
    onTrade(ticker, 'cover', amount);
  };

  const toggleExpand = (ticker) => {
    setExpandedTicker(expandedTicker === ticker ? null : ticker);
  };

  const toggleShortExpand = (ticker) => {
    setExpandedShortTicker(expandedShortTicker === ticker ? null : ticker);
  };

  // Load pending limit orders
  useEffect(() => {
    if (!user) return;

    const loadPendingOrders = async () => {
      try {
        const ordersRef = collection(db, 'limitOrders');
        const q = query(
          ordersRef,
          where('userId', '==', user.uid),
          where('status', 'in', ['PENDING', 'PARTIALLY_FILLED']),
          orderBy('createdAt', 'desc')
        );

        const snapshot = await getDocs(q);
        const orders = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));

        setPendingOrders(orders);
      } catch (error) {
        console.error('Error loading orders:', error);
      }
    };

    loadPendingOrders();
  }, [user]);

  const handleCancelOrder = async (orderId) => {
    if (!confirm('Cancel this limit order?')) return;

    setLoadingOrders(true);
    try {
      await updateDoc(doc(db, 'limitOrders', orderId), {
        status: 'CANCELED',
        updatedAt: serverTimestamp()
      });

      // Remove from list immediately
      setPendingOrders(prev => prev.filter(o => o.id !== orderId));
    } catch (error) {
      console.error('Error canceling order:', error);
      showNotification('error', `Failed to cancel order: ${error.message}`);
    }
    setLoadingOrders(false);
  };

  // Chart data processing
  const timeRanges = [
    { key: '1d', label: '24h', hours: 24 },
    { key: '7d', label: '7D', hours: 168 },
    { key: '1m', label: '1M', hours: 720 },
    { key: 'all', label: 'All', hours: Infinity },
  ];

  const chartData = useMemo(() => {
    if (!portfolioHistory || portfolioHistory.length === 0) {
      // No history at all - create two points for a flat line
      const now = Date.now();
      return [
        { timestamp: now - 60000, value: currentValue, date: 'Now', fullDate: 'Now' },
        { timestamp: now, value: currentValue, date: 'Now', fullDate: 'Now' }
      ];
    }

    const range = timeRanges.find(r => r.key === timeRange);
    const cutoff = range.hours === Infinity ? 0 : Date.now() - (range.hours * 60 * 60 * 1000);

    let data = portfolioHistory
      .filter(point => point.timestamp >= cutoff)
      .map(point => ({
        ...point,
        date: new Date(point.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        fullDate: new Date(point.timestamp).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        }),
      }));

    // Sample down to ~20 points for cleaner interaction
    const maxPoints = 20;
    if (data.length > maxPoints) {
      const step = Math.floor(data.length / maxPoints);
      const sampled = [];
      for (let i = 0; i < data.length; i += step) {
        sampled.push(data[i]);
      }
      // Always include the last point
      if (sampled[sampled.length - 1] !== data[data.length - 1]) {
        sampled.push(data[data.length - 1]);
      }
      data = sampled;
    }

    // If only 1 point, add current value as second point to show a line
    if (data.length === 1) {
      data = [
        ...data,
        { timestamp: Date.now(), value: currentValue, date: 'Now', fullDate: 'Now' }
      ];
    }

    // If no data in range, show current value as flat line
    if (data.length === 0) {
      const now = Date.now();
      data = [
        { timestamp: now - 60000, value: currentValue, date: 'Now', fullDate: 'Now' },
        { timestamp: now, value: currentValue, date: 'Now', fullDate: 'Now' }
      ];
    }

    return data;
  }, [portfolioHistory, timeRange, currentValue]);

  const hasChartData = chartData.length >= 2; // Will always be true now
  const chartValues = hasChartData ? chartData.map(d => d.value) : [currentValue];
  const minValue = Math.min(...chartValues);
  const maxValue = Math.max(...chartValues);
  const valueRange = maxValue - minValue || 1;

  const firstValue = chartData[0]?.value || currentValue;
  const lastValue = chartData[chartData.length - 1]?.value || currentValue;
  const periodChange = firstValue > 0 ? ((lastValue - firstValue) / firstValue) * 100 : 0;
  const isUp = lastValue >= firstValue;

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
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className={`w-full max-w-2xl ${cardClass} border rounded-sm shadow-xl overflow-hidden max-h-[90vh] flex flex-col`}
        onClick={e => e.stopPropagation()}>

        <div className={`p-4 border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
          <div className="flex justify-between items-center">
            <div>
              <h2 className={`text-lg font-semibold ${textClass}`}>Your Portfolio</h2>
              <div className="flex items-baseline gap-2 mt-1">
                <span className={`text-xl font-bold ${textClass}`}>{formatCurrency(currentValue)}</span>
                {hasChartData && (
                  <span className={`text-sm font-semibold ${colorBlindMode ? (isUp ? 'text-teal-500' : 'text-purple-500') : (isUp ? 'text-green-500' : 'text-red-500')}`}>
                    {isUp ? '▲' : '▼'} {formatCurrency(Math.abs(lastValue - firstValue))} ({formatChange(periodChange)})
                  </span>
                )}
              </div>
            </div>
            <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-600 text-xl`}>×</button>
          </div>
        </div>

        {/* Portfolio Chart */}
        <div className={`border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
          <div className="flex items-center justify-between px-4 py-2">
            <button
              onClick={() => setShowChart(!showChart)}
              className={`text-xs font-semibold ${mutedClass} hover:text-orange-500`}
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

          {showChart && (
            <div className={`px-4 pb-4 ${darkMode ? 'bg-zinc-950/50' : 'bg-amber-50'} relative`}>
              <svg
                viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                className="w-full"
              >
                {/* Grid lines */}
                {[0, 0.5, 1].map((ratio, i) => {
                  const y = paddingY + ratio * chartHeight;
                  const value = maxValue - ratio * valueRange;
                  return (
                    <g key={i}>
                      <line x1={paddingX} y1={y} x2={svgWidth - paddingX} y2={y}
                        stroke={darkMode ? '#334155' : '#e2e8f0'} strokeWidth="1" />
                      <text x={paddingX - 5} y={y + 4} textAnchor="end"
                        fill={darkMode ? '#64748b' : '#94a3b8'} fontSize="9">
                        ${(value / 1000).toFixed(1)}k
                      </text>
                    </g>
                  );
                })}

                {/* Area fill */}
                <path d={areaPath} fill={fillColor} />

                {/* Line */}
                <path d={pathData} fill="none" stroke={strokeColor} strokeWidth="2" />

                {/* Dots for each data point */}
                {chartData.map((point, i) => {
                  const x = getX(i);
                  const y = getY(point.value);
                  const isHovered = hoveredPoint === i;

                  return (
                    <circle
                      key={i}
                      cx={x}
                      cy={y}
                      r={isHovered ? 6 : 4}
                      fill={isHovered ? strokeColor : (darkMode ? '#1e293b' : '#f8fafc')}
                      stroke={strokeColor}
                      strokeWidth={2}
                    />
                  );
                })}

                {/* Hover vertical line */}
                {hoveredPoint !== null && (
                  <line
                    x1={getX(hoveredPoint)}
                    y1={paddingY}
                    x2={getX(hoveredPoint)}
                    y2={paddingY + chartHeight}
                    stroke={strokeColor}
                    strokeWidth="1"
                    strokeDasharray="4,4"
                    opacity="0.5"
                  />
                )}
              </svg>

              {/* Invisible hit areas as absolute positioned divs */}
              {chartData.map((point, i) => {
                const xPercent = (getX(i) / svgWidth) * 100;
                const yPercent = (getY(point.value) / svgHeight) * 100;

                return (
                  <div
                    key={i}
                    className="absolute w-8 h-8 -translate-x-1/2 -translate-y-1/2 cursor-pointer"
                    style={{ left: `${xPercent}%`, top: `${yPercent}%` }}
                    onMouseEnter={() => setHoveredPoint(i)}
                    onMouseLeave={() => setHoveredPoint(null)}
                    onClick={() => setHoveredPoint(hoveredPoint === i ? null : i)}
                  />
                );
              })}

              {/* Tooltip */}
              {hoveredPoint !== null && chartData[hoveredPoint] && (
                <div
                  className={`absolute pointer-events-none px-3 py-2 rounded-sm shadow-lg text-xs z-10 ${
                    darkMode ? 'bg-zinc-800 text-zinc-100' : 'bg-zinc-900 text-white'
                  }`}
                  style={{
                    left: `${(getX(hoveredPoint) / svgWidth) * 100}%`,
                    top: `${(getY(chartData[hoveredPoint].value) / svgHeight) * 100}%`,
                    transform: 'translate(-50%, -130%)'
                  }}
                >
                  <div className="font-bold text-orange-400">{formatCurrency(chartData[hoveredPoint].value)}</div>
                  <div className="text-zinc-400">{chartData[hoveredPoint].fullDate}</div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {portfolioItems.length === 0 && shortItems.length === 0 ? (
            <div className={`text-center py-8 ${mutedClass}`}>
              <p className="text-lg mb-2">📭 No positions yet</p>
              <p className="text-sm">Start trading to build your portfolio!</p>
            </div>
          ) : (
            <>
              {/* Holdings List */}
              {portfolioItems.length > 0 && (
                <>
                  <h3 className={`text-sm font-semibold ${textClass} mb-2 flex items-center gap-2`}>
                    <span className={colorBlindMode ? 'text-teal-500' : 'text-green-500'}>📈</span> Long Positions
                    <span className={`text-xs font-normal ${mutedClass}`}>({portfolioItems.length})</span>
                  </h3>
                  <div className="space-y-2">
                    {portfolioItems.map(item => {
                  const isExpanded = expandedTicker === item.ticker;
                  const diversityPercent = totalValue > 0 ? (item.value / totalValue) * 100 : 0;

                  return (
                    <div key={item.ticker} className={`rounded-sm border ${darkMode ? 'border-zinc-800 bg-zinc-900/50' : 'border-amber-200 bg-amber-50'}`}>
                      {/* Main Row - Clickable */}
                      <div
                        className="p-3 cursor-pointer hover:bg-opacity-80"
                        onClick={() => toggleExpand(item.ticker)}
                      >
                        <div className="flex justify-between items-center">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-orange-600 font-mono font-semibold">${item.ticker}</span>
                              <span className={`text-sm ${mutedClass}`}>{item.character?.name}</span>
                              <span className={`text-xs ${mutedClass}`}>
                                {isExpanded ? '▼' : '▶'}
                              </span>
                            </div>
                            <div className={`text-sm ${mutedClass} mt-0.5`}>
                              {item.shares} shares • {diversityPercent.toFixed(1)}% of portfolio
                            </div>
                          </div>
                          <div className="text-right">
                            <div className={`font-semibold ${textClass}`}>{formatCurrency(item.value)}</div>
                            <div className={`text-xs ${item.totalReturnPercent >= 0 ? (colorBlindMode ? 'text-teal-500' : 'text-green-500') : (colorBlindMode ? 'text-purple-500' : 'text-red-500')}`}>
                              {item.totalReturnPercent >= 0 ? '▲' : '▼'} {formatCurrency(Math.abs(item.totalReturnDollar))} ({item.totalReturnPercent >= 0 ? '+' : ''}{item.totalReturnPercent.toFixed(2)}%)
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Expanded Details */}
                      {isExpanded && (
                        <div className={`px-3 pb-3 border-t ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
                          {/* Stats Grid */}
                          <div className="grid grid-cols-2 gap-3 mt-3 mb-3">
                            <div className={`p-2 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-white'}`}>
                              <div className={`text-xs ${mutedClass}`}>Avg Cost / Share</div>
                              <div className={`font-semibold ${textClass}`}>{formatCurrency(item.avgCost)}</div>
                            </div>
                            <div className={`p-2 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-white'}`}>
                              <div className={`text-xs ${mutedClass}`}>Current Price</div>
                              <div className={`font-semibold ${textClass}`}>{formatCurrency(item.currentPrice)}</div>
                            </div>
                            <div className={`p-2 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-white'}`}>
                              <div className={`text-xs ${mutedClass}`}>Today's Return</div>
                              <div className={`font-semibold ${item.todayReturnDollar >= 0 ? (colorBlindMode ? 'text-teal-500' : 'text-green-500') : (colorBlindMode ? 'text-purple-500' : 'text-red-500')}`}>
                                {item.todayReturnDollar >= 0 ? '+' : ''}{formatCurrency(item.todayReturnDollar)}
                                <span className="text-xs ml-1">({item.todayReturnPercent >= 0 ? '+' : ''}{item.todayReturnPercent.toFixed(2)}%)</span>
                              </div>
                            </div>
                            <div className={`p-2 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-white'}`}>
                              <div className={`text-xs ${mutedClass}`}>Total Return</div>
                              <div className={`font-semibold ${item.totalReturnDollar >= 0 ? (colorBlindMode ? 'text-teal-500' : 'text-green-500') : (colorBlindMode ? 'text-purple-500' : 'text-red-500')}`}>
                                {item.totalReturnDollar >= 0 ? '+' : ''}{formatCurrency(item.totalReturnDollar)}
                                <span className="text-xs ml-1">({item.totalReturnPercent >= 0 ? '+' : ''}{item.totalReturnPercent.toFixed(2)}%)</span>
                              </div>
                            </div>
                          </div>

                          {/* Portfolio Diversity Bar */}
                          <div className="mb-3">
                            <div className={`text-xs ${mutedClass} mb-1`}>Portfolio Weight: {diversityPercent.toFixed(1)}%</div>
                            <div className={`h-2 rounded-full ${darkMode ? 'bg-zinc-800' : 'bg-zinc-200'}`}>
                              <div
                                className="h-full rounded-full bg-orange-500"
                                style={{ width: `${Math.min(100, diversityPercent)}%` }}
                              />
                            </div>
                          </div>

                          {/* Sell Controls */}
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min="1"
                              max={item.shares}
                              value={sellAmounts[item.ticker] === '' ? '' : (sellAmounts[item.ticker] || 1)}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === '') {
                                  setSellAmounts(prev => ({ ...prev, [item.ticker]: '' }));
                                } else {
                                  const num = parseInt(val) || 0;
                                  setSellAmounts(prev => ({
                                    ...prev,
                                    [item.ticker]: Math.min(item.shares, Math.max(0, num))
                                  }));
                                }
                              }}
                              onBlur={() => {
                                const current = sellAmounts[item.ticker];
                                if (current === '' || current < 1) {
                                  setSellAmounts(prev => ({ ...prev, [item.ticker]: 1 }));
                                }
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className={`w-20 px-2 py-1 text-sm text-center rounded-sm border ${
                                darkMode ? 'bg-zinc-950 border-zinc-700 text-zinc-100' : 'bg-white border-amber-200'
                              }`}
                            />
                            <button
                              onClick={(e) => { e.stopPropagation(); handleSell(item.ticker, Math.max(1, sellAmounts[item.ticker] || 1)); }}
                              className="px-4 py-1.5 text-xs font-semibold uppercase bg-red-600 hover:bg-red-700 text-white rounded-sm"
                            >
                              Sell
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleSell(item.ticker, item.shares); }}
                              className={`px-3 py-1.5 text-xs font-semibold rounded-sm ${
                                darkMode ? 'bg-zinc-800 text-zinc-300 hover:bg-slate-600' : 'bg-slate-200 text-zinc-600 hover:bg-slate-300'
                              }`}
                            >
                              Sell All
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); onLimitSell && onLimitSell(item.ticker, 'sell'); }}
                              className={`px-3 py-1.5 text-xs font-semibold rounded-sm border ${
                                darkMode ? 'border-red-600 text-red-400 hover:bg-red-950' : 'border-red-600 text-red-600 hover:bg-red-50'
                              }`}
                            >
                              Limit Sell
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                    })}
                  </div>
                </>
              )}

              {/* Short Positions Section */}
              {shortItems.length > 0 && (
                <div className={`mt-4 pt-4 border-t ${darkMode ? 'border-zinc-700' : 'border-amber-300'}`}>
                  <h3 className={`text-sm font-semibold ${textClass} mb-2 flex items-center gap-2`}>
                    <span className="text-orange-500">📉</span> Short Positions
                    <span className={`text-xs font-normal ${mutedClass}`}>({shortItems.length})</span>
                  </h3>
                  <div className="space-y-2">
                    {shortItems.map(item => {
                      const isExpanded = expandedShortTicker === item.ticker;
                      const isAtRisk = item.equityRatio < 0.35; // Warning when below 35%

                      return (
                        <div key={`short-${item.ticker}`} className={`rounded-sm border ${
                          isAtRisk
                            ? 'border-orange-500 bg-orange-500/10'
                            : darkMode ? 'border-zinc-800 bg-zinc-900/50' : 'border-amber-200 bg-amber-50'
                        }`}>
                          {/* Main Row - Clickable */}
                          <div
                            className="p-3 cursor-pointer hover:bg-opacity-80"
                            onClick={() => toggleShortExpand(item.ticker)}
                          >
                            <div className="flex justify-between items-center">
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-orange-600 font-mono font-semibold">${item.ticker}</span>
                                  <span className={`text-xs px-1.5 py-0.5 rounded ${darkMode ? 'bg-orange-900/50 text-orange-400' : 'bg-orange-100 text-orange-600'}`}>SHORT</span>
                                  <span className={`text-sm ${mutedClass}`}>{item.character?.name}</span>
                                  <span className={`text-xs ${mutedClass}`}>
                                    {isExpanded ? '▼' : '▶'}
                                  </span>
                                </div>
                                <div className={`text-sm ${mutedClass} mt-0.5`}>
                                  {item.shares} shares shorted
                                  {isAtRisk && <span className="text-orange-500 ml-2">⚠️ Margin Warning</span>}
                                </div>
                              </div>
                              <div className="text-right">
                                <div className={`font-semibold ${item.totalPL >= 0 ? (colorBlindMode ? 'text-teal-500' : 'text-green-500') : (colorBlindMode ? 'text-purple-500' : 'text-red-500')}`}>
                                  {item.totalPL >= 0 ? '+' : ''}{formatCurrency(item.totalPL)}
                                </div>
                                <div className={`text-xs ${item.totalPL >= 0 ? (colorBlindMode ? 'text-teal-500' : 'text-green-500') : (colorBlindMode ? 'text-purple-500' : 'text-red-500')}`}>
                                  {item.totalPL >= 0 ? '▲' : '▼'} {Math.abs(item.totalPLPercent).toFixed(2)}%
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Expanded Details */}
                          {isExpanded && (
                            <div className={`px-3 pb-3 border-t ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
                              {/* Stats Grid */}
                              <div className="grid grid-cols-2 gap-3 mt-3 mb-3">
                                <div className={`p-2 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-white'}`}>
                                  <div className={`text-xs ${mutedClass}`}>Entry Price</div>
                                  <div className={`font-semibold ${textClass}`}>{formatCurrency(item.entryPrice)}</div>
                                </div>
                                <div className={`p-2 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-white'}`}>
                                  <div className={`text-xs ${mutedClass}`}>Current Price</div>
                                  <div className={`font-semibold ${textClass}`}>{formatCurrency(item.currentPrice)}</div>
                                </div>
                                <div className={`p-2 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-white'}`}>
                                  <div className={`text-xs ${mutedClass}`}>Margin Posted</div>
                                  <div className={`font-semibold ${textClass}`}>{formatCurrency(item.margin)}</div>
                                </div>
                                <div className={`p-2 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-white'}`}>
                                  <div className={`text-xs ${mutedClass}`}>Current Equity</div>
                                  <div className={`font-semibold ${item.equity >= item.margin ? (colorBlindMode ? 'text-teal-500' : 'text-green-500') : (colorBlindMode ? 'text-purple-500' : 'text-red-500')}`}>
                                    {formatCurrency(item.equity)}
                                  </div>
                                </div>
                              </div>

                              {/* Equity Ratio Bar */}
                              <div className="mb-3">
                                <div className={`text-xs ${mutedClass} mb-1 flex justify-between`}>
                                  <span>Equity Ratio: {(item.equityRatio * 100).toFixed(1)}%</span>
                                  <span className={isAtRisk ? 'text-orange-500' : (colorBlindMode ? 'text-teal-500' : 'text-green-500')}>
                                    {isAtRisk ? 'Liquidation at 25%' : 'Healthy'}
                                  </span>
                                </div>
                                <div className={`h-2 rounded-full ${darkMode ? 'bg-zinc-800' : 'bg-zinc-200'}`}>
                                  <div
                                    className={`h-full rounded-full ${
                                      item.equityRatio < 0.25 ? (colorBlindMode ? 'bg-purple-500' : 'bg-red-500') :
                                      item.equityRatio < 0.35 ? 'bg-orange-500' : (colorBlindMode ? 'bg-teal-500' : 'bg-green-500')
                                    }`}
                                    style={{ width: `${Math.min(100, Math.max(0, item.equityRatio * 100))}%` }}
                                  />
                                </div>
                              </div>

                              {/* Cover Controls */}
                              <div className="flex items-center gap-2">
                                <input
                                  type="number"
                                  min="1"
                                  max={item.shares}
                                  value={coverAmounts[item.ticker] === '' ? '' : (coverAmounts[item.ticker] || 1)}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    if (val === '') {
                                      setCoverAmounts(prev => ({ ...prev, [item.ticker]: '' }));
                                    } else {
                                      const num = parseInt(val) || 0;
                                      setCoverAmounts(prev => ({
                                        ...prev,
                                        [item.ticker]: Math.min(item.shares, Math.max(0, num))
                                      }));
                                    }
                                  }}
                                  onBlur={() => {
                                    const current = coverAmounts[item.ticker];
                                    if (current === '' || current < 1) {
                                      setCoverAmounts(prev => ({ ...prev, [item.ticker]: 1 }));
                                    }
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  className={`w-20 px-2 py-1 text-sm text-center rounded-sm border ${
                                    darkMode ? 'bg-zinc-950 border-zinc-700 text-zinc-100' : 'bg-white border-amber-200'
                                  }`}
                                />
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleCover(item.ticker, Math.max(1, coverAmounts[item.ticker] || 1)); }}
                                  className="px-4 py-1.5 text-xs font-semibold uppercase bg-green-600 hover:bg-green-700 text-white rounded-sm"
                                >
                                  Cover
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleCover(item.ticker, item.shares); }}
                                  className={`px-3 py-1.5 text-xs font-semibold rounded-sm ${
                                    darkMode ? 'bg-zinc-800 text-zinc-300 hover:bg-slate-600' : 'bg-slate-200 text-zinc-600 hover:bg-slate-300'
                                  }`}
                                >
                                  Cover All
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Pending Limit Orders Section */}
              {pendingOrders.length > 0 && (
                <div className="mt-6">
                  <div className="flex items-center gap-2 mb-3">
                    <h3 className={`text-lg font-bold ${textClass}`}>Pending Limit Orders</h3>
                    <span className={`text-sm px-2 py-0.5 rounded ${darkMode ? 'bg-blue-900 text-blue-200' : 'bg-blue-100 text-blue-700'}`}>
                      {pendingOrders.length}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {pendingOrders.map(order => {
                      const character = CHARACTER_MAP[order.ticker];
                      const currentPrice = prices[order.ticker] || 0;
                      const isClose = order.limitPrice > 0 && Math.abs(currentPrice - order.limitPrice) / order.limitPrice < 0.05;

                      return (
                        <div
                          key={order.id}
                          className={`p-3 border rounded-sm ${darkMode ? 'bg-zinc-800 border-zinc-700' : 'bg-slate-50 border-slate-300'}`}
                        >
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <div className={`font-bold ${textClass}`}>
                                <span className={`${
                                  order.type === 'BUY' || order.type === 'COVER'
                                    ? 'text-green-500'
                                    : 'text-red-500'
                                }`}>
                                  {order.type}
                                </span>
                                {' '}
                                {order.shares} ${order.ticker}
                              </div>
                              <div className={`text-xs ${mutedClass}`}>{character?.name}</div>
                            </div>
                            <button
                              onClick={() => handleCancelOrder(order.id)}
                              disabled={loadingOrders}
                              className="px-2 py-1 text-xs bg-red-600 hover:bg-red-700 text-white font-semibold rounded-sm disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <div className={mutedClass}>Limit Price</div>
                              <div className={`font-bold ${textClass}`}>${order.limitPrice.toFixed(2)}</div>
                            </div>
                            <div>
                              <div className={mutedClass}>Current Price</div>
                              <div className={`font-bold ${isClose ? 'text-orange-500' : textClass}`}>
                                ${currentPrice.toFixed(2)}
                                {isClose && ' ⚠️'}
                              </div>
                            </div>
                          </div>

                          {order.status === 'PARTIALLY_FILLED' && (
                            <div className={`mt-2 text-xs ${mutedClass}`}>
                              Filled: {order.filledShares}/{order.shares} shares
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default PortfolioModal;
