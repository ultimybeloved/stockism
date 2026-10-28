import { useState } from 'react';
import CharacterCard from './CharacterCard';
import MarketList from './MarketList';
import QuickActionsSheet from './QuickActionsSheet';
import type { MarketView } from '../hooks/useMarketView';
import { useSession, useMarket } from '../../../context/AppContext';
import { themeClasses } from '../../../utils/theme';
import { getSentiment } from '../../../utils/marketStats';
import { lastOf } from '../../../utils/arrays';
import type { ComponentProps } from 'react';
import type { Character } from '../../../characters';
import type { UserData } from '../../../types';
import type { useMarketBrowser } from '../hooks/useMarketBrowser';
import ToggleChip from '../../../shared/components/ToggleChip';
import { useSwipePager } from '../hooks/useSwipePager';
import { usePhone } from '../../../shared/hooks/useMediaQuery';

type CardProps = ComponentProps<typeof CharacterCard>;

type MarketGridProps = Pick<
  ReturnType<typeof useMarketBrowser>,
  | 'displayedCharacters'
  | 'reviewChanges'
  | 'reviewSections'
  | 'currentPage'
  | 'setCurrentPage'
  | 'totalPages'
  | 'showAll'
> &
  Pick<CardProps, 'onTrade' | 'onViewChart' | 'onToggleWatchlist' | 'onSetAlert'> & {
    activeUserData: UserData;
    tradeAnimation?: CardProps['tradeAnimation'];
    marketTab: string;
    searchQuery: string;
    view: MarketView;
    /** Wide screens: the stock open in the stock window, and the ones picked to compare. */
    selectedTicker?: string;
    compareTickers?: string[];
    sortBy: string;
    setSortBy: (sort: string) => void;
  };

