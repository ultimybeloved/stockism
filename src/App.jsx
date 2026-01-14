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

// ============================================
// CONSTANTS
// ============================================

const ITEMS_PER_PAGE = 15;
const STARTING_CASH = 1000;
const DAILY_BONUS = 300;
const PRICE_UPDATE_INTERVAL = 5000; // 5 seconds
const HISTORY_RECORD_INTERVAL = 60000; // 1 minute

// Economy balancing constants
const TRADE_IMPACT_FACTOR = 0.008; // How much trades affect price (lower = more stable)
const PRICE_GRAVITY_FACTOR = 0.001; // How fast prices drift back to base (lower = slower)
const MAX_PRICE_DEVIATION = 0.3; // Max 30% deviation from base price
const DIMINISHING_RETURNS_THRESHOLD = 5; // Shares before diminishing returns kick in

// Shorting constants (realistic NYSE-style)
const SHORT_MARGIN_REQUIREMENT = 0.5; // 50% margin required (can short up to 2x cash)
const SHORT_INTEREST_RATE = 0.001; // 0.1% daily interest on short positions
const SHORT_MARGIN_CALL_THRESHOLD = 0.25; // Auto-close if equity drops below 25%

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
    return tickerHistory
      .filter(point => point.timestamp >= cutoff)
      .map(point => ({
        ...point,
        date: new Date(point.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        fullDate: new Date(point.timestamp).toLocaleDateString('en-US', { 
          month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' 
        }),
      }));
  }, [priceHistory, character.ticker, timeRange]);

  const hasData = currentData.length >= 2;
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
          {!hasData ? (
            <div className={`flex items-center justify-center h-48 ${mutedClass}`}>
              <div className="text-center">
                <p className="text-lg mb-2">📊 Building history...</p>
                <p className="text-sm">Chart data appears as the market runs.</p>
              </div>
            </div>
          ) : (
            <div className="relative">
              <svg 
                viewBox={`0 0 ${svgWidth} ${svgHeight}`} 
                className="w-full"
                onMouseLeave={() => setHoveredPoint(null)}
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
                {currentData.map((point, i) => (
                  <g key={i}>
                    <circle cx={getX(i)} cy={getY(point.price)} r="12" fill="transparent"
                      className="cursor-pointer"
                      onMouseEnter={() => setHoveredPoint({ ...point, x: getX(i), y: getY(point.price) })} />
                    {hoveredPoint?.timestamp === point.timestamp && (
                      <>
                        <line x1={getX(i)} y1={paddingY} x2={getX(i)} y2={paddingY + chartHeight}
                          stroke={darkMode ? '#475569' : '#cbd5e1'} strokeDasharray="4" />
                        <circle cx={getX(i)} cy={getY(point.price)} r="5" fill={strokeColor}
                          stroke={darkMode ? '#1e293b' : '#fff'} strokeWidth="2" />
                      </>
                    )}
                  </g>
                ))}
              </svg>
              {hoveredPoint && (
                <div className={`absolute pointer-events-none px-3 py-2 rounded-sm shadow-lg text-sm ${
                  darkMode ? 'bg-slate-700 text-slate-100' : 'bg-white text-slate-900 border'
                }`} style={{
                  left: `${(hoveredPoint.x / svgWidth) * 100}%`,
                  top: `${(hoveredPoint.y / svgHeight) * 100}%`,
                  transform: 'translate(-50%, -120%)'
                }}>
                  <div className="font-semibold">{formatCurrency(hoveredPoint.price)}</div>
                  <div className={`text-xs ${mutedClass}`}>{hoveredPoint.fullDate}</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Stats Footer */}
        <div className={`p-4 border-t ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
          <div className="grid grid-cols-4 gap-4 text-center">
            <div>
              <div className={`text-xs ${mutedClass} uppercase`}>Open</div>
              <div className={`font-semibold ${textClass}`}>{hasData ? formatCurrency(firstPrice) : '—'}</div>
            </div>
            <div>
              <div className={`text-xs ${mutedClass} uppercase`}>High</div>
              <div className="font-semibold text-green-500">{hasData ? formatCurrency(maxPrice) : '—'}</div>
            </div>
            <div>
              <div className={`text-xs ${mutedClass} uppercase`}>Low</div>
              <div className="font-semibold text-red-500">{hasData ? formatCurrency(minPrice) : '—'}</div>
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
// PORTFOLIO MODAL
// ============================================

const PortfolioModal = ({ holdings, prices, onClose, onTrade, darkMode }) => {
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

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className={`w-full max-w-2xl ${cardClass} border rounded-sm shadow-xl overflow-hidden max-h-[80vh] flex flex-col`}
        onClick={e => e.stopPropagation()}>
        
        <div className={`p-4 border-b ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
          <div className="flex justify-between items-center">
            <div>
              <h2 className={`text-lg font-semibold ${textClass}`}>Your Portfolio</h2>
              <p className={`text-sm ${mutedClass}`}>Total Value: {formatCurrency(totalValue)}</p>
            </div>
            <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-teal-600 text-xl`}>×</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {portfolioItems.length === 0 ? (
            <div className={`text-center py-8 ${mutedClass}`}>
              <p className="text-lg mb-2">📭 No holdings yet</p>
              <p className="text-sm">Start trading to build your portfolio!</p>
            </div>
          ) : (
            <div className="space-y-2">
              {portfolioItems.map(item => (
                <div key={item.ticker} className={`p-3 rounded-sm border ${darkMode ? 'border-slate-700 bg-slate-800/50' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="flex justify-between items-center">
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
                    <button
                      onClick={() => onTrade(item.ticker)}
                      className="ml-4 px-3 py-1 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-sm"
                    >
                      Sell
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

const LeaderboardModal = ({ onClose, darkMode }) => {
  const [leaders, setLeaders] = useState([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className={`w-full max-w-lg ${cardClass} border rounded-sm shadow-xl overflow-hidden max-h-[80vh] flex flex-col`}
        onClick={e => e.stopPropagation()}>
        
        <div className={`p-4 border-b ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
          <div className="flex justify-between items-center">
            <h2 className={`text-lg font-semibold ${textClass}`}>🏆 Leaderboard</h2>
            <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-teal-600 text-xl`}>×</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className={`text-center py-8 ${mutedClass}`}>Loading...</div>
          ) : leaders.length === 0 ? (
            <div className={`text-center py-8 ${mutedClass}`}>
              <p>No traders yet!</p>
              <p className="text-sm">Be the first to make your mark.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-700">
              {leaders.map(leader => (
                <div key={leader.id} className={`p-3 flex items-center gap-3 ${leader.rank <= 3 ? (darkMode ? 'bg-slate-800/50' : 'bg-slate-50') : ''}`}>
                  <div className={`w-10 text-center font-bold ${getRankStyle(leader.rank)}`}>
                    {getRankEmoji(leader.rank)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={`font-semibold truncate ${textClass}`}>
                      {leader.displayName || 'Anonymous Trader'}
                    </div>
                    <div className={`text-xs ${mutedClass}`}>
                      {Object.keys(leader.holdings || {}).filter(k => leader.holdings[k] > 0).length} characters
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`font-bold ${textClass}`}>{formatCurrency(leader.portfolioValue || 0)}</div>
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

        {/* Email Form */}
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
          {isRegistering && (
            <input
              type="password"
              placeholder="Confirm Password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={`w-full px-3 py-2 border rounded-sm text-sm ${inputClass}`}
              disabled={loading}
            />
          )}
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
            {loading ? 'Please wait...' : (isRegistering ? 'Create Account' : 'Sign In')}
          </button>
        </form>

        <div className="mt-4 text-center">
          <button
            onClick={() => { setIsRegistering(!isRegistering); setError(''); }}
            className={`text-sm ${mutedClass} hover:text-teal-600`}
          >
            {isRegistering ? 'Already have an account? Sign in' : "Don't have an account? Register"}
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
      await setDoc(userDocRef, {
        displayName: trimmed,
        // We intentionally do NOT store firebaseUser.displayName or email
        cash: STARTING_CASH,
        holdings: {},
        portfolioValue: STARTING_CASH,
        lastCheckin: null,
        createdAt: serverTimestamp()
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
    return data.filter(p => p.timestamp >= cutoff);
  }, [priceHistory, character.ticker]);

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
          {miniChartData.length >= 2 ? (
            <SimpleLineChart data={miniChartData} darkMode={darkMode} />
          ) : (
            <div className={`h-10 flex items-center justify-center text-xs ${mutedClass}`}>
              Chart building...
            </div>
          )}
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
  const [selectedCharacter, setSelectedCharacter] = useState(null);
  const [notification, setNotification] = useState(null);
  const [needsUsername, setNeedsUsername] = useState(false);
  const [sortBy, setSortBy] = useState('price-high');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [showAll, setShowAll] = useState(false);

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
          setUserData(userSnap.data());
          
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
        setPrices(data.prices || {});
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
          
          // Price impact from forced cover (buying pressure)
          const basePrice = CHARACTER_MAP[liq.ticker]?.basePrice || liq.currentPrice;
          const impactMultiplier = Math.min(1, DIMINISHING_RETURNS_THRESHOLD / liq.shares);
          const priceImpact = liq.currentPrice * TRADE_IMPACT_FACTOR * liq.shares * impactMultiplier;
          const newPrice = Math.min(basePrice * (1 + MAX_PRICE_DEVIATION), liq.currentPrice + priceImpact);
          
          await updateDoc(marketRef, {
            [`prices.${liq.ticker}`]: Math.round(newPrice * 100) / 100
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

  // Calculate sentiment based on recent price changes
  const getSentiment = useCallback((ticker) => {
    const history = priceHistory[ticker] || [];
    if (history.length < 2) return 'Neutral';
    
    const recent = history.slice(-10);
    const changes = recent.slice(1).map((p, i) => p.price - recent[i].price);
    const avgChange = changes.reduce((a, b) => a + b, 0) / changes.length;
    const basePrice = CHARACTER_MAP[ticker]?.basePrice || 1;
    const changePercent = (avgChange / basePrice) * 100;
    
    if (changePercent > 2) return 'Strong Buy';
    if (changePercent > 0.5) return 'Bullish';
    if (changePercent < -2) return 'Strong Sell';
    if (changePercent < -0.5) return 'Bearish';
    return 'Neutral';
  }, [priceHistory]);

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

    const price = prices[ticker];
    if (!price || isNaN(price)) {
      setNotification({ type: 'error', message: 'Price unavailable, try again' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }
    const asset = CHARACTER_MAP[ticker];
    const basePrice = asset?.basePrice || price;
    const userRef = doc(db, 'users', user.uid);
    const marketRef = doc(db, 'market', 'current');

    if (action === 'buy') {
      // Calculate new price FIRST - you buy at the HIGHER price
      const impactMultiplier = Math.min(1, DIMINISHING_RETURNS_THRESHOLD / amount);
      const priceImpact = price * TRADE_IMPACT_FACTOR * amount * impactMultiplier;
      const newPrice = Math.min(basePrice * (1 + MAX_PRICE_DEVIATION), price + priceImpact);
      
      // You pay the HIGHER price (after your buying pressure)
      const buyPrice = newPrice;
      const totalCost = buyPrice * amount;
      
      if (userData.cash < totalCost) {
        setNotification({ type: 'error', message: 'Insufficient funds!' });
        setTimeout(() => setNotification(null), 3000);
        return;
      }

      await updateDoc(marketRef, {
        [`prices.${ticker}`]: Math.round(newPrice * 100) / 100
      });

      // Update user
      await updateDoc(userRef, {
        cash: userData.cash - totalCost,
        [`holdings.${ticker}`]: (userData.holdings[ticker] || 0) + amount,
        lastTradeTime: now
      });

      await updateDoc(marketRef, { totalTrades: increment(1) });
      setNotification({ type: 'success', message: `Bought ${amount} ${ticker} for ${formatCurrency(totalCost)}` });
    
    } else if (action === 'sell') {
      const currentHoldings = userData.holdings[ticker] || 0;
      if (currentHoldings < amount) {
        setNotification({ type: 'error', message: 'Not enough shares!' });
        setTimeout(() => setNotification(null), 3000);
        return;
      }

      // Calculate new price FIRST - you sell at the LOWER price
      const impactMultiplier = Math.min(1, DIMINISHING_RETURNS_THRESHOLD / amount);
      const priceImpact = price * TRADE_IMPACT_FACTOR * amount * impactMultiplier;
      const newPrice = Math.max(basePrice * (1 - MAX_PRICE_DEVIATION), price - priceImpact);
      
      // You get the LOWER price (after your selling pressure)
      const sellPrice = newPrice;
      const totalRevenue = sellPrice * amount;

      await updateDoc(marketRef, {
        [`prices.${ticker}`]: Math.round(newPrice * 100) / 100
      });

      // Update user
      await updateDoc(userRef, {
        cash: userData.cash + totalRevenue,
        [`holdings.${ticker}`]: currentHoldings - amount,
        lastTradeTime: now
      });

      await updateDoc(marketRef, { totalTrades: increment(1) });
      setNotification({ type: 'success', message: `Sold ${amount} ${ticker} for ${formatCurrency(totalRevenue)}` });
    
    } else if (action === 'short') {
      // SHORTING: Borrow shares and sell them, hoping to buy back cheaper
      // You need margin as collateral but DON'T get proceeds until you cover
      const impactMultiplier = Math.min(1, DIMINISHING_RETURNS_THRESHOLD / amount);
      const priceImpact = price * TRADE_IMPACT_FACTOR * amount * impactMultiplier;
      const newPrice = Math.max(basePrice * (1 - MAX_PRICE_DEVIATION), price - priceImpact);
      
      // Entry price is the lower price after your selling pressure
      const shortPrice = newPrice;
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
      
      await updateDoc(userRef, {
        cash: newCash,
        [`shorts.${ticker}`]: {
          shares: totalShares,
          entryPrice: Math.round(avgEntryPrice * 100) / 100,
          margin: existingShort.margin + marginRequired,
          openedAt: existingShort.openedAt || now
        },
        lastTradeTime: now
      });

      await updateDoc(marketRef, {
        [`prices.${ticker}`]: Math.round(newPrice * 100) / 100,
        totalTrades: increment(1)
      });

      setNotification({ type: 'success', message: `Shorted ${amount} ${ticker} at ${formatCurrency(shortPrice)}` });
    
    } else if (action === 'cover') {
      // COVER: Buy back shares to close short position
      const existingShort = userData.shorts?.[ticker];
      
      if (!existingShort || existingShort.shares < amount) {
        setNotification({ type: 'error', message: 'No short position to cover!' });
        setTimeout(() => setNotification(null), 3000);
        return;
      }

      // Calculate price INCREASE (your cover causes buying pressure)
      const impactMultiplier = Math.min(1, DIMINISHING_RETURNS_THRESHOLD / amount);
      const priceImpact = price * TRADE_IMPACT_FACTOR * amount * impactMultiplier;
      const newPrice = Math.min(basePrice * (1 + MAX_PRICE_DEVIATION), price + priceImpact);
      
      // You pay the HIGHER price to cover
      const coverPrice = newPrice;
      
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

      await updateDoc(userRef, updateData);

      await updateDoc(marketRef, {
        [`prices.${ticker}`]: Math.round(newPrice * 100) / 100,
        totalTrades: increment(1)
      });

      const profitMsg = profit >= 0 ? `+${formatCurrency(profit)}` : formatCurrency(profit);
      setNotification({ type: profit >= 0 ? 'success' : 'error', message: `Covered ${amount} ${ticker} (${profitMsg})` });
    }

    setTimeout(() => setNotification(null), 3000);
  }, [user, userData, prices]);

  // Update portfolio value periodically
  useEffect(() => {
    if (!user || !userData) return;

    const portfolioValue = userData.cash + Object.entries(userData.holdings || {})
      .reduce((sum, [ticker, shares]) => sum + (prices[ticker] || 0) * shares, 0);

    const userRef = doc(db, 'users', user.uid);
    updateDoc(userRef, { portfolioValue: Math.round(portfolioValue * 100) / 100 });
  }, [user, userData, prices]);

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
    await updateDoc(userRef, {
      cash: userData.cash + DAILY_BONUS,
      lastCheckin: today
    });

    setNotification({ type: 'success', message: `Daily check-in: +${formatCurrency(DAILY_BONUS)}!` });
    setTimeout(() => setNotification(null), 3000);
  }, [user, userData]);

  // Logout
  const handleLogout = () => signOut(auth);

  // Guest data
  const guestData = { cash: STARTING_CASH, holdings: {}, portfolioValue: STARTING_CASH };
  const activeUserData = userData || guestData;
  const isGuest = !user;

  // Portfolio calculations
  const portfolioValue = activeUserData.cash + Object.entries(activeUserData.holdings || {})
    .reduce((sum, [ticker, shares]) => sum + (prices[ticker] || 0) * shares, 0);

  // Filter and sort
  const filteredCharacters = useMemo(() => {
    let filtered = CHARACTERS.filter(c =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.ticker.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const priceChanges = {};
    CHARACTERS.forEach(c => {
      priceChanges[c.ticker] = ((prices[c.ticker] || c.basePrice) - c.basePrice) / c.basePrice * 100;
    });

    switch (sortBy) {
      case 'price-high': filtered.sort((a, b) => (prices[b.ticker] || b.basePrice) - (prices[a.ticker] || a.basePrice)); break;
      case 'price-low': filtered.sort((a, b) => (prices[a.ticker] || a.basePrice) - (prices[b.ticker] || b.basePrice)); break;
      case 'active': filtered.sort((a, b) => Math.abs(priceChanges[b.ticker]) - Math.abs(priceChanges[a.ticker])); break;
      case 'ticker': filtered.sort((a, b) => a.ticker.localeCompare(b.ticker)); break;
    }
    return filtered;
  }, [searchQuery, sortBy, prices]);

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
        {/* Header */}
        <div className={`${cardClass} border rounded-sm p-4 mb-4`}>
          <div className="flex flex-wrap justify-between items-center gap-4">
            <div className="flex items-center gap-2">
              <svg className="w-6 h-6 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <h1 className={`text-xl font-bold tracking-tight ${textClass}`}>STOCKISM</h1>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => setShowLeaderboard(true)}
                className={`px-3 py-1 text-xs rounded-sm border ${darkMode ? 'border-slate-600 text-slate-300 hover:bg-slate-700' : 'border-slate-300 hover:bg-slate-100'}`}>
                🏆 Leaderboard
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
                  <span className={`text-sm ${mutedClass}`}>{userData?.displayName}</span>
                  <button onClick={handleLogout}
                    className="px-3 py-1 text-xs rounded-sm bg-red-600 hover:bg-red-700 text-white font-semibold uppercase">
                    Logout
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Notifications */}
        {notification && (
          <div className={`mb-4 p-3 rounded-sm text-sm font-semibold ${
            notification.type === 'error' ? 'bg-red-100 border border-red-300 text-red-700' :
            notification.type === 'info' ? 'bg-blue-100 border border-blue-300 text-blue-700' :
            'bg-green-100 border border-green-300 text-green-700'
          }`}>{notification.message}</div>
        )}

        {/* Guest Banner */}
        {isGuest && (
          <div className={`mb-4 p-3 rounded-sm text-sm ${darkMode ? 'bg-slate-800 border border-slate-700 text-slate-300' : 'bg-amber-50 border border-amber-200 text-amber-800'}`}>
            👋 Browsing as guest. <button onClick={() => setShowLoginModal(true)} className="font-semibold text-teal-600 hover:underline">Sign in</button> to trade and save progress!
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div className={`${cardClass} border rounded-sm p-4`}>
            <p className={`text-xs font-semibold uppercase ${mutedClass}`}>Cash</p>
            <p className={`text-2xl font-bold ${textClass}`}>{formatCurrency(activeUserData.cash)}</p>
            <button onClick={handleDailyCheckin}
              disabled={!isGuest && userData?.lastCheckin === new Date().toDateString()}
              className={`mt-2 w-full py-1.5 text-xs font-semibold uppercase rounded-sm ${
                !isGuest && userData?.lastCheckin === new Date().toDateString()
                  ? 'bg-slate-400 cursor-not-allowed' : 'bg-teal-600 hover:bg-teal-700'
              } text-white`}>
              {!isGuest && userData?.lastCheckin === new Date().toDateString() ? 'Checked In ✓' : 'Daily Check-in (+$300)'}
            </button>
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
              priceChange={((prices[character.ticker] || character.basePrice) - character.basePrice) / character.basePrice * 100}
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
      {showLeaderboard && <LeaderboardModal onClose={() => setShowLeaderboard(false)} darkMode={darkMode} />}
      {showPortfolio && !isGuest && (
        <PortfolioModal
          holdings={activeUserData.holdings || {}}
          prices={prices}
          onClose={() => setShowPortfolio(false)}
          onTrade={(ticker) => { setShowPortfolio(false); }}
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
