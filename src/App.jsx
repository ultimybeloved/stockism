import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  signInWithPopup, 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  increment,
  serverTimestamp,
  arrayUnion
} from 'firebase/firestore';
import { auth, googleProvider, db } from './firebase';
import { CHARACTERS, CHARACTER_MAP } from './characters';
import { CREWS, CREW_MAP, SHOP_PINS, SHOP_PINS_LIST, DAILY_MISSIONS, PIN_SLOT_COSTS, CREW_DIVIDEND_RATE } from './crews';
import AdminPanel from './AdminPanel';

// ============================================
// CONSTANTS
// ============================================

// Admin user IDs - only these users can see the Admin button
const ADMIN_UIDS = [
  '4usiVxPmHLhmitEKH2HfCpbx4Yi1'
];

const ITEMS_PER_PAGE = 15;
const STARTING_CASH = 1000;
const DAILY_BONUS = 300;
const PRICE_UPDATE_INTERVAL = 5000; // 5 seconds
const HISTORY_RECORD_INTERVAL = 60000; // 1 minute

// Economy balancing constants - Realistic Market Model
const BASE_IMPACT = 0.003; // 0.3% base impact per sqrt(share) - very gradual
const BASE_LIQUIDITY = 100; // Base liquidity pool (higher = harder to move price)
const BID_ASK_SPREAD = 0.002; // 0.2% spread between buy/sell prices
const MIN_PRICE = 0.01; // Minimum price floor
const MAX_PRICE_CHANGE_PERCENT = 0.02; // Max 2% price change per single trade

// Shorting constants (realistic NYSE-style)
const SHORT_MARGIN_REQUIREMENT = 0.5; // 50% margin required (can short up to 2x cash)
const SHORT_INTEREST_RATE = 0.001; // 0.1% daily interest on short positions
const SHORT_MARGIN_CALL_THRESHOLD = 0.25; // Auto-close if equity drops below 25%

// ============================================
// ACHIEVEMENTS SYSTEM
// ============================================

const ACHIEVEMENTS = {
  // Trading milestones
  FIRST_BLOOD: {
    id: 'FIRST_BLOOD',
    name: 'First Blood',
    emoji: '🎯',
    description: 'Make your first trade',
    hint: 'Buy or sell any stock'
  },
  SHARK: {
    id: 'SHARK',
    name: 'Shark',
    emoji: '🦈',
    description: 'Execute a single trade worth $1,000+',
    hint: 'Go big or go home'
  },
  DIVERSIFIED: {
    id: 'DIVERSIFIED',
    name: 'Diversified',
    emoji: '🎨',
    description: 'Hold 5+ different characters at once',
    hint: 'Don\'t put all eggs in one basket'
  },
  
  // Profit milestones
  BULL_RUN: {
    id: 'BULL_RUN',
    name: 'Bull Run',
    emoji: '📈',
    description: 'Sell a stock for 50%+ profit',
    hint: 'Buy low, sell high'
  },
  DIAMOND_HANDS: {
    id: 'DIAMOND_HANDS',
    name: 'Diamond Hands',
    emoji: '🙌',
    description: 'Hold through a 30% dip and recover to profit',
    hint: 'Hold strong through the storm'
  },
  COLD_BLOODED: {
    id: 'COLD_BLOODED',
    name: 'Cold Blooded',
    emoji: '❄️',
    description: 'Profit from closing a short position',
    hint: 'Bet against the market and win'
  },
  
  // Portfolio milestones
  BROKE_2K: {
    id: 'BROKE_2K',
    name: 'Breaking Even... Kinda',
    emoji: '💵',
    description: 'Reach $2,500 portfolio value',
    hint: 'Build your wealth'
  },
  BROKE_5K: {
    id: 'BROKE_5K',
    name: 'High Roller',
    emoji: '🎰',
    description: 'Reach $5,000 portfolio value',
    hint: 'Keep growing'
  },
  BROKE_10K: {
    id: 'BROKE_10K',
    name: 'Big Shot',
    emoji: '🌟',
    description: 'Reach $10,000 portfolio value',
    hint: 'You\'re getting serious'
  },
  BROKE_25K: {
    id: 'BROKE_25K',
    name: 'Tycoon',
    emoji: '🏛️',
    description: 'Reach $25,000 portfolio value',
    hint: 'Market domination'
  },
  
  // Prediction milestones
  ORACLE: {
    id: 'ORACLE',
    name: 'Oracle',
    emoji: '🔮',
    description: 'Win 3 prediction bets',
    hint: 'See the future'
  },
  PROPHET: {
    id: 'PROPHET',
    name: 'Prophet',
    emoji: '📿',
    description: 'Win 10 prediction bets',
    hint: 'Your foresight is legendary'
  },
  
  // Dedication milestones
  DEDICATED_7: {
    id: 'DEDICATED_7',
    name: 'Regular',
    emoji: '📅',
    description: 'Check in 7 days total',
    hint: 'Keep coming back'
  },
  DEDICATED_14: {
    id: 'DEDICATED_14',
    name: 'Committed',
    emoji: '🔄',
    description: 'Check in 14 days total',
    hint: 'Two weeks strong'
  },
  DEDICATED_30: {
    id: 'DEDICATED_30',
    name: 'Devoted',
    emoji: '✨',
    description: 'Check in 30 days total',
    hint: 'A month of dedication'
  },
  DEDICATED_100: {
    id: 'DEDICATED_100',
    name: 'Legendary',
    emoji: '🏆',
    description: 'Check in 100 days total',
    hint: 'True commitment'
  },
  
  // Leaderboard
  TOP_10: {
    id: 'TOP_10',
    name: 'Contender',
    emoji: '🥉',
    description: 'Reach the top 10 on the leaderboard',
    hint: 'Climb the ranks'
  },
  TOP_3: {
    id: 'TOP_3',
    name: 'Elite',
    emoji: '🥈',
    description: 'Reach the top 3 on the leaderboard',
    hint: 'Almost at the top'
  },
  TOP_1: {
    id: 'TOP_1',
    name: 'Champion',
    emoji: '🥇',
    description: 'Reach #1 on the leaderboard',
    hint: 'The very best'
  },
  
  // Special
  TRADER_20: {
    id: 'TRADER_20',
    name: 'Active Trader',
    emoji: '📊',
    description: 'Complete 20 trades',
    hint: 'Keep trading'
  },
  TRADER_100: {
    id: 'TRADER_100',
    name: 'Day Trader',
    emoji: '💹',
    description: 'Complete 100 trades',
    hint: 'Trading is your life now'
  },
  
  // Daily Mission milestones
  MISSION_10: {
    id: 'MISSION_10',
    name: 'Task Runner',
    emoji: '📋',
    description: 'Complete 10 daily missions',
    hint: 'Stay on task'
  },
  MISSION_50: {
    id: 'MISSION_50',
    name: 'Mission Master',
    emoji: '🎖️',
    description: 'Complete 50 daily missions',
    hint: 'Dedicated to the grind'
  },
  MISSION_100: {
    id: 'MISSION_100',
    name: 'Mission Legend',
    emoji: '🎗️',
    description: 'Complete 100 daily missions',
    hint: 'Never miss a mission'
  }
};

// Helper to get today's date string for mission tracking
const getTodayDateString = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

// Check if user qualifies for lending (requires commitment + skill)
const checkLendingEligibility = (userData) => {
  if (!userData) return { eligible: false, reasons: [] };
  
  const achievements = userData.achievements || [];
  const totalCheckins = userData.totalCheckins || 0;
  const totalTrades = userData.totalTrades || 0;
  const peakPortfolioValue = userData.peakPortfolioValue || 0;
  
  const requirements = [
    { met: totalCheckins >= 7, label: '7+ daily check-ins', current: totalCheckins, required: 7 },
    { met: totalTrades >= 20, label: '20+ total trades', current: totalTrades, required: 20 },
    { met: peakPortfolioValue >= 2500, label: '$2,500+ peak portfolio', current: peakPortfolioValue, required: 2500 }
  ];
  
  const allMet = requirements.every(r => r.met);
  
  return {
    eligible: allMet,
    requirements,
    creditLimit: allMet ? calculateCreditLimit(userData) : 0
  };
};

// Calculate credit limit based on achievements and stats
const calculateCreditLimit = (userData) => {
  const achievements = userData.achievements || [];
  let limit = 500; // Base limit
  
  // Bonus for achievements
  if (achievements.includes('BROKE_5K')) limit += 500;
  if (achievements.includes('BROKE_10K')) limit += 1000;
  if (achievements.includes('BROKE_25K')) limit += 2000;
  if (achievements.includes('DEDICATED_30')) limit += 500;
  if (achievements.includes('TRADER_100')) limit += 500;
  
  return Math.min(limit, 5000); // Cap at $5,000
};

// Helper function to check and award achievements after an action
const checkAndAwardAchievements = async (userRef, userData, prices, context = {}) => {
  const currentAchievements = userData.achievements || [];
  const newAchievements = [];
  
  // Calculate current portfolio value
  const portfolioValue = (userData.cash || 0) + Object.entries(userData.holdings || {})
    .reduce((sum, [ticker, shares]) => sum + (prices[ticker] || 0) * shares, 0);
  
  // Calculate total holdings count
  const holdingsCount = Object.values(userData.holdings || {}).filter(shares => shares > 0).length;
  
  // Trade count achievements
  const totalTrades = userData.totalTrades || 0;
  if (totalTrades >= 1 && !currentAchievements.includes('FIRST_BLOOD')) {
    newAchievements.push('FIRST_BLOOD');
  }
  if (totalTrades >= 20 && !currentAchievements.includes('TRADER_20')) {
    newAchievements.push('TRADER_20');
  }
  if (totalTrades >= 100 && !currentAchievements.includes('TRADER_100')) {
    newAchievements.push('TRADER_100');
  }
  
  // Portfolio value achievements
  if (portfolioValue >= 2500 && !currentAchievements.includes('BROKE_2K')) {
    newAchievements.push('BROKE_2K');
  }
  if (portfolioValue >= 5000 && !currentAchievements.includes('BROKE_5K')) {
    newAchievements.push('BROKE_5K');
  }
  if (portfolioValue >= 10000 && !currentAchievements.includes('BROKE_10K')) {
    newAchievements.push('BROKE_10K');
  }
  if (portfolioValue >= 25000 && !currentAchievements.includes('BROKE_25K')) {
    newAchievements.push('BROKE_25K');
  }
  
  // Diversification achievement
  if (holdingsCount >= 5 && !currentAchievements.includes('DIVERSIFIED')) {
    newAchievements.push('DIVERSIFIED');
  }
  
  // Shark achievement (single trade worth $1000+)
  if (context.tradeValue && context.tradeValue >= 1000 && !currentAchievements.includes('SHARK')) {
    newAchievements.push('SHARK');
  }
  
  // Cold Blooded achievement (profitable short cover)
  if (context.shortProfit && context.shortProfit > 0 && !currentAchievements.includes('COLD_BLOODED')) {
    newAchievements.push('COLD_BLOODED');
  }
  
  // Bull Run achievement (sell for 50%+ profit)
  if (context.sellProfitPercent && context.sellProfitPercent >= 50 && !currentAchievements.includes('BULL_RUN')) {
    newAchievements.push('BULL_RUN');
  }
  
  // Update peak portfolio value
  const peakPortfolioValue = Math.max(userData.peakPortfolioValue || 0, portfolioValue);
  
  // Build update object
  const updateData = {};
  
  if (peakPortfolioValue > (userData.peakPortfolioValue || 0)) {
    updateData.peakPortfolioValue = peakPortfolioValue;
  }
  
  if (newAchievements.length > 0) {
    updateData.achievements = arrayUnion(...newAchievements);
  }
  
  // Only update if there's something to update
  if (Object.keys(updateData).length > 0) {
    await updateDoc(userRef, updateData);
  }
  
  return newAchievements;
};

// ============================================
// MARKET MECHANICS HELPERS
// ============================================

// Calculate price impact using square root model (used by real quant funds)
// This models real market microstructure where impact scales with sqrt of order size
const calculatePriceImpact = (currentPrice, shares, liquidity = BASE_LIQUIDITY) => {
  // Square root model: impact = price * base_impact * sqrt(shares / liquidity)
  // This means: 4x the shares = 2x the impact (not 4x)
  let impact = currentPrice * BASE_IMPACT * Math.sqrt(shares / liquidity);
  
  // Cap the impact at MAX_PRICE_CHANGE_PERCENT per trade to prevent manipulation
  const maxImpact = currentPrice * MAX_PRICE_CHANGE_PERCENT;
  impact = Math.min(impact, maxImpact);
  
  return impact;
};

// Get effective liquidity for a character (can be customized per character later)
const getCharacterLiquidity = (ticker, tradingVolume = 0) => {
  // Base liquidity + bonus from trading volume
  // More actively traded = more liquid = harder to move
  const volumeBonus = Math.sqrt(tradingVolume) * 0.5;
  return BASE_LIQUIDITY + volumeBonus;
};

// Calculate bid (sell) and ask (buy) prices with spread
const getBidAskPrices = (midPrice) => {
  const halfSpread = midPrice * BID_ASK_SPREAD / 2;
  return {
    bid: midPrice - halfSpread,  // Price you get when selling
    ask: midPrice + halfSpread,  // Price you pay when buying
    spread: halfSpread * 2
  };
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

const formatCurrency = (value) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
};

const formatChange = (change) => {
  const sign = change >= 0 ? '+' : '';
  return `${sign}${change.toFixed(2)}%`;
};

const formatNumber = (num) => {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
};

