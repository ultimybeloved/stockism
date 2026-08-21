/**
 * Weekly trading halt utility
 * Every Thursday 13:00–21:00 UTC (chapter review window)
 */
import { CHARACTER_MAP } from '../characters';

export const isWeeklyHalt = () => {
  const now = new Date();
  if (now.getUTCDay() !== 4) return false; // Thursday = 4
  const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  return utcMins >= 780 && utcMins < 1260; // 13:00 (780) to 21:00 (1260)
};

export const getHaltTimeRemaining = () => {
  const now = new Date();
  const reopenToday = new Date(now);
  reopenToday.setUTCHours(21, 0, 0, 0);
  return Math.max(0, reopenToday.getTime() - now.getTime());
};

export const getNextHaltStart = () => {
  const now = new Date();
  const day = now.getUTCDay();
  const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  // If Thursday before halt starts, return today
  if (day === 4 && utcMins < 780) {
    const today = new Date(now);
    today.setUTCHours(13, 0, 0, 0);
    return today;
  }
  const daysUntil = (4 - day + 7) % 7 || 7;
  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + daysUntil);
  next.setUTCHours(13, 0, 0, 0);
  return next;
};

/**
 * Get the most recent Thursday halt window (13:00-21:00 UTC).
 * Returns { start, end } as epoch timestamps.
 * If currently in the halt window, returns the current one.
 */
export const getMostRecentHaltWindow = () => {
  const now = new Date();
  const day = now.getUTCDay();
  const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();

  // Start from today and walk backwards to find the most recent Thursday
  const d = new Date(now);

  if (day === 4 && utcMins >= 780) {
    // It's Thursday after halt start (including after market reopen) — use today
  } else {
    // Walk back to last Thursday
    const daysBack = (day - 4 + 7) % 7 || 7;
    d.setUTCDate(d.getUTCDate() - daysBack);
  }

  const start = new Date(d);
  start.setUTCHours(13, 0, 0, 0);
  const end = new Date(d);
  end.setUTCHours(21, 0, 0, 0);
  // The review itself stops at the pre-market lock. The opening auction settles
  // at 20:56, still inside the halt, and those are real fills at real demand —
  // counting them as part of the review made a stock's total disagree with its
  // own breakdown. $VIN read +0.06% total against +1.48% of knock-on on
  // 2026-08-20, because a 20:56 fill took back everything the review gave it.
  const reviewEnd = new Date(d);
  reviewEnd.setUTCHours(20, 55, 0, 0);

  return { start: start.getTime(), end: end.getTime(), reviewEnd: reviewEnd.getTime() };
};

// How long a chapter review stays visible in the Review tab before it is
// treated as last week's news. Applies to both the locally derived changes and
// the stored server-side copy.
export const REVIEW_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * What a chapter review did to one stock, split by cause.
 *
 * The market is halted for the whole window, so every price move inside it is
 * the admin's doing. It is just not all deliberate: adjusting one stock drags
 * every stock linked to it, and those knock-on moves land on the chart looking
 * exactly like trading. $GAP picked up 3.8% from $JIN, $SHNG and $FIST before
 * it was touched directly on 2026-08-20, on top of the 4.75% that was actually
 * set, and players read the gap as off-hours trading.
 *
 * So the two are reported separately:
 *   directChange   — what the admin typed into the price tool
 *   trailingChange — what linked stocks pushed onto it
 *   percentChange  — the whole window, which is what the chart shows
 *
 * `history` must be in timestamp order. Returns null for a stock the review
 * never moved, or one whose pre-review price is no longer known.
 *
 * Keep in sync with getReviewWindowChanges in functions/helpers.js.
 */
