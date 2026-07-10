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

/**
 * Given priceHistory map and characters list, detect which tickers changed
 * during the most recent Thursday halt window.
 * Returns Map: ticker -> { oldPrice, newPrice, percentChange }
 */
export const getReviewChanges = (priceHistory, characters) => {
  const { start, end } = getMostRecentHaltWindow();
  const now = Date.now();

  // Hide if the review is older than 7 days
  if (now - end > 7 * 24 * 60 * 60 * 1000) return {};

  const changes = {};

  for (const char of characters) {
    const history = priceHistory[char.ticker];
    if (!history || history.length === 0) continue;

    // Only show stocks the admin manually adjusted — not trailers or automatic movements
    const hasAdminAdjust = history.some(
      e => e.source === 'admin_adjust' && e.timestamp >= start && e.timestamp <= end
    );
    if (!hasAdminAdjust) continue;

    // Find price just before halt started (last entry before start)
    let preBefore = null;
    // Find price at end of halt (last entry at or before end)
    let postAfter = null;

    for (const entry of history) {
      if (entry.timestamp < start) preBefore = entry.price;
      if (entry.timestamp <= end) postAfter = entry.price;
    }

    if (preBefore == null || postAfter == null) continue;
    if (preBefore === postAfter) continue;

    const pctChange = ((postAfter - preBefore) / preBefore) * 100;
    changes[char.ticker] = {
      oldPrice: preBefore,
      newPrice: postAfter,
      percentChange: pctChange
    };
  }

  return changes;
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
