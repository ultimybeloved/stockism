import { useState } from 'react';
import CharacterCard from '../CharacterCard';
import { useAppContext } from '../../context/AppContext';
import { getThemeClasses } from '../../utils/theme';
import { getSentiment } from '../../utils/marketStats';

// The character card grid plus empty state and bottom pagination.
//
// The Review tab comes through as sections instead of one flat list, because it
// answers three different questions: what the admin decided, what the funds did
// in response, and which characters only moved because something they follow
// was adjusted. That last group used to be missing entirely, which is how a
// stock could climb 8% during a halt with nothing on screen explaining it.
const MarketGrid = ({
  displayedCharacters,
  change24h,
  activeUserData,
  onTrade,
  onViewChart,
  limitOrderRequest,
  onClearLimitOrderRequest,
  onToggleWatchlist,
  tradeAnimation,
  onSetAlert,
  marketTab,
  reviewChanges,
  reviewSections,
  searchQuery,
  currentPage, setCurrentPage,
  totalPages,
  showAll,
}) => {
  const { darkMode, userData, prices, priceHistory, marketData } = useAppContext();
  const { cardClass, mutedClass, ghostBtnClass } = getThemeClasses(darkMode);
  // Review tab only: 'all' shows every section stacked, which is the default.
  // Picking one narrows to it, for when you only care about what was adjusted.
  const [openSection, setOpenSection] = useState('all');
  // A section that is not in THIS week's review falls back to showing everything,
  // so a stale pick from last week cannot leave the tab looking empty.
  const activeSection = reviewSections?.some((s) => s.id === openSection) ? openSection : 'all';

  // One card, wherever it is being rendered.
  const renderCard = (character) => (
    <CharacterCard
      key={character.ticker}
      character={character}
      price={(() => {
        const history = priceHistory[character.ticker];
        if (history && history.length > 0) {
          return history[history.length - 1].price;
        }
        return prices[character.ticker] || character.basePrice;
      })()}
      priceChange={change24h(character.ticker)}
      sentiment={getSentiment(character.ticker, prices, priceHistory)}
      holdings={activeUserData.holdings?.[character.ticker] || 0}
      shortPosition={activeUserData.shorts?.[character.ticker]}
      onTrade={onTrade}
      onViewChart={onViewChart}
      userCash={activeUserData.cash || 0}
      limitOrderRequest={limitOrderRequest}
      onClearLimitOrderRequest={onClearLimitOrderRequest}
      isWatchlisted={(userData?.watchlist || []).includes(character.ticker)}
      onToggleWatchlist={onToggleWatchlist}
      tradeAnimation={tradeAnimation?.ticker === character.ticker ? tradeAnimation : null}
      haltInfo={marketData?.haltedTickers?.[character.ticker]}
      onSetAlert={onSetAlert}
      // Only in the Review tab: elsewhere the card's own price and 24h
      // change are the whole story.
      reviewChange={marketTab === 'review' ? reviewChanges?.[character.ticker] : null}
    />
  );

  // Auto-fills as many ~300px+ columns as the screen allows.
  const cardGrid = (list) => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
      {list.map(renderCard)}
    </div>
  );

  return (
    <>
      {reviewSections ? (
        <>
          {/* Section picker. Falls back to showing everything if the section
              that was open is not in this week's review. */}
          {reviewSections.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {[{ id: 'all', short: 'Show All' }, ...reviewSections].map((option) => (
                <button
                  key={option.id}
                  onClick={() => setOpenSection(option.id)}
                  className={`px-2.5 py-1 text-xs rounded-full font-semibold transition-colors ${
                    activeSection === option.id ? 'bg-amber-500 text-white' : `border ${ghostBtnClass}`
                  }`}
                >
                  {option.short}
                  {option.characters && <span className="ml-1 opacity-70">{option.characters.length}</span>}
                </button>
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
      ) : cardGrid(displayedCharacters)}

      {/* Empty state for the grid */}
      {displayedCharacters.length === 0 && (
        <div className={`${cardClass} border rounded-sm p-8 text-center`}>
          <p className={`text-sm ${mutedClass}`}>
            {marketTab === 'watchlist' && !searchQuery
              ? 'Your watchlist is empty. Tap the ☆ on any character to add it.'
              : 'No characters match your search.'}
          </p>
        </div>
      )}

      {/* Bottom Pagination */}
      {!showAll && !reviewSections && totalPages > 1 && (
        <div className={`${cardClass} border rounded-sm p-4 mt-4`}>
          <div className="flex justify-center items-center gap-4">
            <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
              className={`px-4 py-2 text-sm font-semibold rounded-sm border ${ghostBtnClass} disabled:opacity-50`}>
              Previous
            </button>
            <span className={`text-sm ${mutedClass}`}>Page {currentPage} of {totalPages}</span>
            <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
              className={`px-4 py-2 text-sm font-semibold rounded-sm border ${ghostBtnClass} disabled:opacity-50`}>
              Next
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default MarketGrid;
