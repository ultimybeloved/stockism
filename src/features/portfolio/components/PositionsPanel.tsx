// The portfolio's positions: the Long / Short tabs, search and sort, dust
// clean-up, and one row per position. On phones each long row can be swiped:
// left to sell, right to buy more (it only opens the order form).
import { useMemo, useState, type ComponentProps } from 'react';
import { themeClasses } from '../../../utils/theme';
import { formatCurrency } from '../../../utils/formatters';
import { useSession, useMarket } from '../../../context/AppContext';
import HoldingRow from './HoldingRow';
import ShortRow from './ShortRow';
import HoldingsControls from './HoldingsControls';
import DustCleanupBanner from './DustCleanupBanner';
import SwipeRow from './SwipeRow';
import { useDustCleanup } from '../hooks/useDustCleanup';
import { buildShortItems, type PortfolioItem } from '../utils/buildPositionItems';
import { filterHoldings, sortHoldings, type ShareInputs } from '../utils/shared';
import { isWeeklyHalt } from '../../../utils/marketHours';
import type { TradeAction } from '../../../types';

type RowProps = ComponentProps<typeof HoldingRow>;
type PositionTab = 'long' | 'short';

interface PositionsPanelProps {
  portfolioItems: PortfolioItem[];
  onTrade: (ticker: string, action: TradeAction, amount: number) => unknown;
  /** Opens the order form for a stock (swipe on phones). */
  onOpenOrder?: (ticker: string, action: TradeAction) => void;
  onLimitSell?: RowProps['onLimitSell'];
  drip?: RowProps['drip'];
  onToggleDrip?: RowProps['onToggleDrip'];
}

const PositionsPanel = ({
  portfolioItems,
  onTrade,
  onOpenOrder,
  onLimitSell,
  drip = {},
  onToggleDrip,
}: PositionsPanelProps) => {
  const { userData, holdings, shorts, showNotification } = useSession();
  const { prices, marketData } = useMarket();
  const colorBlindMode = userData?.colorBlindMode || false;
  const { mutedClass } = themeClasses;
  const [sellAmounts, setSellAmounts] = useState<ShareInputs>({});
  const [coverAmounts, setCoverAmounts] = useState<ShareInputs>({});
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);
  const [expandedShortTicker, setExpandedShortTicker] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('value');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  // Long/short tab: open on whichever side the player actually has positions in.
  const [positionTab, setPositionTab] = useState<PositionTab>(() =>
    Object.values(holdings || {}).some((s) => s > 0) ? 'long' : 'short',
  );

  const switchPositionTab = (tab: PositionTab) => {
    setPositionTab(tab);
    setSearch(''); // a search for a long stock won't match shorts, so clear it
  };

  // Clicking the active sort flips direction; switching sort resets to a
  // sensible default (Z→A feels wrong for names, so Name defaults to A→Z).
  const handleSortChange = (key: string) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };

  const totalWeeklyDividends = useMemo(
    () => portfolioItems.reduce((sum, item) => sum + (item.weeklyDividend || 0), 0),
    [portfolioItems],
  );
  const visibleItems = useMemo(
    () => sortHoldings(filterHoldings(portfolioItems, search), sortKey, sortDir),
    [portfolioItems, search, sortKey, sortDir],
  );
  const { dustItems, dustTotal, sweeping, handleSweep } = useDustCleanup(portfolioItems, showNotification);

  const shortItems = useMemo(() => buildShortItems({ shorts, prices }), [shorts, prices]);
  const shortDust = useDustCleanup(shortItems, showNotification, 'short');
  const dustSweepOpen = !isWeeklyHalt() && !marketData?.marketHalted;
  const visibleShorts = useMemo(
    () => sortHoldings(filterHoldings(shortItems, search), sortKey, sortDir),
    [shortItems, search, sortKey, sortDir],
  );

  const totalValue = portfolioItems.reduce((sum, item) => sum + item.value, 0);

  if (portfolioItems.length === 0 && shortItems.length === 0) return null;

  return (
    <>
      <div className="flex gap-1 mb-3">
        {(
          [
            { key: 'long', label: '📈 Long', count: portfolioItems.length },
            { key: 'short', label: '📉 Short', count: shortItems.length },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => switchPositionTab(t.key)}
            className={`flex-1 py-1.5 text-sm font-semibold rounded-sm transition-colors ${
              positionTab === t.key
                ? 'bg-orange-600 text-white'
                : 'light:bg-amber-50 light:text-slate-500 light:hover:bg-amber-100 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
            }`}
          >
            {t.label} <span className="text-xs font-normal">({t.count})</span>
          </button>
        ))}
      </div>

      <HoldingsControls
        search={search}
        setSearch={setSearch}
        sortKey={sortKey}
        sortDir={sortDir}
        onSortChange={handleSortChange}
      />

      {positionTab === 'long' ? (
        <>
          {dustItems.length > 0 && dustSweepOpen && (
            <DustCleanupBanner count={dustItems.length} total={dustTotal} sweeping={sweeping} onConfirm={handleSweep} />
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
              {onOpenOrder && (
                <p className={`md:hidden text-[11px] ${mutedClass} mb-2`}>
                  Swipe a stock left to sell, right to buy more.
                </p>
              )}
              <div className="space-y-2">
                {visibleItems.map((item) => (
                  <SwipeRow
                    key={item.ticker}
                    onSwipeLeft={onOpenOrder ? () => onOpenOrder(item.ticker, 'sell') : undefined}
                    onSwipeRight={onOpenOrder ? () => onOpenOrder(item.ticker, 'buy') : undefined}
                    colorBlindMode={colorBlindMode}
                  >
                    <HoldingRow
                      item={item}
                      isExpanded={expandedTicker === item.ticker}
                      onToggle={(t) => setExpandedTicker(expandedTicker === t ? null : t)}
                      totalValue={totalValue}
                      sellAmounts={sellAmounts}
                      setSellAmounts={setSellAmounts}
                      onSell={(ticker, amount) => onTrade(ticker, 'sell', amount)}
                      onLimitSell={onLimitSell}
                      drip={drip}
                      onToggleDrip={onToggleDrip}
                      colorBlindMode={colorBlindMode}
                    />
                  </SwipeRow>
                ))}
              </div>
            </>
          )}
        </>
      ) : shortItems.length === 0 ? (
        <p className={`text-sm text-center py-4 ${mutedClass}`}>No short positions.</p>
      ) : visibleShorts.length === 0 ? (
        <p className={`text-sm text-center py-4 ${mutedClass}`}>No shorts match your search.</p>
      ) : (
        <div className="space-y-2">
          {shortDust.dustItems.length > 0 && dustSweepOpen && (
            <DustCleanupBanner
              side="short"
              count={shortDust.dustItems.length}
              total={shortDust.dustTotal}
              sweeping={shortDust.sweeping}
              onConfirm={shortDust.handleSweep}
            />
          )}
          {visibleShorts.map((item) => (
            <ShortRow
              key={`short-${item.ticker}`}
              item={item}
              isExpanded={expandedShortTicker === item.ticker}
              onToggle={(t) => setExpandedShortTicker(expandedShortTicker === t ? null : t)}
              coverAmounts={coverAmounts}
              setCoverAmounts={setCoverAmounts}
              onCover={(ticker, amount) => onTrade(ticker, 'cover', amount)}
              colorBlindMode={colorBlindMode}
            />
          ))}
        </div>
      )}
    </>
  );
};

export default PositionsPanel;
