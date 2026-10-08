'use strict';
// Price impact math and the anti-abuse gates around it (wash rule, breaker, daily caps).

const { splitFactorOf } = require('./characters');
const {
  BASE_IMPACT,
  BASE_LIQUIDITY,
  MAX_TRADE_SHARES,
  MAX_PRICE_CHANGE_PERCENT,
  TWENTY_FOUR_HOURS_MS,
  WASH_RULE_COOLDOWN_MS,
  SHORT_AFTER_DUMP_COOLDOWN_MS,
  NEW_ACCOUNT_IMPACT_PERIOD_DAYS,
  NEW_ACCOUNT_MIN_IMPACT_FACTOR,
  OVERSIZED_IMPACT_MULTIPLE,
  CIRCUIT_BREAKER_MOVE,
  CIRCUIT_BREAKER_WINDOW_MS,
  CIRCUIT_BREAKER_PAUSE_MS,
  CIRCUIT_BREAKER_MAX_PER_DAY,
} = require('./constants');
const { dayIdOf } = require('./marketData');

/**
 * What moving this many shares actually costs, before any cap.
 *
 * Split out from calculateMarginalImpact because the market and the trader are
 * now told two different numbers. The MARKET move stays capped at
 * MAX_PRICE_CHANGE_PERCENT so one order can never crater a stock; the TRADER
 * pays this, bounded by OVERSIZED_IMPACT_MULTIPLE.
 *
 * Without the split, the cap was a volume discount on the most disruptive
 * action in the game. Impact accumulates across a player's trades in the 24h
 * window, so easing 4,125 shares out in three pieces costs about 7.7% — while
 * dumping all 4,125 at once costs 5%, because the per-trade cap truncates it.
 * Selling everything in one go was the cheapest way to do it.
 */
const rawMarginalImpact = (currentPrice, newShares, cumulativeSharesBefore, liquidity = BASE_LIQUIDITY) =>
  currentPrice *
  BASE_IMPACT *
  (Math.sqrt((cumulativeSharesBefore + newShares) / liquidity) - Math.sqrt(cumulativeSharesBefore / liquidity));

// What the MARKET moves: the raw cost, capped so a single order can't crater a
// stock. This is what goes on the chart and what the daily allowance counts.
const calculateMarginalImpact = (currentPrice, newShares, cumulativeSharesBefore, liquidity = BASE_LIQUIDITY) =>
  Math.min(
    rawMarginalImpact(currentPrice, newShares, cumulativeSharesBefore, liquidity),
    currentPrice * MAX_PRICE_CHANGE_PERCENT,
  );

// What the TRADER pays: the raw cost, bounded well above the market cap so an
// oversized order stops being free but can never be charged without limit.
const traderMarginalImpact = (currentPrice, newShares, cumulativeSharesBefore, liquidity = BASE_LIQUIDITY) =>
  Math.min(
    rawMarginalImpact(currentPrice, newShares, cumulativeSharesBefore, liquidity),
    currentPrice * MAX_PRICE_CHANGE_PERCENT * OVERSIZED_IMPACT_MULTIPLE,
  );

/**
 * A stock's liquidity: how many shares it takes to move it. BASE_LIQUIDITY,
 * times the stock's splitFactor if it has been split (see characters.js), so
 * the same dollar trade moves a split stock by the same percent as before the
 * split. Mirror of liquidityFor in src/utils/calculations.js.
 */
const liquidityFor = (ticker) => BASE_LIQUIDITY * splitFactorOf(ticker);

/**
 * The largest single order on a stock: MAX_TRADE_SHARES, times its splitFactor,
 * so a split never changes how many orders it takes to trade a position.
 * Mirror of maxTradeSharesFor in src/utils/calculations.js.
 */
const maxTradeSharesFor = (ticker) => MAX_TRADE_SHARES * splitFactorOf(ticker);

/**
 * Has this player's own downward pressure on this ticker armed the wash rule?
 *
 * `lastHeavySell[ticker]` is stamped by the sell or short that took their 24h
 * down-impact past WASH_RULE_IMPACT_TRIGGER (see tradeState). While it is armed
 * they cannot BUY that ticker back — covering is an exit and is never blocked.
 *
 * One definition because there are three lanes that have to agree on it:
 * executeTrade, the limit-order sweep, and the pre-market auction.
 *
 * @returns {number} ms remaining on the cooldown, or 0 when not armed
 */
const washRuleRemainingMs = (userData, ticker, now = Date.now()) => {
  const armed = userData?.lastHeavySell?.[ticker];
  const armedMs = armed && (armed.toMillis ? armed.toMillis() : armed);
  if (!armedMs) return 0;
  return Math.max(0, WASH_RULE_COOLDOWN_MS - (now - armedMs));
};

