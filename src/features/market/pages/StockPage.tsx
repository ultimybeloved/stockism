import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAppContext } from '../../../context/AppContext';
import { formatCurrency, formatChange } from '../../../utils/formatters';
import { getThemeClasses, getReadableCrewColor } from '../../../utils/theme';
import PriceChart, { TIME_RANGES } from '../components/PriceChart';
import TradeActionModal from '../../trading/components/TradeActionModal';
import { getMarketClosedState } from '../../../utils/marketHours';
import { statusBadge, STATUS_MAP, statusOf } from '../../../constants/statuses';
import { useStockPageData } from '../hooks/useStockPageData';
import StockPositionCard from '../components/StockPositionCard';
import EtfLinks from '../components/EtfLinks';
import type { ReactNode } from 'react';
import type { PricePoint, TradeAction } from '../../../types';

type ChartType = 'area' | 'bar';

const CHART_TYPES: { key: ChartType; label: string }[] = [
  { key: 'area', label: 'Area' },
  { key: 'bar', label: 'Bar' },
];

interface StockPageProps {
  onTrade: (ticker: string, action: TradeAction, amount: number) => unknown;
}

const StockPage = ({ onTrade }: StockPageProps) => {
  // The route is /stock/:ticker, so the param is always there.
  const ticker = useParams().ticker ?? '';
  const navigate = useNavigate();
  const { darkMode, user, userData, marketData } = useAppContext();
  const colorBlindMode = userData?.colorBlindMode || false;
  const marketClosed = getMarketClosedState(marketData).closed;
  const [timeRange, setTimeRange] = useState('1d');
  const [chartType, setChartType] = useState<ChartType>('area');
  const [tradeAction, setTradeAction] = useState<TradeAction | null>(null);
  const [showTradeMenu, setShowTradeMenu] = useState(false);
  const [hoveredChartPoint, setHoveredChartPoint] = useState<PricePoint | null>(null);

  const {
    character,
    currentPrice,
    positionShares,
    shortPosition,
    avgCost,
    spread,
    bidPrice,
    askPrice,
    drip,
    handleToggleDrip,
    priceStats,
    dividendRate,
    weeklyDividend,
    positionPL,
    positionPLPct,
    crews,
    memberOfETFs,
  } = useStockPageData(ticker, timeRange);

  const { cardClass, textClass, mutedClass, bgClass } = getThemeClasses(darkMode);

  // A renamed ticker keeps turning up long after the rename: in old bell
  // notifications, in links posted to Discord, in someone's browser history.
  // market/current.tickerAliases maps every retired name to its current one, so
  // those land on the right stock instead of an "unknown ticker" dead end.
  const aliasTarget = marketData?.tickerAliases?.[ticker];
  useEffect(() => {
    if (!character && aliasTarget) navigate(`/stock/${aliasTarget}`, { replace: true });
  }, [character, aliasTarget, navigate]);

  const isUp = priceStats.change >= 0;
  const upColor = colorBlindMode ? 'text-teal-500' : 'text-green-500';
  const downColor = colorBlindMode ? 'text-purple-500' : 'text-red-500';
  const cc = (pct: number) => (pct >= 0 ? upColor : downColor);
  const cd = (pct: number) => `${pct >= 0 ? '▲' : '▼'} ${formatChange(Math.abs(pct))}`;

  const stat = (label: string, value: ReactNode, cls = textClass) => (
    <div className={`p-3 rounded-sm border ${darkMode ? 'border-zinc-800 bg-zinc-900' : 'border-amber-200 bg-white'}`}>
      <div className={`text-xs ${mutedClass} uppercase mb-1`}>{label}</div>
      <div className={`font-semibold text-sm ${cls}`}>{value}</div>
    </div>
  );

  const tradeButtons = (
    <div className="space-y-2 mt-3">
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            ['buy', colorBlindMode ? 'bg-teal-600 hover:bg-teal-700' : 'bg-green-600 hover:bg-green-700'],
            ['sell', colorBlindMode ? 'bg-purple-600 hover:bg-purple-700' : 'bg-red-600 hover:bg-red-700'],
            ['short', 'border-2 border-orange-500 text-orange-500 hover:bg-orange-500/10'],
            ['cover', 'border-2 border-blue-500 text-blue-500 hover:bg-blue-500/10'],
          ] as [TradeAction, string][]
        ).map(([action, cls]) => (
          <button
            key={action}
            disabled={(action === 'sell' && positionShares === 0) || (action === 'cover' && !shortPosition?.shares)}
            onClick={() => {
              setTradeAction(action);
              setShowTradeMenu(false);
            }}
            className={`py-1.5 text-xs font-semibold uppercase rounded-sm ${cls} text-white disabled:opacity-40`}
          >
            {action}
          </button>
        ))}
      </div>
      <button
        onClick={() => setShowTradeMenu(false)}
        className={`w-full py-1 text-xs ${mutedClass} hover:text-orange-500`}
      >
        Cancel
      </button>
    </div>
  );

  if (!character) {
    return (
      <div className={`min-h-screen ${bgClass} flex items-center justify-center`}>
        <div className="text-center">
          <p className={`text-lg ${textClass} mb-2`}>
            {aliasTarget ? `Redirecting to $${aliasTarget}...` : `Unknown ticker: $${ticker}`}
          </p>
          <button onClick={() => navigate('/')} className="text-orange-500 hover:underline text-sm">
            ← Back to market
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${bgClass}`}>
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => navigate(-1)} className={`${mutedClass} hover:text-orange-500 text-sm`}>
            ← Back
          </button>
        </div>

        {/* Header */}
        <div className={`${cardClass} border rounded-sm p-4 mb-4`}>
          <div className="flex justify-between items-start">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-orange-500 font-mono text-xl font-bold">${ticker}</span>
                {character.isETF && <span className="text-xs bg-purple-600 text-white px-1.5 py-0.5 rounded">ETF</span>}
                {!character.isETF && statusBadge(character) && (
                  <span className="text-sm" title={STATUS_MAP[statusOf(character)]?.hint}>
                    {statusBadge(character)}
                  </span>
                )}
                {crews.map((crew) => (
                  <span
                    key={crew.id}
                    className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-semibold"
                    style={{
                      backgroundColor: crew.color + '22',
                      border: `1px solid ${crew.color}55`,
                      color: getReadableCrewColor(crew.color, darkMode),
                    }}
                  >
                    <img src={crew.icon} alt="" className="w-3 h-3 object-contain" />
                    {crew.name}
                  </span>
                ))}
              </div>
              <p className={`text-sm ${mutedClass} mt-0.5`}>{character.name}</p>
              {character.description && <p className={`text-xs ${mutedClass} mt-0.5`}>{character.description}</p>}
            </div>
            <div className="text-right">
              <div className={`text-2xl font-bold ${textClass}`}>
                {formatCurrency(hoveredChartPoint ? hoveredChartPoint.price : currentPrice)}
              </div>
              {hoveredChartPoint ? (
                (() => {
                  const hChange =
                    priceStats.first > 0 ? ((hoveredChartPoint.price - priceStats.first) / priceStats.first) * 100 : 0;
                  return (
                    <div className={`text-sm font-semibold ${hChange >= 0 ? upColor : downColor}`}>
                      {hChange >= 0 ? '▲' : '▼'} {formatChange(Math.abs(hChange))}
                      <span className={`text-xs ml-1 font-normal ${mutedClass}`}>
                        ({TIME_RANGES.find((r) => r.key === timeRange)?.label})
                      </span>
                    </div>
                  );
                })()
              ) : (
                <div className={`text-sm font-semibold ${isUp ? upColor : downColor}`}>
                  {isUp ? '▲' : '▼'} {formatChange(Math.abs(priceStats.change))}
                  <span className={`text-xs ml-1 font-normal ${mutedClass}`}>
                    ({TIME_RANGES.find((r) => r.key === timeRange)?.label})
                  </span>
                </div>
              )}
            </div>
          </div>
          {user &&
            (marketClosed ? (
              <button
                disabled
                className="mt-3 px-4 py-1.5 border border-red-500/30 text-red-400 opacity-60 text-sm font-semibold uppercase rounded-sm cursor-not-allowed"
              >
                Market Closed
              </button>
            ) : !showTradeMenu ? (
              <button
                onClick={() => setShowTradeMenu(true)}
                className="mt-3 px-4 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold rounded-sm"
              >
                Trade
              </button>
            ) : (
              tradeButtons
            ))}
        </div>

        {/* Chart */}
        <div className={`${cardClass} border rounded-sm mb-4 overflow-hidden`}>
          <div
            className={`px-4 py-2 border-b flex flex-wrap gap-2 justify-between items-center ${darkMode ? 'border-zinc-800 bg-zinc-900/50' : 'border-amber-200 bg-amber-50'}`}
          >
            <div className="flex gap-1 flex-wrap">
              {TIME_RANGES.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setTimeRange(r.key)}
                  className={`px-3 py-1 text-xs font-semibold rounded-sm transition-colors ${timeRange === r.key ? 'bg-orange-600 text-white' : darkMode ? 'text-zinc-400 hover:bg-zinc-800' : 'text-zinc-600 hover:bg-slate-200'}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              {CHART_TYPES.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setChartType(t.key)}
                  className={`px-3 py-1 text-xs font-semibold rounded-sm transition-colors ${chartType === t.key ? 'bg-orange-600 text-white' : darkMode ? 'text-zinc-400 hover:bg-zinc-800' : 'text-zinc-600 hover:bg-slate-200'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className={`p-4 ${bgClass}`}>
            <PriceChart
              ticker={ticker}
              basePrice={character.basePrice}
              currentPrice={currentPrice}
              timeRange={timeRange}
              chartType={chartType}
              onHover={setHoveredChartPoint}
            />
          </div>
          <div
            className={`px-4 pb-3 pt-3 grid grid-cols-4 gap-3 text-center border-t ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}
          >
            {[
              ['Open', formatCurrency(priceStats.first), textClass],
              ['High', formatCurrency(priceStats.high), upColor],
              ['Low', formatCurrency(priceStats.low), downColor],
              ['Current', formatCurrency(currentPrice), textClass],
            ].map(([l, v, c]) => (
              <div key={l}>
                <div className={`text-xs ${mutedClass} uppercase`}>{l}</div>
                <div className={`font-semibold ${c}`}>{v}</div>
              </div>
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

        <StockPositionCard
          ticker={ticker}
          positionShares={positionShares}
          shortPosition={shortPosition}
          avgCost={avgCost}
          positionPL={positionPL}
          positionPLPct={positionPLPct}
          dividendRate={dividendRate}
          weeklyDividend={weeklyDividend}
          drip={drip}
          handleToggleDrip={handleToggleDrip}
          currentPrice={currentPrice}
        />

        <EtfLinks character={character} memberOfETFs={memberOfETFs} />
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
