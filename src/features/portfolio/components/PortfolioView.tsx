// The player's portfolio, laid out like a brokerage account: value and chart,
// account numbers and allocation, a positions table (each row opens its
// details and your trade history in it), open orders and recent activity.
// Phones get the same pieces in one column, with Positions / Activity / Orders
// tabs instead of everything stacked.
import { useState, useMemo } from 'react';
import { CHARACTER_MAP } from '../../../characters';
import { themeClasses } from '../../../utils/theme';
import { formatCurrency, formatChange } from '../../../utils/formatters';
import { useSession, useMarket } from '../../../context/AppContext';

import PortfolioChart from './PortfolioChart';
import IpoHoldingsList from './IpoHoldingsList';
import PendingOrdersList from './PendingOrdersList';
import PositionsPanel from './PositionsPanel';
import GroupSellSheet from './GroupSellSheet';
import PortfolioStats from './PortfolioStats';
import AllocationBar from './AllocationBar';
import ActivityPanel from './ActivityPanel';
import { usePhone } from '../../../shared/hooks/useMediaQuery';
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
  onOpenOrder = () => {},
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
  // Lives here, not in the positions panel: selling the last stock swaps the
  // panel for the empty state, and the sale's summary must stay on screen.
  const [groupSellOpen, setGroupSellOpen] = useState(false);
  const [timeRange, setTimeRange] = useState('1d');
  const [hoveredPoint, setHoveredPoint] = useState<ChartHoverPoint | null>(null);
  const phone = usePhone();
  const [tab, setTab] = useState<'positions' | 'activity' | 'orders'>('positions');

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

  const shortItems = useMemo(() => buildShortItems({ shorts, prices }), [shorts, prices]);
  const shortCount = shortItems.length;
  const shortCollateral = shortItems.reduce((sum, i) => sum + i.margin, 0);

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

  const positions = (
    <section className={`${cardClass} border rounded-sm p-4 min-w-0`}>
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
            onGroupSell={() => setGroupSellOpen(true)}
          />
        </>
      )}
      {groupSellOpen && <GroupSellSheet items={portfolioItems} onClose={() => setGroupSellOpen(false)} />}
    </section>
  );
  const orders = (
    <section className={`${cardClass} border rounded-sm p-4 min-w-0`}>
      {pendingOrders.length === 0 ? (
        <p className={`text-sm ${mutedClass}`}>No open orders. Limit orders and stop losses you place show up here.</p>
      ) : (
        <PendingOrdersList
          orders={pendingOrders}
          prices={prices}
          onCancel={handleCancelOrder}
          loadingOrders={loadingOrders}
        />
      )}
    </section>
  );
  const activity = (
    <section className={`${cardClass} border rounded-sm p-4 min-w-0 lg:col-span-2`}>
      <ActivityPanel onOpenTradeHistory={onOpenTradeHistory} />
    </section>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start">
        <section className={`${cardClass} border rounded-sm overflow-hidden lg:col-span-2`}>
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
        <section className={`${cardClass} border rounded-sm p-4 space-y-4`}>
          <PortfolioStats items={portfolioItems} shortCollateral={shortCollateral} currentValue={currentValue} />
          <AllocationBar items={portfolioItems} cash={userData?.cash || 0} shortCollateral={shortCollateral} />
        </section>
      </div>

      {phone ? (
        <>
          <div className="flex gap-1 sticky top-16 z-20 py-2 -mx-4 px-4 light:bg-amber-50 dark:bg-zinc-950">
            {(
              [
                ['positions', 'Positions'],
                ['activity', 'Activity'],
                ['orders', `Orders${pendingOrders.length ? ` (${pendingOrders.length})` : ''}`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex-1 py-2 text-sm font-semibold rounded-sm ${
                  tab === id ? 'bg-orange-600 text-white' : `border ${ghostBtnClass}`
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'positions' ? positions : tab === 'activity' ? activity : orders}
        </>
      ) : (
        <>
          {positions}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start">
            {orders}
            {activity}
          </div>
        </>
      )}
    </div>
  );
};

export default PortfolioView;