export const computeReviewChange = (history, start, end, fallbackOpen = null, rootByTimestamp = null) => {
  if (!Array.isArray(history) || history.length === 0) return null;

  // The price carried into the review, plus every point the review moved it.
  let openPrice = fallbackOpen;
  const moves = [];
  for (const entry of history) {
    if (!entry || typeof entry.price !== 'number') continue;
    if (entry.timestamp < start) { openPrice = entry.price; continue; }
    if (entry.timestamp > end) break;
    moves.push(entry);
  }
  if (moves.length === 0 || !(openPrice > 0)) return null;

  // Each move is measured against the price right before it, so the two causes
  // compound the same way the prices actually did.
  let directFactor = 1;
  let trailingFactor = 1;
  let from = openPrice;
  // Which stocks dragged this one. A knock-on move carries no record of what
  // caused it, but every stock the same cascade touched shares one timestamp
  // with the adjustment that started it, so the root is recoverable.
  const drivers = new Set();
  for (const entry of moves) {
    // A collapsed point is the review's whole move rolled into one, so the
    // detail it was built from is gone and the split cannot be recovered here.
    // Bailing out hands the stock to the stored server copy, which was written
    // before the collapse and still carries the breakdown.
    if (entry.collapsed) return null;
    if (from > 0) {
      if (entry.source === 'admin_adjust') directFactor *= entry.price / from;
      else if (entry.source === 'trailing') {
        trailingFactor *= entry.price / from;
        const root = rootByTimestamp?.get(entry.timestamp);
        if (root) drivers.add(root);
      }
      // Anything else (the 20:56 opening auction) counts toward the total only.
    }
    from = entry.price;
  }
  if (directFactor === 1 && trailingFactor === 1) return null;

  // The total is the two halves compounded, NOT open-to-close. Something other
  // than the review can move a price inside the window — 50 untagged points
  // turned up in the 2026-08-20 halt with no trade behind them — and letting
  // that leak into the headline made it disagree with its own breakdown.
  // This reports what the REVIEW did, which is the question the tab answers.
  const reviewFactor = directFactor * trailingFactor;
  return {
    oldPrice: openPrice,
    newPrice: Math.round(openPrice * reviewFactor * 100) / 100,
    percentChange: (reviewFactor - 1) * 100,
    directChange: (directFactor - 1) * 100,
    trailingChange: (trailingFactor - 1) * 100,
    drivers: [...drivers],
  };
};

/**
 * Timestamp -> the ticker whose hand adjustment started that cascade.
 *
 * Every stock a single adjustment drags is written with the adjustment's own
 * timestamp, so the shared timestamp is the link back to the cause. Recovering
 * it this way means old price history attributes correctly too, with nothing
 * extra stored.
 */
export const rootAdjustmentsByTimestamp = (priceHistory, start, end) => {
  const roots = new Map();
  for (const [ticker, history] of Object.entries(priceHistory || {})) {
    if (!Array.isArray(history)) continue;
    for (const entry of history) {
      if (!entry || entry.source !== 'admin_adjust') continue;
      if (entry.timestamp < start || entry.timestamp > end) continue;
      roots.set(entry.timestamp, ticker);
    }
  }
  return roots;
};

/**
 * Every stock the most recent chapter review moved, keyed by ticker.
 * Returns Map: ticker -> { oldPrice, newPrice, percentChange, directChange, trailingChange }
 *
 * A stock only shows up if it still has a price point from before the review
 * started. That is deliberate: without it there is nothing to measure against,
 * and it doubles as a completeness check, because the live history is trimmed
 * from the oldest end. If the pre-review point survived, so did everything
 * after it.
 */
export const getReviewChanges = (priceHistory, characters) => {
  const { start, end, reviewEnd } = getMostRecentHaltWindow();

  // Hide if the review is older than a week
  if (Date.now() - end > REVIEW_MAX_AGE_MS) return {};

  const roots = rootAdjustmentsByTimestamp(priceHistory, start, reviewEnd);
  const changes = {};
  for (const char of characters) {
    const change = computeReviewChange((priceHistory || {})[char.ticker], start, reviewEnd, null, roots);
    if (change) changes[char.ticker] = change;
  }
  return changes;
};

