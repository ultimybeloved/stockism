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
  arrayUnion,
  deleteField
} from 'firebase/firestore';
import { auth, googleProvider, twitterProvider, db } from './firebase';
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

// IPO System Constants
const IPO_HYPE_DURATION = 24 * 60 * 60 * 1000; // 24 hours hype phase
const IPO_WINDOW_DURATION = 24 * 60 * 60 * 1000; // 24 hours IPO window
const IPO_TOTAL_SHARES = 150; // Total shares available in IPO
const IPO_MAX_PER_USER = 10; // Max shares per user during IPO
const IPO_PRICE_JUMP = 0.30; // 30% price jump after IPO ends

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
// MARGIN TRADING SYSTEM
// ============================================

const MARGIN_BORROWING_POWER_RATIO = 0.5; // Can borrow up to 50% of portfolio value
const MARGIN_INTEREST_RATE = 0.005; // 0.5% daily interest on margin used
const MARGIN_WARNING_THRESHOLD = 0.35; // Warning at 35% equity ratio
const MARGIN_CALL_THRESHOLD = 0.30; // Margin call at 30% equity ratio
const MARGIN_LIQUIDATION_THRESHOLD = 0.25; // Auto-liquidate at 25% equity ratio
const MARGIN_CALL_GRACE_PERIOD = 24 * 60 * 60 * 1000; // 24 hours to resolve margin call
const MARGIN_MAINTENANCE_RATIO = 0.30; // 30% maintenance requirement for all positions

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
    description: 'Sell a stock for 25%+ profit',
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

// Transaction logging - records all significant financial actions for auditing
const logTransaction = async (db, userId, type, details) => {
  try {
    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);
    const userData = userSnap.data() || {};
    
    const transaction = {
      type, // 'BUY', 'SELL', 'SHORT_OPEN', 'SHORT_CLOSE', 'CHECKIN', 'BET', 'BET_WIN', 'BET_LOSS', 'MARGIN_INTEREST', 'LIQUIDATION', etc.
      timestamp: Date.now(),
      ...details,
      // Snapshot of user state at time of transaction
      cashBefore: details.cashBefore ?? userData.cash,
      cashAfter: details.cashAfter,
      portfolioBefore: details.portfolioBefore ?? userData.portfolioValue,
      portfolioAfter: details.portfolioAfter
    };
    
    // Keep last 100 transactions per user
    const transactionLog = userData.transactionLog || [];
    const updatedLog = [...transactionLog, transaction].slice(-100);
    
    await updateDoc(userRef, { transactionLog: updatedLog });
  } catch (err) {
    console.error('Failed to log transaction:', err);
    // Don't throw - logging failure shouldn't break the actual transaction
  }
};

// Check if user qualifies for margin trading (requires commitment + skill)
const checkMarginEligibility = (userData, isAdmin = false) => {
  if (!userData) return { eligible: false, requirements: [] };
  
  // Admin bypass - always eligible
  if (isAdmin) {
    return {
      eligible: true,
      requirements: [
        { met: true, label: '10+ daily check-ins', current: '∞', required: 10 },
        { met: true, label: '35+ total trades', current: '∞', required: 35 },
        { met: true, label: '$7,500+ peak portfolio', current: '∞', required: 7500 }
      ]
    };
  }
  
  const totalCheckins = userData.totalCheckins || 0;
  const totalTrades = userData.totalTrades || 0;
  const peakPortfolioValue = userData.peakPortfolioValue || 0;
  
  const requirements = [
    { met: totalCheckins >= 10, label: '10+ daily check-ins', current: totalCheckins, required: 10 },
    { met: totalTrades >= 35, label: '35+ total trades', current: totalTrades, required: 35 },
    { met: peakPortfolioValue >= 7500, label: '$7,500+ peak portfolio', current: peakPortfolioValue, required: 7500 }
  ];
  
  const allMet = requirements.every(r => r.met);
  
  return {
    eligible: allMet,
    requirements
  };
};

// Calculate margin status for a user
const calculateMarginStatus = (userData, prices) => {
  if (!userData || !userData.marginEnabled) {
    return { 
      enabled: false, 
      marginUsed: 0, 
      availableMargin: 0,
      portfolioValue: 0,
      totalMaintenanceRequired: 0,
      equityRatio: 1,
      status: 'disabled'
    };
  }
  
  const cash = userData.cash || 0;
  const holdings = userData.holdings || {};
  const marginUsed = userData.marginUsed || 0;
  
  // Calculate total holdings value and maintenance requirement
  let holdingsValue = 0;
  let totalMaintenanceRequired = 0;
  
  Object.entries(holdings).forEach(([ticker, shares]) => {
    if (shares > 0) {
      const price = prices[ticker] || 0;
      const positionValue = price * shares;
      holdingsValue += positionValue;
      
      // Get character volatility for maintenance ratio
      const character = CHARACTER_MAP[ticker];
      totalMaintenanceRequired += positionValue * MARGIN_MAINTENANCE_RATIO;
    }
  });
  
  // Portfolio value = cash + holdings - margin debt
  const grossValue = cash + holdingsValue;
  const portfolioValue = grossValue - marginUsed;
  
  // Equity ratio = portfolio value / gross value (how much you actually own)
  const equityRatio = grossValue > 0 ? portfolioValue / grossValue : 1;
  
  // Available margin = (portfolio value * borrowing ratio) - margin already used
  const maxBorrowable = Math.max(0, portfolioValue * MARGIN_BORROWING_POWER_RATIO);
  const availableMargin = Math.max(0, maxBorrowable - marginUsed);
  
  // Determine status
  let status = 'safe';
  if (marginUsed > 0) {
    if (equityRatio <= MARGIN_LIQUIDATION_THRESHOLD) {
      status = 'liquidation';
    } else if (equityRatio <= MARGIN_CALL_THRESHOLD) {
      status = 'margin_call';
    } else if (equityRatio <= MARGIN_WARNING_THRESHOLD) {
      status = 'warning';
    }
  }
  
  return {
    enabled: true,
    marginUsed,
    availableMargin: Math.round(availableMargin * 100) / 100,
    portfolioValue: Math.round(portfolioValue * 100) / 100,
    grossValue: Math.round(grossValue * 100) / 100,
    holdingsValue: Math.round(holdingsValue * 100) / 100,
    totalMaintenanceRequired: Math.round(totalMaintenanceRequired * 100) / 100,
    equityRatio: Math.round(equityRatio * 1000) / 1000,
    status,
    marginCallAt: userData.marginCallAt || null
  };
};

