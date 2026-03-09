// ============================================
// PortfolioAnalytics Component
// Collapsible analytics dashboard for portfolio
// ============================================

import React, { useState, useMemo } from 'react';
import DonutChart from './charts/DonutChart';
import { CHARACTER_MAP } from '../characters';

// Maps tickers to their crew/faction
const CREW_TICKER_MAP = {
  // Allied
  BDNL: 'Allied', LDNL: 'Allied', VSCO: 'Allied', ZACK: 'Allied',
  JAY: 'Allied', VIN: 'Allied', AHN: 'Allied',
  // Big Deal
  JAKE: 'Big Deal', SWRD: 'Big Deal', JSN: 'Big Deal', BRAD: 'Big Deal',
  LINE: 'Big Deal', SINU: 'Big Deal', LUAH: 'Big Deal',
  // First Gen
  DG: 'First Gen', JIN: 'First Gen', SHNG: 'First Gen', GAP: 'First Gen',
  GUN: 'First Gen', GOO: 'First Gen',
  // Workers
  WRKR: 'Workers', BANG: 'Workers', CAPG: 'Workers', NOMN: 'Workers',
  NEKO: 'Workers', DOOR: 'Workers', JINJ: 'Workers', DRMA: 'Workers',
  HYOT: 'Workers', OLDF: 'Workers', DOC: 'Workers', NO1: 'Workers',
  // Hostel
  ELI: 'Hostel', SLLY: 'Hostel', CHAE: 'Hostel', MAX: 'Hostel',
  DJO: 'Hostel', ZAMI: 'Hostel', RYAN: 'Hostel',
  // Secret Friends
  LOGN: 'Secret Friends', SAM: 'Secret Friends', ALEX: 'Secret Friends',
  SHMN: 'Secret Friends',
  // Yamazaki
  SHRO: 'Yamazaki', SHKO: 'Yamazaki', HIKO: 'Yamazaki', SOMI: 'Yamazaki',
  // WTJC
  SRMK: 'WTJC', SGUI: 'WTJC', YCHL: 'WTJC', SERA: 'WTJC',
  // Fist Gang (Charles Choi)
  ELIT: 'Fist Gang', JYNG: 'Fist Gang', TOM: 'Fist Gang', KWON: 'Fist Gang',
  DNCE: 'Fist Gang', GNTL: 'Fist Gang', MMA: 'Fist Gang', LIAR: 'Fist Gang', NOH: 'Fist Gang',
  // Kitae Alliance
  KTAE: 'Kitae Alliance', SAMC: 'Kitae Alliance', YONG: 'Kitae Alliance',
  PAJU: 'Kitae Alliance', PHNG: 'Kitae Alliance', CROW: 'Kitae Alliance', COP: 'Kitae Alliance',
  // Jake Alliance
  TM: 'Jake Alliance', GONG: 'Jake Alliance', SEOK: 'Jake Alliance',
  WOLF: 'Jake Alliance', JAEG: 'Jake Alliance', YEUL: 'Jake Alliance',
  BUCH: 'Jake Alliance', UJBU: 'Jake Alliance', DAEJ: 'Jake Alliance',
  // J High School
  CRYS: 'J High', DUKE: 'J High', DOO: 'J High', JACE: 'J High',
  MIRA: 'J High', ZOE: 'J High', JOY: 'J High', JIHO: 'J High', '2SEC': 'J High',
  // Solo / Other
  SOPH: 'Other', GDOG: 'Other', CROC: 'Other', YUJA: 'Other',
  '6KNG': 'Other', XIAO: 'Other', SNEK: 'Other', OLLY: 'Other',
  MOM: 'Other', HACK: 'Other', INCH: 'Other', MISS: 'Other',
  PYNG: 'Other', SNAM: 'Other', SHRK: 'Other', BUS3: 'Other',
  BEAD: 'Other', TWHK: 'Other', JMAL: 'Other', CLUB: 'Other',
  SUJN: 'Other', LAW: 'Other', CHCH: 'Other', BEOM: 'Other',
  MUAY: 'Other', RYU: 'Other',
};

