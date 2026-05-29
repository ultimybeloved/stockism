import { useState, useMemo } from 'react';
import { CHARACTER_MAP, getDividendTier } from '../../characters';
import { getThemeClasses } from '../../utils/theme';
import { DIVIDEND_RATES } from '../../constants/economy';
import { formatCurrency, formatChange } from '../../utils/formatters';
import { useAppContext } from '../../context/AppContext';
import PortfolioChart from '../portfolio/PortfolioChart';
import HoldingRow from '../portfolio/HoldingRow';
import ShortRow from '../portfolio/ShortRow';
import IpoHoldingsList from '../portfolio/IpoHoldingsList';
import PendingOrdersList from '../portfolio/PendingOrdersList';
import { usePortfolioChartData } from '../portfolio/usePortfolioChartData';
import { usePortfolioModalData } from '../portfolio/usePortfolioModalData';
import { TIME_RANGES } from '../portfolio/shared';

const PortfolioModal = ({ currentValue, onClose, onTrade, onLimitSell, onOpenTradeHistory, ipoPurchases = {}, holdingCohorts = {}, dividendTierOverrides = {}, drip = {}, onToggleDrip }) => {
  const { darkMode, user, userData, prices, priceHistory, holdings, shorts, costBasis, activeIPOs = [], showNotification } = useAppContext();
  const colorBlindMode = userData?.colorBlindMode || false;
  const [sellAmounts, setSellAmounts] = useState({});
  const [coverAmounts, setCoverAmounts] = useState({});
  const [showChart, setShowChart] = useState(true);
  const [timeRange, setTimeRange] = useState('1d');
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [expandedTicker, setExpandedTicker] = useState(null);
  const [expandedShortTicker, setExpandedShortTicker] = useState(null);

  const { cardClass, textClass, mutedClass } = getThemeClasses(darkMode);

  const { pendingOrders, loadingOrders, handleCancelOrder, portfolioHistory, loadingHistory } =
    usePortfolioModalData(user, timeRange, showNotification);

  // Helper to get price from 24h ago
  const getPrice24hAgo = (ticker) => {
    const history = priceHistory?.[ticker] || [];
    if (history.length === 0) return prices[ticker] || CHARACTER_MAP[ticker]?.basePrice || 0;

    const dayAgo = Date.now() - (24 * 60 * 60 * 1000);
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].timestamp <= dayAgo) {
        return history[i].price;
      }
    }
    return history[0]?.price || prices[ticker] || 0;
  };

  const portfolioItems = useMemo(() => {
    const now = Date.now();
    return Object.entries(holdings)
      .filter(([_, shares]) => shares > 0)
      .map(([ticker, shares]) => {
        const character = CHARACTER_MAP[ticker];
        const currentPrice = prices[ticker] || character?.basePrice || 0;
        const value = currentPrice * shares;
        const avgCost = costBasis?.[ticker] || character?.basePrice || currentPrice;
        const totalCost = avgCost * shares;

        // Total return (from avg cost)
        const totalReturnDollar = value - totalCost;
        const totalReturnPercent = totalCost > 0 ? ((value - totalCost) / totalCost) * 100 : 0;

        // Today's return (from 24h ago price)
        const price24hAgo = getPrice24hAgo(ticker);
        const value24hAgo = price24hAgo * shares;
        const todayReturnDollar = value - value24hAgo;
        const todayReturnPercent = value24hAgo > 0 ? ((value - value24hAgo) / value24hAgo) * 100 : 0;

        // Dividend eligibility — graduates any pending entries past their availableAt.
        const tier = getDividendTier(ticker, dividendTierOverrides);
        const tierRate = DIVIDEND_RATES[tier] || 0;
        const cohort = holdingCohorts?.[ticker];
        let eligibleShares = 0;
        let soonestReadyMs = null;
        if (cohort) {
          eligibleShares = cohort.eligible || 0;
          for (const p of (cohort.pending || [])) {
            if ((p.availableAt || 0) <= now) {
              eligibleShares += p.shares || 0;
            } else if (soonestReadyMs === null || p.availableAt < soonestReadyMs) {
              soonestReadyMs = p.availableAt;
            }
          }
        }
        const weeklyDividend = eligibleShares * currentPrice * tierRate;

        return {
          ticker,
          shares,
          character,
          currentPrice,
          value,
          avgCost,
          totalCost,
          totalReturnDollar,
          totalReturnPercent,
          todayReturnDollar,
          todayReturnPercent,
          tier,
          tierRate,
          eligibleShares,
          soonestReadyMs,
          weeklyDividend,
        };
      })
      .sort((a, b) => b.value - a.value);
  }, [holdings, prices, costBasis, priceHistory, holdingCohorts, dividendTierOverrides]);

  const totalWeeklyDividends = useMemo(
    () => portfolioItems.reduce((sum, item) => sum + (item.weeklyDividend || 0), 0),
    [portfolioItems]
  );

  const shortItems = useMemo(() => {
    return Object.entries(shorts || {})
      .filter(([_, position]) => position && position.shares > 0)
      .map(([ticker, position]) => {
        const character = CHARACTER_MAP[ticker];
        const currentPrice = prices[ticker] || character?.basePrice || position.costBasis || position.entryPrice || 0;
        const entryPrice = Number(position.costBasis || position.entryPrice) || 0;
        const shares = Number(position.shares) || 0;
        const margin = Number(position.margin) || 0;

        // P/L calculation: profit when price goes down
        const profitPerShare = entryPrice - currentPrice;
        const totalPL = profitPerShare * shares;
        const totalPLPercent = entryPrice > 0 ? (profitPerShare / entryPrice) * 100 : 0;

        // Current equity in the position
        const equity = margin + totalPL;
        const safeEquity = isNaN(equity) ? margin : equity;
        const equityRatio = currentPrice > 0 && shares > 0 ? safeEquity / (currentPrice * shares) : 1;
        const positionValue = safeEquity;

        return {
          ticker,
          character,
          shares,
          entryPrice,
          currentPrice,
          margin,
          totalPL: isNaN(totalPL) ? 0 : totalPL,
          totalPLPercent: isNaN(totalPLPercent) ? 0 : totalPLPercent,
          equity: safeEquity,
          equityRatio: isNaN(equityRatio) ? 1 : equityRatio,
          positionValue,
          openedAt: position.openedAt
        };
      })
      .sort((a, b) => b.positionValue - a.positionValue);
  }, [shorts, prices]);

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
    usePortfolioChartData(portfolioHistory, currentValue, timeRange);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className={`w-full max-w-2xl ${cardClass} border rounded-sm shadow-xl overflow-hidden max-h-[90vh] flex flex-col`}
        onClick={e => e.stopPropagation()}>

        <div className={`p-4 border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
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
                  className={`px-2 py-1 text-xs font-semibold rounded-sm border ${darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 text-zinc-600 hover:bg-amber-50'}`}>
                  Trade History
                </button>
              )}
              <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-600 text-xl`}>&times;</button>
            </div>
          </div>
        </div>

        {/* Portfolio Chart */}
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

              {/* Holdings List */}
              {portfolioItems.length > 0 && (
                <>
                  <h3 className={`text-sm font-semibold ${textClass} mb-2 flex items-center gap-2`}>
                    <span className={colorBlindMode ? 'text-teal-500' : 'text-green-500'}>📈</span> Long Positions
                    <span className={`text-xs font-normal ${mutedClass}`}>({portfolioItems.length})</span>
                    {totalWeeklyDividends > 0 && (
                      <span className={`ml-auto text-xs font-normal ${mutedClass}`}>
                        ~{formatCurrency(totalWeeklyDividends)} / week in dividends
                      </span>
                    )}
                  </h3>
                  <div className="space-y-2">
                    {portfolioItems.map(item => (
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

              {/* Short Positions Section */}
              {shortItems.length > 0 && (
                <div className={`mt-4 pt-4 border-t ${darkMode ? 'border-zinc-700' : 'border-amber-300'}`}>
                  <h3 className={`text-sm font-semibold ${textClass} mb-2 flex items-center gap-2`}>
                    <span className="text-orange-500">📉</span> Short Positions
                    <span className={`text-xs font-normal ${mutedClass}`}>({shortItems.length})</span>
                  </h3>
                  <div className="space-y-2">
                    {shortItems.map(item => (
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
                </div>
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
