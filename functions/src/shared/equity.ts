// Net equity and granted (free) value, which percent boards subtract out.

import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { CHARACTER_MAP } from './characters';
import { TWENTY_FOUR_HOURS_MS, MIN_PRICE } from './constants';
import { round2 } from './money';
import { calculateMarginalImpact, liquidityFor } from './impact';
import type { GrantedSample, ShortPosition, UserData } from './types';

/** Current price per ticker. */
type Prices = Record<string, number | undefined> | null | undefined;
const db = admin.firestore();

// ── Granted value ────────────────────────────────────────────────────────────
// Value that lands in an account without being traded for: daily drops,
// check-ins, mission rewards, admin giveaways, bailouts, the Discord starting-
// cash unlock, and weekly dividends (a faucet paid at an admin-set rate that
// never moves a price, so it lifts holders without lifting the index).
// Measured 2026-08-13: the median player was +67% over 30 days while the
// median STOCK moved +0.8%, so on a percent leaderboard free money
// buries trading entirely. Every percent-return figure has to be net of this or
// it is ranking who collected the most, not who traded best.
//
// This changes NO player's money and no payout — only what the boards count.

/**
 * The field update that books a grant. Spread into whatever update object the
 * caller is already writing, so recording a grant never costs an extra write.
 * @param amount - dollar value granted (share grants pass shares * price)
 * @returns partial update, or {} when there is nothing to book
 */
export const grantedValueUpdate = (amount: unknown, now = Date.now()) => {
  const value = Number(amount);
  if (!value || !isFinite(value) || value <= 0) return {};
  const rounded = Math.round(value * 100) / 100;
  return { grantedValue: FieldValue.increment(rounded), ...grantedDaysUpdate(rounded, now) };
};

/**
 * When free money arrived, as a running sum of amount x day it landed. Seasons
 * use it to count grants that came in mid-season toward a player's capital only
 * for the time they have had them, the same way margin is averaged. Counting
 * them in full on arrival made collecting a mission LOWER a positive return.
 *
 * Grants only. Side-game flows (grantedFlowUpdate) stay out: a $17k prediction
 * payout that barely counted toward capital on day one turned a -7% start into
 * -31%, and a late payout traded up would inflate a return the same way.
 *
 * Days, not ms: amount x ms passes 2^53 after a few thousand dollars and loses
 * cents. Average held since pinning = (granted x nowDays - sum) / days elapsed.
 */
const grantedDaysUpdate = (signedAmount: number, now = Date.now()) => ({
  grantedDays: FieldValue.increment(signedAmount * (now / TWENTY_FOUR_HOURS_MS)),
});

/**
 * Same counter, but SIGNED — for money crossing the portfolio boundary into or
 * out of a side game rather than arriving free.
 *
 * portfolioValue is cash + holdings + shorts, so the ladder balance sits outside
 * it: depositing reads as a loss and withdrawing as a gain. Booking both
 * directions cancels the round trip, which takes ladder gambling out of season
 * and leaderboard returns entirely. A hot streak at the ladder is not trading,
 * and letting it decide a season would point players straight back at the
 * feature that keeps attracting alt accounts.
 *
 * Negative totals are fine and expected — someone with money parked in the
 * ladder is legitimately "owed" that back in the return calculation.
 * @param signedAmount - positive on the way in, negative on the way out
 */
export const grantedFlowUpdate = (signedAmount: unknown, counter = 'ladderFlowValue') => {
  const value = Number(signedAmount);
  if (!value || !isFinite(value)) return {};
  const rounded = Math.round(value * 100) / 100;
  return {
    grantedValue: FieldValue.increment(rounded),
    // Same number kept separately so the ladder's contribution can be added back
    // for the "what it would have been" stat. Without a second counter it is
    // impossible to tell ladder flows apart from genuine grants after the fact.
    [counter]: FieldValue.increment(rounded),
  };
};

