import { useState, useMemo, useCallback } from 'react';
import { CHARACTERS } from '../characters';
import { CREWS } from '../crews';
import { ITEMS_PER_PAGE } from '../constants';
import { GENERATION_FILTER_ALL, GENERATION_FILTER_UNASSIGNED } from '../constants/generations';

// Sorts that only exist inside the Review tab. Shared with MarketControls so the
// tab switcher and the sort logic agree on what to clear when you leave.
export const REVIEW_SORTS = ['review-change', 'review-since'];
import { getCurrentPrice } from '../utils/calculations';
import { getReviewChanges, getMostRecentHaltWindow, REVIEW_MAX_AGE_MS } from '../utils/marketHours';
import { get24hChange, getTradeActivity } from '../utils/marketStats';

// All state + filtering/sorting for browsing the market grid on the home page:
// tab, crew filter, search, sort, pagination, and the resulting character list.
export function useMarketBrowser({ userData, prices, priceHistory, launchedTickers, ipoRestrictedTickers, storedReviewChanges }) {
  const [sortBy, setSortBy] = useState('price-high');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [showAll, setShowAll] = useState(false);
  const [marketTab, setMarketTab] = useState('stocks'); // 'stocks', 'etfs', 'watchlist', or 'review'
  const [crewFilter, setCrewFilter] = useState('ALL'); // 'ALL' or crew ID
  // 'ALL', a generation id, or 'UNASSIGNED'. Stacks with the crew filter.
  const [generationFilter, setGenerationFilter] = useState(GENERATION_FILTER_ALL);

  // What the admin changed in the last chapter review.
  //
  // The stored copy (market/reviewChanges) is authoritative: the server built it
  // during the review, while the price history still covered the whole window.
  // Deriving it here can only see the live history, which keeps a limited number
  // of points per ticker — an actively traded stock loses its pre-adjustment
  // price within a day and silently drops off the tab.
  //
  // The local derivation still runs and fills any gaps, so an adjustment made
  // after the recap posted still shows up.
  const reviewChanges = useMemo(() => {
    const derived = getReviewChanges(priceHistory, CHARACTERS);
    const { end } = getMostRecentHaltWindow();
    const storedIsCurrent = storedReviewChanges?.windowEnd === end
      && Date.now() - end <= REVIEW_MAX_AGE_MS;
    if (!storedIsCurrent) return derived;
    return { ...derived, ...(storedReviewChanges.changes || {}) };
  }, [priceHistory, storedReviewChanges]);

  // Build crew membership lookup for crew filter
  const crewMembershipMap = useMemo(() => {
    const map = {};
    Object.values(CREWS).forEach(crew => {
      crew.members.forEach(ticker => {
        if (!map[ticker]) map[ticker] = [];
        map[ticker].push(crew.id);
      });
    });
    return map;
  }, []);

  const change24h = useCallback(
    (ticker) => get24hChange(ticker, prices, priceHistory),
    [prices, priceHistory]
  );

  const filteredCharacters = useMemo(() => {
    let filtered = CHARACTERS.filter(c => {
      // Tab filters
      if (marketTab === 'review') {
        if (!reviewChanges[c.ticker]) return false;
      } else if (marketTab === 'watchlist') {
        const watchlist = userData?.watchlist || [];
        if (!watchlist.includes(c.ticker)) return false;
      } else {
        if (marketTab === 'etfs' && !c.isETF) return false;
        if (marketTab === 'stocks' && c.isETF) return false;
      }

      // Crew filter
      if (crewFilter !== 'ALL') {
        const crews = crewMembershipMap[c.ticker] || [];
        if (!crews.includes(crewFilter)) return false;
      }

      // Generation filter. ETFs have no generation, so any generation choice
      // (including Unassigned) hides them rather than lumping them together.
      if (generationFilter !== GENERATION_FILTER_ALL) {
        if (c.isETF) return false;
        if (generationFilter === GENERATION_FILTER_UNASSIGNED) {
          if (c.generation) return false;
        } else if (c.generation !== generationFilter) {
          return false;
        }
      }

      // Search filter
      const q = searchQuery.toLowerCase();
      const matchesSearch = c.name.toLowerCase().includes(q) ||
        c.ticker.toLowerCase().includes(q) ||
        (c.altNames || []).some(n => n.toLowerCase().includes(q));
      if (!matchesSearch) return false;

      // Hide characters that require IPO and haven't launched yet,
      // and characters currently in an IPO phase.
      if (c.ipoRequired && !launchedTickers.includes(c.ticker)) return false;
      if (ipoRestrictedTickers.includes(c.ticker)) return false;

      return true;
    });

    const priceChanges = {};
    CHARACTERS.forEach(c => {
      priceChanges[c.ticker] = change24h(c.ticker);
    });

    // How far trading has carried a stock away from the price the admin set in
    // the review. Same figure the card's badge shows.
    const driftSinceReview = (ticker) => {
      const setPrice = reviewChanges[ticker]?.newPrice;
      if (!(setPrice > 0)) return 0;
      return ((getCurrentPrice(ticker, priceHistory, prices) - setPrice) / setPrice) * 100;
    };

    // The review sorts mean nothing outside the Review tab, so fall back to
    // price there. 'review-change' used to piggyback on 'price-high', which made
    // picking "Price: High" in that tab silently do nothing.
    const isReviewSort = REVIEW_SORTS.includes(sortBy);
    const effectiveSort = (isReviewSort && marketTab !== 'review') ? 'price-high' : sortBy;

    switch (effectiveSort) {
      case 'review-change':
        filtered.sort((a, b) => Math.abs(reviewChanges[b.ticker]?.percentChange || 0) - Math.abs(reviewChanges[a.ticker]?.percentChange || 0));
        break;
      // Biggest movement away from the adjustment, in either direction — the
      // stocks the market disagreed with most.
      case 'review-since':
        filtered.sort((a, b) => Math.abs(driftSinceReview(b.ticker)) - Math.abs(driftSinceReview(a.ticker)));
        break;
      case 'price-high': filtered.sort((a, b) => getCurrentPrice(b.ticker, priceHistory, prices) - getCurrentPrice(a.ticker, priceHistory, prices)); break;
      case 'price-low': filtered.sort((a, b) => getCurrentPrice(a.ticker, priceHistory, prices) - getCurrentPrice(b.ticker, priceHistory, prices)); break;
      case 'change-high': filtered.sort((a, b) => (priceChanges[b.ticker] || 0) - (priceChanges[a.ticker] || 0)); break;
      case 'change-low': filtered.sort((a, b) => (priceChanges[a.ticker] || 0) - (priceChanges[b.ticker] || 0)); break;
      case 'active':
        filtered.sort((a, b) => {
          const activityA = getTradeActivity(priceHistory[a.ticker]);
          const activityB = getTradeActivity(priceHistory[b.ticker]);
          if (activityB.dayTrades !== activityA.dayTrades) return activityB.dayTrades - activityA.dayTrades;
          if (activityB.weekTrades !== activityA.weekTrades) return activityB.weekTrades - activityA.weekTrades;
          return a.ticker.localeCompare(b.ticker);
        });
        break;
      case 'ticker': filtered.sort((a, b) => a.ticker.localeCompare(b.ticker)); break;
      case 'newest': filtered.sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded)); break;
      case 'oldest': filtered.sort((a, b) => new Date(a.dateAdded) - new Date(b.dateAdded)); break;
    }
    return filtered;
  }, [searchQuery, sortBy, prices, priceHistory, change24h, ipoRestrictedTickers, launchedTickers, marketTab, userData?.watchlist, crewFilter, crewMembershipMap, generationFilter, reviewChanges]);

  // Floor at 1 so an empty result set shows "1/1", not "1/0".
  const totalPages = Math.max(1, Math.ceil(filteredCharacters.length / ITEMS_PER_PAGE));
  const displayedCharacters = showAll ? filteredCharacters : filteredCharacters.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  return {
    sortBy, setSortBy,
    searchQuery, setSearchQuery,
    currentPage, setCurrentPage,
    showAll, setShowAll,
    marketTab, setMarketTab,
    crewFilter, setCrewFilter,
    generationFilter, setGenerationFilter,
    reviewChanges,
    totalPages,
    displayedCharacters,
    change24h,
  };
}