// The character card grid plus empty state and bottom pagination.
//
// The Review tab comes through as sections instead of one flat list, because it
// answers three different questions: what the admin decided, what the funds did
// in response, and which characters only moved because something they follow
// was adjusted. That last group used to be missing entirely, which is how a
// stock could climb 8% during a halt with nothing on screen explaining it.
const MarketGrid = ({
  displayedCharacters,
  activeUserData,
  onTrade,
  onViewChart,
  onToggleWatchlist,
  tradeAnimation,
  onSetAlert,
  marketTab,
  reviewChanges,
  reviewSections,
  searchQuery,
  currentPage,
  setCurrentPage,
  totalPages,
  showAll,
  view,
  sortBy,
  setSortBy,
  selectedTicker,
  compareTickers = [],
}: MarketGridProps) => {
  const { userData } = useSession();
  const { prices, priceHistory, marketData } = useMarket();
  const { cardClass, mutedClass, ghostBtnClass } = themeClasses;
  // Review tab only: 'all' shows every section stacked, which is the default.
  // Picking one narrows to it, for when you only care about what was adjusted.
  const [openSection, setOpenSection] = useState('all');
  // A section that is not in THIS week's review falls back to showing everything,
  // so a stale pick from last week cannot leave the tab looking empty.
  const activeSection = reviewSections?.some((s) => s.id === openSection) ? openSection : 'all';
  // Phones: the stock someone pressed and held, for its quick actions.
  const [quick, setQuick] = useState<Character | null>(null);
  const phone = usePhone();
  const pager = useSwipePager(currentPage, totalPages, setCurrentPage, phone && !showAll && !reviewSections);

  // One card, wherever it is being rendered.
  const renderCard = (character: Character) => (
    <CharacterCard
      key={character.ticker}
      character={character}
      price={lastOf(priceHistory[character.ticker])?.price ?? (prices[character.ticker] || character.basePrice)}
      sentiment={getSentiment(character.ticker, prices, priceHistory)}
      holdings={activeUserData.holdings?.[character.ticker] || 0}
      shortPosition={activeUserData.shorts?.[character.ticker]}
      onTrade={onTrade}
      onViewChart={onViewChart}
      userCash={activeUserData.cash || 0}
      isWatchlisted={(userData?.watchlist || []).includes(character.ticker)}
      onToggleWatchlist={onToggleWatchlist}
      tradeAnimation={tradeAnimation?.ticker === character.ticker ? tradeAnimation : null}
      haltInfo={marketData?.haltedTickers?.[character.ticker]}
      onSetAlert={onSetAlert}
      onQuickActions={setQuick}
      highlight={
        character.ticker === selectedTicker ? 'open' : compareTickers.includes(character.ticker) ? 'compare' : null
      }
      // Only in the Review tab: elsewhere the card's own price and 24h
      // change are the whole story.
      reviewChange={marketTab === 'review' ? reviewChanges?.[character.ticker] : null}
    />
  );

  // Two columns on phones, four on desktop (three rows a page), or the list view.
  const cardGrid = (list: Character[]) =>
    view === 'list' ? (
      <MarketList
        characters={list}
        onTrade={onTrade}
        onViewChart={onViewChart}
        onQuickActions={setQuick}
        selectedTicker={selectedTicker}
        sortBy={sortBy}
        setSortBy={setSortBy}
      />
    ) : (
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4">{list.map(renderCard)}</div>
    );

  return (
    <>
      {reviewSections ? (
        <>
          {/* Section picker. Falls back to showing everything if the section
              that was open is not in this week's review. */}
          {reviewSections.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {[{ id: 'all', short: 'Show All', characters: undefined }, ...reviewSections].map((option) => (
                <ToggleChip
                  key={option.id}
                  active={activeSection === option.id}
                  accent="#f59e0b"
                  onClick={() => setOpenSection(option.id)}
                >
                  {option.short}
                  {option.characters && <span className="opacity-70">{option.characters.length}</span>}
                </ToggleChip>
              ))}
            </div>
          )}

          {reviewSections
            .filter((section) => activeSection === 'all' || section.id === activeSection)
            .map((section) => (
              <div key={section.id} className="mb-6">
                <div className="mb-3">
                  <h3 className={`text-sm font-bold uppercase tracking-wider ${mutedClass}`}>
                    {section.title}
                    <span className="ml-2 font-semibold normal-case tracking-normal">
                      ({section.characters.length})
                    </span>
                  </h3>
                  <p className={`text-xs mt-0.5 ${mutedClass}`}>{section.blurb}</p>
                </div>
                {cardGrid(section.characters)}
              </div>
            ))}
        </>
      ) : (
        <div
          ref={pager.box}
          {...pager.handlers}
          className="scroll-mt-20 max-md:touch-pan-y max-md:overscroll-x-contain"
        >
          <div
            key={currentPage}
            className={pager.dir === 'next' ? 'page-in-next' : pager.dir === 'prev' ? 'page-in-prev' : ''}
          >
            {cardGrid(displayedCharacters)}
          </div>
        </div>
      )}

      {/* Empty state for the grid */}
      {displayedCharacters.length === 0 && (
        <div className={`${cardClass} border rounded-sm p-8 text-center`}>
          <p className={`text-sm ${mutedClass}`}>
            {marketTab === 'watchlist' && !searchQuery
              ? 'This list is empty. Tap the ☆ on any character to add it.'
              : 'No characters match your search.'}
          </p>
        </div>
      )}

      {/* Bottom Pagination */}
      {!showAll && !reviewSections && totalPages > 1 && (
        <div className={`${cardClass} border rounded-sm p-4 mt-4`}>
          <div className="flex justify-center items-center gap-4">
            <button
              onClick={() => pager.go(currentPage - 1)}
              disabled={currentPage === 1}
              className={`px-4 py-2 text-sm font-semibold rounded-sm border ${ghostBtnClass} disabled:opacity-50`}
            >
              Previous
            </button>
            <span className={`text-sm text-center ${mutedClass}`}>
              Page {currentPage} of {totalPages}
              {phone && <span className="block text-[11px] opacity-70">or swipe the cards</span>}
            </span>
            <button
              onClick={() => pager.go(currentPage + 1)}
              disabled={currentPage === totalPages}
              className={`px-4 py-2 text-sm font-semibold rounded-sm border ${ghostBtnClass} disabled:opacity-50`}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {quick && (
        <QuickActionsSheet
          character={quick}
          onClose={() => setQuick(null)}
          onTrade={onTrade}
          onViewChart={onViewChart}
          onToggleWatchlist={onToggleWatchlist}
          onSetAlert={onSetAlert}
        />
      )}
    </>
  );
};

export default MarketGrid;
