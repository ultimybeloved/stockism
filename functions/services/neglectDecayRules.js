'use strict';
// The neglect-decay decision, split from the scheduled function so every skip
// reason is testable without an emulator.
//
// INTERNAL MODULE — required directly by neglectDecay.js and deliberately
// absent from servicePaths.js. It exports no Cloud Functions.
const {
  NEGLECT_WINDOW_MS,
  NEGLECT_DECAY_DAILY_RATE,
  NEGLECT_SHORT_INTEREST_THRESHOLD,
  ADMIN_PRICE_PROTECTION_MS,
  MIN_PRICE,
} = require('../constants');
const { isPriceProtected, isTickerPaused, neglectFloorPrice } = require('../helpers');

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Decide one ticker's fate. Returns the new price, or null to leave it alone.
 *
 * Split out from the scheduled function so every skip reason is testable
 * without an emulator.
 */
const decayTarget = ({
  character, price, stats, shortInterest, priceHistory, now, trackingStartedAt,
  haltedTickers,
}) => {
  if (character.isETF) return null;
  if (!(price > 0)) return null;

  // Circuit-breaker pause. Nearly inert by construction — a stock that moved
  // 10% in five minutes was being traded, so it is not neglected — but a
  // character can be dragged through the breaker by a TRAILING move from a
  // linked one without being traded itself, and then this is the one automated
  // mover that would still push it. Every other one already checks.
  if (isTickerPaused(haltedTickers, character.ticker, now)) return null;

  // When was this stock last shown any interest?
  //
  // With no recorded trade the honest answer is "not since we started
  // watching". Per-ticker trade times only began being recorded on the day this
  // system shipped, so falling back to dateAdded alone would treat a stock that
  // traded last week — before tracking existed — as long dead and decay it
  // immediately. trackingStartedAt is the floor on how far back any claim of
  // neglect can reach.
  const reference = stats?.lastTradedAt
    || Math.max(new Date(character.dateAdded).getTime(), trackingStartedAt || 0);
  if (now - reference < NEGLECT_WINDOW_MS) return null;

  if ((shortInterest[character.ticker] || 0) >= NEGLECT_SHORT_INTEREST_THRESHOLD) return null;

  // Automated movers never undo an admin's manual price decision.
  if (isPriceProtected(priceHistory, character.ticker, ADMIN_PRICE_PROTECTION_MS, now)) return null;

  const floor = neglectFloorPrice(character, stats?.trades || 0);
  if (price <= floor) return null;

  const target = Math.max(floor, MIN_PRICE, round2(price * (1 - NEGLECT_DECAY_DAILY_RATE)));
  // A price so low that a 1% step rounds to nothing would otherwise write the
  // same number every day forever.
  return target < price ? target : null;
};


module.exports = { decayTarget };
