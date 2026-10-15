import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTheme, useSession, useMarket } from '../../../context/AppContext';
import { formatCurrency, formatChange } from '../../../utils/formatters';
import { themeClasses, getReadableCrewColor } from '../../../utils/theme';
import PriceChart, { TIME_RANGES } from '../components/PriceChart';
import TradeLauncher from '../../trading/components/TradeLauncher';
import StickyTradeBar from '../components/StickyTradeBar';
import StockTradeMenu from '../components/StockTradeMenu';
import { useStockTradeShortcuts } from '../hooks/useStockTradeShortcuts';
import { getMarketClosedState } from '../../../utils/marketHours';
import { statusBadge, STATUS_MAP, statusOf } from '../../../constants/statuses';
import { useStockPageData } from '../hooks/useStockPageData';
import { useTickerAliasRedirect } from '../hooks/useTickerAliasRedirect';
import StockPositionCard from '../components/StockPositionCard';
import EtfLinks from '../components/EtfLinks';
import type { ReactNode } from 'react';
import type { PricePoint, TradeAction } from '../../../types';
import PixelIcon from '../../../shared/components/PixelIcon';
import CrewPin from '../../../shared/components/CrewPin';

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
  const { darkMode } = useTheme();
  const { user, userData } = useSession();
  const { marketData } = useMarket();
  const colorBlindMode = userData?.colorBlindMode || false;
  const marketClosed = getMarketClosedState(marketData).closed;
  const [timeRange, setTimeRange] = useState('1d');
  const [chartType, setChartType] = useState<ChartType>('area');
  const [tradeAction, setTradeAction] = useState<TradeAction | null>(null);
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

  const { cardClass, textClass, mutedClass, bgClass } = themeClasses;

  const aliasTarget = useTickerAliasRedirect(ticker, !!character, marketData);
  const tradeOpen =
    !!user && !!character && !marketClosed && Date.now() >= (marketData?.haltedTickers?.[ticker]?.resumeAt ?? 0);
  useStockTradeShortcuts(setTradeAction, { enabled: tradeOpen && !tradeAction, canSell: positionShares > 0 });

  const isUp = priceStats.change >= 0;
  const upColor = colorBlindMode ? 'text-teal-500' : 'text-green-500';
  const downColor = colorBlindMode ? 'text-purple-500' : 'text-red-500';
  const cc = (pct: number) => (pct >= 0 ? upColor : downColor);
  const cd = (pct: number) => `${pct >= 0 ? '▲' : '▼'} ${formatChange(pct)}`;

  const stat = (label: string, value: ReactNode, cls = textClass) => (
    <div className="p-3 rounded-sm border light:border-amber-200 light:bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className={`text-xs ${mutedClass} uppercase mb-1`}>{label}</div>
      <div className={`font-semibold text-sm ${cls}`}>{value}</div>
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
                    <PixelIcon name={statusBadge(character)} className="w-4 h-4" />
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
                    <CrewPin crew={crew} className="w-3 h-3" />
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
                      {hChange >= 0 ? '▲' : '▼'} {formatChange(hChange)}
                      <span className={`text-xs ml-1 font-normal ${mutedClass}`}>
                        ({TIME_RANGES.find((r) => r.key === timeRange)?.label})
                      </span>
                    </div>
                  );
                })()
              ) : (
                <div className={`text-sm font-semibold ${isUp ? upColor : downColor}`}>
                  {isUp ? '▲' : '▼'} {formatChange(priceStats.change)}
                  <span className={`text-xs ml-1 font-normal ${mutedClass}`}>
                    ({TIME_RANGES.find((r) => r.key === timeRange)?.label})
                  </span>
                </div>
              )}
            </div>
          </div>
          {/* Phones trade from the bar pinned to the bottom instead. */}
          {user && (
            <StockTradeMenu
              marketClosed={marketClosed}
              canSell={positionShares > 0}
              canCover={!!shortPosition?.shares}
              colorBlindMode={colorBlindMode}
              onAction={setTradeAction}
            />
          )}
        </div>

        {/* Chart */}
        <div className={`${cardClass} border rounded-sm mb-4 overflow-hidden`}>
          <div className="px-4 py-2 border-b flex flex-wrap gap-2 justify-between items-center light:border-amber-200 light:bg-amber-50 dark:border-zinc-800 dark:bg-zinc-900/50">
            <div className="flex gap-1 flex-wrap">
              {TIME_RANGES.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setTimeRange(r.key)}
                  className={`px-3 py-1 text-xs font-semibold rounded-sm transition-colors ${timeRange === r.key ? 'bg-orange-600 text-white' : 'light:text-zinc-600 light:hover:bg-slate-200 dark:text-zinc-400 dark:hover:bg-zinc-800'}`}
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
                  className={`px-3 py-1 text-xs font-semibold rounded-sm transition-colors ${chartType === t.key ? 'bg-orange-600 text-white' : 'light:text-zinc-600 light:hover:bg-slate-200 dark:text-zinc-400 dark:hover:bg-zinc-800'}`}
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
          <div className="px-4 pb-3 pt-3 grid grid-cols-4 gap-3 text-center border-t light:border-amber-200 dark:border-zinc-800">
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

      {user && (
        <StickyTradeBar
          price={currentPrice}
          canSell={positionShares > 0}
          canCover={!!shortPosition?.shares}
          disabledReason={
            marketClosed
              ? 'Market closed'
              : Date.now() < (marketData?.haltedTickers?.[ticker]?.resumeAt ?? 0)
                ? 'Trading paused for a few minutes'
                : null
          }
          onAction={setTradeAction}
        />
      )}

      {tradeAction && (
        <TradeLauncher
          character={character}
          action={tradeAction}
          onTrade={onTrade}
          onClose={() => setTradeAction(null)}
        />
      )}
    </div>
  );
};

export default StockPage;