/**
 * Prediction bets and payouts, both lanes (pool bets and long-term markets).
 * Booked like the ladder so a bet is neither a loss nor a payout a gain on any
 * percent board. They used to land as plain cash, so one all-in bet at long
 * odds read as a +1000% season. Own counter, so the ladder shadow stat stays
 * ladder-only.
 */
export const predictionFlowUpdate = (signedAmount: unknown) => grantedFlowUpdate(signedAmount, 'predictionFlowValue');

/**
 * Cumulative granted value as it stood at `ts`, from the daily samples
 * syncPortfolio keeps. Null when the player has no samples at all.
 *
 * When no sample is that old, the oldest one stands in. That reads high for the
 * start of a window, so grants inside the window come out too small, never too
 * big, and a return is never pushed below what the player actually earned.
 * Returning nothing in that case, as this used to, left 243 of 315 players on
 * the 2026-09-13 admin readout with no free money removed at all: samples are
 * only written when a player opens the app, so most had none from day one.
 */
export const grantedTotalAt = (userData: UserData | null | undefined, ts: number): number | null => {
  const samples = Array.isArray(userData?.grantedSamples) ? userData.grantedSamples : [];
  let atOrBefore: GrantedSample | null = null;
  let oldest: GrantedSample | null = null;
  for (const s of samples) {
    if (!s || typeof s.ts !== 'number') continue;
    if (s.ts <= ts && (!atOrBefore || s.ts > atOrBefore.ts)) atOrBefore = s;
    if (!oldest || s.ts < oldest.ts) oldest = s;
  }
  const sample = atOrBefore || oldest;
  return sample ? sample.total || 0 : null;
};

/**
 * Grants booked within the last `windowMs`. See grantedTotalAt for why a window
 * older than the samples still gets a (low) figure rather than zero.
 */
export const grantedSince = (userData: UserData, windowMs: number) => {
  const atStart = grantedTotalAt(userData, Date.now() - windowMs);
  if (atStart === null) return 0;
  // Signed on purpose: a ladder deposit books a negative flow, and clamping that
  // to zero would leave the deposit looking like a trading loss.
  return (userData.grantedValue || 0) - atStart;
};

/**
 * What an account is worth at `prices`: cash, holdings and open shorts, less any
 * margin loan.
 *
 * The stored portfolioValue can't stand in when players are compared at one
 * moment. It is only rewritten when the player opens the app, so it can be days
 * old, and it counts borrowed margin as value (the leaderboard's netEquity
 * subtracts marginUsed for the same reason).
 */
export const netEquityAt = (userData: UserData | null | undefined, prices: Prices) => {
  if (!userData) return 0;
  const holdingsValue = Object.entries(userData.holdings || {}).reduce(
    (sum, [ticker, shares]) => sum + (shares > 0 ? (prices?.[ticker] || 0) * shares : 0),
    0,
  );
  return round2(
    (userData.cash || 0) + holdingsValue + shortsEquity(userData.shorts, prices) - (userData.marginUsed || 0),
  );
};

/**
 * What an account would actually walk away with at `prices`: every holding sold
 * and every short covered, one order each, at the price that order pushes the
 * stock to. The same impact math a real sell or cover uses.
 *
 * Seasons score on this, not netEquityAt. Marked at the last trade, a player
 * (or a friend) buying a thin stock just before a checkpoint shows a paper gain
 * they could never cash out, because selling would push the price straight back
 * down. Here that gain and the exit cost cancel. Spread is left out: it's the
 * same share at the baseline and at every checkpoint, so it can't move a return.
 */