/**
 * Combine the stored review changes (market/reviewChanges) with the ones derived
 * locally from price history.
 *
 * A local entry only exists when this browser holds the stock's price from
 * before the review, which means it also holds every move since — so it is both
 * complete and fresher than the stored copy, which is only rewritten when the
 * admin makes an adjustment. It therefore wins outright. The stored copy fills
 * in the stocks whose pre-review price has already been trimmed out of the live
 * history, which is most of the actively traded ones within a day.
 */
export const mergeReviewChanges = (derived, stored) => ({
  ...(stored || {}),
  ...(derived || {}),
});

/**
 * Group the Review tab into sections.
 *
 * Four different questions get mixed together otherwise:
 *   what the admin actually decided, which is what people come for;
 *   what the funds did, which is mechanical, not a decision about the fund;
 *   who got dragged BY A FUND, the biggest and least obvious group, since one
 *     fund adjustment moves every character in it at once;
 *   who got dragged by another character.
 *
 * The last two used to be invisible entirely, which is how a stock could climb
 * during a halt with nothing on screen explaining it.
 *
 * Attribution comes from `drivers` on the change. An entry with no drivers (old
 * stored data) falls into the plain trailer group rather than guessing.
 *
 * Empty sections are dropped, so a review with no knock-on looks exactly like
 * the old flat list.
 */
export const buildReviewSections = (characters, changes = {}) => {
  const moved = (n) => typeof n === 'number' && Math.abs(n) >= 0.01;
  // Moved because a fund THIS character belongs to moved. Membership matters:
  // a fund adjustment also ripples on through its members into stocks outside
  // the fund, and calling those fund trailers would be wrong. $KTAE is not in
  // the Fist Gang fund, it only caught a second-order push through $GAP.
  const movedWithItsFund = (ticker, drivers = []) => drivers.some((driver) => {
    const fund = CHARACTER_MAP[driver];
    return fund?.isETF === true && (fund.constituents || []).includes(ticker);
  });

  const adjusted = [];
  const funds = [];
  const fundTrailers = [];
  const dragged = [];

  for (const character of characters) {
    const change = changes[character.ticker];
    if (!change) continue;
    // Entries stored before the split existed were admin-adjusted by
    // definition, since nothing else used to make the list at all.
    const hasSplit = typeof change.directChange === 'number';

    if (character.isETF) funds.push(character);
    else if (!hasSplit || moved(change.directChange)) adjusted.push(character);
    else if (movedWithItsFund(character.ticker, change.drivers)) fundTrailers.push(character);
    else dragged.push(character);
  }

  // `short` is the label on the section picker, `title` the heading above the cards.
  return [
    {
      id: 'adjusted',
      short: 'Adjusted',
      title: 'Adjusted This Chapter',
      blurb: 'Prices set by hand in the chapter review.',
      characters: adjusted,
    },
    {
      id: 'funds',
      short: 'Funds',
      title: 'Fund Movers',
      blurb: 'Funds that moved with the characters they hold.',
      characters: funds,
    },
    {
      id: 'fundTrailers',
      short: 'Fund Trailers',
      title: 'Fund Trailers',
      blurb: 'Not adjusted. These moved because a fund they belong to moved.',
      characters: fundTrailers,
    },
    {
      id: 'dragged',
      short: 'Trailers',
      title: 'Trailers',
      blurb: 'Not adjusted. These moved because a character they follow was.',
      characters: dragged,
    },
  ].filter((section) => section.characters.length > 0);
};

/**
 * Put a collapsed review's real steps back into a price history, for display.
 *
 * The chart normally shows one point per stock for a chapter review, because the
 * step-by-step detail reads as trading through the halt. The detail is never
 * thrown away though — it moves to market/reviewDetail — so an admin can ask for
 * the honest version back. Returns the history unchanged when there is no
 * stashed detail for the stock.
 */
