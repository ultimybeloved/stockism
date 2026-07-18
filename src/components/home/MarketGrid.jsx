import CharacterCard from '../CharacterCard';
import { useAppContext } from '../../context/AppContext';
import { getThemeClasses } from '../../utils/theme';
import { getSentiment } from '../../utils/marketStats';

// The character card grid plus empty state and bottom pagination.
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
  searchQuery,
  currentPage, setCurrentPage,
  totalPages,
  showAll,
}) => {
  const { darkMode, userData, prices, priceHistory, marketData } = useAppContext();
  const { cardClass, mutedClass, ghostBtnClass } = getThemeClasses(darkMode);

  return (
    <>
      {/* Character Grid — auto-fills as many ~300px+ columns as the screen allows */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
        {displayedCharacters.map(character => (
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
          />
        ))}
      </div>

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
      {!showAll && totalPages > 1 && (
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
