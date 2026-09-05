import { useState, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CHARACTERS } from '../characters';
import { ITEMS_PER_PAGE } from '../constants';
import { getReviewChanges, getMostRecentHaltWindow, mergeReviewChanges, buildReviewSections, REVIEW_MAX_AGE_MS } from '../utils/marketHours';
import { get24hChange } from '../utils/marketStats';
import {
  DEFAULT_FILTERS, buildCrewMembership, matchesFilters, sortCharacters, REVIEW_SORTS,
} from '../utils/marketFilters';

export { REVIEW_SORTS };

// State and wiring for browsing the market grid. The filter and sort RULES live
// in src/utils/marketFilters.js — this file is deliberately just plumbing, and
// stays that way so it does not creep back over the 200-line hook limit.
//
// Filters live in the URL so a filtered view can be linked and survives a
// refresh. LeaderboardPage already does this with ?board=season.
const readFilters = (params) => ({
  tab: params.get('tab') || DEFAULT_FILTERS.tab,
  crew: params.get('crew') || DEFAULT_FILTERS.crew,
  generation: params.get('gen') || DEFAULT_FILTERS.generation,
  statusHidden: params.get('hide') ? params.get('hide').split(',').filter(Boolean) : [],
  search: params.get('q') || '',
});

const writeFilters = (filters) => {
  const next = {};
  if (filters.tab !== DEFAULT_FILTERS.tab) next.tab = filters.tab;
  if (filters.crew !== DEFAULT_FILTERS.crew) next.crew = filters.crew;
  if (filters.generation !== DEFAULT_FILTERS.generation) next.gen = filters.generation;
  if (filters.statusHidden.length) next.hide = filters.statusHidden.join(',');
  if (filters.search) next.q = filters.search;
  return next;
};

export function useMarketBrowser({ userData, prices, priceHistory, launchedTickers, ipoRestrictedTickers, storedReviewChanges }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [sortBy, setSortBy] = useState('price-high');
  const [currentPage, setCurrentPage] = useState(1);
  const [showAll, setShowAll] = useState(false);

  const filters = useMemo(() => readFilters(searchParams), [searchParams]);

  // Every filter change resets to page one: staying on page 7 of a list that
  // just shrank to two pages shows an empty grid.
  const setFilter = useCallback((key, value) => {
    setCurrentPage(1);
    setSearchParams((prev) => {
      const next = writeFilters({ ...readFilters(prev), [key]: value });
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const clearFilters = useCallback(() => {
    setCurrentPage(1);
    setSearchParams((prev) => {
      // Search is a separate act from filtering, so Clear All leaves it alone.
      const q = prev.get('q');
      return q ? { q } : {};
    }, { replace: true });
  }, [setSearchParams]);

  // What the admin changed in the last chapter review.
  //
  // Stored server-side copy plus the locally derived one — see
  // mergeReviewChanges for which half each is trusted for.
  const reviewChanges = useMemo(() => {
    const derived = getReviewChanges(priceHistory, CHARACTERS);
    const { end } = getMostRecentHaltWindow();
    const storedIsCurrent = storedReviewChanges?.windowEnd === end
      && Date.now() - end <= REVIEW_MAX_AGE_MS;
    if (!storedIsCurrent) return derived;
    return mergeReviewChanges(derived, storedReviewChanges.changes);
  }, [priceHistory, storedReviewChanges]);

  const crewMembership = useMemo(buildCrewMembership, []);

  const change24h = useCallback(
    (ticker) => get24hChange(ticker, prices, priceHistory),
    [prices, priceHistory]
  );

  const filteredCharacters = useMemo(() => {
    const ctx = {
      reviewChanges,
      crewMembership,
      watchlist: userData?.watchlist || [],
      launchedTickers,
      ipoRestrictedTickers,
    };
    const matched = CHARACTERS.filter((c) => matchesFilters(c, filters, ctx));

    const priceChanges = {};
    CHARACTERS.forEach((c) => { priceChanges[c.ticker] = change24h(c.ticker); });

    return sortCharacters(matched, sortBy, {
      prices, priceHistory, priceChanges, reviewChanges, tab: filters.tab,
    });
  }, [filters, sortBy, prices, priceHistory, change24h, ipoRestrictedTickers,
    launchedTickers, userData?.watchlist, crewMembership, reviewChanges]);

  // Floor at 1 so an empty result set shows "1/1", not "1/0".
  const totalPages = Math.max(1, Math.ceil(filteredCharacters.length / ITEMS_PER_PAGE));
  // The Review tab is grouped into sections and is a bounded list anyway, so it
  // always shows everything. Paging it would split a section across pages.
  const displayedCharacters = (showAll || filters.tab === 'review')
    ? filteredCharacters
    : filteredCharacters.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  // Review tab only. Null everywhere else, which is how the grid knows to stay flat.
  const reviewSections = useMemo(
    () => (filters.tab === 'review' ? buildReviewSections(displayedCharacters, reviewChanges) : null),
    [filters.tab, displayedCharacters, reviewChanges],
  );

  return {
    filters, setFilter, clearFilters,
    sortBy, setSortBy,
    currentPage, setCurrentPage,
    showAll, setShowAll,
    reviewChanges,
    totalPages,
    displayedCharacters,
    reviewSections,
    change24h,
  };
}
