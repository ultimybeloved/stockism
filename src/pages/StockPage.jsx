import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, updateDoc, deleteField } from 'firebase/firestore';
import { db } from '../firebase';
import { CHARACTER_MAP, getDividendTier } from '../characters';
import { CREWS } from '../crews';
import { useAppContext } from '../context/AppContext';
import { formatCurrency, formatChange } from '../utils/formatters';
import { getThemeClasses } from '../utils/theme';
import { DIVIDEND_RATES } from '../constants/economy';
import PriceChart, { TIME_RANGES } from '../components/PriceChart';
import TradeActionModal from '../components/modals/TradeActionModal';

const CHART_TYPES = [
  { key: 'area', label: 'Area' },
  { key: 'line', label: 'Line' },
  { key: 'bar', label: 'Bar' },
];

const StockPage = ({ onTrade }) => {
  const { ticker } = useParams();
  const navigate = useNavigate();
  const { darkMode, user, userData, prices, priceHistory, holdings, shorts, costBasis } = useAppContext();
  const colorBlindMode = userData?.colorBlindMode || false;
  const [timeRange, setTimeRange] = useState('1d');
  const [chartType, setChartType] = useState('area');
  const [tradeAction, setTradeAction] = useState(null);

  const character = CHARACTER_MAP[ticker];
  const { cardClass, textClass, mutedClass, bgClass } = getThemeClasses(darkMode);

  const currentPrice = prices[ticker] || character?.basePrice || 0;
  const positionShares = holdings?.[ticker] || 0;
  const shortPosition = shorts?.[ticker];
  const avgCost = costBasis?.[ticker] || 0;

  const drip = userData?.drip || {};
  const handleToggleDrip = async () => {
    if (!user) return;
    const isEnabled = !!drip[ticker];
    await updateDoc(doc(db, 'users', user.uid), {
      [`drip.${ticker}`]: isEnabled ? deleteField() : true,
    });
  };

  // Price stats from history
  const history = priceHistory[ticker] || [];
  const priceStats = useMemo(() => {
    const range = TIME_RANGES.find(r => r.key === timeRange);
    const cutoff = range.hours === Infinity ? 0 : Date.now() - range.hours * 3600000;
    const filtered = history.filter(p => p.timestamp >= cutoff);

    const ago7d = Date.now() - 7 * 86400000;
    const ago30d = Date.now() - 30 * 86400000;
    const filtered7d = history.filter(p => p.timestamp >= ago7d);
    const filtered30d = history.filter(p => p.timestamp >= ago30d);

    const first = filtered[0]?.price || currentPrice;
    const allPrices = filtered.map(p => p.price);
    const high = allPrices.length ? Math.max(...allPrices) : currentPrice;
    const low = allPrices.length ? Math.min(...allPrices) : currentPrice;
    const change = first > 0 ? ((currentPrice - first) / first) * 100 : 0;

    const price7dAgo = filtered7d[0]?.price || currentPrice;
    const change7d = price7dAgo > 0 ? ((currentPrice - price7dAgo) / price7dAgo) * 100 : 0;

    const price30dAgo = filtered30d[0]?.price || currentPrice;
    const change30d = price30dAgo > 0 ? ((currentPrice - price30dAgo) / price30dAgo) * 100 : 0;

    return { first, high, low, change, change7d, change30d };
  }, [history, timeRange, currentPrice]);

  const isUp = priceStats.change >= 0;
  const upColor = colorBlindMode ? 'text-teal-500' : 'text-green-500';
  const downColor = colorBlindMode ? 'text-purple-500' : 'text-red-500';

  // Dividend info
  const dividendTier = character ? getDividendTier(ticker) : 'growth';
  const dividendRate = DIVIDEND_RATES[dividendTier] || 0;
  const cohort = userData?.holdingCohorts?.[ticker];
  const eligibleShares = cohort ? (cohort.eligible || 0) + (cohort.pending || []).filter(p => (p.availableAt || 0) <= Date.now()).reduce((s, p) => s + (p.shares || 0), 0) : 0;
  const weeklyDividend = eligibleShares * currentPrice * dividendRate;

  // Position P&L
  const positionValue = positionShares * currentPrice;
  const positionCost = avgCost * positionShares;
  const positionPL = positionValue - positionCost;
  const positionPLPct = positionCost > 0 ? (positionPL / positionCost) * 100 : 0;

  const crew = !character?.isETF ? Object.values(CREWS).find(c => c.members.includes(ticker)) : null;

  if (!character) {
    return (
      <div className={`min-h-screen ${bgClass} flex items-center justify-center`}>
        <div className="text-center">
          <p className={`text-lg ${textClass} mb-2`}>Unknown ticker: ${ticker}</p>
          <button onClick={() => navigate('/')} className="text-orange-500 hover:underline text-sm">← Back to market</button>
        </div>
      </div>
    );
  }

  const statCard = (label, value, valueClass = textClass) => (
    <div className={`p-3 rounded-sm border ${darkMode ? 'border-zinc-800 bg-zinc-900' : 'border-amber-200 bg-white'}`}>
      <div className={`text-xs ${mutedClass} uppercase mb-1`}>{label}</div>
      <div className={`font-semibold ${valueClass}`}>{value}</div>
    </div>
  );

  const changeClass = (pct) => pct >= 0 ? upColor : downColor;
  const changeDisplay = (pct) => `${pct >= 0 ? '▲' : '▼'} ${formatChange(Math.abs(pct))}`;

  return (
    <div className={`min-h-screen ${bgClass}`}>
      <div className="max-w-4xl mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => navigate(-1)} className={`${mutedClass} hover:text-orange-500 text-sm`}>← Back</button>
        </div>

        <div className={`${cardClass} border rounded-sm p-4 mb-4`}>
          <div className="flex justify-between items-start">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-orange-600 font-mono text-xl font-bold">${ticker}</span>
                {character.isETF && <span className="text-xs bg-purple-600 text-white px-1.5 py-0.5 rounded">ETF</span>}
                {crew && (
                  <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-semibold" style={{ backgroundColor: crew.color + '22', border: `1px solid ${crew.color}55`, color: crew.color }}>
                    <img src={crew.icon} alt="" className="w-3 h-3 object-contain" />
                    {crew.name}
                  </span>
                )}
              </div>
              <p className={`text-sm ${mutedClass} mt-0.5`}>{character.name}</p>
            </div>
            <div className="text-right">
              <div className={`text-2xl font-bold ${textClass}`}>{formatCurrency(currentPrice)}</div>
              <div className={`text-sm font-semibold ${isUp ? upColor : downColor}`}>
                {isUp ? '▲' : '▼'} {formatChange(Math.abs(priceStats.change))}
                <span className={`text-xs ml-1 ${mutedClass}`}>({TIME_RANGES.find(r => r.key === timeRange)?.label})</span>
              </div>
            </div>
          </div>
          {user && (
            <button
              onClick={() => setTradeAction('buy')}
              className="mt-3 px-4 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold rounded-sm"
            >
              Trade
            </button>
          )}
        </div>

        {/* Chart */}
        <div className={`${cardClass} border rounded-sm mb-4 overflow-hidden`}>
          <div className={`px-4 py-2 border-b flex flex-wrap gap-2 justify-between ${darkMode ? 'border-zinc-800 bg-zinc-900/50' : 'border-amber-200 bg-amber-50'}`}>
            <div className="flex gap-1">
              {TIME_RANGES.map(r => (
                <button key={r.key} onClick={() => setTimeRange(r.key)}
                  className={`px-3 py-1 text-xs font-semibold rounded-sm transition-colors ${
                    timeRange === r.key ? 'bg-orange-600 text-white'
                      : darkMode ? 'text-zinc-400 hover:bg-zinc-800' : 'text-zinc-600 hover:bg-slate-200'
                  }`}
                >{r.label}</button>
              ))}
            </div>
            <div className="flex gap-1">
              {CHART_TYPES.map(t => (
                <button key={t.key} onClick={() => setChartType(t.key)}
                  className={`px-3 py-1 text-xs font-semibold rounded-sm transition-colors ${
                    chartType === t.key ? 'bg-zinc-600 text-white'
                      : darkMode ? 'text-zinc-400 hover:bg-zinc-800' : 'text-zinc-600 hover:bg-slate-200'
                  }`}
                >{t.label}</button>
              ))}
            </div>
          </div>
          <div className={`p-4 ${bgClass}`}>
            <PriceChart ticker={ticker} basePrice={character.basePrice} currentPrice={currentPrice} timeRange={timeRange} chartType={chartType} />
          </div>
          <div className={`px-4 pb-3 grid grid-cols-4 gap-3 text-center border-t ${darkMode ? 'border-zinc-800' : 'border-amber-200'} pt-3`}>
            {[['Open', formatCurrency(priceStats.first), textClass], ['High', formatCurrency(priceStats.high), upColor], ['Low', formatCurrency(priceStats.low), downColor], ['Current', formatCurrency(currentPrice), textClass]].map(([l, v, c]) => (
              <div key={l}><div className={`text-xs ${mutedClass} uppercase`}>{l}</div><div className={`font-semibold ${c}`}>{v}</div></div>
            ))}
          </div>
        </div>

        {/* Key Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
          {statCard('7d Change', changeDisplay(priceStats.change7d), changeClass(priceStats.change7d))}
          {statCard('30d Change', changeDisplay(priceStats.change30d), changeClass(priceStats.change30d))}
          {statCard('Base Price', formatCurrency(character.basePrice))}
          {dividendRate > 0
            ? statCard('Dividend', `${(dividendRate * 100).toFixed(2)}% / week`, upColor)
            : statCard('Dividend', 'Growth — none', mutedClass)}
          {character.isETF && character.constituents && statCard('Holdings', `${character.constituents.length} stocks`)}
        </div>

        {/* Your Position */}
        {(positionShares > 0 || shortPosition?.shares > 0) && (
          <div className={`${cardClass} border rounded-sm p-4 mb-4`}>
            <h3 className={`text-sm font-semibold ${textClass} mb-3`}>Your Position</h3>
            {positionShares > 0 && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className={mutedClass}>Shares held</span>
                  <span className={textClass}>{positionShares}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className={mutedClass}>Avg cost</span>
                  <span className={textClass}>{formatCurrency(avgCost)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className={mutedClass}>Total P&L</span>
                  <span className={positionPL >= 0 ? upColor : downColor}>
                    {positionPL >= 0 ? '+' : ''}{formatCurrency(positionPL)} ({positionPLPct >= 0 ? '+' : ''}{positionPLPct.toFixed(2)}%)
                  </span>
                </div>
                {dividendRate > 0 && weeklyDividend > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className={mutedClass}>Weekly dividend</span>
                    <span className={upColor}>~{formatCurrency(weeklyDividend)}</span>
                  </div>
                )}
                {dividendRate > 0 && (
                  <div className="flex justify-between items-center text-sm">
                    <span className={mutedClass}>DRIP</span>
                    <button
                      onClick={handleToggleDrip}
                      title={drip[ticker] ? 'DRIP on — dividends auto-buy shares. Click to turn off.' : 'DRIP off — dividends pay as cash. Click to reinvest.'}
                      className={`text-xs px-2 py-1 rounded font-semibold transition-colors ${
                        drip[ticker] ? 'bg-emerald-600 text-white' : darkMode ? 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600' : 'bg-zinc-200 text-zinc-500 hover:bg-zinc-300'
                      }`}
                    >
                      {drip[ticker] ? 'ON' : 'OFF'}
                    </button>
                  </div>
                )}
              </div>
            )}
            {shortPosition?.shares > 0 && (
              <div className={`mt-3 pt-3 ${positionShares > 0 ? `border-t ${darkMode ? 'border-zinc-800' : 'border-amber-200'}` : ''} space-y-2`}>
                <div className="flex justify-between text-sm">
                  <span className={mutedClass}>Shares short</span>
                  <span className="text-orange-500">{shortPosition.shares}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className={mutedClass}>Short entry</span>
                  <span className={textClass}>{formatCurrency(shortPosition.costBasis || shortPosition.entryPrice || 0)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className={mutedClass}>Short P&L</span>
                  {(() => {
                    const pl = ((shortPosition.costBasis || shortPosition.entryPrice || 0) - currentPrice) * shortPosition.shares;
                    return <span className={pl >= 0 ? upColor : downColor}>{pl >= 0 ? '+' : ''}{formatCurrency(pl)}</span>;
                  })()}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ETF Constituents */}
        {character.isETF && character.constituents?.length > 0 && (
          <div className={`${cardClass} border rounded-sm p-4`}>
            <h3 className={`text-sm font-semibold ${textClass} mb-3`}>Holdings ({character.constituents.length})</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {[...character.constituents]
                .sort((a, b) => (prices[b] || 0) - (prices[a] || 0))
                .map(t => {
                  const tHistory = priceHistory[t] || [];
                  const ago24h = Date.now() - 86400000;
                  const filtered = tHistory.filter(p => p.timestamp >= ago24h);
                  const tFirst = filtered[0]?.price || (prices[t] || 0);
                  const tChange = tFirst > 0 ? ((prices[t] - tFirst) / tFirst) * 100 : 0;
                  const tUp = tChange >= 0;
                  return (
                    <button key={t} onClick={() => navigate(`/stock/${t}`)}
                      className={`flex justify-between items-center p-2 rounded-sm border text-left hover:border-orange-500 transition-colors ${darkMode ? 'border-zinc-800 hover:bg-zinc-800' : 'border-amber-200 hover:bg-amber-50'}`}
                    >
                      <span className="text-orange-600 font-mono text-xs font-semibold">${t}</span>
                      <div className="text-right">
                        <div className={`text-xs font-semibold ${textClass}`}>{formatCurrency(prices[t] || 0)}</div>
                        <div className={`text-[10px] ${tUp ? upColor : downColor}`}>{tUp ? '▲' : '▼'} {formatChange(Math.abs(tChange))}</div>
                      </div>
                    </button>
                  );
                })}
            </div>
          </div>
        )}
      </div>

      {tradeAction && (
        <TradeActionModal
          character={character}
          action={tradeAction}
          price={currentPrice}
          holdings={positionShares}
          shortPosition={shortPosition}
          userCash={userData?.cash || 0}
          onTrade={onTrade}
          onClose={() => setTradeAction(null)}
        />
      )}
    </div>
  );
};

export default StockPage;
