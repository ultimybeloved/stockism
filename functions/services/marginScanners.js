'use strict';
// Scheduled liquidation scanners. Split out of margin.js, which had grown past
// the 600-line limit with three unrelated jobs in it.
//
// These two are the only code in the app that takes positions away from a player
// without the player asking, so they are kept together and away from the
// user-facing margin actions in margin.js:
//   * checkShortMarginCalls — force-covers underwater SHORT positions
//   * checkMarginLending    — liquidates an entire portfolio to clear margin debt
//
// Both re-read the market inside their transaction and re-check the equity ratio
// before touching anything. Prices move constantly while a scan works through
// users, and without that re-check someone who recovered mid-scan was still
// liquidated, at prices that no longer existed.
//
// npm run test:trading covers both (sections J and K) — run it before and after
// any change here.

const { cf } = require('../fnConfig');
const admin = require('firebase-admin');
const db = admin.firestore();
const {
  isWeeklyTradingHalt, TWENTY_FOUR_HOURS_MS,
  BASE_IMPACT, BASE_LIQUIDITY, MAX_PRICE_CHANGE_PERCENT,
  WEEKLY_HALT_END_MINUTE, MARKET_OPEN_GRACE_PERIOD_MINUTES,
  SHORT_MARGIN_CALL_THRESHOLD, SHORT_MARGIN_DAMPENING_FACTOR,
  LONG_MARGIN_CALL_THRESHOLD, LONG_MARGIN_LIQUIDATION_THRESHOLD,
  SHORT_MARGIN_RATIO, LEGACY_SHORT_MARGIN_RATIO, MARGIN_LIQUIDATION_SLIPPAGE,
  FORCED_COVERS_PER_TICKER_PER_CYCLE, FIRESTORE_BATCH_SIZE,
} = require('../constants');
const { writeNotification, sendDiscordMessage, reportError, appendPriceHistory, recordHeartbeat } = require('../helpers');

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
 * Server-side short margin call checker
 * Runs every 30 minutes - checks users flagged with hasOpenShorts
 * If equity ratio drops below 25%, force-covers the position
 * Uses 50% dampened price impact to prevent cascading short squeezes
 */
