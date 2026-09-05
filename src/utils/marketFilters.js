// Filtering and sorting for the market grid.
//
// Pure functions, no React and no Firebase, extracted from useMarketBrowser so
// the hook is state wiring and this is the rules. The hook had reached its
// 200-line limit and every new filter used to mean editing one long inline
// predicate plus threading another prop through two components.
//
// The filter shape is one object rather than a spread of separate values:
//
//   { tab, crew, generation, statusHidden, search }
//
// so adding the next filter is a key here and a control in the panel, not a
// change in five files.
import { CREWS } from '../crews';
import { GENERATION_FILTER_ALL, GENERATION_FILTER_UNASSIGNED } from '../constants/generations';
import { statusOf } from '../constants/statuses';
import { getCurrentPrice } from './calculations';
import { getTradeActivity } from './marketStats';

export const CREW_FILTER_ALL = 'ALL';

// Sorts that only exist inside the Review tab. Shared with MarketControls so the
// tab switcher and the sort logic agree on what to clear when you leave.
export const REVIEW_SORTS = ['review-change', 'review-since'];

export const DEFAULT_FILTERS = {
  tab: 'stocks', // 'stocks' | 'etfs' | 'watchlist' | 'review'
  crew: CREW_FILTER_ALL,
  generation: GENERATION_FILTER_ALL,
  statusHidden: [], // status ids to hide; empty shows everything
  search: '',
};

/** ticker -> [crewId], built once and reused across renders. */
export const buildCrewMembership = () => {
  const map = {};
  Object.values(CREWS).forEach((crew) => {
    crew.members.forEach((ticker) => {
      if (!map[ticker]) map[ticker] = [];
      map[ticker].push(crew.id);
    });
  });
  return map;
};

/** How many filters are actually narrowing the list, for the panel's badge. */
export const activeFilterCount = (filters) => {
  let n = 0;
  if (filters.crew !== CREW_FILTER_ALL) n++;
  if (filters.generation !== GENERATION_FILTER_ALL) n++;
  n += (filters.statusHidden || []).length;
  return n;
};

const matchesTab = (c, filters, ctx) => {
  if (filters.tab === 'review') return !!ctx.reviewChanges[c.ticker];
  if (filters.tab === 'watchlist') return (ctx.watchlist || []).includes(c.ticker);
  if (filters.tab === 'etfs') return !!c.isETF;
  return !c.isETF; // 'stocks'
};

const matchesCrew = (c, filters, ctx) => {
  if (filters.crew === CREW_FILTER_ALL) return true;
  return (ctx.crewMembership[c.ticker] || []).includes(filters.crew);
};

// ETFs have no generation, so any generation choice (including Unassigned)
// hides them rather than lumping them together.
const matchesGeneration = (c, filters) => {
  if (filters.generation === GENERATION_FILTER_ALL) return true;
  if (c.isETF) return false;
  if (filters.generation === GENERATION_FILTER_UNASSIGNED) return !c.generation;
  return c.generation === filters.generation;
};

// ETFs are never hidden by a status filter: a fund is not alive or dead, and
// hiding it because one of its members died would be wrong.
const matchesStatus = (c, filters) => {
  const hidden = filters.statusHidden || [];
  if (!hidden.length || c.isETF) return true;
  return !hidden.includes(statusOf(c));
};

const matchesSearch = (c, filters) => {
  const q = (filters.search || '').toLowerCase();
  if (!q) return true;
  return c.name.toLowerCase().includes(q)
    || c.ticker.toLowerCase().includes(q)
    || (c.altNames || []).some((n) => n.toLowerCase().includes(q));
};

// An unlaunched IPO character does not exist yet as far as the board is
// concerned, and one mid-IPO is bought through the IPO panel, not the grid.
const isTradeableHere = (c, ctx) => {
  if (c.ipoRequired && !ctx.launchedTickers.includes(c.ticker)) return false;
  return !ctx.ipoRestrictedTickers.includes(c.ticker);
};