const formatTimeRemaining = (ms) => {
  if (ms <= 0) return 'Ended';
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

// ============================================
// SIMPLE LINE CHART COMPONENT
// ============================================

const SimpleLineChart = ({ data, darkMode }) => {
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
  const strokeColor = isUp ? '#22c55e' : '#ef4444';

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

// ============================================
// DETAILED CHART MODAL
// ============================================

const ChartModal = ({ character, currentPrice, priceHistory, onClose, darkMode }) => {
  const [timeRange, setTimeRange] = useState('7d');
  const [hoveredPoint, setHoveredPoint] = useState(null);

  const timeRanges = [
    { key: '1d', label: 'Today', hours: 24 },
    { key: '7d', label: '7 Days', hours: 168 },
    { key: '1m', label: '1 Month', hours: 720 },
    { key: '3m', label: '3 Months', hours: 2160 },
    { key: '1y', label: '1 Year', hours: 8760 },
    { key: 'all', label: 'All Time', hours: Infinity },
  ];

  const currentData = useMemo(() => {
    const range = timeRanges.find(r => r.key === timeRange);
    const cutoff = range.hours === Infinity ? 0 : Date.now() - (range.hours * 60 * 60 * 1000);
    
    const tickerHistory = priceHistory[character.ticker] || [];
    let data = tickerHistory
      .filter(point => point.timestamp >= cutoff)
      .map(point => ({
        ...point,
        date: new Date(point.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        fullDate: new Date(point.timestamp).toLocaleDateString('en-US', { 
          month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' 
        }),
      }));
    
    // Sample down to ~25 points for cleaner interaction
    const maxPoints = 25;
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
    
    // If not enough data, create synthetic chart from base price to current
    if (data.length < 2) {
      const now = Date.now();
      const startTime = range.hours === Infinity ? now - (7 * 24 * 60 * 60 * 1000) : now - (range.hours * 60 * 60 * 1000);
      data = [
        { 
          timestamp: startTime, 
          price: character.basePrice,
          date: new Date(startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          fullDate: new Date(startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        },
        { 
          timestamp: now, 
          price: currentPrice,
          date: 'Now',
          fullDate: new Date(now).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        }
      ];
    }
    
    return data;
  }, [priceHistory, character.ticker, character.basePrice, currentPrice, timeRange]);

  const hasData = currentData.length >= 2; // Will always be true now
  const prices = hasData ? currentData.map(d => d.price) : [currentPrice];
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice || 1;

  const firstPrice = currentData[0]?.price || currentPrice;
  const lastPrice = currentData[currentData.length - 1]?.price || currentPrice;
  const periodChange = firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;
  const isUp = lastPrice >= firstPrice;

  const svgWidth = 600;
  const svgHeight = 300;
  const paddingX = 50;
  const paddingY = 30;
  const chartWidth = svgWidth - paddingX * 2;
  const chartHeight = svgHeight - paddingY * 2;

  const getX = (index) => paddingX + (index / (currentData.length - 1 || 1)) * chartWidth;
  const getY = (price) => paddingY + chartHeight - ((price - minPrice) / priceRange) * chartHeight;

  const pathData = currentData.map((d, i) => {
    const x = getX(i);
    const y = getY(d.price);
    return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');

  const areaPath = currentData.length > 0 
    ? `${pathData} L ${getX(currentData.length - 1)} ${paddingY + chartHeight} L ${paddingX} ${paddingY + chartHeight} Z`
    : '';

  const strokeColor = isUp ? '#22c55e' : '#ef4444';
  const fillColor = isUp ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)';

  const cardClass = darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-300';
  const textClass = darkMode ? 'text-slate-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-slate-400' : 'text-slate-500';
  const bgClass = darkMode ? 'bg-slate-900' : 'bg-slate-50';

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div 
        className={`w-full max-w-3xl ${cardClass} border rounded-sm shadow-xl overflow-hidden`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`p-4 border-b ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
          <div className="flex justify-between items-start">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-teal-600 font-mono text-lg font-semibold">${character.ticker}</span>
                <span className={`text-sm ${mutedClass}`}>{character.name}</span>
              </div>
              <div className="flex items-baseline gap-3 mt-1">
                <span className={`text-2xl font-bold ${textClass}`}>{formatCurrency(currentPrice)}</span>
                <span className={`text-sm font-semibold ${isUp ? 'text-green-500' : 'text-red-500'}`}>
                  {isUp ? '▲' : '▼'} {formatChange(periodChange)} ({timeRanges.find(t => t.key === timeRange)?.label})
                </span>
              </div>
            </div>
            <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-teal-600 text-xl`}>×</button>
          </div>
        </div>

        {/* Time Range Selector */}
        <div className={`px-4 py-2 border-b ${darkMode ? 'border-slate-700 bg-slate-800/50' : 'border-slate-200 bg-slate-50'}`}>
          <div className="flex gap-1">
            {timeRanges.map(range => (
              <button
                key={range.key}
                onClick={() => setTimeRange(range.key)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-sm transition-colors ${
                  timeRange === range.key
                    ? 'bg-teal-600 text-white'
                    : darkMode
                      ? 'text-slate-400 hover:bg-slate-700'
                      : 'text-slate-600 hover:bg-slate-200'
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
            <svg 
              viewBox={`0 0 ${svgWidth} ${svgHeight}`} 
              className="w-full"
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
              
              {/* Dots for each data point */}
              {currentData.map((point, i) => {
                const x = getX(i);
                const y = getY(point.price);
                const isHovered = hoveredPoint?.timestamp === point.timestamp;
                
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
            
            {/* Invisible hit areas as absolute positioned divs */}
            {currentData.map((point, i) => {
              const xPercent = (getX(i) / svgWidth) * 100;
              const yPercent = (getY(point.price) / svgHeight) * 100;
              
              return (
                <div
                  key={i}
                  className="absolute w-10 h-10 -translate-x-1/2 -translate-y-1/2 cursor-pointer"
                  style={{ left: `${xPercent}%`, top: `${yPercent}%` }}
                  onMouseEnter={() => setHoveredPoint({ ...point, x: getX(i), y: getY(point.price) })}
                  onMouseLeave={() => setHoveredPoint(null)}
                  onClick={() => setHoveredPoint(hoveredPoint?.timestamp === point.timestamp ? null : { ...point, x: getX(i), y: getY(point.price) })}
                />
              );
            })}
            
            {/* Tooltip */}
            {hoveredPoint && (
              <div 
                className={`absolute pointer-events-none px-3 py-2 rounded-sm shadow-lg text-sm z-10 ${
                  darkMode ? 'bg-slate-700 text-slate-100' : 'bg-white text-slate-900 border'
                }`}
                style={{
                  left: `${(hoveredPoint.x / svgWidth) * 100}%`,
                  top: `${(hoveredPoint.y / svgHeight) * 100}%`,
                  transform: 'translate(-50%, -130%)'
                }}
              >
                <div className="font-bold text-teal-400">{formatCurrency(hoveredPoint.price)}</div>
                <div className={`text-xs ${mutedClass}`}>{hoveredPoint.fullDate}</div>
              </div>
            )}
          </div>
        </div>

        {/* Stats Footer */}
        <div className={`p-4 border-t ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
          <div className="grid grid-cols-4 gap-4 text-center">
            <div>
              <div className={`text-xs ${mutedClass} uppercase`}>Open</div>
              <div className={`font-semibold ${textClass}`}>{formatCurrency(firstPrice)}</div>
            </div>
            <div>
              <div className={`text-xs ${mutedClass} uppercase`}>High</div>
              <div className="font-semibold text-green-500">{formatCurrency(maxPrice)}</div>
            </div>
            <div>
              <div className={`text-xs ${mutedClass} uppercase`}>Low</div>
              <div className="font-semibold text-red-500">{formatCurrency(minPrice)}</div>
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

// ============================================
// NEW CHARACTERS BOARD COMPONENT
// ============================================

// Helper to get the start of the current prediction week (Wednesday)
const getWeekStart = () => {
  const now = new Date();
  const day = now.getDay();
  // Wednesday = 3, so we need to go back to the most recent Wednesday
  const daysToSubtract = (day + 4) % 7; // Days since last Wednesday
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - daysToSubtract);
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
};

const NewCharactersBoard = ({ prices, priceHistory, darkMode }) => {
  const cardClass = darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-300';
  const textClass = darkMode ? 'text-slate-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-slate-400' : 'text-slate-500';
  
  const weekStart = getWeekStart();
  
  // Find characters added this week
  const newCharacters = CHARACTERS.filter(char => {
    const addedDate = new Date(char.dateAdded);
    return addedDate >= weekStart;
  }).sort((a, b) => new Date(a.dateAdded) - new Date(b.dateAdded));
  
  if (newCharacters.length === 0) return null;
  
  // Calculate weekly change for each new character
  const getWeeklyChange = (ticker) => {
    const currentPrice = prices[ticker];
    const history = priceHistory[ticker] || [];
    
    if (!currentPrice || history.length === 0) return 0;
    
    // Find price from start of week
    const weekStartTime = weekStart.getTime();
    const startPrice = history.find(h => h.timestamp >= weekStartTime)?.price || history[0]?.price || currentPrice;
    
    return ((currentPrice - startPrice) / startPrice) * 100;
  };
  
  return (
    <div className={`${cardClass} border rounded-sm p-3`}>
      <h3 className={`text-xs font-semibold uppercase tracking-wide mb-2 ${mutedClass}`}>
        🆕 New This Week ({newCharacters.length})
      </h3>
      <div className="max-h-48 overflow-y-auto space-y-1">
        {newCharacters.map(char => {
          const price = prices[char.ticker] || char.basePrice;
          const change = getWeeklyChange(char.ticker);
          return (
            <div key={char.ticker} className={`flex items-center justify-between py-1 border-b ${darkMode ? 'border-slate-700' : 'border-slate-200'} last:border-0`}>
              <div className="min-w-0 flex-1">
                <span className={`text-sm font-semibold ${textClass}`}>{char.name}</span>
                <span className={`text-xs ${mutedClass} ml-1`}>${char.ticker}</span>
              </div>
              <div className="text-right ml-2">
                <span className={`text-sm font-bold ${textClass}`}>${price.toFixed(2)}</span>
                <span className={`text-xs ml-1 ${change >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {change >= 0 ? '▲' : '▼'}{Math.abs(change).toFixed(1)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================
// PREDICTION CARD COMPONENT (Multi-Option with Auto-Payout)
// ============================================

const PredictionCard = ({ prediction, userBet, onBet, darkMode, isGuest }) => {
  const [betAmount, setBetAmount] = useState(50);
  const [selectedOption, setSelectedOption] = useState(null);
  const [showBetUI, setShowBetUI] = useState(false);

  const cardClass = darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-300';
  const textClass = darkMode ? 'text-slate-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-slate-400' : 'text-slate-500';

  const timeRemaining = prediction.endsAt - Date.now();
  const isActive = timeRemaining > 0 && !prediction.resolved;
  
  // Support both old (yesPool/noPool) and new (pools object) format
  const options = prediction.options || ['Yes', 'No'];
  const pools = prediction.pools || {
    'Yes': prediction.yesPool || 0,
    'No': prediction.noPool || 0
  };
  const totalPool = options.reduce((sum, opt) => sum + (pools[opt] || 0), 0);
  
  const getOptionPercent = (option) => {
    if (totalPool === 0) return Math.floor(100 / options.length);
    return Math.floor((pools[option] || 0) / totalPool * 100);
  };

  const calculatePayout = (option, amount) => {
    const myPool = pools[option] || 0;
    const otherPools = totalPool - myPool;
    const newMyPool = myPool + amount;
    const myShare = amount / newMyPool;
    return myShare * (otherPools + newMyPool);
  };

  const handlePlaceBet = () => {
    if (selectedOption && betAmount > 0) {
      onBet(prediction.id, selectedOption, betAmount);
      setShowBetUI(false);
      setSelectedOption(null);
      setBetAmount(50);
    }
  };

  const optionColors = [
    { bg: 'bg-green-600', border: 'border-green-600', text: 'text-green-500', fill: 'bg-green-500' },
    { bg: 'bg-red-600', border: 'border-red-600', text: 'text-red-500', fill: 'bg-red-500' },
    { bg: 'bg-blue-600', border: 'border-blue-600', text: 'text-blue-500', fill: 'bg-blue-500' },
    { bg: 'bg-purple-600', border: 'border-purple-600', text: 'text-purple-500', fill: 'bg-purple-500' },
    { bg: 'bg-amber-600', border: 'border-amber-600', text: 'text-amber-500', fill: 'bg-amber-500' },
  ];

  return (
    <div className={`${cardClass} border rounded-sm p-4`}>
      <div className="flex justify-between items-start mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">🔮</span>
            <span className={`text-xs font-semibold uppercase ${isActive ? 'text-teal-500' : prediction.resolved ? 'text-amber-500' : 'text-red-500'}`}>
              {isActive ? 'Active' : prediction.resolved ? 'Resolved' : 'Ended'}
            </span>
          </div>
          <h3 className={`font-semibold ${textClass}`}>{prediction.question}</h3>
        </div>
        <div className="text-right">
          <div className={`text-xs ${mutedClass}`}>{isActive ? 'Ends in' : 'Ended'}</div>
          <div className={`text-sm font-semibold ${isActive ? 'text-teal-500' : mutedClass}`}>
            {isActive ? formatTimeRemaining(timeRemaining) : '—'}
          </div>
        </div>
      </div>

      <div className="mb-3">
        <div className={`text-xs ${mutedClass} mb-2`}>Pool: {formatCurrency(totalPool)}</div>
        <div className="space-y-2">
          {options.map((option, idx) => {
            const percent = getOptionPercent(option);
            const colors = optionColors[idx % optionColors.length];
            const isWinner = prediction.resolved && prediction.outcome === option;
            return (
              <div key={option} className="flex items-center gap-2">
                <div className={`w-32 sm:w-40 text-xs font-semibold ${colors.text} ${isWinner ? 'underline' : ''}`} title={option}>
                  {option} {isWinner && '✓'}
                </div>
                <div className="flex-1 h-4 bg-slate-700 rounded-sm overflow-hidden">
                  <div className={`h-full ${colors.fill} transition-all`} style={{ width: `${percent}%` }} />
                </div>
                <div className={`w-10 text-xs text-right ${mutedClass}`}>{percent}%</div>
              </div>
            );
          })}
        </div>
      </div>

      {userBet && (
        <div className={`mb-3 p-2 rounded-sm ${darkMode ? 'bg-slate-700' : 'bg-slate-100'}`}>
          <div className={`text-xs ${mutedClass}`}>Your bet</div>
          <div className={`font-semibold ${optionColors[options.indexOf(userBet.option) % optionColors.length]?.text || 'text-teal-500'}`}>
            {formatCurrency(userBet.amount)} on "{userBet.option}"
          </div>
          {prediction.resolved && (
            <div className={`text-xs mt-1 ${userBet.option === prediction.outcome ? 'text-green-500' : 'text-red-500'}`}>
              {userBet.option === prediction.outcome ? `🎉 Won ${formatCurrency(userBet.payout || 0)}!` : '❌ Lost'}
            </div>
          )}
        </div>
      )}

      {isActive && !isGuest && (
        <>
          {!showBetUI ? (
            <button onClick={() => setShowBetUI(true)}
              className="w-full py-2 text-sm font-semibold uppercase bg-teal-600 hover:bg-teal-700 text-white rounded-sm">
              Place Bet
            </button>
          ) : (
            <div className="space-y-3">
              <div className={`grid gap-2 ${options.length <= 2 ? 'grid-cols-2' : 'grid-cols-2'}`}>
                {options.map((option, idx) => {
                  const colors = optionColors[idx % optionColors.length];
                  return (
                    <button key={option} onClick={() => setSelectedOption(option)}
                      className={`py-2 px-2 text-sm font-semibold rounded-sm border-2 transition-all truncate ${
                        selectedOption === option
                          ? `${colors.bg} border-transparent text-white`
                          : `${colors.border} ${colors.text} hover:opacity-80`
                      }`}>
                      {option}
                    </button>
                  );
                })}
              </div>
              <div>
                <div className={`text-xs ${mutedClass} mb-1`}>Bet Amount</div>
                <div className="flex gap-2">
                  {[25, 50, 100, 250].map(amount => (
                    <button key={amount} onClick={() => setBetAmount(amount)}
                      className={`flex-1 py-1.5 text-xs font-semibold rounded-sm ${
                        betAmount === amount ? 'bg-teal-600 text-white' : darkMode ? 'bg-slate-700 text-slate-300' : 'bg-slate-200 text-slate-600'
                      }`}>
                      ${amount}
                    </button>
                  ))}
                </div>
                <input type="number" value={betAmount}
                  onChange={(e) => setBetAmount(Math.max(1, parseInt(e.target.value) || 0))}
                  className={`w-full mt-2 px-3 py-2 text-sm rounded-sm border ${darkMode ? 'bg-slate-900 border-slate-600 text-slate-100' : 'bg-white border-slate-300'}`}
                  placeholder="Custom amount..." />
              </div>
              {selectedOption && betAmount > 0 && (
                <div className={`text-sm ${mutedClass}`}>
                  Potential payout: <span className="text-teal-500 font-semibold">{formatCurrency(calculatePayout(selectedOption, betAmount))}</span>
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={() => { setShowBetUI(false); setSelectedOption(null); }}
                  className={`flex-1 py-2 text-sm font-semibold rounded-sm ${darkMode ? 'bg-slate-700 text-slate-300' : 'bg-slate-200 text-slate-600'}`}>
                  Cancel
                </button>
                <button onClick={handlePlaceBet} disabled={!selectedOption || betAmount <= 0}
                  className="flex-1 py-2 text-sm font-semibold uppercase bg-teal-600 hover:bg-teal-700 text-white rounded-sm disabled:opacity-50">
                  Confirm
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {isGuest && isActive && (
        <div className={`text-center text-sm ${mutedClass}`}>Sign in to place bets</div>
      )}

      {prediction.resolved && (
        <div className={`text-center py-2 rounded-sm mt-2 ${optionColors[options.indexOf(prediction.outcome) % optionColors.length]?.bg || 'bg-teal-600'} bg-opacity-20`}>
          <span className={`font-semibold ${optionColors[options.indexOf(prediction.outcome) % optionColors.length]?.text || 'text-teal-500'}`}>
            Winner: {prediction.outcome}
          </span>
        </div>
      )}
    </div>
  );
};

// ============================================
// PORTFOLIO MODAL (with chart)
// ============================================

const PortfolioModal = ({ holdings, prices, portfolioHistory, currentValue, onClose, onTrade, darkMode }) => {
  const [sellAmounts, setSellAmounts] = useState({});
  const [showChart, setShowChart] = useState(true);
  const [timeRange, setTimeRange] = useState('7d');
  const [hoveredPoint, setHoveredPoint] = useState(null);
  
  const cardClass = darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-300';
  const textClass = darkMode ? 'text-slate-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-slate-400' : 'text-slate-500';

  const portfolioItems = useMemo(() => {
    return Object.entries(holdings)
      .filter(([_, shares]) => shares > 0)
      .map(([ticker, shares]) => {
        const character = CHARACTER_MAP[ticker];
        const currentPrice = prices[ticker] || character?.basePrice || 0;
        const value = currentPrice * shares;
        const change = character ? ((currentPrice - character.basePrice) / character.basePrice) * 100 : 0;
        return { ticker, shares, character, currentPrice, value, change };
      })
      .sort((a, b) => b.value - a.value);
  }, [holdings, prices]);

  const totalValue = portfolioItems.reduce((sum, item) => sum + item.value, 0);

  const handleSell = (ticker, amount) => {
    onTrade(ticker, 'sell', amount);
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

  const strokeColor = isUp ? '#22c55e' : '#ef4444';
  const fillColor = isUp ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)';

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className={`w-full max-w-2xl ${cardClass} border rounded-sm shadow-xl overflow-hidden max-h-[90vh] flex flex-col`}
        onClick={e => e.stopPropagation()}>
        
        <div className={`p-4 border-b ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
          <div className="flex justify-between items-center">
            <div>
              <h2 className={`text-lg font-semibold ${textClass}`}>Your Portfolio</h2>
              <div className="flex items-baseline gap-2 mt-1">
                <span className={`text-xl font-bold ${textClass}`}>{formatCurrency(currentValue)}</span>
                {hasChartData && (
                  <span className={`text-sm font-semibold ${isUp ? 'text-green-500' : 'text-red-500'}`}>
                    {isUp ? '▲' : '▼'} {formatChange(periodChange)}
                  </span>
                )}
              </div>
            </div>
            <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-teal-600 text-xl`}>×</button>
          </div>
        </div>

        {/* Portfolio Chart */}
        <div className={`border-b ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
          <div className="flex items-center justify-between px-4 py-2">
            <button
              onClick={() => setShowChart(!showChart)}
              className={`text-xs font-semibold ${mutedClass} hover:text-teal-500`}
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
                        ? 'bg-teal-600 text-white'
                        : darkMode ? 'text-slate-400 hover:bg-slate-700' : 'text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {range.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          
          {showChart && (
            <div className={`px-4 pb-4 ${darkMode ? 'bg-slate-900/50' : 'bg-slate-50'} relative`}>
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
                    darkMode ? 'bg-slate-700 text-slate-100' : 'bg-slate-800 text-white'
                  }`}
                  style={{
                    left: `${(getX(hoveredPoint) / svgWidth) * 100}%`,
                    top: `${(getY(chartData[hoveredPoint].value) / svgHeight) * 100}%`,
                    transform: 'translate(-50%, -130%)'
                  }}
                >
                  <div className="font-bold text-teal-400">{formatCurrency(chartData[hoveredPoint].value)}</div>
                  <div className="text-slate-400">{chartData[hoveredPoint].fullDate}</div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {portfolioItems.length === 0 ? (
            <div className={`text-center py-8 ${mutedClass}`}>
              <p className="text-lg mb-2">📭 No holdings yet</p>
              <p className="text-sm">Start trading to build your portfolio!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {portfolioItems.map(item => (
                <div key={item.ticker} className={`p-3 rounded-sm border ${darkMode ? 'border-slate-700 bg-slate-800/50' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="flex justify-between items-center mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-teal-600 font-mono font-semibold">${item.ticker}</span>
                        <span className={`text-sm ${mutedClass}`}>{item.character?.name}</span>
                      </div>
                      <div className={`text-sm ${mutedClass} mt-1`}>
                        {item.shares} shares @ {formatCurrency(item.currentPrice)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`font-semibold ${textClass}`}>{formatCurrency(item.value)}</div>
                      <div className={`text-xs ${item.change >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {item.change >= 0 ? '▲' : '▼'} {formatChange(item.change)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-2 border-t border-slate-600">
                    <input
                      type="number"
                      min="1"
                      max={item.shares}
                      value={sellAmounts[item.ticker] || 1}
                      onChange={(e) => setSellAmounts(prev => ({ 
                        ...prev, 
                        [item.ticker]: Math.min(item.shares, Math.max(1, parseInt(e.target.value) || 1)) 
                      }))}
                      className={`w-20 px-2 py-1 text-sm text-center rounded-sm border ${
                        darkMode ? 'bg-slate-900 border-slate-600 text-slate-100' : 'bg-white border-slate-300'
                      }`}
                    />
                    <button
                      onClick={() => handleSell(item.ticker, sellAmounts[item.ticker] || 1)}
                      className="px-4 py-1.5 text-xs font-semibold uppercase bg-red-600 hover:bg-red-700 text-white rounded-sm"
                    >
                      Sell
                    </button>
                    <button
                      onClick={() => handleSell(item.ticker, item.shares)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-sm ${
                        darkMode ? 'bg-slate-700 text-slate-300 hover:bg-slate-600' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                      }`}
                    >
                      Sell All
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================
// LEADERBOARD MODAL
// ============================================

const LeaderboardModal = ({ onClose, darkMode, currentUserCrew }) => {
  const [leaders, setLeaders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [crewFilter, setCrewFilter] = useState('ALL'); // 'ALL' or crew ID

  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const q = query(
          collection(db, 'users'),
          orderBy('portfolioValue', 'desc'),
          limit(100)
        );
        const snapshot = await getDocs(q);
        const leaderData = snapshot.docs.map((doc, index) => ({
          rank: index + 1,
          ...doc.data(),
          id: doc.id
        }));
        setLeaders(leaderData);
      } catch (err) {
        console.error('Failed to fetch leaderboard:', err);
      }
      setLoading(false);
    };
    fetchLeaderboard();
  }, []);

  const cardClass = darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-300';
  const textClass = darkMode ? 'text-slate-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-slate-400' : 'text-slate-500';

  const getRankStyle = (rank) => {
    if (rank === 1) return 'text-yellow-500';
    if (rank === 2) return 'text-slate-400';
    if (rank === 3) return 'text-amber-600';
    return mutedClass;
  };

  const getRankEmoji = (rank) => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return `#${rank}`;
  };

  // Filter and re-rank based on crew
  const filteredLeaders = useMemo(() => {
    if (crewFilter === 'ALL') return leaders;
    return leaders
      .filter(l => l.crew === crewFilter)
      .map((l, idx) => ({ ...l, crewRank: idx + 1 }));
  }, [leaders, crewFilter]);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className={`w-full max-w-lg ${cardClass} border rounded-sm shadow-xl overflow-hidden max-h-[80vh] flex flex-col`}
        onClick={e => e.stopPropagation()}>
        
        <div className={`p-4 border-b ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
          <div className="flex justify-between items-center mb-3">
            <h2 className={`text-lg font-semibold ${textClass}`}>🏆 Leaderboard</h2>
            <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-teal-600 text-xl`}>×</button>
          </div>
          
          {/* Crew Filter */}
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setCrewFilter('ALL')}
              className={`px-3 py-1 text-xs rounded-sm font-semibold ${
                crewFilter === 'ALL' 
                  ? 'bg-teal-600 text-white' 
                  : darkMode ? 'bg-slate-700 text-slate-300' : 'bg-slate-200 text-slate-600'
              }`}
            >
              All
            </button>
            {Object.values(CREWS).map(crew => (
              <button
                key={crew.id}
                onClick={() => setCrewFilter(crew.id)}
                className={`px-3 py-1 text-xs rounded-sm font-semibold flex items-center gap-1 ${
                  crewFilter === crew.id 
                    ? 'text-white' 
                    : darkMode ? 'bg-slate-700 text-slate-300' : 'bg-slate-200 text-slate-600'
                }`}
                style={crewFilter === crew.id ? { backgroundColor: crew.color } : {}}
              >
                {crew.icon ? (
                  <img src={crew.icon} alt="" className="w-4 h-4 object-contain" />
                ) : (
                  crew.emblem
                )}
                {crew.name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className={`text-center py-8 ${mutedClass}`}>Loading...</div>
          ) : filteredLeaders.length === 0 ? (
            <div className={`text-center py-8 ${mutedClass}`}>
              <p>No traders{crewFilter !== 'ALL' ? ' in this crew' : ''} yet!</p>
              <p className="text-sm">Be the first to make your mark.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-700">
              {filteredLeaders.map(leader => {
                const displayRank = crewFilter === 'ALL' ? leader.rank : leader.crewRank;
                const crew = leader.crew ? CREW_MAP[leader.crew] : null;
                return (
                  <div key={leader.id} className={`p-3 flex items-center gap-3 ${displayRank <= 3 ? (darkMode ? 'bg-slate-800/50' : 'bg-slate-50') : ''}`}>
                    <div className={`w-10 text-center font-bold ${getRankStyle(displayRank)}`}>
                      {getRankEmoji(displayRank)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`font-semibold truncate ${textClass} flex items-center`}>
                        <span style={leader.isCrewHead && crew ? { color: leader.crewHeadColor || crew.color } : {}}>
                          {leader.displayName || 'Anonymous Trader'}
                        </span>
                        <PinDisplay userData={leader} size="sm" />
                      </div>
                      <div className={`text-xs ${mutedClass}`}>
                        {Object.keys(leader.holdings || {}).filter(k => leader.holdings[k] > 0).length} characters
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`font-bold ${textClass}`}>{formatCurrency(leader.portfolioValue || 0)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================
// ABOUT / FAQ / PRIVACY MODAL
// ============================================

const AboutModal = ({ onClose, darkMode }) => {
  const [activeTab, setActiveTab] = useState('about');

  const cardClass = darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-300';
  const textClass = darkMode ? 'text-slate-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-slate-400' : 'text-slate-500';
  const linkClass = 'text-teal-500 hover:text-teal-400 underline';

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className={`w-full max-w-2xl ${cardClass} border rounded-sm shadow-xl overflow-hidden max-h-[90vh] flex flex-col`}
        onClick={e => e.stopPropagation()}>
        
        {/* Header */}
        <div className={`p-4 border-b ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
          <div className="flex justify-between items-center">
            <h2 className={`text-lg font-semibold ${textClass}`}>About Stockism</h2>
            <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-teal-600 text-xl`}>×</button>
          </div>
        </div>

        {/* Tabs */}
        <div className={`flex border-b ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
          {[
            { key: 'about', label: '📖 About' },
            { key: 'faq', label: '❓ FAQ' },
            { key: 'privacy', label: '🔒 Privacy' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 py-3 text-sm font-semibold ${
                activeTab === tab.key ? 'text-teal-500 border-b-2 border-teal-500' : mutedClass
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          
          {/* ABOUT TAB */}
          {activeTab === 'about' && (
            <div className={`space-y-4 ${textClass}`}>
              <div>
                <h3 className="font-semibold text-teal-500 mb-2">What is Stockism?</h3>
                <p className={mutedClass}>
                  Stockism is a free fan-made stock market simulation game based on the Lookism webtoon universe. 
                  Trade fictional characters like stocks, predict story outcomes, and compete on the leaderboard!
                </p>
              </div>
              
              <div>
                <h3 className="font-semibold text-teal-500 mb-2">How does it work?</h3>
                <p className={mutedClass}>
                  Each character has a stock price that changes based on player trading activity. 
                  Buy low, sell high, and use your knowledge of the webtoon to make smart investments. 
                  You can also bet on weekly predictions about upcoming chapters.
                </p>
              </div>
              
              <div>
                <h3 className="font-semibold text-teal-500 mb-2">Is real money involved?</h3>
                <p className={mutedClass}>
                  <span className="text-green-500 font-semibold">Absolutely not.</span> Stockism uses entirely fictional currency. 
                  You start with $1,000 of fake money and can earn more through daily check-ins. 
                  There is no way to deposit, withdraw, or exchange real money. This is purely for fun!
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-teal-500 mb-2">Who made this?</h3>
                <p className={mutedClass}>
                  Stockism was created by <a href="https://github.com/UltiMyBeloved" target="_blank" rel="noopener noreferrer" className="text-teal-500 hover:text-teal-400 underline">Darth YG</a> for the Lookism community. 
                  It's a free, open-source project with no ads or monetization.
                </p>
              </div>
            </div>
          )}

          {/* FAQ TAB */}
          {activeTab === 'faq' && (
            <div className={`space-y-4 ${textClass}`}>
              <div>
                <h3 className="font-semibold text-teal-500 mb-1">What's the "bid-ask spread"?</h3>
                <p className={`text-sm ${mutedClass}`}>
                  Just like real stock markets, there's a tiny gap between buy and sell prices (0.2%). 
                  This prevents instant arbitrage and makes the simulation more realistic.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-teal-500 mb-1">How do prices change?</h3>
                <p className={`text-sm ${mutedClass}`}>
                  Prices are driven by player activity using a realistic "square root" model. 
                  Buying pushes prices up, selling pushes them down. Large orders have diminishing 
                  impact to prevent manipulation.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-teal-500 mb-1">What is shorting?</h3>
                <p className={`text-sm ${mutedClass}`}>
                  Shorting lets you profit when a stock goes DOWN. You "borrow" shares, sell them, 
                  and hope to buy them back cheaper later. It's risky — if the price goes up instead, 
                  you lose money. Requires 50% margin as collateral.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-teal-500 mb-1">How do predictions work?</h3>
                <p className={`text-sm ${mutedClass}`}>
                  Place bets on story outcomes (e.g., "Will X defeat Y?"). All bets go into a pool, 
                  and winners split the entire pool proportionally. If everyone picks the same answer 
                  and wins, everyone just gets their money back.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-teal-500 mb-1">Can I lose all my money?</h3>
                <p className={`text-sm ${mutedClass}`}>
                  Yes, through bad trades or losing prediction bets. But you can always earn more 
                  through the daily check-in bonus ($300/day). You can never go below $0.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-teal-500 mb-1">How do I report bugs or suggest features?</h3>
                <p className={`text-sm ${mutedClass}`}>
                  Reach out to <a href="https://reddit.com/u/SupremeExalted" target="_blank" rel="noopener noreferrer" className="text-teal-500 hover:text-teal-400 underline">u/SupremeExalted</a> on Reddit. We're always looking to improve!
                </p>
              </div>
            </div>
          )}

          {/* PRIVACY TAB */}
          {activeTab === 'privacy' && (
            <div className={`space-y-4 ${textClass}`}>
              <div className={`p-3 rounded-sm ${darkMode ? 'bg-green-900/30 border border-green-700' : 'bg-green-50 border border-green-200'}`}>
                <p className="text-green-500 font-semibold text-sm">
                  🛡️ TL;DR: We store almost nothing about you. No real names, no profile pictures, no tracking.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-teal-500 mb-2">What we store in our game database:</h3>
                <ul className={`text-sm ${mutedClass} space-y-1 ml-4`}>
                  <li>• <span className={darkMode ? 'text-slate-300' : 'text-slate-700'}>Username</span> — The name YOU choose (not your Google name)</li>
                  <li>• <span className={darkMode ? 'text-slate-300' : 'text-slate-700'}>Game data</span> — Your cash balance, holdings, and trade history</li>
                  <li>• <span className={darkMode ? 'text-slate-300' : 'text-slate-700'}>Account ID</span> — A random ID to identify your account</li>
                </ul>
              </div>

              <div>
                <h3 className="font-semibold text-teal-500 mb-2">What Firebase Authentication stores:</h3>
                <p className={`text-sm ${mutedClass} mb-2`}>
                  Firebase (Google's service) handles login and stores your email to manage your account. 
                  This is standard for any website with login — it's how you can sign back in later.
                </p>
                <ul className={`text-sm ${mutedClass} space-y-1 ml-4`}>
                  <li>• <span className={darkMode ? 'text-amber-400' : 'text-amber-600'}>📧 Email</span> — Stored by Firebase Auth (not our game database). Never visible to other players or used for marketing.</li>
                </ul>
              </div>

              <div>
                <h3 className="font-semibold text-teal-500 mb-2">What we DON'T store anywhere:</h3>
                <ul className={`text-sm ${mutedClass} space-y-1 ml-4`}>
                  <li>• <span className="text-red-400">❌ Your real name</span> — We never save your Google display name</li>
                  <li>• <span className="text-red-400">❌ Your profile picture</span> — We never save your Google photo</li>
                  <li>• <span className="text-red-400">❌ Your password</span> — Google handles authentication securely</li>
                  <li>• <span className="text-red-400">❌ Your contacts or Google data</span> — We have no access</li>
                  <li>• <span className="text-red-400">❌ Tracking cookies or analytics</span> — We don't use any</li>
                </ul>
              </div>

              <div>
                <h3 className="font-semibold text-teal-500 mb-2">About the Google Sign-In popup:</h3>
                <p className={`text-sm ${mutedClass}`}>
                  When you sign in, Google shows a standard message saying we "could" access your name and 
                  profile picture. This is Google's default OAuth screen — it shows the <em>maximum possible</em> permissions, not what we actually use.
                </p>
                <p className={`text-sm ${mutedClass} mt-2`}>
                  In reality, our code immediately discards this information. We only use Google to verify 
                  you're a real person, then we ask you to create a username. That username is the only 
                  identifier visible to other players.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-teal-500 mb-2">Data deletion:</h3>
                <p className={`text-sm ${mutedClass}`}>
                  Want your data deleted? Contact us and we'll remove your account/data entirely.
                </p>
              </div>

              <div className={`mt-4 p-3 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-slate-100'}`}>
                <p className={`text-xs ${mutedClass}`}>
                  Last updated: January 2025. This is a fan project with no legal entity behind it. 
                  If you have privacy concerns, please reach out to us directly.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================
// PIN DISPLAY COMPONENT
// ============================================

const PinDisplay = ({ userData, size = 'sm' }) => {
  if (!userData) return null;
  
  const pins = [];
  const sizeClass = size === 'sm' ? 'text-xs' : size === 'md' ? 'text-sm' : 'text-base';
  const imgSize = size === 'sm' ? 'w-4 h-4' : size === 'md' ? 'w-5 h-5' : 'w-6 h-6';
  
  // Crew pin - ALWAYS shown if user is Crew Head, otherwise optional based on displayCrewPin
  if (userData.crew) {
    const crew = CREW_MAP[userData.crew];
    if (crew) {
      const isCrewHead = userData.isCrewHead;
      // Crew Heads must always display their crew pin, others can toggle
      const shouldShowCrewPin = isCrewHead || userData.displayCrewPin !== false;
      if (shouldShowCrewPin) {
        pins.push(
          <span key="crew" title={`${crew.name}${isCrewHead ? ' (Crew Head)' : ''}`} className={`inline-flex items-center ${sizeClass}`}>
            {isCrewHead ? '👑' : (
              crew.icon ? (
                <img src={crew.icon} alt={crew.name} className={`${imgSize} object-contain`} />
              ) : crew.emblem
            )}
          </span>
        );
      }
    }
  }
  
  // Achievement pins
  const achievementPins = userData.displayedAchievementPins || [];
  achievementPins.forEach((achId, idx) => {
    const achievement = ACHIEVEMENTS[achId];
    if (achievement) {
      pins.push(
        <span key={`ach-${idx}`} title={achievement.name} className={sizeClass}>
          {achievement.emoji}
        </span>
      );
    }
  });
  
  // Shop pins
  const shopPins = userData.displayedShopPins || [];
  shopPins.forEach((pinId, idx) => {
    const pin = SHOP_PINS[pinId];
    if (pin) {
      pins.push(
        <span key={`shop-${idx}`} title={pin.name} className={sizeClass}>
          {pin.emoji}
        </span>
      );
    }
  });
  
  if (pins.length === 0) return null;
  
  return <span className="inline-flex items-center gap-0.5 ml-1">{pins}</span>;
};

// ============================================
// CREW SELECTION MODAL
// ============================================

const CrewSelectionModal = ({ onClose, onSelect, onLeave, darkMode, userData }) => {
  const [selectedCrew, setSelectedCrew] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [leavingCrew, setLeavingCrew] = useState(false);
  
  const cardClass = darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-300';
  const textClass = darkMode ? 'text-slate-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-slate-400' : 'text-slate-500';
  
  const currentCrew = userData?.crew;
  const portfolioValue = userData?.portfolioValue || 0;
  const penaltyAmount = Math.floor(portfolioValue * 0.5);
  
  const handleSelect = (crewId) => {
    if (crewId === currentCrew) return;
    setSelectedCrew(crewId);
    setConfirming(true);
  };
  
  const handleConfirm = () => {
    // Pass true if switching crews (has existing crew), false if joining fresh
    onSelect(selectedCrew, !!currentCrew);
    onClose();
  };

  const handleLeave = () => {
    onLeave();
    onClose();
  };
  
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className={`w-full max-w-2xl ${cardClass} border rounded-sm shadow-xl overflow-hidden max-h-[90vh] flex flex-col`}
        onClick={e => e.stopPropagation()}>
        
        <div className={`p-4 border-b ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
          <div className="flex justify-between items-center">
            <h2 className={`text-lg font-semibold ${textClass}`}>🏴 Crew</h2>
            <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-teal-600 text-xl`}>×</button>
          </div>
          {currentCrew && (
            <p className={`text-sm ${mutedClass} mt-1`}>
              Current: <span style={{ color: CREW_MAP[currentCrew]?.color }}>{CREW_MAP[currentCrew]?.emblem} {CREW_MAP[currentCrew]?.name}</span>
            </p>
          )}
          {!currentCrew && (
            <p className={`text-sm ${mutedClass} mt-1`}>
              Join a crew to unlock daily missions, crew dividends, and compete for Crew Head!
            </p>
          )}
        </div>

        {/* Warning Banner - show for users without a crew AND users with a crew */}
        {!confirming && !leavingCrew && (
          <div className={`p-3 ${darkMode ? 'bg-amber-900/30' : 'bg-amber-100'} border-b border-amber-500/30`}>
            <p className="text-amber-400 text-sm text-center">
              ⚠️ <strong>Warning:</strong> Leaving a crew costs <strong>50% of your entire portfolio</strong>
              <br />
              <span className={`text-xs ${mutedClass}`}>Half your cash and half your shares will be taken if you ever leave.</span>
            </p>
          </div>
        )}
        
        {leavingCrew ? (
          <div className="p-6 text-center">
            <div className="text-4xl mb-4">🚪</div>
            <h3 className={`text-xl font-bold mb-2 ${textClass}`}>Leave {CREW_MAP[currentCrew]?.name}?</h3>
            <div className={`p-4 rounded-sm ${darkMode ? 'bg-red-900/20' : 'bg-red-50'} border border-red-500/30 mb-4`}>
              <p className="text-red-400 font-semibold mb-2">
                You will lose approximately {formatCurrency(penaltyAmount)}
              </p>
              <p className={`text-xs ${mutedClass}`}>
                Half of your cash and half of each stock you own will be taken.
              </p>
            </div>
            <p className={`text-sm ${mutedClass} mb-6`}>You can rejoin any crew later (no cost to join).</p>
            
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setLeavingCrew(false)}
                className={`px-6 py-2 rounded-sm border ${darkMode ? 'border-slate-600 text-slate-300' : 'border-slate-300'}`}
              >
                Back
              </button>
              <button
                onClick={handleLeave}
                className="px-6 py-2 rounded-sm bg-red-600 hover:bg-red-700 text-white font-semibold"
              >
                Leave Crew
              </button>
            </div>
          </div>
        ) : confirming ? (
          <div className="p-6 text-center">
            <div className="mb-4">
              {CREW_MAP[selectedCrew]?.icon ? (
                <img src={CREW_MAP[selectedCrew]?.icon} alt={CREW_MAP[selectedCrew]?.name} className="w-16 h-16 object-contain mx-auto" />
              ) : (
                <span className="text-4xl">{CREW_MAP[selectedCrew]?.emblem}</span>
              )}
            </div>
            <h3 className={`text-xl font-bold mb-2 ${textClass}`} style={{ color: CREW_MAP[selectedCrew]?.color }}>
              {currentCrew ? `Switch to ${CREW_MAP[selectedCrew]?.name}?` : `Join ${CREW_MAP[selectedCrew]?.name}?`}
            </h3>
            
            {currentCrew ? (
              <div className={`p-4 rounded-sm ${darkMode ? 'bg-red-900/20' : 'bg-red-50'} border border-red-500/30 mb-4`}>
                <p className="text-red-400 font-semibold mb-2">
                  You will lose approximately {formatCurrency(penaltyAmount)}
                </p>
                <p className={`text-xs ${mutedClass}`}>
                  Half of your cash and half of each stock you own will be taken.
                </p>
              </div>
            ) : (
              <div className="mb-4">
                <p className={`text-sm text-teal-500 mb-3`}>
                  ✓ Joining a crew is free!
                </p>
                <div className={`p-3 rounded-sm ${darkMode ? 'bg-amber-900/20' : 'bg-amber-50'} border border-amber-500/30`}>
                  <p className="text-amber-400 text-sm">
                    ⚠️ <strong>Note:</strong> If you ever leave this crew, you'll lose <strong>50% of your portfolio</strong>.
                  </p>
                  <p className={`text-xs ${mutedClass} mt-1`}>
                    You don't have to join a crew — this is optional!
                  </p>
                </div>
              </div>
            )}
            
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setConfirming(false)}
                className={`px-6 py-2 rounded-sm border ${darkMode ? 'border-slate-600 text-slate-300' : 'border-slate-300'}`}
              >
                Back
              </button>
              <button
                onClick={handleConfirm}
                className="px-6 py-2 rounded-sm bg-teal-600 hover:bg-teal-700 text-white font-semibold"
              >
                {currentCrew ? 'Confirm Switch' : 'Join Crew'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4">
            {/* Leave Crew Button */}
            {currentCrew && (
              <button
                onClick={() => setLeavingCrew(true)}
                className={`w-full mb-4 p-3 rounded-sm border-2 border-red-500/50 text-red-400 hover:bg-red-500/10 transition-all`}
              >
                🚪 Leave Current Crew
              </button>
            )}
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {Object.values(CREWS).map(crew => (
                <button
                  key={crew.id}
                  onClick={() => handleSelect(crew.id)}
                  disabled={crew.id === currentCrew}
                  className={`p-4 rounded-sm border-2 text-center transition-all ${
                    crew.id === currentCrew
                      ? 'opacity-50 cursor-not-allowed border-slate-600'
                      : darkMode 
                        ? 'border-slate-600 hover:border-teal-500 bg-slate-700/50' 
                        : 'border-slate-300 hover:border-teal-500 bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-center gap-2">
                    {crew.icon ? (
                      <img src={crew.icon} alt={crew.name} className="w-8 h-8 object-contain" />
                    ) : (
                      <span className="text-2xl">{crew.emblem}</span>
                    )}
                    <span className={`font-bold ${textClass}`} style={{ color: crew.color }}>
                      {crew.name}
                    </span>
                  </div>
                  {crew.id === currentCrew && (
                    <span className="text-xs text-teal-500 mt-2 block">✓ Current crew</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================
// PIN SHOP MODAL
// ============================================

const PinShopModal = ({ onClose, darkMode, userData, onPurchase }) => {
  const [selectedPin, setSelectedPin] = useState(null);
  const [activeTab, setActiveTab] = useState('shop'); // 'shop', 'achievement', 'manage'
  
  const cardClass = darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-300';
  const textClass = darkMode ? 'text-slate-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-slate-400' : 'text-slate-500';
  
  const ownedPins = userData?.ownedShopPins || [];
  const displayedShopPins = userData?.displayedShopPins || [];
  const displayedAchievementPins = userData?.displayedAchievementPins || [];
  const earnedAchievements = userData?.achievements || [];
  const cash = userData?.cash || 0;
  
  // Calculate slots
  const baseAchievementSlots = 1;
  const baseShopSlots = 1;
  const extraAchievementSlot = userData?.extraAchievementSlot ? 1 : 0;
  const extraShopSlot = userData?.extraShopSlot ? 1 : 0;
  const allAchievementsBonus = earnedAchievements.length >= Object.keys(ACHIEVEMENTS).length ? 1 : 0;
  
  const maxAchievementSlots = baseAchievementSlots + extraAchievementSlot + allAchievementsBonus;
  const maxShopSlots = baseShopSlots + extraShopSlot;
  
  const handleBuyPin = (pin) => {
    if (cash >= pin.price && !ownedPins.includes(pin.id)) {
      onPurchase('buyPin', pin.id, pin.price);
    }
  };
  
  const handleToggleShopPin = (pinId) => {
    const newDisplayed = displayedShopPins.includes(pinId)
      ? displayedShopPins.filter(p => p !== pinId)
      : displayedShopPins.length < maxShopSlots
        ? [...displayedShopPins, pinId]
        : displayedShopPins;
    onPurchase('setShopPins', newDisplayed, 0);
  };
  
  const handleToggleAchievementPin = (achId) => {
    const newDisplayed = displayedAchievementPins.includes(achId)
      ? displayedAchievementPins.filter(p => p !== achId)
      : displayedAchievementPins.length < maxAchievementSlots
        ? [...displayedAchievementPins, achId]
        : displayedAchievementPins;
    onPurchase('setAchievementPins', newDisplayed, 0);
  };
  
  const handleBuySlot = (slotType) => {
    const cost = slotType === 'achievement' ? PIN_SLOT_COSTS.EXTRA_ACHIEVEMENT_SLOT : PIN_SLOT_COSTS.EXTRA_SHOP_SLOT;
    if (cash >= cost) {
      onPurchase('buySlot', slotType, cost);
    }
  };
  
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className={`w-full max-w-2xl ${cardClass} border rounded-sm shadow-xl overflow-hidden max-h-[90vh] flex flex-col`}
        onClick={e => e.stopPropagation()}>
        
        <div className={`p-4 border-b ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
          <div className="flex justify-between items-center">
            <h2 className={`text-lg font-semibold ${textClass}`}>🏪 Pin Shop</h2>
            <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-teal-600 text-xl`}>×</button>
          </div>
          <p className={`text-sm ${mutedClass}`}>Cash: <span className="text-teal-500 font-semibold">{formatCurrency(cash)}</span></p>
        </div>
        
        {/* Tabs */}
        <div className={`flex border-b ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
          {['shop', 'achievement', 'manage'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 text-sm font-semibold ${
                activeTab === tab 
                  ? 'text-teal-500 border-b-2 border-teal-500' 
                  : mutedClass
              }`}
            >
              {tab === 'shop' ? '🛒 Buy Pins' : tab === 'achievement' ? '🏆 Achievements' : '⚙️ Manage'}
            </button>
          ))}
        </div>
        
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'shop' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {SHOP_PINS_LIST.map(pin => {
                const owned = ownedPins.includes(pin.id);
                const canAfford = cash >= pin.price;
                return (
                  <div
                    key={pin.id}
                    className={`p-3 rounded-sm border ${
                      owned 
                        ? 'border-teal-500 bg-teal-500/10' 
                        : darkMode ? 'border-slate-600' : 'border-slate-300'
                    }`}
                  >
                    <div className="text-2xl text-center mb-2">{pin.emoji}</div>
                    <div className={`text-sm font-semibold text-center ${textClass}`}>{pin.name}</div>
                    <div className={`text-xs text-center ${mutedClass} mb-2`}>{pin.description}</div>
                    {owned ? (
                      <div className="text-xs text-center text-teal-500 font-semibold">✓ Owned</div>
                    ) : (
                      <button
                        onClick={() => handleBuyPin(pin)}
                        disabled={!canAfford}
                        className={`w-full py-1 text-xs rounded-sm font-semibold ${
                          canAfford 
                            ? 'bg-teal-600 hover:bg-teal-700 text-white' 
                            : 'bg-slate-600 text-slate-400 cursor-not-allowed'
                        }`}
                      >
                        {formatCurrency(pin.price)}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          
          {activeTab === 'achievement' && (
            <div>
              <p className={`text-sm ${mutedClass} mb-3`}>
                Select up to {maxAchievementSlots} achievement{maxAchievementSlots > 1 ? 's' : ''} to display as pins.
                ({displayedAchievementPins.length}/{maxAchievementSlots} selected)
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {earnedAchievements.map(achId => {
                  const ach = ACHIEVEMENTS[achId];
                  if (!ach) return null;
                  const isDisplayed = displayedAchievementPins.includes(achId);
                  return (
                    <button
                      key={achId}
                      onClick={() => handleToggleAchievementPin(achId)}
                      className={`p-3 rounded-sm border text-left ${
                        isDisplayed 
                          ? 'border-teal-500 bg-teal-500/10' 
                          : darkMode ? 'border-slate-600' : 'border-slate-300'
                      }`}
                    >
                      <div className="text-2xl mb-1">{ach.emoji}</div>
                      <div className={`text-sm font-semibold ${textClass}`}>{ach.name}</div>
                      {isDisplayed && <span className="text-xs text-teal-500">✓ Displayed</span>}
                    </button>
                  );
                })}
              </div>
              {earnedAchievements.length === 0 && (
                <p className={`text-center ${mutedClass} py-8`}>No achievements yet! Start trading to earn some.</p>
              )}
            </div>
          )}
          
          {activeTab === 'manage' && (
            <div className="space-y-6">
              {/* Crew Pin Toggle */}
              {userData?.crew && (
                <div>
                  <h3 className={`font-semibold ${textClass} mb-2`}>Crew Pin</h3>
                  {userData?.isCrewHead ? (
                    <div className={`p-3 rounded-sm border border-yellow-500 bg-yellow-500/10`}>
                      <span className="text-xl mr-2">👑</span>
                      <span className={textClass}>Crew Head pin (always displayed)</span>
                      <p className={`text-xs ${mutedClass} mt-1`}>As Crew Head, your crown is always visible!</p>
                    </div>
                  ) : (
                    <button
                      onClick={() => onPurchase('toggleCrewPin', !userData.displayCrewPin, 0)}
                      className={`px-3 py-2 rounded-sm border flex items-center ${
                        userData.displayCrewPin !== false
                          ? 'border-teal-500 bg-teal-500/10' 
                          : darkMode ? 'border-slate-600' : 'border-slate-300'
                      }`}
                    >
                      {CREW_MAP[userData.crew]?.icon ? (
                        <img src={CREW_MAP[userData.crew]?.icon} alt="" className="w-5 h-5 object-contain mr-1" />
                      ) : (
                        <span className="mr-1">{CREW_MAP[userData.crew]?.emblem}</span>
                      )}
                      <span className={`text-sm ${textClass}`}>{CREW_MAP[userData.crew]?.name}</span>
                      {userData.displayCrewPin !== false && <span className="text-xs text-teal-500 ml-2">✓ Displayed</span>}
                    </button>
                  )}
                </div>
              )}
              
              {/* Displayed Shop Pins */}
              <div>
                <h3 className={`font-semibold ${textClass} mb-2`}>
                  Shop Pins ({displayedShopPins.length}/{maxShopSlots} slots)
                </h3>
                {ownedPins.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {ownedPins.map(pinId => {
                      const pin = SHOP_PINS[pinId];
                      if (!pin) return null;
                      const isDisplayed = displayedShopPins.includes(pinId);
                      return (
                        <button
                          key={pinId}
                          onClick={() => handleToggleShopPin(pinId)}
                          className={`px-3 py-2 rounded-sm border ${
                            isDisplayed 
                              ? 'border-teal-500 bg-teal-500/10' 
                              : darkMode ? 'border-slate-600' : 'border-slate-300'
                          }`}
                        >
                          <span className="mr-1">{pin.emoji}</span>
                          <span className={`text-sm ${textClass}`}>{pin.name}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className={`text-sm ${mutedClass}`}>No pins owned yet. Visit the shop to buy some!</p>
                )}
              </div>
              
              {/* Buy Extra Slots */}
              <div>
                <h3 className={`font-semibold ${textClass} mb-2`}>Buy Extra Slots</h3>
                <div className="flex flex-wrap gap-3">
                  {!userData?.extraAchievementSlot && (
                    <button
                      onClick={() => handleBuySlot('achievement')}
                      disabled={cash < PIN_SLOT_COSTS.EXTRA_ACHIEVEMENT_SLOT}
                      className={`px-4 py-2 rounded-sm border ${
                        cash >= PIN_SLOT_COSTS.EXTRA_ACHIEVEMENT_SLOT
                          ? 'border-teal-500 text-teal-500 hover:bg-teal-500/10'
                          : 'border-slate-600 text-slate-500 cursor-not-allowed'
                      }`}
                    >
                      +1 Achievement Slot ({formatCurrency(PIN_SLOT_COSTS.EXTRA_ACHIEVEMENT_SLOT)})
                    </button>
                  )}
                  {!userData?.extraShopSlot && (
                    <button
                      onClick={() => handleBuySlot('shop')}
                      disabled={cash < PIN_SLOT_COSTS.EXTRA_SHOP_SLOT}
                      className={`px-4 py-2 rounded-sm border ${
                        cash >= PIN_SLOT_COSTS.EXTRA_SHOP_SLOT
                          ? 'border-teal-500 text-teal-500 hover:bg-teal-500/10'
                          : 'border-slate-600 text-slate-500 cursor-not-allowed'
                      }`}
                    >
                      +1 Shop Slot ({formatCurrency(PIN_SLOT_COSTS.EXTRA_SHOP_SLOT)})
                    </button>
                  )}
                  {userData?.extraAchievementSlot && userData?.extraShopSlot && (
                    <p className={`text-sm ${mutedClass}`}>All extra slots purchased!</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================
// DAILY MISSIONS MODAL
// ============================================

const DailyMissionsModal = ({ onClose, darkMode, userData, prices, onClaimReward }) => {
  const cardClass = darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-300';
  const textClass = darkMode ? 'text-slate-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-slate-400' : 'text-slate-500';
  
  const today = getTodayDateString();
  const dailyProgress = userData?.dailyMissions?.[today] || {};
  const userCrew = userData?.crew;
  const crewMembers = userCrew ? CREW_MAP[userCrew]?.members || [] : [];
  
  // Calculate mission progress
  const getMissionProgress = (mission) => {
    switch (mission.checkType) {
      case 'BUY_CREW': {
        // Check if user bought any crew member stock today
        const bought = dailyProgress.boughtCrewMember || false;
        return { complete: bought, progress: bought ? 1 : 0, target: 1 };
      }
      case 'HOLD_CREW': {
        // Count total shares of crew members
        const totalShares = crewMembers.reduce((sum, ticker) => {
          return sum + (userData?.holdings?.[ticker] || 0);
        }, 0);
        return { 
          complete: totalShares >= mission.requirement, 
          progress: totalShares, 
          target: mission.requirement 
        };
      }
      case 'TRADE_COUNT': {
        const trades = dailyProgress.tradesCount || 0;
        return { 
          complete: trades >= mission.requirement, 
          progress: trades, 
          target: mission.requirement 
        };
      }
      default:
        return { complete: false, progress: 0, target: 1 };
    }
  };
  
  const missions = Object.values(DAILY_MISSIONS).map(mission => ({
    ...mission,
    ...getMissionProgress(mission),
    claimed: dailyProgress.claimed?.[mission.id] || false
  }));
  
  const totalRewards = missions.reduce((sum, m) => sum + m.reward, 0);
  const earnedRewards = missions.filter(m => m.complete && m.claimed).reduce((sum, m) => sum + m.reward, 0);
  const claimableRewards = missions.filter(m => m.complete && !m.claimed).reduce((sum, m) => sum + m.reward, 0);
  
  // Check if user has no crew
  const noCrew = !userCrew;
  
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className={`w-full max-w-md ${cardClass} border rounded-sm shadow-xl overflow-hidden`}
        onClick={e => e.stopPropagation()}>
        
        <div className={`p-4 border-b ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
          <div className="flex justify-between items-center">
            <h2 className={`text-lg font-semibold ${textClass}`}>📋 Daily Missions</h2>
            <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-teal-600 text-xl`}>×</button>
          </div>
          <p className={`text-sm ${mutedClass}`}>
            Resets daily • Earned: <span className="text-teal-500">{formatCurrency(earnedRewards)}</span> / {formatCurrency(totalRewards)}
          </p>
        </div>
        
        <div className="p-4 space-y-3">
          {noCrew ? (
            <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-slate-100'} text-center`}>
              <p className={`${mutedClass} mb-2`}>Join a crew to unlock daily missions!</p>
              <p className={`text-xs ${mutedClass}`}>Crew missions give you bonus cash rewards every day.</p>
            </div>
          ) : (
            <>
              {missions.map(mission => (
                <div 
                  key={mission.id}
                  className={`p-3 rounded-sm border ${
                    mission.claimed 
                      ? 'border-teal-500/30 bg-teal-500/5' 
                      : mission.complete 
                        ? 'border-teal-500 bg-teal-500/10' 
                        : darkMode ? 'border-slate-600' : 'border-slate-300'
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className={`font-semibold ${textClass}`}>{mission.name}</h3>
                      <p className={`text-xs ${mutedClass}`}>{mission.description}</p>
                    </div>
                    <span className={`text-sm font-bold ${mission.complete ? 'text-teal-500' : mutedClass}`}>
                      +{formatCurrency(mission.reward)}
                    </span>
                  </div>
                  
                  {/* Progress bar */}
                  <div className="flex items-center gap-2">
                    <div className={`flex-1 h-2 rounded-full ${darkMode ? 'bg-slate-700' : 'bg-slate-200'}`}>
                      <div 
                        className={`h-full rounded-full transition-all ${mission.complete ? 'bg-teal-500' : 'bg-amber-500'}`}
                        style={{ width: `${Math.min(100, (mission.progress / mission.target) * 100)}%` }}
                      />
                    </div>
                    <span className={`text-xs ${mutedClass} w-12 text-right`}>
                      {mission.progress}/{mission.target}
                    </span>
                  </div>
                  
                  {/* Claim button */}
                  {mission.complete && !mission.claimed && (
                    <button
                      onClick={() => onClaimReward(mission.id, mission.reward)}
                      className="w-full mt-2 py-1.5 text-sm font-semibold rounded-sm bg-teal-600 hover:bg-teal-700 text-white"
                    >
                      Claim Reward
                    </button>
                  )}
                  {mission.claimed && (
                    <p className="text-xs text-teal-500 mt-2 text-center">✓ Claimed</p>
                  )}
                </div>
              ))}
              
              {/* Crew member hint */}
              <div className={`p-2 rounded-sm ${darkMode ? 'bg-slate-700/30' : 'bg-slate-100'}`}>
                <p className={`text-xs ${mutedClass} flex items-center flex-wrap gap-1`}>
                  {CREW_MAP[userCrew]?.icon ? (
                    <img src={CREW_MAP[userCrew]?.icon} alt="" className="w-4 h-4 object-contain inline" />
                  ) : (
                    <span style={{ color: CREW_MAP[userCrew]?.color }}>{CREW_MAP[userCrew]?.emblem}</span>
                  )}
                  <span style={{ color: CREW_MAP[userCrew]?.color }}>{CREW_MAP[userCrew]?.name}</span> members: {crewMembers.join(', ')}
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================
// ACHIEVEMENTS MODAL
// ============================================

const AchievementsModal = ({ onClose, darkMode, userData }) => {
  const cardClass = darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-300';
  const textClass = darkMode ? 'text-slate-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-slate-400' : 'text-slate-600';
  const bgClass = darkMode ? 'bg-slate-900' : 'bg-slate-100';
  
  const earnedAchievements = userData?.achievements || [];
  const allAchievements = Object.values(ACHIEVEMENTS);
  
  // Group achievements by category
  const categories = {
    'Trading': ['FIRST_BLOOD', 'SHARK', 'DIVERSIFIED', 'TRADER_20', 'TRADER_100'],
    'Profits': ['BULL_RUN', 'DIAMOND_HANDS', 'COLD_BLOODED'],
    'Portfolio': ['BROKE_2K', 'BROKE_5K', 'BROKE_10K', 'BROKE_25K'],
    'Predictions': ['ORACLE', 'PROPHET'],
    'Dedication': ['DEDICATED_7', 'DEDICATED_14', 'DEDICATED_30', 'DEDICATED_100'],
    'Missions': ['MISSION_10', 'MISSION_50', 'MISSION_100'],
    'Leaderboard': ['TOP_10', 'TOP_3', 'TOP_1']
  };
  
  // Get lending eligibility
  const lendingStatus = checkLendingEligibility(userData);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div 
        className={`w-full max-w-2xl max-h-[85vh] ${cardClass} border rounded-sm shadow-xl overflow-hidden flex flex-col`}
        onClick={e => e.stopPropagation()}
      >
        <div className={`p-4 border-b ${darkMode ? 'border-slate-700' : 'border-slate-200'} flex justify-between items-center`}>
          <div>
            <h2 className={`text-xl font-bold ${textClass}`}>🏆 Achievements</h2>
            <p className={`text-sm ${mutedClass}`}>
              {earnedAchievements.length} / {allAchievements.length} unlocked
            </p>
          </div>
          <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-teal-600 text-xl`}>×</button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Lending Status Banner */}
          <div className={`p-4 rounded-sm ${lendingStatus.eligible 
            ? (darkMode ? 'bg-green-900/30 border border-green-700' : 'bg-green-50 border border-green-200')
            : (darkMode ? 'bg-slate-700/50' : 'bg-slate-100')
          }`}>
            <h3 className={`font-semibold mb-2 ${lendingStatus.eligible ? 'text-green-500' : textClass}`}>
              {lendingStatus.eligible ? '✅ Lending Unlocked!' : '🔒 Lending System (Locked)'}
            </h3>
            {lendingStatus.eligible ? (
              <p className={`text-sm ${mutedClass}`}>
                Credit limit: <span className="text-green-500 font-semibold">${lendingStatus.creditLimit.toLocaleString()}</span>
                <br />
                <span className="text-teal-500 text-xs">Click the 🏦 Lending button in the nav bar to borrow!</span>
              </p>
            ) : (
              <div className="space-y-1">
                <p className={`text-xs ${mutedClass} mb-2`}>Unlock requirements:</p>
                {lendingStatus.requirements.map((req, i) => (
                  <div key={i} className={`text-sm flex items-center gap-2 ${req.met ? 'text-green-500' : mutedClass}`}>
                    <span>{req.met ? '✓' : '○'}</span>
                    <span>{req.label}</span>
                    {!req.met && <span className="text-xs">({req.current}/{req.required})</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
          
          {/* Achievement Categories */}
          {Object.entries(categories).map(([category, achievementIds]) => (
            <div key={category}>
              <h3 className={`font-semibold mb-3 ${textClass}`}>{category}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {achievementIds.map(id => {
                  const achievement = ACHIEVEMENTS[id];
                  const earned = earnedAchievements.includes(id);
                  
                  return (
                    <div 
                      key={id}
                      className={`p-3 rounded-sm border ${
                        earned 
                          ? (darkMode ? 'bg-teal-900/30 border-teal-700' : 'bg-teal-50 border-teal-300')
                          : (darkMode ? 'bg-slate-700/30 border-slate-600' : 'bg-slate-50 border-slate-200')
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span className={`text-2xl ${earned ? '' : 'grayscale opacity-50'}`}>
                          {achievement.emoji}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className={`font-semibold text-sm ${earned ? 'text-teal-500' : mutedClass}`}>
                            {achievement.name}
                          </div>
                          <div className={`text-xs ${mutedClass}`}>
                            {earned ? achievement.description : achievement.hint}
                          </div>
                        </div>
                        {earned && <span className="text-green-500 text-sm">✓</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ============================================
// LENDING MODAL
// ============================================

const LOAN_INTEREST_RATE = 0.05; // 5% per day
const LOAN_MAX_DAYS = 7;
const LOAN_MIN_AMOUNT = 100;

const LendingModal = ({ onClose, darkMode, userData, onBorrow, onRepay }) => {
  const [borrowAmount, setBorrowAmount] = useState(500);
  const [repayAmount, setRepayAmount] = useState(0);
  
  const cardClass = darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-300';
  const textClass = darkMode ? 'text-slate-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-slate-400' : 'text-slate-600';
  
  const lendingStatus = checkLendingEligibility(userData);
  const activeLoan = userData?.activeLoan || null;
  
  // Calculate loan details if active
  const loanDetails = useMemo(() => {
    if (!activeLoan) return null;
    
    const now = Date.now();
    const daysPassed = (now - activeLoan.borrowedAt) / (1000 * 60 * 60 * 24);
    const interest = activeLoan.principal * LOAN_INTEREST_RATE * daysPassed;
    const totalOwed = activeLoan.principal + interest;
    const daysRemaining = LOAN_MAX_DAYS - daysPassed;
    const isOverdue = daysRemaining <= 0;
    
    return {
      principal: activeLoan.principal,
      interest: Math.round(interest * 100) / 100,
      totalOwed: Math.round(totalOwed * 100) / 100,
      daysPassed: Math.floor(daysPassed),
      daysRemaining: Math.max(0, Math.ceil(daysRemaining)),
      isOverdue
    };
  }, [activeLoan]);
  
  // Set default repay amount to total owed
  useEffect(() => {
    if (loanDetails) {
      setRepayAmount(loanDetails.totalOwed);
    }
  }, [loanDetails]);
  
  const handleBorrow = () => {
    if (borrowAmount >= LOAN_MIN_AMOUNT && borrowAmount <= lendingStatus.creditLimit) {
      onBorrow(borrowAmount);
    }
  };
  
  const handleRepay = () => {
    if (repayAmount > 0 && repayAmount <= (userData?.cash || 0)) {
      onRepay(Math.min(repayAmount, loanDetails?.totalOwed || 0));
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div 
        className={`w-full max-w-md ${cardClass} border rounded-sm shadow-xl overflow-hidden`}
        onClick={e => e.stopPropagation()}
      >
        <div className={`p-4 border-b ${darkMode ? 'border-slate-700' : 'border-slate-200'} flex justify-between items-center`}>
          <div>
            <h2 className={`text-xl font-bold ${textClass}`}>🏦 Lending</h2>
            <p className={`text-sm ${mutedClass}`}>Borrow cash to trade with</p>
          </div>
          <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-teal-600 text-xl`}>×</button>
        </div>
        
        <div className="p-4 space-y-4">
          {!lendingStatus.eligible ? (
            // Locked state
            <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-slate-100'}`}>
              <h3 className={`font-semibold mb-2 ${textClass}`}>🔒 Lending Locked</h3>
              <p className={`text-sm ${mutedClass} mb-3`}>Meet these requirements to unlock:</p>
              <div className="space-y-1">
                {lendingStatus.requirements.map((req, i) => (
                  <div key={i} className={`text-sm flex items-center gap-2 ${req.met ? 'text-green-500' : mutedClass}`}>
                    <span>{req.met ? '✓' : '○'}</span>
                    <span>{req.label}</span>
                    {!req.met && <span className="text-xs">({req.current}/{req.required})</span>}
                  </div>
                ))}
              </div>
            </div>
          ) : activeLoan ? (
            // Active loan - repayment UI
            <div className="space-y-4">
              <div className={`p-4 rounded-sm ${loanDetails?.isOverdue 
                ? (darkMode ? 'bg-red-900/30 border border-red-700' : 'bg-red-50 border border-red-200')
                : (darkMode ? 'bg-amber-900/30 border border-amber-700' : 'bg-amber-50 border border-amber-200')
              }`}>
                <h3 className={`font-semibold mb-2 ${loanDetails?.isOverdue ? 'text-red-500' : 'text-amber-500'}`}>
                  {loanDetails?.isOverdue ? '⚠️ LOAN OVERDUE!' : '📋 Active Loan'}
                </h3>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className={mutedClass}>Principal:</span>
                    <span className={textClass}>{formatCurrency(loanDetails?.principal || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className={mutedClass}>Interest accrued:</span>
                    <span className="text-red-500">+{formatCurrency(loanDetails?.interest || 0)}</span>
                  </div>
                  <div className={`flex justify-between font-bold pt-1 border-t ${darkMode ? 'border-slate-600' : 'border-slate-300'}`}>
                    <span className={textClass}>Total owed:</span>
                    <span className="text-amber-500">{formatCurrency(loanDetails?.totalOwed || 0)}</span>
                  </div>
                  <div className="flex justify-between pt-2">
                    <span className={mutedClass}>Time remaining:</span>
                    <span className={loanDetails?.isOverdue ? 'text-red-500 font-bold' : 'text-teal-500'}>
                      {loanDetails?.isOverdue ? 'OVERDUE' : `${loanDetails?.daysRemaining} days`}
                    </span>
                  </div>
                </div>
              </div>
              
              {loanDetails?.isOverdue && (
                <div className={`p-3 rounded-sm text-sm ${darkMode ? 'bg-red-900/20' : 'bg-red-50'} text-red-500`}>
                  ⚠️ Your loan is overdue! Repay immediately to avoid account restrictions.
                </div>
              )}
              
              <div>
                <label className={`text-sm font-semibold ${textClass} block mb-2`}>Repay Amount</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={1}
                    max={Math.min(userData?.cash || 0, loanDetails?.totalOwed || 0)}
                    value={repayAmount}
                    onChange={(e) => setRepayAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                    className={`flex-1 px-3 py-2 rounded-sm border ${
                      darkMode ? 'bg-slate-900 border-slate-600 text-slate-100' : 'bg-white border-slate-300'
                    }`}
                  />
                  <button
                    onClick={() => setRepayAmount(Math.min(userData?.cash || 0, loanDetails?.totalOwed || 0))}
                    className={`px-3 py-2 text-xs font-semibold rounded-sm ${
                      darkMode ? 'bg-slate-700 text-slate-300' : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    Max
                  </button>
                </div>
                <p className={`text-xs ${mutedClass} mt-1`}>
                  Your cash: {formatCurrency(userData?.cash || 0)}
                </p>
              </div>
              
              <button
                onClick={handleRepay}
                disabled={repayAmount <= 0 || repayAmount > (userData?.cash || 0)}
                className={`w-full py-3 font-semibold rounded-sm ${
                  repayAmount > 0 && repayAmount <= (userData?.cash || 0)
                    ? 'bg-green-600 hover:bg-green-700 text-white'
                    : 'bg-slate-500 cursor-not-allowed text-slate-300'
                }`}
              >
                Repay {formatCurrency(repayAmount)}
              </button>
            </div>
          ) : (
            // No active loan - borrow UI
            <div className="space-y-4">
              <div className={`p-4 rounded-sm ${darkMode ? 'bg-green-900/20 border border-green-800' : 'bg-green-50 border border-green-200'}`}>
                <div className="flex justify-between items-center mb-2">
                  <span className={`font-semibold ${textClass}`}>Credit Limit</span>
                  <span className="text-green-500 font-bold text-lg">{formatCurrency(lendingStatus.creditLimit)}</span>
                </div>
                <p className={`text-xs ${mutedClass}`}>
                  Based on your achievements and trading history
                </p>
              </div>
              
              <div className={`p-3 rounded-sm text-sm ${darkMode ? 'bg-slate-700/50' : 'bg-slate-100'}`}>
                <div className="flex items-center gap-2 mb-2">
                  <span>📊</span>
                  <span className={`font-semibold ${textClass}`}>Loan Terms</span>
                </div>
                <ul className={`text-xs ${mutedClass} space-y-1`}>
                  <li>• Interest rate: <span className="text-amber-500">5% per day</span></li>
                  <li>• Maximum term: <span className="text-teal-500">7 days</span></li>
                  <li>• Minimum loan: <span className="text-teal-500">{formatCurrency(LOAN_MIN_AMOUNT)}</span></li>
                  <li>• Overdue loans may result in account restrictions</li>
                </ul>
              </div>
              
              <div>
                <label className={`text-sm font-semibold ${textClass} block mb-2`}>Borrow Amount</label>
                <input
                  type="range"
                  min={LOAN_MIN_AMOUNT}
                  max={lendingStatus.creditLimit}
                  step={50}
                  value={borrowAmount}
                  onChange={(e) => setBorrowAmount(parseInt(e.target.value))}
                  className="w-full"
                />
                <div className="flex justify-between mt-1">
                  <span className={`text-xs ${mutedClass}`}>{formatCurrency(LOAN_MIN_AMOUNT)}</span>
                  <span className={`text-lg font-bold ${textClass}`}>{formatCurrency(borrowAmount)}</span>
                  <span className={`text-xs ${mutedClass}`}>{formatCurrency(lendingStatus.creditLimit)}</span>
                </div>
              </div>
              
              <div className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700/30' : 'bg-slate-50'}`}>
                <div className="text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className={mutedClass}>If repaid in 1 day:</span>
                    <span className={textClass}>{formatCurrency(borrowAmount * 1.05)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className={mutedClass}>If repaid in 7 days:</span>
                    <span className="text-amber-500">{formatCurrency(borrowAmount * 1.35)}</span>
                  </div>
                </div>
              </div>
              
              <button
                onClick={handleBorrow}
                className="w-full py-3 font-semibold rounded-sm bg-teal-600 hover:bg-teal-700 text-white"
              >
                Borrow {formatCurrency(borrowAmount)}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const CheckInButton = ({ isGuest, lastCheckin, onCheckin, darkMode }) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const [timeUntilReset, setTimeUntilReset] = useState('');

  const today = new Date().toDateString();
  const hasCheckedIn = !isGuest && lastCheckin === today;

  useEffect(() => {
    if (!hasCheckedIn) return;

    const updateTimer = () => {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      
      const diff = tomorrow - now;
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      
      setTimeUntilReset(`${hours}h ${minutes}m ${seconds}s`);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [hasCheckedIn]);

  // Toggle tooltip on click/tap for mobile support
  const handleButtonClick = () => {
    if (hasCheckedIn) {
      setShowTooltip(prev => !prev);
    } else {
      onCheckin();
    }
  };

  return (
    <div className="relative mt-2">
      <button 
        onClick={handleButtonClick}
        onMouseEnter={() => hasCheckedIn && setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`w-full py-1.5 text-xs font-semibold uppercase rounded-sm ${
          hasCheckedIn
            ? 'bg-slate-400 cursor-pointer' 
            : 'bg-teal-600 hover:bg-teal-700'
        } text-white`}
      >
        {hasCheckedIn ? 'Checked In ✓' : 'Daily Check-in (+$300)'}
      </button>
      
      {showTooltip && hasCheckedIn && (
        <div className={`absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 rounded-sm text-xs whitespace-nowrap z-50 ${
          darkMode ? 'bg-slate-700 text-slate-100' : 'bg-slate-800 text-white'
        } shadow-lg`}>
          <div className="text-center">
            <div className="font-semibold">Next check-in available in:</div>
            <div className="text-teal-400 font-mono mt-1">{timeUntilReset}</div>
          </div>
          <div className={`absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent ${
            darkMode ? 'border-t-slate-700' : 'border-t-slate-800'
          }`} />
        </div>
      )}
    </div>
  );
};

// ============================================
// LOGIN MODAL
// ============================================

const LoginModal = ({ onClose, darkMode }) => {
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError('');
    try {
      await signInWithPopup(auth, googleProvider);
      // Don't close modal - let the username modal appear if needed
      // The auth state listener will handle the flow
      onClose();
    } catch (err) {
      if (err.code === 'auth/popup-closed-by-user') {
        // User closed popup, not an error
      } else if (err.code === 'auth/unauthorized-domain') {
        setError('Domain not authorized. Please add this domain to Firebase Auth settings.');
      } else {
        setError(err.message);
      }
    }
    setLoading(false);
  };

  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!email || !password) {
      setError('Please fill in all fields');
      setLoading(false);
      return;
    }

    try {
      if (isRegistering) {
        if (password !== confirmPassword) {
          setError('Passwords do not match');
          setLoading(false);
          return;
        }
        if (password.length < 6) {
          setError('Password must be at least 6 characters');
          setLoading(false);
          return;
        }
        // Just create auth - username modal will handle the rest
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      onClose();
    } catch (err) {
      if (err.code === 'auth/user-not-found') setError('No account found with this email');
      else if (err.code === 'auth/wrong-password') setError('Incorrect password');
      else if (err.code === 'auth/invalid-credential') setError('Invalid email or password');
      else if (err.code === 'auth/email-already-in-use') setError('Email already in use');
      else setError(err.message);
    }
    setLoading(false);
  };

  const cardClass = darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-300';
  const textClass = darkMode ? 'text-slate-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-slate-400' : 'text-slate-600';
  const inputClass = darkMode 
    ? 'bg-slate-900 border-slate-600 text-slate-100' 
    : 'bg-white border-slate-300 text-slate-900';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className={`w-full max-w-md ${cardClass} border rounded-sm shadow-xl p-6`} onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className={`absolute top-4 right-4 ${mutedClass} hover:text-teal-600 text-xl`}>×</button>

        <h2 className={`text-lg font-semibold mb-6 ${textClass}`}>
          {isRegistering ? 'Create Account' : 'Sign In'}
        </h2>

        {/* Google Sign In */}
        <button
          onClick={handleGoogleSignIn}
          disabled={loading}
          className={`w-full py-2.5 px-4 rounded-sm border flex items-center justify-center gap-2 mb-4 ${
            darkMode ? 'border-slate-600 text-slate-200 hover:bg-slate-700' : 'border-slate-300 text-slate-700 hover:bg-slate-50'
          } disabled:opacity-50`}
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Continue with Google
        </button>

        <div className={`flex items-center gap-3 mb-4 ${mutedClass}`}>
          <div className="flex-1 h-px bg-current opacity-30"></div>
          <span className="text-xs uppercase">or</span>
          <div className="flex-1 h-px bg-current opacity-30"></div>
        </div>

        {/* Email Form - Sign in only (registration disabled due to bots) */}
        {!isRegistering ? (
          <form onSubmit={handleEmailSubmit} className="space-y-3">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`w-full px-3 py-2 border rounded-sm text-sm ${inputClass}`}
              disabled={loading}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`w-full px-3 py-2 border rounded-sm text-sm ${inputClass}`}
              disabled={loading}
            />
            {error && (
              <div className="bg-red-100 border border-red-300 text-red-700 px-3 py-2 rounded-sm text-sm">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-teal-600 hover:bg-teal-700 text-white font-semibold py-2 px-4 rounded-sm text-sm uppercase disabled:opacity-50"
            >
              {loading ? 'Please wait...' : 'Sign In'}
            </button>
          </form>
        ) : (
          <div className={`text-center py-4 ${mutedClass}`}>
            <p className="text-sm mb-2">📧 Email registration is temporarily disabled.</p>
            <p className="text-sm">Please use <strong>Google Sign-In</strong> above to create an account.</p>
          </div>
        )}

        <div className="mt-4 text-center">
          <button
            onClick={() => { setIsRegistering(!isRegistering); setError(''); }}
            className={`text-sm ${mutedClass} hover:text-teal-600`}
          >
            {isRegistering ? 'Already have an account? Sign in with email' : "Don't have an account? Register"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================
// USERNAME SELECTION MODAL (for new users)
// ============================================

const UsernameModal = ({ user, onComplete, darkMode }) => {
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    const trimmed = username.trim();
    if (!trimmed) {
      setError('Please enter a username');
      return;
    }
    if (trimmed.length < 3) {
      setError('Username must be at least 3 characters');
      return;
    }
    if (trimmed.length > 20) {
      setError('Username must be 20 characters or less');
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
      setError('Username can only contain letters, numbers, and underscores');
      return;
    }

    setLoading(true);
    try {
      // Create user document with chosen username (no real name stored!)
      const userDocRef = doc(db, 'users', user.uid);
      const now = Date.now();
      await setDoc(userDocRef, {
        displayName: trimmed,
        // We intentionally do NOT store firebaseUser.displayName or email
        cash: STARTING_CASH,
        holdings: {},
        portfolioValue: STARTING_CASH,
        portfolioHistory: [{ timestamp: now, value: STARTING_CASH }], // Initial data point
        lastCheckin: null,
        createdAt: serverTimestamp(),
        // Achievement tracking
        achievements: [],
        totalCheckins: 0,
        totalTrades: 0,
        peakPortfolioValue: STARTING_CASH,
        predictionWins: 0,
        // Track cost basis for profit calculations
        costBasis: {}, // { ticker: averageCostPerShare }
        // Lending system (unlocked later)
        lendingUnlocked: false,
        isBankrupt: false
      });
      onComplete();
    } catch (err) {
      setError('Failed to create account. Please try again.');
      console.error(err);
    }
    setLoading(false);
  };

  const cardClass = darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-300';
  const textClass = darkMode ? 'text-slate-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-slate-400' : 'text-slate-600';
  const inputClass = darkMode 
    ? 'bg-slate-900 border-slate-600 text-slate-100' 
    : 'bg-white border-slate-300 text-slate-900';

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
      <div className={`w-full max-w-md ${cardClass} border rounded-sm shadow-xl p-6`}>
        <h2 className={`text-xl font-semibold mb-2 ${textClass}`}>Welcome to Stockism! 🎉</h2>
        <p className={`text-sm ${mutedClass} mb-6`}>
          Choose a username for the leaderboard. This is the only name other players will see.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={`block text-xs font-semibold uppercase tracking-wide mb-1 ${mutedClass}`}>
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter a username..."
              className={`w-full px-3 py-2 border rounded-sm text-sm ${inputClass} focus:outline-none focus:ring-1 focus:ring-teal-600`}
              disabled={loading}
              autoFocus
              maxLength={20}
            />
            <p className={`text-xs ${mutedClass} mt-1`}>
              3-20 characters, letters, numbers, and underscores only
            </p>
          </div>

          {error && (
            <div className="bg-red-100 border border-red-300 text-red-700 px-3 py-2 rounded-sm text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-teal-600 hover:bg-teal-700 text-white font-semibold py-2.5 px-4 rounded-sm text-sm uppercase tracking-wide transition-colors disabled:opacity-50"
          >
            {loading ? 'Creating account...' : 'Start Trading'}
          </button>
        </form>

        <p className={`text-xs ${mutedClass} mt-4 text-center`}>
          🔒 Your Google account info is never stored or shared
        </p>
      </div>
    </div>
  );
};

// ============================================
// CHARACTER CARD
// ============================================

const CharacterCard = ({ character, price, priceChange, sentiment, holdings, shortPosition, onTrade, onViewChart, priceHistory, darkMode }) => {
  const [showTrade, setShowTrade] = useState(false);
  const [tradeAmount, setTradeAmount] = useState(1);
  const [tradeMode, setTradeMode] = useState('normal'); // 'normal' or 'short'

  const owned = holdings > 0;
  const shorted = shortPosition && shortPosition.shares > 0;
  const isUp = priceChange >= 0;
  const isETF = character.isETF;

  const cardClass = darkMode 
    ? `bg-slate-800 border-slate-700 ${owned ? 'ring-1 ring-blue-500' : ''} ${shorted ? 'ring-1 ring-orange-500' : ''}` 
    : `bg-white border-slate-300 ${owned ? 'ring-1 ring-blue-500' : ''} ${shorted ? 'ring-1 ring-orange-500' : ''}`;
  const textClass = darkMode ? 'text-slate-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-slate-400' : 'text-slate-500';

  const getSentimentColor = () => {
    switch (sentiment) {
      case 'Strong Buy': return 'text-green-500';
      case 'Bullish': return 'text-green-400';
      case 'Neutral': return 'text-amber-500';
      case 'Bearish': return 'text-red-400';
      case 'Strong Sell': return 'text-red-500';
      default: return mutedClass;
    }
  };

  const miniChartData = useMemo(() => {
    const data = priceHistory[character.ticker] || [];
    const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const filtered = data.filter(p => p.timestamp >= cutoff);
    
    // If we have enough data, use it
    if (filtered.length >= 2) {
      return filtered;
    }
    
    // Otherwise, create a synthetic chart from base price to current price
    const basePrice = character.basePrice;
    const now = Date.now();
    const dayAgo = now - (24 * 60 * 60 * 1000);
    
    return [
      { timestamp: dayAgo, price: basePrice },
      { timestamp: now, price: price }
    ];
  }, [priceHistory, character.ticker, character.basePrice, price]);

  // Calculate short P/L if shorted
  const shortPL = shorted ? (shortPosition.entryPrice - price) * shortPosition.shares : 0;

  return (
    <div className={`${cardClass} border rounded-sm p-4 transition-all`}>
      <div className="cursor-pointer" onClick={() => !showTrade && onViewChart(character)}>
        <div className="flex justify-between items-start mb-2">
          <div>
            <div className="flex items-center gap-1">
              <p className="text-teal-600 font-mono text-sm font-semibold">${character.ticker}</p>
              {isETF && <span className="text-xs bg-purple-600 text-white px-1 rounded">ETF</span>}
            </div>
            <p className={`text-xs ${mutedClass} mt-0.5`}>{character.name}</p>
            {character.description && <p className={`text-xs ${mutedClass}`}>{character.description}</p>}
          </div>
          <div className="text-right">
            <p className={`font-semibold ${textClass}`}>{formatCurrency(price)}</p>
            <p className={`text-xs font-mono ${isUp ? 'text-green-500' : 'text-red-500'}`}>
              {isUp ? '▲' : '▼'} {formatChange(priceChange)}
            </p>
          </div>
        </div>
        <div className="mb-2">
          <SimpleLineChart data={miniChartData} darkMode={darkMode} />
        </div>
      </div>

      <div className="flex justify-between items-center mb-3">
        <span className={`text-xs ${getSentimentColor()} font-semibold uppercase`}>{sentiment}</span>
        <div className="flex gap-2">
          {owned && <span className="text-xs text-blue-500 font-semibold">{holdings} long</span>}
          {shorted && (
            <span className={`text-xs font-semibold ${shortPL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {shortPosition.shares} short ({shortPL >= 0 ? '+' : ''}{formatCurrency(shortPL)})
            </span>
          )}
        </div>
      </div>

      {!showTrade ? (
        <button
          onClick={(e) => { e.stopPropagation(); setShowTrade(true); setTradeMode('normal'); }}
          className={`w-full py-1.5 text-xs font-semibold uppercase rounded-sm border ${
            darkMode ? 'border-slate-600 text-slate-300 hover:bg-slate-700' : 'border-slate-300 text-slate-600 hover:bg-slate-100'
          }`}
        >
          Trade
        </button>
      ) : (
        <div className="space-y-2" onClick={e => e.stopPropagation()}>
          {/* Trade mode tabs */}
          <div className="flex gap-1 mb-2">
            <button 
              onClick={() => setTradeMode('normal')}
              className={`flex-1 py-1 text-xs font-semibold rounded-sm ${tradeMode === 'normal' ? 'bg-teal-600 text-white' : darkMode ? 'bg-slate-700 text-slate-300' : 'bg-slate-200 text-slate-600'}`}
            >
              Buy/Sell
            </button>
            <button 
              onClick={() => setTradeMode('short')}
              className={`flex-1 py-1 text-xs font-semibold rounded-sm ${tradeMode === 'short' ? 'bg-orange-600 text-white' : darkMode ? 'bg-slate-700 text-slate-300' : 'bg-slate-200 text-slate-600'}`}
            >
              Short
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => setTradeAmount(Math.max(1, tradeAmount - 1))}
              className={`px-2 py-1 text-sm rounded-sm ${darkMode ? 'bg-slate-700' : 'bg-slate-200'}`}>-</button>
            <input type="number" min="1" value={tradeAmount}
              onChange={(e) => setTradeAmount(Math.max(1, parseInt(e.target.value) || 1))}
              className={`w-full text-center py-1 text-sm rounded-sm border ${darkMode ? 'bg-slate-900 border-slate-600 text-slate-100' : 'bg-white border-slate-300 text-slate-900'}`} />
            <button onClick={() => setTradeAmount(tradeAmount + 1)}
              className={`px-2 py-1 text-sm rounded-sm ${darkMode ? 'bg-slate-700' : 'bg-slate-200'}`}>+</button>
          </div>

          {tradeMode === 'normal' ? (
            <div className="flex gap-2">
              <button onClick={() => { onTrade(character.ticker, 'buy', tradeAmount); setShowTrade(false); setTradeAmount(1); }}
                className="flex-1 py-1.5 text-xs font-semibold uppercase bg-green-600 hover:bg-green-700 text-white rounded-sm">
                Buy
              </button>
              <button onClick={() => { onTrade(character.ticker, 'sell', tradeAmount); setShowTrade(false); setTradeAmount(1); }}
                disabled={holdings < tradeAmount}
                className="flex-1 py-1.5 text-xs font-semibold uppercase bg-red-600 hover:bg-red-700 text-white rounded-sm disabled:opacity-50">
                Sell
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => { onTrade(character.ticker, 'short', tradeAmount); setShowTrade(false); setTradeAmount(1); }}
                className="flex-1 py-1.5 text-xs font-semibold uppercase bg-orange-600 hover:bg-orange-700 text-white rounded-sm">
                Open Short
              </button>
              <button onClick={() => { onTrade(character.ticker, 'cover', tradeAmount); setShowTrade(false); setTradeAmount(1); }}
                disabled={!shorted || shortPosition.shares < tradeAmount}
                className="flex-1 py-1.5 text-xs font-semibold uppercase bg-blue-600 hover:bg-blue-700 text-white rounded-sm disabled:opacity-50">
                Cover
              </button>
            </div>
          )}
          
          {tradeMode === 'short' && (
            <p className={`text-xs ${mutedClass} text-center`}>
              50% margin required • 0.1% daily interest
            </p>
          )}
          
          <button onClick={() => { setShowTrade(false); setTradeAmount(1); }}
            className={`w-full py-1 text-xs ${mutedClass} hover:text-teal-600`}>Cancel</button>
        </div>
      )}
    </div>
  );
};

const inputClass = 'bg-slate-900 border-slate-600 text-slate-100';

// ============================================
// MAIN APP
// ============================================

export default function App() {
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [prices, setPrices] = useState({});
  const [priceHistory, setPriceHistory] = useState({});
  const [marketData, setMarketData] = useState(null);
  const [darkMode, setDarkMode] = useState(true);
  const [loading, setLoading] = useState(true);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showPortfolio, setShowPortfolio] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showAchievements, setShowAchievements] = useState(false);
  const [showLending, setShowLending] = useState(false);
  const [showCrewSelection, setShowCrewSelection] = useState(false);
  const [showPinShop, setShowPinShop] = useState(false);
  const [showDailyMissions, setShowDailyMissions] = useState(false);
  const [selectedCharacter, setSelectedCharacter] = useState(null);
  const [notification, setNotification] = useState(null);
  const [needsUsername, setNeedsUsername] = useState(false);
  const [sortBy, setSortBy] = useState('price-high');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [showAll, setShowAll] = useState(false);
  const [predictions, setPredictions] = useState([]);
  const [showAdmin, setShowAdmin] = useState(false);

  // Listen to auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        // Listen to user data
        const userDocRef = doc(db, 'users', firebaseUser.uid);
        const userSnap = await getDoc(userDocRef);
        
        if (!userSnap.exists()) {
          // New user - prompt for username (don't auto-create yet)
          setNeedsUsername(true);
          setUserData(null);
        } else {
          setNeedsUsername(false);
          const data = userSnap.data();
          setUserData(data);
          
          // Subscribe to user data changes
          onSnapshot(userDocRef, (snap) => {
            if (snap.exists()) setUserData(snap.data());
          });
        }
      } else {
        setUserData(null);
        setNeedsUsername(false);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Listen to global market data
  useEffect(() => {
    const marketRef = doc(db, 'market', 'current');
    
    const unsubscribe = onSnapshot(marketRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        // Merge stored prices with basePrices for any new characters
        const storedPrices = data.prices || {};
        const mergedPrices = {};
        CHARACTERS.forEach(c => {
          mergedPrices[c.ticker] = storedPrices[c.ticker] ?? c.basePrice;
        });
        setPrices(mergedPrices);
        setPriceHistory(data.priceHistory || {});
        setMarketData(data);
      } else {
        // Initialize market data if it doesn't exist
        const initialPrices = {};
        const initialHistory = {};
        CHARACTERS.forEach(c => {
          initialPrices[c.ticker] = c.basePrice;
          initialHistory[c.ticker] = [{ timestamp: Date.now(), price: c.basePrice }];
        });
        
        setDoc(marketRef, {
          prices: initialPrices,
          priceHistory: initialHistory,
          lastUpdate: serverTimestamp(),
          totalTrades: 0
        });
        
        setPrices(initialPrices);
        setPriceHistory(initialHistory);
      }
    });

    return () => unsubscribe();
  }, []);

  // Listen to predictions
  useEffect(() => {
    const predictionsRef = doc(db, 'predictions', 'current');
    
    const unsubscribe = onSnapshot(predictionsRef, (snap) => {
      if (snap.exists()) {
        setPredictions(snap.data().list || []);
      } else {
        // No predictions document - just show empty state
        // Only admins can create predictions via Admin Panel
        setPredictions([]);
      }
    });

    return () => unsubscribe();
  }, []);

  // Auto-process payouts when prediction is resolved
  useEffect(() => {
    const processPayouts = async () => {
      if (!user || !userData || !userData.bets) return;
      
      for (const prediction of predictions) {
        if (!prediction.resolved || prediction.payoutsProcessed) continue;
        
        const userBet = userData.bets[prediction.id];
        if (!userBet || userBet.paid) continue;
        
        // Check if user won
        if (userBet.option === prediction.outcome) {
          // Calculate payout
          const options = prediction.options || ['Yes', 'No'];
          const pools = prediction.pools || {};
          const winningPool = pools[prediction.outcome] || 0;
          const totalPool = options.reduce((sum, opt) => sum + (pools[opt] || 0), 0);
          
          if (winningPool > 0 && totalPool > 0) {
            const userShare = userBet.amount / winningPool;
            const payout = userShare * totalPool;
            
            // Calculate new prediction wins count
            const newPredictionWins = (userData.predictionWins || 0) + 1;
            
            // Check for Oracle/Prophet achievements
            const currentAchievements = userData.achievements || [];
            const newAchievements = [];
            
            if (newPredictionWins >= 3 && !currentAchievements.includes('ORACLE')) {
              newAchievements.push('ORACLE');
            }
            if (newPredictionWins >= 10 && !currentAchievements.includes('PROPHET')) {
              newAchievements.push('PROPHET');
            }
            
            // Update user's cash, mark bet as paid, increment wins
            const userRef = doc(db, 'users', user.uid);
            const updateData = {
              cash: userData.cash + payout,
              [`bets.${prediction.id}.paid`]: true,
              [`bets.${prediction.id}.payout`]: payout,
              predictionWins: newPredictionWins
            };
            
            if (newAchievements.length > 0) {
              updateData.achievements = arrayUnion(...newAchievements);
            }
            
            await updateDoc(userRef, updateData);
            
            // Show achievement notification if earned, otherwise payout notification
            if (newAchievements.length > 0) {
              const achievement = ACHIEVEMENTS[newAchievements[0]];
              setNotification({ 
                type: 'achievement', 
                message: `🏆 ${achievement.emoji} ${achievement.name} unlocked! +${formatCurrency(payout)} payout!` 
              });
            } else {
              setNotification({ 
                type: 'success', 
                message: `🎉 Prediction payout: +${formatCurrency(payout)}!` 
              });
            }
            setTimeout(() => setNotification(null), 5000);
          }
        } else {
          // Mark losing bet as processed
          const userRef = doc(db, 'users', user.uid);
          await updateDoc(userRef, {
            [`bets.${prediction.id}.paid`]: true,
            [`bets.${prediction.id}.payout`]: 0
          });
        }
      }
    };
    
    processPayouts();
  }, [user, userData, predictions]);

  // Check for margin calls on short positions
  useEffect(() => {
    const checkMarginCalls = async () => {
      if (!user || !userData || !userData.shorts || Object.keys(prices).length === 0) return;
      
      const shorts = userData.shorts;
      const liquidations = [];
      
      for (const [ticker, position] of Object.entries(shorts)) {
        if (!position || position.shares <= 0) continue;
        
        const currentPrice = prices[ticker];
        if (!currentPrice) continue;
        
        // Calculate current loss on position
        const loss = (currentPrice - position.entryPrice) * position.shares;
        const equityRemaining = position.margin - loss;
        const equityRatio = equityRemaining / (currentPrice * position.shares);
        
        // If equity drops below 25% of position value, liquidate
        if (equityRatio < SHORT_MARGIN_CALL_THRESHOLD) {
          liquidations.push({
            ticker,
            shares: position.shares,
            entryPrice: position.entryPrice,
            currentPrice,
            loss,
            margin: position.margin
          });
        }
      }
      
      // Process liquidations
      if (liquidations.length > 0) {
        const userRef = doc(db, 'users', user.uid);
        const marketRef = doc(db, 'market', 'current');
        let totalLoss = 0;
        const updateData = {};
        
        for (const liq of liquidations) {
          // Force cover at current price (no slippage benefit for liquidation)
          const coverCost = liq.currentPrice * liq.shares;
          const proceeds = liq.entryPrice * liq.shares;
          const netLoss = coverCost - proceeds;
          totalLoss += Math.max(0, netLoss - liq.margin); // Loss beyond margin
          
          // Clear the short position
          updateData[`shorts.${liq.ticker}`] = { shares: 0, entryPrice: 0, margin: 0 };
          
          // Price impact from forced cover (buying pressure) using square root model
          const liquidity = getCharacterLiquidity(liq.ticker);
          const priceImpact = calculatePriceImpact(liq.currentPrice, liq.shares, liquidity);
          const newPrice = liq.currentPrice + priceImpact;
          
          await updateDoc(marketRef, {
            [`prices.${liq.ticker}`]: Math.round(newPrice * 100) / 100,
            [`volume.${liq.ticker}`]: increment(liq.shares)
          });
        }
        
        // Deduct any losses beyond margin from cash (can go negative as a penalty)
        updateData.cash = Math.max(0, userData.cash - totalLoss);
        
        await updateDoc(userRef, updateData);
        
        const tickerList = liquidations.map(l => l.ticker).join(', ');
        setNotification({ 
          type: 'error', 
          message: `⚠️ MARGIN CALL: ${tickerList} position(s) liquidated!` 
        });
        setTimeout(() => setNotification(null), 5000);
      }
    };
    
    checkMarginCalls();
  }, [user, userData, prices]);

  // Calculate sentiment based on price changes
  const getSentiment = useCallback((ticker) => {
    const currentPrice = prices[ticker];
    const basePrice = CHARACTER_MAP[ticker]?.basePrice || currentPrice || 1;
    
    // If no current price, return neutral
    if (!currentPrice) return 'Neutral';
    
    // Calculate overall change from base price (always available)
    const overallChange = ((currentPrice - basePrice) / basePrice) * 100;
    
    const history = priceHistory[ticker] || [];
    
    let weightedChange;
    
    if (history.length >= 5) {
      // We have enough history - factor in recent momentum
      const recent = history.slice(-20);
      const oldPrice = recent[0].price;
      const newPrice = recent[recent.length - 1].price;
      const recentChange = ((newPrice - oldPrice) / oldPrice) * 100;
      
      // Weighted: 60% overall position, 40% recent momentum
      weightedChange = (overallChange * 0.6) + (recentChange * 0.4);
    } else {
      // Not enough history - just use overall change from base price
      weightedChange = overallChange;
    }
    
    // Thresholds for sentiment
    if (weightedChange > 15) return 'Strong Buy';
    if (weightedChange > 5) return 'Bullish';
    if (weightedChange < -15) return 'Strong Sell';
    if (weightedChange < -5) return 'Bearish';
    return 'Neutral';
  }, [priceHistory, prices]);

  // Helper function to record price history (called after trades)
  const recordPriceHistory = useCallback(async (ticker, newPrice) => {
    const marketRef = doc(db, 'market', 'current');
    const now = Date.now();
    
    // Get current history
    const snap = await getDoc(marketRef);
    if (snap.exists()) {
      const data = snap.data();
      const currentHistory = data.priceHistory?.[ticker] || [];
      
      // Only record if price changed or last record was > 5 minutes ago
      const lastRecord = currentHistory[currentHistory.length - 1];
      const shouldRecord = !lastRecord || 
        lastRecord.price !== newPrice || 
        (now - lastRecord.timestamp) > 5 * 60 * 1000;
      
      if (shouldRecord) {
        // Keep last 1000 records per ticker to avoid huge arrays
        const updatedHistory = [...currentHistory, { timestamp: now, price: newPrice }].slice(-1000);
        
        await updateDoc(marketRef, {
          [`priceHistory.${ticker}`]: updatedHistory
        });
      }
    }
  }, []);

  // Helper function to record user portfolio history
  const recordPortfolioHistory = useCallback(async (userId, portfolioValue) => {
    const userRef = doc(db, 'users', userId);
    const now = Date.now();
    
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const data = snap.data();
      const currentHistory = data.portfolioHistory || [];
      
      // Only record if last record was > 5 minutes ago
      const lastRecord = currentHistory[currentHistory.length - 1];
      const shouldRecord = !lastRecord || (now - lastRecord.timestamp) > 5 * 60 * 1000;
      
      if (shouldRecord) {
        // Keep last 500 records per user
        const updatedHistory = [...currentHistory, { timestamp: now, value: portfolioValue }].slice(-500);
        
        await updateDoc(userRef, {
          portfolioHistory: updatedHistory
        });
      }
    }
  }, []);

  // Handle crew selection
  const handleCrewSelect = useCallback(async (crewId, isSwitch) => {
    if (!user || !userData) return;
    
    try {
      const userRef = doc(db, 'users', user.uid);
      const updateData = {
        crew: crewId,
        crewJoinedAt: Date.now()
      };
      
      // Only charge penalty if LEAVING a crew to join another (switching)
      if (isSwitch && userData.crew) {
        // Take half of cash and half of each holding
        const newCash = Math.floor(userData.cash / 2);
        const cashTaken = userData.cash - newCash;
        
        const newHoldings = {};
        let holdingsValueTaken = 0;
        
        Object.entries(userData.holdings || {}).forEach(([ticker, shares]) => {
          if (shares > 0) {
            const sharesToTake = Math.ceil(shares / 2);
            const sharesToKeep = shares - sharesToTake;
            newHoldings[ticker] = sharesToKeep;
            holdingsValueTaken += sharesToTake * (prices[ticker] || 0);
          }
        });
        
        const totalTaken = cashTaken + holdingsValueTaken;
        
        updateData.cash = newCash;
        updateData.holdings = newHoldings;
        updateData.portfolioValue = Math.max(0, userData.portfolioValue - totalTaken);
        
        const crew = CREW_MAP[crewId];
        await updateDoc(userRef, updateData);
        
        setNotification({ 
          type: 'success', 
          message: `Switched to ${crew.name}! Lost ${formatCurrency(totalTaken)} (50% penalty)`
        });
      } else {
        // Joining a crew (no existing crew) - no cost
        await updateDoc(userRef, updateData);
        
        const crew = CREW_MAP[crewId];
        setNotification({ 
          type: 'success', 
          message: `Welcome to ${crew.name}! ${crew.emblem}`
        });
      }
      
      setTimeout(() => setNotification(null), 3000);
    } catch (err) {
      console.error('Failed to select crew:', err);
      setNotification({ type: 'error', message: 'Failed to join crew' });
      setTimeout(() => setNotification(null), 3000);
    }
  }, [user, userData, prices]);

  // Handle leaving crew
  const handleCrewLeave = useCallback(async () => {
    if (!user || !userData || !userData.crew) return;
    
    try {
      const userRef = doc(db, 'users', user.uid);
      const oldCrew = CREW_MAP[userData.crew];
      
      // Calculate 50% penalty from portfolio
      // Take half of cash and half of each holding
      const newCash = Math.floor(userData.cash / 2);
      const cashTaken = userData.cash - newCash;
      
      const newHoldings = {};
      const holdingsTaken = {};
      let holdingsValueTaken = 0;
      
      Object.entries(userData.holdings || {}).forEach(([ticker, shares]) => {
        if (shares > 0) {
          const sharesToTake = Math.ceil(shares / 2); // Take half (round up)
          const sharesToKeep = shares - sharesToTake;
          newHoldings[ticker] = sharesToKeep;
          holdingsTaken[ticker] = sharesToTake;
          holdingsValueTaken += sharesToTake * (prices[ticker] || 0);
        }
      });
      
      const totalTaken = cashTaken + holdingsValueTaken;
      const newPortfolioValue = userData.portfolioValue - totalTaken;
      
      // Also update cost basis for remaining shares
      const updateData = {
        crew: null,
        crewJoinedAt: null,
        isCrewHead: false,
        crewHeadColor: null,
        cash: newCash,
        holdings: newHoldings,
        portfolioValue: Math.max(0, newPortfolioValue)
      };
      
      await updateDoc(userRef, updateData);
      
      setNotification({ 
        type: 'success', 
        message: `Left ${oldCrew?.name || 'crew'}. Lost ${formatCurrency(totalTaken)} (50% penalty)`
      });
      setTimeout(() => setNotification(null), 4000);
    } catch (err) {
      console.error('Failed to leave crew:', err);
      setNotification({ type: 'error', message: 'Failed to leave crew' });
      setTimeout(() => setNotification(null), 3000);
    }
  }, [user, userData, prices]);

  // Handle pin shop purchases and updates
  const handlePinAction = useCallback(async (action, payload, cost) => {
    if (!user || !userData) return;
    
    try {
      const userRef = doc(db, 'users', user.uid);
      
      if (action === 'buyPin') {
        // Buy a shop pin
        const currentOwned = userData.ownedShopPins || [];
        if (currentOwned.includes(payload)) return;
        
        await updateDoc(userRef, {
          ownedShopPins: arrayUnion(payload),
          cash: userData.cash - cost
        });
        
        const pin = SHOP_PINS[payload];
        setNotification({ type: 'success', message: `Purchased ${pin.emoji} ${pin.name}!` });
        setTimeout(() => setNotification(null), 3000);
        
      } else if (action === 'setShopPins') {
        // Update displayed shop pins
        await updateDoc(userRef, { displayedShopPins: payload });
        
      } else if (action === 'setAchievementPins') {
        // Update displayed achievement pins
        await updateDoc(userRef, { displayedAchievementPins: payload });
        
      } else if (action === 'toggleCrewPin') {
        // Toggle crew pin visibility (only for non-Crew Heads)
        if (!userData.isCrewHead) {
          await updateDoc(userRef, { displayCrewPin: payload });
        }
        
      } else if (action === 'buySlot') {
        // Buy extra slot
        const field = payload === 'achievement' ? 'extraAchievementSlot' : 'extraShopSlot';
        await updateDoc(userRef, {
          [field]: true,
          cash: userData.cash - cost
        });
        setNotification({ type: 'success', message: `Unlocked extra ${payload} pin slot!` });
        setTimeout(() => setNotification(null), 3000);
      }
    } catch (err) {
      console.error('Pin action failed:', err);
      setNotification({ type: 'error', message: 'Action failed' });
      setTimeout(() => setNotification(null), 3000);
    }
  }, [user, userData]);

  // Handle claiming daily mission rewards
  const handleClaimMissionReward = useCallback(async (missionId, reward) => {
    if (!user || !userData) return;
    
    try {
      const userRef = doc(db, 'users', user.uid);
      const today = getTodayDateString();
      const currentTotalMissions = userData.totalMissionsCompleted || 0;
      const newTotalMissions = currentTotalMissions + 1;
      
      await updateDoc(userRef, {
        [`dailyMissions.${today}.claimed.${missionId}`]: true,
        cash: userData.cash + reward,
        totalMissionsCompleted: newTotalMissions
      });
      
      // Check for mission achievements
      const achievements = userData.achievements || [];
      let earnedAchievement = null;
      
      if (newTotalMissions >= 10 && !achievements.includes('MISSION_10')) {
        await updateDoc(userRef, { achievements: arrayUnion('MISSION_10') });
        earnedAchievement = ACHIEVEMENTS.MISSION_10;
      } else if (newTotalMissions >= 50 && !achievements.includes('MISSION_50')) {
        await updateDoc(userRef, { achievements: arrayUnion('MISSION_50') });
        earnedAchievement = ACHIEVEMENTS.MISSION_50;
      } else if (newTotalMissions >= 100 && !achievements.includes('MISSION_100')) {
        await updateDoc(userRef, { achievements: arrayUnion('MISSION_100') });
        earnedAchievement = ACHIEVEMENTS.MISSION_100;
      }
      
      if (earnedAchievement) {
        setNotification({ type: 'achievement', message: `🏆 ${earnedAchievement.emoji} ${earnedAchievement.name} unlocked!` });
      } else {
        setNotification({ type: 'success', message: `Claimed ${formatCurrency(reward)} mission reward!` });
      }
      setTimeout(() => setNotification(null), 3000);
    } catch (err) {
      console.error('Failed to claim reward:', err);
      setNotification({ type: 'error', message: 'Failed to claim reward' });
      setTimeout(() => setNotification(null), 3000);
    }
  }, [user, userData]);

  // Handle trade
  const handleTrade = useCallback(async (ticker, action, amount) => {
    if (!user || !userData) {
      setNotification({ type: 'info', message: 'Sign in to start trading!' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    // Trade cooldown - prevent spam trading
    const now = Date.now();
    const lastTrade = userData.lastTradeTime || 0;
    const cooldownMs = 3000; // 3 second cooldown
    
    if (now - lastTrade < cooldownMs) {
      const remaining = Math.ceil((cooldownMs - (now - lastTrade)) / 1000);
      setNotification({ type: 'error', message: `Please wait ${remaining}s between trades` });
      setTimeout(() => setNotification(null), 2000);
      return;
    }

    // Limit trade size to prevent market manipulation
    const maxTradeSize = 50;
    if (amount > maxTradeSize) {
      setNotification({ type: 'error', message: `Max ${maxTradeSize} shares per trade` });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    const asset = CHARACTER_MAP[ticker];
    const price = prices[ticker] || asset?.basePrice;
    if (!price || isNaN(price)) {
      setNotification({ type: 'error', message: 'Price unavailable, try again' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }
    const basePrice = asset?.basePrice || price;
    const userRef = doc(db, 'users', user.uid);
    const marketRef = doc(db, 'market', 'current');

    if (action === 'buy') {
      // Get liquidity for this character
      const liquidity = getCharacterLiquidity(ticker);
      
      // Calculate price impact using square root model
      const priceImpact = calculatePriceImpact(price, amount, liquidity);
      const newMidPrice = price + priceImpact;
      
      // You pay the ASK price (mid + half spread) - this is realistic market friction
      const { ask } = getBidAskPrices(newMidPrice);
      const buyPrice = ask;
      const totalCost = buyPrice * amount;
      
      if (userData.cash < totalCost) {
        setNotification({ type: 'error', message: 'Insufficient funds!' });
        setTimeout(() => setNotification(null), 3000);
        return;
      }

      // Market settles at new mid price (not ask)
      const settledPrice = Math.round(newMidPrice * 100) / 100;
      
      await updateDoc(marketRef, {
        [`prices.${ticker}`]: settledPrice,
        [`volume.${ticker}`]: increment(amount) // Track trading volume
      });

      // Record price history
      await recordPriceHistory(ticker, settledPrice);

      // Calculate new cost basis (weighted average)
      const currentHoldings = userData.holdings[ticker] || 0;
      const currentCostBasis = userData.costBasis?.[ticker] || 0;
      const newHoldings = currentHoldings + amount;
      const newCostBasis = currentHoldings > 0
        ? ((currentCostBasis * currentHoldings) + (buyPrice * amount)) / newHoldings
        : buyPrice;

      // Check if this is a crew member purchase for daily missions
      const today = getTodayDateString();
      const userCrew = userData.crew;
      const crewMembers = userCrew ? CREW_MAP[userCrew]?.members || [] : [];
      const isBuyingCrewMember = crewMembers.includes(ticker);
      const currentTradesCount = userData.dailyMissions?.[today]?.tradesCount || 0;

      // Update user with trade count, cost basis, last buy time, and daily mission progress
      const updateData = {
        cash: userData.cash - totalCost,
        [`holdings.${ticker}`]: newHoldings,
        [`costBasis.${ticker}`]: Math.round(newCostBasis * 100) / 100,
        [`lastBuyTime.${ticker}`]: now,
        lastTradeTime: now,
        totalTrades: increment(1),
        [`dailyMissions.${today}.tradesCount`]: currentTradesCount + 1
      };
      
      // Mark crew member purchase if applicable
      if (isBuyingCrewMember) {
        updateData[`dailyMissions.${today}.boughtCrewMember`] = true;
      }

      await updateDoc(userRef, updateData);

      await updateDoc(marketRef, { totalTrades: increment(1) });
      
      // Record portfolio history
      const newPortfolioValue = (userData.cash - totalCost) + Object.entries(userData.holdings || {})
        .reduce((sum, [t, shares]) => sum + (prices[t] || 0) * (t === ticker ? shares + amount : shares), 0);
      await recordPortfolioHistory(user.uid, Math.round(newPortfolioValue * 100) / 100);
      
      // Check achievements (pass trade value for Shark achievement)
      const earnedAchievements = await checkAndAwardAchievements(userRef, {
        ...userData,
        cash: userData.cash - totalCost,
        holdings: { ...userData.holdings, [ticker]: (userData.holdings[ticker] || 0) + amount },
        totalTrades: (userData.totalTrades || 0) + 1
      }, prices, { tradeValue: totalCost });
      
      const impactPercent = ((newMidPrice - price) / price * 100).toFixed(2);
      
      if (earnedAchievements.length > 0) {
        const achievement = ACHIEVEMENTS[earnedAchievements[0]];
        setNotification({ type: 'achievement', message: `🏆 ${achievement.emoji} ${achievement.name} unlocked! Bought ${amount} ${ticker}` });
      } else {
        setNotification({ type: 'success', message: `Bought ${amount} ${ticker} @ ${formatCurrency(buyPrice)} (${impactPercent > 0 ? '+' : ''}${impactPercent}% impact)` });
      }
    
    } else if (action === 'sell') {
      const currentHoldings = userData.holdings[ticker] || 0;
      if (currentHoldings < amount) {
        setNotification({ type: 'error', message: 'Not enough shares!' });
        setTimeout(() => setNotification(null), 3000);
        return;
      }

      // Holding period check - must hold shares for 10 minutes before selling
      const HOLDING_PERIOD_MS = 10 * 60 * 1000; // 10 minutes
      const lastBuyTime = userData.lastBuyTime?.[ticker] || 0;
      const timeSinceBuy = now - lastBuyTime;
      
      if (lastBuyTime > 0 && timeSinceBuy < HOLDING_PERIOD_MS) {
        const remainingMs = HOLDING_PERIOD_MS - timeSinceBuy;
        const remainingMins = Math.ceil(remainingMs / 60000);
        const remainingSecs = Math.ceil((remainingMs % 60000) / 1000);
        const timeStr = remainingMins > 1 ? `${remainingMins} min` : `${remainingSecs} sec`;
        setNotification({ type: 'error', message: `Hold period: wait ${timeStr} before selling ${ticker}` });
        setTimeout(() => setNotification(null), 3000);
        return;
      }

      // Get liquidity for this character
      const liquidity = getCharacterLiquidity(ticker);
      
      // Calculate price impact using square root model (selling pushes price down)
      const priceImpact = calculatePriceImpact(price, amount, liquidity);
      const newMidPrice = Math.max(MIN_PRICE, price - priceImpact);
      
      // You get the BID price (mid - half spread) - market friction
      const { bid } = getBidAskPrices(newMidPrice);
      const sellPrice = Math.max(MIN_PRICE, bid);
      const totalRevenue = sellPrice * amount;

      // Market settles at new mid price
      const settledPrice = Math.round(newMidPrice * 100) / 100;

      await updateDoc(marketRef, {
        [`prices.${ticker}`]: settledPrice,
        [`volume.${ticker}`]: increment(amount)
      });

      // Record price history
      await recordPriceHistory(ticker, settledPrice);

      // Calculate profit percentage for Bull Run achievement
      const costBasis = userData.costBasis?.[ticker] || 0;
      const profitPercent = costBasis > 0 ? ((sellPrice - costBasis) / costBasis) * 100 : 0;
      
      // Update cost basis if selling all shares, otherwise keep it
      const newHoldings = currentHoldings - amount;
      const costBasisUpdate = newHoldings <= 0 ? 0 : userData.costBasis?.[ticker] || 0;

      // Track daily mission progress
      const today = getTodayDateString();
      const currentTradesCount = userData.dailyMissions?.[today]?.tradesCount || 0;

      // Update user with trade count and daily mission progress
      await updateDoc(userRef, {
        cash: userData.cash + totalRevenue,
        [`holdings.${ticker}`]: newHoldings,
        [`costBasis.${ticker}`]: costBasisUpdate,
        lastTradeTime: now,
        totalTrades: increment(1),
        [`dailyMissions.${today}.tradesCount`]: currentTradesCount + 1
      });

      await updateDoc(marketRef, { totalTrades: increment(1) });
      
      // Record portfolio history
      const newPortfolioValue = (userData.cash + totalRevenue) + Object.entries(userData.holdings || {})
        .reduce((sum, [t, shares]) => sum + (prices[t] || 0) * (t === ticker ? shares - amount : shares), 0);
      await recordPortfolioHistory(user.uid, Math.round(newPortfolioValue * 100) / 100);
      
      // Check achievements (pass profit percent for Bull Run)
      const earnedAchievements = await checkAndAwardAchievements(userRef, {
        ...userData,
        cash: userData.cash + totalRevenue,
        holdings: { ...userData.holdings, [ticker]: newHoldings },
        totalTrades: (userData.totalTrades || 0) + 1
      }, prices, { tradeValue: totalRevenue, sellProfitPercent: profitPercent });
      
      const impactPercent = ((newMidPrice - price) / price * 100).toFixed(2);
      
      if (earnedAchievements.length > 0) {
        const achievement = ACHIEVEMENTS[earnedAchievements[0]];
        setNotification({ type: 'achievement', message: `🏆 ${achievement.emoji} ${achievement.name} unlocked! Sold ${amount} ${ticker}` });
      } else {
        setNotification({ type: 'success', message: `Sold ${amount} ${ticker} @ ${formatCurrency(sellPrice)} (${impactPercent}% impact)` });
      }
    
    } else if (action === 'short') {
      // SHORTING: Borrow shares and sell them, hoping to buy back cheaper
      // Get liquidity for this character
      const liquidity = getCharacterLiquidity(ticker);
      
      // Calculate price impact (shorting = selling pressure)
      const priceImpact = calculatePriceImpact(price, amount, liquidity);
      const newMidPrice = Math.max(MIN_PRICE, price - priceImpact);
      
      // Entry price is the bid (you're selling borrowed shares)
      const { bid } = getBidAskPrices(newMidPrice);
      const shortPrice = Math.max(MIN_PRICE, bid);
      const marginRequired = shortPrice * amount * SHORT_MARGIN_REQUIREMENT;
      
      if (userData.cash < marginRequired) {
        setNotification({ type: 'error', message: `Need ${formatCurrency(marginRequired)} margin (50% of position)` });
        setTimeout(() => setNotification(null), 3000);
        return;
      }
      
      const existingShort = userData.shorts?.[ticker] || { shares: 0, entryPrice: 0, margin: 0 };
      
      const totalShares = existingShort.shares + amount;
      const avgEntryPrice = existingShort.shares > 0 
        ? ((existingShort.entryPrice * existingShort.shares) + (shortPrice * amount)) / totalShares
        : shortPrice;

      // You ONLY lose the margin as collateral - no proceeds yet
      const newCash = userData.cash - marginRequired;
      if (isNaN(newCash)) {
        setNotification({ type: 'error', message: 'Calculation error, try again' });
        setTimeout(() => setNotification(null), 3000);
        return;
      }
      
      const settledPrice = Math.round(newMidPrice * 100) / 100;
      
      await updateDoc(userRef, {
        cash: newCash,
        [`shorts.${ticker}`]: {
          shares: totalShares,
          entryPrice: Math.round(avgEntryPrice * 100) / 100,
          margin: existingShort.margin + marginRequired,
          openedAt: existingShort.openedAt || now
        },
        lastTradeTime: now,
        totalTrades: increment(1)
      });

      await updateDoc(marketRef, {
        [`prices.${ticker}`]: settledPrice,
        [`volume.${ticker}`]: increment(amount),
        totalTrades: increment(1)
      });

      // Record price history
      await recordPriceHistory(ticker, settledPrice);
      
      // Record portfolio history
      const newPortfolioValue = newCash + Object.entries(userData.holdings || {})
        .reduce((sum, [t, shares]) => sum + (prices[t] || 0) * shares, 0);
      await recordPortfolioHistory(user.uid, Math.round(newPortfolioValue * 100) / 100);
      
      // Check achievements
      const earnedAchievements = await checkAndAwardAchievements(userRef, {
        ...userData,
        cash: newCash,
        totalTrades: (userData.totalTrades || 0) + 1
      }, prices, { tradeValue: marginRequired });

      const impactPercent = ((newMidPrice - price) / price * 100).toFixed(2);
      
      if (earnedAchievements.length > 0) {
        const achievement = ACHIEVEMENTS[earnedAchievements[0]];
        setNotification({ type: 'achievement', message: `🏆 ${achievement.emoji} ${achievement.name} unlocked! Shorted ${amount} ${ticker}` });
      } else {
        setNotification({ type: 'success', message: `Shorted ${amount} ${ticker} @ ${formatCurrency(shortPrice)} (${impactPercent}% impact)` });
      }
    
    } else if (action === 'cover') {
      // COVER: Buy back shares to close short position
      const existingShort = userData.shorts?.[ticker];
      
      if (!existingShort || existingShort.shares < amount) {
        setNotification({ type: 'error', message: 'No short position to cover!' });
        setTimeout(() => setNotification(null), 3000);
        return;
      }

      // Holding period check - must hold short for 10 minutes before covering
      const HOLDING_PERIOD_MS = 10 * 60 * 1000; // 10 minutes
      const openedAt = existingShort.openedAt || 0;
      const timeSinceOpen = now - openedAt;
      
      if (openedAt > 0 && timeSinceOpen < HOLDING_PERIOD_MS) {
        const remainingMs = HOLDING_PERIOD_MS - timeSinceOpen;
        const remainingMins = Math.ceil(remainingMs / 60000);
        const remainingSecs = Math.ceil((remainingMs % 60000) / 1000);
        const timeStr = remainingMins > 1 ? `${remainingMins} min` : `${remainingSecs} sec`;
        setNotification({ type: 'error', message: `Hold period: wait ${timeStr} before covering ${ticker}` });
        setTimeout(() => setNotification(null), 3000);
        return;
      }

      // Get liquidity for this character
      const liquidity = getCharacterLiquidity(ticker);
      
      // Calculate price INCREASE (covering = buying pressure)
      const priceImpact = calculatePriceImpact(price, amount, liquidity);
      const newMidPrice = price + priceImpact;
      
      // You pay the ASK price to cover (buying back shares)
      const { ask } = getBidAskPrices(newMidPrice);
      const coverPrice = ask;
      
      // Profit/loss = entry price - cover price (per share)
      const profitPerShare = existingShort.entryPrice - coverPrice;
      const profit = profitPerShare * amount;
      
      // Get back margin + profit (or margin - loss)
      const marginReturned = (existingShort.margin / existingShort.shares) * amount;
      const cashBack = marginReturned + profit;
      
      if (userData.cash + cashBack < 0) {
        setNotification({ type: 'error', message: 'Insufficient funds to cover losses!' });
        setTimeout(() => setNotification(null), 3000);
        return;
      }

      const remainingShares = existingShort.shares - amount;
      const remainingMargin = existingShort.margin - marginReturned;
      const settledPrice = Math.round(newMidPrice * 100) / 100;

      // Update user: simply add cashBack (margin + profit or margin - loss)
      const updateData = {
        cash: userData.cash + cashBack,
        lastTradeTime: now
      };

      if (remainingShares <= 0) {
        updateData[`shorts.${ticker}`] = { shares: 0, entryPrice: 0, margin: 0 };
      } else {
        updateData[`shorts.${ticker}`] = {
          shares: remainingShares,
          entryPrice: existingShort.entryPrice,
          margin: remainingMargin,
          openedAt: existingShort.openedAt
        };
      }
      
      // Add trade count
      updateData.totalTrades = increment(1);

      await updateDoc(userRef, updateData);

      await updateDoc(marketRef, {
        [`prices.${ticker}`]: settledPrice,
        [`volume.${ticker}`]: increment(amount),
        totalTrades: increment(1)
      });

      // Record price history
      await recordPriceHistory(ticker, settledPrice);
      
      // Record portfolio history
      const newPortfolioValue = (userData.cash + cashBack) + Object.entries(userData.holdings || {})
        .reduce((sum, [t, shares]) => sum + (prices[t] || 0) * shares, 0);
      await recordPortfolioHistory(user.uid, Math.round(newPortfolioValue * 100) / 100);
      
      // Check achievements (pass short profit for Cold Blooded achievement)
      const earnedAchievements = await checkAndAwardAchievements(userRef, {
        ...userData,
        cash: userData.cash + cashBack,
        totalTrades: (userData.totalTrades || 0) + 1
      }, prices, { shortProfit: profit });

      const impactPercent = ((newMidPrice - price) / price * 100).toFixed(2);
      const profitMsg = profit >= 0 ? `+${formatCurrency(profit)}` : formatCurrency(profit);
      
      if (earnedAchievements.length > 0 && earnedAchievements.includes('COLD_BLOODED')) {
        const achievement = ACHIEVEMENTS['COLD_BLOODED'];
        setNotification({ type: 'achievement', message: `🏆 ${achievement.emoji} ${achievement.name} unlocked! ${profitMsg} profit from short!` });
      } else if (earnedAchievements.length > 0) {
        const achievement = ACHIEVEMENTS[earnedAchievements[0]];
        setNotification({ type: 'achievement', message: `🏆 ${achievement.emoji} ${achievement.name} unlocked!` });
      } else {
        setNotification({ type: profit >= 0 ? 'success' : 'error', message: `Covered ${amount} ${ticker} @ ${formatCurrency(coverPrice)} (${profitMsg}, +${impactPercent}% impact)` });
      }
    }

    setTimeout(() => setNotification(null), 3000);
  }, [user, userData, prices, recordPriceHistory, recordPortfolioHistory]);

  // Update portfolio value and record history periodically
  useEffect(() => {
    if (!user || !userData || Object.keys(prices).length === 0) return;

    const portfolioValue = userData.cash + Object.entries(userData.holdings || {})
      .reduce((sum, [ticker, shares]) => sum + (prices[ticker] || 0) * shares, 0);

    const roundedValue = Math.round(portfolioValue * 100) / 100;
    const userRef = doc(db, 'users', user.uid);
    
    // Update current portfolio value
    updateDoc(userRef, { portfolioValue: roundedValue });
    
    // Also record to history periodically (every 10 minutes max)
    const currentHistory = userData.portfolioHistory || [];
    const lastRecord = currentHistory[currentHistory.length - 1];
    const now = Date.now();
    const tenMinutes = 10 * 60 * 1000;
    
    // Record if: no history yet, OR last record was 10+ minutes ago, OR value changed significantly (>1%)
    const valueChanged = lastRecord && Math.abs(roundedValue - lastRecord.value) / lastRecord.value > 0.01;
    const timeElapsed = !lastRecord || (now - lastRecord.timestamp) > tenMinutes;
    
    if (!lastRecord || timeElapsed || valueChanged) {
      const updatedHistory = [...currentHistory, { timestamp: now, value: roundedValue }].slice(-500);
      updateDoc(userRef, { portfolioHistory: updatedHistory });
    }
  }, [user, userData, prices]);

  // Check leaderboard position for achievements (runs every 30 seconds)
  useEffect(() => {
    if (!user || !userData) return;
    
    const checkLeaderboardAchievements = async () => {
      try {
        const currentAchievements = userData.achievements || [];
        
        // Skip if already has all leaderboard achievements
        if (currentAchievements.includes('TOP_1')) return;
        
        // Fetch top 10 to check position
        const q = query(
          collection(db, 'users'),
          orderBy('portfolioValue', 'desc'),
          limit(10)
        );
        const snapshot = await getDocs(q);
        const topUsers = snapshot.docs.map(doc => doc.id);
        
        const userPosition = topUsers.indexOf(user.uid);
        
        if (userPosition === -1) return; // Not in top 10
        
        const newAchievements = [];
        const rank = userPosition + 1;
        
        // Check for leaderboard achievements
        if (rank <= 10 && !currentAchievements.includes('TOP_10')) {
          newAchievements.push('TOP_10');
        }
        if (rank <= 3 && !currentAchievements.includes('TOP_3')) {
          newAchievements.push('TOP_3');
        }
        if (rank === 1 && !currentAchievements.includes('TOP_1')) {
          newAchievements.push('TOP_1');
        }
        
        if (newAchievements.length > 0) {
          const userRef = doc(db, 'users', user.uid);
          await updateDoc(userRef, {
            achievements: arrayUnion(...newAchievements)
          });
          
          // Show notification for highest achievement earned
          const highestAchievement = newAchievements.includes('TOP_1') ? 'TOP_1' 
            : newAchievements.includes('TOP_3') ? 'TOP_3' : 'TOP_10';
          const achievement = ACHIEVEMENTS[highestAchievement];
          setNotification({ 
            type: 'achievement', 
            message: `🏆 ${achievement.emoji} ${achievement.name} unlocked! You're #${rank} on the leaderboard!` 
          });
          setTimeout(() => setNotification(null), 5000);
        }
      } catch (err) {
        console.error('Failed to check leaderboard achievements:', err);
      }
    };
    
    // Check immediately and then every 30 seconds
    checkLeaderboardAchievements();
    const interval = setInterval(checkLeaderboardAchievements, 30000);
    
    return () => clearInterval(interval);
  }, [user, userData?.achievements]);

  // Daily checkin
  const handleDailyCheckin = useCallback(async () => {
    if (!user || !userData) {
      setNotification({ type: 'info', message: 'Sign in to claim your daily bonus!' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    const today = new Date().toDateString();
    if (userData.lastCheckin === today) {
      setNotification({ type: 'error', message: 'Already checked in today!' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    const userRef = doc(db, 'users', user.uid);
    const newTotalCheckins = (userData.totalCheckins || 0) + 1;
    
    // Check for check-in achievements
    const newAchievements = [];
    const currentAchievements = userData.achievements || [];
    
    if (newTotalCheckins >= 7 && !currentAchievements.includes('DEDICATED_7')) {
      newAchievements.push('DEDICATED_7');
    }
    if (newTotalCheckins >= 14 && !currentAchievements.includes('DEDICATED_14')) {
      newAchievements.push('DEDICATED_14');
    }
    if (newTotalCheckins >= 30 && !currentAchievements.includes('DEDICATED_30')) {
      newAchievements.push('DEDICATED_30');
    }
    if (newTotalCheckins >= 100 && !currentAchievements.includes('DEDICATED_100')) {
      newAchievements.push('DEDICATED_100');
    }
    
    const updateData = {
      cash: userData.cash + DAILY_BONUS,
      lastCheckin: today,
      totalCheckins: newTotalCheckins
    };
    
    if (newAchievements.length > 0) {
      updateData.achievements = arrayUnion(...newAchievements);
    }
    
    await updateDoc(userRef, updateData);

    // Show achievement notification if earned
    if (newAchievements.length > 0) {
      const achievement = ACHIEVEMENTS[newAchievements[0]];
      setNotification({ 
        type: 'achievement', 
        message: `🏆 Achievement Unlocked: ${achievement.emoji} ${achievement.name}!` 
      });
    } else {
      setNotification({ type: 'success', message: `Daily check-in: +${formatCurrency(DAILY_BONUS)}!` });
    }
    setTimeout(() => setNotification(null), 3000);
  }, [user, userData]);

  // Handle prediction bet
  const handleBet = useCallback(async (predictionId, option, amount) => {
    if (!user || !userData) {
      setNotification({ type: 'info', message: 'Sign in to place bets!' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    if (userData.cash < amount) {
      setNotification({ type: 'error', message: 'Insufficient funds!' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    const prediction = predictions.find(p => p.id === predictionId);
    if (!prediction || prediction.resolved || prediction.endsAt < Date.now()) {
      setNotification({ type: 'error', message: 'Betting has ended!' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    // Check if user already bet on a different option
    const existingBet = userData.bets?.[predictionId];
    if (existingBet && existingBet.option !== option) {
      setNotification({ type: 'error', message: `You already bet on "${existingBet.option}"!` });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    const predictionsRef = doc(db, 'predictions', 'current');
    const userRef = doc(db, 'users', user.uid);

    // Update prediction pools
    const updatedPredictions = predictions.map(p => {
      if (p.id === predictionId) {
        const newPools = { ...(p.pools || {}) };
        newPools[option] = (newPools[option] || 0) + amount;
        return { ...p, pools: newPools };
      }
      return p;
    });

    const newBetAmount = (existingBet?.amount || 0) + amount;

    await updateDoc(predictionsRef, { list: updatedPredictions });
    await updateDoc(userRef, {
      cash: userData.cash - amount,
      [`bets.${predictionId}`]: {
        option,
        amount: newBetAmount,
        placedAt: Date.now()
      }
    });

    setNotification({ type: 'success', message: `Bet ${formatCurrency(amount)} on "${option}"!` });
    setTimeout(() => setNotification(null), 3000);
  }, [user, userData, predictions]);

  // Logout
  const handleLogout = () => signOut(auth);

  // Borrow money
  const handleBorrow = useCallback(async (amount) => {
    if (!user || !userData) return;
    
    const lendingStatus = checkLendingEligibility(userData);
    if (!lendingStatus.eligible || amount > lendingStatus.creditLimit) {
      setNotification({ type: 'error', message: 'Not eligible to borrow this amount!' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }
    
    if (userData.activeLoan) {
      setNotification({ type: 'error', message: 'You already have an active loan!' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }
    
    const userRef = doc(db, 'users', user.uid);
    await updateDoc(userRef, {
      cash: userData.cash + amount,
      activeLoan: {
        principal: amount,
        borrowedAt: Date.now()
      },
      lendingUnlocked: true
    });
    
    setNotification({ type: 'success', message: `Borrowed ${formatCurrency(amount)}! Remember to repay within 7 days.` });
    setTimeout(() => setNotification(null), 5000);
    setShowLending(false);
  }, [user, userData]);

  // Repay loan
  const handleRepay = useCallback(async (amount) => {
    if (!user || !userData || !userData.activeLoan) return;
    
    const now = Date.now();
    const daysPassed = (now - userData.activeLoan.borrowedAt) / (1000 * 60 * 60 * 24);
    const interest = userData.activeLoan.principal * 0.05 * daysPassed; // 5% per day
    const totalOwed = userData.activeLoan.principal + interest;
    
    if (amount > userData.cash) {
      setNotification({ type: 'error', message: 'Insufficient funds!' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }
    
    const userRef = doc(db, 'users', user.uid);
    
    if (amount >= totalOwed) {
      // Full repayment
      await updateDoc(userRef, {
        cash: userData.cash - totalOwed,
        activeLoan: null
      });
      setNotification({ type: 'success', message: `Loan repaid in full! Paid ${formatCurrency(totalOwed)}` });
      setShowLending(false);
    } else {
      // Partial repayment - reduce principal
      const remainingOwed = totalOwed - amount;
      await updateDoc(userRef, {
        cash: userData.cash - amount,
        activeLoan: {
          principal: remainingOwed,
          borrowedAt: Date.now() // Reset timer for remaining amount
        }
      });
      setNotification({ type: 'success', message: `Paid ${formatCurrency(amount)}. Remaining: ${formatCurrency(remainingOwed)}` });
    }
    setTimeout(() => setNotification(null), 5000);
  }, [user, userData]);

  // Guest data
  const guestData = { cash: STARTING_CASH, holdings: {}, shorts: {}, bets: {}, portfolioValue: STARTING_CASH };
  const activeUserData = userData || guestData;
  const isGuest = !user;

  // Get user's bet for a prediction
  const getUserBet = (predictionId) => activeUserData.bets?.[predictionId] || null;

  // Portfolio calculations
  const portfolioValue = activeUserData.cash + Object.entries(activeUserData.holdings || {})
    .reduce((sum, [ticker, shares]) => sum + (prices[ticker] || 0) * shares, 0);

  // Helper to calculate 24h price change
  const get24hChange = useCallback((ticker) => {
    const currentPrice = prices[ticker] || CHARACTER_MAP[ticker]?.basePrice || 0;
    const history = priceHistory[ticker] || [];
    const dayAgo = Date.now() - (24 * 60 * 60 * 1000);
    
    if (history.length === 0) return 0;
    
    // Find price from ~24 hours ago, or use oldest available
    let price24hAgo = history[0].price; // Default to oldest point
    
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].timestamp <= dayAgo) {
        price24hAgo = history[i].price;
        break;
      }
    }
    
    return price24hAgo > 0 ? ((currentPrice - price24hAgo) / price24hAgo) * 100 : 0;
  }, [prices, priceHistory]);

  // Filter and sort
  const filteredCharacters = useMemo(() => {
    let filtered = CHARACTERS.filter(c =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.ticker.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Calculate 24h price changes from actual history
    const priceChanges = {};
    CHARACTERS.forEach(c => {
      priceChanges[c.ticker] = get24hChange(c.ticker);
    });

    switch (sortBy) {
      case 'price-high': filtered.sort((a, b) => (prices[b.ticker] || b.basePrice) - (prices[a.ticker] || a.basePrice)); break;
      case 'price-low': filtered.sort((a, b) => (prices[a.ticker] || a.basePrice) - (prices[b.ticker] || b.basePrice)); break;
      case 'active': filtered.sort((a, b) => Math.abs(priceChanges[b.ticker]) - Math.abs(priceChanges[a.ticker])); break;
      case 'ticker': filtered.sort((a, b) => a.ticker.localeCompare(b.ticker)); break;
      case 'newest': filtered.sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded)); break;
      case 'oldest': filtered.sort((a, b) => new Date(a.dateAdded) - new Date(b.dateAdded)); break;
    }
    return filtered;
  }, [searchQuery, sortBy, prices, priceHistory, get24hChange]);

  const totalPages = Math.ceil(filteredCharacters.length / ITEMS_PER_PAGE);
  const displayedCharacters = showAll ? filteredCharacters : filteredCharacters.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  // Styling
  const bgClass = darkMode ? 'bg-slate-900' : 'bg-slate-100';
  const cardClass = darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-300';
  const textClass = darkMode ? 'text-slate-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-slate-400' : 'text-slate-500';
  const inputClassStyle = darkMode ? 'bg-slate-900 border-slate-600 text-slate-100' : 'bg-white border-slate-300 text-slate-900';

  if (loading) {
    return (
      <div className={`min-h-screen ${bgClass} flex items-center justify-center`}>
        <div className={`text-lg ${mutedClass}`}>Loading Stockism...</div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${bgClass} p-4`}>
      <div className="max-w-6xl mx-auto">
        {/* Logo */}
        <div className="flex justify-center mb-4">
          <img 
            src="/stockism logo.png" 
            alt="Stockism" 
            className="h-[100px] sm:h-[115px] md:h-[200px] w-auto"
          />
        </div>

        {/* Nav Bar */}
        <div className={`${cardClass} border rounded-sm p-3 mb-4`}>
          <div className="flex flex-wrap justify-center sm:justify-end items-center gap-2">
            <button onClick={() => setShowLeaderboard(true)}
              className={`px-3 py-1 text-xs rounded-sm border ${darkMode ? 'border-slate-600 text-slate-300 hover:bg-slate-700' : 'border-slate-300 hover:bg-slate-100'}`}>
              🏆 Leaderboard
            </button>
            {!isGuest && (
              <button onClick={() => setShowCrewSelection(true)}
                className={`px-3 py-1 text-xs rounded-sm border flex items-center gap-1 ${darkMode ? 'border-slate-600 text-slate-300 hover:bg-slate-700' : 'border-slate-300 hover:bg-slate-100'}`}
                style={userData?.crew ? { borderColor: CREW_MAP[userData.crew]?.color, color: CREW_MAP[userData.crew]?.color } : {}}>
                {userData?.crew ? (
                  <>
                    {CREW_MAP[userData.crew]?.icon ? (
                      <img src={CREW_MAP[userData.crew]?.icon} alt="" className="w-4 h-4 object-contain" />
                    ) : (
                      CREW_MAP[userData.crew]?.emblem
                    )}
                    {CREW_MAP[userData.crew]?.name}
                  </>
                ) : '🏴 Join Crew'}
              </button>
            )}
            {!isGuest && (
              <button onClick={() => setShowDailyMissions(true)}
                className={`px-3 py-1 text-xs rounded-sm border ${darkMode ? 'border-slate-600 text-slate-300 hover:bg-slate-700' : 'border-slate-300 hover:bg-slate-100'}`}>
                📋 Missions
              </button>
            )}
            {!isGuest && (
              <button onClick={() => setShowPinShop(true)}
                className={`px-3 py-1 text-xs rounded-sm border ${darkMode ? 'border-slate-600 text-slate-300 hover:bg-slate-700' : 'border-slate-300 hover:bg-slate-100'}`}>
                🏪 Pin Shop
              </button>
            )}
            {!isGuest && (
              <button onClick={() => setShowAchievements(true)}
                className={`px-3 py-1 text-xs rounded-sm border ${darkMode ? 'border-slate-600 text-slate-300 hover:bg-slate-700' : 'border-slate-300 hover:bg-slate-100'}`}>
                🎯 Achievements
              </button>
            )}
            {!isGuest && (
              <button onClick={() => setShowLending(true)}
                className={`px-3 py-1 text-xs rounded-sm border ${
                  userData?.activeLoan 
                    ? 'border-amber-500 text-amber-500 hover:bg-amber-900/20' 
                    : darkMode ? 'border-slate-600 text-slate-300 hover:bg-slate-700' : 'border-slate-300 hover:bg-slate-100'
                }`}>
                🏦 {userData?.activeLoan ? 'Loan Active' : 'Lending'}
              </button>
            )}
            {user && ADMIN_UIDS.includes(user.uid) && (
              <button onClick={() => setShowAdmin(true)}
                className={`px-3 py-1 text-xs rounded-sm border ${darkMode ? 'border-slate-600 text-slate-300 hover:bg-slate-700' : 'border-slate-300 hover:bg-slate-100'}`}>
                🔧 Admin
              </button>
            )}
            <button onClick={() => setShowAbout(true)}
              className={`px-3 py-1 text-xs rounded-sm border ${darkMode ? 'border-slate-600 text-slate-300 hover:bg-slate-700' : 'border-slate-300 hover:bg-slate-100'}`}>
              ℹ️ About
            </button>
            <button onClick={() => setDarkMode(!darkMode)}
              className={`px-3 py-1 text-xs rounded-sm border ${darkMode ? 'border-slate-600 text-slate-300 hover:bg-slate-700' : 'border-slate-300 hover:bg-slate-100'}`}>
              {darkMode ? '☀️' : '🌙'}
            </button>
            {isGuest ? (
              <button onClick={() => setShowLoginModal(true)}
                className="px-3 py-1 text-xs rounded-sm bg-teal-600 hover:bg-teal-700 text-white font-semibold uppercase">
                Sign In
              </button>
            ) : (
              <>
                <span className={`text-sm ${mutedClass} flex items-center`}>
                  <span style={userData?.isCrewHead && userData?.crew ? { color: userData.crewHeadColor || CREW_MAP[userData.crew]?.color } : {}}>
                    {userData?.displayName}
                  </span>
                  <PinDisplay userData={userData} size="sm" />
                </span>
                <button onClick={handleLogout}
                  className="px-3 py-1 text-xs rounded-sm bg-red-600 hover:bg-red-700 text-white font-semibold uppercase">
                  Logout
                </button>
              </>
            )}
          </div>
        </div>

        {/* Notifications */}
        {notification && (
          <div className={`mb-4 p-3 rounded-sm text-sm font-semibold ${
            notification.type === 'error' ? 'bg-red-100 border border-red-300 text-red-700' :
            notification.type === 'info' ? 'bg-blue-100 border border-blue-300 text-blue-700' :
            notification.type === 'achievement' ? 'bg-yellow-100 border border-yellow-400 text-yellow-800 animate-pulse' :
            'bg-green-100 border border-green-300 text-green-700'
          }`}>{notification.message}</div>
        )}

        {/* Guest Banner */}
        {isGuest && (
          <div className={`mb-4 p-3 rounded-sm text-sm ${darkMode ? 'bg-slate-800 border border-slate-700 text-slate-300' : 'bg-amber-50 border border-amber-200 text-amber-800'}`}>
            👋 Browsing as guest. <button onClick={() => setShowLoginModal(true)} className="font-semibold text-teal-600 hover:underline">Sign in</button> to trade and save progress!
          </div>
        )}

        {/* Weekly Predictions & New Characters */}
        <div className="mb-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Predictions - takes 2 columns */}
          {predictions.length > 0 && (
            <div className="lg:col-span-2">
              <h2 className={`text-sm font-semibold uppercase tracking-wide mb-3 ${mutedClass}`}>🔮 Weekly Predictions</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {predictions.filter(p => !p.resolved || Date.now() - p.endsAt < 7 * 24 * 60 * 60 * 1000).map(prediction => (
                  <PredictionCard
                    key={prediction.id}
                    prediction={prediction}
                    userBet={getUserBet(prediction.id)}
                    onBet={handleBet}
                    darkMode={darkMode}
                    isGuest={isGuest}
                  />
                ))}
              </div>
            </div>
          )}
          
          {/* New Characters Board - takes 1 column */}
          <div className={predictions.length === 0 ? 'lg:col-span-3' : ''}>
            <NewCharactersBoard 
              prices={prices} 
              priceHistory={priceHistory}
              darkMode={darkMode} 
            />
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div className={`${cardClass} border rounded-sm p-4`}>
            <p className={`text-xs font-semibold uppercase ${mutedClass}`}>Cash</p>
            <p className={`text-2xl font-bold ${textClass}`}>{formatCurrency(activeUserData.cash)}</p>
            <CheckInButton 
              isGuest={isGuest}
              lastCheckin={userData?.lastCheckin}
              onCheckin={handleDailyCheckin}
              darkMode={darkMode}
            />
          </div>
          <div className={`${cardClass} border rounded-sm p-4`}>
            <p className={`text-xs font-semibold uppercase ${mutedClass}`}>Portfolio Value</p>
            <p className={`text-2xl font-bold ${textClass}`}>{formatCurrency(portfolioValue)}</p>
            <p className={`text-xs ${portfolioValue >= STARTING_CASH ? 'text-green-500' : 'text-red-500'}`}>
              {portfolioValue >= STARTING_CASH ? '▲' : '▼'} {formatChange(((portfolioValue - STARTING_CASH) / STARTING_CASH) * 100)} from start
            </p>
          </div>
          <div className={`${cardClass} border rounded-sm p-4 cursor-pointer hover:border-teal-600`} onClick={() => !isGuest && setShowPortfolio(true)}>
            <p className={`text-xs font-semibold uppercase ${mutedClass}`}>Holdings</p>
            <p className={`text-2xl font-bold ${textClass}`}>
              {Object.values(activeUserData.holdings || {}).reduce((a, b) => a + b, 0)} shares
            </p>
            <p className={`text-xs ${mutedClass}`}>
              {Object.keys(activeUserData.holdings || {}).filter(k => activeUserData.holdings[k] > 0).length} characters
              {!isGuest && <span className="text-teal-600 ml-2">→ View details</span>}
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className={`${cardClass} border rounded-sm p-4 mb-4`}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <select value={sortBy} onChange={(e) => { setSortBy(e.target.value); setCurrentPage(1); }}
              className={`px-3 py-2 text-sm rounded-sm border ${inputClassStyle}`}>
              <option value="price-high">Price: High</option>
              <option value="price-low">Price: Low</option>
              <option value="active">Most Active</option>
              <option value="ticker">Ticker A-Z</option>
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
            </select>
            <input type="text" placeholder="Search..." value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              className={`px-3 py-2 text-sm rounded-sm border ${inputClassStyle}`} />
            <div className="flex items-center justify-center gap-2">
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={showAll || currentPage === 1}
                className={`px-3 py-2 text-sm rounded-sm border ${darkMode ? 'border-slate-600 text-slate-300 hover:bg-slate-700' : 'border-slate-300 hover:bg-slate-100'} disabled:opacity-50`}>
                Prev
              </button>
              <span className={`text-sm ${mutedClass}`}>{currentPage}/{totalPages}</span>
              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={showAll || currentPage === totalPages}
                className={`px-3 py-2 text-sm rounded-sm border ${darkMode ? 'border-slate-600 text-slate-300 hover:bg-slate-700' : 'border-slate-300 hover:bg-slate-100'} disabled:opacity-50`}>
                Next
              </button>
            </div>
            <button onClick={() => setShowAll(!showAll)}
              className={`px-3 py-2 text-sm font-semibold rounded-sm ${showAll ? 'bg-amber-500 text-white' : `border ${darkMode ? 'border-slate-600 text-slate-300 hover:bg-slate-700' : 'border-slate-300 hover:bg-slate-100'}`}`}>
              {showAll ? 'Show Pages' : 'Show All'}
            </button>
          </div>
        </div>

        {/* Character Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayedCharacters.map(character => (
            <CharacterCard
              key={character.ticker}
              character={character}
              price={prices[character.ticker] || character.basePrice}
              priceChange={get24hChange(character.ticker)}
              sentiment={getSentiment(character.ticker)}
              holdings={activeUserData.holdings?.[character.ticker] || 0}
              shortPosition={activeUserData.shorts?.[character.ticker]}
              onTrade={handleTrade}
              onViewChart={setSelectedCharacter}
              priceHistory={priceHistory}
              darkMode={darkMode}
            />
          ))}
        </div>

        {/* Bottom Pagination */}
        {!showAll && totalPages > 1 && (
          <div className={`${cardClass} border rounded-sm p-4 mt-4`}>
            <div className="flex justify-center items-center gap-4">
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                className={`px-4 py-2 text-sm font-semibold rounded-sm border ${darkMode ? 'border-slate-600 text-slate-300 hover:bg-slate-700' : 'border-slate-300 hover:bg-slate-100'} disabled:opacity-50`}>
                Previous
              </button>
              <span className={`text-sm ${mutedClass}`}>Page {currentPage} of {totalPages}</span>
              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
                className={`px-4 py-2 text-sm font-semibold rounded-sm border ${darkMode ? 'border-slate-600 text-slate-300 hover:bg-slate-700' : 'border-slate-300 hover:bg-slate-100'} disabled:opacity-50`}>
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {showLoginModal && <LoginModal onClose={() => setShowLoginModal(false)} darkMode={darkMode} />}
      {needsUsername && user && (
        <UsernameModal 
          user={user} 
          onComplete={async () => {
            setNeedsUsername(false);
            // Refresh user data
            const userDocRef = doc(db, 'users', user.uid);
            const userSnap = await getDoc(userDocRef);
            if (userSnap.exists()) {
              setUserData(userSnap.data());
              // Subscribe to changes
              onSnapshot(userDocRef, (snap) => {
                if (snap.exists()) setUserData(snap.data());
              });
            }
          }} 
          darkMode={darkMode} 
        />
      )}
      {showLeaderboard && <LeaderboardModal onClose={() => setShowLeaderboard(false)} darkMode={darkMode} currentUserCrew={userData?.crew} />}
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} darkMode={darkMode} />}
      {showAchievements && !isGuest && (
        <AchievementsModal 
          onClose={() => setShowAchievements(false)} 
          darkMode={darkMode} 
          userData={userData}
        />
      )}
      {showLending && !isGuest && (
        <LendingModal 
          onClose={() => setShowLending(false)} 
          darkMode={darkMode} 
          userData={userData}
          onBorrow={handleBorrow}
          onRepay={handleRepay}
        />
      )}
      {showCrewSelection && !isGuest && (
        <CrewSelectionModal
          onClose={() => setShowCrewSelection(false)}
          onSelect={handleCrewSelect}
          onLeave={handleCrewLeave}
          darkMode={darkMode}
          userData={userData}
        />
      )}
      {showPinShop && !isGuest && (
        <PinShopModal
          onClose={() => setShowPinShop(false)}
          darkMode={darkMode}
          userData={userData}
          onPurchase={handlePinAction}
        />
      )}
      {showDailyMissions && !isGuest && (
        <DailyMissionsModal
          onClose={() => setShowDailyMissions(false)}
          darkMode={darkMode}
          userData={userData}
          prices={prices}
          onClaimReward={handleClaimMissionReward}
        />
      )}
      {showAdmin && (
        <AdminPanel
          user={user}
          predictions={predictions}
          prices={prices}
          darkMode={darkMode}
          onClose={() => setShowAdmin(false)}
        />
      )}
      {showPortfolio && !isGuest && (
        <PortfolioModal
          holdings={activeUserData.holdings || {}}
          prices={prices}
          portfolioHistory={userData?.portfolioHistory || []}
          currentValue={portfolioValue}
          onClose={() => setShowPortfolio(false)}
          onTrade={handleTrade}
          darkMode={darkMode}
        />
      )}
      {selectedCharacter && (
        <ChartModal
          character={selectedCharacter}
          currentPrice={prices[selectedCharacter.ticker] || selectedCharacter.basePrice}
          priceHistory={priceHistory}
          onClose={() => setSelectedCharacter(null)}
          darkMode={darkMode}
        />
      )}
    </div>
  );
}