// Helper function to check and award achievements after an action
const checkAndAwardAchievements = async (userRef, userData, prices, context = {}) => {
  const currentAchievements = userData.achievements || [];
  const newAchievements = [];
  
  // Calculate current portfolio value (including shorts)
  const holdingsValue = Object.entries(userData.holdings || {})
    .reduce((sum, [ticker, shares]) => sum + (prices[ticker] || 0) * shares, 0);
  
  const shortsValue = Object.entries(userData.shorts || {})
    .reduce((sum, [ticker, position]) => {
      if (!position || position.shares <= 0) return sum;
      const currentPrice = prices[ticker] || position.entryPrice;
      const collateral = position.margin || 0;
      const pnl = (position.entryPrice - currentPrice) * position.shares;
      return sum + collateral + pnl;
    }, 0);
  
  const portfolioValue = (userData.cash || 0) + holdingsValue + shortsValue;
  
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
  
  // Bull Run achievement (sell for 25%+ profit)
  if (context.sellProfitPercent && context.sellProfitPercent >= 25 && !currentAchievements.includes('BULL_RUN')) {
    newAchievements.push('BULL_RUN');
  }
  
  // Diamond Hands achievement (held through 30%+ dip and sold at profit)
  if (context.isDiamondHands && !currentAchievements.includes('DIAMOND_HANDS')) {
    newAchievements.push('DIAMOND_HANDS');
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
    
    // If not enough data within the time range, find the closest historical price
    if (data.length < 2) {
      const now = Date.now();
      const startTime = range.hours === Infinity ? now - (7 * 24 * 60 * 60 * 1000) : now - (range.hours * 60 * 60 * 1000);
      
      // Find the price closest to (but before) the cutoff time from full history
      let startPrice = character.basePrice;
      for (let i = tickerHistory.length - 1; i >= 0; i--) {
        if (tickerHistory[i].timestamp <= cutoff) {
          startPrice = tickerHistory[i].price;
          break;
        }
      }
      // If no history before cutoff, use the earliest available price
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
                <span className={`text-2xl font-bold ${textClass}`}>{formatCurrency(currentPrice)}</span>
                <span className={`text-sm font-semibold ${isUp ? 'text-green-500' : 'text-red-500'}`}>
                  {isUp ? '▲' : '▼'} {formatChange(periodChange)} ({timeRanges.find(t => t.key === timeRange)?.label})
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
  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';
  
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
            <div key={char.ticker} className={`flex items-center justify-between py-1 border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'} last:border-0`}>
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

const PredictionCard = ({ prediction, userBet, onBet, darkMode, isGuest, onRequestBet }) => {
  const [betAmount, setBetAmount] = useState(50);
  const [selectedOption, setSelectedOption] = useState(null);
  const [showBetUI, setShowBetUI] = useState(false);

  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';

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
      // Use request bet to show confirmation
      if (onRequestBet) {
        onRequestBet(prediction.id, selectedOption, betAmount, prediction.question);
      } else {
        onBet(prediction.id, selectedOption, betAmount);
      }
      setShowBetUI(false);
      setSelectedOption(null);
      setBetAmount(50);
    }
  };

  // Check if user already has a bet on this prediction
  const hasExistingBet = !!userBet;

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
            <span className={`text-xs font-semibold uppercase ${isActive ? 'text-orange-500' : prediction.resolved ? 'text-amber-500' : 'text-red-500'}`}>
              {isActive ? 'Active' : prediction.resolved ? 'Resolved' : 'Ended'}
            </span>
          </div>
          <h3 className={`font-semibold ${textClass}`}>{prediction.question}</h3>
        </div>
        <div className="text-right">
          <div className={`text-xs ${mutedClass}`}>{isActive ? 'Ends in' : 'Ended'}</div>
          <div className={`text-sm font-semibold ${isActive ? 'text-orange-500' : mutedClass}`}>
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
                <div className="flex-1 h-4 bg-zinc-800 rounded-sm overflow-hidden">
                  <div className={`h-full ${colors.fill} transition-all`} style={{ width: `${percent}%` }} />
                </div>
                <div className={`w-10 text-xs text-right ${mutedClass}`}>{percent}%</div>
              </div>
            );
          })}
        </div>
      </div>

      {userBet && (
        <div className={`mb-3 p-2 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-amber-50'}`}>
          <div className={`text-xs ${mutedClass}`}>Your bet</div>
          <div className={`font-semibold ${optionColors[options.indexOf(userBet.option) % optionColors.length]?.text || 'text-orange-500'}`}>
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
          {hasExistingBet ? (
            <div className={`text-center py-2 text-sm ${mutedClass} bg-zinc-800/50 rounded-sm`}>
              🔒 You've already placed a bet on this prediction
            </div>
          ) : !showBetUI ? (
            <button onClick={() => setShowBetUI(true)}
              className="w-full py-2 text-sm font-semibold uppercase bg-orange-600 hover:bg-orange-700 text-white rounded-sm">
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
                        betAmount === amount ? 'bg-orange-600 text-white' : darkMode ? 'bg-zinc-800 text-zinc-300' : 'bg-slate-200 text-zinc-600'
                      }`}>
                      ${amount}
                    </button>
                  ))}
                </div>
                <input type="number" value={betAmount}
                  onChange={(e) => setBetAmount(Math.max(1, parseInt(e.target.value) || 0))}
                  className={`w-full mt-2 px-3 py-2 text-sm rounded-sm border ${darkMode ? 'bg-zinc-950 border-zinc-700 text-zinc-100' : 'bg-white border-amber-200'}`}
                  placeholder="Custom amount..." />
              </div>
              {selectedOption && betAmount > 0 && (
                <div className={`text-sm ${mutedClass}`}>
                  Potential payout: <span className="text-orange-500 font-semibold">{formatCurrency(calculatePayout(selectedOption, betAmount))}</span>
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={() => { setShowBetUI(false); setSelectedOption(null); }}
                  className={`flex-1 py-2 text-sm font-semibold rounded-sm ${darkMode ? 'bg-zinc-800 text-zinc-300' : 'bg-slate-200 text-zinc-600'}`}>
                  Cancel
                </button>
                <button onClick={handlePlaceBet} disabled={!selectedOption || betAmount <= 0}
                  className="flex-1 py-2 text-sm font-semibold uppercase bg-orange-600 hover:bg-orange-700 text-white rounded-sm disabled:opacity-50">
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
        <div className={`text-center py-2 rounded-sm mt-2 ${optionColors[options.indexOf(prediction.outcome) % optionColors.length]?.bg || 'bg-orange-600'} bg-opacity-20`}>
          <span className={`font-semibold ${optionColors[options.indexOf(prediction.outcome) % optionColors.length]?.text || 'text-orange-500'}`}>
            Winner: {prediction.outcome}
          </span>
        </div>
      )}
    </div>
  );
};

// ============================================
// IPO HYPE CARD (24h announcement phase)
// ============================================

const IPOHypeCard = ({ ipo, darkMode }) => {
  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';
  
  const timeRemaining = ipo.ipoStartsAt - Date.now();
  const character = CHARACTER_MAP[ipo.ticker];
  
  return (
    <div className={`${cardClass} border rounded-sm p-4 relative overflow-hidden`}>
      {/* Animated gradient background */}
      <div className="absolute inset-0 bg-gradient-to-r from-orange-600/10 via-amber-500/10 to-orange-600/10 animate-pulse" />
      
      <div className="relative">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xl">🚀</span>
          <span className="text-xs font-bold uppercase text-orange-500 tracking-wider">IPO Coming Soon</span>
        </div>
        
        <h3 className={`text-lg font-bold ${textClass}`}>
          ${ipo.ticker} - {character?.name}
        </h3>
        
        {character?.description && (
          <p className={`text-sm ${mutedClass} mt-1 line-clamp-2`}>{character.description}</p>
        )}
        
        <div className={`mt-3 p-3 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-amber-50'}`}>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div>
              <p className={`text-xs ${mutedClass}`}>IPO Price</p>
              <p className="text-lg font-bold text-green-500">{formatCurrency(ipo.basePrice)}</p>
            </div>
            <div>
              <p className={`text-xs ${mutedClass}`}>Shares Available</p>
              <p className="text-lg font-bold text-orange-500">{IPO_TOTAL_SHARES}</p>
            </div>
          </div>
        </div>
        
        <div className="mt-3 text-center">
          <p className={`text-xs ${mutedClass}`}>IPO Opens In</p>
          <p className={`text-xl font-bold text-orange-500`}>{formatTimeRemaining(timeRemaining)}</p>
        </div>
        
        <p className={`text-xs ${mutedClass} mt-2 text-center`}>
          Max {IPO_MAX_PER_USER} shares per person • First come, first served
        </p>
      </div>
    </div>
  );
};

// ============================================
// IPO ACTIVE CARD (buying window)
// ============================================

const IPOActiveCard = ({ ipo, userData, onBuyIPO, darkMode, isGuest }) => {
  const [quantity, setQuantity] = useState(1);
  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';
  
  const character = CHARACTER_MAP[ipo.ticker];
  const timeRemaining = ipo.ipoEndsAt - Date.now();
  const sharesRemaining = ipo.sharesRemaining || IPO_TOTAL_SHARES;
  const userIPOPurchases = userData?.ipoPurchases?.[ipo.ticker] || 0;
  const maxCanBuy = Math.min(IPO_MAX_PER_USER - userIPOPurchases, sharesRemaining);
  const totalCost = quantity * ipo.basePrice;
  const canAfford = (userData?.cash || 0) >= totalCost;
  
  const soldOut = sharesRemaining <= 0;
  const userMaxedOut = userIPOPurchases >= IPO_MAX_PER_USER;
  
  return (
    <div className={`${cardClass} border-2 border-green-500 rounded-sm p-4 relative overflow-hidden`}>
      {/* Live indicator */}
      <div className="absolute top-2 right-2 flex items-center gap-1">
        <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        <span className="text-xs font-bold text-green-500">LIVE</span>
      </div>
      
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xl">📈</span>
        <span className="text-xs font-bold uppercase text-green-500 tracking-wider">IPO Now Open</span>
      </div>
      
      <h3 className={`text-lg font-bold ${textClass}`}>
        ${ipo.ticker} - {character?.name}
      </h3>
      
      <div className={`mt-3 p-3 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-amber-50'}`}>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className={`text-xs ${mutedClass}`}>Price</p>
            <p className="text-lg font-bold text-green-500">{formatCurrency(ipo.basePrice)}</p>
          </div>
          <div>
            <p className={`text-xs ${mutedClass}`}>Left</p>
            <p className={`text-lg font-bold ${sharesRemaining <= 20 ? 'text-red-500' : 'text-orange-500'}`}>
              {sharesRemaining}/{IPO_TOTAL_SHARES}
            </p>
          </div>
          <div>
            <p className={`text-xs ${mutedClass}`}>Ends In</p>
            <p className="text-lg font-bold text-amber-500">{formatTimeRemaining(timeRemaining)}</p>
          </div>
        </div>
        
        {/* Progress bar */}
        <div className="mt-2">
          <div className={`h-2 rounded-full ${darkMode ? 'bg-zinc-700' : 'bg-zinc-200'}`}>
            <div 
              className="h-full rounded-full bg-gradient-to-r from-green-500 to-orange-500 transition-all"
              style={{ width: `${((IPO_TOTAL_SHARES - sharesRemaining) / IPO_TOTAL_SHARES) * 100}%` }}
            />
          </div>
        </div>
      </div>
      
      {isGuest ? (
        <p className={`text-center text-sm ${mutedClass} mt-3`}>Sign in to participate in IPO</p>
      ) : soldOut ? (
        <div className="mt-3 text-center">
          <p className="text-red-500 font-bold">🚫 SOLD OUT</p>
          <p className={`text-xs ${mutedClass}`}>Normal trading begins soon with 30% price increase</p>
        </div>
      ) : userMaxedOut ? (
        <div className="mt-3 text-center">
          <p className="text-amber-500 font-semibold">✓ You've reached max IPO allocation</p>
          <p className={`text-xs ${mutedClass}`}>You purchased {userIPOPurchases} shares</p>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="1"
              max={maxCanBuy}
              value={quantity}
              onChange={(e) => setQuantity(Math.min(maxCanBuy, Math.max(1, parseInt(e.target.value) || 1)))}
              className={`w-20 px-2 py-1 text-center rounded-sm border ${darkMode ? 'bg-zinc-950 border-zinc-700 text-zinc-100' : 'bg-white border-amber-200'}`}
            />
            <span className={`text-sm ${mutedClass}`}>shares</span>
            <span className={`text-sm font-semibold ${textClass}`}>= {formatCurrency(totalCost)}</span>
          </div>
          
          <button
            onClick={() => onBuyIPO(ipo.ticker, quantity)}
            disabled={!canAfford || quantity > maxCanBuy}
            className="w-full py-2 text-sm font-bold uppercase bg-green-600 hover:bg-green-700 text-white rounded-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {!canAfford ? 'Insufficient Funds' : `Buy ${quantity} Share${quantity > 1 ? 's' : ''}`}
          </button>
          
          <p className={`text-xs ${mutedClass} text-center`}>
            You can buy up to {maxCanBuy} more shares
          </p>
        </div>
      )}
    </div>
  );
};

// ============================================
// PORTFOLIO MODAL (with chart)
// ============================================

const PortfolioModal = ({ holdings, prices, portfolioHistory, currentValue, onClose, onTrade, darkMode, costBasis, priceHistory }) => {
  const [sellAmounts, setSellAmounts] = useState({});
  const [showChart, setShowChart] = useState(true);
  const [timeRange, setTimeRange] = useState('7d');
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [expandedTicker, setExpandedTicker] = useState(null);
  
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

  const totalValue = portfolioItems.reduce((sum, item) => sum + item.value, 0);
  const totalCostBasis = portfolioItems.reduce((sum, item) => sum + item.totalCost, 0);
  const overallTotalReturn = totalValue - totalCostBasis;
  const overallTotalReturnPercent = totalCostBasis > 0 ? ((totalValue - totalCostBasis) / totalCostBasis) * 100 : 0;
  const overallTodayReturn = portfolioItems.reduce((sum, item) => sum + item.todayReturnDollar, 0);

  const handleSell = (ticker, amount) => {
    onTrade(ticker, 'sell', amount);
  };

  const toggleExpand = (ticker) => {
    setExpandedTicker(expandedTicker === ticker ? null : ticker);
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
        
        <div className={`p-4 border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
          <div className="flex justify-between items-center">
            <div>
              <h2 className={`text-lg font-semibold ${textClass}`}>Your Portfolio</h2>
              <div className="flex items-baseline gap-2 mt-1">
                <span className={`text-xl font-bold ${textClass}`}>{formatCurrency(currentValue)}</span>
                {hasChartData && (
                  <span className={`text-sm font-semibold ${isUp ? 'text-green-500' : 'text-red-500'}`}>
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
          {portfolioItems.length === 0 ? (
            <div className={`text-center py-8 ${mutedClass}`}>
              <p className="text-lg mb-2">📭 No holdings yet</p>
              <p className="text-sm">Start trading to build your portfolio!</p>
            </div>
          ) : (
            <>
              {/* Holdings List */}
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
                            <div className={`text-xs ${item.totalReturnPercent >= 0 ? 'text-green-500' : 'text-red-500'}`}>
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
                              <div className={`font-semibold ${item.todayReturnDollar >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                {item.todayReturnDollar >= 0 ? '+' : ''}{formatCurrency(item.todayReturnDollar)}
                                <span className="text-xs ml-1">({item.todayReturnPercent >= 0 ? '+' : ''}{item.todayReturnPercent.toFixed(2)}%)</span>
                              </div>
                            </div>
                            <div className={`p-2 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-white'}`}>
                              <div className={`text-xs ${mutedClass}`}>Total Return</div>
                              <div className={`font-semibold ${item.totalReturnDollar >= 0 ? 'text-green-500' : 'text-red-500'}`}>
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
                              value={sellAmounts[item.ticker] || 1}
                              onChange={(e) => setSellAmounts(prev => ({ 
                                ...prev, 
                                [item.ticker]: Math.min(item.shares, Math.max(1, parseInt(e.target.value) || 1)) 
                              }))}
                              onClick={(e) => e.stopPropagation()}
                              className={`w-20 px-2 py-1 text-sm text-center rounded-sm border ${
                                darkMode ? 'bg-zinc-950 border-zinc-700 text-zinc-100' : 'bg-white border-amber-200'
                              }`}
                            />
                            <button
                              onClick={(e) => { e.stopPropagation(); handleSell(item.ticker, sellAmounts[item.ticker] || 1); }}
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
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
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
  const [crewLeaders, setCrewLeaders] = useState([]); // Separate state for crew-specific leaderboard
  const [loading, setLoading] = useState(true);
  const [crewFilter, setCrewFilter] = useState('ALL'); // 'ALL' or crew ID

  // Fetch main top 50 leaderboard
  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const q = query(
          collection(db, 'users'),
          orderBy('portfolioValue', 'desc'),
          limit(50)
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

  // Fetch crew-specific leaderboard when crew filter changes
  useEffect(() => {
    if (crewFilter === 'ALL') {
      setCrewLeaders([]);
      return;
    }
    
    const fetchCrewLeaderboard = async () => {
      try {
        // Fetch all users in this crew, sorted by portfolio value
        const q = query(
          collection(db, 'users'),
          orderBy('portfolioValue', 'desc')
        );
        const snapshot = await getDocs(q);
        const crewMembers = snapshot.docs
          .map(doc => ({ ...doc.data(), id: doc.id }))
          .filter(user => user.crew === crewFilter)
          .slice(0, 50) // Limit to top 50 crew members
          .map((user, idx) => ({ ...user, crewRank: idx + 1 }));
        
        setCrewLeaders(crewMembers);
      } catch (err) {
        console.error('Failed to fetch crew leaderboard:', err);
      }
    };
    fetchCrewLeaderboard();
  }, [crewFilter]);

  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';

  const getRankStyle = (rank) => {
    if (rank === 1) return 'text-yellow-500';
    if (rank === 2) return 'text-zinc-400';
    if (rank === 3) return 'text-amber-600';
    return mutedClass;
  };

  const getRankEmoji = (rank) => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return `#${rank}`;
  };

  // Use crew-specific leaderboard when filtering, otherwise use main leaderboard
  const filteredLeaders = useMemo(() => {
    if (crewFilter === 'ALL') return leaders;
    return crewLeaders;
  }, [leaders, crewLeaders, crewFilter]);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className={`w-full max-w-lg ${cardClass} border rounded-sm shadow-xl overflow-hidden max-h-[80vh] flex flex-col`}
        onClick={e => e.stopPropagation()}>
        
        <div className={`p-4 border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
          <div className="flex justify-between items-center mb-3">
            <h2 className={`text-lg font-semibold ${textClass}`}>🏆 Leaderboard</h2>
            <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-600 text-xl`}>×</button>
          </div>
          
          {/* Crew Filter */}
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setCrewFilter('ALL')}
              className={`px-3 py-1 text-xs rounded-sm font-semibold ${
                crewFilter === 'ALL' 
                  ? 'bg-orange-600 text-white' 
                  : darkMode ? 'bg-zinc-800 text-zinc-300' : 'bg-slate-200 text-zinc-600'
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
                    : darkMode ? 'bg-zinc-800 text-zinc-300' : 'bg-slate-200 text-zinc-600'
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
                  <div key={leader.id} className={`p-3 flex items-center gap-3 ${displayRank <= 3 ? (darkMode ? 'bg-zinc-900/50' : 'bg-amber-50') : ''}`}>
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

  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';
  const linkClass = 'text-orange-500 hover:text-orange-400 underline';

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className={`w-full max-w-2xl ${cardClass} border rounded-sm shadow-xl overflow-hidden max-h-[90vh] flex flex-col`}
        onClick={e => e.stopPropagation()}>
        
        {/* Header */}
        <div className={`p-4 border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
          <div className="flex justify-between items-center">
            <h2 className={`text-lg font-semibold ${textClass}`}>About Stockism</h2>
            <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-600 text-xl`}>×</button>
          </div>
        </div>

        {/* Tabs */}
        <div className={`flex border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
          {[
            { key: 'about', label: '📖 About' },
            { key: 'faq', label: '❓ FAQ' },
            { key: 'privacy', label: '🔒 Privacy' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 py-3 text-sm font-semibold ${
                activeTab === tab.key ? 'text-orange-500 border-b-2 border-orange-500' : mutedClass
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
                <h3 className="font-semibold text-orange-500 mb-2">What is Stockism?</h3>
                <p className={mutedClass}>
                  Stockism is a free fan-made stock market simulation game based on the Lookism webtoon universe. 
                  Trade fictional characters like stocks, predict story outcomes, and compete on the leaderboard!
                </p>
              </div>
              
              <div>
                <h3 className="font-semibold text-orange-500 mb-2">How does it work?</h3>
                <p className={mutedClass}>
                  Each character has a stock price that changes based on player trading activity. 
                  Buy low, sell high, and use your knowledge of the webtoon to make smart investments. 
                  You can also bet on weekly predictions about upcoming chapters.
                </p>
              </div>
              
              <div>
                <h3 className="font-semibold text-orange-500 mb-2">Is real money involved?</h3>
                <p className={mutedClass}>
                  <span className="text-green-500 font-semibold">Absolutely not.</span> Stockism uses entirely fictional currency. 
                  You start with $1,000 of fake money and can earn more through daily check-ins. 
                  There is no way to deposit, withdraw, or exchange real money. This is purely for fun!
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-2">Who made this?</h3>
                <p className={mutedClass}>
                  Stockism was created by <a href="https://github.com/UltiMyBeloved" target="_blank" rel="noopener noreferrer" className="text-orange-500 hover:text-orange-400 underline">Darth YG</a> for the Lookism community. 
                  It's a free, open-source project with no ads or monetization.
                </p>
              </div>
            </div>
          )}

          {/* FAQ TAB */}
          {activeTab === 'faq' && (
            <div className={`space-y-4 ${textClass}`}>
              <div>
                <h3 className="font-semibold text-orange-500 mb-1">What's the "bid-ask spread"?</h3>
                <p className={`text-sm ${mutedClass}`}>
                  Just like real stock markets, there's a tiny gap between buy and sell prices (0.2%). 
                  This prevents instant arbitrage and makes the simulation more realistic.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-1">How do prices change?</h3>
                <p className={`text-sm ${mutedClass}`}>
                  Prices are driven by player activity using a realistic "square root" model. 
                  Buying pushes prices up, selling pushes them down. Large orders have diminishing 
                  impact to prevent manipulation.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-1">What is shorting?</h3>
                <p className={`text-sm ${mutedClass}`}>
                  Shorting lets you profit when a stock goes DOWN. You "borrow" shares, sell them, 
                  and hope to buy them back cheaper later. It's risky — if the price goes up instead, 
                  you lose money. Requires 50% margin as collateral.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-1">How do predictions work?</h3>
                <p className={`text-sm ${mutedClass}`}>
                  Place bets on story outcomes (e.g., "Will X defeat Y?"). All bets go into a pool, 
                  and winners split the entire pool proportionally. If everyone picks the same answer 
                  and wins, everyone just gets their money back.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-1">Can I lose all my money?</h3>
                <p className={`text-sm ${mutedClass}`}>
                  Yes, through bad trades or losing prediction bets. But you can always earn more 
                  through the daily check-in bonus ($300/day). You can never go below $0.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-1">How do I report bugs or suggest features?</h3>
                <p className={`text-sm ${mutedClass}`}>
                  Reach out to <a href="https://reddit.com/u/SupremeExalted" target="_blank" rel="noopener noreferrer" className="text-orange-500 hover:text-orange-400 underline">u/SupremeExalted</a> on Reddit. We're always looking to improve!
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
                <h3 className="font-semibold text-orange-500 mb-2">What we store in our game database:</h3>
                <ul className={`text-sm ${mutedClass} space-y-1 ml-4`}>
                  <li>• <span className={darkMode ? 'text-zinc-300' : 'text-slate-700'}>Username</span> — The name YOU choose (not your Google name)</li>
                  <li>• <span className={darkMode ? 'text-zinc-300' : 'text-slate-700'}>Game data</span> — Your cash balance, holdings, and trade history</li>
                  <li>• <span className={darkMode ? 'text-zinc-300' : 'text-slate-700'}>Account ID</span> — A random ID to identify your account</li>
                </ul>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-2">What Firebase Authentication stores:</h3>
                <p className={`text-sm ${mutedClass} mb-2`}>
                  Firebase (Google's service) handles login and stores your email to manage your account. 
                  This is standard for any website with login — it's how you can sign back in later.
                </p>
                <ul className={`text-sm ${mutedClass} space-y-1 ml-4`}>
                  <li>• <span className={darkMode ? 'text-amber-400' : 'text-amber-600'}>📧 Email</span> — Stored by Firebase Auth (not our game database). Never visible to other players or used for marketing.</li>
                </ul>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-2">What we DON'T store anywhere:</h3>
                <ul className={`text-sm ${mutedClass} space-y-1 ml-4`}>
                  <li>• <span className="text-red-400">❌ Your real name</span> — We never save your Google display name</li>
                  <li>• <span className="text-red-400">❌ Your profile picture</span> — We never save your Google photo</li>
                  <li>• <span className="text-red-400">❌ Your password</span> — Google handles authentication securely</li>
                  <li>• <span className="text-red-400">❌ Your contacts or Google data</span> — We have no access</li>
                  <li>• <span className="text-red-400">❌ Tracking cookies or analytics</span> — We don't use any</li>
                </ul>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-2">About the Google Sign-In popup:</h3>
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
                <h3 className="font-semibold text-orange-500 mb-2">Data deletion:</h3>
                <p className={`text-sm ${mutedClass}`}>
                  Want your data deleted? Contact us and we'll remove your account/data entirely.
                </p>
              </div>

              <div className={`mt-4 p-3 rounded-sm ${darkMode ? 'bg-zinc-800/50' : 'bg-amber-50'}`}>
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
  
  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';
  
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
        
        <div className={`p-4 border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
          <div className="flex justify-between items-center">
            <h2 className={`text-lg font-semibold ${textClass}`}>🏴 Crew</h2>
            <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-600 text-xl`}>×</button>
          </div>
          {currentCrew && (
            <p className={`text-sm ${mutedClass} mt-1 flex items-center gap-1`}>
              Current: 
              {CREW_MAP[currentCrew]?.icon ? (
                <img src={CREW_MAP[currentCrew]?.icon} alt="" className="w-4 h-4 object-contain inline" />
              ) : (
                <span style={{ color: CREW_MAP[currentCrew]?.color }}>{CREW_MAP[currentCrew]?.emblem}</span>
              )}
              <span style={{ color: CREW_MAP[currentCrew]?.color }}>{CREW_MAP[currentCrew]?.name}</span>
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
              ⚠️ <strong>Warning:</strong> Leaving a crew costs <strong>30% of your entire portfolio</strong>
              <br />
              <span className={`text-xs ${mutedClass}`}>Roughly 1/3 of your cash and shares will be taken if you ever leave.</span>
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
                Roughly 1/3 of your cash and shares will be taken.
              </p>
            </div>
            <p className={`text-sm ${mutedClass} mb-6`}>You can rejoin any crew later.</p>
            
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setLeavingCrew(false)}
                className={`px-6 py-2 rounded-sm border ${darkMode ? 'border-zinc-700 text-zinc-300' : 'border-amber-200'}`}
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
                  Roughly 1/3 of your cash and shares will be taken.
                </p>
              </div>
            ) : (
              <div className="mb-4">
                <p className={`text-sm text-orange-500 mb-3`}>
                  ✓ Joining a crew is free!
                </p>
                <div className={`p-3 rounded-sm ${darkMode ? 'bg-amber-900/20' : 'bg-amber-50'} border border-amber-500/30`}>
                  <p className="text-amber-400 text-sm">
                    ⚠️ <strong>Note:</strong> If you ever leave this crew, you'll lose <strong>30% of your portfolio</strong>.
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
                className={`px-6 py-2 rounded-sm border ${darkMode ? 'border-zinc-700 text-zinc-300' : 'border-amber-200'}`}
              >
                Back
              </button>
              <button
                onClick={handleConfirm}
                className="px-6 py-2 rounded-sm bg-orange-600 hover:bg-orange-700 text-white font-semibold"
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
                      ? 'opacity-50 cursor-not-allowed border-zinc-700'
                      : darkMode 
                        ? 'border-zinc-700 hover:border-orange-500 bg-zinc-800/50' 
                        : 'border-amber-200 hover:border-orange-500 bg-amber-50'
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
                    <span className="text-xs text-orange-500 mt-2 block">✓ Current crew</span>
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
  const [confirmPurchase, setConfirmPurchase] = useState(null); // { type: 'pin' | 'slot', item: pin | slotType, price: number }
  
  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';
  
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
      setConfirmPurchase({ type: 'pin', item: pin, price: pin.price });
    }
  };
  
  const handleConfirmPurchase = () => {
    if (!confirmPurchase) return;
    
    if (confirmPurchase.type === 'pin') {
      onPurchase('buyPin', confirmPurchase.item.id, confirmPurchase.price);
    } else if (confirmPurchase.type === 'slot') {
      onPurchase('buySlot', confirmPurchase.item, confirmPurchase.price);
    }
    setConfirmPurchase(null);
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
      setConfirmPurchase({ type: 'slot', item: slotType, price: cost });
    }
  };
  
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className={`w-full max-w-2xl ${cardClass} border rounded-sm shadow-xl overflow-hidden max-h-[90vh] flex flex-col`}
        onClick={e => e.stopPropagation()}>
        
        <div className={`p-4 border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
          <div className="flex justify-between items-center">
            <h2 className={`text-lg font-semibold ${textClass}`}>📌 Pins</h2>
            <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-600 text-xl`}>×</button>
          </div>
          <p className={`text-sm ${mutedClass}`}>Cash: <span className="text-orange-500 font-semibold">{formatCurrency(cash)}</span></p>
        </div>
        
        {/* Tabs */}
        <div className={`flex border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
          {['shop', 'achievement', 'manage'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 text-sm font-semibold ${
                activeTab === tab 
                  ? 'text-orange-500 border-b-2 border-orange-500' 
                  : mutedClass
              }`}
            >
              {tab === 'shop' ? '🛒 Buy Pins' : tab === 'achievement' ? '🏆 Achievements' : '📋 Display'}
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
                        ? 'border-orange-500 bg-orange-500/10' 
                        : darkMode ? 'border-zinc-700' : 'border-amber-200'
                    }`}
                  >
                    <div className="text-2xl text-center mb-2">{pin.emoji}</div>
                    <div className={`text-sm font-semibold text-center ${textClass}`}>{pin.name}</div>
                    <div className={`text-xs text-center ${mutedClass} mb-2`}>{pin.description}</div>
                    {owned ? (
                      <div className="text-xs text-center text-orange-500 font-semibold">✓ Owned</div>
                    ) : (
                      <button
                        onClick={() => handleBuyPin(pin)}
                        disabled={!canAfford}
                        className={`w-full py-1 text-xs rounded-sm font-semibold ${
                          canAfford 
                            ? 'bg-orange-600 hover:bg-orange-700 text-white' 
                            : 'bg-slate-600 text-zinc-400 cursor-not-allowed'
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
                          ? 'border-orange-500 bg-orange-500/10' 
                          : darkMode ? 'border-zinc-700' : 'border-amber-200'
                      }`}
                    >
                      <div className="text-2xl mb-1">{ach.emoji}</div>
                      <div className={`text-sm font-semibold ${textClass}`}>{ach.name}</div>
                      {isDisplayed && <span className="text-xs text-orange-500">✓ Displayed</span>}
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
                          ? 'border-orange-500 bg-orange-500/10' 
                          : darkMode ? 'border-zinc-700' : 'border-amber-200'
                      }`}
                    >
                      {CREW_MAP[userData.crew]?.icon ? (
                        <img src={CREW_MAP[userData.crew]?.icon} alt="" className="w-5 h-5 object-contain mr-1" />
                      ) : (
                        <span className="mr-1">{CREW_MAP[userData.crew]?.emblem}</span>
                      )}
                      <span className={`text-sm ${textClass}`}>{CREW_MAP[userData.crew]?.name}</span>
                      {userData.displayCrewPin !== false && <span className="text-xs text-orange-500 ml-2">✓ Displayed</span>}
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
                              ? 'border-orange-500 bg-orange-500/10' 
                              : darkMode ? 'border-zinc-700' : 'border-amber-200'
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
                          ? 'border-orange-500 text-orange-500 hover:bg-orange-500/10'
                          : 'border-zinc-700 text-zinc-500 cursor-not-allowed'
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
                          ? 'border-orange-500 text-orange-500 hover:bg-orange-500/10'
                          : 'border-zinc-700 text-zinc-500 cursor-not-allowed'
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
        
        {/* Purchase Confirmation Dialog */}
        {confirmPurchase && (
          <div className={`absolute inset-0 bg-black/50 flex items-center justify-center`}>
            <div className={`${cardClass} border rounded-sm p-6 m-4 max-w-sm`}>
              <h3 className={`text-lg font-semibold ${textClass} mb-3`}>Confirm Purchase</h3>
              <p className={`${mutedClass} mb-4`}>
                {confirmPurchase.type === 'pin' ? (
                  <>Buy <span className="text-xl">{confirmPurchase.item.emoji}</span> <strong>{confirmPurchase.item.name}</strong> for <span className="text-orange-500 font-semibold">{formatCurrency(confirmPurchase.price)}</span>?</>
                ) : (
                  <>Buy <strong>+1 {confirmPurchase.item === 'achievement' ? 'Achievement' : 'Shop'} Slot</strong> for <span className="text-orange-500 font-semibold">{formatCurrency(confirmPurchase.price)}</span>?</>
                )}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmPurchase(null)}
                  className={`flex-1 py-2 rounded-sm border ${darkMode ? 'border-zinc-700 text-zinc-300' : 'border-amber-200 text-zinc-600'}`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmPurchase}
                  className="flex-1 py-2 rounded-sm bg-orange-600 hover:bg-orange-700 text-white font-semibold"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================
// DAILY MISSIONS MODAL
// ============================================

const DailyMissionsModal = ({ onClose, darkMode, userData, prices, onClaimReward, portfolioValue }) => {
  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';
  
  const today = getTodayDateString();
  const dailyProgress = userData?.dailyMissions?.[today] || {};
  const userCrew = userData?.crew;
  const crewMembers = userCrew ? CREW_MAP[userCrew]?.members || [] : [];
  
  // Seeded random to pick 3 missions consistently for the day, varying by crew
  const getDailyMissions = () => {
    const allMissions = Object.values(DAILY_MISSIONS);
    
    // Create seed from date + crew ID for crew-specific missions
    // Users without a crew get a default seed
    const dateSeed = today.split('-').reduce((acc, num) => acc + parseInt(num), 0);
    const crewSeed = userCrew ? userCrew.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) : 0;
    const seed = dateSeed + crewSeed;
    
    // Fisher-Yates shuffle with seeded random
    const shuffled = [...allMissions];
    let currentSeed = seed;
    const seededRandom = () => {
      currentSeed = (currentSeed * 9301 + 49297) % 233280;
      return currentSeed / 233280;
    };
    
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(seededRandom() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    
    return shuffled.slice(0, 3);
  };
  
  const todaysMissions = getDailyMissions();
  
  // Helper to get all crew tickers a character belongs to
  const getCharacterCrews = (ticker) => {
    const crews = [];
    Object.values(CREWS).forEach(crew => {
      if (crew.members.includes(ticker)) {
        crews.push(crew.id);
      }
    });
    return crews;
  };
  
  // Calculate mission progress
  const getMissionProgress = (mission) => {
    const holdings = userData?.holdings || {};
    
    switch (mission.checkType) {
      // ============================================
      // ORIGINAL 3
      // ============================================
      case 'BUY_CREW': {
        const bought = dailyProgress.boughtCrewMember || false;
        return { complete: bought, progress: bought ? 1 : 0, target: 1 };
      }
      case 'HOLD_CREW': {
        const totalShares = crewMembers.reduce((sum, ticker) => {
          return sum + (holdings[ticker] || 0);
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
      
      // ============================================
      // GENERAL TRADING
      // ============================================
      case 'BUY_ANY': {
        const bought = dailyProgress.boughtAny || false;
        return { complete: bought, progress: bought ? 1 : 0, target: 1 };
      }
      case 'SELL_ANY': {
        const sold = dailyProgress.soldAny || false;
        return { complete: sold, progress: sold ? 1 : 0, target: 1 };
      }
      case 'HOLD_LARGE': {
        const maxHolding = Math.max(0, ...Object.values(holdings));
        return { 
          complete: maxHolding >= mission.requirement, 
          progress: maxHolding, 
          target: mission.requirement 
        };
      }
      case 'TRADE_VOLUME': {
        const volume = dailyProgress.tradeVolume || 0;
        return { 
          complete: volume >= mission.requirement, 
          progress: volume, 
          target: mission.requirement 
        };
      }
      
      // ============================================
      // CREW LOYALTY
      // ============================================
      case 'CREW_MAJORITY': {
        // 50%+ of holdings in crew members
        const totalShares = Object.values(holdings).reduce((sum, s) => sum + s, 0);
        const crewShares = crewMembers.reduce((sum, ticker) => sum + (holdings[ticker] || 0), 0);
        const percent = totalShares > 0 ? (crewShares / totalShares) * 100 : 0;
        return { 
          complete: percent >= mission.requirement, 
          progress: Math.floor(percent), 
          target: mission.requirement 
        };
      }
      case 'CREW_COLLECTOR': {
        // Own shares of 3+ different crew members
        const ownedCrewMembers = crewMembers.filter(ticker => (holdings[ticker] || 0) > 0).length;
        return { 
          complete: ownedCrewMembers >= mission.requirement, 
          progress: ownedCrewMembers, 
          target: mission.requirement 
        };
      }
      case 'FULL_ROSTER': {
        // Own at least 1 share of every crew member
        const ownedCrewMembers = crewMembers.filter(ticker => (holdings[ticker] || 0) > 0).length;
        const totalCrewMembers = crewMembers.length;
        return { 
          complete: ownedCrewMembers >= totalCrewMembers && totalCrewMembers > 0, 
          progress: ownedCrewMembers, 
          target: totalCrewMembers 
        };
      }
      case 'CREW_LEADER': {
        // This would require checking against all users - simplified to high holding
        // For now, check if user owns 20+ of any crew member
        const maxCrewHolding = Math.max(0, ...crewMembers.map(ticker => holdings[ticker] || 0));
        return { 
          complete: maxCrewHolding >= 20, 
          progress: maxCrewHolding, 
          target: 20 
        };
      }
      
      // ============================================
      // CREW VS CREW
      // ============================================
      case 'RIVAL_TRADER': {
        // Bought shares of a non-crew member today
        const bought = dailyProgress.boughtRival || false;
        return { complete: bought, progress: bought ? 1 : 0, target: 1 };
      }
      case 'SPY_GAME': {
        // Own shares in 3+ different crews
        const crewsOwned = new Set();
        Object.entries(holdings).forEach(([ticker, shares]) => {
          if (shares > 0) {
            getCharacterCrews(ticker).forEach(crewId => crewsOwned.add(crewId));
          }
        });
        return { 
          complete: crewsOwned.size >= mission.requirement, 
          progress: crewsOwned.size, 
          target: mission.requirement 
        };
      }
      
      // ============================================
      // CHARACTER-SPECIFIC
      // ============================================
      case 'TOP_DOG': {
        // Own shares of the highest-priced character
        let highestTicker = null;
        let highestPrice = 0;
        Object.entries(prices).forEach(([ticker, price]) => {
          if (price > highestPrice) {
            highestPrice = price;
            highestTicker = ticker;
          }
        });
        const ownsTopDog = highestTicker && (holdings[highestTicker] || 0) > 0;
        return { complete: ownsTopDog, progress: ownsTopDog ? 1 : 0, target: 1 };
      }
      case 'UNDERDOG_INVESTOR': {
        // Bought a character priced under $20 today
        const bought = dailyProgress.boughtUnderdog || false;
        return { complete: bought, progress: bought ? 1 : 0, target: 1 };
      }
      case 'WHALE_WATCH': {
        // Own 50+ shares of any single character
        const maxHolding = Math.max(0, ...Object.values(holdings));
        return { 
          complete: maxHolding >= mission.requirement, 
          progress: maxHolding, 
          target: mission.requirement 
        };
      }
      
      // ============================================
      // CREW VALUE
      // ============================================
      case 'BALANCED_CREW': {
        // Own at least 5 shares of 2+ different crew members
        const qualifyingMembers = crewMembers.filter(ticker => (holdings[ticker] || 0) >= 5).length;
        return { 
          complete: qualifyingMembers >= mission.requirement, 
          progress: qualifyingMembers, 
          target: mission.requirement 
        };
      }
      case 'CREW_ACCUMULATOR': {
        // Bought 10+ total shares of crew members today
        const crewSharesBought = dailyProgress.crewSharesBought || 0;
        return { 
          complete: crewSharesBought >= mission.requirement, 
          progress: crewSharesBought, 
          target: mission.requirement 
        };
      }
      
      default:
        return { complete: false, progress: 0, target: 1 };
    }
  };
  
  const missions = todaysMissions.map(mission => ({
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
        
        <div className={`p-4 border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
          <div className="flex justify-between items-center">
            <h2 className={`text-lg font-semibold ${textClass}`}>📋 Daily Missions</h2>
            <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-600 text-xl`}>×</button>
          </div>
          <p className={`text-sm ${mutedClass}`}>
            Resets daily • Earned: <span className="text-orange-500">{formatCurrency(earnedRewards)}</span> / {formatCurrency(totalRewards)}
          </p>
        </div>
        
        <div className="p-4 space-y-3">
          {noCrew ? (
            <div className={`p-4 rounded-sm ${darkMode ? 'bg-zinc-800/50' : 'bg-amber-50'} text-center`}>
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
                      ? 'border-orange-500/30 bg-orange-500/5' 
                      : mission.complete 
                        ? 'border-orange-500 bg-orange-500/10' 
                        : darkMode ? 'border-zinc-700' : 'border-amber-200'
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className={`font-semibold ${textClass}`}>{mission.name}</h3>
                      <p className={`text-xs ${mutedClass}`}>{mission.description}</p>
                    </div>
                    <span className={`text-sm font-bold ${mission.complete ? 'text-orange-500' : mutedClass}`}>
                      +{formatCurrency(mission.reward)}
                    </span>
                  </div>
                  
                  {/* Progress bar */}
                  <div className="flex items-center gap-2">
                    <div className={`flex-1 h-2 rounded-full ${darkMode ? 'bg-zinc-800' : 'bg-slate-200'}`}>
                      <div 
                        className={`h-full rounded-full transition-all ${mission.complete ? 'bg-orange-500' : 'bg-amber-500'}`}
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
                      className="w-full mt-2 py-1.5 text-sm font-semibold rounded-sm bg-orange-600 hover:bg-orange-700 text-white"
                    >
                      Claim Reward
                    </button>
                  )}
                  {mission.claimed && (
                    <p className="text-xs text-orange-500 mt-2 text-center">✓ Claimed</p>
                  )}
                </div>
              ))}
              
              {/* Crew member hint */}
              <div className={`p-2 rounded-sm ${darkMode ? 'bg-zinc-800/30' : 'bg-amber-50'}`}>
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
// PROFILE MODAL (Prediction History)
// ============================================

const ProfileModal = ({ onClose, darkMode, userData, predictions, onOpenCrewSelection }) => {
  const [showCrewSection, setShowCrewSection] = useState(false);
  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';
  
  const bets = userData?.bets || {};
  const predictionWins = userData?.predictionWins || 0;
  const userCrew = userData?.crew;
  const crewData = userCrew ? CREW_MAP[userCrew] : null;
  
  // Get all predictions user has bet on (from their bets object)
  const userBetHistory = Object.entries(bets).map(([predictionId, betData]) => {
    // Try to find the prediction in current predictions
    const prediction = predictions.find(p => p.id === predictionId);
    return {
      predictionId,
      ...betData,
      prediction
    };
  }).sort((a, b) => (b.placedAt || 0) - (a.placedAt || 0));
  
  // Calculate potential payout for active bets
  const calculatePotentialPayout = (bet) => {
    if (!bet.prediction || bet.prediction.resolved) return null;
    
    const pools = bet.prediction.pools || {};
    const totalPool = Object.values(pools).reduce((sum, p) => sum + p, 0);
    const myPool = pools[bet.option] || 0;
    
    if (myPool === 0) return 0;
    
    const myShare = bet.amount / myPool;
    return myShare * totalPool;
  };
  
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div 
        className={`w-full max-w-lg max-h-[85vh] ${cardClass} border rounded-sm shadow-xl overflow-hidden flex flex-col`}
        onClick={e => e.stopPropagation()}
      >
        <div className={`p-4 border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
          <div className="flex justify-between items-center">
            <div>
              <h2 className={`text-lg font-semibold ${textClass}`}>👤 {userData?.displayName}</h2>
              <p className={`text-sm ${mutedClass}`}>Profile & Stats</p>
            </div>
            <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-600 text-xl`}>×</button>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Crew Section - Collapsible */}
          {userCrew && crewData && (
            <div 
              className={`rounded-sm border ${darkMode ? 'border-zinc-700' : 'border-amber-200'} overflow-hidden`}
              style={{ borderColor: crewData.color }}
            >
              <button
                onClick={() => setShowCrewSection(!showCrewSection)}
                className={`w-full p-3 flex items-center justify-between ${darkMode ? 'bg-zinc-800/50 hover:bg-zinc-800' : 'bg-amber-50 hover:bg-amber-100'}`}
              >
                <div className="flex items-center gap-2">
                  {crewData.icon ? (
                    <img src={crewData.icon} alt="" className="w-6 h-6 object-contain" />
                  ) : (
                    <span className="text-xl">{crewData.emblem}</span>
                  )}
                  <span className={`font-semibold ${textClass}`} style={{ color: crewData.color }}>
                    {crewData.name}
                  </span>
                  {userData.isCrewHead && (
                    <span className="text-amber-400">👑</span>
                  )}
                </div>
                <span className={mutedClass}>{showCrewSection ? '▼' : '▶'}</span>
              </button>
              
              {showCrewSection && (
                <div className={`p-3 border-t ${darkMode ? 'border-zinc-700' : 'border-amber-200'}`}>
                  <div className={`text-sm ${mutedClass} mb-2`}>
                    <strong>Crew Members:</strong> {crewData.members?.join(', ')}
                  </div>
                  {userData.isCrewHead && (
                    <div className="text-sm text-amber-400 mb-2">
                      👑 You are the Crew Head (highest portfolio value)
                    </div>
                  )}
                  <button
                    onClick={() => { onClose(); onOpenCrewSelection(); }}
                    className={`w-full py-2 text-sm font-semibold rounded-sm ${darkMode ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'}`}
                  >
                    Switch Crew (50% penalty)
                  </button>
                </div>
              )}
            </div>
          )}
          
          {!userCrew && (
            <button
              onClick={() => { onClose(); onOpenCrewSelection(); }}
              className="w-full py-3 text-sm font-semibold rounded-sm bg-orange-600 hover:bg-orange-700 text-white"
            >
              🏴 Join a Crew
            </button>
          )}
          
          {/* Stats Summary */}
          <div className={`p-4 rounded-sm ${darkMode ? 'bg-zinc-800/50' : 'bg-amber-50'}`}>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className={`text-2xl font-bold text-orange-500`}>{userData?.totalTrades || 0}</p>
                <p className={`text-xs ${mutedClass}`}>Total Trades</p>
              </div>
              <div>
                <p className={`text-2xl font-bold text-orange-500`}>{predictionWins}</p>
                <p className={`text-xs ${mutedClass}`}>Correct Predictions</p>
              </div>
              <div>
                <p className={`text-2xl font-bold ${textClass}`}>{userBetHistory.length}</p>
                <p className={`text-xs ${mutedClass}`}>Bets Placed</p>
              </div>
            </div>
          </div>
          
          {/* Active Bets */}
          {userBetHistory.filter(b => b.prediction && !b.prediction.resolved).length > 0 && (
            <div>
              <h3 className={`font-semibold ${textClass} mb-2`}>🔮 Active Bets</h3>
              <div className="space-y-2">
                {userBetHistory.filter(b => b.prediction && !b.prediction.resolved).map(bet => {
                  const potentialPayout = calculatePotentialPayout(bet);
                  return (
                    <div key={bet.predictionId} className={`p-3 rounded-sm border ${darkMode ? 'border-zinc-700' : 'border-amber-200'}`}>
                      <p className={`text-sm font-semibold ${textClass}`}>{bet.prediction?.question || bet.question}</p>
                      <div className="flex justify-between items-center mt-2">
                        <div>
                          <span className={`text-xs ${mutedClass}`}>Your bet: </span>
                          <span className="text-orange-500 font-semibold">{formatCurrency(bet.amount)}</span>
                          <span className={`text-xs ${mutedClass}`}> on </span>
                          <span className={`text-sm font-semibold ${textClass}`}>"{bet.option}"</span>
                        </div>
                        {potentialPayout !== null && (
                          <div className="text-right">
                            <p className={`text-xs ${mutedClass}`}>Potential payout</p>
                            <p className="text-green-500 font-semibold">{formatCurrency(potentialPayout)}</p>
                          </div>
                        )}
                      </div>
                      {!bet.paid && (
                        <p className={`text-xs ${mutedClass} mt-1`}>⏳ Awaiting results...</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          
          {/* Past Predictions */}
          <div>
            <h3 className={`font-semibold ${textClass} mb-2`}>📜 Past Predictions</h3>
            {userBetHistory.filter(b => b.prediction?.resolved || b.paid !== undefined).length === 0 ? (
              <p className={`text-sm ${mutedClass}`}>No past predictions yet.</p>
            ) : (
              <div className="space-y-2">
                {userBetHistory.filter(b => b.prediction?.resolved || b.paid !== undefined).map(bet => {
                  const won = bet.prediction?.outcome === bet.option;
                  const paidOut = bet.paid === true;
                  return (
                    <div key={bet.predictionId} className={`p-3 rounded-sm border ${
                      won 
                        ? (darkMode ? 'border-green-700 bg-green-900/20' : 'border-green-300 bg-green-50')
                        : (darkMode ? 'border-red-700/50 bg-red-900/10' : 'border-red-200 bg-red-50')
                    }`}>
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <p className={`text-sm font-semibold ${textClass}`}>
                            {bet.prediction?.question || bet.question || 'Past prediction (details unavailable)'}
                          </p>
                          <p className={`text-xs ${mutedClass} mt-1`}>
                            Your answer: <span className={`font-semibold ${won ? 'text-green-500' : 'text-red-400'}`}>"{bet.option}"</span>
                            {(bet.prediction?.outcome || bet.outcome) && (
                              <span> • Correct answer: <span className="text-orange-500">"{bet.prediction?.outcome || bet.outcome}"</span></span>
                            )}
                          </p>
                        </div>
                        <div className="text-right ml-2">
                          {won ? (
                            <>
                              <p className="text-green-500 font-bold">✓ Won</p>
                              {bet.payout && <p className="text-green-500 text-sm">+{formatCurrency(bet.payout)}</p>}
                            </>
                          ) : (
                            <p className="text-red-400 font-semibold">✗ Lost</p>
                          )}
                        </div>
                      </div>
                      <div className={`text-xs mt-2 ${mutedClass}`}>
                        Bet: {formatCurrency(bet.amount)}
                        {paidOut ? (
                          <span className="text-green-500 ml-2">✓ Paid out to winners</span>
                        ) : bet.prediction?.resolved ? (
                          <span className="text-amber-500 ml-2">⏳ Payout pending</span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================
// ACHIEVEMENTS MODAL
// ============================================

const AchievementsModal = ({ onClose, darkMode, userData }) => {
  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-600';
  const bgClass = darkMode ? 'bg-zinc-950' : 'bg-amber-50';
  
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

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div 
        className={`w-full max-w-2xl max-h-[85vh] ${cardClass} border rounded-sm shadow-xl overflow-hidden flex flex-col`}
        onClick={e => e.stopPropagation()}
      >
        <div className={`p-4 border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'} flex justify-between items-center`}>
          <div>
            <h2 className={`text-xl font-bold ${textClass}`}>🏆 Achievements</h2>
            <p className={`text-sm ${mutedClass}`}>
              {earnedAchievements.length} / {allAchievements.length} unlocked
            </p>
          </div>
          <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-600 text-xl`}>×</button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
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
                          ? (darkMode ? 'bg-orange-900/30 border-orange-700' : 'bg-orange-50 border-orange-300')
                          : (darkMode ? 'bg-zinc-800/30 border-zinc-700' : 'bg-amber-50 border-amber-200')
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span className={`text-2xl ${earned ? '' : 'grayscale opacity-50'}`}>
                          {achievement.emoji}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className={`font-semibold text-sm ${earned ? 'text-orange-500' : mutedClass}`}>
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
// MARGIN MODAL
// ============================================

const MarginModal = ({ onClose, darkMode, userData, prices, onEnableMargin, onDisableMargin, onRepayMargin, isAdmin }) => {
  const [repayAmount, setRepayAmount] = useState(0);
  const [showConfirmEnable, setShowConfirmEnable] = useState(false);
  
  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-600';
  
  const eligibility = checkMarginEligibility(userData, isAdmin);
  const marginStatus = calculateMarginStatus(userData, prices);
  
  const getStatusColor = (status) => {
    switch (status) {
      case 'safe': return 'text-green-500';
      case 'warning': return 'text-amber-500';
      case 'margin_call': return 'text-orange-500';
      case 'liquidation': return 'text-red-500';
      default: return mutedClass;
    }
  };
  
  const getStatusLabel = (status) => {
    switch (status) {
      case 'safe': return '✓ Safe';
      case 'warning': return '⚠️ Warning';
      case 'margin_call': return '🚨 Margin Call';
      case 'liquidation': return '💀 Liquidation Risk';
      default: return 'Disabled';
    }
  };

  const getStatusBg = (status) => {
    switch (status) {
      case 'safe': return darkMode ? 'bg-green-900/20 border-green-800' : 'bg-green-50 border-green-200';
      case 'warning': return darkMode ? 'bg-amber-900/20 border-amber-700' : 'bg-amber-50 border-amber-200';
      case 'margin_call': return darkMode ? 'bg-orange-900/30 border-orange-700' : 'bg-orange-50 border-orange-200';
      case 'liquidation': return darkMode ? 'bg-red-900/30 border-red-700' : 'bg-red-50 border-red-200';
      default: return darkMode ? 'bg-zinc-800/50' : 'bg-slate-100';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div 
        className={`w-full max-w-md ${cardClass} border rounded-sm shadow-xl overflow-hidden max-h-[85vh] flex flex-col`}
        onClick={e => e.stopPropagation()}
      >
        <div className={`p-4 border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'} flex justify-between items-center`}>
          <div>
            <h2 className={`text-xl font-bold ${textClass}`}>📊 Margin Trading</h2>
            <p className={`text-sm ${mutedClass}`}>Leverage your portfolio</p>
          </div>
          <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-600 text-xl`}>×</button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!eligibility.eligible ? (
            // Locked state - show requirements
            <div className={`p-4 rounded-sm ${darkMode ? 'bg-zinc-800/50' : 'bg-amber-50'}`}>
              <h3 className={`font-semibold mb-2 ${textClass}`}>🔒 Margin Trading Locked</h3>
              <p className={`text-sm ${mutedClass} mb-3`}>Meet these requirements to unlock:</p>
              <div className="space-y-1">
                {eligibility.requirements.map((req, i) => (
                  <div key={i} className={`text-sm flex items-center gap-2 ${req.met ? 'text-green-500' : mutedClass}`}>
                    <span>{req.met ? '✓' : '○'}</span>
                    <span>{req.label}</span>
                    {!req.met && <span className="text-xs">({req.current}/{req.required})</span>}
                  </div>
                ))}
              </div>
            </div>
          ) : !marginStatus.enabled ? (
            // Eligible but not enabled
            <div className="space-y-4">
              <div className={`p-4 rounded-sm ${darkMode ? 'bg-green-900/20 border border-green-800' : 'bg-green-50 border border-green-200'}`}>
                <h3 className={`font-semibold mb-2 text-green-500`}>✓ Eligible for Margin</h3>
                <p className={`text-sm ${mutedClass}`}>
                  You qualify for margin trading! Enable it to access additional buying power.
                </p>
              </div>
              
              <div className={`p-3 rounded-sm ${darkMode ? 'bg-zinc-800/50' : 'bg-amber-50'}`}>
                <h4 className={`font-semibold mb-2 ${textClass}`}>How Margin Works</h4>
                <ul className={`text-xs ${mutedClass} space-y-1`}>
                  <li>• Borrow up to <span className="text-orange-500">50%</span> of your portfolio value</li>
                  <li>• Interest rate: <span className="text-amber-500">0.5% daily</span> on borrowed amount</li>
                  <li>• Maintenance: Keep <span className="text-orange-500">30%</span> equity minimum</li>
                  <li>• <span className="text-red-400">Margin call</span> if equity drops below 30%</li>
                  <li>• <span className="text-red-500">Auto-liquidation</span> at 25% equity</li>
                </ul>
              </div>
              
              <div className={`p-3 rounded-sm border ${darkMode ? 'bg-red-900/10 border-red-800' : 'bg-red-50 border-red-200'}`}>
                <h4 className="font-semibold mb-1 text-red-500">⚠️ Risk Warning</h4>
                <p className={`text-xs ${mutedClass}`}>
                  Margin trading amplifies both gains AND losses. You can lose more than your initial investment. 
                  If your portfolio drops significantly, your positions may be automatically liquidated.
                </p>
              </div>
              
              {!showConfirmEnable ? (
                <button
                  onClick={() => setShowConfirmEnable(true)}
                  className="w-full py-3 font-semibold rounded-sm bg-orange-600 hover:bg-orange-700 text-white"
                >
                  Enable Margin Trading
                </button>
              ) : (
                <div className="space-y-2">
                  <p className={`text-sm text-center ${textClass}`}>Are you sure? This enables borrowing.</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowConfirmEnable(false)}
                      className={`flex-1 py-2 font-semibold rounded-sm ${darkMode ? 'bg-zinc-700 text-zinc-300' : 'bg-slate-200 text-slate-600'}`}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => { onEnableMargin(); setShowConfirmEnable(false); }}
                      className="flex-1 py-2 font-semibold rounded-sm bg-orange-600 hover:bg-orange-700 text-white"
                    >
                      Yes, Enable
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            // Margin enabled - show status
            <div className="space-y-4">
              {/* Status Card */}
              <div className={`p-4 rounded-sm border ${getStatusBg(marginStatus.status)}`}>
                <div className="flex justify-between items-center mb-3">
                  <span className={`font-semibold ${textClass}`}>Margin Status</span>
                  <span className={`font-bold ${getStatusColor(marginStatus.status)}`}>
                    {getStatusLabel(marginStatus.status)}
                  </span>
                </div>
                
                {/* Equity Ratio Bar */}
                <div className="mb-3">
                  <div className="flex justify-between text-xs mb-1">
                    <span className={mutedClass}>Equity Ratio</span>
                    <span className={getStatusColor(marginStatus.status)}>
                      {(marginStatus.equityRatio * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className={`h-3 rounded-full ${darkMode ? 'bg-zinc-700' : 'bg-zinc-200'} overflow-hidden`}>
                    <div 
                      className={`h-full rounded-full transition-all ${
                        marginStatus.equityRatio > 0.35 ? 'bg-green-500' :
                        marginStatus.equityRatio > 0.30 ? 'bg-amber-500' :
                        marginStatus.equityRatio > 0.25 ? 'bg-orange-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${Math.min(100, marginStatus.equityRatio * 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs mt-1">
                    <span className="text-red-500">25%</span>
                    <span className="text-orange-500">30%</span>
                    <span className="text-amber-500">35%</span>
                    <span className="text-green-500">100%</span>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className={mutedClass}>Portfolio Value:</span>
                    <p className={`font-bold ${textClass}`}>{formatCurrency(marginStatus.portfolioValue)}</p>
                  </div>
                  <div>
                    <span className={mutedClass}>Margin Used:</span>
                    <p className={`font-bold ${marginStatus.marginUsed > 0 ? 'text-amber-500' : textClass}`}>
                      {formatCurrency(marginStatus.marginUsed)}
                    </p>
                  </div>
                  <div>
                    <span className={mutedClass}>Available Margin:</span>
                    <p className="font-bold text-green-500">{formatCurrency(marginStatus.availableMargin)}</p>
                  </div>
                  <div>
                    <span className={mutedClass}>Maintenance Req:</span>
                    <p className={`font-bold ${textClass}`}>{formatCurrency(marginStatus.totalMaintenanceRequired)}</p>
                  </div>
                </div>
              </div>
              
              {/* Margin Call Warning */}
              {marginStatus.status === 'margin_call' && (
                <div className={`p-3 rounded-sm ${darkMode ? 'bg-orange-900/30' : 'bg-orange-50'} border border-orange-500`}>
                  <h4 className="font-bold text-orange-500 mb-1">🚨 Margin Call!</h4>
                  <p className={`text-xs ${mutedClass}`}>
                    Deposit funds or sell positions to bring your equity above 30%. 
                    Auto-liquidation occurs at 25% equity.
                  </p>
                  {marginStatus.marginCallAt && (
                    <p className="text-xs text-orange-400 mt-1">
                      Grace period ends: {new Date(marginStatus.marginCallAt + MARGIN_CALL_GRACE_PERIOD).toLocaleString()}
                    </p>
                  )}
                </div>
              )}
              
              {marginStatus.status === 'liquidation' && (
                <div className={`p-3 rounded-sm ${darkMode ? 'bg-red-900/30' : 'bg-red-50'} border border-red-500`}>
                  <h4 className="font-bold text-red-500 mb-1">💀 Liquidation Imminent!</h4>
                  <p className={`text-xs ${mutedClass}`}>
                    Your positions will be automatically sold to cover margin debt. Act immediately!
                  </p>
                </div>
              )}
              
              {/* Repay Margin */}
              {marginStatus.marginUsed > 0 && (
                <div className={`p-3 rounded-sm ${darkMode ? 'bg-zinc-800/50' : 'bg-slate-100'}`}>
                  <h4 className={`font-semibold mb-2 ${textClass}`}>Repay Margin</h4>
                  <div className="flex gap-2 mb-2">
                    <input
                      type="number"
                      min={0}
                      max={Math.min(userData?.cash || 0, marginStatus.marginUsed)}
                      value={repayAmount}
                      onChange={(e) => setRepayAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                      placeholder="Amount"
                      className={`flex-1 px-3 py-2 rounded-sm border text-sm ${
                        darkMode ? 'bg-zinc-950 border-zinc-700 text-zinc-100' : 'bg-white border-amber-200'
                      }`}
                    />
                    <button
                      onClick={() => setRepayAmount(Math.min(userData?.cash || 0, marginStatus.marginUsed))}
                      className={`px-3 py-2 text-xs font-semibold rounded-sm ${
                        darkMode ? 'bg-zinc-700 text-zinc-300' : 'bg-slate-200 text-zinc-600'
                      }`}
                    >
                      Max
                    </button>
                  </div>
                  <p className={`text-xs ${mutedClass} mb-2`}>
                    Your cash: {formatCurrency(userData?.cash || 0)}
                  </p>
                  <button
                    onClick={() => { onRepayMargin(repayAmount); setRepayAmount(0); }}
                    disabled={repayAmount <= 0 || repayAmount > (userData?.cash || 0)}
                    className="w-full py-2 font-semibold rounded-sm bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Repay {formatCurrency(repayAmount)}
                  </button>
                </div>
              )}
              
              {/* Interest Info */}
              <div className={`p-3 rounded-sm ${darkMode ? 'bg-zinc-800/30' : 'bg-amber-50'}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span>💰</span>
                  <span className={`text-sm font-semibold ${textClass}`}>Daily Interest</span>
                </div>
                <p className={`text-xs ${mutedClass}`}>
                  {marginStatus.marginUsed > 0 ? (
                    <>
                      You're paying <span className="text-amber-500">{formatCurrency(marginStatus.marginUsed * MARGIN_INTEREST_RATE)}/day</span> in interest
                      ({(MARGIN_INTEREST_RATE * 100).toFixed(1)}% of {formatCurrency(marginStatus.marginUsed)})
                    </>
                  ) : (
                    <>No interest charged when not using margin</>
                  )}
                </p>
              </div>
              
              {/* Disable Margin */}
              {marginStatus.marginUsed === 0 && (
                <button
                  onClick={onDisableMargin}
                  className={`w-full py-2 text-sm font-semibold rounded-sm ${
                    darkMode ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                  }`}
                >
                  Disable Margin Trading
                </button>
              )}
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
            : 'bg-orange-600 hover:bg-orange-700'
        } text-white`}
      >
        {hasCheckedIn ? 'Checked In ✓' : 'Daily Check-in (+$300)'}
      </button>
      
      {showTooltip && hasCheckedIn && (
        <div className={`absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 rounded-sm text-xs whitespace-nowrap z-50 ${
          darkMode ? 'bg-zinc-800 text-zinc-100' : 'bg-zinc-900 text-white'
        } shadow-lg`}>
          <div className="text-center">
            <div className="font-semibold">Next check-in available in:</div>
            <div className="text-orange-400 font-mono mt-1">{timeUntilReset}</div>
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

  const handleTwitterSignIn = async () => {
    setLoading(true);
    setError('');
    try {
      await signInWithPopup(auth, twitterProvider);
      onClose();
    } catch (err) {
      if (err.code === 'auth/popup-closed-by-user') {
        // User closed popup, not an error
      } else if (err.code === 'auth/unauthorized-domain') {
        setError('Domain not authorized. Please add this domain to Firebase Auth settings.');
      } else if (err.code === 'auth/account-exists-with-different-credential') {
        setError('An account already exists with this email. Try signing in with Google instead.');
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

  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-600';
  const inputClass = darkMode 
    ? 'bg-zinc-950 border-zinc-700 text-zinc-100' 
    : 'bg-white border-amber-200 text-slate-900';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className={`w-full max-w-md ${cardClass} border rounded-sm shadow-xl p-6`} onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className={`absolute top-4 right-4 ${mutedClass} hover:text-orange-600 text-xl`}>×</button>

        <h2 className={`text-lg font-semibold mb-6 ${textClass}`}>
          {isRegistering ? 'Create Account' : 'Sign In'}
        </h2>

        {/* Google Sign In */}
        <button
          onClick={handleGoogleSignIn}
          disabled={loading}
          className={`w-full py-2.5 px-4 rounded-sm border flex items-center justify-center gap-2 mb-4 ${
            darkMode ? 'border-zinc-700 text-slate-200 hover:bg-zinc-800' : 'border-amber-200 text-slate-700 hover:bg-amber-50'
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

        {/* Twitter/X Sign In */}
        <button
          onClick={handleTwitterSignIn}
          disabled={loading}
          className={`w-full py-2.5 px-4 rounded-sm border flex items-center justify-center gap-2 mb-4 ${
            darkMode ? 'border-zinc-700 text-slate-200 hover:bg-zinc-800' : 'border-amber-200 text-slate-700 hover:bg-amber-50'
          } disabled:opacity-50`}
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
          </svg>
          Continue with X
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
              className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold py-2 px-4 rounded-sm text-sm uppercase disabled:opacity-50"
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
            className={`text-sm ${mutedClass} hover:text-orange-600`}
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

  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-600';
  const inputClass = darkMode 
    ? 'bg-zinc-950 border-zinc-700 text-zinc-100' 
    : 'bg-white border-amber-200 text-slate-900';

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
              className={`w-full px-3 py-2 border rounded-sm text-sm ${inputClass} focus:outline-none focus:ring-1 focus:ring-orange-600`}
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
            className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold py-2.5 px-4 rounded-sm text-sm uppercase tracking-wide transition-colors disabled:opacity-50"
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
    ? `bg-zinc-900 border-zinc-800 ${owned ? 'ring-1 ring-blue-500' : ''} ${shorted ? 'ring-1 ring-orange-500' : ''}` 
    : `bg-white border-amber-200 ${owned ? 'ring-1 ring-blue-500' : ''} ${shorted ? 'ring-1 ring-orange-500' : ''}`;
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';

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
              <p className="text-orange-600 font-mono text-sm font-semibold">${character.ticker}</p>
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
            darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 text-zinc-600 hover:bg-amber-50'
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
              className={`flex-1 py-1 text-xs font-semibold rounded-sm ${tradeMode === 'normal' ? 'bg-orange-600 text-white' : darkMode ? 'bg-zinc-800 text-zinc-300' : 'bg-slate-200 text-zinc-600'}`}
            >
              Buy/Sell
            </button>
            <button 
              onClick={() => setTradeMode('short')}
              className={`flex-1 py-1 text-xs font-semibold rounded-sm ${tradeMode === 'short' ? 'bg-orange-600 text-white' : darkMode ? 'bg-zinc-800 text-zinc-300' : 'bg-slate-200 text-zinc-600'}`}
            >
              Short
            </button>
          </div>

          {/* Bid/Ask Spread Display */}
          {(() => {
            const { bid, ask, spread } = getBidAskPrices(price);
            return (
              <div className={`flex justify-between items-center text-xs px-2 py-1.5 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-slate-100'}`}>
                <div className="text-center">
                  <div className={mutedClass}>Bid</div>
                  <div className="text-red-400 font-semibold">{formatCurrency(bid)}</div>
                </div>
                <div className="text-center">
                  <div className={mutedClass}>Spread</div>
                  <div className={`${mutedClass} font-mono`}>{(spread / price * 100).toFixed(2)}%</div>
                </div>
                <div className="text-center">
                  <div className={mutedClass}>Ask</div>
                  <div className="text-green-400 font-semibold">{formatCurrency(ask)}</div>
                </div>
              </div>
            );
          })()}

          <div className="flex items-center gap-2">
            <button onClick={() => setTradeAmount(Math.max(1, tradeAmount - 1))}
              className={`px-2 py-1 text-sm rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-slate-200'}`}>-</button>
            <input type="number" min="1" value={tradeAmount}
              onChange={(e) => setTradeAmount(Math.max(1, parseInt(e.target.value) || 1))}
              className={`w-full text-center py-1 text-sm rounded-sm border ${darkMode ? 'bg-zinc-950 border-zinc-700 text-zinc-100' : 'bg-white border-amber-200 text-slate-900'}`} />
            <button onClick={() => setTradeAmount(tradeAmount + 1)}
              className={`px-2 py-1 text-sm rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-slate-200'}`}>+</button>
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
            className={`w-full py-1 text-xs ${mutedClass} hover:text-orange-600`}>Cancel</button>
        </div>
      )}
    </div>
  );
};

const inputClass = 'bg-zinc-950 border-zinc-700 text-zinc-100';

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
  const [showProfile, setShowProfile] = useState(false);
  const [selectedCharacter, setSelectedCharacter] = useState(null);
  const [notification, setNotification] = useState(null);
  const [needsUsername, setNeedsUsername] = useState(false);
  const [sortBy, setSortBy] = useState('price-high');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [showAll, setShowAll] = useState(false);
  const [predictions, setPredictions] = useState([]);
  const [showAdmin, setShowAdmin] = useState(false);
  const [activeIPOs, setActiveIPOs] = useState([]); // IPOs currently in hype or active phase
  const [tradeConfirmation, setTradeConfirmation] = useState(null); // { ticker, action, amount, price, total }
  const [betConfirmation, setBetConfirmation] = useState(null); // { predictionId, option, amount, question }

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

  // Listen to IPO data
  useEffect(() => {
    const ipoRef = doc(db, 'market', 'ipos');
    
    const unsubscribe = onSnapshot(ipoRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const ipos = data.list || [];
        const now = Date.now();
        
        // Filter to only show active IPOs (in hype or buying phase)
        const activeOnes = ipos.filter(ipo => {
          const inHypePhase = now < ipo.ipoStartsAt;
          const inBuyingPhase = now >= ipo.ipoStartsAt && now < ipo.ipoEndsAt && (ipo.sharesRemaining || IPO_TOTAL_SHARES) > 0;
          return inHypePhase || inBuyingPhase;
        });
        
        setActiveIPOs(activeOnes);
        
        // Check for IPOs that just ended and need price jump
        ipos.forEach(async (ipo) => {
          if (now >= ipo.ipoEndsAt && !ipo.priceJumped) {
            // IPO ended - apply 30% price jump and mark as complete
            const marketRef = doc(db, 'market', 'current');
            const newPrice = Math.round(ipo.basePrice * (1 + IPO_PRICE_JUMP) * 100) / 100;
            
            await updateDoc(marketRef, {
              [`prices.${ipo.ticker}`]: newPrice,
              [`priceHistory.${ipo.ticker}`]: arrayUnion({ timestamp: now, price: newPrice })
            });
            
            // Mark IPO as price jumped
            const updatedList = ipos.map(i => 
              i.ticker === ipo.ticker ? { ...i, priceJumped: true } : i
            );
            await updateDoc(ipoRef, { list: updatedList });
          }
        });
      }
    });

    return () => unsubscribe();
  }, []);

  // Track lowest prices while holding for Diamond Hands achievement
  useEffect(() => {
    const updateLowestPrices = async () => {
      if (!user || !userData || !prices || Object.keys(prices).length === 0) return;
      
      const holdings = userData.holdings || {};
      const lowestWhileHolding = userData.lowestWhileHolding || {};
      const updates = {};
      
      // Check each held stock
      for (const [ticker, shares] of Object.entries(holdings)) {
        if (shares > 0 && prices[ticker]) {
          const currentPrice = prices[ticker];
          const currentLowest = lowestWhileHolding[ticker];
          
          // If we have a lower price than recorded, update it
          if (currentLowest === undefined || currentPrice < currentLowest) {
            updates[`lowestWhileHolding.${ticker}`] = Math.round(currentPrice * 100) / 100;
          }
        }
      }
      
      // Only update if there are changes
      if (Object.keys(updates).length > 0) {
        const userRef = doc(db, 'users', user.uid);
        await updateDoc(userRef, updates);
      }
    };
    
    updateLowestPrices();
  }, [user, userData?.holdings, prices]);

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
        // Take 30% of cash and 30% of each holding
        const penaltyRate = 0.3;
        const newCash = Math.floor(userData.cash * (1 - penaltyRate));
        const cashTaken = userData.cash - newCash;
        
        const newHoldings = {};
        let holdingsValueTaken = 0;
        
        Object.entries(userData.holdings || {}).forEach(([ticker, shares]) => {
          if (shares > 0) {
            // Take 30% of shares, rounding to nearest (round up if .5 or more)
            const sharesToTake = Math.round(shares * penaltyRate);
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
          message: `Switched to ${crew.name}! Lost ${formatCurrency(totalTaken)} (30% penalty)`
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
      
      // Calculate 30% penalty from portfolio
      // Take 30% of cash and 30% of each holding
      const penaltyRate = 0.3;
      const newCash = Math.floor(userData.cash * (1 - penaltyRate));
      const cashTaken = userData.cash - newCash;
      
      const newHoldings = {};
      const holdingsTaken = {};
      let holdingsValueTaken = 0;
      
      Object.entries(userData.holdings || {}).forEach(([ticker, shares]) => {
        if (shares > 0) {
          // Take 30% of shares, rounding to nearest (round up if .5 or more)
          const sharesToTake = Math.round(shares * penaltyRate);
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
        message: `Left ${oldCrew?.name || 'crew'}. Lost ${formatCurrency(totalTaken)} (30% penalty)`
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

  // Request trade confirmation
  const requestTrade = useCallback((ticker, action, amount) => {
    if (!user || !userData) {
      setNotification({ type: 'info', message: 'Sign in to start trading!' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }
    
    // Check if character is in IPO phase (not tradeable normally)
    const now = Date.now();
    const activeIPO = activeIPOs.find(ipo => ipo.ticker === ticker && !ipo.priceJumped && now < ipo.ipoEndsAt);
    if (activeIPO) {
      const inHypePhase = now < activeIPO.ipoStartsAt;
      setNotification({ 
        type: 'error', 
        message: inHypePhase 
          ? `$${ticker} is in IPO hype phase - trading opens soon!` 
          : `$${ticker} is in IPO - buy through the IPO section above!`
      });
      setTimeout(() => setNotification(null), 3000);
      return;
    }
    
    // Check if character requires IPO but hasn't had one
    const character = CHARACTER_MAP[ticker];
    if (character?.ipoRequired) {
      const completedIPO = activeIPOs.find(ipo => ipo.ticker === ticker && ipo.priceJumped);
      if (!completedIPO) {
        setNotification({ type: 'error', message: `$${ticker} requires an IPO before trading` });
        setTimeout(() => setNotification(null), 3000);
        return;
      }
    }
    
    const asset = CHARACTER_MAP[ticker];
    const price = prices[ticker] || asset?.basePrice || 0;
    
    // Calculate estimated total
    let total = price * amount;
    if (action === 'buy') {
      const priceImpact = calculatePriceImpact(price, amount, getCharacterLiquidity(ticker));
      const { ask } = getBidAskPrices(price + priceImpact);
      total = ask * amount;
    } else if (action === 'sell') {
      const priceImpact = calculatePriceImpact(price, amount, getCharacterLiquidity(ticker));
      const { bid } = getBidAskPrices(Math.max(MIN_PRICE, price - priceImpact));
      total = bid * amount;
    }
    
    setTradeConfirmation({ ticker, action, amount, price, total, name: asset?.name });
  }, [user, userData, prices, activeIPOs]);

  // Handle trade (executes after confirmation)
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
      
      // Check if user has enough cash or can use margin
      const cashAvailable = userData.cash || 0;
      const marginEnabled = userData.marginEnabled || false;
      const marginUsed = userData.marginUsed || 0;
      const marginStatus = calculateMarginStatus(userData, prices);
      const availableMargin = marginStatus.availableMargin || 0;
      
      let cashToUse = 0;
      let marginToUse = 0;
      
      if (cashAvailable >= totalCost) {
        // Can pay with cash
        cashToUse = totalCost;
        marginToUse = 0;
      } else if (marginEnabled && cashAvailable + availableMargin >= totalCost) {
        // Use all cash + some margin
        cashToUse = cashAvailable;
        marginToUse = totalCost - cashAvailable;
      } else {
        // Not enough funds even with margin
        if (marginEnabled) {
          setNotification({ type: 'error', message: `Insufficient funds! Need ${formatCurrency(totalCost)}, have ${formatCurrency(cashAvailable)} cash + ${formatCurrency(availableMargin)} margin` });
        } else {
          setNotification({ type: 'error', message: 'Insufficient funds!' });
        }
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
      
      // Track lowest price while holding for Diamond Hands achievement
      const currentLowest = userData.lowestWhileHolding?.[ticker];
      const newLowest = currentHoldings === 0 
        ? buyPrice  // First buy, set to buy price
        : Math.min(currentLowest || buyPrice, buyPrice);  // Keep tracking lowest

      // Check if this is a crew member purchase for daily missions
      const today = getTodayDateString();
      const userCrew = userData.crew;
      const crewMembers = userCrew ? CREW_MAP[userCrew]?.members || [] : [];
      const isBuyingCrewMember = crewMembers.includes(ticker);
      const currentTradesCount = userData.dailyMissions?.[today]?.tradesCount || 0;
      const currentTradeVolume = userData.dailyMissions?.[today]?.tradeVolume || 0;
      const currentCrewSharesBought = userData.dailyMissions?.[today]?.crewSharesBought || 0;
      
      // Check if buying a rival (any crew member that's not user's crew)
      const isRival = !isBuyingCrewMember && Object.values(CREWS).some(crew => crew.members.includes(ticker));
      
      // Check if underdog (price under $20)
      const isUnderdog = price < 20;

      // Update user with trade count, cost basis, last buy time, and daily mission progress
      const updateData = {
        cash: cashAvailable - cashToUse,
        marginUsed: marginUsed + marginToUse,
        [`holdings.${ticker}`]: newHoldings,
        [`costBasis.${ticker}`]: Math.round(newCostBasis * 100) / 100,
        [`lowestWhileHolding.${ticker}`]: Math.round(newLowest * 100) / 100,
        [`lastBuyTime.${ticker}`]: now,
        lastTradeTime: now,
        totalTrades: increment(1),
        [`dailyMissions.${today}.tradesCount`]: currentTradesCount + 1,
        [`dailyMissions.${today}.tradeVolume`]: currentTradeVolume + amount,
        [`dailyMissions.${today}.boughtAny`]: true
      };
      
      // Mark crew member purchase if applicable
      if (isBuyingCrewMember) {
        updateData[`dailyMissions.${today}.boughtCrewMember`] = true;
        updateData[`dailyMissions.${today}.crewSharesBought`] = currentCrewSharesBought + amount;
      }
      
      // Mark rival purchase if applicable
      if (isRival) {
        updateData[`dailyMissions.${today}.boughtRival`] = true;
      }
      
      // Mark underdog purchase if applicable
      if (isUnderdog) {
        updateData[`dailyMissions.${today}.boughtUnderdog`] = true;
      }

      await updateDoc(userRef, updateData);

      await updateDoc(marketRef, { totalTrades: increment(1) });
      
      // Record portfolio history
      const newPortfolioValue = (cashAvailable - cashToUse) + Object.entries(userData.holdings || {})
        .reduce((sum, [t, shares]) => sum + (prices[t] || 0) * (t === ticker ? shares + amount : shares), 0);
      await recordPortfolioHistory(user.uid, Math.round(newPortfolioValue * 100) / 100);
      
      // Log transaction for auditing
      await logTransaction(db, user.uid, 'BUY', {
        ticker,
        shares: amount,
        pricePerShare: buyPrice,
        totalCost,
        cashUsed: cashToUse,
        marginUsed: marginToUse,
        cashBefore: cashAvailable,
        cashAfter: cashAvailable - cashToUse,
        portfolioAfter: Math.round(newPortfolioValue * 100) / 100
      });
      
      // Check achievements (pass trade value for Shark achievement)
      const earnedAchievements = await checkAndAwardAchievements(userRef, {
        ...userData,
        cash: cashAvailable - cashToUse,
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

      // Holding period check - must hold shares for 45 seconds before selling
      const HOLDING_PERIOD_MS = 45 * 1000; // 45 seconds
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
      
      // Check for Diamond Hands - sold at profit after 30%+ dip
      const lowestWhileHolding = userData.lowestWhileHolding?.[ticker] || costBasis;
      const dipPercent = costBasis > 0 ? ((costBasis - lowestWhileHolding) / costBasis) * 100 : 0;
      const isDiamondHands = dipPercent >= 30 && profitPercent > 0;
      
      // Update cost basis if selling all shares, otherwise keep it
      const newHoldings = currentHoldings - amount;
      const costBasisUpdate = newHoldings <= 0 ? 0 : userData.costBasis?.[ticker] || 0;
      const lowestUpdate = newHoldings <= 0 ? null : userData.lowestWhileHolding?.[ticker];

      // Track daily mission progress
      const today = getTodayDateString();
      const currentTradesCount = userData.dailyMissions?.[today]?.tradesCount || 0;
      const currentTradeVolume = userData.dailyMissions?.[today]?.tradeVolume || 0;

      // Build update data
      const sellUpdateData = {
        cash: userData.cash + totalRevenue,
        [`holdings.${ticker}`]: newHoldings,
        [`costBasis.${ticker}`]: costBasisUpdate,
        lastTradeTime: now,
        totalTrades: increment(1),
        [`dailyMissions.${today}.tradesCount`]: currentTradesCount + 1,
        [`dailyMissions.${today}.tradeVolume`]: currentTradeVolume + amount,
        [`dailyMissions.${today}.soldAny`]: true
      };
      
      // Clear lowestWhileHolding if selling all shares
      if (newHoldings <= 0) {
        sellUpdateData[`lowestWhileHolding.${ticker}`] = deleteField();
      }

      // Update user with trade count and daily mission progress
      await updateDoc(userRef, sellUpdateData);

      await updateDoc(marketRef, { totalTrades: increment(1) });
      
      // Record portfolio history
      const newPortfolioValue = (userData.cash + totalRevenue) + Object.entries(userData.holdings || {})
        .reduce((sum, [t, shares]) => sum + (prices[t] || 0) * (t === ticker ? shares - amount : shares), 0);
      await recordPortfolioHistory(user.uid, Math.round(newPortfolioValue * 100) / 100);
      
      // Log transaction for auditing
      await logTransaction(db, user.uid, 'SELL', {
        ticker,
        shares: amount,
        pricePerShare: sellPrice,
        totalRevenue,
        costBasis,
        profitPercent: Math.round(profitPercent * 100) / 100,
        cashBefore: userData.cash,
        cashAfter: userData.cash + totalRevenue,
        portfolioAfter: Math.round(newPortfolioValue * 100) / 100
      });
      
      // Check achievements (pass profit percent for Bull Run, isDiamondHands for Diamond Hands)
      const earnedAchievements = await checkAndAwardAchievements(userRef, {
        ...userData,
        cash: userData.cash + totalRevenue,
        holdings: { ...userData.holdings, [ticker]: newHoldings },
        totalTrades: (userData.totalTrades || 0) + 1
      }, prices, { tradeValue: totalRevenue, sellProfitPercent: profitPercent, isDiamondHands });
      
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
      
      // Log transaction for auditing
      await logTransaction(db, user.uid, 'SHORT_OPEN', {
        ticker,
        shares: amount,
        entryPrice: shortPrice,
        marginRequired,
        totalShares,
        avgEntryPrice: Math.round(avgEntryPrice * 100) / 100,
        cashBefore: userData.cash,
        cashAfter: newCash,
        portfolioAfter: Math.round(newPortfolioValue * 100) / 100
      });
      
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

      // Holding period check - must hold short for 45 seconds before covering
      const HOLDING_PERIOD_MS = 45 * 1000; // 45 seconds
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
      
      // Log transaction for auditing
      await logTransaction(db, user.uid, 'SHORT_CLOSE', {
        ticker,
        shares: amount,
        entryPrice: existingShort.entryPrice,
        coverPrice,
        profitPerShare: Math.round(profitPerShare * 100) / 100,
        totalProfit: Math.round(profit * 100) / 100,
        marginReturned: Math.round(marginReturned * 100) / 100,
        cashBack: Math.round(cashBack * 100) / 100,
        cashBefore: userData.cash,
        cashAfter: userData.cash + cashBack,
        portfolioAfter: Math.round(newPortfolioValue * 100) / 100
      });
      
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

    // Calculate holdings value
    const holdingsValue = Object.entries(userData.holdings || {})
      .reduce((sum, [ticker, shares]) => sum + (prices[ticker] || 0) * shares, 0);
    
    // Calculate shorts value (collateral + P&L)
    const shortsValue = Object.entries(userData.shorts || {})
      .reduce((sum, [ticker, position]) => {
        if (!position || position.shares <= 0) return sum;
        const currentPrice = prices[ticker] || position.entryPrice;
        const collateral = position.margin || 0;
        // P&L = (entry price - current price) * shares (profit when price goes down)
        const pnl = (position.entryPrice - currentPrice) * position.shares;
        return sum + collateral + pnl;
      }, 0);

    const portfolioValue = userData.cash + holdingsValue + shortsValue;
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

  // Margin monitoring - check for margin calls and auto-liquidation
  useEffect(() => {
    if (!user || !userData || !userData.marginEnabled || !prices || Object.keys(prices).length === 0) return;
    
    const marginUsed = userData.marginUsed || 0;
    if (marginUsed <= 0) return; // No margin debt, nothing to check
    
    const checkMarginStatus = async () => {
      const status = calculateMarginStatus(userData, prices);
      const userRef = doc(db, 'users', user.uid);
      const now = Date.now();
      
      if (status.status === 'liquidation') {
        // AUTO-LIQUIDATION: Sell positions to cover margin debt
        console.log('MARGIN LIQUIDATION TRIGGERED', status);
        
        // Get holdings sorted by value (sell largest first)
        const holdings = userData.holdings || {};
        const sortedHoldings = Object.entries(holdings)
          .filter(([_, shares]) => shares > 0)
          .map(([ticker, shares]) => ({
            ticker,
            shares,
            value: (prices[ticker] || 0) * shares
          }))
          .sort((a, b) => b.value - a.value);
        
        let totalRecovered = 0;
        const updateData = {};
        
        // Sell positions until margin is covered
        for (const position of sortedHoldings) {
          if (totalRecovered >= marginUsed) break;
          
          const sellValue = position.value * 0.95; // 5% slippage on forced liquidation
          totalRecovered += sellValue;
          updateData[`holdings.${position.ticker}`] = 0;
          updateData[`costBasis.${position.ticker}`] = 0;
        }
        
        // Update user - add recovered cash, reduce margin
        const marginCovered = Math.min(totalRecovered, marginUsed);
        const remainingCash = totalRecovered - marginCovered;
        
        updateData.cash = (userData.cash || 0) + remainingCash;
        updateData.marginUsed = Math.max(0, marginUsed - totalRecovered);
        updateData.marginCallAt = null;
        updateData.lastLiquidation = now;
        
        await updateDoc(userRef, updateData);
        
        setNotification({ 
          type: 'error', 
          message: `💀 MARGIN LIQUIDATION: Positions sold to cover ${formatCurrency(marginCovered)} debt` 
        });
        setTimeout(() => setNotification(null), 10000);
        
      } else if (status.status === 'margin_call' && !userData.marginCallAt) {
        // First margin call - set grace period
        await updateDoc(userRef, { marginCallAt: now });
        
        setNotification({ 
          type: 'error', 
          message: `🚨 MARGIN CALL! Deposit funds or sell positions within 24h to avoid liquidation.` 
        });
        setTimeout(() => setNotification(null), 10000);
        
      } else if (status.status === 'margin_call' && userData.marginCallAt) {
        // Check if grace period expired
        const gracePeriodEnd = userData.marginCallAt + MARGIN_CALL_GRACE_PERIOD;
        if (now >= gracePeriodEnd) {
          // Grace period expired - trigger liquidation on next check
          // (The liquidation branch above will handle it)
        }
      } else if (status.status === 'warning') {
        // Just a warning, no action needed but could show notification
      } else if (status.status === 'safe' && userData.marginCallAt) {
        // Recovered from margin call
        await updateDoc(userRef, { marginCallAt: null });
      }
    };
    
    // Check immediately and every 30 seconds
    checkMarginStatus();
    const interval = setInterval(checkMarginStatus, 30000);
    
    return () => clearInterval(interval);
  }, [user, userData?.marginEnabled, userData?.marginUsed, userData?.marginCallAt, prices]);

  // Daily margin interest (charged at midnight or on login)
  useEffect(() => {
    if (!user || !userData || !userData.marginEnabled) return;
    
    const marginUsed = userData.marginUsed || 0;
    if (marginUsed <= 0) return;
    
    const lastInterestCharge = userData.lastMarginInterestCharge || 0;
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    
    // Charge interest if it's been more than 24 hours
    if (now - lastInterestCharge >= oneDayMs) {
      const chargeInterest = async () => {
        const interest = marginUsed * MARGIN_INTEREST_RATE;
        const userRef = doc(db, 'users', user.uid);
        
        await updateDoc(userRef, {
          marginUsed: marginUsed + interest,
          lastMarginInterestCharge: now
        });
        
        console.log(`Margin interest charged: ${formatCurrency(interest)}`);
      };
      
      chargeInterest();
    }
  }, [user, userData?.marginEnabled, userData?.marginUsed, userData?.lastMarginInterestCharge]);

  // Check leaderboard position for achievements (runs every 30 seconds)
  useEffect(() => {
    if (!user || !userData) return;
    
    // Make sure userData belongs to the current user (prevent cross-account issues)
    if (userData.oddsSnaps && Object.keys(userData).length < 3) return; // Incomplete data
    
    const checkLeaderboardAchievements = async () => {
      try {
        // Re-verify we have the right user data
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) return;
        
        const currentUserData = userSnap.data();
        const currentAchievements = currentUserData.achievements || [];
        
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
      totalCheckins: newTotalCheckins,
      [`dailyMissions.${getTodayDateString()}.checkedIn`]: true
    };
    
    if (newAchievements.length > 0) {
      updateData.achievements = arrayUnion(...newAchievements);
    }
    
    await updateDoc(userRef, updateData);
    
    // Log transaction for auditing
    await logTransaction(db, user.uid, 'CHECKIN', {
      bonus: DAILY_BONUS,
      totalCheckins: newTotalCheckins,
      cashBefore: userData.cash,
      cashAfter: userData.cash + DAILY_BONUS
    });

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

  // Handle IPO purchase
  const handleBuyIPO = useCallback(async (ticker, quantity) => {
    if (!user || !userData) {
      setNotification({ type: 'info', message: 'Sign in to participate in IPO!' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    const ipoRef = doc(db, 'market', 'ipos');
    const ipoSnap = await getDoc(ipoRef);
    if (!ipoSnap.exists()) {
      setNotification({ type: 'error', message: 'IPO not found' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    const ipoData = ipoSnap.data();
    const ipo = ipoData.list?.find(i => i.ticker === ticker);
    
    if (!ipo) {
      setNotification({ type: 'error', message: 'IPO not found' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    const now = Date.now();
    if (now < ipo.ipoStartsAt) {
      setNotification({ type: 'error', message: 'IPO has not started yet!' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }
    
    if (now >= ipo.ipoEndsAt) {
      setNotification({ type: 'error', message: 'IPO has ended!' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    const sharesRemaining = ipo.sharesRemaining ?? IPO_TOTAL_SHARES;
    if (sharesRemaining <= 0) {
      setNotification({ type: 'error', message: 'IPO sold out!' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    const userIPOPurchases = userData.ipoPurchases?.[ticker] || 0;
    if (userIPOPurchases + quantity > IPO_MAX_PER_USER) {
      setNotification({ type: 'error', message: `Max ${IPO_MAX_PER_USER} shares per person!` });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    if (quantity > sharesRemaining) {
      setNotification({ type: 'error', message: `Only ${sharesRemaining} shares left!` });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    const totalCost = ipo.basePrice * quantity;
    if (userData.cash < totalCost) {
      setNotification({ type: 'error', message: 'Insufficient funds!' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    try {
      const userRef = doc(db, 'users', user.uid);
      const marketRef = doc(db, 'market', 'current');
      
      // Update user's holdings, cash, and IPO purchases
      const currentHoldings = userData.holdings?.[ticker] || 0;
      const currentCostBasis = userData.costBasis?.[ticker] || ipo.basePrice;
      const newHoldings = currentHoldings + quantity;
      const newCostBasis = ((currentCostBasis * currentHoldings) + (ipo.basePrice * quantity)) / newHoldings;
      
      await updateDoc(userRef, {
        cash: userData.cash - totalCost,
        [`holdings.${ticker}`]: newHoldings,
        [`costBasis.${ticker}`]: Math.round(newCostBasis * 100) / 100,
        [`ipoPurchases.${ticker}`]: userIPOPurchases + quantity,
        [`lastBuyTime.${ticker}`]: now,
        totalTrades: (userData.totalTrades || 0) + 1
      });
      
      // Update IPO shares remaining
      const updatedList = ipoData.list.map(i => 
        i.ticker === ticker ? { ...i, sharesRemaining: sharesRemaining - quantity } : i
      );
      await updateDoc(ipoRef, { list: updatedList });
      
      // Initialize price if not set (first IPO purchase sets the price)
      const marketSnap = await getDoc(marketRef);
      const marketPrices = marketSnap.data()?.prices || {};
      if (!marketPrices[ticker]) {
        await updateDoc(marketRef, {
          [`prices.${ticker}`]: ipo.basePrice,
          [`priceHistory.${ticker}`]: [{ timestamp: now, price: ipo.basePrice }]
        });
      }
      
      const character = CHARACTER_MAP[ticker];
      setNotification({ 
        type: 'success', 
        message: `🚀 IPO: Bought ${quantity} ${character?.name || ticker} shares @ ${formatCurrency(ipo.basePrice)}!` 
      });
      setTimeout(() => setNotification(null), 4000);
      
    } catch (err) {
      console.error('IPO purchase failed:', err);
      setNotification({ type: 'error', message: 'IPO purchase failed!' });
      setTimeout(() => setNotification(null), 3000);
    }
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
        placedAt: Date.now(),
        question: prediction.question // Store question for history
      },
      [`dailyMissions.${getTodayDateString()}.placedBet`]: true
    });
    
    // Log transaction for auditing
    await logTransaction(db, user.uid, 'BET', {
      predictionId,
      option,
      amount,
      totalBetAmount: newBetAmount,
      question: prediction.question,
      cashBefore: userData.cash,
      cashAfter: userData.cash - amount
    });

    setNotification({ type: 'success', message: `Bet ${formatCurrency(amount)} on "${option}"!` });
    setTimeout(() => setNotification(null), 3000);
  }, [user, userData, predictions]);

  // Logout
  const handleLogout = () => signOut(auth);

  // Enable margin trading
  const handleEnableMargin = useCallback(async () => {
    if (!user || !userData) return;
    
    const isAdmin = ADMIN_UIDS.includes(user.uid);
    const eligibility = checkMarginEligibility(userData, isAdmin);
    if (!eligibility.eligible) {
      setNotification({ type: 'error', message: 'Not eligible for margin trading!' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }
    
    const userRef = doc(db, 'users', user.uid);
    await updateDoc(userRef, {
      marginEnabled: true,
      marginUsed: 0,
      marginEnabledAt: Date.now()
    });
    
    setNotification({ type: 'success', message: '📊 Margin trading enabled! You now have extra buying power.' });
    setTimeout(() => setNotification(null), 5000);
  }, [user, userData]);

  // Disable margin trading
  const handleDisableMargin = useCallback(async () => {
    if (!user || !userData) return;
    
    if ((userData.marginUsed || 0) > 0) {
      setNotification({ type: 'error', message: 'Repay all margin debt before disabling!' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }
    
    const userRef = doc(db, 'users', user.uid);
    await updateDoc(userRef, {
      marginEnabled: false,
      marginUsed: 0
    });
    
    setNotification({ type: 'success', message: 'Margin trading disabled.' });
    setTimeout(() => setNotification(null), 3000);
    setShowLending(false);
  }, [user, userData]);

  // Repay margin
  const handleRepayMargin = useCallback(async (amount) => {
    if (!user || !userData) return;
    
    const marginUsed = userData.marginUsed || 0;
    if (marginUsed <= 0) {
      setNotification({ type: 'error', message: 'No margin debt to repay!' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }
    
    if (amount > userData.cash) {
      setNotification({ type: 'error', message: 'Insufficient funds!' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }
    
    const repayAmount = Math.min(amount, marginUsed);
    const userRef = doc(db, 'users', user.uid);
    
    await updateDoc(userRef, {
      cash: userData.cash - repayAmount,
      marginUsed: marginUsed - repayAmount,
      marginCallAt: null // Clear margin call if repaying
    });
    
    if (repayAmount >= marginUsed) {
      setNotification({ type: 'success', message: `Margin fully repaid! Paid ${formatCurrency(repayAmount)}` });
    } else {
      setNotification({ type: 'success', message: `Repaid ${formatCurrency(repayAmount)}. Remaining debt: ${formatCurrency(marginUsed - repayAmount)}` });
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
  const holdingsValue = Object.entries(activeUserData.holdings || {})
    .reduce((sum, [ticker, shares]) => sum + (prices[ticker] || 0) * shares, 0);
  
  const shortsValue = Object.entries(activeUserData.shorts || {})
    .reduce((sum, [ticker, position]) => {
      if (!position || position.shares <= 0) return sum;
      const currentPrice = prices[ticker] || position.entryPrice;
      const collateral = position.margin || 0;
      // P&L = (entry price - current price) * shares (profit when price goes down)
      const pnl = (position.entryPrice - currentPrice) * position.shares;
      return sum + collateral + pnl;
    }, 0);
  
  const portfolioValue = activeUserData.cash + holdingsValue + shortsValue;

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

  // Get list of tickers currently in IPO (hype or active phase) - these shouldn't be tradeable
  const ipoRestrictedTickers = useMemo(() => {
    const now = Date.now();
    return activeIPOs
      .filter(ipo => !ipo.priceJumped && now < ipo.ipoEndsAt) // In hype or buying phase
      .map(ipo => ipo.ticker);
  }, [activeIPOs]);

  // Filter and sort
  const filteredCharacters = useMemo(() => {
    let filtered = CHARACTERS.filter(c => {
      // Search filter
      const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.ticker.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchesSearch) return false;
      
      // Hide characters that require IPO and haven't completed one yet
      if (c.ipoRequired) {
        // Check if this character has a completed IPO (priceJumped = true)
        const completedIPO = activeIPOs.find(ipo => ipo.ticker === c.ticker && ipo.priceJumped);
        if (!completedIPO) return false; // IPO required but not completed - hide from trading
      }
      
      // Also hide characters currently in IPO phase (shouldn't happen with above, but safety check)
      if (ipoRestrictedTickers.includes(c.ticker)) return false;
      
      return true;
    });

    // Calculate 24h price changes from actual history
    const priceChanges = {};
    CHARACTERS.forEach(c => {
      priceChanges[c.ticker] = get24hChange(c.ticker);
    });
    
    // Calculate trade activity (number of price history entries) for "active" sort
    const getTradeActivity = (ticker) => {
      const history = priceHistory[ticker] || [];
      const now = Date.now();
      const weekAgo = now - (7 * 24 * 60 * 60 * 1000);
      const dayAgo = now - (24 * 60 * 60 * 1000);
      
      // Count entries in the last week and last day
      let weekTrades = 0;
      let dayTrades = 0;
      
      for (const entry of history) {
        if (entry.timestamp >= weekAgo) {
          weekTrades++;
          if (entry.timestamp >= dayAgo) {
            dayTrades++;
          }
        }
      }
      
      return { weekTrades, dayTrades };
    };

    switch (sortBy) {
      case 'price-high': filtered.sort((a, b) => (prices[b.ticker] || b.basePrice) - (prices[a.ticker] || a.basePrice)); break;
      case 'price-low': filtered.sort((a, b) => (prices[a.ticker] || a.basePrice) - (prices[b.ticker] || b.basePrice)); break;
      case 'active': 
        filtered.sort((a, b) => {
          const activityA = getTradeActivity(a.ticker);
          const activityB = getTradeActivity(b.ticker);
          
          // Primary: most trades in last week
          if (activityB.weekTrades !== activityA.weekTrades) {
            return activityB.weekTrades - activityA.weekTrades;
          }
          // Secondary: most trades in last day
          if (activityB.dayTrades !== activityA.dayTrades) {
            return activityB.dayTrades - activityA.dayTrades;
          }
          // Tertiary: alphabetical by ticker
          return a.ticker.localeCompare(b.ticker);
        });
        break;
      case 'ticker': filtered.sort((a, b) => a.ticker.localeCompare(b.ticker)); break;
      case 'newest': filtered.sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded)); break;
      case 'oldest': filtered.sort((a, b) => new Date(a.dateAdded) - new Date(b.dateAdded)); break;
    }
    return filtered;
  }, [searchQuery, sortBy, prices, priceHistory, get24hChange, activeIPOs, ipoRestrictedTickers]);

  const totalPages = Math.ceil(filteredCharacters.length / ITEMS_PER_PAGE);
  const displayedCharacters = showAll ? filteredCharacters : filteredCharacters.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  // Styling - Orange/Yellow theme inspired by logo
  const bgClass = darkMode ? 'bg-zinc-950' : 'bg-amber-50';
  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-zinc-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';
  const inputClassStyle = darkMode ? 'bg-zinc-950 border-zinc-700 text-zinc-100' : 'bg-white border-amber-300 text-zinc-900';

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
            src={darkMode ? "/stockism grey splatter.png" : "/stockism logo.png"}
            alt="Stockism" 
            className="h-[100px] sm:h-[115px] md:h-[200px] w-auto select-none pointer-events-none"
            draggable="false"
            onContextMenu={(e) => e.preventDefault()}
            style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
          />
        </div>

        {/* Nav Bar */}
        <div className={`${cardClass} border rounded-sm p-3 mb-4`}>
          <div className="flex flex-wrap justify-center sm:justify-end items-center gap-2">
            <button onClick={() => setShowLeaderboard(true)}
              className={`px-3 py-1 text-xs rounded-sm border ${darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 hover:bg-amber-50'}`}>
              🏆 Leaderboard
            </button>
            {!isGuest && !userData?.crew && (
              <button onClick={() => setShowCrewSelection(true)}
                className={`px-3 py-1 text-xs rounded-sm border flex items-center gap-1 ${darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 hover:bg-amber-50'}`}>
                🏴 Join Crew
              </button>
            )}
            {!isGuest && (
              <button onClick={() => setShowDailyMissions(true)}
                className={`px-3 py-1 text-xs rounded-sm border ${darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 hover:bg-amber-50'}`}>
                📋 Missions
              </button>
            )}
            {!isGuest && (
              <button onClick={() => setShowPinShop(true)}
                className={`px-3 py-1 text-xs rounded-sm border ${darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 hover:bg-amber-50'}`}>
                📌 Pins
              </button>
            )}
            {!isGuest && (
              <button onClick={() => setShowAchievements(true)}
                className={`px-3 py-1 text-xs rounded-sm border ${darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 hover:bg-amber-50'}`}>
                🎯 Achievements
              </button>
            )}
            {!isGuest && (
              <button onClick={() => setShowLending(true)}
                className={`px-3 py-1 text-xs rounded-sm border ${
                  userData?.marginUsed > 0
                    ? 'border-amber-500 text-amber-500 hover:bg-amber-900/20' 
                    : userData?.marginEnabled
                    ? 'border-green-600 text-green-500 hover:bg-green-900/20'
                    : darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 hover:bg-amber-50'
                }`}>
                📊 {userData?.marginUsed > 0 ? `Margin: ${formatCurrency(userData.marginUsed)}` : userData?.marginEnabled ? 'Margin ✓' : 'Margin'}
              </button>
            )}
            {user && ADMIN_UIDS.includes(user.uid) && (
              <button onClick={() => setShowAdmin(true)}
                className={`px-3 py-1 text-xs rounded-sm border ${darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 hover:bg-amber-50'}`}>
                🔧 Admin
              </button>
            )}
            <button onClick={() => setShowAbout(true)}
              className={`px-3 py-1 text-xs rounded-sm border ${darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 hover:bg-amber-50'}`}>
              ℹ️ About
            </button>
            <button onClick={() => setDarkMode(!darkMode)}
              className={`px-3 py-1 text-xs rounded-sm border ${darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 hover:bg-amber-50'}`}>
              {darkMode ? '☀️' : '🌙'}
            </button>
            {isGuest ? (
              <button onClick={() => setShowLoginModal(true)}
                className="px-3 py-1 text-xs rounded-sm bg-orange-600 hover:bg-orange-700 text-white font-semibold uppercase">
                Sign In
              </button>
            ) : (
              <>
                <button 
                  onClick={() => setShowProfile(true)}
                  className={`text-sm ${mutedClass} flex items-center hover:text-orange-500 transition-colors`}
                >
                  <span style={userData?.isCrewHead && userData?.crew ? { color: userData.crewHeadColor || CREW_MAP[userData.crew]?.color } : {}}>
                    {userData?.displayName}
                  </span>
                  <PinDisplay userData={userData} size="sm" />
                </button>
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
          <div className={`mb-4 p-3 rounded-sm text-sm ${darkMode ? 'bg-zinc-900 border border-zinc-800 text-zinc-300' : 'bg-amber-50 border border-amber-200 text-amber-800'}`}>
            👋 Browsing as guest. <button onClick={() => setShowLoginModal(true)} className="font-semibold text-orange-600 hover:underline">Sign in</button> to trade and save progress!
          </div>
        )}

        {/* IPO Announcements */}
        {activeIPOs.length > 0 && (
          <div className="mb-4">
            <h2 className={`text-sm font-semibold uppercase tracking-wide mb-3 ${mutedClass}`}>🚀 IPO</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {activeIPOs.map(ipo => {
                const now = Date.now();
                const inHypePhase = now < ipo.ipoStartsAt;
                
                return inHypePhase ? (
                  <IPOHypeCard key={ipo.ticker} ipo={ipo} darkMode={darkMode} />
                ) : (
                  <IPOActiveCard 
                    key={ipo.ticker} 
                    ipo={ipo} 
                    userData={userData}
                    onBuyIPO={handleBuyIPO}
                    darkMode={darkMode}
                    isGuest={isGuest}
                  />
                );
              })}
            </div>
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
                    onRequestBet={(predictionId, option, amount, question) => setBetConfirmation({ predictionId, option, amount, question })}
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
            {activeUserData.marginEnabled && (() => {
              const marginStatus = calculateMarginStatus(activeUserData, prices);
              return (
                <p className={`text-xs ${mutedClass}`}>
                  <span className="text-amber-500">+ {formatCurrency(marginStatus.availableMargin)} margin</span>
                  {activeUserData.marginUsed > 0 && (
                    <span className="text-orange-500 ml-2">({formatCurrency(activeUserData.marginUsed)} used)</span>
                  )}
                </p>
              );
            })()}
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
              {portfolioValue >= STARTING_CASH ? '▲' : '▼'} {formatCurrency(Math.abs(portfolioValue - STARTING_CASH))} ({formatChange(((portfolioValue - STARTING_CASH) / STARTING_CASH) * 100)}) from start
            </p>
          </div>
          <div className={`${cardClass} border rounded-sm p-4 cursor-pointer hover:border-orange-600`} onClick={() => !isGuest && setShowPortfolio(true)}>
            <p className={`text-xs font-semibold uppercase ${mutedClass}`}>Holdings</p>
            <p className={`text-2xl font-bold ${textClass}`}>
              {Object.values(activeUserData.holdings || {}).reduce((a, b) => a + b, 0)} shares
            </p>
            <p className={`text-xs ${mutedClass}`}>
              {Object.keys(activeUserData.holdings || {}).filter(k => activeUserData.holdings[k] > 0).length} characters
              {!isGuest && <span className="text-orange-600 ml-2">→ View details</span>}
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
                className={`px-3 py-2 text-sm rounded-sm border ${darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 hover:bg-amber-50'} disabled:opacity-50`}>
                Prev
              </button>
              <span className={`text-sm ${mutedClass}`}>{currentPage}/{totalPages}</span>
              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={showAll || currentPage === totalPages}
                className={`px-3 py-2 text-sm rounded-sm border ${darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 hover:bg-amber-50'} disabled:opacity-50`}>
                Next
              </button>
            </div>
            <button onClick={() => setShowAll(!showAll)}
              className={`px-3 py-2 text-sm font-semibold rounded-sm ${showAll ? 'bg-amber-500 text-white' : `border ${darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 hover:bg-amber-50'}`}`}>
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
              onTrade={requestTrade}
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
                className={`px-4 py-2 text-sm font-semibold rounded-sm border ${darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 hover:bg-amber-50'} disabled:opacity-50`}>
                Previous
              </button>
              <span className={`text-sm ${mutedClass}`}>Page {currentPage} of {totalPages}</span>
              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
                className={`px-4 py-2 text-sm font-semibold rounded-sm border ${darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 hover:bg-amber-50'} disabled:opacity-50`}>
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
      {showProfile && !isGuest && (
        <ProfileModal 
          onClose={() => setShowProfile(false)} 
          darkMode={darkMode} 
          userData={userData}
          predictions={predictions}
          onOpenCrewSelection={() => setShowCrewSelection(true)}
        />
      )}
      {showLending && !isGuest && (
        <MarginModal 
          onClose={() => setShowLending(false)} 
          darkMode={darkMode} 
          userData={userData}
          prices={prices}
          onEnableMargin={handleEnableMargin}
          onDisableMargin={handleDisableMargin}
          onRepayMargin={handleRepayMargin}
          isAdmin={user && ADMIN_UIDS.includes(user.uid)}
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
          portfolioValue={portfolioValue}
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
          onTrade={requestTrade}
          darkMode={darkMode}
          costBasis={userData?.costBasis || {}}
          priceHistory={priceHistory}
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

      {/* Trade Confirmation Modal */}
      {tradeConfirmation && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[60]" onClick={() => setTradeConfirmation(null)}>
          <div 
            className={`w-full max-w-sm ${darkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-amber-200'} border rounded-sm shadow-xl p-5`}
            onClick={e => e.stopPropagation()}
          >
            <h3 className={`text-lg font-semibold mb-4 ${darkMode ? 'text-zinc-100' : 'text-slate-900'}`}>
              Confirm {tradeConfirmation.action === 'buy' ? 'Purchase' : tradeConfirmation.action === 'sell' ? 'Sale' : 'Short'}
            </h3>
            <div className={`space-y-2 mb-5 ${darkMode ? 'text-zinc-300' : 'text-slate-700'}`}>
              <div className="flex justify-between">
                <span>Stock:</span>
                <span className="font-semibold text-orange-500">${tradeConfirmation.ticker}</span>
              </div>
              <div className="flex justify-between">
                <span>Action:</span>
                <span className={`font-semibold ${tradeConfirmation.action === 'buy' ? 'text-green-500' : 'text-red-500'}`}>
                  {tradeConfirmation.action.toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Shares:</span>
                <span className="font-semibold">{tradeConfirmation.amount}</span>
              </div>
              <div className="flex justify-between">
                <span>Est. Price/Share:</span>
                <span className="font-semibold">{formatCurrency(tradeConfirmation.total / tradeConfirmation.amount)}</span>
              </div>
              <div className={`flex justify-between pt-2 border-t ${darkMode ? 'border-zinc-700' : 'border-amber-200'}`}>
                <span className="font-semibold">Est. Total:</span>
                <span className={`font-bold ${tradeConfirmation.action === 'buy' ? 'text-red-500' : 'text-green-500'}`}>
                  {tradeConfirmation.action === 'buy' ? '-' : '+'}{formatCurrency(tradeConfirmation.total)}
                </span>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setTradeConfirmation(null)}
                className={`flex-1 py-2 rounded-sm font-semibold ${darkMode ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  handleTrade(tradeConfirmation.ticker, tradeConfirmation.action, tradeConfirmation.amount);
                  setTradeConfirmation(null);
                }}
                className={`flex-1 py-2 rounded-sm font-semibold text-white ${
                  tradeConfirmation.action === 'buy' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                Confirm {tradeConfirmation.action === 'buy' ? 'Buy' : 'Sell'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bet Confirmation Modal */}
      {betConfirmation && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[60]" onClick={() => setBetConfirmation(null)}>
          <div 
            className={`w-full max-w-sm ${darkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-amber-200'} border rounded-sm shadow-xl p-5`}
            onClick={e => e.stopPropagation()}
          >
            <h3 className={`text-lg font-semibold mb-4 ${darkMode ? 'text-zinc-100' : 'text-slate-900'}`}>
              Confirm Bet
            </h3>
            <div className={`space-y-2 mb-5 ${darkMode ? 'text-zinc-300' : 'text-slate-700'}`}>
              <div className="mb-3">
                <span className={`text-sm ${darkMode ? 'text-zinc-400' : 'text-slate-500'}`}>Question:</span>
                <p className={`font-medium ${darkMode ? 'text-zinc-100' : 'text-slate-900'}`}>{betConfirmation.question}</p>
              </div>
              <div className="flex justify-between">
                <span>Your Pick:</span>
                <span className="font-semibold text-orange-500">"{betConfirmation.option}"</span>
              </div>
              <div className={`flex justify-between pt-2 border-t ${darkMode ? 'border-zinc-700' : 'border-amber-200'}`}>
                <span className="font-semibold">Bet Amount:</span>
                <span className="font-bold text-red-500">-{formatCurrency(betConfirmation.amount)}</span>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setBetConfirmation(null)}
                className={`flex-1 py-2 rounded-sm font-semibold ${darkMode ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  handleBet(betConfirmation.predictionId, betConfirmation.option, betConfirmation.amount);
                  setBetConfirmation(null);
                }}
                className="flex-1 py-2 rounded-sm font-semibold text-white bg-orange-600 hover:bg-orange-700"
              >
                Place Bet
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
