import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, updateDoc, deleteField } from 'firebase/firestore';
import { db } from '../firebase';
import { CHARACTER_MAP, getDividendTier, CHARACTERS } from '../characters';
import { CREWS } from '../crews';
import { useAppContext } from '../context/AppContext';
import { formatCurrency, formatChange } from '../utils/formatters';
import { getThemeClasses, getReadableCrewColor } from '../utils/theme';
import { DIVIDEND_RATES, dividendWeightedShares, BID_ASK_SPREAD, ETF_BID_ASK_SPREAD } from '../constants/economy';
import PriceChart, { TIME_RANGES } from '../components/PriceChart';
import TradeActionModal from '../components/modals/TradeActionModal';
import { usePriceHistory } from '../hooks/usePriceHistory';
import { getMarketClosedState } from '../utils/marketHours';

const CHART_TYPES = [
  { key: 'area', label: 'Area' },
  { key: 'bar', label: 'Bar' },
];

const StockPage = ({ onTrade }) => {
  const { ticker } = useParams();
  const navigate = useNavigate();
  const { darkMode, user, userData, prices, priceHistory, holdings, shorts, costBasis, marketData, rarityTiers } = useAppContext();
  const { fullHistory } = usePriceHistory(ticker);
  const colorBlindMode = userData?.colorBlindMode || false;
  const marketClosed = getMarketClosedState(marketData).closed;
  const [timeRange, setTimeRange] = useState('1d');
  const [chartType, setChartType] = useState('area');
  const [tradeAction, setTradeAction] = useState(null);
  const [showTradeMenu, setShowTradeMenu] = useState(false);
  const [hoveredChartPoint, setHoveredChartPoint] = useState(null);

  const character = CHARACTER_MAP[ticker];
  const { cardClass, textClass, mutedClass, bgClass } = getThemeClasses(darkMode);

  const currentPrice = prices[ticker] || character?.basePrice || 0;
  const positionShares = holdings?.[ticker] || 0;
  const shortPosition = shorts?.[ticker];
  const avgCost = costBasis?.[ticker] || 0;
  const spread = character?.isETF ? ETF_BID_ASK_SPREAD : BID_ASK_SPREAD;
  const bidPrice = currentPrice * (1 - spread / 2);
  const askPrice = currentPrice * (1 + spread / 2);

  const drip = userData?.drip || {};
  const handleToggleDrip = async () => {
    if (!user) return;
    await updateDoc(doc(db, 'users', user.uid), {
      [`drip.${ticker}`]: drip[ticker] ? deleteField() : true,
    });
  };

  const priceStats = useMemo(() => {
    const range = TIME_RANGES.find(r => r.key === timeRange);
    const cutoff = range.hours === Infinity ? 0 : Date.now() - range.hours * 3600000;
    const filtered = fullHistory.filter(p => p.timestamp >= cutoff);
    const ago30d = Date.now() - 30 * 86400000;
    const ago7d = Date.now() - 7 * 86400000;
    const ago52w = Date.now() - 365 * 86400000;
    const f30d = fullHistory.filter(p => p.timestamp >= ago30d);
    const f7d = fullHistory.filter(p => p.timestamp >= ago7d);
    const f52w = fullHistory.filter(p => p.timestamp >= ago52w);

    const px = (arr) => arr.map(p => p.price);
    const hi = (arr) => arr.length ? Math.max(...px(arr)) : currentPrice;
    const lo = (arr) => arr.length ? Math.min(...px(arr)) : currentPrice;

    const first = filtered[0]?.price || currentPrice;
    const change = first > 0 ? ((currentPrice - first) / first) * 100 : 0;
    const price7dAgo = f7d[0]?.price || currentPrice;
    const change7d = price7dAgo > 0 ? ((currentPrice - price7dAgo) / price7dAgo) * 100 : 0;
    const price30dAgo = f30d[0]?.price || currentPrice;
    const change30d = price30dAgo > 0 ? ((currentPrice - price30dAgo) / price30dAgo) * 100 : 0;

    return {
      first, change, change7d, change30d,
      high: hi(filtered), low: lo(filtered),
      high30d: hi(f30d), low30d: lo(f30d),
      high52w: hi(f52w), low52w: lo(f52w),
    };
  }, [fullHistory, timeRange, currentPrice]);

  const isUp = priceStats.change >= 0;
  const upColor = colorBlindMode ? 'text-teal-500' : 'text-green-500';
  const downColor = colorBlindMode ? 'text-purple-500' : 'text-red-500';
  const cc = (pct) => pct >= 0 ? upColor : downColor;
  const cd = (pct) => `${pct >= 0 ? '▲' : '▼'} ${formatChange(Math.abs(pct))}`;

  const dividendTier = character ? getDividendTier(ticker, rarityTiers) : 'none';
  const dividendRate = DIVIDEND_RATES[dividendTier] || 0;
  const cohort = userData?.holdingCohorts?.[ticker];
  // Loyalty-weighted estimate: matured shares at the top multiplier, each
  // pending lot at its own rung (0 while inside the 10-day hold).
  const weeklyDividend = dividendWeightedShares(cohort, Date.now()) * currentPrice * dividendRate;

  const positionValue = positionShares * currentPrice;
  const positionCost = avgCost * positionShares;
  const positionPL = positionValue - positionCost;
  const positionPLPct = positionCost > 0 ? (positionPL / positionCost) * 100 : 0;

  const crew = !character?.isETF ? Object.values(CREWS).find(c => c.members.includes(ticker)) : null;
  const memberOfETFs = !character?.isETF ? CHARACTERS.filter(c => c.isETF && c.constituents?.includes(ticker)) : [];

  const stat = (label, value, cls = textClass) => (
    <div className={`p-3 rounded-sm border ${darkMode ? 'border-zinc-800 bg-zinc-900' : 'border-amber-200 bg-white'}`}>
      <div className={`text-xs ${mutedClass} uppercase mb-1`}>{label}</div>
      <div className={`font-semibold text-sm ${cls}`}>{value}</div>
    </div>
  );

  const tradeButtons = (
    <div className="space-y-2 mt-3">
      <div className="grid grid-cols-2 gap-2">
        {[['buy', colorBlindMode ? 'bg-teal-600 hover:bg-teal-700' : 'bg-green-600 hover:bg-green-700'],
          ['sell', colorBlindMode ? 'bg-purple-600 hover:bg-purple-700' : 'bg-red-600 hover:bg-red-700'],
          ['short', 'border-2 border-orange-500 text-orange-500 hover:bg-orange-500/10'],
          ['cover', 'border-2 border-blue-500 text-blue-500 hover:bg-blue-500/10']].map(([action, cls]) => (
          <button key={action}
            disabled={action === 'sell' && positionShares === 0 || action === 'cover' && !shortPosition?.shares}
            onClick={() => { setTradeAction(action); setShowTradeMenu(false); }}
            className={`py-1.5 text-xs font-semibold uppercase rounded-sm ${cls} text-white disabled:opacity-40`}
          >
            {action}
          </button>
        ))}
      </div>
      <button onClick={() => setShowTradeMenu(false)} className={`w-full py-1 text-xs ${mutedClass} hover:text-orange-500`}>Cancel</button>
    </div>
  );

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

  return (
    <div className={`min-h-screen ${bgClass}`}>
      <div className="max-w-4xl mx-auto px-4 py-6">

        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => navigate(-1)} className={`${mutedClass} hover:text-orange-500 text-sm`}>← Back</button>
        </div>

        {/* Header */}
        <div className={`${cardClass} border rounded-sm p-4 mb-4`}>
          <div className="flex justify-between items-start">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-orange-500 font-mono text-xl font-bold">${ticker}</span>
                {character.isETF && <span className="text-xs bg-purple-600 text-white px-1.5 py-0.5 rounded">ETF</span>}
                {crew && (
                  <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-semibold"
                    style={{ backgroundColor: crew.color + '22', border: `1px solid ${crew.color}55`, color: getReadableCrewColor(crew.color, darkMode) }}>
                    <img src={crew.icon} alt="" className="w-3 h-3 object-contain" />{crew.name}
                  </span>
                )}
              </div>
              <p className={`text-sm ${mutedClass} mt-0.5`}>{character.name}</p>
              {character.description && <p className={`text-xs ${mutedClass} mt-0.5`}>{character.description}</p>}
            </div>
            <div className="text-right">
              <div className={`text-2xl font-bold ${textClass}`}>
                {formatCurrency(hoveredChartPoint ? hoveredChartPoint.price : currentPrice)}
              </div>
              {hoveredChartPoint ? (() => {
                const hChange = priceStats.first > 0 ? ((hoveredChartPoint.price - priceStats.first) / priceStats.first) * 100 : 0;
                return (
                  <div className={`text-sm font-semibold ${hChange >= 0 ? upColor : downColor}`}>
                    {hChange >= 0 ? '▲' : '▼'} {formatChange(Math.abs(hChange))}
                    <span className={`text-xs ml-1 font-normal ${mutedClass}`}>({TIME_RANGES.find(r => r.key === timeRange)?.label})</span>
                  </div>
                );
              })() : (
                <div className={`text-sm font-semibold ${isUp ? upColor : downColor}`}>
                  {isUp ? '▲' : '▼'} {formatChange(Math.abs(priceStats.change))}
                  <span className={`text-xs ml-1 font-normal ${mutedClass}`}>({TIME_RANGES.find(r => r.key === timeRange)?.label})</span>
                </div>
              )}
            </div>
          </div>
          {user && (
            marketClosed
              ? <button disabled className="mt-3 px-4 py-1.5 border border-red-500/30 text-red-400 opacity-60 text-sm font-semibold uppercase rounded-sm cursor-not-allowed">Market Closed</button>
              : !showTradeMenu
                ? <button onClick={() => setShowTradeMenu(true)} className="mt-3 px-4 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold rounded-sm">Trade</button>
                : tradeButtons
          )}
        </div>

        {/* Chart */}
        <div className={`${cardClass} border rounded-sm mb-4 overflow-hidden`}>
          <div className={`px-4 py-2 border-b flex flex-wrap gap-2 justify-between items-center ${darkMode ? 'border-zinc-800 bg-zinc-900/50' : 'border-amber-200 bg-amber-50'}`}>
            <div className="flex gap-1 flex-wrap">
              {TIME_RANGES.map(r => (
                <button key={r.key} onClick={() => setTimeRange(r.key)}
                  className={`px-3 py-1 text-xs font-semibold rounded-sm transition-colors ${timeRange === r.key ? 'bg-orange-600 text-white' : darkMode ? 'text-zinc-400 hover:bg-zinc-800' : 'text-zinc-600 hover:bg-slate-200'}`}>
                  {r.label}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              {CHART_TYPES.map(t => (
                <button key={t.key} onClick={() => setChartType(t.key)}
                  className={`px-3 py-1 text-xs font-semibold rounded-sm transition-colors ${chartType === t.key ? 'bg-orange-600 text-white' : darkMode ? 'text-zinc-400 hover:bg-zinc-800' : 'text-zinc-600 hover:bg-slate-200'}`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className={`p-4 ${bgClass}`}>
            <PriceChart ticker={ticker} basePrice={character.basePrice} currentPrice={currentPrice} timeRange={timeRange} chartType={chartType} onHover={setHoveredChartPoint} />
          </div>
          <div className={`px-4 pb-3 pt-3 grid grid-cols-4 gap-3 text-center border-t ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
            {[['Open', formatCurrency(priceStats.first), textClass], ['High', formatCurrency(priceStats.high), upColor], ['Low', formatCurrency(priceStats.low), downColor], ['Current', formatCurrency(currentPrice), textClass]].map(([l, v, c]) => (
              <div key={l}><div className={`text-xs ${mutedClass} uppercase`}>{l}</div><div className={`font-semibold ${c}`}>{v}</div></div>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
          {stat('7d Change', cd(priceStats.change7d), cc(priceStats.change7d))}
          {stat('30d Change', cd(priceStats.change30d), cc(priceStats.change30d))}
          {stat('30d High', formatCurrency(priceStats.high30d), upColor)}
          {stat('30d Low', formatCurrency(priceStats.low30d), downColor)}
          {stat('52-Week High', formatCurrency(priceStats.high52w), upColor)}
          {stat('52-Week Low', formatCurrency(priceStats.low52w), downColor)}
          {stat('Ask (Buy)', formatCurrency(askPrice))}
          {stat('Bid (Sell)', formatCurrency(bidPrice))}
          {stat('Spread', `${(spread * 100).toFixed(1)}%`)}
          {stat('Base Price', formatCurrency(character.basePrice))}
          {dividendRate > 0
            ? stat('Dividend', `${(dividendRate * 100).toFixed(2)}% / week`, upColor)
            : stat('Dividend', 'None', mutedClass)}
        </div>

        {/* Your Position */}
        {(positionShares > 0 || shortPosition?.shares > 0) && (
          <div className={`${cardClass} border rounded-sm p-4 mb-4`}>
            <h3 className={`text-sm font-semibold ${textClass} mb-3`}>Your Position</h3>
            {positionShares > 0 && (
              <div className="space-y-2 text-sm">
                {[['Shares held', positionShares], ['Avg cost', formatCurrency(avgCost)]].map(([l, v]) => (
                  <div key={l} className="flex justify-between"><span className={mutedClass}>{l}</span><span className={textClass}>{v}</span></div>
                ))}
                <div className="flex justify-between"><span className={mutedClass}>Total P&L</span>
                  <span className={positionPL >= 0 ? upColor : downColor}>{positionPL >= 0 ? '+' : ''}{formatCurrency(positionPL)} ({positionPLPct >= 0 ? '+' : ''}{positionPLPct.toFixed(2)}%)</span>
                </div>
                {dividendRate > 0 && weeklyDividend > 0 && (
                  <div className="flex justify-between"><span className={mutedClass}>Weekly dividend</span><span className={upColor}>~{formatCurrency(weeklyDividend)}</span></div>
                )}
                {dividendRate > 0 && (
                  <div className="flex justify-between items-center">
                    <span className={mutedClass}>DRIP</span>
                    <button onClick={handleToggleDrip} title={drip[ticker] ? 'DRIP on: click to turn off' : 'DRIP off: click to reinvest'}
                      className={`text-xs px-2 py-1 rounded font-semibold transition-colors ${drip[ticker] ? 'bg-emerald-600 text-white' : darkMode ? 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600' : 'bg-zinc-200 text-zinc-500 hover:bg-zinc-300'}`}>
                      {drip[ticker] ? 'ON' : 'OFF'}
                    </button>
                  </div>
                )}
              </div>
            )}
            {shortPosition?.shares > 0 && (
              <div className={`${positionShares > 0 ? 'mt-3 pt-3 border-t ' + (darkMode ? 'border-zinc-800' : 'border-amber-200') : ''} space-y-2 text-sm`}>
                {[['Shares short', <span key="ss" className="text-orange-500">{shortPosition.shares}</span>],
                  ['Short entry', formatCurrency(shortPosition.costBasis || shortPosition.entryPrice || 0)]].map(([l, v]) => (
                  <div key={l} className="flex justify-between"><span className={mutedClass}>{l}</span><span className={textClass}>{v}</span></div>
                ))}
                {(() => { const pl = ((shortPosition.costBasis || shortPosition.entryPrice || 0) - currentPrice) * shortPosition.shares;
                  return <div className="flex justify-between"><span className={mutedClass}>Short P&L</span><span className={pl >= 0 ? upColor : downColor}>{pl >= 0 ? '+' : ''}{formatCurrency(pl)}</span></div>; })()}
              </div>
            )}
          </div>
        )}

        {/* Part of ETFs */}
        {memberOfETFs.length > 0 && (
          <div className={`${cardClass} border rounded-sm p-4 mb-4`}>
            <h3 className={`text-sm font-semibold ${textClass} mb-3`}>Part of {memberOfETFs.length} ETF{memberOfETFs.length > 1 ? 's' : ''}</h3>
            <div className="flex flex-wrap gap-2">
              {memberOfETFs.map(etf => (
                <button key={etf.ticker} onClick={() => navigate(`/stock/${etf.ticker}`)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-sm border text-left hover:border-orange-500 transition-colors ${darkMode ? 'border-zinc-800 hover:bg-zinc-800' : 'border-amber-200 hover:bg-amber-50'}`}>
                  <span className="text-orange-500 font-mono text-xs font-bold">${etf.ticker}</span>
                  <span className={`text-xs ${mutedClass}`}>{etf.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ETF Constituents */}
        {character.isETF && character.constituents?.length > 0 && (
          <div className={`${cardClass} border rounded-sm p-4`}>
            <h3 className={`text-sm font-semibold ${textClass} mb-3`}>Holdings ({character.constituents.length})</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {[...character.constituents].sort((a, b) => (prices[b] || 0) - (prices[a] || 0)).map(t => {
                const tHistory = priceHistory[t] || [];
                const tFiltered = tHistory.filter(p => p.timestamp >= Date.now() - 86400000);
                const tFirst = tFiltered[0]?.price || (prices[t] || 0);
                const tChange = tFirst > 0 ? ((prices[t] - tFirst) / tFirst) * 100 : 0;
                return (
                  <button key={t} onClick={() => navigate(`/stock/${t}`)}
                    className={`flex justify-between items-center p-2 rounded-sm border text-left hover:border-orange-500 transition-colors ${darkMode ? 'border-zinc-800 hover:bg-zinc-800' : 'border-amber-200 hover:bg-amber-50'}`}>
                    <span className="text-orange-500 font-mono text-xs font-semibold">${t}</span>
                    <div className="text-right">
                      <div className={`text-xs font-semibold ${textClass}`}>{formatCurrency(prices[t] || 0)}</div>
                      <div className={`text-[10px] ${tChange >= 0 ? upColor : downColor}`}>{tChange >= 0 ? '▲' : '▼'} {formatChange(Math.abs(tChange))}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {tradeAction && (
        <TradeActionModal character={character} action={tradeAction} price={currentPrice}
          holdings={positionShares} shortPosition={shortPosition} userCash={userData?.cash || 0}
          onTrade={onTrade} onClose={() => setTradeAction(null)} />
      )}
    </div>
  );
};

export default StockPage;
