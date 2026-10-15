// The player's portfolio: value and its chart, IPO shares, positions and open
// orders. A page of its own (/portfolio). Phones stack it in one column; wide
// screens put the value, chart and orders on the left and positions on the right.
import { useState, useMemo } from 'react';
import { CHARACTER_MAP } from '../../../characters';
import { themeClasses } from '../../../utils/theme';
import { formatCurrency, formatChange } from '../../../utils/formatters';
import { useSession, useMarket } from '../../../context/AppContext';

import PortfolioChart from './PortfolioChart';
import IpoHoldingsList from './IpoHoldingsList';
import PendingOrdersList from './PendingOrdersList';
import PositionsPanel from './PositionsPanel';
import { usePortfolioChartData } from '../hooks/usePortfolioChartData';
import { usePortfolioModalData } from '../hooks/usePortfolioModalData';
import { buildPortfolioItems, buildShortItems } from '../utils/buildPositionItems';
import { TIME_RANGES } from '../utils/shared';
import type { ComponentProps } from 'react';
import type { TradeAction, UserData } from '../../../types';
import type { ChartHoverPoint } from '../utils/shared';
import type { IpoHoldingItem } from './IpoHoldingsList';
import { headerChange } from '../../../shared/components/charts/valueSeries';

type PanelProps = ComponentProps<typeof PositionsPanel>;

interface PortfolioViewProps {
  currentValue: number;
  onTrade: (ticker: string, action: TradeAction, amount: number) => unknown;
  onOpenOrder?: PanelProps['onOpenOrder'];
  onLimitSell?: PanelProps['onLimitSell'];
  onOpenTradeHistory?: () => void;
  ipoPurchases?: Record<string, number>;
  holdingCohorts?: UserData['holdingCohorts'];
  dividendTierOverrides?: Record<string, string>;
  drip?: PanelProps['drip'];
  onToggleDrip?: PanelProps['onToggleDrip'];
}

