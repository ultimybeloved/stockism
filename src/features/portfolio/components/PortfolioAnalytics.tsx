// ============================================
// PortfolioAnalytics Component
// Collapsible analytics dashboard for portfolio
// ============================================

import { useState, useMemo } from 'react';
import DonutChart from '../../../shared/components/charts/DonutChart';
import { CHARACTER_MAP } from '../../../characters';
import { themeClasses } from '../../../utils/theme';

import { CREW_TICKER_MAP, CREW_COLORS, OTHER_GROUP, ETF_GROUP } from '../../../constants/crewGroups';
import { sharesOf } from '../../../utils/holdings';
import type { PriceMap, ShareMap, ShortMap } from '../../../types';

interface PortfolioAnalyticsProps {
  colorBlindMode?: boolean;
  holdings?: ShareMap | null;
  shorts?: ShortMap | null;
  prices?: PriceMap;
  costBasis?: Record<string, number> | null;
  portfolioValue?: number;
}

interface AnalyticsPosition {
  ticker: string;
  shares: number;
  price: number;
  cost: number;
  value: number;
  pnl: number;
  pnlPct: number;
  crew: string;
  type: 'long' | 'short';
}

const PortfolioAnalytics = ({
  colorBlindMode = false,
  holdings,
  shorts,
  prices = {},
  costBasis,
  portfolioValue = 0,
}: PortfolioAnalyticsProps) => {
  const [expanded, setExpanded] = useState(false);

  // ---- Derived data ----
  const positionData = useMemo(() => {
    const positions: AnalyticsPosition[] = [];

    // Longs
    Object.entries(holdings || {}).forEach(([ticker, shares]) => {
      if (!shares) return;
      const price = prices[ticker] || CHARACTER_MAP[ticker]?.basePrice || 0;
      const cost = costBasis?.[ticker] || price;
      const value = price * shares;
      const pnl = (price - cost) * shares;
      const pnlPct = cost > 0 ? ((price - cost) / cost) * 100 : 0;
      const crew = CHARACTER_MAP[ticker]?.isETF ? ETF_GROUP : CREW_TICKER_MAP[ticker] || OTHER_GROUP;
      positions.push({ ticker, shares, price, cost, value, pnl, pnlPct, crew, type: 'long' });
    });

    // Shorts
    Object.entries(shorts || {}).forEach(([ticker, shortData]) => {
      const shares = sharesOf(shortData);
      const entryPrice =
        typeof shortData === 'number' ? costBasis?.[ticker] || 0 : shortData?.entryPrice || costBasis?.[ticker] || 0;
      if (!shares) return;
      const price = prices[ticker] || CHARACTER_MAP[ticker]?.basePrice || 0;
      const value = price * shares;
      const pnl = (entryPrice - price) * shares;
      const pnlPct = entryPrice > 0 ? ((entryPrice - price) / entryPrice) * 100 : 0;
      const crew = CHARACTER_MAP[ticker]?.isETF ? ETF_GROUP : CREW_TICKER_MAP[ticker] || OTHER_GROUP;
      positions.push({ ticker, shares, price, cost: entryPrice, value, pnl, pnlPct, crew, type: 'short' });
    });

    return positions;
  }, [holdings, shorts, prices, costBasis]);

  // ---- Crew allocation ----
  const crewData = useMemo(() => {
    const crewValues: Record<string, number> = {};
    positionData
      .filter((p) => p.type === 'long')
      .forEach((p) => {
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
    const longPositions = positionData.filter((p) => p.type === 'long' && p.value > 0);
    if (longPositions.length === 0) return { score: 0, hhi: 10000 };
    const totalValue = longPositions.reduce((s, p) => s + p.value, 0);
    if (totalValue === 0) return { score: 0, hhi: 10000 };

    const hhi =
      longPositions.reduce((s, p) => {
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
    const longs = positionData.filter((p) => p.type === 'long');
    const shortPos = positionData.filter((p) => p.type === 'short');
    const totalPnl = positionData.reduce((s, p) => s + p.pnl, 0);
    const winners = positionData.filter((p) => p.pnl > 0).length;
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
  const fmtMoney = (n: number) => {
    const sign = n >= 0 ? '+' : '';
    if (Math.abs(n) >= 1000) return `${sign}$${(n / 1000).toFixed(1)}k`;
    return `${sign}$${n.toFixed(2)}`;
  };

  const pnlColor = (val: number) => {
    if (val > 0) return colorBlindMode ? 'text-teal-400' : 'text-green-400';
    if (val < 0) return colorBlindMode ? 'text-purple-400' : 'text-red-400';
    return 'light:text-zinc-500 dark:text-zinc-400';
  };

  const scoreColor = (score: number) => {
    if (score >= 60) return colorBlindMode ? 'bg-teal-500' : 'bg-green-500';
    if (score >= 30) return 'bg-yellow-500';
    return colorBlindMode ? 'bg-purple-500' : 'bg-red-500';
  };

  const scoreTextColor = (score: number) => {
    if (score >= 60) return colorBlindMode ? 'text-teal-400' : 'text-green-400';
    if (score >= 30) return 'text-yellow-400';
    return colorBlindMode ? 'text-purple-400' : 'text-red-400';
  };

  const cardClass =
    'light:bg-amber-50 light:border light:border-amber-200 light:rounded-sm light:p-4 dark:bg-zinc-800/50 dark:border dark:border-zinc-700 dark:rounded-sm dark:p-4';

  const { borderClass } = themeClasses;
  if (positionData.length === 0 && !expanded) return null;

  return (
    <div className={`${borderClass} border rounded-sm overflow-hidden`}>
      {/* Header toggle */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold transition-colors light:bg-amber-50 light:text-slate-900 light:hover:bg-amber-100 dark:bg-zinc-800/50 dark:text-zinc-100 dark:hover:bg-zinc-700/50"
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
        <div className="p-4 space-y-4 light:bg-white/50 dark:bg-zinc-900/30">
          {/* No positions guard */}
          {positionData.length === 0 ? (
            <p className="text-sm text-center py-4 light:text-zinc-400 dark:text-zinc-500">
              No positions to analyze. Buy some stocks first!
            </p>
          ) : (
            <>
              {/* Row 1: Crew Allocation + Diversification */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Crew Allocation */}
                <div className={cardClass}>
                  <h3 className="text-xs font-semibold uppercase tracking-wider mb-3 light:text-zinc-500 dark:text-zinc-400">
                    Crew Allocation
                  </h3>
                  <DonutChart data={crewData} size={180} />
                </div>

                {/* Diversification Score */}
                <div className={cardClass}>
                  <h3 className="text-xs font-semibold uppercase tracking-wider mb-3 light:text-zinc-500 dark:text-zinc-400">
                    Diversification Score
                  </h3>
                  <div className="flex flex-col items-center gap-3 py-2">
                    <span className={`text-4xl font-bold ${scoreTextColor(diversification.score)}`}>
                      {diversification.score}
                    </span>
                    <span className="text-xs light:text-zinc-400 dark:text-zinc-500">out of 100</span>
                    {/* Progress bar */}
                    <div className="w-full h-3 rounded-full overflow-hidden light:bg-zinc-200 dark:bg-zinc-700">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${scoreColor(diversification.score)}`}
                        style={{ width: `${diversification.score}%` }}
                      />
                    </div>
                    <div className="flex justify-between w-full text-xs">
                      <span className={colorBlindMode ? 'text-purple-400' : 'text-red-400'}>Concentrated</span>
                      <span className={colorBlindMode ? 'text-teal-400' : 'text-green-400'}>Diversified</span>
                    </div>
                    <p className="text-xs mt-1 light:text-zinc-400 dark:text-zinc-500">
                      HHI: {diversification.hhi.toLocaleString()} / 10,000
                    </p>
                  </div>
                </div>
              </div>

              {/* Row 2: Best/Worst Positions */}
              <div className={cardClass}>
                <h3 className="text-xs font-semibold uppercase tracking-wider mb-3 light:text-zinc-500 dark:text-zinc-400">
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
                          <span className="font-mono font-medium light:text-slate-800 dark:text-zinc-200">
                            {p.ticker}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className={pnlColor(p.pnl)}>{fmtMoney(p.pnl)}</span>
                            <span className={`${pnlColor(p.pnlPct)} opacity-60`}>
                              ({p.pnlPct >= 0 ? '+' : ''}
                              {p.pnlPct.toFixed(1)}%)
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
                          <span className="font-mono font-medium light:text-slate-800 dark:text-zinc-200">
                            {p.ticker}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className={pnlColor(p.pnl)}>{fmtMoney(p.pnl)}</span>
                            <span className={`${pnlColor(p.pnlPct)} opacity-60`}>
                              ({p.pnlPct >= 0 ? '+' : ''}
                              {p.pnlPct.toFixed(1)}%)
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
                <h3 className="text-xs font-semibold uppercase tracking-wider mb-3 light:text-zinc-500 dark:text-zinc-400">
                  Portfolio Summary
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <StatBox label="Total Positions" value={stats.totalPositions} />
                  <StatBox label="Long Positions" value={`${stats.longCount} ($${stats.longValue.toFixed(0)})`} />
                  <StatBox label="Short Positions" value={`${stats.shortCount} ($${stats.shortValue.toFixed(0)})`} />
                  <StatBox
                    label="Unrealized P&L"
                    value={fmtMoney(stats.totalPnl)}
                    valueColor={pnlColor(stats.totalPnl)}
                  />
                  <StatBox
                    label="Win Rate"
                    value={`${stats.winRate}%`}
                    valueColor={
                      stats.winRate >= 50
                        ? colorBlindMode
                          ? 'text-teal-400'
                          : 'text-green-400'
                        : colorBlindMode
                          ? 'text-purple-400'
                          : 'text-red-400'
                    }
                  />
                  <StatBox
                    label="Portfolio Value"
                    value={`$${portfolioValue.toFixed(0)}`}
                    valueColor="text-orange-500"
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

const StatBox = ({ label, value, valueColor }: { label: string; value: string | number; valueColor?: string }) => (
  <div className="text-center">
    <p className="text-xs light:text-zinc-400 dark:text-zinc-500">{label}</p>
    <p className={`text-sm font-semibold mt-0.5 ${valueColor || 'light:text-slate-900 dark:text-zinc-100'}`}>{value}</p>
  </div>
);

export default PortfolioAnalytics;