/**
 * Has this player just dumped this ticker, so they can't short it yet?
 *
 * `lastHeavyExit[ticker]` is stamped only by a SELL that took their 24h
 * down-impact past WASH_RULE_IMPACT_TRIGGER (see tradeState), or by the
 * coordination scan for everyone in a tight downward cluster. Selling hard and
 * then shorting the crash you caused was the second half of the $SHNG raid.
 * Covering is never blocked.
 *
 * @returns {number} ms remaining, or 0 when not armed
 */
const shortAfterDumpRemainingMs = (userData, ticker, now = Date.now()) => {
  const armed = userData?.lastHeavyExit?.[ticker];
  const armedMs = armed && (armed.toMillis ? armed.toMillis() : armed);
  if (!armedMs) return 0;
  return Math.max(0, SHORT_AFTER_DUMP_COOLDOWN_MS - (now - armedMs));
};

/**
 * Is this ticker paused by a circuit breaker right now?
 *
 * A pause is only worth having if EVERYTHING that can move a price honours it.
 * The breaker was wired into the player trade path, the limit-order sweep and
 * the dust sweep, but not into the bots, the market maker or the forced-cover
 * scanner — so the three automated movers carried on trading a stock that had
 * just been closed to every human, which is most of the point of closing it.
 *
 * @param {Object} haltedTickers - marketData.haltedTickers
 * @param {string} ticker
 * @param {number} now
 * @returns {boolean}
 */
const isTickerPaused = (haltedTickers, ticker, now = Date.now()) => {
  const halt = (haltedTickers || {})[ticker];
  return !!(halt && halt.resumeAt && now < halt.resumeAt);
};

// Anti-manipulation: brand-new accounts move the market less, ramping from
// NEW_ACCOUNT_MIN_IMPACT_FACTOR at day 0 up to full (1.0) at the end of the
// ramp window. Mirrors getAccountAgeImpactFactor in src/utils/calculations.ts — keep in sync.
const getAccountAgeImpactFactor = (userData) => {
  if (!userData || !userData.createdAt) return 1;
  const createdAt = userData.createdAt;
  const createdMs =
    typeof createdAt.toMillis === 'function'
      ? createdAt.toMillis()
      : typeof createdAt === 'number'
        ? createdAt
        : Date.parse(createdAt);
  if (!createdMs || isNaN(createdMs)) return 1;
  const ageDays = (Date.now() - createdMs) / TWENTY_FOUR_HOURS_MS;
  if (ageDays >= NEW_ACCOUNT_IMPACT_PERIOD_DAYS) return 1;
  return (
    NEW_ACCOUNT_MIN_IMPACT_FACTOR + (1 - NEW_ACCOUNT_MIN_IMPACT_FACTOR) * (ageDays / NEW_ACCOUNT_IMPACT_PERIOD_DAYS)
  );
};

// Account age in days, or null when the account has no usable createdAt.
// Tolerates the three shapes createdAt turns up in: Firestore Timestamp on live
// docs, a raw number on some older ones, an ISO string from imports.
const getAccountAgeDays = (userData) => {
  if (!userData || !userData.createdAt) return null;
  const createdAt = userData.createdAt;
  const createdMs =
    typeof createdAt.toMillis === 'function'
      ? createdAt.toMillis()
      : typeof createdAt === 'number'
        ? createdAt
        : Date.parse(createdAt);
  if (!createdMs || isNaN(createdMs)) return null;
  return (Date.now() - createdMs) / TWENTY_FOUR_HOURS_MS;
};

// Prune entries older than 24h, return summary
const pruneAndSumTradeHistory = (entries, now) => {
  const cutoff = now - TWENTY_FOUR_HOURS_MS;
  const recent = (entries || []).filter((e) => e.ts > cutoff);
  const totalShares = recent.reduce((sum, e) => sum + (e.shares || 0), 0);
  const totalImpact = recent.reduce((sum, e) => sum + (e.impact || 0), 0);
  // count = real trades only. Synthetic ETF trailing entries (shares: 0) feed the
  // impact cap but must NOT count toward the 10-trades-per-ticker cap.
  const realCount = recent.reduce((n, e) => n + ((e.shares || 0) > 0 ? 1 : 0), 0);
  return { recent, totalShares, totalImpact, count: realCount };
};

/**
 * Should this price move pause the ticker?
 *
 * The per-user daily allowance caps how far ONE trader can push a stock. It
 * says nothing about how far a stock can travel when several traders push it in
 * turn, which is what happened to $SHNG on 2026-09-17: six accounts, each
 * inside every limit, took it down 23% in 21 minutes. This is the one rule that
 * looks at the stock instead of the trader.
 *
 * Measured against the last price BEFORE the window opened, so everything that
 * happened inside the window counts, including trailing moves from other
 * tickers. A stock with no history older than the window is too new to judge.
 *
 * Returns a halt record for `haltedTickers[ticker]`, or null. The breaching
 * trade itself is NOT blocked — it has already been priced by the time this
 * runs, and stopping it mid-transaction would leave the price where the cascade
 * put it with no record of why. Real venues let the breaching print stand and
 * pause what comes after; so does this.
 *
 * @returns {{haltedAt:number,resumeAt:number,reason:string,movePercent:number}|null}
 */
