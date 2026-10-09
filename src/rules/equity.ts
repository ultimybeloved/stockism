// What an account is worth, and how much of it is invested. Shared rule module
// (see src/rules/ladder.ts for what that means): the season page's live
// estimate and the betting/ladder caps the site shows are computed by the same
// code the server scores and enforces with.

import { MIN_PRICE, calculateMarginalImpact, liquidityFor } from './impact';
import { round2 } from './money';

type Prices = Record<string, number | undefined> | null | undefined;

/** An open short, as stored on the user doc. */
export interface ShortFields {
  shares: number;
  margin?: number;
  costBasis?: number;
  system?: string;
}

/** The user-doc fields these read. */
export interface EquityFields {
  cash?: number;
  marginUsed?: number;
  holdings?: Record<string, number>;
  costBasis?: Record<string, number>;
  shorts?: Record<string, ShortFields | null | undefined> | null;
  [field: string]: unknown;
}

/**
 * What open shorts are worth at `prices`. v2 shorts (the default) hold their
 * margin plus the unrealized P&L; legacy shorts hold margin less the cost to
 * buy the shares back.
 */
export const shortsEquity = (shorts: EquityFields['shorts'], prices: Prices) =>
  Object.entries(shorts || {}).reduce((sum, [ticker, pos]) => {
    if (!pos || !(pos.shares > 0)) return sum;
    const price = prices?.[ticker] || 0;
    return (
      sum +
      ((pos.system || 'v2') === 'v2'
        ? (pos.margin || 0) + ((pos.costBasis || 0) - price) * pos.shares
        : (pos.margin || 0) - price * pos.shares)
    );
  }, 0);

/**
 * What an account would actually walk away with at `prices`: every holding sold
 * and every short covered, one order each, at the price that order pushes the
 * stock to. The same impact math a real sell or cover uses. Less any margin loan.
 *
 * Seasons score on this, not the last-trade value. Marked at the last trade, a
 * player (or a friend) buying a thin stock just before a checkpoint shows a
 * paper gain they could never cash out, because selling would push the price
 * straight back down. Here that gain and the exit cost cancel. Spread is left
 * out: it's the same share at the baseline and at every checkpoint, so it can't
 * move a return.
 */
export const exitEquityAt = (userData: EquityFields | null | undefined, prices: Prices) => {
  if (!userData) return 0;
  const holdingsValue = Object.entries(userData.holdings || {}).reduce((sum, [ticker, shares]) => {
    const price = prices?.[ticker] || 0;
    if (!(shares > 0) || !(price > 0)) return sum;
    return sum + Math.max(MIN_PRICE, price - calculateMarginalImpact(price, shares, 0, liquidityFor(ticker))) * shares;
  }, 0);
  // Covering buys the shares back, so the price it's measured at is pushed up.
  const coverPrices: Record<string, number> = {};
  for (const [ticker, pos] of Object.entries(userData.shorts || {})) {
    const price = prices?.[ticker] || 0;
    if (pos && pos.shares > 0)
      coverPrices[ticker] = price + calculateMarginalImpact(price, pos.shares, 0, liquidityFor(ticker));
  }
  return round2(
    (userData.cash || 0) + holdingsValue + shortsEquity(userData.shorts, coverPrices) - (userData.marginUsed || 0),
  );
};

/**
 * Total a player has "invested" in stocks: cost basis of holdings plus the
 * collateral posted on open shorts. Caps prediction bets, event-market buys and
 * ladder deposits, so a fresh account can't gamble its signup cash.
 */
export const getTotalInvested = (userData: EquityFields | null | undefined) => {
  if (!userData) return 0;
  const costBasis = userData.costBasis || {};
  const holdingsValue = Object.entries(userData.holdings || {}).reduce(
    (sum, [ticker, shares]) => sum + (costBasis[ticker] || 0) * (shares || 0),
    0,
  );
  const shortMargin = Object.values(userData.shorts || {}).reduce(
    (sum, s) => sum + (s && s.shares > 0 ? s.margin || 0 : 0),
    0,
  );
  return holdingsValue + shortMargin;
};