export const exitEquityAt = (userData: UserData | null | undefined, prices: Prices) => {
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
 * Percent return over a window, net of granted value. The single definition —
 * leaderboard, season standings and the admin readout all go through it so they
 * can't drift.
 * @param current - portfolio value now
 * @param baseline - portfolio value at the start of the window
 * @param granted - value granted during the window
 * @returns percent
 */
export const netReturnPercent = (
  current: number,
  baseline: number | null | undefined,
  granted: number | null | undefined,
) => {
  if (!baseline || baseline <= 0) return 0;
  return ((current - (granted || 0) - baseline) / baseline) * 100;
};

/**
 * What a user's open shorts are worth to their net worth right now: the
 * collateral they posted, plus the unrealised gain or loss on the position.
 *
 * v2 shorts post 100% collateral and the proceeds stay with the house, so the
 * position is worth margin + (entry - current) x shares. Legacy shorts were paid
 * their proceeds up front, so the current value of the borrowed shares is a
 * liability against the collateral instead.
 *
 * Shared by the short-sizing cap in tradeActions and the margin-lending scanner:
 * the scanner used to count only cash and holdings, so collateral locked in a
 * short was invisible and a player holding both margin debt and shorts looked
 * poorer than they were and could be liquidated early.
 */
export const shortsEquity = (
  shorts: Record<string, ShortPosition | null | undefined> | null | undefined,
  prices: Prices,
) =>
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
 * How much of an account rides on each character, for the season Diamond
 * concentration cap. Returns the biggest single character and the total.
 *
 * A short is a bet on a character as much as a holding is, so both count at
 * their market value. A crew ETF counts toward each member it tracks, split by
 * its trailing weights, so a character can't be split between its own stock and
 * its crew fund to slip under the cap.
 */
export const characterExposure = (userData: UserData | null | undefined, prices: Prices) => {
  const byCharacter: Record<string, number> = {};
  const add = (ticker: string, value: number) => {
    byCharacter[ticker] = (byCharacter[ticker] || 0) + value;
  };
  const spread = (ticker: string, value: number) => {
    const factors = CHARACTER_MAP[ticker]?.isETF ? CHARACTER_MAP[ticker].trailingFactors || [] : [];
    const weight = factors.reduce((s, f) => s + (f.coefficient || 0), 0);
    if (!(weight > 0)) {
      add(ticker, value);
      return;
    }
    for (const f of factors) add(f.ticker, (value * (f.coefficient || 0)) / weight);
  };
  for (const [ticker, shares] of Object.entries(userData?.holdings || {})) {
    if (shares > 0) spread(ticker, (prices?.[ticker] || 0) * shares);
  }
  for (const [ticker, pos] of Object.entries(userData?.shorts || {})) {
    if (pos && pos.shares > 0) spread(ticker, (prices?.[ticker] || 0) * pos.shares);
  }
  const values = Object.values(byCharacter);
  return {
    largest: values.length ? Math.max(...values) : 0,
    total: values.reduce((s, v) => s + v, 0),
  };
};

// Total a user has "invested" in stocks: cost basis of holdings + collateral posted on
// open short positions. Used to cap prediction bets and ladder-game deposits.
export const getTotalInvested = (userData: UserData | null | undefined) => {
  if (!userData) return 0;
  const holdings = userData.holdings || {};
  const costBasis = userData.costBasis || {};
  const holdingsValue = Object.entries(holdings).reduce(
    (sum, [ticker, shares]) => sum + (costBasis[ticker] || 0) * (shares || 0),
    0,
  );
  const shortMargin = Object.values(userData.shorts || {}).reduce(
    (sum, s) => sum + (s && s.shares > 0 ? s.margin || 0 : 0),
    0,
  );
  return holdingsValue + shortMargin;
};

// A user's rank via count aggregations (~1 read per 1000 counted) instead of
// reading one doc per higher-ranked user. Bots are subtracted with a second
// count so ranks match the bot-free leaderboard. Shared by getLeaderboard and
// the Discord bot's /profile so the two can't report different ranks.
export const countRankAbove = async (value: number, crew?: string | null) => {
  let above = db.collection('users').where('portfolioValue', '>', value);
  let botsAbove = db.collection('users').where('isBot', '==', true).where('portfolioValue', '>', value);
  if (crew) {
    above = above.where('crew', '==', crew);
    botsAbove = botsAbove.where('crew', '==', crew);
  }
  const [aboveSnap, botsSnap] = await Promise.all([above.count().get(), botsAbove.count().get()]);
  return Math.max(0, aboveSnap.data().count - botsSnap.data().count) + 1;
};
