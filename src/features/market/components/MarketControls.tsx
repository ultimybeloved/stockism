import { useState } from 'react';
import { useSession } from '../../../context/AppContext';
import { themeClasses } from '../../../utils/theme';
import { REVIEW_SORTS, activeFilterCount } from '../../../utils/marketFilters';
import MarketFilterPanel from './MarketFilterPanel';
import type { useMarketBrowser } from '../hooks/useMarketBrowser';
import type { MarketView } from '../hooks/useMarketView';
import { MARKET_SEARCH_ID } from '../hooks/useDesktopMarket';
import SegmentedSwitch from '../../../shared/components/SegmentedSwitch';

type MarketControlsProps = Pick<
  ReturnType<typeof useMarketBrowser>,
  | 'filters'
  | 'setFilter'
  | 'clearFilters'
  | 'sortBy'
  | 'setSortBy'
  | 'currentPage'
  | 'setCurrentPage'
  | 'totalPages'
  | 'showAll'
  | 'setShowAll'
  | 'reviewChanges'
> & { view: MarketView; setView: (view: MarketView) => void };

const TABS: { id: string; label: string; needsUser?: boolean; needsReview?: boolean }[] = [
  { id: 'stocks', label: 'Stocks' },
  { id: 'etfs', label: 'ETFs' },
  { id: 'watchlist', label: 'Watchlist', needsUser: true },
  { id: 'review', label: 'Review', needsReview: true },
];

const SORTS = [
  { id: 'price-high', label: 'Price: High' },
  { id: 'price-low', label: 'Price: Low' },
  { id: 'change-high', label: 'Top Gainers' },
  { id: 'change-low', label: 'Top Losers' },
  { id: 'active', label: 'Most Active' },
  { id: 'ticker', label: 'Ticker A-Z' },
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
];

// Market column controls: the tab row, the sort/search/pagination card, and a
// button that opens the crew/generation/status panel.
//
// The filters themselves moved into MarketFilterPanel. They had accumulated as
// separate stacked pill rows, one per feature, and the next one would have made
// three rows before you could see a stock.
const MarketControls = ({
  filters,
  setFilter,
  clearFilters,
  sortBy,
  setSortBy,
  currentPage,
  setCurrentPage,
  totalPages,
  showAll,
  setShowAll,
  reviewChanges,
  view,
  setView,
}: MarketControlsProps) => {
  const { user, userData } = useSession();
  const { cardClass, textClass, mutedClass, inputClass, ghostBtnClass, chipClass, raisedClass } = themeClasses;
  const [panelOpen, setPanelOpen] = useState(false);

  const hasReviewChanges = Object.keys(reviewChanges).length > 0;
  const isReviewTab = filters.tab === 'review';
  const activeCount = activeFilterCount(filters);

  const switchTab = (tab: string) => {
    setCurrentPage(1);
    setFilter('tab', tab);
    // The Review tab opens on its own sort. Leaving it has to drop that sort,
    // since it means nothing on the other tabs.
    if (tab === 'review') setSortBy('review-change');
    else if (REVIEW_SORTS.includes(sortBy)) setSortBy('price-high');
  };

  return (
    <>
      <div className="flex flex-wrap gap-2 mb-3">
        <SegmentedSwitch
          label="Market tabs"
          size="lg"
          options={TABS.filter((t) => (!t.needsUser || user) && (!t.needsReview || hasReviewChanges)).map(
            (t) => [t.id, t.id === 'review' ? `${t.label} (${Object.keys(reviewChanges).length})` : t.label] as const,
          )}
          value={filters.tab}
          onChange={switchTab}
        />

        <button
          onClick={() => setPanelOpen((o) => !o)}
          className={`px-4 py-2 text-sm font-semibold rounded-sm transition-all border ${ghostBtnClass} ${
            activeCount ? 'text-orange-500 border-orange-500' : ''
          }`}
        >
          Filters{activeCount ? ` (${activeCount})` : ''} {panelOpen ? '▲' : '▼'}
        </button>

        {/* Only offered when something is actually filtered, so it is never a
            button that does nothing. */}
        {activeCount > 0 && (
          <button onClick={clearFilters} className={`px-3 py-2 text-xs font-semibold rounded-sm ${chipClass}`}>
            Clear all
          </button>
        )}

        {/* Cards or list. The list is compact rows on phones, a table on desktop. */}
        <SegmentedSwitch
          label="Market view"
          size="lg"
          className="ml-auto"
          options={[
            ['cards', 'Cards'],
            ['list', 'List'],
          ]}
          value={view}
          onChange={setView}
        />
      </div>

      {panelOpen && (
        <MarketFilterPanel
          filters={filters}
          setFilter={setFilter}
          userData={userData}
          mutedClass={mutedClass}
          textClass={textClass}
        />
      )}

      <div className={`${cardClass} ${raisedClass} border rounded-sm p-3 md:p-4 mb-4`}>
        {/* Phones page from the bar under the grid, so only sort and search here. */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          <select
            aria-label="Sort by"
            value={sortBy}
            onChange={(e) => {
              setSortBy(e.target.value);
              setCurrentPage(1);
            }}
            className={`px-3 py-2 text-sm rounded-sm border ${inputClass}`}
          >
            {isReviewTab && <option value="review-change">Biggest Review Change</option>}
            {isReviewTab && <option value="review-since">Moved Most Since Review</option>}
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <input
            id={MARKET_SEARCH_ID}
            aria-label="Search characters"
            type="text"
            placeholder="Search..."
            value={filters.search}
            onChange={(e) => setFilter('search', e.target.value)}
            className={`px-3 py-2 text-sm rounded-sm border ${inputClass}`}
          />
          {/* The Review tab is sectioned and always shows everything, so paging
              it would only split a section in half. */}
          {!isReviewTab && (
            <>
              <div className="max-md:hidden flex items-center justify-center gap-2">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={showAll || currentPage === 1}
                  className={`px-3 py-2 text-sm rounded-sm border ${ghostBtnClass} disabled:opacity-50`}
                >
                  Prev
                </button>
                <span className={`text-sm ${mutedClass}`}>
                  {currentPage}/{totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={showAll || currentPage === totalPages}
                  className={`px-3 py-2 text-sm rounded-sm border ${ghostBtnClass} disabled:opacity-50`}
                >
                  Next
                </button>
              </div>
              <button
                onClick={() => setShowAll(!showAll)}
                className={`max-md:hidden px-3 py-2 text-sm font-semibold rounded-sm ${showAll ? 'bg-amber-500 text-white' : `border ${ghostBtnClass}`}`}
              >
                {showAll ? 'Show Pages' : 'Show All'}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default MarketControls;
