/**
 * Weekly trading halt utility
 * Every Thursday 13:00–21:00 UTC (chapter review window)
 */

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

  return { start: start.getTime(), end: end.getTime() };
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
export const computeReviewChange = (history, start, end, fallbackOpen = null) => {
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
  for (const entry of moves) {
    if (from > 0) {
      if (entry.source === 'admin_adjust') directFactor *= entry.price / from;
      else if (entry.source === 'trailing') trailingFactor *= entry.price / from;
      // Anything else (the 20:56 opening auction) counts toward the total only.
    }
    from = entry.price;
  }
  if (directFactor === 1 && trailingFactor === 1) return null;

  const newPrice = moves[moves.length - 1].price;
  return {
    oldPrice: openPrice,
    newPrice,
    percentChange: ((newPrice - openPrice) / openPrice) * 100,
    directChange: (directFactor - 1) * 100,
    trailingChange: (trailingFactor - 1) * 100,
  };
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
  const { start, end } = getMostRecentHaltWindow();

  // Hide if the review is older than a week
  if (Date.now() - end > REVIEW_MAX_AGE_MS) return {};

  const changes = {};
  for (const char of characters) {
    const change = computeReviewChange((priceHistory || {})[char.ticker], start, end);
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
