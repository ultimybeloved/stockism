'use strict';
// The arithmetic behind coordReview.js: what one flagged push made a player,
// and where their account would stand if it were taken back. Pure functions.
//
// INTERNAL MODULE — required by coordReview.js, never listed in servicePaths.js.
const { COORD_PROFIT_WINDOW_MS } = require('../constants');
const { round2 } = require('../helpers');

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Flagged pushes on each stock, merged where their windows overlap. */
const pushWindows = (alerts) => {
  const byTicker = new Map();
  for (const a of alerts) {
    const start = a.startedAt || Date.parse(`${a.day}T00:00:00Z`);
    if (!a.ticker || !start) continue;
    if (!byTicker.has(a.ticker)) byTicker.set(a.ticker, []);
    byTicker.get(a.ticker).push({ start, end: start + COORD_PROFIT_WINDOW_MS, days: [a.day] });
  }
  const out = [];
  for (const [ticker, list] of byTicker) {
    list.sort((x, y) => x.start - y.start);
    let cur = null;
    for (const w of list) {
      if (cur && w.start <= cur.end) { cur.end = Math.max(cur.end, w.end); cur.days.push(...w.days); continue; }
      if (cur) out.push(cur);
      cur = { ticker, ...w };
    }
    if (cur) out.push(cur);
  }
  return out;
};

/** Profit from one window of one player's trades on one stock. Pure. */
const windowProfit = (trades, { start, end }, priceNow) => {
  const inside = trades.filter((t) => t.ts >= start && t.ts <= end);
  const sum = (action) => inside.filter((t) => t.action === action)
    .reduce((acc, t) => ({ sh: acc.sh + t.shares, v: acc.v + t.value }), { sh: 0, v: 0 });
  const buy = sum('buy'); const sell = sum('sell'); const short = sum('short'); const cover = sum('cover');

  // Covers beyond what was shorted in the window close an older short.
  let excess = cover.sh - short.sh;
  if (excess > 0) {
    const earlier = trades.filter((t) => t.action === 'short' && t.ts < start && t.ts >= start - WEEK_MS)
      .sort((a, b) => b.ts - a.ts);
    for (const t of earlier) {
      if (excess <= 0) break;
      const take = Math.min(excess, t.shares);
      short.sh += take; short.v += t.value * (take / t.shares); excess -= take;
    }
  }

  const avg = (x) => (x.sh > 0 ? x.v / x.sh : 0);
  const longMatched = Math.min(buy.sh, sell.sh);
  const shortMatched = Math.min(short.sh, cover.sh);
  const lockedIn = longMatched * (avg(sell) - avg(buy)) + shortMatched * (avg(short) - avg(cover));

  const addedLong = buy.sh - sell.sh;
  const openShort = short.sh - cover.sh;
  const gainSince = (addedLong > 0 ? addedLong * (priceNow - avg(buy)) : 0)
    + (openShort > 0 ? openShort * (avg(short) - priceNow) : 0);

  return { trades: inside.length, lockedIn: round2(lockedIn), gainSince: round2(gainSince) };
};

/** Where the account would stand after removing `amount`. */
const afterRemoval = (u, amount) => {
  const cash = u.cash || 0;
  const fromCash = Math.min(Math.max(0, cash), amount);
  const toDebt = amount - fromCash;
  const gross = Math.max(0, (u.portfolioValue || 0) - fromCash);
  const owed = (u.marginUsed || 0) + toDebt;
  const ratio = gross > 0 ? (gross - owed) / gross : 0;
  return { fromCash: round2(fromCash), toDebt: round2(toDebt), owedAfter: round2(owed), equityRatioAfter: Math.round(ratio * 1000) / 1000 };
};

module.exports = { pushWindows, windowProfit, afterRemoval, WEEK_MS };