const evaluateCircuitBreaker = ({ priceHistory, ticker, newPrice, breakerCounts, now = Date.now() }) => {
  if (!(newPrice > 0)) return null;

  const history = (priceHistory && priceHistory[ticker]) || [];
  if (!history.length) return null;

  const windowStart = now - CIRCUIT_BREAKER_WINDOW_MS;

  // An admin adjustment (or the chapter review's knock-on moves) inside the
  // window is not a cascade, and halting on one would be automation overriding
  // a deliberate decision. Leave those alone entirely.
  for (const point of history) {
    if (point.timestamp >= windowStart && (point.source === 'admin_adjust' || point.source === 'review')) return null;
  }

  // Last price before the window opened. Scanning backwards because history is
  // appended in order and the recent end is the short end.
  let reference = null;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].timestamp < windowStart) {
      reference = history[i].price;
      break;
    }
  }
  if (!(reference > 0)) return null; // nothing older than the window yet

  const move = (newPrice - reference) / reference;
  if (Math.abs(move) < CIRCUIT_BREAKER_MOVE) return null;

  // Daily cap, so a pause can't be used as a repeatable weapon.
  const today = dayIdOf(now);
  const count = breakerCounts && breakerCounts[ticker];
  if (count && count.day === today && (count.n || 0) >= CIRCUIT_BREAKER_MAX_PER_DAY) return null;

  const pct = Math.abs(move) * 100;
  return {
    haltedAt: now,
    resumeAt: now + CIRCUIT_BREAKER_PAUSE_MS,
    movePercent: Math.round(move * 10000) / 100,
    reason:
      move < 0
        ? `Price fell ${pct.toFixed(1)}% in under ${Math.round(CIRCUIT_BREAKER_WINDOW_MS / 60000)} minutes.`
        : `Price rose ${pct.toFixed(1)}% in under ${Math.round(CIRCUIT_BREAKER_WINDOW_MS / 60000)} minutes.`,
  };
};

// The bump to `breakerCounts[ticker]` that goes with a fired breaker. Kept
// beside it so the counter can never drift from the halt it is counting.
const breakerCountUpdate = (breakerCounts, ticker, now = Date.now()) => {
  const today = dayIdOf(now);
  const prev = breakerCounts && breakerCounts[ticker];
  const n = prev && prev.day === today ? (prev.n || 0) + 1 : 1;
  return { day: today, n };
};

// Which way an action pushes the price. Sells and shorts push down, buys and
// covers push up. Matches the trailing-entry mapping in tradePricing.js.
const IMPACT_DIRECTIONS = { sell: 'down', short: 'down', buy: 'up', cover: 'up' };
const impactDirectionOf = (action) => IMPACT_DIRECTIONS[action] || 'up';

// The rolling-24h impact a user (or an IP) has already spent on one ticker,
// split by direction.
//
// The two allowances are deliberately separate. While they were one shared
// pool, spending it in one direction silently disarmed the other: a player
// could short a stock down the full 10%, then cover the whole position in the
// same day through the exit clamp, which floors the impact at zero once the
// pool is empty. The market heard the selling and never heard the buying, so a
// round trip that should be a wash left a permanent one-way dent. The same hole
// ran in reverse for buy-then-sell. Per-direction allowances mean an exit
// always pushes back as hard as the entry pushed.
const sumDirectionalImpact = (actionsForTicker, now) => {
  const totals = { down: 0, up: 0 };
  for (const action of Object.keys(IMPACT_DIRECTIONS)) {
    const { totalImpact } = pruneAndSumTradeHistory((actionsForTicker || {})[action] || [], now);
    totals[impactDirectionOf(action)] += totalImpact;
  }
  return totals;
};

// What one action may still move a ticker's price, as a fraction, given the
// history already spent by this user and by their IP. Whichever is further
// along wins, so alts on one connection share an allowance.
const remainingImpactFor = ({ action, userActions, ipActions, now, cap }) => {
  const direction = impactDirectionOf(action);
  const spent = Math.max(
    sumDirectionalImpact(userActions, now)[direction],
    sumDirectionalImpact(ipActions, now)[direction],
  );
  return Math.max(0, cap - spent);
};

module.exports = {
  rawMarginalImpact,
  calculateMarginalImpact,
  traderMarginalImpact,
  liquidityFor,
  maxTradeSharesFor,
  washRuleRemainingMs,
  shortAfterDumpRemainingMs,
  isTickerPaused,
  getAccountAgeImpactFactor,
  getAccountAgeDays,
  pruneAndSumTradeHistory,
  evaluateCircuitBreaker,
  breakerCountUpdate,
  impactDirectionOf,
  sumDirectionalImpact,
  remainingImpactFor,
};