const PortfolioView = ({
  currentValue,
  onTrade,
  onOpenOrder,
  onLimitSell,
  onOpenTradeHistory,
  ipoPurchases = {},
  holdingCohorts = {},
  dividendTierOverrides = {},
  drip = {},
  onToggleDrip,
}: PortfolioViewProps) => {
  const { user, userData, holdings, shorts, costBasis, showNotification } = useSession();
  const { prices, priceHistory, activeIPOs = [], rarityTiers } = useMarket();
  const colorBlindMode = userData?.colorBlindMode || false;
  const [showChart, setShowChart] = useState(true);
  const [timeRange, setTimeRange] = useState('1d');
  const [hoveredPoint, setHoveredPoint] = useState<ChartHoverPoint | null>(null);

  const { textClass, mutedClass, cardClass, cardEdgeClass, ghostBtnClass } = themeClasses;

  const { pendingOrders, loadingOrders, handleCancelOrder, portfolioHistory, loadingHistory } = usePortfolioModalData(
    user,
    timeRange,
    showNotification,
  );

  const portfolioItems = useMemo(
    () =>
      buildPortfolioItems({
        holdings,
        prices,
        priceHistory,
        costBasis,
        holdingCohorts,
        dividendTierOverrides,
        rarityTiers,
      }),
    [holdings, prices, priceHistory, costBasis, holdingCohorts, dividendTierOverrides, rarityTiers],
  );

  const shortCount = useMemo(() => buildShortItems({ shorts, prices }).length, [shorts, prices]);

  // IPO holdings — only show active IPOs where user has purchases
  const ipoItems = useMemo((): IpoHoldingItem[] => {
    if (!activeIPOs.length || !ipoPurchases) return [];
    const now = Date.now();
    return activeIPOs
      .filter(
        (ipo) =>
          now >= ipo.ipoStartsAt &&
          now < ipo.ipoEndsAt &&
          (ipo.sharesRemaining ?? 0) > 0 &&
          (ipoPurchases[ipo.ticker] ?? 0) > 0,
      )
      .map((ipo) => {
        const shares = ipoPurchases[ipo.ticker] ?? 0;
        const character = CHARACTER_MAP[ipo.ticker];
        const maxPerUser = ipo.maxPerUser || 10;
        return {
          ticker: ipo.ticker,
          character,
          shares,
          price: ipo.basePrice,
          total: ipo.basePrice * shares,
          maxPerUser,
        };
      });
  }, [activeIPOs, ipoPurchases]);

  const { chartData, hasChartData, minValue, maxValue, valueRange, firstValue, lastValue, isUp } =
    usePortfolioChartData(portfolioHistory, currentValue);
  const header = headerChange(firstValue, lastValue, hoveredPoint);

  const empty = portfolioItems.length === 0 && shortCount === 0 && ipoItems.length === 0;

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-6 lg:items-start space-y-4 lg:space-y-0">
      {/* Value and chart */}
      <section className={`${cardClass} border rounded-sm overflow-hidden lg:col-start-1 lg:row-start-1`}>
        <div className={`p-4 border-b ${cardEdgeClass}`}>
          <div className="flex justify-between items-center">
            <div>
              <h1 className={`text-lg font-semibold ${textClass}`}>Your Portfolio</h1>
              <div className="flex items-baseline gap-2 mt-1">
                <span className={`text-xl font-bold ${textClass}`}>
                  {formatCurrency(hoveredPoint?.value ?? currentValue)}
                </span>
                {hasChartData && (
                  <span
                    className={`text-sm font-semibold ${colorBlindMode ? (header.isUp ? 'text-teal-500' : 'text-purple-500') : header.isUp ? 'text-green-500' : 'text-red-500'}`}
                  >
                    {header.isUp ? '▲' : '▼'} {formatCurrency(Math.abs(header.change))} ({formatChange(header.pct)})
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {onOpenTradeHistory && (
                <button
                  onClick={onOpenTradeHistory}
                  className={`px-2 py-1 text-xs font-semibold rounded-sm border ${ghostBtnClass}`}
                >
                  Trade History
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Portfolio Chart — hidden for brand-new accounts (no positions and no
            history yet), where it would just be a flat placeholder line */}
        {!(empty && !loadingHistory && (portfolioHistory?.length || 0) < 2) && (
          <PortfolioChart
            chartData={chartData}
            minValue={minValue}
            maxValue={maxValue}
            valueRange={valueRange}
            isUp={isUp}
            hoveredPoint={hoveredPoint}
            setHoveredPoint={setHoveredPoint}
            showChart={showChart}
            setShowChart={setShowChart}
            loadingHistory={loadingHistory}
            timeRange={timeRange}
            setTimeRange={setTimeRange}
            timeRanges={TIME_RANGES}
            colorBlindMode={colorBlindMode}
          />
        )}
      </section>

      {/* Positions: second on phones, the whole right column on wide screens */}
      <section className={`${cardClass} border rounded-sm p-4 lg:col-start-2 lg:row-start-1 lg:row-span-2`}>
        {empty ? (
          <div className={`text-center py-8 ${mutedClass}`}>
            <p className="text-lg mb-2">📭 No positions yet</p>
            <p className="text-sm">Start trading to build your portfolio!</p>
          </div>
        ) : (
          <>
            <IpoHoldingsList items={ipoItems} />
            <PositionsPanel
              portfolioItems={portfolioItems}
              onTrade={onTrade}
              onOpenOrder={onOpenOrder}
              onLimitSell={onLimitSell}
              drip={drip}
              onToggleDrip={onToggleDrip}
            />
          </>
        )}
      </section>

      {/* Open orders */}
      {!empty && (
        <section className="lg:col-start-1 lg:row-start-2">
          <PendingOrdersList
            orders={pendingOrders}
            prices={prices}
            onCancel={handleCancelOrder}
            loadingOrders={loadingOrders}
          />
        </section>
      )}
    </div>
  );
};

export default PortfolioView;