const CREW_COLORS = {
  'Allied': '#f97316',
  'Big Deal': '#3b82f6',
  'First Gen': '#eab308',
  'Workers': '#8b5cf6',
  'Hostel': '#ec4899',
  'Secret Friends': '#14b8a6',
  'Yamazaki': '#ef4444',
  'WTJC': '#6366f1',
  'Fist Gang': '#84cc16',
  'Kitae Alliance': '#f59e0b',
  'Jake Alliance': '#06b6d4',
  'J High': '#a855f7',
  'Other': '#6b7280',
  'ETF': '#d946ef',
};

const PortfolioAnalytics = ({
  darkMode = false,
  colorBlindMode = false,
  holdings = {},
  shorts = {},
  prices = {},
  costBasis = {},
  portfolioHistory = [],
  portfolioValue = 0,
  userData,
  user,
}) => {
  const [expanded, setExpanded] = useState(false);

  // ---- Derived data ----
  const positionData = useMemo(() => {
    const positions = [];

    // Longs
    Object.entries(holdings).forEach(([ticker, shares]) => {
      if (!shares) return;
      const price = prices[ticker] || CHARACTER_MAP[ticker]?.basePrice || 0;
      const cost = costBasis?.[ticker] || price;
      const value = price * shares;
      const pnl = (price - cost) * shares;
      const pnlPct = cost > 0 ? ((price - cost) / cost) * 100 : 0;
      const crew = CHARACTER_MAP[ticker]?.isETF ? 'ETF' : (CREW_TICKER_MAP[ticker] || 'Other');
      positions.push({ ticker, shares, price, cost, value, pnl, pnlPct, crew, type: 'long' });
    });

    // Shorts
    Object.entries(shorts).forEach(([ticker, shortData]) => {
      const shares = typeof shortData === 'number' ? shortData : shortData?.shares || 0;
      const entryPrice = typeof shortData === 'number' ? (costBasis?.[ticker] || 0) : (shortData?.entryPrice || costBasis?.[ticker] || 0);
      if (!shares) return;
      const price = prices[ticker] || CHARACTER_MAP[ticker]?.basePrice || 0;
      const value = price * shares;
      const pnl = (entryPrice - price) * shares;
      const pnlPct = entryPrice > 0 ? ((entryPrice - price) / entryPrice) * 100 : 0;
      const crew = CHARACTER_MAP[ticker]?.isETF ? 'ETF' : (CREW_TICKER_MAP[ticker] || 'Other');
      positions.push({ ticker, shares, price, cost: entryPrice, value, pnl, pnlPct, crew, type: 'short' });
    });

    return positions;
  }, [holdings, shorts, prices, costBasis]);

  // ---- Crew allocation ----
  const crewData = useMemo(() => {
    const crewValues = {};
    positionData.filter(p => p.type === 'long').forEach(p => {
      crewValues[p.crew] = (crewValues[p.crew] || 0) + p.value;
    });
    return Object.entries(crewValues)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({
        label,
        value,
        color: CREW_COLORS[label] || '#6b7280',
      }));
  }, [positionData]);

  // ---- Diversification score (HHI-based) ----
  const diversification = useMemo(() => {
    const longPositions = positionData.filter(p => p.type === 'long' && p.value > 0);
    if (longPositions.length === 0) return { score: 0, hhi: 10000 };
    const totalValue = longPositions.reduce((s, p) => s + p.value, 0);
    if (totalValue === 0) return { score: 0, hhi: 10000 };

    const hhi = longPositions.reduce((s, p) => {
      const w = p.value / totalValue;
      return s + w * w;
    }, 0) * 10000;

    const score = Math.max(0, 100 - hhi / 100);
    return { score: Math.round(score), hhi: Math.round(hhi) };
  }, [positionData]);

  // ---- Best / Worst positions ----
  const { best, worst } = useMemo(() => {
    const sorted = [...positionData].sort((a, b) => b.pnl - a.pnl);
    return {
      best: sorted.slice(0, 3),
      worst: sorted.slice(-3).reverse(),
    };
  }, [positionData]);

  // ---- Summary stats ----
  const stats = useMemo(() => {
    const longs = positionData.filter(p => p.type === 'long');
    const shortPos = positionData.filter(p => p.type === 'short');
    const totalPnl = positionData.reduce((s, p) => s + p.pnl, 0);
    const winners = positionData.filter(p => p.pnl > 0).length;
    const winRate = positionData.length > 0 ? (winners / positionData.length) * 100 : 0;

    return {
      totalPositions: positionData.length,
      longCount: longs.length,
      longValue: longs.reduce((s, p) => s + p.value, 0),
      shortCount: shortPos.length,
      shortValue: shortPos.reduce((s, p) => s + p.value, 0),
      totalPnl,
      winRate: Math.round(winRate),
    };
  }, [positionData]);

  // ---- Helpers ----
  const fmtMoney = (n) => {
    const sign = n >= 0 ? '+' : '';
    if (Math.abs(n) >= 1000) return `${sign}$${(n / 1000).toFixed(1)}k`;
    return `${sign}$${n.toFixed(2)}`;
  };

  const pnlColor = (val) => {
    if (val > 0) return colorBlindMode ? 'text-teal-400' : 'text-green-400';
    if (val < 0) return colorBlindMode ? 'text-purple-400' : 'text-red-400';
    return darkMode ? 'text-zinc-400' : 'text-zinc-500';
  };

  const scoreColor = (score) => {
    if (score >= 60) return colorBlindMode ? 'bg-teal-500' : 'bg-green-500';
    if (score >= 30) return 'bg-yellow-500';
    return colorBlindMode ? 'bg-purple-500' : 'bg-red-500';
  };

  const scoreTextColor = (score) => {
    if (score >= 60) return colorBlindMode ? 'text-teal-400' : 'text-green-400';
    if (score >= 30) return 'text-yellow-400';
    return colorBlindMode ? 'text-purple-400' : 'text-red-400';
  };

  const cardClass = darkMode
    ? 'bg-zinc-800/50 border border-zinc-700 rounded-sm p-4'
    : 'bg-amber-50 border border-amber-200 rounded-sm p-4';

  if (positionData.length === 0 && !expanded) return null;

  return (
    <div className={`${darkMode ? 'border-zinc-700' : 'border-amber-200'} border rounded-sm overflow-hidden`}>
      {/* Header toggle */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full flex items-center justify-between px-4 py-3 text-sm font-semibold transition-colors ${
          darkMode
            ? 'bg-zinc-800/50 text-zinc-100 hover:bg-zinc-700/50'
            : 'bg-amber-50 text-slate-900 hover:bg-amber-100'
        }`}
      >
        <span>📊 Portfolio Analytics</span>
        <svg
          className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className={`p-4 space-y-4 ${darkMode ? 'bg-zinc-900/30' : 'bg-white/50'}`}>
          {/* No positions guard */}
          {positionData.length === 0 ? (
            <p className={`text-sm text-center py-4 ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
              No positions to analyze. Buy some stocks first!
            </p>
          ) : (
            <>
              {/* Row 1: Crew Allocation + Diversification */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Crew Allocation */}
                <div className={cardClass}>
                  <h3 className={`text-xs font-semibold uppercase tracking-wider mb-3 ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
                    Crew Allocation
                  </h3>
                  <DonutChart data={crewData} size={180} darkMode={darkMode} />
                </div>

                {/* Diversification Score */}
                <div className={cardClass}>
                  <h3 className={`text-xs font-semibold uppercase tracking-wider mb-3 ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
                    Diversification Score
                  </h3>
                  <div className="flex flex-col items-center gap-3 py-2">
                    <span className={`text-4xl font-bold ${scoreTextColor(diversification.score)}`}>
                      {diversification.score}
                    </span>
                    <span className={`text-xs ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
                      out of 100
                    </span>
                    {/* Progress bar */}
                    <div className={`w-full h-3 rounded-full overflow-hidden ${darkMode ? 'bg-zinc-700' : 'bg-zinc-200'}`}>
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${scoreColor(diversification.score)}`}
                        style={{ width: `${diversification.score}%` }}
                      />
                    </div>
                    <div className="flex justify-between w-full text-xs">
                      <span className={colorBlindMode ? 'text-purple-400' : 'text-red-400'}>Concentrated</span>
                      <span className={colorBlindMode ? 'text-teal-400' : 'text-green-400'}>Diversified</span>
                    </div>
                    <p className={`text-xs mt-1 ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
                      HHI: {diversification.hhi.toLocaleString()} / 10,000
                    </p>
                  </div>
                </div>
              </div>

              {/* Row 2: Best/Worst Positions */}
              <div className={cardClass}>
                <h3 className={`text-xs font-semibold uppercase tracking-wider mb-3 ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
                  Best & Worst Positions
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Best */}
                  <div>
                    <p className={`text-xs font-medium mb-2 ${colorBlindMode ? 'text-teal-400' : 'text-green-400'}`}>
                      Top Performers
                    </p>
                    <div className="space-y-1.5">
                      {best.map((p) => (
                        <div key={`best-${p.ticker}`} className="flex items-center justify-between text-xs">
                          <span className={`font-mono font-medium ${darkMode ? 'text-zinc-200' : 'text-slate-800'}`}>
                            {p.ticker}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className={pnlColor(p.pnl)}>{fmtMoney(p.pnl)}</span>
                            <span className={`${pnlColor(p.pnlPct)} opacity-60`}>
                              ({p.pnlPct >= 0 ? '+' : ''}{p.pnlPct.toFixed(1)}%)
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Worst */}
                  <div>
                    <p className={`text-xs font-medium mb-2 ${colorBlindMode ? 'text-purple-400' : 'text-red-400'}`}>
                      Worst Performers
                    </p>
                    <div className="space-y-1.5">
                      {worst.map((p) => (
                        <div key={`worst-${p.ticker}`} className="flex items-center justify-between text-xs">
                          <span className={`font-mono font-medium ${darkMode ? 'text-zinc-200' : 'text-slate-800'}`}>
                            {p.ticker}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className={pnlColor(p.pnl)}>{fmtMoney(p.pnl)}</span>
                            <span className={`${pnlColor(p.pnlPct)} opacity-60`}>
                              ({p.pnlPct >= 0 ? '+' : ''}{p.pnlPct.toFixed(1)}%)
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Row 3: Summary Stats */}
              <div className={cardClass}>
                <h3 className={`text-xs font-semibold uppercase tracking-wider mb-3 ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
                  Portfolio Summary
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <StatBox
                    label="Total Positions"
                    value={stats.totalPositions}
                    darkMode={darkMode}
                  />
                  <StatBox
                    label="Long Positions"
                    value={`${stats.longCount} ($${stats.longValue.toFixed(0)})`}
                    darkMode={darkMode}
                  />
                  <StatBox
                    label="Short Positions"
                    value={`${stats.shortCount} ($${stats.shortValue.toFixed(0)})`}
                    darkMode={darkMode}
                  />
                  <StatBox
                    label="Unrealized P&L"
                    value={fmtMoney(stats.totalPnl)}
                    valueColor={pnlColor(stats.totalPnl)}
                    darkMode={darkMode}
                  />
                  <StatBox
                    label="Win Rate"
                    value={`${stats.winRate}%`}
                    valueColor={
                      stats.winRate >= 50
                        ? (colorBlindMode ? 'text-teal-400' : 'text-green-400')
                        : (colorBlindMode ? 'text-purple-400' : 'text-red-400')
                    }
                    darkMode={darkMode}
                  />
                  <StatBox
                    label="Portfolio Value"
                    value={`$${portfolioValue.toFixed(0)}`}
                    valueColor="text-orange-500"
                    darkMode={darkMode}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

const StatBox = ({ label, value, valueColor, darkMode }) => (
  <div className="text-center">
    <p className={`text-xs ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>{label}</p>
    <p className={`text-sm font-semibold mt-0.5 ${valueColor || (darkMode ? 'text-zinc-100' : 'text-slate-900')}`}>
      {value}
    </p>
  </div>
);

export default PortfolioAnalytics;
