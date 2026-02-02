import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  applyActionCode,
  signInWithCustomToken
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  increment,
  serverTimestamp,
  arrayUnion,
  deleteField,
  runTransaction,
  addDoc
} from 'firebase/firestore';
import { auth, googleProvider, twitterProvider, db, createUserFunction, deleteAccountFunction, validateTradeFunction, recordTradeFunction, tradeSpikeAlertFunction, achievementAlertFunction, leaderboardChangeAlertFunction, marginLiquidationAlertFunction, ipoClosingAlertFunction, bankruptcyAlertFunction, comebackAlertFunction } from './firebase';
import { CHARACTERS, CHARACTER_MAP } from './characters';
import { CREWS, CREW_MAP, SHOP_PINS, SHOP_PINS_LIST, DAILY_MISSIONS, WEEKLY_MISSIONS, PIN_SLOT_COSTS, CREW_DIVIDEND_RATE, getWeekId, getCrewWeeklyMissions } from './crews';
import AdminPanel from './AdminPanel';
import { containsProfanity, getProfanityMessage } from './utils/profanity';
import LadderGame from './components/LadderGame';
import LimitOrders from './components/LimitOrders';

// Import from new modular structure
import {
  ADMIN_UIDS,
  ITEMS_PER_PAGE,
  STARTING_CASH,
  DAILY_BONUS,
  PRICE_UPDATE_INTERVAL,
  HISTORY_RECORD_INTERVAL,
  IPO_HYPE_DURATION,
  IPO_WINDOW_DURATION,
  IPO_TOTAL_SHARES,
  IPO_MAX_PER_USER,
  IPO_PRICE_JUMP,
  BASE_IMPACT,
  BASE_LIQUIDITY,
  BID_ASK_SPREAD,
  MIN_PRICE,
  MAX_PRICE_CHANGE_PERCENT,
  SHORT_MARGIN_REQUIREMENT,
  SHORT_INTEREST_RATE,
  SHORT_MARGIN_CALL_THRESHOLD,
  SHORT_RATE_LIMIT_HOURS,
  MAX_SHORTS_BEFORE_COOLDOWN,
  MARGIN_CASH_MINIMUM,
  MARGIN_TIERS,
  MARGIN_INTEREST_RATE,
  MARGIN_WARNING_THRESHOLD,
  MARGIN_CALL_THRESHOLD,
  MARGIN_LIQUIDATION_THRESHOLD,
  MARGIN_CALL_GRACE_PERIOD,
  MARGIN_MAINTENANCE_RATIO,
  MAX_DAILY_IMPACT_PER_USER
} from './constants';
import { ACHIEVEMENTS } from './constants/achievements';
import {
  formatCurrency,
  formatChange,
  formatNumber,
  formatTimeRemaining,
  round2
} from './utils/formatters';
import { getTodayDateString, isToday, toMillis, toDateString } from './utils/date';

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
      cashBefore: details.cashBefore ?? userData.cash ?? 0,
      cashAfter: details.cashAfter ?? 0,
      portfolioBefore: details.portfolioBefore ?? userData.portfolioValue ?? 0,
      portfolioAfter: details.portfolioAfter ?? 0
    };

    // Remove any undefined values (Firestore doesn't support them)
    Object.keys(transaction).forEach(key => {
      if (transaction[key] === undefined) {
        delete transaction[key];
      }
    });

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
  const peakPortfolio = userData.peakPortfolioValue || 0;

  const requirements = [
    { met: totalCheckins >= 10, label: '10+ daily check-ins', current: totalCheckins, required: 10 },
    { met: totalTrades >= 35, label: '35+ total trades', current: totalTrades, required: 35 },
    { met: peakPortfolio >= 7500, label: '$7,500+ peak portfolio', current: peakPortfolio, required: 7500 }
  ];

  const allMet = requirements.every(r => r.met);

  return {
    eligible: allMet,
    requirements
  };
};

// Helper to get margin tier multiplier based on peak portfolio achievement
const getMarginTierMultiplier = (peakPortfolioValue) => {
  const peak = peakPortfolioValue || 0;
  if (peak >= 30000) return 0.75;
  if (peak >= 15000) return 0.50;
  if (peak >= 7500) return 0.35;
  return 0.25;
};

// Helper to get margin tier name for display
const getMarginTierName = (peakPortfolioValue) => {
  const peak = peakPortfolioValue || 0;
  if (peak >= 30000) return 'Platinum (0.75x)';
  if (peak >= 15000) return 'Gold (0.50x)';
  if (peak >= 7500) return 'Silver (0.35x)';
  return 'Bronze (0.25x)';
};

// Helper: Get current price from priceHistory (source of truth) or fall back to prices object
const getCurrentPrice = (ticker, priceHistory, prices) => {
  const history = priceHistory?.[ticker];
  if (history && history.length > 0) {
    return history[history.length - 1].price;
  }
  return prices?.[ticker] || CHARACTER_MAP[ticker]?.basePrice || 0;
};

