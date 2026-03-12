/**
 * Weekly trading halt utility
 * Every Thursday 14:00–21:00 UTC (chapter review window)
 */

export const isWeeklyHalt = () => {
  const now = new Date();
  if (now.getUTCDay() !== 4) return false; // Thursday = 4
  const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  return utcMins >= 840 && utcMins < 1260; // 14:00 (840) to 21:00 (1260)
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
  if (day === 4 && utcMins < 840) {
    const today = new Date(now);
    today.setUTCHours(14, 0, 0, 0);
    return today;
  }
  const daysUntil = (4 - day + 7) % 7 || 7;
  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + daysUntil);
  next.setUTCHours(14, 0, 0, 0);
  return next;
};

/**
 * Get the most recent Thursday halt window (14:00-21:00 UTC).
 * Returns { start, end } as epoch timestamps.
 * If currently in the halt window, returns the current one.
 */
export const getMostRecentHaltWindow = () => {
  const now = new Date();
  const day = now.getUTCDay();
  const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();

  // Start from today and walk backwards to find the most recent Thursday
  const d = new Date(now);

  if (day === 4 && utcMins < 1260) {
    // It's Thursday and before halt ends — use today
  } else {
    // Walk back to last Thursday
    const daysBack = (day - 4 + 7) % 7 || 7;
    d.setUTCDate(d.getUTCDate() - daysBack);
  }

  const start = new Date(d);
  start.setUTCHours(14, 0, 0, 0);
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

    // Find price just before halt started (last entry before start)
    let preBefore = null;
    // Find price at end of halt (last entry at or before end)
    let postAfter = null;

    for (const entry of history) {
      if (entry.timestamp < start) {
        preBefore = entry.price;
      }
      if (entry.timestamp <= end) {
        postAfter = entry.price;
      }
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

export const formatCountdown = (ms) => {
  if (ms <= 0) return '0m';
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
};
