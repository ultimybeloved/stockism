import { useState, useMemo, useCallback } from 'react';
import { CHARACTERS } from '../characters';
import { CREWS } from '../crews';
import { ITEMS_PER_PAGE } from '../constants';
import { getCurrentPrice } from '../utils/calculations';
import { getReviewChanges } from '../utils/marketHours';
import { get24hChange, getTradeActivity } from '../utils/marketStats';

// All state + filtering/sorting for browsing the market grid on the home page:
// tab, crew filter, search, sort, pagination, and the resulting character list.
export function useMarketBrowser({ userData, prices, priceHistory, launchedTickers, ipoRestrictedTickers }) {
  const [sortBy, setSortBy] = useState('price-high');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [showAll, setShowAll] = useState(false);
  const [marketTab, setMarketTab] = useState('stocks'); // 'stocks', 'etfs', 'watchlist', or 'review'
  const [crewFilter, setCrewFilter] = useState('ALL'); // 'ALL' or crew ID

  // Detect chapter review changes from most recent Thursday halt window
  const reviewChanges = useMemo(() => getReviewChanges(priceHistory, CHARACTERS), [priceHistory]);

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

    // Review tab defaults to biggest absolute % change
    if (marketTab === 'review' && sortBy === 'price-high') {
      filtered.sort((a, b) => Math.abs(reviewChanges[b.ticker]?.percentChange || 0) - Math.abs(reviewChanges[a.ticker]?.percentChange || 0));
      return filtered;
    }

    switch (sortBy) {
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
  }, [searchQuery, sortBy, prices, priceHistory, change24h, ipoRestrictedTickers, launchedTickers, marketTab, userData?.watchlist, crewFilter, crewMembershipMap, reviewChanges]);

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
    reviewChanges,
    totalPages,
    displayedCharacters,
    change24h,
  };
}
