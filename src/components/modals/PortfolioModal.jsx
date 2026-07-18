import { useState, useMemo } from 'react';
import { CHARACTER_MAP } from '../../characters';
import { getThemeClasses } from '../../utils/theme';
import { formatCurrency, formatChange } from '../../utils/formatters';
import { useAppContext } from '../../context/AppContext';
import PortfolioChart from '../portfolio/PortfolioChart';
import HoldingRow from '../portfolio/HoldingRow';
import ShortRow from '../portfolio/ShortRow';
import IpoHoldingsList from '../portfolio/IpoHoldingsList';
import PendingOrdersList from '../portfolio/PendingOrdersList';
import HoldingsControls from '../portfolio/HoldingsControls';
import DustCleanupBanner from '../portfolio/DustCleanupBanner';
import { useDustCleanup } from '../../hooks/useDustCleanup';
import { usePortfolioChartData } from '../portfolio/usePortfolioChartData';
import { usePortfolioModalData } from '../portfolio/usePortfolioModalData';
import { buildPortfolioItems, buildShortItems } from '../portfolio/buildPositionItems';
import { TIME_RANGES, filterHoldings, sortHoldings } from '../portfolio/shared';
import { isWeeklyHalt } from '../../utils/marketHours';
import { useEscapeKey } from '../../hooks/useEscapeKey';