export const spliceReviewDetail = (history, detailPoints) => {
  if (!Array.isArray(detailPoints) || detailPoints.length === 0) return history;
  const withoutPlaceholder = (history || []).filter((p) => !p?.collapsed);
  return [...withoutPlaceholder, ...detailPoints].sort((a, b) => a.timestamp - b.timestamp);
};

/**
 * Next weekly market open (Thursday 21:00 UTC).
 * If it's Thursday before 21:00 UTC, that's today; otherwise the coming Thursday.
 */
export const getNextMarketOpen = () => {
  const next = new Date();
  next.setUTCHours(21, 0, 0, 0);
  while (next.getUTCDay() !== 4 || next.getTime() <= Date.now()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
};

export const HALT_END_MINUTE = 1260; // 21:00 UTC
export const PRE_MARKET_START_MINUTE = 1230; // 20:30 UTC
export const PRE_MARKET_LOCK_MINUTE = 1255; // 20:55 UTC
export const GRACE_PERIOD_MINUTES = 30;

export const isPreMarketWindow = () => {
  const now = new Date();
  if (now.getUTCDay() !== 4) return false;
  const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  return utcMins >= PRE_MARKET_START_MINUTE && utcMins < HALT_END_MINUTE;
};

// Final 5 minutes before open — orders are committed, no cancellations allowed
export const isPreMarketLockout = () => {
  const now = new Date();
  if (now.getUTCDay() !== 4) return false;
  const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  return utcMins >= PRE_MARKET_LOCK_MINUTE && utcMins < HALT_END_MINUTE;
};

/**
 * Phase of the Thursday halt, for banner messaging.
 * Returns null outside the weekly halt, otherwise { phase, msToNext } where
 * phase is 'closed' (13:00-20:30, counting to the pre-market queue opening),
 * 'queue' (20:30-20:55, counting to the order lock), or 'locked' (20:55-21:00,
 * counting to the market open).
 */
export const getWeeklyHaltPhase = () => {
  if (!isWeeklyHalt()) return null;
  const now = new Date();
  const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const target = new Date(now);
  if (utcMins < PRE_MARKET_START_MINUTE) {
    target.setUTCHours(20, 30, 0, 0);
    return { phase: 'closed', msToNext: Math.max(0, target.getTime() - now.getTime()) };
  }
  if (utcMins < PRE_MARKET_LOCK_MINUTE) {
    target.setUTCHours(20, 55, 0, 0);
    return { phase: 'queue', msToNext: Math.max(0, target.getTime() - now.getTime()) };
  }
  target.setUTCHours(21, 0, 0, 0);
  return { phase: 'locked', msToNext: Math.max(0, target.getTime() - now.getTime()) };
};

export const getPreMarketTimeRemaining = () => {
  const now = new Date();
  const open = new Date(now);
  open.setUTCHours(21, 0, 0, 0);
  return Math.max(0, open.getTime() - now.getTime());
};

export const isMarketOpenGracePeriod = () => {
  const now = new Date();
  if (now.getUTCDay() !== 4) return false;
  const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  return utcMins >= HALT_END_MINUTE && utcMins < HALT_END_MINUTE + GRACE_PERIOD_MINUTES;
};

/**
 * Market-wide trade availability for button labels.
 * Per-ticker circuit-breaker halts (haltInfo) are handled separately by callers
 * and take priority over this market-wide state.
 * Returns { closed, preMarket, label }.
 */
export const getMarketClosedState = (marketData) => {
  if (marketData?.marketHalted) return { closed: true, preMarket: false, label: 'MARKET CLOSED' };
  if (isPreMarketWindow()) return { closed: false, preMarket: true, label: 'Pre-Market Queue' };
  // Weekly halt: say when orders can go in again, not just that it's closed
  if (isWeeklyHalt()) return { closed: true, preMarket: false, label: 'Closed · Pre-market 20:30 UTC' };
  return { closed: false, preMarket: false, label: 'Trade' };
};

export const formatCountdown = (ms) => {
  if (ms <= 0) return '0m';
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
};