exports.checkShortMarginCalls = cf().pubsub
  .schedule('every 30 minutes')
  .timeZone('UTC')
  .onRun(async (context) => {
    if (isWeeklyTradingHalt()) {
      console.log('Skipping short margin calls — weekly trading halt active');
      return null;
    }

    const now = new Date();
    if (now.getUTCDay() === 4) {
      const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
      if (utcMins >= WEEKLY_HALT_END_MINUTE && utcMins < WEEKLY_HALT_END_MINUTE + MARKET_OPEN_GRACE_PERIOD_MINUTES) {
        console.log(`Market open grace period active — skipping margin calls until ${WEEKLY_HALT_END_MINUTE + MARKET_OPEN_GRACE_PERIOD_MINUTES} UTC min`);
        return null;
      }
    }

    const startTime = Date.now();
    console.log('Checking short margin calls...');

    try {
      const marketRef = db.collection('market').doc('current');
      const marketSnap = await marketRef.get();

      if (!marketSnap.exists) {
        console.error('Market data not found');
        return null;
      }

      const marketData = marketSnap.data();
      if (marketData.marketHalted) {
        console.log('Skipping short margin calls — emergency halt active');
        return null;
      }
      const prices = marketData.prices || {};

      // Users are found via the hasOpenShorts flag (maintained by executeTrade,
      // the force-cover below, bailout, and the admin ban rollback) instead of
      // downloading every user doc. The first run after deploy does a one-time
      // full scan to backfill the flag, marked on the market doc.
      let shortHolderDocs;
      if (!marketData.shortsFlagBackfilledAt) {
        const allUsers = await db.collection('users').get();
        shortHolderDocs = [];
        let batch = db.batch();
        let pending = 0;
        const flush = async () => {
          if (pending > 0) { await batch.commit(); batch = db.batch(); pending = 0; }
        };
        for (const doc of allUsers.docs) {
          const shorts = doc.data().shorts || {};
          const has = Object.values(shorts).some(p => p && p.shares > 0);
          if (has) {
            shortHolderDocs.push(doc);
            batch.update(doc.ref, { hasOpenShorts: true });
            pending++;
          } else if (doc.data().hasOpenShorts) {
            batch.update(doc.ref, { hasOpenShorts: false });
            pending++;
          }
          if (pending >= FIRESTORE_BATCH_SIZE) await flush();
        }
        await flush();
        await marketRef.update({ shortsFlagBackfilledAt: Date.now() });
        console.log(`Backfilled hasOpenShorts flags: ${shortHolderDocs.length} short holders of ${allUsers.size} users`);
      } else {
        const flaggedSnap = await db.collection('users')
          .where('hasOpenShorts', '==', true)
          .get();
        shortHolderDocs = flaggedSnap.docs;
      }

      let liquidatedCount = 0;
      let checkedCount = 0;
      let throttledCount = 0;
      const tickerCoverCount = {};

      for (const userDoc of shortHolderDocs) {
        const userData = userDoc.data();
        const shorts = userData.shorts || {};
        const shortEntries = Object.entries(shorts).filter(
          ([, pos]) => pos && pos.shares > 0
        );

        if (shortEntries.length === 0) {
          // Stale flag (shorts already cleared) — self-heal so this user
          // drops out of future queries.
          await userDoc.ref.update({ hasOpenShorts: false }).catch(() => {});
          continue;
        }
        checkedCount++;

        for (const [ticker, position] of shortEntries) {
          const currentPrice = prices[ticker];
          if (!currentPrice) continue;

          // Blast-radius cap: forced covers compound price upward, so only a few
          // per ticker per run (see FORCED_COVERS_PER_TICKER_PER_CYCLE).
          if ((tickerCoverCount[ticker] || 0) >= FORCED_COVERS_PER_TICKER_PER_CYCLE) {
            throttledCount++;
            continue; // Picked up on the next run of this scan
          }

          const costBasis = position.costBasis || position.entryPrice || currentPrice;
          const marginDeposited = depositedMargin(position, costBasis);

          // Calculate equity: margin deposited minus unrealized loss
          const unrealizedLoss = (currentPrice - costBasis) * position.shares;
          const equity = marginDeposited - unrealizedLoss;
          const positionValue = currentPrice * position.shares;
          const equityRatio = positionValue > 0 ? equity / positionValue : 0;

          if (equityRatio < SHORT_MARGIN_CALL_THRESHOLD) {
            // Force-cover this position
            try {
              // Reports whether it actually covered: the guards below can decide
              // the position is fine, and a skipped position must not be counted,
              // charged against the per-ticker cap, or announced to the user.
              const didCover = await db.runTransaction(async (transaction) => {
                // Re-read latest data inside transaction
                const freshUserDoc = await transaction.get(db.collection('users').doc(userDoc.id));
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

                // Calculate dampened price impact for forced cover (50% reduced)
                const priceImpact = freshPrice * BASE_IMPACT * Math.sqrt(freshPosition.shares / BASE_LIQUIDITY);
                const dampenedImpact = priceImpact * SHORT_MARGIN_DAMPENING_FACTOR;
                const maxImpact = freshPrice * MAX_PRICE_CHANGE_PERCENT;
                const cappedImpact = Math.min(dampenedImpact, maxImpact);
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

                transaction.update(db.collection('users').doc(userDoc.id), userUpdates);

                // Update market price (dampened)
                transaction.update(marketRef, {
                  [`prices.${ticker}`]: newPrice
                });
                appendPriceHistory(transaction, {
                  [ticker]: { timestamp: Date.now(), price: newPrice }
                });

                // Log the liquidation trade
                const tradeRef = db.collection('trades').doc();
                transaction.set(tradeRef, {
                  uid: userDoc.id,
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

                console.log(`Liquidated ${userDoc.id}'s short on ${ticker}: ${freshPosition.shares} shares at ${coverPrice}, cashChange: ${cashChange.toFixed(2)}`);
                return true;
              });

              if (didCover) {
                liquidatedCount++;
                tickerCoverCount[ticker] = (tickerCoverCount[ticker] || 0) + 1;

                // Notify user about margin call liquidation
                await writeNotification(userDoc.id, {
                  type: 'margin',
                  title: 'Margin Call - Position Liquidated',
                  message: `Your short on $${ticker} (${position.shares} shares) was force-covered due to low equity.`,
                  data: { ticker }
                });
              }
            } catch (error) {
              console.error(`Failed to liquidate ${userDoc.id}'s ${ticker} short:`, error);
            }
          }
        }
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`Margin call check complete: ${checkedCount} users checked, ${liquidatedCount} positions liquidated, ${throttledCount} throttled in ${elapsed}s`);
      await recordHeartbeat('checkShortMarginCalls');
      return { checked: checkedCount, liquidated: liquidatedCount, throttled: throttledCount, elapsed };

    } catch (error) {
      reportError(error, { where: 'checkShortMarginCalls' });
      return null;
    }
  });

/**
 * Check Margin Lending - Scheduled every 30 minutes
 * Monitors users with margin debt and auto-liquidates if equity drops too low
 */
exports.checkMarginLending = cf().pubsub
  .schedule('every 30 minutes')
  .timeZone('UTC')
  .onRun(async (context) => {
    if (isWeeklyTradingHalt()) {
      console.log('Skipping margin lending check — weekly trading halt active');
      return null;
    }

    const startTime = Date.now();
    console.log('Checking margin lending positions...');

    try {
      const marketRef = db.collection('market').doc('current');
      const marketSnap = await marketRef.get();

      if (!marketSnap.exists) {
        console.error('Market data not found');
        return null;
      }

      const marketSnapData = marketSnap.data();
      if (marketSnapData.marketHalted) {
        console.log('Skipping margin lending check — emergency halt active');
        return null;
      }
      const prices = marketSnapData.prices || {};

      // Query users with margin enabled
      const usersSnap = await db.collection('users')
        .where('marginEnabled', '==', true)
        .get();

      let liquidatedCount = 0;
      let marginCallCount = 0;
      let checkedCount = 0;

      const MARGIN_CALL_GRACE_PERIOD = TWENTY_FOUR_HOURS_MS;

      for (const userDoc of usersSnap.docs) {
        const userData = userDoc.data();
        const marginUsed = userData.marginUsed || 0;
        if (marginUsed <= 0) continue;
        checkedCount++;

        const cash = userData.cash || 0;
        const holdings = userData.holdings || {};

        // Calculate holdings value
        let holdingsValue = 0;
        Object.entries(holdings).forEach(([ticker, shares]) => {
          if (shares > 0) {
            holdingsValue += (prices[ticker] || 0) * shares;
          }
        });

        const grossValue = cash + holdingsValue;
        const portfolioValue = grossValue - marginUsed;
        const equityRatio = grossValue > 0 ? portfolioValue / grossValue : 0;

        const now = Date.now();

        if (equityRatio <= LONG_MARGIN_LIQUIDATION_THRESHOLD) {
          // AUTO-LIQUIDATION
          try {
            // Reports whether it actually liquidated: the guards below can decide
            // this user is fine, and a skipped user must not be counted or
            // announced as liquidated.
            const didLiquidate = await db.runTransaction(async (transaction) => {
              // Re-read the market as well as the user. `prices` above was read
              // once before this loop started, and every trade on the site moves
              // a price — without this, a portfolio that recovered while the scan
              // was working through earlier users still gets wiped, and the sale
              // is credited at prices that no longer exist. Same guard the short
              // scanner already applies before force-covering.
              const [freshUserDoc, freshMarketDoc] = await Promise.all([
                transaction.get(db.collection('users').doc(userDoc.id)),
                transaction.get(marketRef),
              ]);
              if (!freshUserDoc.exists || !freshMarketDoc.exists) return false;

              const freshData = freshUserDoc.data();
              const freshMarginUsed = freshData.marginUsed || 0;
              if (freshMarginUsed <= 0) return false;

              const freshHoldings = freshData.holdings || {};
              const freshPrices = freshMarketDoc.data().prices || {};

              // Re-check the ratio that triggered this. If they climbed back over
              // the liquidation line, leave them alone.
              let freshHoldingsValue = 0;
              Object.entries(freshHoldings).forEach(([ticker, shares]) => {
                if (shares > 0) freshHoldingsValue += (freshPrices[ticker] || 0) * shares;
              });
              const freshGross = (freshData.cash || 0) + freshHoldingsValue;
              const freshRatio = freshGross > 0
                ? (freshGross - freshMarginUsed) / freshGross
                : 0;
              if (freshRatio > LONG_MARGIN_LIQUIDATION_THRESHOLD) {
                console.log(`Skipping ${userDoc.id}: recovered to ${(freshRatio * 100).toFixed(1)}% equity before liquidation ran`);
                return false;
              }

              let totalRecovered = 0;
              const updateData = {};

              // Sell ALL positions at the forced-liquidation discount
              Object.entries(freshHoldings).forEach(([ticker, shares]) => {
                if (shares > 0) {
                  const sellValue = (freshPrices[ticker] || 0) * shares * (1 - MARGIN_LIQUIDATION_SLIPPAGE);
                  totalRecovered += sellValue;
                  updateData[`holdings.${ticker}`] = 0;
                  updateData[`costBasis.${ticker}`] = 0;
                }
              });

              const freshCash = freshData.cash || 0;
              const totalAvailable = freshCash + totalRecovered;
              const finalCash = Math.round((totalAvailable - freshMarginUsed) * 100) / 100;

              updateData.cash = finalCash;
              updateData.marginUsed = 0;
              updateData.marginCallAt = null;
              updateData.lastLiquidation = now;
              updateData.marginEnabled = false;

              if (finalCash < 0) {
                updateData.isBankrupt = true;
                updateData.bankruptAt = now;
              }

              transaction.update(db.collection('users').doc(userDoc.id), updateData);

              // Log liquidation trade
              const tradeRef = db.collection('trades').doc();
              transaction.set(tradeRef, {
                uid: userDoc.id,
                action: 'margin_liquidation',
                totalValue: totalRecovered,
                marginDebt: freshMarginUsed,
                cashBefore: freshCash,
                cashAfter: finalCash,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                automated: true
              });

              console.log(`Liquidated margin for ${userDoc.id}: recovered ${totalRecovered.toFixed(2)}, final cash ${finalCash.toFixed(2)}`);
              return true;
            });

            if (didLiquidate) {
              liquidatedCount++;

              // Send Discord alert
              try {
                await sendDiscordMessage(null, [{
                  title: '💥 Margin Liquidation',
                  description: 'A trader was just **LIQUIDATED** by the margin system',
                  color: 0xFF0000,
                  timestamp: new Date().toISOString()
                }]);
              } catch (e) { reportError(e, { where: 'margin liquidation alert' }); }
            }

          } catch (error) {
            console.error(`Failed to liquidate margin for ${userDoc.id}:`, error);
          }

        } else if (equityRatio <= LONG_MARGIN_CALL_THRESHOLD) {
          // MARGIN CALL
          const marginCallAt = userData.marginCallAt || 0;

          if (!marginCallAt) {
            // First margin call - set grace period
            await db.collection('users').doc(userDoc.id).update({
              marginCallAt: now
            });
            marginCallCount++;
          } else if (now >= marginCallAt + MARGIN_CALL_GRACE_PERIOD) {
            // Grace period expired - will liquidate on next check (equity will still be low)
            console.log(`Grace period expired for ${userDoc.id}, will liquidate on next cycle`);
          }

        } else if (userData.marginCallAt) {
          // Recovered from margin call
          await db.collection('users').doc(userDoc.id).update({
            marginCallAt: null
          });
        }
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`Margin lending check: ${checkedCount} checked, ${liquidatedCount} liquidated, ${marginCallCount} new margin calls in ${elapsed}s`);
      await recordHeartbeat('checkMarginLending');
      return { checked: checkedCount, liquidated: liquidatedCount, marginCalls: marginCallCount };

    } catch (error) {
      reportError(error, { where: 'checkMarginLending' });
      return null;
    }
  });
