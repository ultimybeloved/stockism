import { CREWS, CREW_MAP } from '../../crews';
import { GENERATIONS, GENERATION_FILTER_ALL, GENERATION_FILTER_UNASSIGNED } from '../../constants/generations';
import { useAppContext } from '../../context/AppContext';
import { getThemeClasses } from '../../utils/theme';
import { REVIEW_SORTS } from '../../hooks/useMarketBrowser';

// Market column controls: stocks/ETFs/watchlist/review tabs, crew filter
// pills, and the sort/search/pagination card. All state comes from
// useMarketBrowser via props.
const MarketControls = ({
  marketTab, setMarketTab,
  crewFilter, setCrewFilter,
  generationFilter, setGenerationFilter,
  sortBy, setSortBy,
  searchQuery, setSearchQuery,
  currentPage, setCurrentPage,
  totalPages,
  showAll, setShowAll,
  reviewChanges,
}) => {
  const { darkMode, user, userData } = useAppContext();
  const { cardClass, mutedClass, inputClass, ghostBtnClass, chipClass, raisedClass } = getThemeClasses(darkMode);
  const hasReviewChanges = Object.keys(reviewChanges).length > 0;

  const switchTab = (tab) => {
    setMarketTab(tab);
    setCurrentPage(1);
    setSearchQuery('');
    // The Review tab opens on its own sort. Leaving it has to drop that sort,
    // since it means nothing on the other tabs.
    if (tab === 'review') setSortBy('review-change');
    else if (REVIEW_SORTS.includes(sortBy)) setSortBy('price-high');
  };

  const pickGeneration = (id) => { setGenerationFilter(id); setCurrentPage(1); };

  return (
    <>
      {/* Market Tab Toggle */}
      <div className="flex flex-wrap gap-2 mb-3">
        <button
          onClick={() => switchTab('stocks')}
          className={`px-4 py-2 text-sm font-semibold rounded-sm transition-all ${
            marketTab === 'stocks'
              ? 'bg-amber-500 text-white'
              : `border ${ghostBtnClass}`
          }`}
        >
          Stocks
        </button>
        <button
          onClick={() => switchTab('etfs')}
          className={`px-4 py-2 text-sm font-semibold rounded-sm transition-all ${
            marketTab === 'etfs'
              ? 'bg-purple-600 text-white'
              : `border ${ghostBtnClass}`
          }`}
        >
          ETFs
        </button>
        {user && userData && (
          <button
            onClick={() => switchTab('watchlist')}
            className={`px-4 py-2 text-sm font-semibold rounded-sm transition-all ${
              marketTab === 'watchlist'
                ? 'bg-yellow-500 text-white'
                : `border ${ghostBtnClass}`
            }`}
          >
            Watchlist
          </button>
        )}
        {hasReviewChanges && (
          <button
            onClick={() => switchTab('review')}
            className={`px-4 py-2 text-sm font-semibold rounded-sm transition-all ${
              marketTab === 'review'
                ? 'bg-emerald-600 text-white'
                : `border ${darkMode ? 'border-emerald-800 text-emerald-400 hover:bg-zinc-800' : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'}`
            }`}
          >
            Review ({Object.keys(reviewChanges).length})
          </button>
        )}
      </div>

      {/* Crew Filter */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        <button
          onClick={() => { setCrewFilter('ALL'); setCurrentPage(1); }}
          className={`px-2.5 py-1 text-xs rounded-full font-semibold transition-colors ${
            crewFilter === 'ALL'
              ? 'bg-orange-600 text-white'
              : chipClass
          }`}
        >
          All Crews
        </button>
        {user && userData?.crew && (
          <button
            onClick={() => { setCrewFilter(userData.crew); setCurrentPage(1); }}
            className={`px-2.5 py-1 text-xs rounded-full font-semibold transition-colors ${
              crewFilter === userData.crew
                ? 'text-white'
                : chipClass
            }`}
            style={crewFilter === userData.crew ? { backgroundColor: CREW_MAP[userData.crew]?.color || '#f97316' } : {}}
          >
            My Crew
          </button>
        )}
        {Object.values(CREWS).map(crew => (
          <button
            key={crew.id}
            onClick={() => { setCrewFilter(crew.id); setCurrentPage(1); }}
            className={`px-2.5 py-1 text-xs rounded-full font-semibold flex items-center gap-1 transition-colors ${
              crewFilter === crew.id
                ? 'text-white'
                : chipClass
            }`}
            style={crewFilter === crew.id ? { backgroundColor: crew.color, color: crew.color === '#FFFFFF' || crew.color === '#f3c404' || crew.color === '#f3c803' ? '#000' : '#fff' } : {}}
          >
            {crew.icon ? (
              <img src={crew.icon} alt="" className="w-3.5 h-3.5 rounded-full object-cover" />
            ) : (
              <span>{crew.emblem}</span>
            )}
            <span className="hidden sm:inline">{crew.name}</span>
          </button>
        ))}
      </div>

      {/* Generation Filter — stacks with the crew filter above */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        <button
          onClick={() => pickGeneration(GENERATION_FILTER_ALL)}
          className={`px-2.5 py-1 text-xs rounded-full font-semibold transition-colors ${
            generationFilter === GENERATION_FILTER_ALL ? 'bg-orange-600 text-white' : chipClass
          }`}
        >
          All Gens
        </button>
        {GENERATIONS.map(gen => (
          <button
            key={gen.id}
            onClick={() => pickGeneration(gen.id)}
            className={`px-2.5 py-1 text-xs rounded-full font-semibold transition-colors ${
              generationFilter === gen.id ? 'bg-sky-600 text-white' : chipClass
            }`}
          >
            {gen.label}
          </button>
        ))}
        <button
          onClick={() => pickGeneration(GENERATION_FILTER_UNASSIGNED)}
          className={`px-2.5 py-1 text-xs rounded-full font-semibold transition-colors ${
            generationFilter === GENERATION_FILTER_UNASSIGNED ? 'bg-slate-600 text-white' : chipClass
          }`}
        >
          Unassigned
        </button>
      </div>

      {/* Controls */}
      <div className={`${cardClass} ${raisedClass} border rounded-sm p-4 mb-4`}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <select value={sortBy} onChange={(e) => { setSortBy(e.target.value); setCurrentPage(1); }}
            className={`px-3 py-2 text-sm rounded-sm border ${inputClass}`}>
            {marketTab === 'review' && <option value="review-change">Biggest Review Change</option>}
            {marketTab === 'review' && <option value="review-since">Moved Most Since Review</option>}
            <option value="price-high">Price: High</option>
            <option value="price-low">Price: Low</option>
            <option value="change-high">Top Gainers</option>
            <option value="change-low">Top Losers</option>
            <option value="active">Most Active</option>
            <option value="ticker">Ticker A-Z</option>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>
          <input type="text" placeholder="Search..." value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
            className={`px-3 py-2 text-sm rounded-sm border ${inputClass}`} />
          <div className="flex items-center justify-center gap-2">
            <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={showAll || currentPage === 1}
              className={`px-3 py-2 text-sm rounded-sm border ${ghostBtnClass} disabled:opacity-50`}>
              Prev
            </button>
            <span className={`text-sm ${mutedClass}`}>{currentPage}/{totalPages}</span>
            <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={showAll || currentPage === totalPages}
              className={`px-3 py-2 text-sm rounded-sm border ${ghostBtnClass} disabled:opacity-50`}>
              Next
            </button>
          </div>
          <button onClick={() => setShowAll(!showAll)}
            className={`px-3 py-2 text-sm font-semibold rounded-sm ${showAll ? 'bg-amber-500 text-white' : `border ${ghostBtnClass}`}`}>
            {showAll ? 'Show Pages' : 'Show All'}
          </button>
        </div>
      </div>
    </>
  );
};

export default MarketControls;