export const matchesFilters = (c, filters, ctx) => matchesTab(c, filters, ctx)
  && matchesCrew(c, filters, ctx)
  && matchesGeneration(c, filters)
  && matchesStatus(c, filters)
  && matchesSearch(c, filters)
  && isTradeableHere(c, ctx);

/**
 * Sort in place and return the list.
 *
 * The review sorts mean nothing outside the Review tab, so they fall back to
 * price there. 'review-change' used to piggyback on 'price-high', which made
 * picking "Price: High" in that tab silently do nothing.
 */
export const sortCharacters = (list, sortBy, ctx) => {
  const { prices, priceHistory, priceChanges, reviewChanges, tab } = ctx;
  const effective = (REVIEW_SORTS.includes(sortBy) && tab !== 'review') ? 'price-high' : sortBy;

  // How far trading has carried a stock away from the price the admin set in
  // the review. Same figure the card's badge shows.
  const driftSinceReview = (ticker) => {
    const setPrice = reviewChanges[ticker]?.newPrice;
    if (!(setPrice > 0)) return 0;
    return ((getCurrentPrice(ticker, priceHistory, prices) - setPrice) / setPrice) * 100;
  };
  const priceOf = (t) => getCurrentPrice(t, priceHistory, prices);

  switch (effective) {
    case 'review-change':
      return list.sort((a, b) => Math.abs(reviewChanges[b.ticker]?.percentChange || 0)
        - Math.abs(reviewChanges[a.ticker]?.percentChange || 0));
    case 'review-since':
      return list.sort((a, b) => Math.abs(driftSinceReview(b.ticker)) - Math.abs(driftSinceReview(a.ticker)));
    case 'price-high': return list.sort((a, b) => priceOf(b.ticker) - priceOf(a.ticker));
    case 'price-low': return list.sort((a, b) => priceOf(a.ticker) - priceOf(b.ticker));
    case 'change-high': return list.sort((a, b) => (priceChanges[b.ticker] || 0) - (priceChanges[a.ticker] || 0));
    case 'change-low': return list.sort((a, b) => (priceChanges[a.ticker] || 0) - (priceChanges[b.ticker] || 0));
    case 'active':
      return list.sort((a, b) => {
        const activityA = getTradeActivity(priceHistory[a.ticker]);
        const activityB = getTradeActivity(priceHistory[b.ticker]);
        if (activityB.dayTrades !== activityA.dayTrades) return activityB.dayTrades - activityA.dayTrades;
        if (activityB.weekTrades !== activityA.weekTrades) return activityB.weekTrades - activityA.weekTrades;
        return a.ticker.localeCompare(b.ticker);
      });
    case 'ticker': return list.sort((a, b) => a.ticker.localeCompare(b.ticker));
    case 'newest': return list.sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));
    case 'oldest': return list.sort((a, b) => new Date(a.dateAdded) - new Date(b.dateAdded));
    default: return list;
  }
};

// ============================================
// SHARED ROSTER LOOKUPS
// ============================================
// Small queries over CHARACTERS that were each written out twice. Duplicated
// logic is how src/characters.js and functions/characters.js drifted apart in
// the first place, so these live in one place now.

/**
 * Characters added since the start of this week and actually tradeable.
 *
 * Was implemented separately in NewCharactersBoard and App.jsx, which meant the
 * board and the header banner could disagree about what counts as new.
 */
export const newThisWeek = (characters, launchedTickers, weekStart) => characters
  .filter((c) => new Date(c.dateAdded) >= weekStart
    && (!c.ipoRequired || launchedTickers.includes(c.ticker)))
  .sort((a, b) => new Date(a.dateAdded) - new Date(b.dateAdded));

/**
 * The funds a character belongs to. Empty for a fund itself.
 *
 * A character can be in several (Minsik Choi is in both Fist Gang and WTJC), so
 * this always returns every match rather than the first.
 */
export const fundsContaining = (characters, ticker, isETF) => (isETF
  ? []
  : characters.filter((c) => c.isETF && c.constituents?.includes(ticker)));