const PortfolioModal = ({ currentValue, onClose, onTrade, onLimitSell, onOpenTradeHistory, ipoPurchases = {}, holdingCohorts = {}, dividendTierOverrides = {}, drip = {}, onToggleDrip }) => {
  useEscapeKey(onClose);
  const { darkMode, user, userData, prices, priceHistory, holdings, shorts, costBasis, marketData, activeIPOs = [], showNotification } = useAppContext();
  const colorBlindMode = userData?.colorBlindMode || false;
  const [sellAmounts, setSellAmounts] = useState({});
  const [coverAmounts, setCoverAmounts] = useState({});
  const [showChart, setShowChart] = useState(true);
  const [timeRange, setTimeRange] = useState('1d');
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [expandedTicker, setExpandedTicker] = useState(null);
  const [expandedShortTicker, setExpandedShortTicker] = useState(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('value');
  const [sortDir, setSortDir] = useState('desc');
  // Long/short tab — open on whichever side the user actually has positions in.
  const [positionTab, setPositionTab] = useState(
    () => (Object.values(holdings || {}).some((s) => s > 0) ? 'long' : 'short')
  );

  const switchPositionTab = (tab) => {
    setPositionTab(tab);
    setSearch(''); // a search for a long stock won't match shorts, so clear it
  };

  // Clicking the active sort flips direction; switching sort resets to a
  // sensible default (Z→A feels wrong for names, so Name defaults to A→Z).
  const handleSortChange = (key) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };

  const { textClass, mutedClass, overlayClass, modalShellClass, cardEdgeClass, ghostBtnClass } = getThemeClasses(darkMode);

  const { pendingOrders, loadingOrders, handleCancelOrder, portfolioHistory, loadingHistory } =
    usePortfolioModalData(user, timeRange, showNotification);

  // Helper to get price from 24h ago
  const portfolioItems = useMemo(
    () => buildPortfolioItems({ holdings, prices, priceHistory, costBasis, holdingCohorts, dividendTierOverrides }),
    [holdings, prices, priceHistory, costBasis, holdingCohorts, dividendTierOverrides]
  );

  const totalWeeklyDividends = useMemo(
    () => portfolioItems.reduce((sum, item) => sum + (item.weeklyDividend || 0), 0),
    [portfolioItems]
  );

  // Search + sort applied to the long-positions list for display only.
  const visibleItems = useMemo(
    () => sortHoldings(filterHoldings(portfolioItems, search), sortKey, sortDir),
    [portfolioItems, search, sortKey, sortDir]
  );
  const { dustItems, dustTotal, sweeping, handleSweep } = useDustCleanup(portfolioItems, showNotification);

  const shortItems = useMemo(() => buildShortItems({ shorts, prices }), [shorts, prices]);

  // Same search + sort treatment for shorts as the long-positions list.
  const visibleShorts = useMemo(
    () => sortHoldings(filterHoldings(shortItems, search), sortKey, sortDir),
    [shortItems, search, sortKey, sortDir]
  );

  // IPO holdings — only show active IPOs where user has purchases
  const ipoItems = useMemo(() => {
    if (!activeIPOs.length || !ipoPurchases) return [];
    const now = Date.now();
    return activeIPOs
      .filter(ipo => now >= ipo.ipoStartsAt && now < ipo.ipoEndsAt && ipo.sharesRemaining > 0 && ipoPurchases[ipo.ticker] > 0)
      .map(ipo => {
        const shares = ipoPurchases[ipo.ticker];
        const character = CHARACTER_MAP[ipo.ticker];
        const maxPerUser = ipo.maxPerUser || 10;
        return { ticker: ipo.ticker, character, shares, price: ipo.basePrice, total: ipo.basePrice * shares, maxPerUser };
      });
  }, [activeIPOs, ipoPurchases]);

  const totalValue = portfolioItems.reduce((sum, item) => sum + item.value, 0);

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

  const { chartData, hasChartData, minValue, maxValue, valueRange, firstValue, lastValue, periodChange, isUp } =
    usePortfolioChartData(portfolioHistory, currentValue);

  return (
    <div className={`${overlayClass} z-50`} onClick={onClose}>
      <div className={`${modalShellClass} max-w-2xl overflow-hidden max-h-[90vh] flex flex-col`}
        onClick={e => e.stopPropagation()}>

        <div className={`p-4 border-b ${cardEdgeClass}`}>
          <div className="flex justify-between items-center">
            <div>
              <h2 className={`text-lg font-semibold ${textClass}`}>Your Portfolio</h2>
              <div className="flex items-baseline gap-2 mt-1">
                <span className={`text-xl font-bold ${textClass}`}>{formatCurrency(hoveredPoint?.value ?? currentValue)}</span>
                {hasChartData && (
                  <span className={`text-sm font-semibold ${colorBlindMode ? (isUp ? 'text-teal-500' : 'text-purple-500') : (isUp ? 'text-green-500' : 'text-red-500')}`}>
                    {isUp ? '▲' : '▼'} {formatCurrency(Math.abs(lastValue - firstValue))} ({formatChange(periodChange)})
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {onOpenTradeHistory && (
                <button onClick={onOpenTradeHistory}
                  className={`px-2 py-1 text-xs font-semibold rounded-sm border ${ghostBtnClass}`}>
                  Trade History
                </button>
              )}
              <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-500 text-xl`}>&times;</button>
            </div>
          </div>
        </div>

        {/* Portfolio Chart — hidden for brand-new accounts (no positions and no
            history yet), where it would just be a flat placeholder line */}
        {!(portfolioItems.length === 0 && shortItems.length === 0 && ipoItems.length === 0 && !loadingHistory && (portfolioHistory?.length || 0) < 2) && (
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
          darkMode={darkMode}
          colorBlindMode={colorBlindMode}
        />
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {portfolioItems.length === 0 && shortItems.length === 0 && ipoItems.length === 0 ? (
            <div className={`text-center py-8 ${mutedClass}`}>
              <p className="text-lg mb-2">📭 No positions yet</p>
              <p className="text-sm">Start trading to build your portfolio!</p>
            </div>
          ) : (
            <>
              {/* IPO Holdings */}
              <IpoHoldingsList items={ipoItems} darkMode={darkMode} />

              {/* Long / Short positions — tabbed */}
              {(portfolioItems.length > 0 || shortItems.length > 0) && (
                <>
                  <div className="flex gap-1 mb-3">
                    {[
                      { key: 'long', label: '📈 Long', count: portfolioItems.length },
                      { key: 'short', label: '📉 Short', count: shortItems.length },
                    ].map(t => (
                      <button
                        key={t.key}
                        onClick={() => switchPositionTab(t.key)}
                        className={`flex-1 py-1.5 text-sm font-semibold rounded-sm transition-colors ${
                          positionTab === t.key
                            ? 'bg-orange-600 text-white'
                            : darkMode ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700' : 'bg-amber-50 text-slate-500 hover:bg-amber-100'
                        }`}
                      >
                        {t.label} <span className="text-xs font-normal">({t.count})</span>
                      </button>
                    ))}
                  </div>

                  <HoldingsControls
                    darkMode={darkMode}
                    search={search}
                    setSearch={setSearch}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSortChange={handleSortChange}
                  />

                  {positionTab === 'long' ? (
                    <>
                    {dustItems.length > 0 && !isWeeklyHalt() && !marketData?.marketHalted && (
                      <DustCleanupBanner count={dustItems.length} total={dustTotal} sweeping={sweeping} onConfirm={handleSweep} darkMode={darkMode} />
                    )}
                    {portfolioItems.length === 0 ? (
                      <p className={`text-sm text-center py-4 ${mutedClass}`}>No long positions.</p>
                    ) : visibleItems.length === 0 ? (
                      <p className={`text-sm text-center py-4 ${mutedClass}`}>No holdings match your search.</p>
                    ) : (
                      <>
                        {totalWeeklyDividends > 0 && (
                          <p className={`text-xs ${mutedClass} mb-2 text-right`}>
                            ~{formatCurrency(totalWeeklyDividends)} / week in dividends
                          </p>
                        )}
                        <div className="space-y-2">
                          {visibleItems.map(item => (
                            <HoldingRow
                              key={item.ticker}
                              item={item}
                              isExpanded={expandedTicker === item.ticker}
                              onToggle={toggleExpand}
                              totalValue={totalValue}
                              sellAmounts={sellAmounts}
                              setSellAmounts={setSellAmounts}
                              onSell={handleSell}
                              onLimitSell={onLimitSell}
                              drip={drip}
                              onToggleDrip={onToggleDrip}
                              darkMode={darkMode}
                              colorBlindMode={colorBlindMode}
                            />
                          ))}
                        </div>
                      </>
                    )}
                    </>
                  ) : (
                    shortItems.length === 0 ? (
                      <p className={`text-sm text-center py-4 ${mutedClass}`}>No short positions.</p>
                    ) : visibleShorts.length === 0 ? (
                      <p className={`text-sm text-center py-4 ${mutedClass}`}>No shorts match your search.</p>
                    ) : (
                      <div className="space-y-2">
                        {visibleShorts.map(item => (
                          <ShortRow
                            key={`short-${item.ticker}`}
                            item={item}
                            isExpanded={expandedShortTicker === item.ticker}
                            onToggle={toggleShortExpand}
                            coverAmounts={coverAmounts}
                            setCoverAmounts={setCoverAmounts}
                            onCover={handleCover}
                            darkMode={darkMode}
                            colorBlindMode={colorBlindMode}
                          />
                        ))}
                      </div>
                    )
                  )}
                </>
              )}

              {/* Pending Limit Orders Section */}
              <PendingOrdersList
                orders={pendingOrders}
                prices={prices}
                onCancel={handleCancelOrder}
                loadingOrders={loadingOrders}
                darkMode={darkMode}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default PortfolioModal;
