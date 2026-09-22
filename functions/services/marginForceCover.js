'use strict';
// The forced short cover itself: one transaction that re-reads the position and
// the market, re-checks the equity ratio, and buys the position back.
//
// INTERNAL MODULE — required by marginScanners.js, not exported through
// functions/index.js, same pattern as tradeActions and limitOrderFill.
//
// Split out when marginScanners.js passed the 600-line limit. The two scanners
// stay together in that file on purpose (they are the only code that takes
// positions away from a player without being asked); what moved here is the
// per-position mechanics, not one of the two jobs.
//
// Covered by npm run test:trading section J.

const admin = require('firebase-admin');
const db = admin.firestore();

const {
  BASE_IMPACT, BASE_LIQUIDITY, MAX_PRICE_CHANGE_PERCENT,
  SHORT_MARGIN_CALL_THRESHOLD, SHORT_MARGIN_DAMPENING_FACTOR,
  SHORT_MARGIN_RATIO, LEGACY_SHORT_MARGIN_RATIO,
  ADMIN_PRICE_PROTECTION_MS,
} = require('../constants');
const { appendPriceHistory, isPriceProtected } = require('../helpers');

// Collateral a short position was opened with. Current (v2) shorts are 100%
// collateral; pre-v2 shorts were half. Only used when the stored `margin` field
// is missing or zero — guessing low here understates equity and force-covers a
// healthy position, so the guess must match the system that opened it.
const depositedMargin = (position, costBasis) => {
  if (position.margin > 0) return position.margin;
  const ratio = (position.system || 'v2') === 'v2'
    ? SHORT_MARGIN_RATIO
    : LEGACY_SHORT_MARGIN_RATIO;
  return costBasis * position.shares * ratio;
};

/**
 * Force-cover one underwater short, inside its own transaction.
 *
 * Returns the number of shares actually covered, or false when the guards
 * decide the position is fine after all — a skipped position must not be
 * counted, charged against the per-ticker cap, or announced to the player.
 *
 * @returns {Promise<number|false>}
 */
const forceCoverShort = async ({ uid, ticker, marketRef, priceHistory }) =>
  db.runTransaction(async (transaction) => {
    // Re-read latest data inside transaction
    const freshUserDoc = await transaction.get(db.collection('users').doc(uid));
    const freshMarketDoc = await transaction.get(marketRef);

    if (!freshUserDoc.exists || !freshMarketDoc.exists) return false;

    const freshUserData = freshUserDoc.data();
    const freshShorts = freshUserData.shorts || {};
    const freshPosition = freshShorts[ticker];

    if (!freshPosition || freshPosition.shares <= 0) return false;

    const freshPrices = freshMarketDoc.data().prices || {};
    const freshPrice = freshPrices[ticker];
    if (!freshPrice) return false;

    // Re-check equity ratio with fresh data
    const freshCostBasis = freshPosition.costBasis || freshPosition.entryPrice || freshPrice;
    const freshMargin = depositedMargin(freshPosition, freshCostBasis);
    const freshLoss = (freshPrice - freshCostBasis) * freshPosition.shares;
    const freshEquity = freshMargin - freshLoss;
    const freshPositionValue = freshPrice * freshPosition.shares;
    const freshEquityRatio = freshPositionValue > 0 ? freshEquity / freshPositionValue : 0;

    if (freshEquityRatio >= SHORT_MARGIN_CALL_THRESHOLD) return false; // No longer underwater

    // Calculate dampened price impact for forced cover (50% reduced).
    //
    // An admin-adjusted price is left exactly where the admin put
    // it: the cover still happens (the position is underwater and
    // deferring it for the seven-day protection window would be
    // worse for the player than covering), it just doesn't move the
    // market. The player covers at the unmoved price, which is
    // cheaper for them than the alternative.
    const pricePinned = isPriceProtected(priceHistory, ticker, ADMIN_PRICE_PROTECTION_MS);
    const priceImpact = freshPrice * BASE_IMPACT * Math.sqrt(freshPosition.shares / BASE_LIQUIDITY);
    const dampenedImpact = priceImpact * SHORT_MARGIN_DAMPENING_FACTOR;
    const maxImpact = freshPrice * MAX_PRICE_CHANGE_PERCENT;
    const cappedImpact = pricePinned ? 0 : Math.min(dampenedImpact, maxImpact);
    const newPrice = Math.round((freshPrice + cappedImpact) * 100) / 100;

    // Calculate cover cost and margin return
    const coverPrice = newPrice;
    let cashChange;
    if ((freshPosition.system || 'v2') === 'v2') {
      // v2: margin back + profit/loss
      const shortProfit = (freshCostBasis - coverPrice) * freshPosition.shares;
      cashChange = freshMargin + shortProfit;
    } else {
      // Legacy: pay cover cost, get margin back (proceeds already in cash)
      const coverCost = coverPrice * freshPosition.shares;
      cashChange = freshMargin - coverCost;
    }

    // Update user: clear short, adjust cash
    const newCash = Math.round(((freshUserData.cash || 0) + cashChange) * 100) / 100;
    // Sanitize shorts to prevent undefined fields from crashing Firestore writes
    const updatedShorts = {};
    for (const [t, pos] of Object.entries(freshShorts)) {
      if (t !== ticker && pos && pos.shares > 0) {
        updatedShorts[t] = {
          shares: pos.shares,
          costBasis: pos.costBasis || pos.entryPrice || 0,
          margin: pos.margin || 0,
          openedAt: pos.openedAt || admin.firestore.Timestamp.now(),
          system: pos.system || 'v2'
        };
      }
    }

    const userUpdates = {
      shorts: updatedShorts,
      hasOpenShorts: Object.keys(updatedShorts).length > 0,
      cash: newCash
    };

    if (newCash < 0) {
      userUpdates.isBankrupt = true;
      userUpdates.bankruptAt = Date.now();
    }

    transaction.update(db.collection('users').doc(uid), userUpdates);

    // Update market price (dampened). Skipped entirely when the
    // price is admin-pinned — newPrice equals freshPrice there, and
    // writing it back would stamp a fresh history point over an
    // adjustment that is meant to stand.
    if (!pricePinned) {
      transaction.update(marketRef, {
        [`prices.${ticker}`]: newPrice
      });
      appendPriceHistory(transaction, {
        [ticker]: { timestamp: Date.now(), price: newPrice }
      });
    }

    // Log the liquidation trade
    const tradeRef = db.collection('trades').doc();
    transaction.set(tradeRef, {
      uid: uid,
      ticker,
      action: 'margin_call_cover',
      amount: freshPosition.shares,
      price: coverPrice,
      totalValue: coverPrice * freshPosition.shares,
      cashBefore: freshUserData.cash || 0,
      cashAfter: newCash,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      automated: true
    });

    console.log(`Liquidated ${uid}'s short on ${ticker}: ${freshPosition.shares} shares at ${coverPrice}, cashChange: ${cashChange.toFixed(2)}`);
    // The share count travels back out so the notification can
    // report what actually covered. It used to quote the count from
    // the pre-transaction scan read, which is stale the moment the
    // player covers part of the position themselves mid-scan.
    return freshPosition.shares;
  });

module.exports = { forceCoverShort, depositedMargin };