// Calculate margin status for a user
const calculateMarginStatus = (userData, prices, priceHistory = {}) => {
  if (!userData || !userData.marginEnabled) {
    return {
      enabled: false,
      marginUsed: 0,
      availableMargin: 0,
      maxBorrowable: 0,
      tierMultiplier: 0,
      tierName: 'N/A',
      portfolioValue: 0,
      totalMaintenanceRequired: 0,
      equityRatio: 1,
      status: 'disabled'
    };
  }

  const cash = userData.cash || 0;
  const holdings = userData.holdings || {};
  const marginUsed = userData.marginUsed || 0;
  const peakPortfolio = userData.peakPortfolioValue || 0;

  // Get tier multiplier based on peak portfolio achievement
  const tierMultiplier = getMarginTierMultiplier(peakPortfolio);
  const tierName = getMarginTierName(peakPortfolio);

  // Calculate total holdings value and maintenance requirement
  let holdingsValue = 0;
  let totalMaintenanceRequired = 0;

  Object.entries(holdings).forEach(([ticker, shares]) => {
    if (shares > 0) {
      const price = getCurrentPrice(ticker, priceHistory, prices);
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

  // NEW: Cash-based borrowing with tiered multipliers
  const maxBorrowable = Math.max(0, cash * tierMultiplier);
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
    maxBorrowable: Math.round(maxBorrowable * 100) / 100,
    tierMultiplier,
    tierName,
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
const calculatePriceImpact = (currentPrice, shares, liquidity = BASE_LIQUIDITY, userDailyImpact = 0) => {
  // Square root model: impact = price * base_impact * sqrt(shares / liquidity)
  // This means: 4x the shares = 2x the impact (not 4x)
  let impact = currentPrice * BASE_IMPACT * Math.sqrt(shares / liquidity);

  // Cap the impact at MAX_PRICE_CHANGE_PERCENT per trade to prevent manipulation
  const maxImpact = currentPrice * MAX_PRICE_CHANGE_PERCENT;
  impact = Math.min(impact, maxImpact);

  // Anti-manipulation: Check daily impact limit per user per ticker
  const impactPercent = impact / currentPrice;
  const remainingAllowance = MAX_DAILY_IMPACT_PER_USER - userDailyImpact;

  if (remainingAllowance <= 0) {
    console.log(`[IMPACT LIMIT] User maxed out daily impact on this ticker (${(userDailyImpact * 100).toFixed(2)}%)`);
    return 0; // User maxed out, no impact allowed
  }

  if (impactPercent > remainingAllowance) {
    // Cap at remaining allowance
    console.log(`[IMPACT LIMIT] Capping impact from ${(impactPercent * 100).toFixed(2)}% to ${(remainingAllowance * 100).toFixed(2)}%`);
    return currentPrice * remainingAllowance;
  }

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
// SIMPLE LINE CHART COMPONENT
// (utilities are imported from ./utils)
// ============================================

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

// ============================================
// DETAILED CHART MODAL
// ============================================

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
  const visualData = useMemo(() => {
    if (currentData.length === 0) return [];

    const minPixelDistance = 2; // Reduced from 3 to preserve more detail
    const result = [currentData[0]]; // Always start with first point

    for (let i = 1; i < currentData.length; i++) {
      const current = currentData[i];
      const last = result[result.length - 1];

      // Calculate pixel positions
      const currentX = ((current.timestamp - currentData[0].timestamp) / (currentData[currentData.length - 1].timestamp - currentData[0].timestamp || 1)) * 500;
      const lastX = ((last.timestamp - currentData[0].timestamp) / (currentData[currentData.length - 1].timestamp - currentData[0].timestamp || 1)) * 500;

      const pixelDistance = Math.abs(currentX - lastX);

      // Check if this is a local min/max (peak or valley)
      const prev = currentData[i - 1];
      const next = currentData[i + 1];
      const isLocalPeak = next && (
        (current.price > prev.price && current.price > next.price) || // Local maximum
        (current.price < prev.price && current.price < next.price)    // Local minimum
      );

      // If far enough apart, include it
      if (pixelDistance >= minPixelDistance) {
        result.push(current);
      }
      // Always preserve local peaks/valleys to show rapid movements
      else if (isLocalPeak) {
        result.push(current);
      }
      // If this is the last point, always include it (replace the previous last if needed)
      else if (i === currentData.length - 1) {
        result[result.length - 1] = current;
      }
      // If points are close but this one has a more extreme price, replace the last one
      else if (Math.abs(current.price - last.price) > Math.abs(last.price - (result[result.length - 2]?.price || last.price))) {
        result[result.length - 1] = current;
      }
    }

    return result;
  }, [currentData]);

  const svgWidth = 600;
  const svgHeight = 300;
  const paddingX = 50;
  const paddingY = 30;
  const chartWidth = svgWidth - paddingX * 2;
  const chartHeight = svgHeight - paddingY * 2;

  // Position points by timestamp, not index (so sampling doesn't affect placement)
  const minTimestamp = currentData[0]?.timestamp || Date.now();
  const maxTimestamp = currentData[currentData.length - 1]?.timestamp || Date.now();
  const timeSpan = maxTimestamp - minTimestamp || 1;

  const getX = (timestamp) => paddingX + ((timestamp - minTimestamp) / timeSpan) * chartWidth;
  const getY = (price) => paddingY + chartHeight - ((price - minPrice) / priceRange) * chartHeight;

  const pathData = visualData.map((d, i) => {
    const x = getX(d.timestamp);
    const y = getY(d.price);
    return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');

  const areaPath = visualData.length > 0
    ? `${pathData} L ${getX(visualData[visualData.length - 1].timestamp)} ${paddingY + chartHeight} L ${paddingX} ${paddingY + chartHeight} Z`
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
    if (!chartRef.current) return;

    // Prevent page scrolling on mobile when interacting with chart
    if (e.touches) {
      e.preventDefault();
    }

    const rect = chartRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const mouseX = clientX - rect.left;
    const svgX = (mouseX / rect.width) * svgWidth;

    // Convert SVG X to timestamp
    const hoveredTimestamp = minTimestamp + ((svgX - paddingX) / chartWidth) * timeSpan;

    // Find nearest point in currentData (ALL points hoverable for smooth scrubbing)
    let nearestPoint = null;
    let minDistance = Infinity;

    currentData.forEach(point => {
      const distance = Math.abs(point.timestamp - hoveredTimestamp);
      if (distance < minDistance) {
        minDistance = distance;
        nearestPoint = point;
      }
    });

    if (nearestPoint) {
      const x = getX(nearestPoint.timestamp);
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

// Helper to get week identifier for persistence
const getWeekIdentifier = () => {
  return getWeekStart().toISOString().split('T')[0]; // e.g., "2026-01-22"
};

// Helper to get predictions identifier for detecting new predictions
const getPredictionsIdentifier = (predictions) => {
  if (!predictions || predictions.length === 0) return 'none';
  // Create a simple hash based on prediction IDs
  return predictions.map(p => p.id).sort().join(',');
};

// Helper to load collapsed state from localStorage
const loadCollapsedState = (key, weekOrPredictionsId) => {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return true; // Default to expanded
    const { collapsed, identifier } = JSON.parse(stored);
    // If the week/predictions have changed, reset to expanded
    return identifier === weekOrPredictionsId ? collapsed : true;
  } catch {
    return true; // Default to expanded on error
  }
};

// Helper to save collapsed state to localStorage
const saveCollapsedState = (key, collapsed, identifier) => {
  try {
    localStorage.setItem(key, JSON.stringify({ collapsed, identifier }));
  } catch {
    // Ignore localStorage errors
  }
};

const NewCharactersBoard = ({ prices, priceHistory, darkMode, colorBlindMode = false, launchedTickers = [] }) => {
  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';
  
  const weekStart = getWeekStart();
  
  // Find characters added this week
  const newCharacters = CHARACTERS.filter(char => {
    const addedDate = new Date(char.dateAdded);
    // Only show if added this week AND either not IPO-required or already launched
    const isNewThisWeek = addedDate >= weekStart;
    const isAvailable = !char.ipoRequired || launchedTickers.includes(char.ticker);
    return isNewThisWeek && isAvailable;
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
                <span className={`text-xs ml-1 ${colorBlindMode ? (change >= 0 ? 'text-teal-500' : 'text-purple-500') : (change >= 0 ? 'text-green-500' : 'text-red-500')}`}>
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

const PredictionCard = ({ prediction, userBet, onBet, darkMode, isGuest, onRequestBet, betLimit = 0, isAdmin = false, onHide, userData }) => {
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

  // Color blind mode support - teal instead of green, purple instead of red
  const colorBlindMode = userData?.colorBlindMode || false;
  const optionColors = [
    colorBlindMode
      ? { bg: 'bg-teal-600', border: 'border-teal-600', text: 'text-teal-500', fill: 'bg-teal-500' }
      : { bg: 'bg-green-600', border: 'border-green-600', text: 'text-green-500', fill: 'bg-green-500' },
    colorBlindMode
      ? { bg: 'bg-purple-600', border: 'border-purple-600', text: 'text-purple-500', fill: 'bg-purple-500' }
      : { bg: 'bg-red-600', border: 'border-red-600', text: 'text-red-500', fill: 'bg-red-500' },
    { bg: 'bg-blue-600', border: 'border-blue-600', text: 'text-blue-500', fill: 'bg-blue-500' },
    { bg: 'bg-amber-600', border: 'border-amber-600', text: 'text-amber-500', fill: 'bg-amber-500' },
    { bg: 'bg-cyan-600', border: 'border-cyan-600', text: 'text-cyan-500', fill: 'bg-cyan-500' },
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
            {prediction.reopened && isActive && (
              <span className="text-xs font-semibold uppercase text-blue-500">⏰ Extended</span>
            )}
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
          {isActive && !prediction.resolved && (() => {
            // Calculate current potential payout
            const myPool = pools[userBet.option] || 0;
            const potentialPayout = myPool > 0 ? (userBet.amount / myPool) * totalPool : userBet.amount;
            return (
              <div className={`text-xs mt-1 ${mutedClass}`}>
                Current potential: <span className="text-orange-500 font-semibold">{formatCurrency(potentialPayout)}</span>
              </div>
            );
          })()}
          {prediction.resolved && (
            <div className={`text-xs mt-1 ${userBet.option === prediction.outcome ? 'text-green-500' : 'text-red-500'}`}>
              {userBet.option === prediction.outcome ? `🎉 Won ${formatCurrency(userBet.payout || 0)}!` : '❌ Lost'}
            </div>
          )}
        </div>
      )}

      {isActive && !isGuest && (
        <>
          {hasExistingBet && !prediction.allowAdditionalBets ? (
            <div className={`text-center py-2 text-sm ${mutedClass} bg-zinc-800/50 rounded-sm`}>
              🔒 You've already placed a bet on this prediction
            </div>
          ) : !showBetUI ? (
            <button onClick={() => {
              setShowBetUI(true);
              // Pre-select their existing option if they're adding to bet
              if (hasExistingBet && prediction.allowAdditionalBets) {
                setSelectedOption(userBet.option);
              }
            }}
              className="w-full py-2 text-sm font-semibold uppercase bg-orange-600 hover:bg-orange-700 text-white rounded-sm">
              {hasExistingBet && prediction.allowAdditionalBets ? 'Add to Bet' : 'Place Bet'}
            </button>
          ) : (
            <div className="space-y-3">
              {hasExistingBet && prediction.allowAdditionalBets && (
                <div className={`text-xs ${mutedClass} bg-blue-500/10 border border-blue-500 rounded-sm p-2`}>
                  💡 You can add more to your existing bet on "<span className="text-blue-500 font-semibold">{userBet.option}</span>" (cannot change or remove)
                </div>
              )}
              <div className={`grid gap-2 ${options.length <= 2 ? 'grid-cols-2' : 'grid-cols-2'}`}>
                {options.map((option, idx) => {
                  const colors = optionColors[idx % optionColors.length];
                  const isLocked = hasExistingBet && prediction.allowAdditionalBets && option !== userBet.option;
                  return (
                    <button
                      key={option}
                      onClick={() => !isLocked && setSelectedOption(option)}
                      disabled={isLocked}
                      className={`py-2 px-2 text-sm font-semibold rounded-sm border-2 transition-all truncate ${
                        isLocked
                          ? 'opacity-30 cursor-not-allowed border-zinc-700 text-zinc-500'
                          : selectedOption === option
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
                <input
                  type="number"
                  value={betAmount || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '') {
                      setBetAmount(0);
                    } else {
                      const num = parseInt(val);
                      if (!isNaN(num) && num >= 0) {
                        setBetAmount(Math.min(num, betLimit || Infinity));
                      }
                    }
                  }}
                  onFocus={(e) => {
                    if (betAmount === 0) e.target.select();
                  }}
                  className={`w-full mt-2 px-3 py-2 text-sm rounded-sm border ${darkMode ? 'bg-zinc-950 border-zinc-700 text-zinc-100' : 'bg-white border-amber-200'}`}
                  placeholder="Custom amount..."
                />
                {betLimit > 0 && (
                  <div className={`text-xs ${mutedClass} mt-1`}>
                    Your bet limit: <span className="text-orange-500 font-semibold">{formatCurrency(betLimit)}</span>
                    <span className="opacity-70"> (based on market investment)</span>
                  </div>
                )}
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
                  {hasExistingBet && prediction.allowAdditionalBets ? 'Add to Bet' : 'Confirm'}
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

      {isAdmin && prediction.resolved && onHide && (
        <button
          onClick={() => onHide(prediction.id)}
          className={`w-full mt-2 py-1 text-xs rounded-sm ${darkMode ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700' : 'bg-slate-200 text-zinc-600 hover:bg-slate-300'}`}
        >
          Hide from feed
        </button>
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

const PortfolioModal = ({ holdings, shorts, prices, portfolioHistory, currentValue, onClose, onTrade, darkMode, costBasis, priceHistory, colorBlindMode = false, user }) => {
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
        const currentPrice = prices[ticker] || character?.basePrice || position.entryPrice;
        const entryPrice = position.entryPrice;
        const shares = position.shares;
        const margin = position.margin || 0;

        // P/L calculation: profit when price goes down
        const profitPerShare = entryPrice - currentPrice;
        const totalPL = profitPerShare * shares;
        const totalPLPercent = entryPrice > 0 ? (profitPerShare / entryPrice) * 100 : 0;

        // Current equity in the position
        const equity = margin + totalPL;
        const equityRatio = currentPrice > 0 ? equity / (currentPrice * shares) : 1;

        // Position value (margin + unrealized P/L)
        const positionValue = equity;

        return {
          ticker,
          character,
          shares,
          entryPrice,
          currentPrice,
          margin,
          totalPL,
          totalPLPercent,
          equity,
          equityRatio,
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
      alert(`Failed to cancel order: ${error.message}`);
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
                      const isClose = Math.abs(currentPrice - order.limitPrice) / order.limitPrice < 0.05;

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

// ============================================
// LEADERBOARD MODAL
// ============================================

const LeaderboardModal = ({ onClose, darkMode, currentUserCrew, currentUser, currentUserData }) => {
  const [leaders, setLeaders] = useState([]);
  const [crewLeaders, setCrewLeaders] = useState([]); // Separate state for crew-specific leaderboard
  const [loading, setLoading] = useState(true);
  const [crewFilter, setCrewFilter] = useState('ALL'); // 'ALL' or crew ID
  const [userRank, setUserRank] = useState(null); // User's actual rank in current view
  const scrollContainerRef = useRef(null);
  const userRowRef = useRef(null);
  const stickyHeaderRef = useRef(null);
  const stickyFooterRef = useRef(null);

  // Fetch main top 50 leaderboard
  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const q = query(
          collection(db, 'users'),
          orderBy('portfolioValue', 'desc'),
          limit(100) // Fetch extra to account for bots
        );
        const snapshot = await getDocs(q);
        const leaderData = snapshot.docs
          .map(doc => ({ ...doc.data(), id: doc.id }))
          .filter(user => !user.isBot) // Filter out bots
          .slice(0, 50) // Limit to top 50 real users
          .map((user, index) => ({
            rank: index + 1,
            ...user
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
          .filter(user => user.crew === crewFilter && !user.isBot) // Filter out bots
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

  // Calculate user's rank when leaderboard data changes
  useEffect(() => {
    if (!currentUser || !currentUserData) {
      setUserRank(null);
      return;
    }

    const fetchUserRank = async () => {
      try {
        if (crewFilter === 'ALL') {
          // Count users with higher portfolio value (excluding bots)
          const q = query(
            collection(db, 'users'),
            orderBy('portfolioValue', 'desc')
          );
          const snapshot = await getDocs(q);
          const allUsers = snapshot.docs
            .map(doc => ({ id: doc.id, portfolioValue: doc.data().portfolioValue, isBot: doc.data().isBot }))
            .filter(u => !u.isBot); // Filter out bots
          const rank = allUsers.findIndex(u => u.id === currentUser.uid) + 1;
          setUserRank(rank || null);
        } else {
          // Crew leaderboard rank
          const userInCrew = crewLeaders.findIndex(u => u.id === currentUser.uid);
          setUserRank(userInCrew >= 0 ? userInCrew + 1 : null);
        }
      } catch (err) {
        console.error('Failed to fetch user rank:', err);
      }
    };

    fetchUserRank();
  }, [currentUser, currentUserData, crewFilter, leaders, crewLeaders]);

  // Track user row position via direct DOM manipulation (no state updates = no re-renders)
  useEffect(() => {
    const container = scrollContainerRef.current;
    const userRow = userRowRef.current;
    const header = stickyHeaderRef.current;
    const footer = stickyFooterRef.current;

    if (!container || !userRow || !header || !footer) return;

    // Use Intersection Observer to directly update DOM visibility
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          // User row is visible - hide both sticky elements
          header.style.display = 'none';
          footer.style.display = 'none';
        } else {
          // User row is not visible - determine position
          const rowRect = entry.boundingClientRect;
          const containerRect = entry.rootBounds;

          if (rowRect.bottom < containerRect.top) {
            // Row is above viewport - show header, hide footer
            header.style.display = 'flex';
            footer.style.display = 'none';
          } else {
            // Row is below viewport - show footer, hide header
            header.style.display = 'none';
            footer.style.display = 'flex';
          }
        }
      },
      {
        root: container,
        threshold: [0, 0.1]
      }
    );

    observer.observe(userRow);

    return () => {
      observer.disconnect();
    };
  }, [filteredLeaders, currentUser]);

  // Get user's crew color
  const userCrewColor = currentUserData?.crew ? CREW_MAP[currentUserData.crew]?.color : '#6b7280';

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

        <div className="flex-1 overflow-y-auto relative" ref={scrollContainerRef}>
          {/* Sticky Header - visibility controlled by IO via ref */}
          {currentUser && userRank && (
            <div
              ref={stickyHeaderRef}
              className="sticky top-0 z-10 px-4 py-2 flex justify-between items-center border-b"
              style={{
                display: 'none',
                backgroundColor: darkMode ? '#18181b' : '#ffffff',
                borderColor: userCrewColor,
                boxShadow: `0 2px 8px ${userCrewColor}40`,
                willChange: 'transform',
                transform: 'translateZ(0)'
              }}
            >
              <div className={`text-sm font-semibold ${textClass}`}>
                <span style={{ color: userCrewColor }}>#{userRank}</span> {currentUserData?.displayName}
              </div>
              <div className={`text-sm font-bold ${textClass}`}>
                {formatCurrency(currentUserData?.portfolioValue || 0)}
              </div>
            </div>
          )}

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
                const isCurrentUser = currentUser && leader.id === currentUser.uid;

                return (
                  <div
                    key={leader.id}
                    ref={isCurrentUser ? userRowRef : null}
                    className={`p-3 flex items-center gap-3 ${
                      displayRank <= 3 ? (darkMode ? 'bg-zinc-900/50' : 'bg-amber-50') : ''
                    } ${
                      isCurrentUser ? 'border-l-4' : ''
                    }`}
                    style={isCurrentUser ? {
                      borderLeftColor: userCrewColor,
                      backgroundColor: darkMode ? `${userCrewColor}20` : `${userCrewColor}15`,
                      boxShadow: `inset 0 0 12px ${userCrewColor}30`,
                      willChange: 'auto',
                      contain: 'layout style paint'
                    } : {}}
                  >
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

          {/* Sticky Footer - visibility controlled by IO via ref */}
          {currentUser && userRank && !loading && (
            <div
              ref={stickyFooterRef}
              className="sticky bottom-0 z-10 px-4 py-3 flex justify-between items-center border-t"
              style={{
                display: 'flex',
                backgroundColor: darkMode ? '#18181b' : '#ffffff',
                borderColor: userCrewColor,
                boxShadow: `0 -2px 12px ${userCrewColor}40`,
                willChange: 'transform',
                transform: 'translateZ(0)'
              }}
            >
              <div className={`text-sm font-semibold ${textClass}`}>
                <span style={{ color: userCrewColor }}>Your Rank: #{userRank}</span>
                <span className={`ml-2 ${mutedClass}`}>• {currentUserData?.displayName}</span>
              </div>
              <div className={`text-sm font-bold ${textClass}`}>
                {formatCurrency(currentUserData?.portfolioValue || 0)}
              </div>
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

const AboutModal = ({ onClose, darkMode, userData }) => {
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
                  <span className={`font-semibold ${userData?.colorBlindMode ? 'text-teal-500' : 'text-green-500'}`}>Absolutely not.</span> Stockism uses entirely fictional currency. 
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

              <div>
                <h3 className="font-semibold text-orange-500 mb-2">Join the Community</h3>
                <div className="flex gap-3">
                  <a
                    href="https://discord.gg/yxw94uNrYv"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`flex items-center gap-2 px-3 py-2 rounded ${darkMode ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-indigo-500 hover:bg-indigo-600'} text-white text-sm font-medium`}
                  >
                    Discord
                  </a>
                  <a
                    href="https://reddit.com/r/stockismapp"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`flex items-center gap-2 px-3 py-2 rounded ${darkMode ? 'bg-orange-600 hover:bg-orange-500' : 'bg-orange-500 hover:bg-orange-600'} text-white text-sm font-medium`}
                  >
                    Reddit
                  </a>
                </div>
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
                  Report issues or suggest features on <a href="https://github.com/ultimybeloved/stockism" target="_blank" rel="noopener noreferrer" className="text-orange-500 hover:text-orange-400 underline">GitHub</a>. We're always looking to improve!
                </p>
              </div>
            </div>
          )}

          {/* PRIVACY TAB */}
          {activeTab === 'privacy' && (
            <div className={`space-y-4 ${textClass}`}>
              <div className={`p-3 rounded-sm ${userData?.colorBlindMode ? (darkMode ? 'bg-teal-900/30 border border-teal-700' : 'bg-teal-50 border border-teal-200') : (darkMode ? 'bg-green-900/30 border border-green-700' : 'bg-green-50 border border-green-200')}`}>
                <p className={`font-semibold text-sm ${userData?.colorBlindMode ? 'text-teal-500' : 'text-green-500'}`}>
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
                  <li>• <span className={userData?.colorBlindMode ? 'text-purple-400' : 'text-red-400'}>❌ Your real name</span> — We never save your Google display name</li>
                  <li>• <span className={userData?.colorBlindMode ? 'text-purple-400' : 'text-red-400'}>❌ Your profile picture</span> — We never save your Google photo</li>
                  <li>• <span className={userData?.colorBlindMode ? 'text-purple-400' : 'text-red-400'}>❌ Your password</span> — Google handles authentication securely</li>
                  <li>• <span className={userData?.colorBlindMode ? 'text-purple-400' : 'text-red-400'}>❌ Your contacts or Google data</span> — We have no access</li>
                  <li>• <span className={userData?.colorBlindMode ? 'text-purple-400' : 'text-red-400'}>❌ Tracking cookies or analytics</span> — We don't use any</li>
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
                  You can delete your account and all associated data anytime from your Profile (click your username → scroll to bottom → Delete Account).
                </p>
              </div>

              <div className={`mt-4 p-3 rounded-sm ${darkMode ? 'bg-zinc-800/50' : 'bg-amber-50'}`}>
                <p className={`text-xs ${mutedClass}`}>
                  Last updated: January 2026. This is a fan project with no legal entity behind it.
                  If you have privacy concerns, please reach out to us directly.
                </p>
                <p className={`text-xs ${mutedClass} mt-2`}>
                  <a href="/terms.html" target="_blank" rel="noopener noreferrer" className={linkClass}>
                    View Terms of Service →
                  </a>
                  {' • '}
                  <a href="/privacy.html" target="_blank" rel="noopener noreferrer" className={linkClass}>
                    View Privacy Policy →
                  </a>
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
  
  // Crew pin - shown if user has a crew and displayCrewPin is not false
  if (userData.crew) {
    const crew = CREW_MAP[userData.crew];
    if (crew) {
      const shouldShowCrewPin = userData.displayCrewPin !== false;
      if (shouldShowCrewPin) {
        pins.push(
          <span key="crew" title={crew.name} className={`inline-flex items-center ${sizeClass}`}>
            {crew.icon ? (
              <img src={crew.icon} alt={crew.name} className={`${imgSize} object-contain`} />
            ) : crew.emblem}
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
        <span key={`shop-${idx}`} title={pin.name} className={`inline-flex items-center ${sizeClass}`}>
          {pin.image ? (
            <img src={`/pins/${pin.image}`} alt={pin.name} className={`${imgSize} object-contain`} />
          ) : pin.emoji}
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

const CrewSelectionModal = ({ onClose, onSelect, onLeave, darkMode, userData, isGuest }) => {
  const [selectedCrew, setSelectedCrew] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [leavingCrew, setLeavingCrew] = useState(false);
  
  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';
  
  const currentCrew = userData?.crew;
  const portfolioValue = userData?.portfolioValue || 0;
  const penaltyAmount = Math.floor(portfolioValue * 0.15);
  
  const handleSelect = (crewId) => {
    if (isGuest) return; // Guests can't select
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
            <h2 className={`text-lg font-semibold ${textClass}`}>🏴 {isGuest ? 'Crews' : 'Crew'}</h2>
            <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-600 text-xl`}>×</button>
          </div>
          {isGuest && (
            <p className={`text-sm text-amber-500 mt-1`}>
              Sign in to join a crew!
            </p>
          )}
          {!isGuest && currentCrew && (
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
          {!isGuest && !currentCrew && (
            <p className={`text-sm ${mutedClass} mt-1`}>
              Join a crew to unlock daily missions and crew dividends!
            </p>
          )}
        </div>

        {/* Warning Banner - show for users without a crew AND users with a crew */}
        {!isGuest && !confirming && !leavingCrew && (
          <div className={`p-3 ${darkMode ? 'bg-amber-900/30' : 'bg-amber-100'} border-b border-amber-500/30`}>
            <p className="text-amber-400 text-sm text-center">
              ⚠️ <strong>Warning:</strong> Leaving a crew costs <strong>15% of your entire portfolio</strong>
              <br />
              <span className={`text-xs ${mutedClass}`}>15% of your cash and shares will be taken if you ever leave.</span>
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
                15% of your cash and shares will be taken.
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
                  15% of your cash and shares will be taken.
                </p>
              </div>
            ) : (
              <div className="mb-4">
                <p className={`text-sm text-orange-500 mb-3`}>
                  ✓ Joining a crew is free!
                </p>
                <div className={`p-3 rounded-sm ${darkMode ? 'bg-amber-900/20' : 'bg-amber-50'} border border-amber-500/30`}>
                  <p className="text-amber-400 text-sm">
                    ⚠️ <strong>Note:</strong> If you ever leave this crew, you'll lose <strong>15% of your portfolio</strong>.
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
            <div>
              {SHOP_PINS_LIST.length === 0 ? (
                <div className={`text-center py-12 ${mutedClass}`}>
                  <div className="text-4xl mb-4">🏗️</div>
                  <div className={`font-semibold ${textClass} mb-2`}>Coming Soon!</div>
                  <div className="text-sm">Custom pins will be available here soon.</div>
                </div>
              ) : (
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
                        <div className="text-2xl text-center mb-2 flex items-center justify-center h-8">
                          {pin.image ? (
                            <img src={`/pins/${pin.image}`} alt={pin.name} className="w-8 h-8 object-contain" />
                          ) : pin.emoji}
                        </div>
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
                          <span className="mr-1 inline-flex items-center">
                            {pin.image ? (
                              <img src={`/pins/${pin.image}`} alt={pin.name} className="w-5 h-5 object-contain" />
                            ) : pin.emoji}
                          </span>
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
// MISSIONS MODAL (Daily + Weekly)
// ============================================

const DailyMissionsModal = ({ onClose, darkMode, userData, prices, onClaimReward, onClaimWeeklyReward, portfolioValue, isGuest }) => {
  const [activeTab, setActiveTab] = useState('daily');

  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';

  const today = getTodayDateString();
  const weekId = getWeekId();
  const dailyProgress = userData?.dailyMissions?.[today] || {};
  const weeklyProgress = userData?.weeklyMissions?.[weekId] || {};
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

  // ============================================
  // WEEKLY MISSIONS
  // ============================================

  // Get this crew's 2 weekly missions
  const thisWeeksMissions = userCrew ? getCrewWeeklyMissions(userCrew, weekId) : [];

  // Helper to get all crew tickers a character belongs to (for weekly too)
  const getCharacterCrewsForWeekly = (ticker) => {
    const crews = [];
    Object.values(CREWS).forEach(crew => {
      if (crew.members.includes(ticker)) {
        crews.push(crew.id);
      }
    });
    return crews;
  };

  // Calculate weekly mission progress
  const getWeeklyMissionProgress = (mission) => {
    const holdings = userData?.holdings || {};
    const wp = weeklyProgress; // shorthand

    switch (mission.checkType) {
      // ============================================
      // TRADING VOLUME
      // ============================================
      case 'WEEKLY_TRADE_VALUE': {
        const value = wp.tradeValue || 0;
        return {
          complete: value >= mission.requirement,
          progress: Math.floor(value),
          target: mission.requirement
        };
      }
      case 'WEEKLY_TRADE_VOLUME': {
        const volume = wp.tradeVolume || 0;
        return {
          complete: volume >= mission.requirement,
          progress: volume,
          target: mission.requirement
        };
      }
      case 'WEEKLY_TRADE_COUNT': {
        const count = wp.tradeCount || 0;
        return {
          complete: count >= mission.requirement,
          progress: count,
          target: mission.requirement
        };
      }

      // ============================================
      // CONSISTENCY
      // ============================================
      case 'WEEKLY_TRADING_DAYS': {
        const days = Object.keys(wp.tradingDays || {}).length;
        return {
          complete: days >= mission.requirement,
          progress: days,
          target: mission.requirement
        };
      }
      case 'WEEKLY_CHECKIN_STREAK': {
        const days = Object.keys(wp.checkinDays || {}).length;
        return {
          complete: days >= mission.requirement,
          progress: days,
          target: mission.requirement
        };
      }

      // ============================================
      // CREW LOYALTY
      // ============================================
      case 'WEEKLY_CREW_PERCENT': {
        // Calculate % of portfolio in crew members by value
        let totalValue = 0;
        let crewValue = 0;
        Object.entries(holdings).forEach(([ticker, shares]) => {
          if (shares > 0) {
            const price = prices[ticker] || 0;
            const value = shares * price;
            totalValue += value;
            if (crewMembers.includes(ticker)) {
              crewValue += value;
            }
          }
        });
        const percent = totalValue > 0 ? (crewValue / totalValue) * 100 : 0;
        return {
          complete: percent >= mission.requirement,
          progress: Math.floor(percent),
          target: mission.requirement
        };
      }
      case 'WEEKLY_CREW_SHARES': {
        const totalCrewShares = crewMembers.reduce((sum, ticker) => sum + (holdings[ticker] || 0), 0);
        return {
          complete: totalCrewShares >= mission.requirement,
          progress: totalCrewShares,
          target: mission.requirement
        };
      }
      case 'WEEKLY_FULL_CREW': {
        // Own 5+ shares of EVERY crew member
        const qualifyingMembers = crewMembers.filter(ticker => (holdings[ticker] || 0) >= mission.requirement).length;
        const totalMembers = crewMembers.length;
        return {
          complete: qualifyingMembers >= totalMembers && totalMembers > 0,
          progress: qualifyingMembers,
          target: totalMembers
        };
      }

      // ============================================
      // PORTFOLIO
      // ============================================
      case 'WEEKLY_CREW_DIVERSITY': {
        // Own shares in 5+ different crews
        const crewsOwned = new Set();
        Object.entries(holdings).forEach(([ticker, shares]) => {
          if (shares > 0) {
            getCharacterCrewsForWeekly(ticker).forEach(crewId => crewsOwned.add(crewId));
          }
        });
        return {
          complete: crewsOwned.size >= mission.requirement,
          progress: crewsOwned.size,
          target: mission.requirement
        };
      }
      case 'WEEKLY_PORTFOLIO_GROWTH': {
        const startValue = wp.startPortfolioValue || portfolioValue;
        const growth = portfolioValue - startValue;
        return {
          complete: growth >= mission.requirement,
          progress: Math.max(0, Math.floor(growth)),
          target: mission.requirement
        };
      }

      default:
        return { complete: false, progress: 0, target: 1 };
    }
  };

  const weeklyMissions = thisWeeksMissions.map(mission => ({
    ...mission,
    ...getWeeklyMissionProgress(mission),
    claimed: weeklyProgress.claimed?.[mission.id] || false
  }));

  const weeklyTotalRewards = weeklyMissions.reduce((sum, m) => sum + m.reward, 0);
  const weeklyEarnedRewards = weeklyMissions.filter(m => m.complete && m.claimed).reduce((sum, m) => sum + m.reward, 0);
  const weeklyClaimableRewards = weeklyMissions.filter(m => m.complete && !m.claimed).reduce((sum, m) => sum + m.reward, 0);

  // Days until week resets (next Monday)
  const getDaysUntilReset = () => {
    const now = new Date();
    const day = now.getDay();
    const daysUntilMonday = day === 0 ? 1 : (8 - day);
    return daysUntilMonday;
  };

  // Check if user has no crew
  const noCrew = !userCrew;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className={`w-full max-w-md ${cardClass} border rounded-sm shadow-xl overflow-hidden`}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className={`p-4 border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
          <div className="flex justify-between items-center">
            <h2 className={`text-lg font-semibold ${textClass}`}>📋 Missions</h2>
            <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-600 text-xl`}>×</button>
          </div>
        </div>

        {/* Tabs */}
        <div className={`grid grid-cols-2 border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
          <button
            onClick={() => setActiveTab('daily')}
            className={`py-2.5 text-sm font-semibold transition-colors ${
              activeTab === 'daily'
                ? 'text-orange-500 border-b-2 border-orange-500 bg-orange-500/10'
                : `${mutedClass} hover:bg-slate-500/10`
            }`}
          >
            Daily {claimableRewards > 0 && <span className={`ml-1 ${userData?.colorBlindMode ? 'text-teal-500' : 'text-green-500'}`}>●</span>}
          </button>
          <button
            onClick={() => setActiveTab('weekly')}
            className={`py-2.5 text-sm font-semibold transition-colors ${
              activeTab === 'weekly'
                ? 'text-purple-500 border-b-2 border-purple-500 bg-purple-500/10'
                : `${mutedClass} hover:bg-slate-500/10`
            }`}
          >
            Weekly {weeklyClaimableRewards > 0 && <span className={`ml-1 ${userData?.colorBlindMode ? 'text-teal-500' : 'text-green-500'}`}>●</span>}
          </button>
        </div>

        {/* Subheader */}
        {!isGuest && !noCrew && (
          <div className={`px-4 py-2 ${darkMode ? 'bg-zinc-800/50' : 'bg-amber-50'}`}>
            {activeTab === 'daily' ? (
              <p className={`text-xs ${mutedClass}`}>
                Resets daily • Earned: <span className="text-orange-500">{formatCurrency(earnedRewards)}</span> / {formatCurrency(totalRewards)}
              </p>
            ) : (
              <p className={`text-xs ${mutedClass}`}>
                Resets Monday • {getDaysUntilReset()} days left • Earned: <span className="text-purple-500">{formatCurrency(weeklyEarnedRewards)}</span> / {formatCurrency(weeklyTotalRewards)}
              </p>
            )}
          </div>
        )}

        <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
          {isGuest ? (
            <div className={`p-4 rounded-sm ${darkMode ? 'bg-zinc-800/50' : 'bg-amber-50'} text-center`}>
              <p className={`text-amber-500 mb-2`}>Sign in to access missions!</p>
              <p className={`text-xs ${mutedClass}`}>Complete missions to earn bonus cash rewards.</p>
            </div>
          ) : noCrew ? (
            <div className={`p-4 rounded-sm ${darkMode ? 'bg-zinc-800/50' : 'bg-amber-50'} text-center`}>
              <p className={`${mutedClass} mb-2`}>Join a crew to unlock missions!</p>
              <p className={`text-xs ${mutedClass}`}>Crew missions give you bonus cash rewards.</p>
            </div>
          ) : activeTab === 'daily' ? (
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
          ) : (
            /* WEEKLY MISSIONS TAB */
            <>
              {weeklyMissions.length === 0 ? (
                <div className={`p-4 rounded-sm ${darkMode ? 'bg-zinc-800/50' : 'bg-purple-50'} text-center`}>
                  <p className={`${mutedClass}`}>No weekly missions available</p>
                </div>
              ) : (
                weeklyMissions.map(mission => (
                  <div
                    key={mission.id}
                    className={`p-3 rounded-sm border ${
                      mission.claimed
                        ? 'border-purple-500/30 bg-purple-500/5'
                        : mission.complete
                          ? 'border-purple-500 bg-purple-500/10'
                          : darkMode ? 'border-zinc-700' : 'border-amber-200'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <h3 className={`font-semibold ${textClass}`}>{mission.name}</h3>
                        <p className={`text-xs ${mutedClass}`}>{mission.description}</p>
                      </div>
                      <span className={`text-sm font-bold ${mission.complete ? 'text-purple-500' : mutedClass}`}>
                        +{formatCurrency(mission.reward)}
                      </span>
                    </div>

                    {/* Progress bar */}
                    <div className="flex items-center gap-2">
                      <div className={`flex-1 h-2 rounded-full ${darkMode ? 'bg-zinc-800' : 'bg-slate-200'}`}>
                        <div
                          className={`h-full rounded-full transition-all ${mission.complete ? 'bg-purple-500' : 'bg-purple-400'}`}
                          style={{ width: `${Math.min(100, (mission.progress / mission.target) * 100)}%` }}
                        />
                      </div>
                      <span className={`text-xs ${mutedClass} w-16 text-right`}>
                        {mission.progress >= 1000 ? `${(mission.progress/1000).toFixed(1)}k` : mission.progress}/{mission.target >= 1000 ? `${(mission.target/1000).toFixed(0)}k` : mission.target}
                      </span>
                    </div>

                    {/* Claim button */}
                    {mission.complete && !mission.claimed && (
                      <button
                        onClick={() => onClaimWeeklyReward(mission.id, mission.reward)}
                        className="w-full mt-2 py-1.5 text-sm font-semibold rounded-sm bg-purple-600 hover:bg-purple-700 text-white"
                      >
                        Claim Reward
                      </button>
                    )}
                    {mission.claimed && (
                      <p className="text-xs text-purple-500 mt-2 text-center">✓ Claimed</p>
                    )}
                  </div>
                ))
              )}

              {/* Crew member hint */}
              <div className={`p-2 rounded-sm ${darkMode ? 'bg-zinc-800/30' : 'bg-purple-50'}`}>
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

const ProfileModal = ({ onClose, darkMode, userData, predictions, onOpenCrewSelection, user, onDeleteAccount, prices, holdings, shorts, costBasis }) => {
  const [showCrewSection, setShowCrewSection] = useState(false);
  const [deleteStep, setDeleteStep] = useState(0); // 0=hidden, 1=info, 2=confirm1, 3=confirm2, 4=confirm3, 5=final
  const [deleting, setDeleting] = useState(false);
  const [confirmUsername, setConfirmUsername] = useState('');
  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';
  
  const bets = userData?.bets || {};
  const predictionWins = userData?.predictionWins || 0;
  const userCrew = userData?.crew;
  const crewData = userCrew ? CREW_MAP[userCrew] : null;

  // Calculate trading stats
  const joinDate = userData?.createdAt?.toDate?.() || null;
  const peakPortfolio = userData?.peakPortfolioValue || 1000;

  // Find biggest holding by value
  let biggestHolding = null;
  let biggestValue = 0;
  Object.entries(holdings).forEach(([ticker, shares]) => {
    if (shares > 0) {
      const currentPrice = prices[ticker] || 0;
      const value = shares * currentPrice;
      if (value > biggestValue) {
        biggestValue = value;
        biggestHolding = { ticker, shares, value };
      }
    }
  });

  // Find best and worst performing stocks (by % return)
  let bestStock = null;
  let worstStock = null;
  let bestReturn = -Infinity;
  let worstReturn = Infinity;

  Object.entries(holdings).forEach(([ticker, shares]) => {
    if (shares > 0) {
      const currentPrice = prices[ticker] || 0;
      const avgCost = costBasis[ticker] || currentPrice;
      const returnPercent = avgCost > 0 ? ((currentPrice - avgCost) / avgCost) * 100 : 0;

      if (returnPercent > bestReturn) {
        bestReturn = returnPercent;
        bestStock = { ticker, returnPercent, currentPrice, avgCost, shares };
      }
      if (returnPercent < worstReturn) {
        worstReturn = returnPercent;
        worstStock = { ticker, returnPercent, currentPrice, avgCost, shares };
      }
    }
  });

  // Find most shares held
  let mostShares = null;
  let maxShares = 0;
  Object.entries(holdings).forEach(([ticker, shares]) => {
    if (shares > maxShares) {
      maxShares = shares;
      mostShares = { ticker, shares };
    }
  });
  
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
                  <button
                    onClick={() => { onClose(); onOpenCrewSelection(); }}
                    className={`w-full py-2 text-sm font-semibold rounded-sm ${darkMode ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'}`}
                  >
                    Switch Crew (15% penalty)
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

          {/* Trading Stats */}
          <div className={`p-4 rounded-sm border ${darkMode ? 'bg-zinc-800/50 border-zinc-700' : 'bg-amber-50 border-amber-200'}`}>
            <h3 className={`font-semibold ${textClass} mb-3`}>📊 Trading Stats</h3>
            <div className="space-y-2 text-sm">
              {joinDate && (
                <div className="flex justify-between">
                  <span className={mutedClass}>Joined:</span>
                  <span className={textClass}>{joinDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className={mutedClass}>Peak Portfolio:</span>
                <span className={`font-semibold ${textClass}`}>{formatCurrency(peakPortfolio)}</span>
              </div>
              {biggestHolding && (
                <div className="flex justify-between">
                  <span className={mutedClass}>Biggest Holding:</span>
                  <span className={`font-semibold ${textClass}`}>
                    ${biggestHolding.ticker} ({biggestHolding.shares} shares, {formatCurrency(biggestValue)})
                  </span>
                </div>
              )}
              {mostShares && mostShares.shares > 0 && (
                <div className="flex justify-between">
                  <span className={mutedClass}>Most Shares:</span>
                  <span className={`font-semibold ${textClass}`}>
                    ${mostShares.ticker} ({mostShares.shares} shares)
                  </span>
                </div>
              )}
              {bestStock && bestStock.returnPercent !== 0 && (
                <div className="flex justify-between">
                  <span className={mutedClass}>Best Performer:</span>
                  <span className={`font-semibold ${bestStock.returnPercent >= 0 ? (userData?.colorBlindMode ? 'text-teal-500' : 'text-green-500') : (userData?.colorBlindMode ? 'text-purple-500' : 'text-red-500')}`}>
                    ${bestStock.ticker} ({bestStock.returnPercent >= 0 ? '+' : ''}{bestStock.returnPercent.toFixed(1)}%)
                  </span>
                </div>
              )}
              {worstStock && worstStock.returnPercent !== 0 && worstStock.ticker !== bestStock?.ticker && (
                <div className="flex justify-between">
                  <span className={mutedClass}>Worst Performer:</span>
                  <span className={`font-semibold ${worstStock.returnPercent >= 0 ? (userData?.colorBlindMode ? 'text-teal-500' : 'text-green-500') : (userData?.colorBlindMode ? 'text-purple-500' : 'text-red-500')}`}>
                    ${worstStock.ticker} ({worstStock.returnPercent >= 0 ? '+' : ''}{worstStock.returnPercent.toFixed(1)}%)
                  </span>
                </div>
              )}
              {Object.keys(holdings).length === 0 && Object.keys(shorts || {}).length === 0 && (
                <p className={`text-xs ${mutedClass} text-center py-2`}>No active positions yet</p>
              )}
            </div>
          </div>

          {/* Accessibility Settings */}
          <div className={`p-4 rounded-sm border ${darkMode ? 'bg-zinc-800/50 border-zinc-700' : 'bg-amber-50 border-amber-200'}`}>
            <h3 className={`font-semibold ${textClass} mb-3`}>⚙️ Settings</h3>
            <div className="flex items-center justify-between">
              <div>
                <p className={`text-sm font-semibold ${textClass}`}>Color Blind Mode</p>
                <p className={`text-xs ${mutedClass}`}>Use teal/purple instead of green/red</p>
              </div>
              <button
                onClick={async () => {
                  const newMode = !userData?.colorBlindMode;
                  try {
                    await updateDoc(doc(db, 'users', user.uid), {
                      colorBlindMode: newMode
                    });
                  } catch (err) {
                    console.error('Failed to update color blind mode:', err);
                  }
                }}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  userData?.colorBlindMode ? 'bg-orange-600' : (darkMode ? 'bg-zinc-700' : 'bg-slate-300')
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    userData?.colorBlindMode ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
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
                            <p className={`font-semibold ${userData?.colorBlindMode ? 'text-teal-500' : 'text-green-500'}`}>{formatCurrency(potentialPayout)}</p>
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
                  const colorBlindMode = userData?.colorBlindMode || false;
                  const winBorderBg = colorBlindMode
                    ? (darkMode ? 'border-teal-700 bg-teal-900/20' : 'border-teal-300 bg-teal-50')
                    : (darkMode ? 'border-green-700 bg-green-900/20' : 'border-green-300 bg-green-50');
                  const loseBorderBg = colorBlindMode
                    ? (darkMode ? 'border-purple-700/50 bg-purple-900/10' : 'border-purple-200 bg-purple-50')
                    : (darkMode ? 'border-red-700/50 bg-red-900/10' : 'border-red-200 bg-red-50');
                  const winText = colorBlindMode ? 'text-teal-500' : 'text-green-500';
                  const loseText = colorBlindMode ? 'text-purple-400' : 'text-red-400';

                  return (
                    <div key={bet.predictionId} className={`p-3 rounded-sm border ${won ? winBorderBg : loseBorderBg}`}>
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <p className={`text-sm font-semibold ${textClass}`}>
                            {bet.prediction?.question || bet.question || 'Past prediction (details unavailable)'}
                          </p>
                          <p className={`text-xs ${mutedClass} mt-1`}>
                            Your answer: <span className={`font-semibold ${won ? winText : loseText}`}>"{bet.option}"</span>
                            {(bet.prediction?.outcome || bet.outcome) && (
                              <span> • Correct answer: <span className="text-orange-500">"{bet.prediction?.outcome || bet.outcome}"</span></span>
                            )}
                          </p>
                        </div>
                        <div className="text-right ml-2">
                          {won ? (
                            <>
                              <p className={`${winText} font-bold`}>✓ Won</p>
                              {bet.payout && <p className={`${winText} text-sm`}>+{formatCurrency(bet.payout)}</p>}
                            </>
                          ) : (
                            <p className={`${loseText} font-semibold`}>✗ Lost</p>
                          )}
                        </div>
                      </div>
                      <div className={`text-xs mt-2 ${mutedClass}`}>
                        Bet: {formatCurrency(bet.amount)}
                        {paidOut ? (
                          <span className={`${winText} ml-2`}>✓ Paid out to winners</span>
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

          {/* Delete Account Section */}
          <div className={`mt-6 pt-4 border-t ${darkMode ? 'border-zinc-700' : 'border-amber-200'}`}>
            {deleteStep === 0 && (
              <button
                onClick={() => setDeleteStep(1)}
                className={`text-xs ${mutedClass} hover:text-red-500 transition-colors`}
              >
                🗑️ Delete Account
              </button>
            )}

            {deleteStep === 1 && (
              <div className={`p-3 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-amber-50'}`}>
                <h4 className={`font-semibold text-red-500 mb-2`}>Delete Your Account</h4>
                <p className={`text-sm ${mutedClass} mb-3`}>
                  This will permanently delete your account and all associated data including:
                </p>
                <ul className={`text-sm ${mutedClass} mb-3 ml-4 list-disc`}>
                  <li>Your username and profile</li>
                  <li>All cash and holdings</li>
                  <li>Trade history and achievements</li>
                  <li>Prediction bets and results</li>
                </ul>
                <p className={`text-xs text-red-400 mb-3`}>This action cannot be undone.</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDeleteStep(0)}
                    className={`flex-1 py-2 text-sm font-semibold rounded-sm ${darkMode ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'}`}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => setDeleteStep(2)}
                    className="flex-1 py-2 text-sm font-semibold rounded-sm bg-red-600 hover:bg-red-700 text-white"
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}

            {deleteStep === 2 && (
              <div className={`p-3 rounded-sm border-2 border-red-500 ${darkMode ? 'bg-red-900/20' : 'bg-red-50'}`}>
                <h4 className={`font-semibold text-red-500 mb-2`}>⚠️ Are you sure?</h4>
                <p className={`text-sm ${mutedClass} mb-3`}>
                  You're about to permanently delete your account "{userData?.displayName}".
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDeleteStep(0)}
                    className={`flex-1 py-2 text-sm font-semibold rounded-sm ${darkMode ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'}`}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => setDeleteStep(3)}
                    className="flex-1 py-2 text-sm font-semibold rounded-sm bg-red-600 hover:bg-red-700 text-white"
                  >
                    Yes, Delete My Account
                  </button>
                </div>
              </div>
            )}

            {deleteStep === 3 && (
              <div className={`p-3 rounded-sm border-2 border-red-600 ${darkMode ? 'bg-red-900/30' : 'bg-red-100'}`}>
                <h4 className={`font-semibold text-red-600 mb-2`}>🚨 Are you absolutely certain?</h4>
                <p className={`text-sm text-red-500 mb-3`}>
                  Your account and all data will be permanently erased. There is no recovery.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDeleteStep(0)}
                    className={`flex-1 py-2 text-sm font-semibold rounded-sm ${darkMode ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'}`}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => setDeleteStep(4)}
                    className="flex-1 py-2 text-sm font-bold rounded-sm bg-red-700 hover:bg-red-800 text-white"
                  >
                    Continue Deletion
                  </button>
                </div>
              </div>
            )}

            {deleteStep === 4 && (
              <div className={`p-3 rounded-sm border-2 border-rose-700 ${darkMode ? 'bg-rose-900/40' : 'bg-rose-100'}`}>
                <h4 className={`font-semibold text-rose-700 mb-2`}>⚠️ Point of No Return</h4>
                <p className={`text-sm text-rose-600 mb-3`}>
                  After the next step, your account "{userData?.displayName}" will be gone forever.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDeleteStep(0)}
                    className={`flex-1 py-2 text-sm font-semibold rounded-sm ${darkMode ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'}`}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => { setDeleteStep(5); setConfirmUsername(''); }}
                    className="flex-1 py-2 text-sm font-bold rounded-sm bg-rose-700 hover:bg-rose-800 text-white"
                  >
                    Proceed to Final Step
                  </button>
                </div>
              </div>
            )}

            {deleteStep === 5 && (
              <div className={`p-3 rounded-sm border-2 ${darkMode ? 'border-white bg-zinc-950' : 'border-zinc-800 bg-white'}`}>
                <h4 className={`font-semibold mb-2 ${darkMode ? 'text-white' : 'text-zinc-900'}`}>Final Confirmation</h4>
                <p className={`text-sm mb-3 ${darkMode ? 'text-zinc-300' : 'text-zinc-600'}`}>
                  Type your username <span className="font-bold">{userData?.displayName}</span> to confirm deletion:
                </p>
                <input
                  type="text"
                  value={confirmUsername}
                  onChange={(e) => setConfirmUsername(e.target.value)}
                  placeholder="Enter your username"
                  className={`w-full px-3 py-2 mb-3 rounded-sm border ${
                    darkMode
                      ? 'bg-zinc-900 border-zinc-600 text-white placeholder-zinc-500'
                      : 'bg-zinc-50 border-zinc-300 text-zinc-900 placeholder-zinc-400'
                  }`}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => { setDeleteStep(0); setConfirmUsername(''); }}
                    className={`flex-1 py-2 text-sm font-semibold rounded-sm ${darkMode ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'}`}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      setDeleting(true);
                      try {
                        await onDeleteAccount(confirmUsername);
                      } catch (err) {
                        console.error('Failed to delete account:', err);
                        setDeleting(false);
                      }
                    }}
                    disabled={deleting || confirmUsername.toLowerCase() !== userData?.displayName?.toLowerCase()}
                    className={`flex-1 py-2 text-sm font-bold rounded-sm disabled:opacity-50 ${
                      darkMode
                        ? 'bg-white hover:bg-zinc-200 text-zinc-900'
                        : 'bg-zinc-900 hover:bg-zinc-800 text-white'
                    }`}
                  >
                    {deleting ? 'Deleting...' : 'Delete My Account'}
                  </button>
                </div>
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
                        {earned && <span className={`text-sm ${userData?.colorBlindMode ? 'text-teal-500' : 'text-green-500'}`}>✓</span>}
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

const MarginModal = ({ onClose, darkMode, userData, prices, priceHistory, onEnableMargin, onDisableMargin, onRepayMargin, isAdmin }) => {
  const [repayAmount, setRepayAmount] = useState(0);
  const [showConfirmEnable, setShowConfirmEnable] = useState(false);

  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-600';

  const eligibility = checkMarginEligibility(userData, isAdmin);
  const marginStatus = calculateMarginStatus(userData, prices, priceHistory);
  
  const colorBlindMode = userData?.colorBlindMode || false;

  const getStatusColor = (status) => {
    switch (status) {
      case 'safe': return colorBlindMode ? 'text-teal-500' : 'text-green-500';
      case 'warning': return 'text-amber-500';
      case 'margin_call': return 'text-orange-500';
      case 'liquidation': return colorBlindMode ? 'text-purple-500' : 'text-red-500';
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
      case 'safe': return colorBlindMode
        ? (darkMode ? 'bg-teal-900/20 border-teal-800' : 'bg-teal-50 border-teal-200')
        : (darkMode ? 'bg-green-900/20 border-green-800' : 'bg-green-50 border-green-200');
      case 'warning': return darkMode ? 'bg-amber-900/20 border-amber-700' : 'bg-amber-50 border-amber-200';
      case 'margin_call': return darkMode ? 'bg-orange-900/30 border-orange-700' : 'bg-orange-50 border-orange-200';
      case 'liquidation': return colorBlindMode
        ? (darkMode ? 'bg-purple-900/30 border-purple-700' : 'bg-purple-50 border-purple-200')
        : (darkMode ? 'bg-red-900/30 border-red-700' : 'bg-red-50 border-red-200');
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
          {!eligibility.eligible && (marginStatus.marginUsed || 0) === 0 ? (
            // Locked state - show requirements (only if no debt)
            <div className={`p-4 rounded-sm ${darkMode ? 'bg-zinc-800/50' : 'bg-amber-50'}`}>
              <h3 className={`font-semibold mb-2 ${textClass}`}>🔒 Margin Trading Locked</h3>
              <p className={`text-sm ${mutedClass} mb-3`}>Meet these requirements to unlock:</p>
              <div className="space-y-1">
                {eligibility.requirements.map((req, i) => (
                  <div key={i} className={`text-sm flex items-center gap-2 ${req.met ? (colorBlindMode ? 'text-teal-500' : 'text-green-500') : mutedClass}`}>
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
              <div className={`p-4 rounded-sm ${colorBlindMode ? (darkMode ? 'bg-teal-900/20 border border-teal-800' : 'bg-teal-50 border border-teal-200') : (darkMode ? 'bg-green-900/20 border border-green-800' : 'bg-green-50 border border-green-200')}`}>
                <h3 className={`font-semibold mb-2 ${colorBlindMode ? 'text-teal-500' : 'text-green-500'}`}>✓ Eligible for Margin</h3>
                <p className={`text-sm ${mutedClass}`}>
                  You qualify for margin trading! Enable it to access additional buying power.
                </p>
              </div>
              
              <div className={`p-3 rounded-sm ${darkMode ? 'bg-zinc-800/50' : 'bg-amber-50'}`}>
                <h4 className={`font-semibold mb-2 ${textClass}`}>How Margin Works</h4>
                <p className={`text-xs ${mutedClass} mb-2`}>
                  Margin is <span className="text-orange-500 font-semibold">borrowing power</span> - like a credit card for stocks.
                </p>
                <ul className={`text-xs ${mutedClass} space-y-1`}>
                  <li>• Borrow up to <span className="text-orange-500">25-75%</span> of your cash based on tier</li>
                  <li>• <span className="text-amber-500">Tiers:</span> Bronze (0.25x), Silver (0.35x), Gold (0.50x), Platinum (0.75x)</li>
                  <li>• Tier based on <span className="text-orange-500">peak portfolio achievement</span> (&lt;$7.5k, $7.5k-$15k, $15k-$30k, $30k+)</li>
                  <li>• Only used when your <span className="text-orange-500">cash runs out</span> during a purchase</li>
                  <li>• Pay <span className="text-amber-500">0.5% daily interest</span> on borrowed amount (margin debt)</li>
                  <li>• Sale proceeds <span className="text-orange-500">pay debt first</span>, then become cash</li>
                  <li>• Keep equity <span className="text-orange-500">above 30%</span> or face margin call</li>
                  <li>• <span className={colorBlindMode ? 'text-purple-500' : 'text-red-500'}>Auto-liquidation</span> if equity drops to or below 25%</li>
                </ul>
              </div>
              
              <div className={`p-3 rounded-sm border ${colorBlindMode ? (darkMode ? 'bg-purple-900/10 border-purple-800' : 'bg-purple-50 border-purple-200') : (darkMode ? 'bg-red-900/10 border-red-800' : 'bg-red-50 border-red-200')}`}>
                <h4 className={`font-semibold mb-1 ${colorBlindMode ? 'text-purple-500' : 'text-red-500'}`}>⚠️ Risk Warning</h4>
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
                        marginStatus.equityRatio > 0.35 ? (colorBlindMode ? 'bg-teal-500' : 'bg-green-500') :
                        marginStatus.equityRatio > 0.30 ? 'bg-amber-500' :
                        marginStatus.equityRatio > 0.25 ? 'bg-orange-500' : (colorBlindMode ? 'bg-purple-500' : 'bg-red-500')
                      }`}
                      style={{ width: `${Math.min(100, marginStatus.equityRatio * 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs mt-1">
                    <span className={colorBlindMode ? 'text-purple-500' : 'text-red-500'}>25%</span>
                    <span className="text-orange-500">30%</span>
                    <span className="text-amber-500">35%</span>
                    <span className={colorBlindMode ? 'text-teal-500' : 'text-green-500'}>100%</span>
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
                    <p className={`font-bold ${colorBlindMode ? 'text-teal-500' : 'text-green-500'}`}>{formatCurrency(marginStatus.availableMargin)}</p>
                  </div>
                  <div>
                    <span className={mutedClass}>Maintenance Req:</span>
                    <p className={`font-bold ${textClass}`}>{formatCurrency(marginStatus.totalMaintenanceRequired)}</p>
                  </div>
                </div>
              </div>

              {/* How It Works Info */}
              <div className={`p-3 rounded-sm ${darkMode ? 'bg-blue-900/20 border border-blue-800' : 'bg-blue-50 border border-blue-200'}`}>
                <h4 className={`font-semibold mb-1 text-blue-500 text-sm`}>💡 How Margin Works</h4>
                <p className={`text-xs ${mutedClass}`}>
                  Margin is borrowing power - it's only used when your <span className="text-orange-500 font-semibold">cash runs out</span> during a purchase.
                  Your tier determines max borrowable: <span className="text-orange-500 font-semibold">{marginStatus.tierName}</span> = {formatCurrency(marginStatus.maxBorrowable)}.
                  When you sell stocks, proceeds <span className="text-orange-500 font-semibold">pay down debt first</span>, then become cash.
                </p>
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
                <div className={`p-3 rounded-sm ${colorBlindMode ? (darkMode ? 'bg-purple-900/30' : 'bg-purple-50') : (darkMode ? 'bg-red-900/30' : 'bg-red-50')} border ${colorBlindMode ? 'border-purple-500' : 'border-red-500'}`}>
                  <h4 className={`font-bold mb-1 ${colorBlindMode ? 'text-purple-500' : 'text-red-500'}`}>💀 Liquidation Imminent!</h4>
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
                    className={`w-full py-2 font-semibold rounded-sm text-white disabled:opacity-50 disabled:cursor-not-allowed ${colorBlindMode ? 'bg-teal-600 hover:bg-teal-700' : 'bg-green-600 hover:bg-green-700'}`}
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
              {(marginStatus.marginUsed || 0) < 0.01 && (
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
  const lastCheckinStr = toDateString(lastCheckin);
  const hasCheckedIn = !isGuest && lastCheckinStr === today;

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
// EMAIL VERIFICATION MODAL
// ============================================

const EmailVerificationModal = ({ user, darkMode, userData }) => {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleResendVerification = async () => {
    if (!user) return;
    setLoading(true);
    setMessage('');
    try {
      await sendEmailVerification(user);
      setMessage('Verification email sent! Please check your inbox.');
    } catch (err) {
      setMessage('Error sending email. Please try again later.');
    }
    setLoading(false);
  };

  const handleSignOut = async () => {
    await signOut(auth);
  };

  const handleCheckVerification = () => {
    // Force reload user to check verification status
    if (user) {
      user.reload().then(() => {
        if (user.emailVerified) {
          window.location.reload(); // Refresh to update state
        } else {
          setMessage('Email not yet verified. Please check your inbox.');
        }
      });
    }
  };

  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-600';

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div className={`w-full max-w-md ${cardClass} border rounded-sm shadow-xl p-6`}>
        <div className="text-center mb-6">
          <div className="text-5xl mb-3">📧</div>
          <h2 className={`text-xl font-semibold mb-2 ${textClass}`}>Verify Your Email</h2>
          <p className={`text-sm ${mutedClass}`}>
            We sent a verification link to <span className={`font-semibold ${textClass}`}>{user?.email}</span>
          </p>
        </div>

        {message && (
          <div className={`mb-4 p-3 rounded-sm text-sm ${
            message.includes('sent')
              ? darkMode ? 'bg-green-900/30 text-green-400' : 'bg-green-100 text-green-800'
              : darkMode ? 'bg-red-900/30 text-red-400' : 'bg-red-100 text-red-800'
          }`}>
            {message}
          </div>
        )}

        <div className={`mb-6 p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-slate-100'}`}>
          <p className={`text-sm ${textClass} mb-2`}>📋 Next steps:</p>
          <ol className={`text-sm ${mutedClass} space-y-1 list-decimal list-inside`}>
            <li>Check your email inbox (and spam folder)</li>
            <li>Click the verification link in the email</li>
            <li>Return here and click "I've Verified"</li>
          </ol>
        </div>

        <div className="space-y-2">
          <button
            onClick={handleCheckVerification}
            className="w-full py-2.5 px-4 rounded-sm bg-orange-600 hover:bg-orange-700 text-white font-semibold"
          >
            I've Verified My Email
          </button>

          <button
            onClick={handleResendVerification}
            disabled={loading}
            className={`w-full py-2.5 px-4 rounded-sm border ${
              darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 text-slate-700 hover:bg-amber-50'
            } disabled:opacity-50`}
          >
            {loading ? 'Sending...' : 'Resend Verification Email'}
          </button>

          <button
            onClick={handleSignOut}
            className={`w-full py-2 px-4 text-sm ${mutedClass} ${userData?.colorBlindMode ? 'hover:text-purple-500' : 'hover:text-red-500'}`}
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================
// LOGIN MODAL
// ============================================

const LoginModal = ({ onClose, darkMode }) => {
  const [isRegistering, setIsRegistering] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
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

  const handleDiscordSignIn = () => {
    const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID;
    const redirectUri = encodeURIComponent('https://us-central1-stockism-abb28.cloudfunctions.net/discordAuth');
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=identify%20email`;
    window.location.href = discordAuthUrl;
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
        // Create auth account and send verification email
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await sendEmailVerification(userCredential.user);
        setError(''); // Clear any errors
        // Show success message
        alert('Verification email sent! Please check your inbox and verify your email before signing in.');
        // Sign out immediately so they can't bypass verification
        await signOut(auth);
        setIsRegistering(false); // Switch to sign in mode
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

  const handlePasswordReset = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');
    setLoading(true);

    if (!email) {
      setError('Please enter your email address');
      setLoading(false);
      return;
    }

    try {
      await sendPasswordResetEmail(auth, email);
      setSuccessMessage('Password reset email sent! Check your inbox.');
      setEmail('');
    } catch (err) {
      if (err.code === 'auth/user-not-found') setError('No account found with this email');
      else if (err.code === 'auth/invalid-email') setError('Invalid email address');
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
          {isForgotPassword ? 'Reset Password' : (isRegistering ? 'Create Account' : 'Sign In')}
        </h2>

        {!isForgotPassword && (
          <>
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

        {/* Discord Sign In */}
        <button
          onClick={handleDiscordSignIn}
          disabled={loading}
          className={`w-full py-2.5 px-4 rounded-sm border flex items-center justify-center gap-2 mb-4 ${
            darkMode ? 'border-zinc-700 text-slate-200 hover:bg-zinc-800' : 'border-amber-200 text-slate-700 hover:bg-amber-50'
          } disabled:opacity-50`}
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#5865F2">
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z"/>
          </svg>
          Continue with Discord
        </button>

        <div className={`flex items-center gap-3 mb-4 ${mutedClass}`}>
          <div className="flex-1 h-px bg-current opacity-30"></div>
          <span className="text-xs uppercase">or</span>
          <div className="flex-1 h-px bg-current opacity-30"></div>
        </div>
        </>
        )}

        {/* Email Form - Sign in or Register */}
        {!isForgotPassword ? (
        <form onSubmit={handleEmailSubmit} className="space-y-3">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`w-full px-3 py-2 border rounded-sm text-sm ${inputClass}`}
            disabled={loading}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`w-full px-3 py-2 border rounded-sm text-sm ${inputClass}`}
            disabled={loading}
            required
          />
          {isRegistering && (
            <>
              <input
                type="password"
                placeholder="Confirm Password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={`w-full px-3 py-2 border rounded-sm text-sm ${inputClass}`}
                disabled={loading}
                required
              />
              <p className={`text-xs ${mutedClass}`}>
                📧 A verification email will be sent to your email address. You must verify your email before you can sign in.
              </p>
            </>
          )}
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
            {loading ? 'Please wait...' : (isRegistering ? 'Register' : 'Sign In')}
          </button>
          {!isRegistering && (
            <div className="text-center">
              <button
                type="button"
                onClick={() => { setIsForgotPassword(true); setError(''); }}
                className={`text-xs ${mutedClass} hover:text-orange-600`}
              >
                Forgot password?
              </button>
            </div>
          )}
        </form>
        ) : (
        <form onSubmit={handlePasswordReset} className="space-y-3">
          <p className={`text-sm ${mutedClass} mb-3`}>
            Enter your email address and we'll send you a link to reset your password.
          </p>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`w-full px-3 py-2 border rounded-sm text-sm ${inputClass}`}
            disabled={loading}
            required
          />
          {error && (
            <div className="bg-red-100 border border-red-300 text-red-700 px-3 py-2 rounded-sm text-sm">
              {error}
            </div>
          )}
          {successMessage && (
            <div className="bg-green-100 border border-green-300 text-green-700 px-3 py-2 rounded-sm text-sm">
              {successMessage}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold py-2 px-4 rounded-sm text-sm uppercase disabled:opacity-50"
          >
            {loading ? 'Please wait...' : 'Send Reset Link'}
          </button>
        </form>
        )}

        <div className="mt-4 text-center">
          <button
            onClick={() => {
              if (isForgotPassword) {
                setIsForgotPassword(false);
              } else {
                setIsRegistering(!isRegistering);
                setConfirmPassword('');
              }
              setError('');
              setSuccessMessage('');
            }}
            className={`text-sm ${mutedClass} hover:text-orange-600`}
          >
            {isForgotPassword ? 'Back to sign in' : (isRegistering ? 'Already have an account? Sign in with email' : "Don't have an account? Register")}
          </button>
        </div>

        <div className={`mt-4 text-center text-xs ${mutedClass}`}>
          <a href="/terms.html" target="_blank" rel="noopener noreferrer" className="hover:text-orange-500 underline">
            Terms of Service
          </a>
          {' • '}
          <a href="/privacy.html" target="_blank" rel="noopener noreferrer" className="hover:text-orange-500 underline">
            Privacy Policy
          </a>
          {' • '}
          <a href="https://discord.gg/yxw94uNrYv" target="_blank" rel="noopener noreferrer" className="hover:text-orange-500 underline">
            Discord
          </a>
          {' • '}
          <a href="https://reddit.com/r/stockismapp" target="_blank" rel="noopener noreferrer" className="hover:text-orange-500 underline">
            Reddit
          </a>
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
    if (containsProfanity(trimmed)) {
      setError(getProfanityMessage());
      return;
    }

    setLoading(true);
    try {
      // Create user via Cloud Function (ensures case-insensitive username uniqueness)
      await createUserFunction({ displayName: trimmed });
      onComplete();
    } catch (err) {
      // Handle specific error codes from Cloud Function
      if (err.code === 'functions/already-exists') {
        setError('This username is already taken. Please choose another.');
      } else if (err.code === 'functions/invalid-argument') {
        setError(err.message || 'Invalid username.');
      } else {
        setError('Failed to create account. Please try again.');
        console.error(err);
      }
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

        <p className={`text-xs ${mutedClass} mt-2 text-center`}>
          By creating an account, you agree to our{' '}
          <a href="/terms.html" target="_blank" rel="noopener noreferrer" className="text-orange-500 hover:text-orange-400 underline">
            Terms of Service
          </a>
          {' and '}
          <a href="/privacy.html" target="_blank" rel="noopener noreferrer" className="text-orange-500 hover:text-orange-400 underline">
            Privacy Policy
          </a>
        </p>
      </div>
    </div>
  );
};

// ============================================
// TRADE ACTION MODAL (Robinhood-style)
// ============================================

const TradeActionModal = ({ character, action, price, holdings, shortPosition, userCash, userData, prices, onTrade, onClose, darkMode, priceHistory, colorBlindMode = false, user }) => {
  const [amount, setAmount] = useState(1);
  const [isLimitOrder, setIsLimitOrder] = useState(false);
  const [limitPrice, setLimitPrice] = useState(price.toFixed(2));
  const [allowPartialFills, setAllowPartialFills] = useState(false);

  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';

  // Color blind friendly colors for price indicators (bid/ask displays)
  const getColors = (isPositive) => {
    if (colorBlindMode) {
      return isPositive
        ? { text: 'text-teal-400', bg: 'bg-teal-600', bgHover: 'hover:bg-teal-700' }
        : { text: 'text-purple-400', bg: 'bg-purple-600', bgHover: 'hover:bg-purple-700' };
    } else {
      return isPositive
        ? { text: 'text-green-400', bg: 'bg-green-600', bgHover: 'hover:bg-green-700' }
        : { text: 'text-red-400', bg: 'bg-red-600', bgHover: 'hover:bg-red-700' };
    }
  };

  // Calculate dynamic prices
  const getDynamicPrices = (amt, act) => {
    const liquidity = character.liquidity || BASE_LIQUIDITY;
    const impact = calculatePriceImpact(price, amt, liquidity);

    if (act === 'buy' || act === 'cover') {
      const newMid = price + impact;
      return getBidAskPrices(newMid);
    } else {
      const newMid = Math.max(MIN_PRICE, price - impact);
      return getBidAskPrices(newMid);
    }
  };

  // Get buying power
  const getBuyingPower = () => {
    let buyingPower = userCash;
    if (userData && prices) {
      const marginStatus = calculateMarginStatus(userData, prices, priceHistory);
      if (marginStatus.enabled && marginStatus.availableMargin > 0) {
        const maxMarginUsable = Math.min(userCash, marginStatus.availableMargin);
        buyingPower += maxMarginUsable;
      }
    }
    return buyingPower;
  };

  // Calculate max shares for this specific action
  const getMaxShares = () => {
    if (action === 'buy') {
      const buyingPower = getBuyingPower();
      if (buyingPower <= 0) return 0;
      let low = 1, high = Math.floor(buyingPower / (price * 0.5)), maxAffordable = 0;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const { ask } = getDynamicPrices(mid, 'buy');
        const cost = ask * mid;
        if (cost <= buyingPower) {
          maxAffordable = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      return Math.max(1, maxAffordable);
    } else if (action === 'sell') {
      return holdings || 0;
    } else if (action === 'short') {
      const shortBuyingPower = getBuyingPower();
      if (shortBuyingPower <= 0) return 0;
      let low = 1, high = Math.floor(shortBuyingPower / (price * 0.25)), maxAffordable = 0;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const { bid } = getDynamicPrices(mid, 'short');
        const margin = bid * mid * SHORT_MARGIN_REQUIREMENT;
        if (margin <= shortBuyingPower) {
          maxAffordable = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      return Math.max(1, maxAffordable);
    } else if (action === 'cover') {
      return shortPosition?.shares || 0;
    }
    return 1;
  };

  const maxShares = getMaxShares();
  const { bid, ask, spread } = getDynamicPrices(amount || 1, action);

  const getActionConfig = () => {
    const buyColors = getColors(true);   // Buy colors (green/teal)
    const sellColors = getColors(false); // Sell colors (red/purple)

    switch (action) {
      case 'buy':
        return {
          title: 'Buy',
          colors: buyColors,
          buttonStyle: 'solid',
          price: ask,
          total: ask * (amount || 1),
          label: 'Cost',
          disabled: maxShares === 0
        };
      case 'sell':
        return {
          title: 'Sell',
          colors: sellColors,
          buttonStyle: 'solid',
          price: bid,
          total: bid * (amount || 1),
          label: 'Revenue',
          disabled: holdings < (amount || 1)
        };
      case 'short':
        return {
          title: 'Short',
          colors: {
            text: 'text-orange-400',
            border: 'border-orange-500',
            bg: darkMode ? 'hover:bg-orange-900/30' : 'hover:bg-orange-50'
          },
          buttonStyle: 'outline',
          price: bid,
          total: bid * (amount || 1) * SHORT_MARGIN_REQUIREMENT,
          label: 'Margin Required',
          disabled: maxShares === 0
        };
      case 'cover':
        return {
          title: 'Cover Short',
          colors: {
            text: 'text-blue-400',
            border: 'border-blue-500',
            bg: darkMode ? 'hover:bg-blue-900/30' : 'hover:bg-blue-50'
          },
          buttonStyle: 'outline',
          price: ask,
          total: ask * (amount || 1),
          label: 'Cost to Cover',
          disabled: !shortPosition || shortPosition.shares < (amount || 1)
        };
      default:
        return { title: '', colors: { text: 'text-gray-400', bg: 'bg-gray-600', bgHover: 'hover:bg-gray-700' }, buttonStyle: 'solid', price: 0, total: 0, label: '', disabled: true };
    }
  };

  const config = getActionConfig();

  const handleSubmit = async () => {
    if (config.disabled || amount < 1 || amount > maxShares) return;

    if (isLimitOrder) {
      // Handle limit order creation
      const priceNum = parseFloat(limitPrice);
      if (isNaN(priceNum) || priceNum <= 0) {
        alert('Please enter a valid limit price');
        return;
      }

      try {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30); // 30 day expiration

        await addDoc(collection(db, 'limitOrders'), {
          userId: user.uid,
          ticker: character.ticker,
          type: action.toUpperCase(), // 'BUY', 'SELL', 'SHORT', 'COVER'
          shares: parseInt(amount),
          limitPrice: priceNum,
          allowPartialFills,
          status: 'PENDING',
          filledShares: 0,
          createdAt: serverTimestamp(),
          expiresAt: expiresAt.getTime(),
          updatedAt: serverTimestamp()
        });

        alert('Limit order created! View your orders in Portfolio.');
        onClose();
      } catch (error) {
        console.error('Error creating limit order:', error);
        alert(`Failed to create order: ${error.message}`);
      }
    } else {
      // Handle immediate trade
      onTrade(character.ticker, action, amount);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className={`${cardClass} border rounded-sm p-4 max-w-md w-full`} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className={`text-lg font-bold ${textClass}`}>{config.title} ${character.ticker}</h3>
            <p className={`text-sm ${mutedClass}`}>{character.name}</p>
          </div>
          <button onClick={onClose} className={`${mutedClass} hover:text-orange-600`}>✕</button>
        </div>

        {/* Price info */}
        <div className={`p-3 rounded-sm mb-4 ${darkMode ? 'bg-zinc-800' : 'bg-slate-100'}`}>
          <div className="flex justify-between items-center text-sm mb-2">
            <span className={mutedClass}>Market Price</span>
            <span className={`font-bold ${textClass}`}>{formatCurrency(price)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <div>
              <div className={mutedClass}>Bid</div>
              <div className={`${getColors(false).text} font-semibold`}>{formatCurrency(bid)}</div>
            </div>
            <div className="text-center">
              <div className={mutedClass}>Spread</div>
              <div className={mutedClass}>{(spread / price * 100).toFixed(2)}%</div>
            </div>
            <div className="text-right">
              <div className={mutedClass}>Ask</div>
              <div className={`${getColors(true).text} font-semibold`}>{formatCurrency(ask)}</div>
            </div>
          </div>
        </div>

        {/* Amount input */}
        <div className="mb-4">
          <label className={`block text-sm font-semibold mb-2 ${textClass}`}>Shares</label>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAmount(Math.max(1, (amount || 1) - 1))}
              className={`px-3 py-2 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-slate-200'}`}
            >
              -
            </button>
            <input
              type="number"
              min="1"
              max={maxShares}
              value={amount === '' ? '' : amount}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '') {
                  setAmount('');
                } else {
                  const num = parseInt(val);
                  if (!isNaN(num)) {
                    setAmount(Math.min(maxShares, Math.max(0, num)));
                  }
                }
              }}
              onBlur={() => {
                if (amount === '' || amount < 1) {
                  setAmount(1);
                }
              }}
              className={`flex-1 text-center py-2 rounded-sm border ${darkMode ? 'bg-zinc-950 border-zinc-700 text-zinc-100' : 'bg-white border-amber-200 text-slate-900'}`}
            />
            <button
              onClick={() => setAmount(Math.min(maxShares, (amount || 0) + 1))}
              className={`px-3 py-2 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-slate-200'}`}
            >
              +
            </button>
            <button
              onClick={() => setAmount(maxShares)}
              className={`px-3 py-2 text-sm font-semibold rounded-sm ${darkMode ? 'bg-teal-700 hover:bg-teal-600 text-white' : 'bg-teal-600 hover:bg-teal-700 text-white'}`}
              disabled={maxShares === 0}
            >
              Max
            </button>
          </div>
          {maxShares === 0 && (
            <p className="text-xs text-red-500 mt-1">
              {action === 'sell' ? 'No shares owned' : action === 'cover' ? 'No short position' : 'Insufficient funds'}
            </p>
          )}
          {maxShares > 0 && (
            <p className={`text-xs ${mutedClass} mt-1`}>Max: {maxShares} shares</p>
          )}
        </div>

        {/* Limit Order Checkbox */}
        <div className="mb-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isLimitOrder}
              onChange={(e) => {
                setIsLimitOrder(e.target.checked);
                if (e.target.checked) {
                  setLimitPrice(price.toFixed(2));
                }
              }}
              className="w-4 h-4"
            />
            <span className={`text-sm font-semibold ${textClass}`}>Place as limit order</span>
          </label>
          <p className={`text-xs ${mutedClass} mt-1 ml-6`}>
            Order will execute when price conditions are met (30-day expiration)
          </p>
        </div>

        {/* Limit Order Settings */}
        {isLimitOrder && (
          <div className={`p-3 rounded-sm mb-4 space-y-3 ${darkMode ? 'bg-zinc-800' : 'bg-slate-100'}`}>
            <div>
              <label className={`block text-sm font-semibold mb-1 ${textClass}`}>
                Limit Price
                <span className={`ml-2 text-xs ${mutedClass}`}>
                  (Current: {formatCurrency(price)})
                </span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                placeholder="0.00"
                className={`w-full px-3 py-2 border rounded-sm ${darkMode ? 'bg-zinc-950 border-zinc-700 text-zinc-100' : 'bg-white border-amber-200 text-slate-900'}`}
              />
              <p className={`text-xs ${mutedClass} mt-1`}>
                {action === 'buy' || action === 'cover'
                  ? 'Order executes when price drops to or below this price'
                  : 'Order executes when price rises to or above this price'}
              </p>
            </div>
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowPartialFills}
                  onChange={(e) => setAllowPartialFills(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className={`text-sm ${textClass}`}>Allow partial fills</span>
              </label>
              <p className={`text-xs ${mutedClass} mt-1 ml-6`}>
                If unchecked, order only executes if all shares can be traded
              </p>
            </div>
          </div>
        )}

        {/* Total (only show for immediate trades) */}
        {!isLimitOrder && (
          <div className={`p-3 rounded-sm mb-4 ${darkMode ? 'bg-zinc-800' : 'bg-slate-100'}`}>
            <div className="flex justify-between items-center">
              <span className={`text-sm ${mutedClass}`}>{config.label}</span>
              <span className={`text-lg font-bold ${config.colors.text}`}>
                {formatCurrency(config.total)}
              </span>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleSubmit}
            disabled={config.disabled || amount < 1 || amount > maxShares || (isLimitOrder && (!limitPrice || parseFloat(limitPrice) <= 0))}
            className={`flex-1 py-3 text-sm font-semibold uppercase rounded-sm ${
              config.buttonStyle === 'outline'
                ? `border-2 ${config.colors.border} ${config.colors.text} ${config.colors.bg}`
                : `${config.colors.bg} ${config.colors.bgHover} text-white`
            } disabled:opacity-50`}
          >
            {isLimitOrder ? `Create Limit ${config.title}` : config.title}
          </button>
          <button
            onClick={onClose}
            className={`px-4 py-3 text-sm font-semibold rounded-sm ${darkMode ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================
// CHARACTER CARD
// ============================================

const CharacterCard = ({ character, price, priceChange, sentiment, holdings, shortPosition, onTrade, onViewChart, priceHistory, darkMode, userCash = 0, userData, prices, user }) => {
  const [showTradeMenu, setShowTradeMenu] = useState(false);
  const [tradeAction, setTradeAction] = useState(null); // 'buy', 'sell', 'short', or 'cover'

  const owned = holdings > 0;
  const shorted = shortPosition && shortPosition.shares > 0;
  const isETF = character.isETF;
  const colorBlindMode = userData?.colorBlindMode || false;

  // Color blind friendly helper for Buy/Sell (solid buttons)
  const getBuySellColors = (isBuy) => {
    if (colorBlindMode) {
      return isBuy
        ? { bg: 'bg-teal-600', bgHover: 'hover:bg-teal-700' }
        : { bg: 'bg-purple-600', bgHover: 'hover:bg-purple-700' };
    } else {
      return isBuy
        ? { bg: 'bg-green-600', bgHover: 'hover:bg-green-700' }
        : { bg: 'bg-red-600', bgHover: 'hover:bg-red-700' };
    }
  };

  const cardClass = darkMode 
    ? `bg-zinc-900 border-zinc-800 ${owned ? 'ring-1 ring-blue-500' : ''} ${shorted ? 'ring-1 ring-orange-500' : ''}` 
    : `bg-white border-amber-200 ${owned ? 'ring-1 ring-blue-500' : ''} ${shorted ? 'ring-1 ring-orange-500' : ''}`;
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';

  const getSentimentColor = () => {
    const positiveColor = colorBlindMode ? 'text-teal-500' : 'text-green-500';
    const positiveColorLight = colorBlindMode ? 'text-teal-400' : 'text-green-400';
    const negativeColor = colorBlindMode ? 'text-purple-500' : 'text-red-500';
    const negativeColorLight = colorBlindMode ? 'text-purple-400' : 'text-red-400';

    switch (sentiment) {
      case 'Strong Buy': return positiveColor;
      case 'Bullish': return positiveColorLight;
      case 'Neutral': return 'text-amber-500';
      case 'Bearish': return negativeColorLight;
      case 'Strong Sell': return negativeColor;
      default: return mutedClass;
    }
  };

  // Calculate 24h chart data
  const chart24hData = useMemo(() => {
    const data = priceHistory[character.ticker] || [];
    const now = Date.now();
    const dayAgo = now - (24 * 60 * 60 * 1000);
    const filtered = data.filter(p => p.timestamp >= dayAgo);

    // If we have enough data, use it
    if (filtered.length >= 2) {
      return filtered;
    }

    // Find price from ~24h ago for synthetic chart
    let price24hAgo = character.basePrice;
    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i].timestamp <= dayAgo) {
        price24hAgo = data[i].price;
        break;
      }
    }
    // If no history before 24h ago, use oldest available or basePrice
    if (price24hAgo === character.basePrice && data.length > 0) {
      price24hAgo = data[0].price;
    }

    return [
      { timestamp: dayAgo, price: price24hAgo },
      { timestamp: now, price: price }
    ];
  }, [priceHistory, character.ticker, character.basePrice, price]);

  // Calculate 7d chart data
  const chart7dData = useMemo(() => {
    const data = priceHistory[character.ticker] || [];
    const now = Date.now();
    const weekAgo = now - (7 * 24 * 60 * 60 * 1000);
    const filtered = data.filter(p => p.timestamp >= weekAgo);

    if (filtered.length >= 2) {
      return filtered;
    }

    // Find price from ~7d ago for synthetic chart
    let price7dAgo = character.basePrice;
    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i].timestamp <= weekAgo) {
        price7dAgo = data[i].price;
        break;
      }
    }
    if (price7dAgo === character.basePrice && data.length > 0) {
      price7dAgo = data[0].price;
    }

    return [
      { timestamp: weekAgo, price: price7dAgo },
      { timestamp: now, price: price }
    ];
  }, [priceHistory, character.ticker, character.basePrice, price]);

  // Calculate 24h percentage change
  const chart24hFirstPrice = chart24hData[0]?.price || price;
  const chart24hLastPrice = chart24hData[chart24hData.length - 1]?.price || price;
  const chart24hChange = chart24hFirstPrice > 0 ? ((chart24hLastPrice - chart24hFirstPrice) / chart24hFirstPrice) * 100 : 0;

  // Calculate 7d percentage change
  const chart7dFirstPrice = chart7dData[0]?.price || price;
  const chart7dLastPrice = chart7dData[chart7dData.length - 1]?.price || price;
  const chart7dChange = chart7dFirstPrice > 0 ? ((chart7dLastPrice - chart7dFirstPrice) / chart7dFirstPrice) * 100 : 0;

  // Determine if we should use 7d data instead of 24h
  const use7dChart = chart24hData.length <= 2 || Math.abs(chart24hChange) < 0.01;

  // Use the appropriate data for display
  const miniChartData = use7dChart ? chart7dData : chart24hData;
  const chartChange = use7dChart ? chart7dChange : chart24hChange;
  const isUp = chartChange >= 0;
  const defaultChartTimeRange = use7dChart ? '7d' : '1d';

  // Calculate short P/L if shorted
  const shortPL = shorted ? (shortPosition.entryPrice - price) * shortPosition.shares : 0;

  return (
    <>
      <div className={`${cardClass} border rounded-sm p-4 transition-all`}>
        <div className="cursor-pointer" onClick={() => onViewChart(character, defaultChartTimeRange)}>
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
              <p className={`text-xs font-mono ${isUp ? (colorBlindMode ? 'text-teal-500' : 'text-green-500') : (colorBlindMode ? 'text-purple-500' : 'text-red-500')}`}>
                {isUp ? '▲' : '▼'} {formatChange(chartChange)}
              </p>
            </div>
          </div>
          <div className="mb-2">
            <SimpleLineChart data={miniChartData} darkMode={darkMode} colorBlindMode={userData?.colorBlindMode || false} />
          </div>
        </div>

        <div className="flex justify-between items-center mb-3">
          <span className={`text-xs ${getSentimentColor()} font-semibold uppercase`}>{sentiment}</span>
          <div className="flex gap-2">
            {owned && <span className="text-xs text-blue-500 font-semibold">{holdings} long</span>}
            {shorted && (
              <span className={`text-xs font-semibold ${shortPL >= 0 ? (colorBlindMode ? 'text-teal-500' : 'text-green-500') : (colorBlindMode ? 'text-purple-500' : 'text-red-500')}`}>
                {shortPosition.shares} short ({shortPL >= 0 ? '+' : ''}{formatCurrency(shortPL)})
              </span>
            )}
          </div>
        </div>

        {!showTradeMenu ? (
          <button
            onClick={(e) => { e.stopPropagation(); setShowTradeMenu(true); }}
            className={`w-full py-1.5 text-xs font-semibold uppercase rounded-sm border ${
              darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 text-zinc-600 hover:bg-amber-50'
            }`}
          >
            Trade
          </button>
        ) : (
          <div className="space-y-2" onClick={e => e.stopPropagation()}>
            {/* Action buttons */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => { setTradeAction('buy'); setShowTradeMenu(false); }}
                className={`py-2 text-xs font-semibold uppercase rounded-sm ${getBuySellColors(true).bg} ${getBuySellColors(true).bgHover} text-white`}
              >
                Buy
              </button>
              <button
                onClick={() => { setTradeAction('sell'); setShowTradeMenu(false); }}
                disabled={holdings === 0}
                className={`py-2 text-xs font-semibold uppercase rounded-sm ${getBuySellColors(false).bg} ${getBuySellColors(false).bgHover} text-white disabled:opacity-50`}
              >
                Sell
              </button>
              <button
                onClick={() => { setTradeAction('short'); setShowTradeMenu(false); }}
                className={`py-2 text-xs font-semibold uppercase rounded-sm border-2 border-orange-500 ${darkMode ? 'text-orange-400 hover:bg-orange-900/30' : 'text-orange-600 hover:bg-orange-50'}`}
              >
                Short
              </button>
              <button
                onClick={() => { setTradeAction('cover'); setShowTradeMenu(false); }}
                disabled={!shorted}
                className={`py-2 text-xs font-semibold uppercase rounded-sm border-2 border-blue-500 ${darkMode ? 'text-blue-400 hover:bg-blue-900/30' : 'text-blue-600 hover:bg-blue-50'} disabled:opacity-50`}
              >
                Cover
              </button>
            </div>
            <button
              onClick={() => setShowTradeMenu(false)}
              className={`w-full py-1 text-xs ${mutedClass} hover:text-orange-600`}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Trade Action Modal */}
      {tradeAction && (
        <TradeActionModal
          character={character}
          action={tradeAction}
          price={price}
          holdings={holdings}
          shortPosition={shortPosition}
          userCash={userCash}
          userData={userData}
          prices={prices}
          onTrade={onTrade}
          onClose={() => setTradeAction(null)}
          darkMode={darkMode}
          priceHistory={priceHistory}
          colorBlindMode={userData?.colorBlindMode || false}
          user={user}
        />
      )}
    </>
  );
};

// ============================================
// TOAST NOTIFICATIONS
// ============================================

const ToastNotification = ({ notification, onDismiss, darkMode }) => {
  const [isExiting, setIsExiting] = useState(false);
  
  useEffect(() => {
    // Auto-dismiss after duration (longer for achievements)
    const duration = notification.type === 'achievement' ? 6000 : 4000;
    const timer = setTimeout(() => {
      setIsExiting(true);
      setTimeout(onDismiss, 300); // Wait for exit animation
    }, duration);
    
    return () => clearTimeout(timer);
  }, [notification, onDismiss]);
  
  const handleDismiss = () => {
    setIsExiting(true);
    setTimeout(onDismiss, 300);
  };
  
  const getStyles = () => {
    switch (notification.type) {
      case 'error':
        return {
          bg: darkMode ? 'bg-red-900/90 border-red-700' : 'bg-red-100 border-red-400',
          text: darkMode ? 'text-red-100' : 'text-red-800',
          icon: '❌'
        };
      case 'info':
        return {
          bg: darkMode ? 'bg-blue-900/90 border-blue-700' : 'bg-blue-100 border-blue-400',
          text: darkMode ? 'text-blue-100' : 'text-blue-800',
          icon: 'ℹ️'
        };
      case 'achievement':
        return {
          bg: darkMode ? 'bg-amber-900/90 border-amber-500' : 'bg-amber-100 border-amber-400',
          text: darkMode ? 'text-amber-100' : 'text-amber-800',
          icon: '🏆'
        };
      default: // success
        return {
          bg: darkMode ? 'bg-green-900/90 border-green-700' : 'bg-green-100 border-green-400',
          text: darkMode ? 'text-green-100' : 'text-green-800',
          icon: '✓'
        };
    }
  };
  
  const styles = getStyles();
  
  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-sm border shadow-lg backdrop-blur-sm cursor-pointer transition-all duration-300 ${styles.bg} ${styles.text} ${
        isExiting ? 'opacity-0 translate-x-full' : 'opacity-100 translate-x-0'
      } ${notification.type === 'achievement' ? 'animate-pulse' : ''}`}
      onClick={handleDismiss}
    >
      {notification.image ? (
        <img src={notification.image} alt="" className="w-6 h-6 object-contain" />
      ) : (
        <span className="text-lg">{styles.icon}</span>
      )}
      <span className="flex-1 text-sm font-semibold">{notification.message}</span>
      <button className="opacity-60 hover:opacity-100 text-lg leading-none">&times;</button>
    </div>
  );
};

const ToastContainer = ({ notifications, onDismiss, darkMode }) => {
  return (
    <div className="fixed bottom-20 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {notifications.map((notif) => (
        <ToastNotification
          key={notif.id}
          notification={notif}
          onDismiss={() => onDismiss(notif.id)}
          darkMode={darkMode}
        />
      ))}
    </div>
  );
};

// ============================================
// ACTIVITY FEED
// ============================================

const ActivityFeed = ({ activities, isOpen, onToggle, darkMode }) => {
  const cardClass = darkMode ? 'bg-zinc-900/95 border-zinc-700' : 'bg-white/95 border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';
  
  const getActivityIcon = (type) => {
    switch (type) {
      case 'trade': return '📈';
      case 'achievement': return '🏆';
      case 'mission': return '📋';
      case 'checkin': return '✅';
      case 'bet': return '🔮';
      case 'global': return '🌐';
      default: return '•';
    }
  };
  
  const getActivityColor = (type) => {
    switch (type) {
      case 'trade': return 'text-green-500';
      case 'achievement': return 'text-amber-500';
      case 'mission': return 'text-purple-500';
      case 'checkin': return 'text-teal-500';
      case 'bet': return 'text-orange-500';
      case 'global': return 'text-blue-400';
      default: return mutedClass;
    }
  };
  
  const formatTime = (timestamp) => {
    const diff = Date.now() - timestamp;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(timestamp).toLocaleDateString();
  };
  
  return (
    <div className={`fixed bottom-4 right-4 z-40 ${cardClass} border rounded-sm shadow-xl transition-all duration-200 ${isOpen ? 'w-80' : 'w-auto'}`}>
      {/* Header / Toggle Button */}
      <button
        onClick={onToggle}
        className={`w-full px-3 py-2 flex items-center justify-between ${textClass} hover:bg-black/10 transition-colors rounded-t-sm`}
      >
        <div className="flex items-center gap-2">
          <span>📜</span>
          <span className="font-semibold text-sm">Activity</span>
          {!isOpen && activities.length > 0 && (
            <span className="bg-orange-500 text-white text-xs px-1.5 py-0.5 rounded-full">{Math.min(activities.length, 99)}</span>
          )}
        </div>
        <span className={`text-xs ${mutedClass}`}>{isOpen ? '▼' : '▲'}</span>
      </button>
      
      {/* Feed Content */}
      {isOpen && (
        <div className="max-h-64 overflow-y-auto border-t border-inherit">
          {activities.length === 0 ? (
            <div className={`p-4 text-center text-sm ${mutedClass}`}>
              No activity yet. Start trading!
            </div>
          ) : (
            <div className="divide-y divide-inherit">
              {activities.slice(0, 20).map(activity => (
                <div key={activity.id} className={`px-3 py-2 text-sm ${activity.isGlobal ? 'bg-blue-500/5' : ''}`}>
                  <div className="flex items-start gap-2">
                    <span className={getActivityColor(activity.type)}>{getActivityIcon(activity.type)}</span>
                    <div className="flex-1 min-w-0">
                      <div className={`${textClass} break-words`}>{activity.message}</div>
                      <div className={`text-xs ${mutedClass}`}>{formatTime(activity.timestamp)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
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
  const [launchedTickers, setLaunchedTickers] = useState([]);
  const [darkMode, setDarkMode] = useState(true);
  const [loading, setLoading] = useState(true);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showPortfolio, setShowPortfolio] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showAchievements, setShowAchievements] = useState(false);
  const [showLending, setShowLending] = useState(false);
  const [showBailout, setShowBailout] = useState(false);
  const [showCrewSelection, setShowCrewSelection] = useState(false);
  const [showPinShop, setShowPinShop] = useState(false);
  const [showDailyMissions, setShowDailyMissions] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showLadderGame, setShowLadderGame] = useState(false);
  const [showLadderSignInModal, setShowLadderSignInModal] = useState(false);
  const [showLadderIntroModal, setShowLadderIntroModal] = useState(false);
  const [skipLadderIntro, setSkipLadderIntro] = useState(() => {
    try {
      return localStorage.getItem('skipLadderIntro') === 'true';
    } catch {
      return false;
    }
  });
  const [selectedCharacter, setSelectedCharacter] = useState(null);
  const [notifications, setNotifications] = useState([]); // Toast notification queue

  // Handler for viewing charts with default time range
  const handleViewChart = (character, defaultTimeRange = '1d') => {
    setSelectedCharacter({ character, defaultTimeRange });
  };
  const [needsUsername, setNeedsUsername] = useState(false);
  const [needsEmailVerification, setNeedsEmailVerification] = useState(false);
  const [sortBy, setSortBy] = useState('price-high');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [showAll, setShowAll] = useState(false);
  const [predictions, setPredictions] = useState([]);
  const [showAdmin, setShowAdmin] = useState(false);
  const [activeIPOs, setActiveIPOs] = useState([]); // IPOs currently in hype or active phase
  const [tradeConfirmation, setTradeConfirmation] = useState(null); // { ticker, action, amount, price, total }
  const [betConfirmation, setBetConfirmation] = useState(null); // { predictionId, option, amount, question }
  const [activityFeed, setActivityFeed] = useState([]); // Array of { id, type, message, timestamp, isGlobal }
  const [showActivityFeed, setShowActivityFeed] = useState(false); // Start minimized
  const [showPredictions, setShowPredictions] = useState(() => {
    // Initialize directly from localStorage - don't check identifier yet
    try {
      const stored = localStorage.getItem('showPredictions');
      if (stored) {
        const { collapsed } = JSON.parse(stored);
        return collapsed;
      }
    } catch {
      // Ignore errors
    }
    return true; // Default to expanded
  });
  const [showNewCharacters, setShowNewCharacters] = useState(() => {
    // Initialize from localStorage based on current week
    return loadCollapsedState('showNewCharacters', getWeekIdentifier());
  });

  // Color blind mode helpers - returns accessible colors
  const getColorBlindColors = useCallback((isPositive) => {
    const colorBlindMode = userData?.colorBlindMode || false;

    if (colorBlindMode) {
      // Color blind friendly: teal (positive) / purple (negative)
      return {
        text: isPositive ? 'text-teal-500' : 'text-purple-500',
        bg: isPositive ? 'bg-teal-600' : 'bg-purple-600',
        bgHover: isPositive ? 'hover:bg-teal-700' : 'hover:bg-purple-700',
        border: isPositive ? 'border-teal-500' : 'border-purple-500'
      };
    } else {
      // Standard: green (positive) / red (negative)
      return {
        text: isPositive ? 'text-green-500' : 'text-red-500',
        bg: isPositive ? 'bg-green-600' : 'bg-red-600',
        bgHover: isPositive ? 'hover:bg-green-700' : 'hover:bg-red-700',
        border: isPositive ? 'border-green-500' : 'border-red-500'
      };
    }
  }, [userData]);

  // Helper to show toast notification
  const showNotification = useCallback((type, message, image = null) => {
    const id = Date.now() + Math.random();
    setNotifications(prev => [...prev, { id, type, message, image }].slice(-5)); // Max 5 toasts
  }, []);

  // Helper to dismiss notification
  const dismissNotification = useCallback((id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  // Helper to add activity to feed
  const addActivity = useCallback((type, message, isGlobal = false) => {
    const activity = {
      id: Date.now() + Math.random(),
      type, // 'trade', 'achievement', 'mission', 'checkin', 'bet', 'global'
      message,
      timestamp: Date.now(),
      isGlobal
    };
    setActivityFeed(prev => [activity, ...prev].slice(0, 50)); // Keep last 50
  }, []);

  // Ref to store user data listener unsubscribe function
  const userDataUnsubscribeRef = useRef(null);

  // Handle Discord OAuth redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const discordToken = params.get('discord_token');

    if (discordToken) {
      // Sign in with custom token from Discord OAuth
      signInWithCustomToken(auth, discordToken)
        .then(() => {
          // Clean up URL
          window.history.replaceState({}, document.title, window.location.pathname);
        })
        .catch((error) => {
          console.error('Discord sign-in error:', error);
        });
    }
  }, []);

  // Listen to auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      // Clean up previous user data listener
      if (userDataUnsubscribeRef.current) {
        userDataUnsubscribeRef.current();
        userDataUnsubscribeRef.current = null;
      }

      setUser(firebaseUser);
      if (firebaseUser) {
        // Check if email is verified (only for email/password providers)
        const isEmailProvider = firebaseUser.providerData.some(p => p.providerId === 'password');
        if (isEmailProvider && !firebaseUser.emailVerified) {
          // Email not verified - block access
          setNeedsEmailVerification(true);
          setNeedsUsername(false);
          setUserData(null);
          setLoading(false);
          return;
        }

        setNeedsEmailVerification(false);

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

          // Subscribe to user data changes - store unsubscribe for cleanup
          userDataUnsubscribeRef.current = onSnapshot(userDocRef, (snap) => {
            if (snap.exists()) setUserData(snap.data());
          });
        }
      } else {
        setUserData(null);
        setNeedsUsername(false);
        setNeedsEmailVerification(false);
      }
      setLoading(false);
    });
    return () => {
      unsubscribe();
      // Clean up user data listener on unmount
      if (userDataUnsubscribeRef.current) {
        userDataUnsubscribeRef.current();
      }
    };
  }, []);

  // Handle Firebase email action codes (verification links)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode');
    const oobCode = urlParams.get('oobCode');

    if (mode === 'verifyEmail' && oobCode) {
      applyActionCode(auth, oobCode)
        .then(() => {
          // Verification successful - reload user and redirect
          if (auth.currentUser) {
            auth.currentUser.reload().then(() => {
              // Clear URL params and reload to update state
              window.history.replaceState({}, '', window.location.pathname);
              window.location.reload();
            });
          } else {
            window.history.replaceState({}, '', window.location.pathname);
            window.location.reload();
          }
        })
        .catch((error) => {
          console.error('Email verification failed:', error);
          // Could show error to user - link expired or already used
        });
    }
  }, []);

  // Listen to global market data
  useEffect(() => {
    const marketRef = doc(db, 'market', 'current');
    
    const unsubscribe = onSnapshot(marketRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        // Merge stored prices with basePrices for any new characters
        const storedPrices = data.prices || {};
        const launched = data.launchedTickers || [];
        const mergedPrices = {};
        CHARACTERS.forEach(c => {
          // Only include character if it doesn't require IPO, or if it's been launched
          if (!c.ipoRequired || launched.includes(c.ticker)) {
            mergedPrices[c.ticker] = storedPrices[c.ticker] ?? c.basePrice;
          }
        });
        setPrices(mergedPrices);
        setPriceHistory(data.priceHistory || {});
        setMarketData(data);
        setLaunchedTickers(launched);
      } else {
        // Initialize market data if it doesn't exist
        const initialPrices = {};
        const initialHistory = {};
        CHARACTERS.forEach(c => {
          // Skip characters that require IPO - they'll be added when IPO launches
          if (!c.ipoRequired) {
            initialPrices[c.ticker] = c.basePrice;
            initialHistory[c.ticker] = [{ timestamp: Date.now(), price: c.basePrice }];
          }
        });

        setDoc(marketRef, {
          prices: initialPrices,
          priceHistory: initialHistory,
          launchedTickers: [], // Initialize empty launched tickers array
          lastUpdate: serverTimestamp(),
          totalTrades: 0
        }, { merge: true }).catch(err => {
          console.error('Failed to initialize market data:', err);
        });

        setPrices(initialPrices);
        setPriceHistory(initialHistory);
        setLaunchedTickers([]);
      }
    });

    return () => unsubscribe();
  }, []);

  // Auto-add price history entries and run tiered pruning
  useEffect(() => {
    if (!user) return;

    const TWELVE_HOURS = 12 * 60 * 60 * 1000;
    const ONE_DAY = 24 * 60 * 60 * 1000;
    const SEVEN_DAYS = 7 * ONE_DAY;
    const ONE_YEAR = 365 * ONE_DAY;

    // Prune history based on age tiers
    const pruneHistoryTiers = (history, now) => {
      if (!history || history.length === 0) return { mainDoc: [], archive: [] };

      const tier1Cutoff = now - ONE_DAY;       // < 24h: keep all
      const tier2Cutoff = now - SEVEN_DAYS;    // 24h-7d: 1 per hour
      const tier3Cutoff = now - ONE_YEAR;      // 7d-1y: 1 per day (archive)
      // > 1y: 1 per week (archive)

      const tier1 = []; // < 24h - keep all
      const tier2 = []; // 24h-7d - will prune to hourly
      const tier3 = []; // 7d-1y - will prune to daily
      const tier4 = []; // > 1y - will prune to weekly

      // Sort into tiers
      for (const point of history) {
        if (point.timestamp >= tier1Cutoff) {
          tier1.push(point);
        } else if (point.timestamp >= tier2Cutoff) {
          tier2.push(point);
        } else if (point.timestamp >= tier3Cutoff) {
          tier3.push(point);
        } else {
          tier4.push(point);
        }
      }

      // Prune tier 2 to 1 point per hour
      const prunedTier2 = [];
      const seenHours2 = new Set();
      for (const point of tier2.sort((a, b) => b.timestamp - a.timestamp)) {
        const hourKey = Math.floor(point.timestamp / (60 * 60 * 1000));
        if (!seenHours2.has(hourKey)) {
          seenHours2.add(hourKey);
          prunedTier2.push(point);
        }
      }

      // Prune tier 3 to 1 point per day (daily close - last point of each day)
      const prunedTier3 = [];
      const seenDays3 = new Set();
      for (const point of tier3.sort((a, b) => b.timestamp - a.timestamp)) {
        const dayKey = Math.floor(point.timestamp / ONE_DAY);
        if (!seenDays3.has(dayKey)) {
          seenDays3.add(dayKey);
          prunedTier3.push(point);
        }
      }

      // Prune tier 4 to 1 point per week
      const prunedTier4 = [];
      const seenWeeks4 = new Set();
      const ONE_WEEK = 7 * ONE_DAY;
      for (const point of tier4.sort((a, b) => b.timestamp - a.timestamp)) {
        const weekKey = Math.floor(point.timestamp / ONE_WEEK);
        if (!seenWeeks4.has(weekKey)) {
          seenWeeks4.add(weekKey);
          prunedTier4.push(point);
        }
      }

      // Main doc: tier 1 + pruned tier 2 (last 7 days)
      const mainDoc = [...prunedTier2, ...tier1].sort((a, b) => a.timestamp - b.timestamp);

      // Archive: pruned tier 3 + pruned tier 4 (older than 7 days)
      const archive = [...prunedTier4, ...prunedTier3].sort((a, b) => a.timestamp - b.timestamp);

      return { mainDoc, archive };
    };

    const checkAndUpdatePriceHistory = async () => {
      const marketRef = doc(db, 'market', 'current');
      const now = Date.now();

      // First, fetch all archive data outside the transaction
      const archiveData = {};
      for (const character of CHARACTERS) {
        const ticker = character.ticker;
        const archiveRef = doc(db, 'market', 'current', 'price_history', ticker);
        const archiveSnap = await getDoc(archiveRef);
        archiveData[ticker] = archiveSnap.exists() ? (archiveSnap.data().history || []) : [];
      }

      let archiveUpdates = [];

      // Use transaction to prevent race conditions with trade updates
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(marketRef);

        if (!snap.exists()) return;

        const data = snap.data();
        const currentPrices = data.prices || {};
        const currentHistory = data.priceHistory || {};

        const mainDocUpdates = {};

        for (const character of CHARACTERS) {
          const ticker = character.ticker;
          const currentPrice = currentPrices[ticker] || character.basePrice;
          let history = [...(currentHistory[ticker] || [])];

          // Check if we need to add a new 12-hour entry
          const lastEntry = history[history.length - 1];
          const lastTimestamp = lastEntry?.timestamp || 0;
          const needsNewEntry = now - lastTimestamp >= TWELVE_HOURS;

          if (needsNewEntry) {
            history.push({ timestamp: now, price: currentPrice });
          }

          // Combine main doc history with archive for full pruning
          const existingArchive = archiveData[ticker] || [];
          const fullHistory = [...existingArchive, ...history];

          // Run tiered pruning
          const { mainDoc, archive } = pruneHistoryTiers(fullHistory, now);

          // Only update if something changed
          const historyChanged = needsNewEntry ||
            mainDoc.length !== (currentHistory[ticker] || []).length ||
            archive.length !== existingArchive.length;

          if (historyChanged) {
            mainDocUpdates[`priceHistory.${ticker}`] = mainDoc;

            if (archive.length > 0 || existingArchive.length > 0) {
              archiveUpdates.push({ ticker, history: archive });
            }
          }
        }

        // Update main document within transaction
        if (Object.keys(mainDocUpdates).length > 0) {
          transaction.update(marketRef, mainDocUpdates);
          console.log(`Updating price history for ${Object.keys(mainDocUpdates).length} characters`);
        }
      });

      // Update archive sub-collection documents (after transaction completes)
      for (const { ticker, history } of archiveUpdates) {
        const archiveRef = doc(db, 'market', 'current', 'price_history', ticker);
        await setDoc(archiveRef, { history, lastUpdated: now }, { merge: true });
      }

      if (archiveUpdates.length > 0) {
        console.log(`Archived history for ${archiveUpdates.length} characters`);
      }
    };

    // Run immediately on mount
    checkAndUpdatePriceHistory();

    // Then check every hour (will only update if 12h passed for new entries, but prunes on each run)
    const interval = setInterval(checkAndUpdatePriceHistory, 60 * 60 * 1000);

    return () => clearInterval(interval);
  }, [user]);

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
              [`priceHistory.${ipo.ticker}`]: arrayUnion({ timestamp: now, price: newPrice }),
              launchedTickers: arrayUnion(ipo.ticker) // Mark character as launched
            });

            // Mark IPO as price jumped
            const updatedList = ipos.map(i =>
              i.ticker === ipo.ticker ? { ...i, priceJumped: true } : i
            );
            await updateDoc(ipoRef, { list: updatedList });

            // Calculate IPO stats and send Discord notification
            try {
              const sharesSold = IPO_TOTAL_SHARES - (ipo.sharesRemaining || 0);
              const ipoPrice = ipo.basePrice / 1.3;
              const totalInvested = sharesSold * ipoPrice;

              // Query users to count participants
              const usersSnapshot = await getDocs(collection(db, 'users'));
              let participants = 0;
              usersSnapshot.forEach((userDoc) => {
                const userData = userDoc.data();
                if (userData.holdings && userData.holdings[ipo.ticker] > 0) {
                  participants++;
                }
              });

              const character = CHARACTER_MAP[ipo.ticker];
              await ipoClosingAlertFunction({
                ticker: ipo.ticker,
                characterName: character?.name || ipo.ticker,
                participants,
                totalInvested: Math.round(totalInvested * 100) / 100,
                totalShares: sharesSold
              });
            } catch (discordErr) {
              console.error('Failed to send IPO closing notification:', discordErr);
              // Don't block IPO closing if Discord fails
            }
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

  // Initialize weekly mission data if new week
  useEffect(() => {
    const initializeWeeklyMissions = async () => {
      if (!user || !userData || !prices || Object.keys(prices).length === 0) return;

      const weekId = getWeekId();
      const weeklyData = userData.weeklyMissions?.[weekId];

      // If no data for this week yet, or no startPortfolioValue set, initialize it
      if (!weeklyData || weeklyData.startPortfolioValue === undefined) {
        // Calculate current portfolio value
        const holdingsValue = Object.entries(userData.holdings || {})
          .reduce((sum, [ticker, shares]) => sum + (prices[ticker] || 0) * shares, 0);
        const currentPortfolioValue = Math.round(((userData.cash || 0) + holdingsValue) * 100) / 100;

        const userRef = doc(db, 'users', user.uid);
        await updateDoc(userRef, {
          [`weeklyMissions.${weekId}.startPortfolioValue`]: currentPortfolioValue
        });
      }
    };

    initializeWeeklyMissions();
  }, [user, userData?.weeklyMissions, prices]);

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

  // Handle predictions collapse state - auto-expand when predictions change
  const predictionsLoadedRef = useRef(false);
  const lastPredictionsIdRef = useRef(null);

  useEffect(() => {
    if (predictions.length === 0) return;

    const predictionsId = getPredictionsIdentifier(predictions);

    // First time predictions load
    if (!predictionsLoadedRef.current) {
      predictionsLoadedRef.current = true;
      lastPredictionsIdRef.current = predictionsId;
      return; // Don't change state - useState already loaded from localStorage
    }

    // Check if predictions changed
    if (lastPredictionsIdRef.current !== predictionsId) {
      lastPredictionsIdRef.current = predictionsId;
      setShowPredictions(true); // Auto-expand on new predictions
    }
  }, [predictions]);

  // Persist predictions collapse state
  useEffect(() => {
    const predictionsId = getPredictionsIdentifier(predictions);
    saveCollapsedState('showPredictions', showPredictions, predictionsId);
  }, [showPredictions, predictions]);

  // Handle new characters collapse state - reset on new week
  useEffect(() => {
    const currentWeek = getWeekIdentifier();
    const stored = localStorage.getItem('showNewCharacters');

    if (stored) {
      try {
        const { identifier } = JSON.parse(stored);
        // If week has changed, reset to expanded
        if (identifier !== currentWeek) {
          setShowNewCharacters(true);
        }
      } catch {
        // Ignore errors
      }
    }
  }, []); // Only run on mount

  // Persist new characters collapse state
  useEffect(() => {
    const currentWeek = getWeekIdentifier();
    saveCollapsedState('showNewCharacters', showNewCharacters, currentWeek);
  }, [showNewCharacters]);

  // Auto-process payouts when prediction is resolved
  useEffect(() => {
    const processPayouts = async () => {
      if (!user || !userData || !userData.bets) return;

      for (const prediction of predictions) {
        if (!prediction.resolved || prediction.payoutsProcessed) continue;

        const userBet = userData.bets[prediction.id];
        if (!userBet || userBet.paid) continue;

        try {
          // Check if user won
          if (userBet.option === prediction.outcome) {
            // Calculate payout
            const options = prediction.options || ['Yes', 'No'];
            const pools = prediction.pools || {};
            const winningPool = pools[prediction.outcome] || 0;
            const totalPool = options.reduce((sum, opt) => sum + (pools[opt] || 0), 0);

            // Calculate payout - if pools are somehow 0, at minimum return the bet amount
            let payout = userBet.amount; // Default: return original bet
            if (winningPool > 0 && totalPool > 0) {
              const userShare = userBet.amount / winningPool;
              payout = userShare * totalPool;
            }

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
            console.log(`[Payout] Processed winning bet for prediction ${prediction.id}: +${payout}`);

            // Show achievement notification if earned, otherwise payout notification
            if (newAchievements.length > 0) {
              const achievement = ACHIEVEMENTS[newAchievements[0]];
              showNotification('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked! +${formatCurrency(payout)} payout!`);
            } else {
              showNotification('success', `🎉 Prediction payout: +${formatCurrency(payout)}!`);
            }
          } else {
            // Mark losing bet as processed
            const userRef = doc(db, 'users', user.uid);
            await updateDoc(userRef, {
              [`bets.${prediction.id}.paid`]: true,
              [`bets.${prediction.id}.payout`]: 0
            });
            console.log(`[Payout] Processed losing bet for prediction ${prediction.id}`);
          }
        } catch (error) {
          console.error(`[Payout] Failed to process payout for prediction ${prediction.id}:`, error);
          // Don't show error to user - the payout will be retried on next render
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
        
        // Deduct any losses beyond margin from cash (can go negative - triggers bankruptcy)
        const newCash = Math.round((userData.cash - totalLoss) * 100) / 100;
        updateData.cash = newCash;

        // Mark bankruptcy if going negative
        if (newCash < 0) {
          updateData.bankruptAt = Date.now();
        }

        await updateDoc(userRef, updateData);

        const tickerList = liquidations.map(l => l.ticker).join(', ');
        if (newCash < 0) {
          showNotification('error', `💀 BANKRUPT: ${tickerList} liquidated. You owe ${formatCurrency(Math.abs(newCash))}`);
        } else {
          showNotification('error', `⚠️ MARGIN CALL: ${tickerList} position(s) liquidated!`);
        }
      }
    };
    
    checkMarginCalls();
  }, [user, userData, prices]);

  // Calculate sentiment based on price changes
  const getSentiment = useCallback((ticker) => {
    const currentPrice = prices[ticker];
    if (!currentPrice) return 'Neutral';

    const history = priceHistory[ticker] || [];
    const now = Date.now();
    const dayAgo = now - (24 * 60 * 60 * 1000);
    const weekAgo = now - (7 * 24 * 60 * 60 * 1000);

    // Find 24h ago price
    let price24hAgo = currentPrice;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].timestamp <= dayAgo) {
        price24hAgo = history[i].price;
        break;
      }
    }
    if (price24hAgo === currentPrice && history.length > 0) {
      price24hAgo = history[0].price; // Use oldest if no 24h data
    }

    // Find 7d ago price
    let price7dAgo = currentPrice;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].timestamp <= weekAgo) {
        price7dAgo = history[i].price;
        break;
      }
    }
    if (price7dAgo === currentPrice && history.length > 0) {
      price7dAgo = history[0].price; // Use oldest if no 7d data
    }

    // Calculate changes
    const dailyChange = price24hAgo > 0 ? ((currentPrice - price24hAgo) / price24hAgo) * 100 : 0;
    const weeklyChange = price7dAgo > 0 ? ((currentPrice - price7dAgo) / price7dAgo) * 100 : 0;

    // Weighted: 60% daily, 40% weekly
    const weightedChange = (dailyChange * 0.6) + (weeklyChange * 0.4);

    // Thresholds
    if (weightedChange > 3) return 'Strong Buy';
    if (weightedChange > 1) return 'Bullish';
    if (weightedChange < -3) return 'Strong Sell';
    if (weightedChange < -1) return 'Bearish';
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
        const updatedHistory = [...currentHistory, { timestamp: now, price: newPrice }];

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

    // Block if user is in debt
    if ((userData.cash || 0) < 0) {
      showNotification('error', 'You cannot join a crew while in debt. Pay off your balance first.');
      return;
    }

    // Check if user was exiled from this crew (in crew history)
    const crewHistory = userData.crewHistory || [];
    if (crewHistory.includes(crewId)) {
      const crewName = CREW_MAP[crewId]?.name || 'this crew';
      showNotification('error', `You have been permanently exiled from ${crewName}.`);
      return;
    }

    // Check 24-hour cooldown for joining/switching crews
    const lastChange = userData.lastCrewChange || 0;
    const hoursSinceChange = (Date.now() - lastChange) / (1000 * 60 * 60);
    if (hoursSinceChange < 24) {
      const hoursRemaining = Math.ceil(24 - hoursSinceChange);
      if (isSwitch && userData.crew) {
        showNotification('error', `You can only switch crews once every 24 hours. Try again in ${hoursRemaining}h.`);
      } else if (!userData.crew) {
        showNotification('error', `You cannot join a crew yet. Try again in ${hoursRemaining}h.`);
      }
      return;
    }

    try {
      const userRef = doc(db, 'users', user.uid);
      const now = Date.now();
      const updateData = {
        crew: crewId,
        crewJoinedAt: now,
        crewHistory: arrayUnion(crewId) // Track crew history
      };

      // Only charge penalty if LEAVING a crew to join another (switching)
      if (isSwitch && userData.crew) {
        // Take 15% of cash and 15% of each holding
        const penaltyRate = 0.15;
        const newCash = Math.floor(userData.cash * (1 - penaltyRate));
        const cashTaken = userData.cash - newCash;
        
        const newHoldings = {};
        let holdingsValueTaken = 0;
        
        Object.entries(userData.holdings || {}).forEach(([ticker, shares]) => {
          if (shares > 0) {
            // Take 15% of shares, rounding to nearest (round up if .5 or more)
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
        updateData.lastCrewChange = Date.now();

        const crew = CREW_MAP[crewId];
        await updateDoc(userRef, updateData);

        showNotification('success', `Switched to ${crew.name}! Lost ${formatCurrency(totalTaken)} (15% penalty)`);
      } else {
        // Joining a crew (no existing crew) - no cost
        await updateDoc(userRef, updateData);
        
        const crew = CREW_MAP[crewId];
        showNotification('success', `Welcome to ${crew.name}! ${crew.emblem}`);
      }
      
    } catch (err) {
      console.error('Failed to select crew:', err);
      showNotification('error', 'Failed to join crew');
    }
  }, [user, userData, prices]);

  // Handle leaving crew
  const handleCrewLeave = useCallback(async () => {
    if (!user || !userData || !userData.crew) return;

    // Block if user is in debt
    if ((userData.cash || 0) < 0) {
      showNotification('error', 'You cannot leave your crew while in debt.');
      return;
    }

    try {
      const userRef = doc(db, 'users', user.uid);
      const oldCrew = CREW_MAP[userData.crew];
      
      // Calculate 15% penalty from portfolio
      // Take 15% of cash and 15% of each holding
      const penaltyRate = 0.15;
      const newCash = Math.floor(userData.cash * (1 - penaltyRate));
      const cashTaken = userData.cash - newCash;
      
      const newHoldings = {};
      const holdingsTaken = {};
      let holdingsValueTaken = 0;
      
      Object.entries(userData.holdings || {}).forEach(([ticker, shares]) => {
        if (shares > 0) {
          // Take 15% of shares, rounding to nearest (round up if .5 or more)
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
        portfolioValue: Math.max(0, newPortfolioValue),
        lastCrewChange: Date.now()
      };

      await updateDoc(userRef, updateData);

      showNotification('warning', `Left ${oldCrew?.name || 'crew'}. Lost ${formatCurrency(totalTaken)} (15% penalty). You cannot join a new crew for 24 hours.`);
    } catch (err) {
      console.error('Failed to leave crew:', err);
      showNotification('error', 'Failed to leave crew');
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
        const displayIcon = pin.image ? `/pins/${pin.image}` : null;
        const displayText = pin.image ? `Purchased ${pin.name}!` : `Purchased ${pin.emoji} ${pin.name}!`;
        showNotification('success', displayText, displayIcon);
        
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
        showNotification('success', `Unlocked extra ${payload} pin slot!`);
      }
    } catch (err) {
      console.error('Pin action failed:', err);
      showNotification('error', 'Action failed');
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
      
      // Add to activity feed
      addActivity('mission', `📋 Mission complete! +${formatCurrency(reward)}`);
      
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
        addActivity('achievement', `🏆 ${earnedAchievement.emoji} ${earnedAchievement.name} unlocked!`);
        showNotification('achievement', `🏆 ${earnedAchievement.emoji} ${earnedAchievement.name} unlocked!`);
      } else {
        showNotification('success', `Claimed ${formatCurrency(reward)} mission reward!`);
      }
    } catch (err) {
      console.error('Failed to claim reward:', err);
      showNotification('error', 'Failed to claim reward');
    }
  }, [user, userData, addActivity]);

  // Handle claiming weekly mission rewards
  const handleClaimWeeklyMissionReward = useCallback(async (missionId, reward) => {
    if (!user || !userData) return;

    try {
      const userRef = doc(db, 'users', user.uid);
      const weekId = getWeekId();
      const currentTotalMissions = userData.totalMissionsCompleted || 0;
      const newTotalMissions = currentTotalMissions + 1;

      await updateDoc(userRef, {
        [`weeklyMissions.${weekId}.claimed.${missionId}`]: true,
        cash: userData.cash + reward,
        totalMissionsCompleted: newTotalMissions
      });

      // Add to activity feed
      addActivity('mission', `📋 Weekly mission complete! +${formatCurrency(reward)}`);

      // Check for mission achievements (same as daily)
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
        addActivity('achievement', `🏆 ${earnedAchievement.emoji} ${earnedAchievement.name} unlocked!`);
        showNotification('achievement', `🏆 ${earnedAchievement.emoji} ${earnedAchievement.name} unlocked!`);
      } else {
        showNotification('success', `Claimed ${formatCurrency(reward)} weekly mission reward!`);
      }
    } catch (err) {
      console.error('Failed to claim weekly reward:', err);
      showNotification('error', 'Failed to claim reward');
    }
  }, [user, userData, addActivity]);

  // Request trade confirmation
  const requestTrade = useCallback((ticker, action, amount) => {
    if (!user || !userData) {
      showNotification('info', 'Sign in to start trading!');
      return;
    }
    
    // Check if character is in IPO phase (not tradeable normally)
    const now = Date.now();
    const activeIPO = activeIPOs.find(ipo => ipo.ticker === ticker && !ipo.priceJumped && now < ipo.ipoEndsAt);
    if (activeIPO) {
      const inHypePhase = now < activeIPO.ipoStartsAt;
      showNotification('error', inHypePhase 
        ? `$${ticker} is in IPO hype phase - trading opens soon!` 
        : `$${ticker} is in IPO - buy through the IPO section above!`);
      return;
    }
    
    // Check if character requires IPO but hasn't launched yet
    const character = CHARACTER_MAP[ticker];
    if (character?.ipoRequired && !launchedTickers.includes(ticker)) {
      showNotification('error', `$${ticker} requires an IPO before trading`);
      return;
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
    console.log(`[TRADE START] ticker=${ticker}, action=${action}, amount=${amount}`);
    if (!user || !userData) {
      showNotification('info', 'Sign in to start trading!');
      return;
    }

    // Block buying/shorting if user is in debt (selling/covering allowed)
    if ((userData.cash || 0) < 0 && (action === 'buy' || action === 'short')) {
      showNotification('error', 'You cannot open new positions while in debt. Request a bailout to start fresh.');
      return;
    }

    // SECURITY: Server-side validation BEFORE executing trade
    // This enforces cooldown, validates cash/holdings using server timestamp
    try {
      const validationResult = await validateTradeFunction({ ticker, action, amount });
      if (!validationResult.data.valid) {
        showNotification('error', 'Trade validation failed');
        return;
      }
      console.log('[TRADE VALIDATED]', validationResult.data);
    } catch (error) {
      console.error('[TRADE VALIDATION ERROR]', error);
      const message = error.message || 'Trade validation failed';
      // Extract user-friendly error message
      if (message.includes('Trade cooldown:')) {
        showNotification('error', message.replace(/^.*: /, ''));
      } else if (message.includes('Hold period:')) {
        showNotification('error', message.replace(/^.*: /, ''));
      } else if (message.includes('Short limit')) {
        // Show the full short limit message with time remaining
        showNotification('error', message.replace(/^.*: /, ''));
      } else if (message.includes('Insufficient')) {
        showNotification('error', message.replace(/^.*: /, ''));
      } else {
        showNotification('error', 'Cannot execute trade at this time');
      }
      return;
    }

    // SECURITY: Use server timestamp via Firestore serverTimestamp()
    // This prevents client-side clock manipulation
    const serverTime = serverTimestamp();

    // Trade cooldown - client-side check as backup
    const now = Date.now();
    const lastTrade = toMillis(userData.lastTradeTime);
    const cooldownMs = 3000; // 3 second cooldown

    if (now - lastTrade < cooldownMs) {
      const remaining = Math.ceil((cooldownMs - (now - lastTrade)) / 1000);
      showNotification('error', `Please wait ${remaining}s between trades`);
      return;
    }

    const asset = CHARACTER_MAP[ticker];
    // Use priceHistory as source of truth (prices object can be stale/corrupted)
    const history = priceHistory[ticker];
    let price;
    if (history && history.length > 0) {
      price = history[history.length - 1].price;
    } else {
      price = prices[ticker] || asset?.basePrice;
    }
    if (!price || isNaN(price)) {
      showNotification('error', 'Price unavailable, try again');
      return;
    }
    
    const basePrice = asset?.basePrice || price;
    const userRef = doc(db, 'users', user.uid);
    const marketRef = doc(db, 'market', 'current');

    if (action === 'buy') {
      // Get liquidity for this character
      const liquidity = getCharacterLiquidity(ticker);

      // Get today's date for daily impact tracking
      const todayDate = new Date().toISOString().split('T')[0]; // "2026-01-31"
      const userDailyImpact = userData.dailyImpact?.[todayDate]?.[ticker] || 0;

      // Calculate price impact using square root model (with daily impact limit)
      const priceImpact = calculatePriceImpact(price, amount, liquidity, userDailyImpact);
      const newMidPrice = price + priceImpact;
      
      // You pay the ASK price (mid + half spread) - this is realistic market friction
      const { ask } = getBidAskPrices(newMidPrice);
      const buyPrice = ask;
      const totalCost = buyPrice * amount;
      
      // Check if user has enough cash or can use margin
      const cashAvailable = userData.cash || 0;
      const marginEnabled = userData.marginEnabled || false;
      const marginUsed = userData.marginUsed || 0;
      const marginStatus = calculateMarginStatus(userData, prices, priceHistory);
      const availableMargin = marginStatus.availableMargin || 0;

      let cashToUse = 0;
      let marginToUse = 0;

      if (cashAvailable >= totalCost) {
        // Can pay with cash only
        cashToUse = totalCost;
        marginToUse = 0;
      } else if (marginEnabled && availableMargin > 0) {
        // Cash-based margin: use all available margin (already capped by cash * tierMultiplier)
        const maxBuyingPower = cashAvailable + availableMargin;

        if (totalCost > maxBuyingPower) {
          showNotification('error', `Insufficient funds! Need ${formatCurrency(totalCost)}. Max buying power: ${formatCurrency(maxBuyingPower)} (${formatCurrency(cashAvailable)} cash + ${formatCurrency(availableMargin)} margin)`);
          return;
        }

        // Use cash first, then margin
        cashToUse = cashAvailable;
        marginToUse = totalCost - cashAvailable;
      } else {
        // Not enough funds even with margin
        if (marginEnabled) {
          showNotification('error', `Insufficient funds! Need ${formatCurrency(totalCost)}, have ${formatCurrency(cashAvailable)} cash`);
        } else {
          showNotification('error', 'Insufficient funds!');
        }
        return;
      }

      // Market settles at new mid price (not ask)
      const settledPrice = Math.round(newMidPrice * 100) / 100;

      // Build market updates
      // SECURITY: Use local timestamp for price history (displayed in charts)
      // but validate on server that trades aren't happening too quickly
      // COLLISION PROTECTION: Prevent timestamp collisions during rapid trades
      const history = priceHistory[ticker] || [];
      const lastTimestamp = history.length > 0 ? history[history.length - 1].timestamp : 0;
      const now = Date.now();
      const priceHistoryTimestamp = now > lastTimestamp ? now : lastTimestamp + 1;
      const marketUpdates = {
        [`prices.${ticker}`]: settledPrice,
        [`volume.${ticker}`]: increment(amount), // Track trading volume
        [`priceHistory.${ticker}`]: arrayUnion({ timestamp: priceHistoryTimestamp, price: settledPrice })
      };

      // Apply trailing stock factor effects (recursive with depth limit)
      const applyTrailingEffects = (sourceTicker, sourceOldPrice, sourceNewPrice, depth = 0, visited = new Set()) => {
        console.log(`[TRAILING] depth=${depth}, ticker=${sourceTicker}, oldPrice=${sourceOldPrice}, newPrice=${sourceNewPrice}, visited=${Array.from(visited).join(',')}`);

        if (depth > 3 || visited.has(sourceTicker)) {
          console.log(`[TRAILING] Skipping ${sourceTicker} - depth=${depth}, inVisited=${visited.has(sourceTicker)}`);
          return; // Max 3 levels deep, prevent cycles
        }
        visited.add(sourceTicker);

        const character = CHARACTER_MAP[sourceTicker];
        if (!character?.trailingFactors) {
          console.log(`[TRAILING] ${sourceTicker} has no trailingFactors`);
          return;
        }

        const priceChangePercent = (sourceNewPrice - sourceOldPrice) / sourceOldPrice;
        console.log(`[TRAILING] ${sourceTicker} price changed ${(priceChangePercent * 100).toFixed(2)}%, processing ${character.trailingFactors.length} followers`);

        character.trailingFactors.forEach(({ ticker: relatedTicker, coefficient }) => {
          // Skip if we've already updated this ticker in this batch
          if (visited.has(relatedTicker)) {
            console.log(`[TRAILING] Skipping ${relatedTicker} - already visited`);
            return;
          }

          // Get current price - check marketUpdates first, then fall back to prices
          const oldRelatedPrice = marketUpdates[`prices.${relatedTicker}`] || prices[relatedTicker];
          if (oldRelatedPrice) {
            const trailingChange = priceChangePercent * coefficient;
            const newRelatedPrice = oldRelatedPrice * (1 + trailingChange);
            const settledRelatedPrice = Math.max(MIN_PRICE, Math.round(newRelatedPrice * 100) / 100);

            console.log(`[TRAILING] Updating ${relatedTicker}: $${oldRelatedPrice} -> $${settledRelatedPrice} (${(trailingChange * 100).toFixed(2)}% from ${sourceTicker})`);

            marketUpdates[`prices.${relatedTicker}`] = settledRelatedPrice;
            marketUpdates[`priceHistory.${relatedTicker}`] = arrayUnion({
              timestamp: priceHistoryTimestamp,
              price: settledRelatedPrice
            });

            // Recursively apply trailing effects with shared visited set (no cloning)
            applyTrailingEffects(relatedTicker, oldRelatedPrice, settledRelatedPrice, depth + 1, visited);
          }
        });
      };

      console.log(`[TRAILING START] About to call applyTrailingEffects for ${ticker}: $${price} -> $${settledPrice}`);
      applyTrailingEffects(ticker, price, settledPrice);
      console.log(`[TRAILING END] Finished applyTrailingEffects for ${ticker}`);

      // Atomic price + history update (prevents data loss if one write fails)
      await updateDoc(marketRef, marketUpdates);

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
      const weekId = getWeekId();
      const userCrew = userData.crew;
      const crewMembers = userCrew ? CREW_MAP[userCrew]?.members || [] : [];
      const isBuyingCrewMember = crewMembers.includes(ticker);
      const currentCrewSharesBought = userData.dailyMissions?.[today]?.crewSharesBought || 0;

      // Check if buying a rival (any crew member that's not user's crew)
      const isRival = !isBuyingCrewMember && Object.values(CREWS).some(crew => crew.members.includes(ticker));

      // Check if underdog (price under $20)
      const isUnderdog = price < 20;

      // Calculate trade value for weekly missions
      const tradeValue = amount * buyPrice;

      // Track actual impact applied for anti-manipulation limits
      const rawImpactPercent = Math.abs(priceImpact / price);
      const newDailyImpact = userDailyImpact + rawImpactPercent;

      // Update user with trade count, cost basis, last buy time, and daily/weekly mission progress
      // SECURITY: Use server timestamp for lastTradeTime to prevent race conditions
      const updateData = {
        cash: cashAvailable - cashToUse,
        marginUsed: marginUsed + marginToUse,
        [`holdings.${ticker}`]: newHoldings,
        [`costBasis.${ticker}`]: Math.round(newCostBasis * 100) / 100,
        [`lowestWhileHolding.${ticker}`]: Math.round(newLowest * 100) / 100,
        [`lastBuyTime.${ticker}`]: serverTime,
        [`lastTickerTradeTime.${ticker}`]: serverTime,
        lastTradeTime: serverTime,
        totalTrades: increment(1),
        // Daily impact tracking (anti-manipulation)
        [`dailyImpact.${todayDate}.${ticker}`]: newDailyImpact,
        // Daily missions
        [`dailyMissions.${today}.tradesCount`]: increment(1),
        [`dailyMissions.${today}.tradeVolume`]: increment(amount),
        [`dailyMissions.${today}.boughtAny`]: true,
        // Weekly missions
        [`weeklyMissions.${weekId}.tradeValue`]: increment(tradeValue),
        [`weeklyMissions.${weekId}.tradeVolume`]: increment(amount),
        [`weeklyMissions.${weekId}.tradeCount`]: increment(1),
        [`weeklyMissions.${weekId}.tradingDays.${today}`]: true
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

      // SECURITY: Record trade in Cloud Functions for auditing & fraud detection
      recordTradeFunction({
        ticker,
        action: 'BUY',
        amount,
        price: buyPrice,
        totalValue: totalCost,
        cashBefore: cashAvailable,
        cashAfter: cashAvailable - cashToUse,
        portfolioAfter: Math.round(newPortfolioValue * 100) / 100
      }).catch(err => console.error('[RECORD TRADE ERROR]', err));

      // Check achievements (pass trade value for Shark achievement)
      const earnedAchievements = await checkAndAwardAchievements(userRef, {
        ...userData,
        cash: cashAvailable - cashToUse,
        holdings: { ...userData.holdings, [ticker]: (userData.holdings[ticker] || 0) + amount },
        totalTrades: (userData.totalTrades || 0) + 1
      }, prices, { tradeValue: totalCost });
      
      const impactPercent = ((newMidPrice - price) / price * 100).toFixed(2);
      
      // Add to activity feed
      const charName = CHARACTERS.find(c => c.ticker === ticker)?.name || ticker;
      addActivity('trade', `Bought ${amount} $${ticker} (${charName}) @ ${formatCurrency(buyPrice)}`);
      
      if (earnedAchievements.length > 0) {
        const achievement = ACHIEVEMENTS[earnedAchievements[0]];
        addActivity('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked!`);
        showNotification('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked! Bought ${amount} ${ticker}`);
        // Send achievement alert to Discord
        try {
          achievementAlertFunction({
            achievementId: earnedAchievements[0],
            achievementName: achievement.name,
            achievementDescription: achievement.description
          }).catch(() => {}); // Fire and forget
        } catch {}
      } else {
        let message = `Bought ${amount} ${ticker} @ ${formatCurrency(buyPrice)} (${impactPercent > 0 ? '+' : ''}${impactPercent}% impact)`;

        // Warn if approaching daily impact limit
        if (newDailyImpact >= MAX_DAILY_IMPACT_PER_USER) {
          message += ' • Daily impact limit reached for this ticker';
        } else if (newDailyImpact >= MAX_DAILY_IMPACT_PER_USER * 0.8) {
          const remaining = ((MAX_DAILY_IMPACT_PER_USER - newDailyImpact) * 100).toFixed(1);
          message += ` • ${remaining}% impact remaining today`;
        }

        showNotification('success', message);
      }

      // Send trade spike alert if price moved 1%+
      if (Math.abs(parseFloat(impactPercent)) >= 1) {
        try {
          tradeSpikeAlertFunction({
            ticker,
            priceBefore: price,
            priceAfter: settledPrice,
            tradeType: 'BUY',
            shares: amount
          }).catch(() => {}); // Fire and forget
        } catch {}
      }

    } else if (action === 'sell') {
      const currentHoldings = userData.holdings[ticker] || 0;
      if (currentHoldings < amount) {
        showNotification('error', 'Not enough shares!');
        return;
      }

      // Holding period check - must hold shares for 45 seconds before selling
      const HOLDING_PERIOD_MS = 45 * 1000; // 45 seconds
      const lastBuyTime = toMillis(userData.lastBuyTime?.[ticker]);
      const timeSinceBuy = now - lastBuyTime;
      
      if (lastBuyTime > 0 && timeSinceBuy < HOLDING_PERIOD_MS) {
        const remainingMs = HOLDING_PERIOD_MS - timeSinceBuy;
        const remainingMins = Math.ceil(remainingMs / 60000);
        const remainingSecs = Math.ceil((remainingMs % 60000) / 1000);
        const timeStr = remainingMins > 1 ? `${remainingMins} min` : `${remainingSecs} sec`;
        showNotification('error', `Hold period: wait ${timeStr} before selling ${ticker}`);
        return;
      }

      // Get liquidity for this character
      const liquidity = getCharacterLiquidity(ticker);

      // Get today's date for daily impact tracking
      const todayDate = new Date().toISOString().split('T')[0]; // "2026-01-31"
      const userDailyImpact = userData.dailyImpact?.[todayDate]?.[ticker] || 0;

      // Calculate price impact using square root model (selling pushes price down, with daily impact limit)
      const priceImpact = calculatePriceImpact(price, amount, liquidity, userDailyImpact);
      const newMidPrice = Math.max(MIN_PRICE, price - priceImpact);
      
      // You get the BID price (mid - half spread) - market friction
      const { bid } = getBidAskPrices(newMidPrice);
      const sellPrice = Math.max(MIN_PRICE, bid);
      const totalRevenue = sellPrice * amount;

      // Market settles at new mid price
      const settledPrice = Math.round(newMidPrice * 100) / 100;

      // Build market updates
      // SECURITY: Use local timestamp for price history (displayed in charts)
      const priceHistoryTimestamp = Date.now();
      const marketUpdates = {
        [`prices.${ticker}`]: settledPrice,
        [`volume.${ticker}`]: increment(amount),
        [`priceHistory.${ticker}`]: arrayUnion({ timestamp: priceHistoryTimestamp, price: settledPrice })
      };

      // Apply trailing stock factor effects (recursive with depth limit)
      const applyTrailingEffects = (sourceTicker, sourceOldPrice, sourceNewPrice, depth = 0, visited = new Set()) => {
        console.log(`[TRAILING] depth=${depth}, ticker=${sourceTicker}, oldPrice=${sourceOldPrice}, newPrice=${sourceNewPrice}, visited=${Array.from(visited).join(',')}`);

        if (depth > 3 || visited.has(sourceTicker)) {
          console.log(`[TRAILING] Skipping ${sourceTicker} - depth=${depth}, inVisited=${visited.has(sourceTicker)}`);
          return; // Max 3 levels deep, prevent cycles
        }
        visited.add(sourceTicker);

        const character = CHARACTER_MAP[sourceTicker];
        if (!character?.trailingFactors) {
          console.log(`[TRAILING] ${sourceTicker} has no trailingFactors`);
          return;
        }

        const priceChangePercent = (sourceNewPrice - sourceOldPrice) / sourceOldPrice;
        console.log(`[TRAILING] ${sourceTicker} price changed ${(priceChangePercent * 100).toFixed(2)}%, processing ${character.trailingFactors.length} followers`);

        character.trailingFactors.forEach(({ ticker: relatedTicker, coefficient }) => {
          // Skip if we've already updated this ticker in this batch
          if (visited.has(relatedTicker)) {
            console.log(`[TRAILING] Skipping ${relatedTicker} - already visited`);
            return;
          }

          // Get current price - check marketUpdates first, then fall back to prices
          const oldRelatedPrice = marketUpdates[`prices.${relatedTicker}`] || prices[relatedTicker];
          if (oldRelatedPrice) {
            const trailingChange = priceChangePercent * coefficient;
            const newRelatedPrice = oldRelatedPrice * (1 + trailingChange);
            const settledRelatedPrice = Math.max(MIN_PRICE, Math.round(newRelatedPrice * 100) / 100);

            console.log(`[TRAILING] Updating ${relatedTicker}: $${oldRelatedPrice} -> $${settledRelatedPrice} (${(trailingChange * 100).toFixed(2)}% from ${sourceTicker})`);

            marketUpdates[`prices.${relatedTicker}`] = settledRelatedPrice;
            marketUpdates[`priceHistory.${relatedTicker}`] = arrayUnion({
              timestamp: priceHistoryTimestamp,
              price: settledRelatedPrice
            });

            // Recursively apply trailing effects with shared visited set (no cloning)
            applyTrailingEffects(relatedTicker, oldRelatedPrice, settledRelatedPrice, depth + 1, visited);
          }
        });
      };

      console.log(`[TRAILING START] About to call applyTrailingEffects for ${ticker}: $${price} -> $${settledPrice}`);
      applyTrailingEffects(ticker, price, settledPrice);
      console.log(`[TRAILING END] Finished applyTrailingEffects for ${ticker}`);

      // Atomic price + history update
      await updateDoc(marketRef, marketUpdates);

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
      const weekId = getWeekId();

      // MARGIN DEBT REPAYMENT: Sale proceeds pay down margin debt first
      const currentMarginUsed = userData.marginUsed || 0;
      let marginPayment = 0;
      let cashGain = totalRevenue;

      if (currentMarginUsed > 0) {
        // Pay down margin debt first
        marginPayment = Math.min(totalRevenue, currentMarginUsed);
        cashGain = totalRevenue - marginPayment;
      }

      // Track actual impact applied for anti-manipulation limits
      const rawImpactPercent = Math.abs(priceImpact / price);
      const newDailyImpact = userDailyImpact + rawImpactPercent;

      // Build update data
      // SECURITY: Use server timestamp for lastTradeTime
      const sellUpdateData = {
        cash: userData.cash + cashGain,
        marginUsed: currentMarginUsed - marginPayment,
        [`holdings.${ticker}`]: newHoldings,
        [`costBasis.${ticker}`]: costBasisUpdate,
        [`lastTickerTradeTime.${ticker}`]: serverTime,
        lastTradeTime: serverTime,
        totalTrades: increment(1),
        // Daily impact tracking (anti-manipulation)
        [`dailyImpact.${todayDate}.${ticker}`]: newDailyImpact,
        // Daily missions
        [`dailyMissions.${today}.tradesCount`]: increment(1),
        [`dailyMissions.${today}.tradeVolume`]: increment(amount),
        [`dailyMissions.${today}.soldAny`]: true,
        // Weekly missions
        [`weeklyMissions.${weekId}.tradeValue`]: increment(totalRevenue),
        [`weeklyMissions.${weekId}.tradeVolume`]: increment(amount),
        [`weeklyMissions.${weekId}.tradeCount`]: increment(1),
        [`weeklyMissions.${weekId}.tradingDays.${today}`]: true
      };
      
      // Clear lowestWhileHolding if selling all shares
      if (newHoldings <= 0) {
        sellUpdateData[`lowestWhileHolding.${ticker}`] = deleteField();
      }

      // Update user with trade count and daily mission progress
      await updateDoc(userRef, sellUpdateData);

      await updateDoc(marketRef, { totalTrades: increment(1) });

      // Record portfolio history (using new cash after margin payment)
      const newCash = userData.cash + cashGain;
      const newMarginUsed = currentMarginUsed - marginPayment;
      const newPortfolioValue = newCash + Object.entries(userData.holdings || {})
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
        cashAfter: newCash,
        marginPaid: marginPayment,
        portfolioAfter: Math.round(newPortfolioValue * 100) / 100
      });

      // SECURITY: Record trade in Cloud Functions for auditing & fraud detection
      recordTradeFunction({
        ticker,
        action: 'SELL',
        amount,
        price: sellPrice,
        totalValue: totalRevenue,
        cashBefore: userData.cash,
        cashAfter: newCash,
        portfolioAfter: Math.round(newPortfolioValue * 100) / 100
      }).catch(err => console.error('[RECORD TRADE ERROR]', err));

      // Check achievements (pass profit percent for Bull Run, isDiamondHands for Diamond Hands)
      const earnedAchievements = await checkAndAwardAchievements(userRef, {
        ...userData,
        cash: newCash,
        marginUsed: newMarginUsed,
        holdings: { ...userData.holdings, [ticker]: newHoldings },
        totalTrades: (userData.totalTrades || 0) + 1
      }, prices, { tradeValue: totalRevenue, sellProfitPercent: profitPercent, isDiamondHands });
      
      const impactPercent = ((newMidPrice - price) / price * 100).toFixed(2);
      
      // Add to activity feed
      const charName = CHARACTERS.find(c => c.ticker === ticker)?.name || ticker;
      const profitText = profitPercent >= 0 ? `+${profitPercent.toFixed(1)}%` : `${profitPercent.toFixed(1)}%`;
      addActivity('trade', `Sold ${amount} $${ticker} (${charName}) @ ${formatCurrency(sellPrice)} (${profitText})`);
      
      if (earnedAchievements.length > 0) {
        const achievement = ACHIEVEMENTS[earnedAchievements[0]];
        addActivity('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked!`);
        showNotification('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked! Sold ${amount} ${ticker}`);
        // Send achievement alert to Discord
        try {
          achievementAlertFunction({
            achievementId: earnedAchievements[0],
            achievementName: achievement.name,
            achievementDescription: achievement.description
          }).catch(() => {}); // Fire and forget
        } catch {}
      } else {
        let message = `Sold ${amount} ${ticker} @ ${formatCurrency(sellPrice)} (${impactPercent}% impact)`;
        if (marginPayment > 0) {
          message += ` • Paid ${formatCurrency(marginPayment)} margin debt`;
        }

        // Warn if approaching daily impact limit
        if (newDailyImpact >= MAX_DAILY_IMPACT_PER_USER) {
          message += ' • Daily impact limit reached for this ticker';
        } else if (newDailyImpact >= MAX_DAILY_IMPACT_PER_USER * 0.8) {
          const remaining = ((MAX_DAILY_IMPACT_PER_USER - newDailyImpact) * 100).toFixed(1);
          message += ` • ${remaining}% impact remaining today`;
        }

        showNotification('success', message);
      }

      // Send trade spike alert if price moved 1%+
      if (Math.abs(parseFloat(impactPercent)) >= 1) {
        try {
          tradeSpikeAlertFunction({
            ticker,
            priceBefore: price,
            priceAfter: settledPrice,
            tradeType: 'SELL',
            shares: amount
          }).catch(() => {}); // Fire and forget
        } catch {}
      }

    } else if (action === 'short') {
      // SHORTING: Borrow shares and sell them, hoping to buy back cheaper
      // Get liquidity for this character
      const liquidity = getCharacterLiquidity(ticker);

      // Get today's date for daily impact tracking
      const todayDate = new Date().toISOString().split('T')[0]; // "2026-01-31"
      const userDailyImpact = userData.dailyImpact?.[todayDate]?.[ticker] || 0;

      // Calculate price impact (shorting = selling pressure, with daily impact limit)
      const priceImpact = calculatePriceImpact(price, amount, liquidity, userDailyImpact);
      const newMidPrice = Math.max(MIN_PRICE, price - priceImpact);
      
      // Entry price is the bid (you're selling borrowed shares)
      const { bid } = getBidAskPrices(newMidPrice);
      const shortPrice = Math.max(MIN_PRICE, bid);
      const marginRequired = shortPrice * amount * SHORT_MARGIN_REQUIREMENT;

      // Check if user has enough cash OR can use margin
      const cashAvailable = userData.cash || 0;
      const marginEnabled = userData.marginEnabled || false;
      const marginStatus = calculateMarginStatus(userData, prices, priceHistory);
      const availableMargin = marginStatus.availableMargin || 0;

      // Cash-based margin: use all available margin (already capped by cash * tierMultiplier)
      const maxAvailableForShort = cashAvailable + (marginEnabled ? availableMargin : 0);

      if (maxAvailableForShort < marginRequired) {
        showNotification('error', `Need ${formatCurrency(marginRequired)} margin (50% of position). Max available: ${formatCurrency(maxAvailableForShort)}`);
        return;
      }

      // Determine how much to use from cash vs margin
      let cashToUse = Math.min(cashAvailable, marginRequired);
      let marginToUse = marginRequired - cashToUse;
      
      const existingShort = userData.shorts?.[ticker] || { shares: 0, entryPrice: 0, margin: 0 };

      const totalShares = existingShort.shares + amount;
      const avgEntryPrice = existingShort.shares > 0
        ? ((existingShort.entryPrice * existingShort.shares) + (shortPrice * amount)) / totalShares
        : shortPrice;

      // Deduct cash and/or margin used
      const newCash = userData.cash - cashToUse;
      const currentMarginUsed = userData.marginUsed || 0;
      const newMarginUsed = currentMarginUsed + marginToUse;

      if (isNaN(newCash) || isNaN(newMarginUsed)) {
        showNotification('error', 'Calculation error, try again');
        return;
      }

      const settledPrice = Math.round(newMidPrice * 100) / 100;

      // Weekly mission tracking for shorts
      const today = getTodayDateString();
      const weekId = getWeekId();

      // Track actual impact applied for anti-manipulation limits
      const rawImpactPercent = Math.abs(priceImpact / price);
      const newDailyImpact = userDailyImpact + rawImpactPercent;

      // Update shortHistory for rate limiting
      const currentShortHistory = userData.shortHistory?.[ticker] || [];
      const updatedShortHistory = [...currentShortHistory, Date.now()].slice(-2); // Keep last 2 timestamps

      // SECURITY: Use server timestamp
      await updateDoc(userRef, {
        cash: newCash,
        marginUsed: newMarginUsed,
        [`shorts.${ticker}`]: {
          shares: totalShares,
          entryPrice: Math.round(avgEntryPrice * 100) / 100,
          margin: existingShort.margin + marginRequired,
          openedAt: existingShort.openedAt || serverTime
        },
        [`lastTickerTradeTime.${ticker}`]: serverTime,
        lastTradeTime: serverTime,
        totalTrades: increment(1),
        // Daily impact tracking (anti-manipulation)
        [`dailyImpact.${todayDate}.${ticker}`]: newDailyImpact,
        // Short history tracking (anti-manipulation rate limiting)
        [`shortHistory.${ticker}`]: updatedShortHistory,
        // Weekly missions
        [`weeklyMissions.${weekId}.tradeValue`]: increment(amount * shortPrice),
        [`weeklyMissions.${weekId}.tradeVolume`]: increment(amount),
        [`weeklyMissions.${weekId}.tradeCount`]: increment(1),
        [`weeklyMissions.${weekId}.tradingDays.${today}`]: true
      });

      // Atomic price + history update
      const priceHistoryTimestamp = Date.now();
      await updateDoc(marketRef, {
        [`prices.${ticker}`]: settledPrice,
        [`volume.${ticker}`]: increment(amount),
        totalTrades: increment(1),
        [`priceHistory.${ticker}`]: arrayUnion({ timestamp: priceHistoryTimestamp, price: settledPrice })
      });

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
        cashUsed: cashToUse,
        marginUsed: marginToUse,
        totalShares,
        avgEntryPrice: Math.round(avgEntryPrice * 100) / 100,
        cashBefore: userData.cash,
        cashAfter: newCash,
        marginUsedAfter: newMarginUsed,
        portfolioAfter: Math.round(newPortfolioValue * 100) / 100
      });

      // SECURITY: Record trade in Cloud Functions for auditing & fraud detection
      recordTradeFunction({
        ticker,
        action: 'SHORT',
        amount,
        price: shortPrice,
        totalValue: marginRequired,
        cashBefore: userData.cash,
        cashAfter: newCash,
        portfolioAfter: Math.round(newPortfolioValue * 100) / 100
      }).catch(err => console.error('[RECORD TRADE ERROR]', err));

      // Check achievements
      const earnedAchievements = await checkAndAwardAchievements(userRef, {
        ...userData,
        cash: newCash,
        marginUsed: newMarginUsed,
        totalTrades: (userData.totalTrades || 0) + 1
      }, prices, { tradeValue: marginRequired });

      const impactPercent = ((newMidPrice - price) / price * 100).toFixed(2);
      
      // Add to activity feed
      const charName = CHARACTERS.find(c => c.ticker === ticker)?.name || ticker;
      addActivity('trade', `🩳 Shorted ${amount} $${ticker} (${charName}) @ ${formatCurrency(shortPrice)}`);
      
      if (earnedAchievements.length > 0) {
        const achievement = ACHIEVEMENTS[earnedAchievements[0]];
        addActivity('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked!`);
        showNotification('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked! Shorted ${amount} ${ticker}`);
        try {
          achievementAlertFunction({
            achievementId: earnedAchievements[0],
            achievementName: achievement.name,
            achievementDescription: achievement.description
          }).catch(() => {});
        } catch {}
      } else {
        let shortMessage = `Shorted ${amount} ${ticker} @ ${formatCurrency(shortPrice)} (${impactPercent}% impact)`;
        if (marginToUse > 0) {
          shortMessage += ` • Used ${formatCurrency(marginToUse)} margin`;
        }

        // Warn if approaching daily impact limit
        if (newDailyImpact >= MAX_DAILY_IMPACT_PER_USER) {
          shortMessage += ' • Daily impact limit reached for this ticker';
        } else if (newDailyImpact >= MAX_DAILY_IMPACT_PER_USER * 0.8) {
          const remaining = ((MAX_DAILY_IMPACT_PER_USER - newDailyImpact) * 100).toFixed(1);
          shortMessage += ` • ${remaining}% impact remaining today`;
        }

        // Warn if this is the 2nd short (cooldown now active)
        const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
        const recentShorts = updatedShortHistory.filter(ts => Date.now() - ts < TWELVE_HOURS_MS);
        if (recentShorts.length === 2) {
          shortMessage += ' • ⚠️ Next short on this ticker will be blocked for 12 hours';
        }

        showNotification('success', shortMessage);
      }

      // Send trade spike alert if price moved 1%+
      if (Math.abs(parseFloat(impactPercent)) >= 1) {
        try {
          tradeSpikeAlertFunction({
            ticker,
            priceBefore: price,
            priceAfter: settledPrice,
            tradeType: 'SHORT',
            shares: amount
          }).catch(() => {});
        } catch {}
      }

    } else if (action === 'cover') {
      // COVER: Buy back shares to close short position
      const existingShort = userData.shorts?.[ticker];
      
      if (!existingShort || existingShort.shares < amount) {
        showNotification('error', 'No short position to cover!');
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
        showNotification('error', `Hold period: wait ${timeStr} before covering ${ticker}`);
        return;
      }

      // Get liquidity for this character
      const liquidity = getCharacterLiquidity(ticker);

      // Get today's date for daily impact tracking
      const todayDate = new Date().toISOString().split('T')[0]; // "2026-01-31"
      const userDailyImpact = userData.dailyImpact?.[todayDate]?.[ticker] || 0;

      // Calculate price INCREASE (covering = buying pressure, with daily impact limit)
      const priceImpact = calculatePriceImpact(price, amount, liquidity, userDailyImpact);
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
        showNotification('error', 'Insufficient funds to cover losses!');
        return;
      }

      const remainingShares = existingShort.shares - amount;
      const remainingMargin = existingShort.margin - marginReturned;
      const settledPrice = Math.round(newMidPrice * 100) / 100;

      // Weekly mission tracking for covers
      const today = getTodayDateString();
      const weekId = getWeekId();

      // MARGIN DEBT REPAYMENT: Cover proceeds pay down margin debt first
      const currentMarginUsed = userData.marginUsed || 0;
      let coverMarginPayment = 0;
      let coverCashGain = cashBack;

      if (currentMarginUsed > 0 && cashBack > 0) {
        // Pay down margin debt first (only if cashBack is positive)
        coverMarginPayment = Math.min(cashBack, currentMarginUsed);
        coverCashGain = cashBack - coverMarginPayment;
      }

      // Track actual impact applied for anti-manipulation limits
      const rawImpactPercent = Math.abs(priceImpact / price);
      const newDailyImpact = userDailyImpact + rawImpactPercent;

      // Update user: add cash gain after margin payment
      // SECURITY: Use server timestamp
      const updateData = {
        cash: userData.cash + coverCashGain,
        marginUsed: currentMarginUsed - coverMarginPayment,
        [`lastTickerTradeTime.${ticker}`]: serverTime,
        lastTradeTime: serverTime,
        // Daily impact tracking (anti-manipulation)
        [`dailyImpact.${todayDate}.${ticker}`]: newDailyImpact,
        // Weekly missions
        [`weeklyMissions.${weekId}.tradeValue`]: increment(amount * coverPrice),
        [`weeklyMissions.${weekId}.tradeVolume`]: increment(amount),
        [`weeklyMissions.${weekId}.tradeCount`]: increment(1),
        [`weeklyMissions.${weekId}.tradingDays.${today}`]: true
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

      // Atomic price + history update
      const priceHistoryTimestamp = Date.now();
      await updateDoc(marketRef, {
        [`prices.${ticker}`]: settledPrice,
        [`volume.${ticker}`]: increment(amount),
        totalTrades: increment(1),
        [`priceHistory.${ticker}`]: arrayUnion({ timestamp: priceHistoryTimestamp, price: settledPrice })
      });

      // Record portfolio history (using new cash after margin payment)
      const newCoverCash = userData.cash + coverCashGain;
      const newCoverMarginUsed = currentMarginUsed - coverMarginPayment;
      const newPortfolioValue = newCoverCash + Object.entries(userData.holdings || {})
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
        marginPaid: coverMarginPayment,
        cashBefore: userData.cash,
        cashAfter: newCoverCash,
        portfolioAfter: Math.round(newPortfolioValue * 100) / 100
      });

      // SECURITY: Record trade in Cloud Functions for auditing & fraud detection
      recordTradeFunction({
        ticker,
        action: 'COVER',
        amount,
        price: coverPrice,
        totalValue: amount * coverPrice,
        cashBefore: userData.cash,
        cashAfter: newCoverCash,
        portfolioAfter: Math.round(newPortfolioValue * 100) / 100
      }).catch(err => console.error('[RECORD TRADE ERROR]', err));

      // Check achievements (pass short profit for Cold Blooded achievement)
      const earnedAchievements = await checkAndAwardAchievements(userRef, {
        ...userData,
        cash: newCoverCash,
        marginUsed: newCoverMarginUsed,
        totalTrades: (userData.totalTrades || 0) + 1
      }, prices, { shortProfit: profit });

      const impactPercent = ((newMidPrice - price) / price * 100).toFixed(2);
      const profitMsg = profit >= 0 ? `+${formatCurrency(profit)}` : formatCurrency(profit);

      // Add to activity feed
      const charName = CHARACTERS.find(c => c.ticker === ticker)?.name || ticker;
      addActivity('trade', `🩳 Covered ${amount} $${ticker} (${charName}) @ ${formatCurrency(coverPrice)} (${profitMsg})`);

      if (earnedAchievements.length > 0 && earnedAchievements.includes('COLD_BLOODED')) {
        const achievement = ACHIEVEMENTS['COLD_BLOODED'];
        addActivity('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked!`);
        showNotification('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked! ${profitMsg} profit from short!`);
        try {
          achievementAlertFunction({
            achievementId: 'COLD_BLOODED',
            achievementName: achievement.name,
            achievementDescription: achievement.description
          }).catch(() => {});
        } catch {}
      } else if (earnedAchievements.length > 0) {
        const achievement = ACHIEVEMENTS[earnedAchievements[0]];
        addActivity('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked!`);
        showNotification('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked!`);
        try {
          achievementAlertFunction({
            achievementId: earnedAchievements[0],
            achievementName: achievement.name,
            achievementDescription: achievement.description
          }).catch(() => {});
        } catch {}
      } else {
        let coverMessage = `Covered ${amount} ${ticker} @ ${formatCurrency(coverPrice)} (${profitMsg}, +${impactPercent}% impact)`;
        if (coverMarginPayment > 0) {
          coverMessage += ` • Paid ${formatCurrency(coverMarginPayment)} margin debt`;
        }

        // Warn if approaching daily impact limit
        if (newDailyImpact >= MAX_DAILY_IMPACT_PER_USER) {
          coverMessage += ' • Daily impact limit reached for this ticker';
        } else if (newDailyImpact >= MAX_DAILY_IMPACT_PER_USER * 0.8) {
          const remaining = ((MAX_DAILY_IMPACT_PER_USER - newDailyImpact) * 100).toFixed(1);
          coverMessage += ` • ${remaining}% impact remaining today`;
        }

        showNotification(profit >= 0 ? 'success' : 'error', coverMessage);
      }

      // Send trade spike alert if price moved 1%+
      if (Math.abs(parseFloat(impactPercent)) >= 1) {
        try {
          tradeSpikeAlertFunction({
            ticker,
            priceBefore: price,
            priceAfter: settledPrice,
            tradeType: 'COVER',
            shares: amount
          }).catch(() => {});
        } catch {}
      }
    }
  }, [user, userData, prices, recordPriceHistory, recordPortfolioHistory, addActivity]);

  // Update portfolio value and record history periodically
  useEffect(() => {
    if (!user || !userData || Object.keys(prices).length === 0) return;

    const updatePortfolio = async () => {
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
      try {
        await updateDoc(userRef, { portfolioValue: roundedValue });
      } catch (error) {
        console.error('[PORTFOLIO UPDATE ERROR]', error);
      }

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
        try {
          await updateDoc(userRef, { portfolioHistory: updatedHistory });
        } catch (error) {
          console.error('[PORTFOLIO HISTORY ERROR]', error);
        }
      }

      // Check for bankruptcy (portfolio value <= $100)
      if (roundedValue <= 100 && !userData.isBankrupt && userData.displayName) {
        try {
          await bankruptcyAlertFunction({
            username: userData.displayName,
            finalValue: roundedValue
          });
          // Mark user as notified to avoid duplicate alerts
          await updateDoc(userRef, { bankruptcyAlertSent: true });
        } catch (discordErr) {
          console.error('Failed to send bankruptcy alert:', discordErr);
        }
      }

      // Check for comeback (recovered 100%+ from a low point in last 30 days)
      if (currentHistory.length > 0 && roundedValue >= 1000) {
        const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
        const recentHistory = currentHistory.filter(h => h.timestamp >= thirtyDaysAgo);

        if (recentHistory.length > 0) {
          const lowestPoint = Math.min(...recentHistory.map(h => h.value));
          const recoveryPercent = ((roundedValue - lowestPoint) / lowestPoint) * 100;

          // If recovered 100%+ and low point was under $500, and haven't sent alert recently
          if (recoveryPercent >= 100 && lowestPoint <= 500 && !userData.comebackAlertSent) {
            try {
              await comebackAlertFunction({
                username: userData.displayName,
                lowPoint: Math.round(lowestPoint * 100) / 100,
                currentValue: roundedValue
              });
              // Mark as sent with timestamp to avoid spam
              await updateDoc(userRef, {
                comebackAlertSent: true,
                lastComebackAlert: now
              });
            } catch (discordErr) {
              console.error('Failed to send comeback alert:', discordErr);
            }
          }
        }
      }
    };

    updatePortfolio();
  }, [user, userData, prices]);

  // Margin monitoring - check for margin calls and auto-liquidation
  useEffect(() => {
    if (!user || !userData || !userData.marginEnabled || !prices || Object.keys(prices).length === 0) return;
    
    const marginUsed = userData.marginUsed || 0;
    if (marginUsed <= 0) return; // No margin debt, nothing to check
    
    const checkMarginStatus = async () => {
      const status = calculateMarginStatus(userData, prices, priceHistory);
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

        // Sell ALL positions to cover margin debt
        for (const position of sortedHoldings) {
          const sellValue = position.value * 0.95; // 5% slippage on forced liquidation
          totalRecovered += sellValue;
          updateData[`holdings.${position.ticker}`] = 0;
          updateData[`costBasis.${position.ticker}`] = 0;
        }

        // Calculate final cash position (can go negative if debt > recovered)
        const currentCash = userData.cash || 0;
        const totalAvailable = currentCash + totalRecovered;
        const finalCash = totalAvailable - marginUsed;

        updateData.cash = Math.round(finalCash * 100) / 100;
        updateData.marginUsed = 0; // Debt is now reflected in negative cash
        updateData.marginCallAt = null;
        updateData.lastLiquidation = now;
        updateData.marginEnabled = false; // Disable margin after liquidation

        // If going into debt, mark bankruptcy timestamp
        if (finalCash < 0) {
          updateData.bankruptAt = now;
        }

        await updateDoc(userRef, updateData);

        if (finalCash < 0) {
          showNotification('error', `💀 BANKRUPT: All positions liquidated. You owe ${formatCurrency(Math.abs(finalCash))}`);
        } else {
          showNotification('error', `💀 MARGIN LIQUIDATION: All positions sold. ${formatCurrency(finalCash)} remaining.`);
        }

        // Send liquidation alert to Discord
        try {
          marginLiquidationAlertFunction({
            lossAmount: totalRecovered,
            portfolioBefore: status.portfolioValue,
            portfolioAfter: Math.max(0, finalCash)
          }).catch(() => {});
        } catch {}

      } else if (status.status === 'margin_call' && !userData.marginCallAt) {
        // First margin call - set grace period
        await updateDoc(userRef, { marginCallAt: now });
        
        showNotification('error', `🚨 MARGIN CALL! Deposit funds or sell positions within 24h to avoid liquidation.`);
        
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

  // Bankruptcy notification system - remind every 5 minutes
  useEffect(() => {
    if (!user || !userData) return;

    const cash = userData.cash || 0;
    if (cash >= 0) return; // Not in debt

    const showBankruptcyReminder = () => {
      const debtAmount = Math.abs(cash);
      showNotification('warning', `💸 You are ${formatCurrency(debtAmount)} in debt. Accept a bailout to reset to $500, but you'll be exiled from your crew forever.`);
    };

    // Show immediately on login/becoming bankrupt
    showBankruptcyReminder();

    // Then every 5 minutes
    const interval = setInterval(showBankruptcyReminder, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [user, userData?.cash]);

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
        const currentPortfolioValue = currentUserData.portfolioValue || 0;

        // Skip if already has all leaderboard achievements
        if (currentAchievements.includes('TOP_1')) return;

        // CRITICAL: Require minimum portfolio value to qualify for leaderboard achievements
        // Prevents new accounts or tied low-value accounts from getting achievements
        const MIN_PORTFOLIO_FOR_LEADERBOARD = 5000;
        if (currentPortfolioValue < MIN_PORTFOLIO_FOR_LEADERBOARD) return;

        // Fetch top users to check position (excluding bots)
        const q = query(
          collection(db, 'users'),
          orderBy('portfolioValue', 'desc'),
          limit(20) // Fetch extra to account for bots
        );
        const snapshot = await getDocs(q);
        const topUsers = snapshot.docs
          .filter(doc => !doc.data().isBot && (doc.data().portfolioValue || 0) >= MIN_PORTFOLIO_FOR_LEADERBOARD) // Filter out bots and low-value accounts
          .slice(0, 10) // Get top 10 real users
          .map(doc => doc.id);

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
          showNotification('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked! You're #${rank} on the leaderboard!`);
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
      showNotification('info', 'Sign in to claim your daily bonus!');
      return;
    }

    const today = new Date().toDateString();
    const lastCheckinStr = toDateString(userData.lastCheckin);
    if (lastCheckinStr === today) {
      showNotification('error', 'Already checked in today!');
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
    
    // Weekly check-in tracking
    const weekId = getWeekId();

    const updateData = {
      cash: userData.cash + DAILY_BONUS,
      lastCheckin: today,
      totalCheckins: newTotalCheckins,
      [`dailyMissions.${getTodayDateString()}.checkedIn`]: true,
      // Weekly missions - track check-in days
      [`weeklyMissions.${weekId}.checkinDays.${today}`]: true
    };

    if (newAchievements.length > 0) {
      updateData.achievements = arrayUnion(...newAchievements);
    }

    try {
      await updateDoc(userRef, updateData);
    } catch (error) {
      console.error('[CHECKIN ERROR]', error);
      showNotification('error', 'Failed to check in. Please try again.');
      return;
    }

    // Log transaction for auditing
    await logTransaction(db, user.uid, 'CHECKIN', {
      bonus: DAILY_BONUS,
      totalCheckins: newTotalCheckins,
      cashBefore: userData.cash,
      cashAfter: userData.cash + DAILY_BONUS
    });

    // Add to activity feed
    addActivity('checkin', `Daily check-in: +${formatCurrency(DAILY_BONUS)}! (Day ${newTotalCheckins})`);

    // Show achievement notification if earned
    if (newAchievements.length > 0) {
      const achievement = ACHIEVEMENTS[newAchievements[0]];
      addActivity('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked!`);
      showNotification('achievement', `🏆 Achievement Unlocked: ${achievement.emoji} ${achievement.name}!`);
    } else {
      showNotification('success', `Daily check-in: +${formatCurrency(DAILY_BONUS)}!`);
    }
  }, [user, userData, addActivity]);

  // Handle IPO purchase
  const handleBuyIPO = useCallback(async (ticker, quantity) => {
    if (!user || !userData) {
      showNotification('info', 'Sign in to participate in IPO!');
      return;
    }

    const ipoRef = doc(db, 'market', 'ipos');
    const ipoSnap = await getDoc(ipoRef);
    if (!ipoSnap.exists()) {
      showNotification('error', 'IPO not found');
      return;
    }

    const ipoData = ipoSnap.data();
    const ipo = ipoData.list?.find(i => i.ticker === ticker);
    
    if (!ipo) {
      showNotification('error', 'IPO not found');
      return;
    }

    const now = Date.now();
    if (now < ipo.ipoStartsAt) {
      showNotification('error', 'IPO has not started yet!');
      return;
    }
    
    if (now >= ipo.ipoEndsAt) {
      showNotification('error', 'IPO has ended!');
      return;
    }

    const sharesRemaining = ipo.sharesRemaining ?? IPO_TOTAL_SHARES;
    if (sharesRemaining <= 0) {
      showNotification('error', 'IPO sold out!');
      return;
    }

    const userIPOPurchases = userData.ipoPurchases?.[ticker] || 0;
    if (userIPOPurchases + quantity > IPO_MAX_PER_USER) {
      showNotification('error', `Max ${IPO_MAX_PER_USER} shares per person!`);
      return;
    }

    if (quantity > sharesRemaining) {
      showNotification('error', `Only ${sharesRemaining} shares left!`);
      return;
    }

    const totalCost = ipo.basePrice * quantity;
    if (userData.cash < totalCost) {
      showNotification('error', 'Insufficient funds!');
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
      
      // Add to activity feed
      addActivity('trade', `🚀 IPO: Bought ${quantity} $${ticker} (${character?.name || ticker}) @ ${formatCurrency(ipo.basePrice)}`);
      
      showNotification('success', `🚀 IPO: Bought ${quantity} ${character?.name || ticker} shares @ ${formatCurrency(ipo.basePrice)}!`);
      
    } catch (err) {
      console.error('IPO purchase failed:', err);
      showNotification('error', 'IPO purchase failed!');
    }
  }, [user, userData, addActivity]);

  // Handle prediction bet
  const handleBet = useCallback(async (predictionId, option, amount) => {
    if (!user || !userData) {
      showNotification('info', 'Sign in to place bets!');
      return;
    }

    if (userData.cash < amount) {
      showNotification('error', 'Insufficient funds!');
      return;
    }

    // Calculate total $ user has spent buying/shorting stocks
    // costBasis tracks the actual money spent on each stock
    const totalSpentOnStocks = Object.entries(userData.holdings || {}).reduce((sum, [ticker, shares]) => {
      const costBasis = userData.costBasis?.[ticker] || 0;
      return sum + (costBasis * shares);
    }, 0);

    // Also count margin used for shorts
    const totalShortMargin = Object.values(userData.shorts || {}).filter(short => short).reduce((sum, short) => {
      return sum + (short.margin || 0);
    }, 0);

    // Bet limit = total spent on market (buys + short margin)
    const totalInvested = totalSpentOnStocks + totalShortMargin;
    
    // If user has never invested, they can't bet
    if (totalInvested <= 0) {
      showNotification('error', 'You must invest in the market before placing bets!');
      return;
    }
    
    // Bet limit is capped by both investment and available cash
    const betLimit = Math.min(totalInvested, userData.cash);
    
    // Check if this bet exceeds the limit
    if (amount > betLimit) {
      if (totalInvested > userData.cash) {
        showNotification('error', `Insufficient funds! You have ${formatCurrency(userData.cash)}`);
      } else {
        showNotification('error', `Bet limit: ${formatCurrency(totalInvested)} (total you've invested in stocks)`);
      }
      return;
    }

    const prediction = predictions.find(p => p.id === predictionId);
    if (!prediction || prediction.resolved || prediction.endsAt < Date.now()) {
      showNotification('error', 'Betting has ended!');
      return;
    }

    // Check if user already bet on a different option
    const existingBet = userData.bets?.[predictionId];
    if (existingBet && existingBet.option !== option) {
      showNotification('error', `You already bet on "${existingBet.option}"!`);
      return;
    }

    try {
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

      // Add to activity feed
      addActivity('bet', `🔮 Bet ${formatCurrency(amount)} on "${option}"`);

      showNotification('success', `Bet ${formatCurrency(amount)} on "${option}"!`);
    } catch (error) {
      console.error('Bet placement failed:', error);
      showNotification('error', `Bet failed: ${error.message}`);
    }
  }, [user, userData, predictions, addActivity]);

  // Hide prediction from feed (admin only)
  const handleHidePrediction = useCallback(async (predictionId) => {
    if (!user || !ADMIN_UIDS.includes(user.uid)) return;

    try {
      const predictionsRef = doc(db, 'predictions', 'current');
      const snap = await getDoc(predictionsRef);
      if (snap.exists()) {
        const data = snap.data();
        const updatedList = (data.list || []).map(p =>
          p.id === predictionId ? { ...p, hidden: true } : p
        );
        await updateDoc(predictionsRef, { list: updatedList });
        showNotification('success', 'Prediction hidden from feed');
      }
    } catch (err) {
      console.error('Failed to hide prediction:', err);
      showNotification('error', 'Failed to hide prediction');
    }
  }, [user]);

  // Logout
  const handleLogout = () => signOut(auth);

  // Delete account
  const handleDeleteAccount = useCallback(async (confirmUsername) => {
    if (!user) return;

    try {
      // Call Cloud Function to delete account
      await deleteAccountFunction({ confirmUsername });
      showNotification('success', 'Account deleted successfully');
    } catch (err) {
      console.error('Failed to delete account:', err);
      const errorMessage = err?.message || 'Failed to delete account. Please try again.';
      showNotification('error', errorMessage);
      throw err;
    }
  }, [user, showNotification]);

  // Enable margin trading
  const handleEnableMargin = useCallback(async () => {
    if (!user || !userData) return;
    
    const isAdmin = ADMIN_UIDS.includes(user.uid);
    const eligibility = checkMarginEligibility(userData, isAdmin);
    if (!eligibility.eligible) {
      showNotification('error', 'Not eligible for margin trading!');
      return;
    }
    
    const userRef = doc(db, 'users', user.uid);
    await updateDoc(userRef, {
      marginEnabled: true,
      marginUsed: 0,
      marginEnabledAt: Date.now()
    });
    
    showNotification('success', '📊 Margin trading enabled! You now have extra buying power.');
  }, [user, userData]);

  // Disable margin trading
  const handleDisableMargin = useCallback(async () => {
    if (!user || !userData) return;
    
    if ((userData.marginUsed || 0) >= 0.01) {
      showNotification('error', 'Repay all margin debt before disabling!');
      return;
    }
    
    const userRef = doc(db, 'users', user.uid);
    await updateDoc(userRef, {
      marginEnabled: false,
      marginUsed: 0
    });
    
    showNotification('success', 'Margin trading disabled.');
    setShowLending(false);
  }, [user, userData]);

  // Repay margin
  const handleRepayMargin = useCallback(async (amount) => {
    if (!user || !userData) return;
    
    const marginUsed = userData.marginUsed || 0;
    if (marginUsed <= 0) {
      showNotification('error', 'No margin debt to repay!');
      return;
    }
    
    if (amount > userData.cash) {
      showNotification('error', 'Insufficient funds!');
      return;
    }
    
    const repayAmount = Math.min(amount, marginUsed);
    const newMarginUsed = marginUsed - repayAmount;
    const userRef = doc(db, 'users', user.uid);
    
    await updateDoc(userRef, {
      cash: userData.cash - repayAmount,
      // Ensure exactly 0 if fully repaid (avoid floating point issues)
      marginUsed: newMarginUsed < 0.01 ? 0 : Math.round(newMarginUsed * 100) / 100,
      marginCallAt: null // Clear margin call if repaying
    });
    
    if (repayAmount >= marginUsed) {
      showNotification('success', `Margin fully repaid! Paid ${formatCurrency(repayAmount)}`);
    } else {
      showNotification('success', `Repaid ${formatCurrency(repayAmount)}. Remaining debt: ${formatCurrency(newMarginUsed)}`);
    }
  }, [user, userData]);

  // Bankruptcy bailout - reset to $500 but exile from all past crews
  const handleBailout = useCallback(async () => {
    if (!user || !userData) return;

    const cash = userData.cash || 0;
    if (cash >= 0) {
      showNotification('error', 'You are not in debt.');
      return;
    }

    try {
      const userRef = doc(db, 'users', user.uid);
      const currentCrew = userData.crew;
      const crewHistory = userData.crewHistory || [];

      // Add current crew to history if not already there (will be exiled)
      const updatedHistory = currentCrew && !crewHistory.includes(currentCrew)
        ? [...crewHistory, currentCrew]
        : crewHistory;

      await updateDoc(userRef, {
        cash: 500,
        holdings: {},
        shorts: {},
        costBasis: {},
        portfolioValue: 500,
        marginEnabled: false,
        marginUsed: 0,
        bankruptAt: null,
        crew: null,
        crewJoinedAt: null,
        isCrewHead: false,
        crewHeadColor: null,
        crewHistory: updatedHistory,
        lastBailout: Date.now()
      });

      if (currentCrew) {
        const crewName = CREW_MAP[currentCrew]?.name || 'your crew';
        showNotification('warning', `Bailout accepted. You've been exiled from ${crewName} and all previous crews. Starting fresh with $500.`);
      } else {
        showNotification('success', 'Bailout accepted. Starting fresh with $500.');
      }
    } catch (err) {
      console.error('Bailout failed:', err);
      showNotification('error', 'Bailout failed. Please try again.');
    }
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

      // Hide characters that require IPO and haven't launched yet
      if (c.ipoRequired) {
        // Check if this character has been launched (added to launchedTickers)
        if (!launchedTickers.includes(c.ticker)) {
          return false; // IPO required but not launched - hide from trading
        }
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
      case 'price-high': filtered.sort((a, b) => getCurrentPrice(b.ticker, priceHistory, prices) - getCurrentPrice(a.ticker, priceHistory, prices)); break;
      case 'price-low': filtered.sort((a, b) => getCurrentPrice(a.ticker, priceHistory, prices) - getCurrentPrice(b.ticker, priceHistory, prices)); break;
      case 'change-high':
        // Top gainers - highest positive % change first
        filtered.sort((a, b) => (priceChanges[b.ticker] || 0) - (priceChanges[a.ticker] || 0));
        break;
      case 'change-low':
        // Top losers - lowest (most negative) % change first
        filtered.sort((a, b) => (priceChanges[a.ticker] || 0) - (priceChanges[b.ticker] || 0));
        break;
      case 'active':
        filtered.sort((a, b) => {
          const activityA = getTradeActivity(a.ticker);
          const activityB = getTradeActivity(b.ticker);

          // Primary: most trades today (last 24h)
          if (activityB.dayTrades !== activityA.dayTrades) {
            return activityB.dayTrades - activityA.dayTrades;
          }
          // Secondary: most trades in last week
          if (activityB.weekTrades !== activityA.weekTrades) {
            return activityB.weekTrades - activityA.weekTrades;
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
            {(!userData?.crew || isGuest) && (
              <button onClick={() => setShowCrewSelection(true)}
                className={`px-3 py-1 text-xs rounded-sm border flex items-center gap-1 ${darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 hover:bg-amber-50'}`}>
                🏴 {isGuest ? 'Crews' : 'Join Crew'}
              </button>
            )}
            <button onClick={() => setShowDailyMissions(true)}
              className={`px-3 py-1 text-xs rounded-sm border ${darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 hover:bg-amber-50'}`}>
              📋 Missions
            </button>
            {!isGuest && (
              <button onClick={() => setShowPinShop(true)}
                className={`px-3 py-1 text-xs rounded-sm border ${darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 hover:bg-amber-50'}`}>
                📌 Pins
              </button>
            )}
            <button onClick={() => {
              if (isGuest) {
                setShowLadderSignInModal(true);
              } else if (skipLadderIntro) {
                setShowLadderGame(true);
              } else {
                setShowLadderIntroModal(true);
              }
            }}
              className={`px-3 py-1 text-xs rounded-sm border ${darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 hover:bg-amber-50'}`}>
              🪜 Ladder
            </button>
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
                  className={`px-3 py-1 text-xs rounded-sm text-white font-semibold uppercase ${userData?.colorBlindMode ? 'bg-purple-600 hover:bg-purple-700' : 'bg-red-600 hover:bg-red-700'}`}>
                  Logout
                </button>
              </>
            )}
          </div>
        </div>

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
              <button
                onClick={() => setShowPredictions(!showPredictions)}
                className={`w-full flex items-center justify-between px-4 py-3 mb-3 rounded-sm transition-all ${
                  darkMode
                    ? 'bg-zinc-900/50 hover:bg-zinc-800/70 border border-zinc-800'
                    : 'bg-amber-50 hover:bg-amber-100 border border-amber-200'
                }`}
              >
                <span className={`text-sm font-semibold uppercase tracking-wide ${mutedClass}`}>
                  🔮 Weekly Predictions
                </span>
                <svg
                  className={`w-5 h-5 transition-transform ${showPredictions ? 'rotate-180' : ''} ${mutedClass}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showPredictions && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fadeIn">
                  {predictions.filter(p => !p.hidden && (!p.resolved || Date.now() - p.endsAt < 7 * 24 * 60 * 60 * 1000)).map(prediction => {
                    // Calculate bet limit = total $ spent on stocks, capped by cash
                    const totalSpentOnStocks = Object.entries(userData?.holdings || {}).reduce((sum, [ticker, shares]) => {
                      const costBasis = userData?.costBasis?.[ticker] || 0;
                      return sum + (costBasis * shares);
                    }, 0);
                    const totalShortMargin = Object.values(userData?.shorts || {}).filter(short => short).reduce((sum, short) => sum + (short.margin || 0), 0);
                    const totalInvested = totalSpentOnStocks + totalShortMargin;
                    const betLimit = Math.min(totalInvested, userData?.cash || 0);

                    return (
                      <PredictionCard
                        key={prediction.id}
                        prediction={prediction}
                        userBet={getUserBet(prediction.id)}
                        onBet={handleBet}
                        onRequestBet={(predictionId, option, amount, question) => setBetConfirmation({ predictionId, option, amount, question })}
                        darkMode={darkMode}
                        isGuest={isGuest}
                        betLimit={betLimit}
                        isAdmin={user && ADMIN_UIDS.includes(user.uid)}
                        onHide={handleHidePrediction}
                        userData={userData}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* New Characters Board - takes 1 column */}
          <div className={predictions.length === 0 ? 'lg:col-span-3' : ''}>
            <button
              onClick={() => setShowNewCharacters(!showNewCharacters)}
              className={`w-full flex items-center justify-between px-4 py-3 mb-3 rounded-sm transition-all ${
                darkMode
                  ? 'bg-zinc-900/50 hover:bg-zinc-800/70 border border-zinc-800'
                  : 'bg-amber-50 hover:bg-amber-100 border border-amber-200'
              }`}
            >
              <span className={`text-sm font-semibold uppercase tracking-wide ${mutedClass}`}>
                ✨ New This Week
              </span>
              <svg
                className={`w-5 h-5 transition-transform ${showNewCharacters ? 'rotate-180' : ''} ${mutedClass}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showNewCharacters && (
              <div className="animate-fadeIn">
                <NewCharactersBoard
                  prices={prices}
                  priceHistory={priceHistory}
                  darkMode={darkMode}
                  colorBlindMode={userData?.colorBlindMode || false}
                  launchedTickers={launchedTickers}
                />
              </div>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div className={`${cardClass} border rounded-sm p-4 ${(activeUserData.cash || 0) < 0 ? (userData?.colorBlindMode ? 'border-purple-500' : 'border-red-500') : ''}`}>
            <p className={`text-xs font-semibold uppercase ${mutedClass}`}>Cash</p>
            <p className={`text-2xl font-bold ${(activeUserData.cash || 0) < 0 ? (userData?.colorBlindMode ? 'text-purple-500' : 'text-red-500') : textClass}`}>
              {(activeUserData.cash || 0) < 0 ? '-' : ''}{formatCurrency(Math.abs(activeUserData.cash || 0))}
            </p>
            {(activeUserData.cash || 0) < 0 && (
              <button
                onClick={() => setShowBailout(true)}
                className={`mt-2 w-full py-1.5 text-xs font-semibold rounded-sm text-white ${userData?.colorBlindMode ? 'bg-purple-600 hover:bg-purple-700' : 'bg-red-600 hover:bg-red-700'}`}
              >
                💸 In Debt - Request Bailout
              </button>
            )}
            {(activeUserData.cash || 0) >= 0 && activeUserData.marginEnabled && (() => {
              const marginStatus = calculateMarginStatus(activeUserData, prices, priceHistory);
              return (
                <div className="text-xs mt-1 space-y-0.5">
                  <div className={mutedClass}>
                    Tier: <span className="text-amber-500 font-semibold">{marginStatus.tierName}</span>
                  </div>
                  <div className={mutedClass}>
                    Available: <span className="text-amber-500 font-semibold">{formatCurrency(marginStatus.availableMargin)}</span>
                    <span className={mutedClass}> (of {formatCurrency(marginStatus.maxBorrowable)} max)</span>
                  </div>
                  {activeUserData.marginUsed > 0 && (
                    <div className="text-orange-500">
                      Used: {formatCurrency(activeUserData.marginUsed)} debt • 0.5% daily
                    </div>
                  )}
                </div>
              );
            })()}
            <CheckInButton
              isGuest={isGuest}
              lastCheckin={userData?.lastCheckin}
              onCheckin={handleDailyCheckin}
              darkMode={darkMode}
            />
          </div>
          <div className={`${cardClass} border rounded-sm p-4 cursor-pointer hover:border-orange-600`} onClick={() => !isGuest && setShowPortfolio(true)}>
            <p className={`text-xs font-semibold uppercase ${mutedClass}`}>Portfolio Value</p>
            <p className={`text-2xl font-bold ${textClass}`}>{formatCurrency(portfolioValue)}</p>
            {(() => {
              const now = Date.now();
              const oneDayAgo = now - (24 * 60 * 60 * 1000);
              const portfolioHistory = activeUserData.portfolioHistory || [];

              // Find portfolio value closest to 24h ago
              let value24hAgo = null;
              if (portfolioHistory.length > 0) {
                // Find the closest record to 24h ago
                const closest = portfolioHistory.reduce((prev, curr) => {
                  return Math.abs(curr.timestamp - oneDayAgo) < Math.abs(prev.timestamp - oneDayAgo) ? curr : prev;
                });
                // Only use if it's within 26 hours (to account for gaps in data)
                if (Math.abs(closest.timestamp - oneDayAgo) < 26 * 60 * 60 * 1000) {
                  value24hAgo = closest.value;
                }
              }

              const change24h = value24hAgo ? portfolioValue - value24hAgo : 0;
              const changePercent24h = value24hAgo && value24hAgo > 0 ? ((change24h / value24hAgo) * 100) : 0;

              const colors24h = getColorBlindColors(change24h >= 0);

              return (
                <>
                  {value24hAgo && (
                    <p className={`text-xs ${colors24h.text}`}>
                      {change24h >= 0 ? '▲' : '▼'} {formatCurrency(Math.abs(change24h))} ({formatChange(changePercent24h)}) 24h
                    </p>
                  )}
                  <p className={`text-xs ${mutedClass}`}>
                    {portfolioValue >= STARTING_CASH ? '▲' : '▼'} {((portfolioValue - STARTING_CASH) / STARTING_CASH * 100).toFixed(2)}% from start
                    {!isGuest && <span className="text-orange-600 ml-2">→ View chart</span>}
                  </p>
                </>
              );
            })()}
          </div>
          <div className={`${cardClass} border rounded-sm p-4`}>
            <div className="flex justify-between items-start mb-2">
              <p className={`text-xs font-semibold uppercase ${mutedClass}`}>Holdings</p>
              {!isGuest && (
                <button
                  onClick={() => setShowPortfolio(true)}
                  className="text-xs text-orange-600 hover:text-orange-500"
                >
                  View All →
                </button>
              )}
            </div>
            {(() => {
              const holdings = activeUserData.holdings || {};
              const costBasis = activeUserData.costBasis || {};
              const holdingsArray = Object.entries(holdings)
                .filter(([_, shares]) => shares > 0)
                .map(([ticker, shares]) => {
                  const character = CHARACTER_MAP[ticker];
                  const currentPrice = prices[ticker] || character?.basePrice || 0;
                  const avgCost = costBasis[ticker] || character?.basePrice || currentPrice;
                  const value = currentPrice * shares;
                  const totalCost = avgCost * shares;
                  const unrealizedPL = value - totalCost;
                  return { ticker, shares, value, unrealizedPL, character };
                })
                .sort((a, b) => b.value - a.value);

              const totalUnrealizedPL = holdingsArray.reduce((sum, h) => sum + h.unrealizedPL, 0);
              const topHoldings = holdingsArray.slice(0, 3);

              if (holdingsArray.length === 0) {
                return (
                  <p className={`text-sm ${mutedClass}`}>No holdings yet</p>
                );
              }

              return (
                <div className="space-y-2">
                  {topHoldings.map(h => {
                    const plColors = getColorBlindColors(h.unrealizedPL >= 0);
                    return (
                      <div key={h.ticker} className="flex justify-between items-center text-xs">
                        <span className={textClass}>${h.ticker} × {h.shares}</span>
                        <span className={plColors.text}>
                          {h.unrealizedPL >= 0 ? '+' : ''}{formatCurrency(h.unrealizedPL)}
                        </span>
                      </div>
                    );
                  })}
                  <div className={`pt-2 border-t ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
                    <div className="flex justify-between items-center text-xs">
                      <span className={mutedClass}>Total Unrealized P/L:</span>
                      <span className={`font-bold ${getColorBlindColors(totalUnrealizedPL >= 0).text}`}>
                        {totalUnrealizedPL >= 0 ? '+' : ''}{formatCurrency(totalUnrealizedPL)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-xs mt-1">
                      <span className={mutedClass}>{holdingsArray.length} position{holdingsArray.length !== 1 ? 's' : ''}</span>
                      <span className={mutedClass}>{Object.values(holdings).reduce((a, b) => a + b, 0)} total shares</span>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Controls */}
        <div className={`${cardClass} border rounded-sm p-4 mb-4`}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <select value={sortBy} onChange={(e) => { setSortBy(e.target.value); setCurrentPage(1); }}
              className={`px-3 py-2 text-sm rounded-sm border ${inputClassStyle}`}>
              <option value="price-high">Price: High</option>
              <option value="price-low">Price: Low</option>
              <option value="change-high">Top Gainers</option>
              <option value="change-low">Top Losers</option>
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
              price={(() => {
                // Use priceHistory as source of truth, fall back to prices object
                const history = priceHistory[character.ticker];
                if (history && history.length > 0) {
                  return history[history.length - 1].price;
                }
                return prices[character.ticker] || character.basePrice;
              })()}
              priceChange={get24hChange(character.ticker)}
              sentiment={getSentiment(character.ticker)}
              holdings={activeUserData.holdings?.[character.ticker] || 0}
              shortPosition={activeUserData.shorts?.[character.ticker]}
              onTrade={requestTrade}
              onViewChart={handleViewChart}
              priceHistory={priceHistory}
              darkMode={darkMode}
              userCash={activeUserData.cash || 0}
              userData={activeUserData}
              prices={prices}
              user={user}
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
      {needsEmailVerification && user && <EmailVerificationModal user={user} darkMode={darkMode} userData={userData} />}
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
      {showLeaderboard && <LeaderboardModal onClose={() => setShowLeaderboard(false)} darkMode={darkMode} currentUserCrew={userData?.crew} currentUser={user} currentUserData={userData} />}
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} darkMode={darkMode} userData={userData} />}
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
          user={user}
          onDeleteAccount={handleDeleteAccount}
          prices={prices}
          holdings={userData?.holdings || {}}
          shorts={userData?.shorts || {}}
          costBasis={userData?.costBasis || {}}
        />
      )}
      {showLending && !isGuest && (
        <MarginModal
          onClose={() => setShowLending(false)}
          darkMode={darkMode}
          userData={userData}
          prices={prices}
          priceHistory={priceHistory}
          onEnableMargin={handleEnableMargin}
          onDisableMargin={handleDisableMargin}
          onRepayMargin={handleRepayMargin}
          isAdmin={user && ADMIN_UIDS.includes(user.uid)}
        />
      )}
      {showLadderGame && !isGuest && user && (
        <LadderGame
          user={user}
          onClose={() => setShowLadderGame(false)}
          darkMode={darkMode}
        />
      )}
      {showLadderIntroModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
          onClick={() => setShowLadderIntroModal(false)}
        >
          <div
            className={`${cardClass} border rounded-sm p-6 max-w-lg`}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className={`text-2xl font-bold mb-4 ${textClass}`}>🪜 Ladder Game</h2>
            <div className={`mb-6 space-y-3 ${mutedClass}`}>
              <p className="font-semibold text-amber-500">
                The same game Jiho lost everything on in the Illegal Gambling Arc!
              </p>
              <p>
                Unlike the original, this version is completely random - no admin rigging here.
              </p>
              <p>
                <strong className={textClass}>How to play:</strong> Pick left or right ladder, bet odd or even on the outcome, and watch the track.
              </p>
              <p className="text-sm">
                <strong>Note:</strong> Your first bet may take a few seconds longer as the game loads everything.
              </p>
              <p className={`p-3 rounded-sm ${darkMode ? 'bg-amber-900/20 border border-amber-700' : 'bg-amber-50 border border-amber-200'}`}>
                <strong className="text-amber-500">⚠️ Important:</strong> You can deposit Stockism cash to play, but <strong>winnings cannot be withdrawn</strong> back to your main balance. This is for entertainment only!
              </p>
            </div>
            <label className={`flex items-center gap-2 mb-4 cursor-pointer ${mutedClass}`}>
              <input
                type="checkbox"
                checked={skipLadderIntro}
                onChange={(e) => {
                  const newValue = e.target.checked;
                  setSkipLadderIntro(newValue);
                  try {
                    localStorage.setItem('skipLadderIntro', newValue.toString());
                  } catch {}
                }}
                className="cursor-pointer"
              />
              <span>Don't show this again</span>
            </label>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowLadderIntroModal(false);
                  setShowLadderGame(true);
                }}
                className="flex-1 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-sm"
              >
                Play
              </button>
              <button
                onClick={() => setShowLadderIntroModal(false)}
                className={`flex-1 px-4 py-2 rounded-sm border ${darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 hover:bg-amber-50'}`}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {showLadderSignInModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
          onClick={() => setShowLadderSignInModal(false)}
        >
          <div
            className={`${cardClass} border rounded-sm p-6 max-w-md`}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className={`text-2xl font-bold mb-4 ${textClass}`}>🪜 Ladder Game</h2>
            <p className={`mb-6 ${mutedClass}`}>
              Sign in to play a replica of the Ladder Game from the Illegal Gambling Arc!
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowLadderSignInModal(false);
                  setShowLoginModal(true);
                }}
                className="flex-1 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-sm"
              >
                Sign In
              </button>
              <button
                onClick={() => setShowLadderSignInModal(false)}
                className={`flex-1 px-4 py-2 rounded-sm border ${darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 hover:bg-amber-50'}`}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {showCrewSelection && (
        <CrewSelectionModal
          onClose={() => setShowCrewSelection(false)}
          onSelect={handleCrewSelect}
          onLeave={handleCrewLeave}
          darkMode={darkMode}
          userData={userData}
          isGuest={isGuest}
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
      {showDailyMissions && (
        <DailyMissionsModal
          onClose={() => setShowDailyMissions(false)}
          darkMode={darkMode}
          userData={userData}
          prices={prices}
          onClaimReward={handleClaimMissionReward}
          onClaimWeeklyReward={handleClaimWeeklyMissionReward}
          portfolioValue={portfolioValue}
          isGuest={isGuest}
        />
      )}
      {showBailout && !isGuest && (userData?.cash || 0) < 0 && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={() => setShowBailout(false)}>
          <div
            className={`w-full max-w-md ${darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200'} border rounded-sm shadow-xl p-6`}
            onClick={e => e.stopPropagation()}
          >
            <div className="text-center mb-4">
              <div className="text-4xl mb-2">💸</div>
              <h2 className={`text-xl font-bold ${darkMode ? 'text-zinc-100' : 'text-slate-900'}`}>Bankruptcy Bailout</h2>
            </div>

            <div className={`p-4 rounded-sm mb-4 ${userData?.colorBlindMode ? (darkMode ? 'bg-purple-900/30 border border-purple-700' : 'bg-purple-50 border border-purple-200') : (darkMode ? 'bg-red-900/30 border border-red-700' : 'bg-red-50 border border-red-200')}`}>
              <p className={`text-center font-semibold ${userData?.colorBlindMode ? (darkMode ? 'text-purple-400' : 'text-purple-600') : (darkMode ? 'text-red-400' : 'text-red-600')}`}>
                You are {formatCurrency(Math.abs(userData?.cash || 0))} in debt
              </p>
            </div>

            <div className={`text-sm ${darkMode ? 'text-zinc-300' : 'text-slate-600'} mb-4 space-y-2`}>
              <p>Accept a bailout to clear your debt and restart with <strong className={userData?.colorBlindMode ? 'text-teal-500' : 'text-green-500'}>$500</strong>.</p>
              <p className="text-amber-500 font-semibold">⚠️ Consequences:</p>
              <ul className="list-disc ml-5 space-y-1">
                <li>You will be <strong>permanently exiled</strong> from your current crew</li>
                <li>You can <strong>never rejoin</strong> any crew you've been part of</li>
                <li>All holdings and shorts will be cleared</li>
              </ul>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowBailout(false)}
                className={`flex-1 py-2 rounded-sm border ${darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 hover:bg-amber-50'}`}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  await handleBailout();
                  setShowBailout(false);
                }}
                className={`flex-1 py-2 rounded-sm text-white font-semibold ${userData?.colorBlindMode ? 'bg-teal-600 hover:bg-teal-700' : 'bg-green-600 hover:bg-green-700'}`}
              >
                Accept Bailout
              </button>
            </div>
          </div>
        </div>
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
      
      {/* Activity Feed */}
      {!isGuest && (
        <ActivityFeed
          activities={activityFeed}
          isOpen={showActivityFeed}
          onToggle={() => setShowActivityFeed(prev => !prev)}
          darkMode={darkMode}
        />
      )}
      
      {/* Toast Notifications */}
      <ToastContainer
        notifications={notifications}
        onDismiss={dismissNotification}
        darkMode={darkMode}
      />
      
      {showPortfolio && !isGuest && (
        <PortfolioModal
          holdings={activeUserData.holdings || {}}
          shorts={activeUserData.shorts || {}}
          prices={prices}
          portfolioHistory={userData?.portfolioHistory || []}
          currentValue={portfolioValue}
          onClose={() => setShowPortfolio(false)}
          onTrade={requestTrade}
          darkMode={darkMode}
          costBasis={userData?.costBasis || {}}
          priceHistory={priceHistory}
          colorBlindMode={userData?.colorBlindMode || false}
          user={user}
        />
      )}
      {selectedCharacter && (
        <ChartModal
          character={selectedCharacter.character || selectedCharacter}
          currentPrice={prices[(selectedCharacter.character || selectedCharacter).ticker] || (selectedCharacter.character || selectedCharacter).basePrice}
          priceHistory={priceHistory}
          onClose={() => setSelectedCharacter(null)}
          darkMode={darkMode}
          defaultTimeRange={selectedCharacter.defaultTimeRange || '1d'}
          colorBlindMode={userData?.colorBlindMode || false}
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

      {/* Footer */}
      <div className={`mt-8 pt-4 border-t text-center text-xs ${darkMode ? 'border-zinc-800 text-zinc-500' : 'border-amber-200 text-zinc-500'}`}>
        <a href="/terms.html" target="_blank" rel="noopener noreferrer" className="hover:text-orange-500 underline">
          Terms of Service
        </a>
        {' • '}
        <a href="/privacy.html" target="_blank" rel="noopener noreferrer" className="hover:text-orange-500 underline">
          Privacy Policy
        </a>
        {' • '}
        <a href="mailto:support@stockism.app" className="hover:text-orange-500 underline">
          Contact
        </a>
        {' • '}
        <a href="https://discord.gg/yxw94uNrYv" target="_blank" rel="noopener noreferrer" className="hover:text-orange-500 underline">
          Discord
        </a>
        {' • '}
        <a href="https://reddit.com/r/stockismapp" target="_blank" rel="noopener noreferrer" className="hover:text-orange-500 underline">
          Reddit
        </a>
      </div>
    </div>
  );
}
