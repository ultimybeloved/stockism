'use strict';
// Long-term event-share prediction markets (Polymarket / Robinhood style).
// Each outcome is a share that redeems for $1 if it is the confirmed result and
// $0 otherwise. Prices are quoted by a house-run LMSR automated market maker, so
// players can always buy or sell, and the house's max loss per market is bounded
// (b * ln(1 / opening price of the winning outcome); b * ln(numOutcomes) when
// odds open even). Admins create and resolve markets via direct writes in
// the admin panel (same pattern as weekly predictions); buying, selling, and
// settlement run here on the server.
const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const db = admin.firestore();
const {
  isWeeklyTradingHalt,
  EVENT_AMM_LIQUIDITY,
  EVENT_MIN_BUYIN,
  ADMIN_UID,
} = require('../constants');
const {
  checkBanned,
  checkDiscordWall,
  writeNotification,
  lmsrCost,
  lmsrBuyCost,
  lmsrSellRefund,
  getTotalInvested,
  touchLastActive,
} = require('../helpers');

const round2 = (n) => Math.round(n * 100) / 100;

// Throw if event-market trading is currently frozen. Mirrors stock trading: the
// market freezes during the weekly chapter-review halt and any admin halt, so
// nobody who reads the new chapter early can trade on it before everyone else.
const HALT_MSG = 'Market closed for chapter review. Trading resumes at 21:00 UTC.';

/**
 * Buy event shares of one outcome at the current AMM price.
 */
exports.buyEventShares = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }
  const uid = context.auth.uid;
  touchLastActive(uid);
  const { marketId, outcome } = data || {};
  const qty = Math.round(Number(data && data.shares) * 100) / 100;

  if (!marketId || !outcome || !Number.isFinite(qty) || qty <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid order.');
  }
  if (isWeeklyTradingHalt()) {
    throw new functions.https.HttpsError('failed-precondition', HALT_MSG);
  }

  const userRef = db.collection('users').doc(uid);
  const predictionsRef = db.collection('predictions').doc('current');
  const marketRef = db.collection('market').doc('current');

  return db.runTransaction(async (tx) => {
    const [userDoc, predDoc, marketDoc] = await Promise.all([
      tx.get(userRef),
      tx.get(predictionsRef),
      tx.get(marketRef),
    ]);

    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');
    if (!predDoc.exists) throw new functions.https.HttpsError('not-found', 'Markets not found.');

    const userData = userDoc.data();
    checkBanned(userData);
    checkDiscordWall(userData);
    if (marketDoc.exists && marketDoc.data().marketHalted) {
      throw new functions.https.HttpsError('failed-precondition', HALT_MSG);
    }

    const list = predDoc.data().list || [];
    const idx = list.findIndex((m) => m.id === marketId && m.type === 'event');
    if (idx === -1) throw new functions.https.HttpsError('not-found', 'Market not found.');

    const market = list[idx];
    if (market.resolved) throw new functions.https.HttpsError('failed-precondition', 'Market has resolved.');
    if (market.cancelled) throw new functions.https.HttpsError('failed-precondition', 'Market has been cancelled.');
    if (market.opensAt && Date.now() < market.opensAt) {
      throw new functions.https.HttpsError('failed-precondition', 'This market is not open for betting yet.');
    }

    const outcomes = market.outcomes || [];
    const oi = outcomes.indexOf(outcome);
    if (oi === -1) throw new functions.https.HttpsError('invalid-argument', 'Unknown outcome.');

    const b = market.b || EVENT_AMM_LIQUIDITY;
    const q = (Array.isArray(market.q) && market.q.length === outcomes.length)
      ? market.q.slice()
      : outcomes.map(() => 0);

    const cost = round2(lmsrBuyCost(q, b, oi, qty));
    if (cost < EVENT_MIN_BUYIN) {
      throw new functions.https.HttpsError('failed-precondition', `Minimum buy is $${EVENT_MIN_BUYIN}.`);
    }
    if ((userData.cash || 0) < cost) {
      throw new functions.https.HttpsError('failed-precondition', 'Insufficient funds.');
    }

    // Cap event-market exposure to what the user has invested in stocks, the same
    // rule weekly bets and ladder deposits use. Without it, a barely-invested
    // player could farm value straight out of the AMM. Only unsettled positions
    // count toward the cap; resolved/settled ones are already realized.
    const totalInvested = getTotalInvested(userData);
    if (totalInvested <= 0) {
      throw new functions.https.HttpsError('failed-precondition', 'Invest in stocks before buying prediction shares.');
    }
    const activeEventCost = Object.values(userData.eventPositions || {}).reduce(
      // Max(0, …) guards any pre-clamp negative basis from older sells.
      (sum, p) => sum + (p && !p.settled ? Math.max(0, p.costBasis || 0) : 0), 0
    );
    if (activeEventCost + cost > totalInvested) {
      const room = Math.max(0, round2(totalInvested - activeEventCost));
      throw new functions.https.HttpsError('failed-precondition',
        `Long-term markets are capped at what you've invested in stocks ($${totalInvested.toFixed(2)}). You can put in up to $${room.toFixed(2)} more.`);
    }

    q[oi] = Math.round((q[oi] + qty) * 100) / 100;
    const updatedList = list.slice();
    updatedList[idx] = { ...market, q, volume: round2((market.volume || 0) + cost) };

    const pos = userData.eventPositions?.[marketId] || { shares: {}, costBasis: 0 };
    const newShares = { ...(pos.shares || {}) };
    newShares[outcome] = Math.round(((newShares[outcome] || 0) + qty) * 100) / 100;

    tx.update(predictionsRef, { list: updatedList });
    tx.update(userRef, {
      cash: round2((userData.cash || 0) - cost),
      [`eventPositions.${marketId}`]: {
        shares: newShares,
        costBasis: round2((pos.costBasis || 0) + cost),
        settled: false,
      },
    });

    return { success: true, cost, shares: qty, outcome };
  });
});

/**
 * Sell event shares of one outcome back to the AMM at the current price.
 */
exports.sellEventShares = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }
  const uid = context.auth.uid;
  touchLastActive(uid);
  const { marketId, outcome } = data || {};
  const qty = Math.round(Number(data && data.shares) * 100) / 100;

  if (!marketId || !outcome || !Number.isFinite(qty) || qty <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid order.');
  }
  if (isWeeklyTradingHalt()) {
    throw new functions.https.HttpsError('failed-precondition', HALT_MSG);
  }

  const userRef = db.collection('users').doc(uid);
  const predictionsRef = db.collection('predictions').doc('current');
  const marketRef = db.collection('market').doc('current');

  return db.runTransaction(async (tx) => {
    const [userDoc, predDoc, marketDoc] = await Promise.all([
      tx.get(userRef),
      tx.get(predictionsRef),
      tx.get(marketRef),
    ]);

    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');
    if (!predDoc.exists) throw new functions.https.HttpsError('not-found', 'Markets not found.');

    const userData = userDoc.data();
    checkBanned(userData);
    checkDiscordWall(userData);
    if (marketDoc.exists && marketDoc.data().marketHalted) {
      throw new functions.https.HttpsError('failed-precondition', HALT_MSG);
    }

    const list = predDoc.data().list || [];
    const idx = list.findIndex((m) => m.id === marketId && m.type === 'event');
    if (idx === -1) throw new functions.https.HttpsError('not-found', 'Market not found.');

    const market = list[idx];
    if (market.resolved) throw new functions.https.HttpsError('failed-precondition', 'Market has resolved.');
    if (market.cancelled) throw new functions.https.HttpsError('failed-precondition', 'Market has been cancelled.');

    const outcomes = market.outcomes || [];
    const oi = outcomes.indexOf(outcome);
    if (oi === -1) throw new functions.https.HttpsError('invalid-argument', 'Unknown outcome.');

    const pos = userData.eventPositions?.[marketId];
    const owned = (pos && pos.shares && pos.shares[outcome]) || 0;
    if (owned < qty) {
      throw new functions.https.HttpsError('failed-precondition', 'You do not own that many shares.');
    }

    const b = market.b || EVENT_AMM_LIQUIDITY;
    const q = (Array.isArray(market.q) && market.q.length === outcomes.length)
      ? market.q.slice()
      : outcomes.map(() => 0);

    const refund = round2(lmsrSellRefund(q, b, oi, qty));
    q[oi] = Math.max(0, Math.round((q[oi] - qty) * 100) / 100);
    const updatedList = list.slice();
    updatedList[idx] = { ...market, q, volume: round2((market.volume || 0) + refund) };

    const newShares = { ...(pos.shares || {}) };
    const remaining = Math.round((owned - qty) * 100) / 100;
    if (remaining > 0) newShares[outcome] = remaining;
    else delete newShares[outcome];

    tx.update(predictionsRef, { list: updatedList });
    tx.update(userRef, {
      cash: round2((userData.cash || 0) + refund),
      [`eventPositions.${marketId}`]: {
        shares: newShares,
        // Clamp at 0: selling at a profit must not go negative, or the surplus
        // would grant extra invested-cap room in other markets.
        costBasis: Math.max(0, round2((pos.costBasis || 0) - refund)),
        settled: false,
      },
    });

    return { success: true, refund, shares: qty, outcome };
  });
});

/**
 * Settle every resolved-but-unsettled event market: redeem winning shares at $1,
 * expire the rest, award the participation achievement, and pay winners.
 * Safe to run anytime (payouts only, no trading), so it is not blocked by halts.
 */
async function settleResolvedEventMarkets() {
  const predictionsRef = db.collection('predictions').doc('current');
  const predSnap = await predictionsRef.get();
  if (!predSnap.exists) return { settled: 0 };

  const list = predSnap.data().list || [];
  const toSettle = list.filter((m) => m.type === 'event' && m.resolved && !m.settled);
  if (toSettle.length === 0) return { settled: 0 };

  // The full user scan only runs when something actually needs settling (rare).
  const usersSnap = await db.collection('users').get();
  let marketsSettled = 0;

  for (const market of toSettle) {
    const winning = market.outcome;
    let totalPaid = 0;

    for (const userDoc of usersSnap.docs) {
      const snapPos = userDoc.data().eventPositions?.[market.id];
      if (!snapPos || snapPos.settled) continue;
      const heldAny = Object.values(snapPos.shares || {}).some((s) => s > 0);
      if (!heldAny) {
        await userDoc.ref.update({ [`eventPositions.${market.id}.settled`]: true });
        continue;
      }

      // Per-user transaction so a concurrent trade can't clobber cash.
      const paid = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(userDoc.ref);
        if (!fresh.exists) return 0;
        const ud = fresh.data();
        const pos = ud.eventPositions?.[market.id];
        if (!pos || pos.settled) return 0;

        const winShares = (pos.shares && pos.shares[winning]) || 0;
        const payout = round2(winShares * 1);

        const updates = {
          [`eventPositions.${market.id}.settled`]: true,
          [`eventPositions.${market.id}.payout`]: payout,
        };

        const ach = ud.achievements || [];
        const newAch = [];
        if (!ach.includes('TRUE_BELIEVER')) newAch.push('TRUE_BELIEVER');

        if (payout > 0) {
          updates.cash = round2((ud.cash || 0) + payout);
          const newWins = (ud.predictionWins || 0) + 1;
          updates.predictionWins = newWins;
          if (newWins >= 10 && !ach.includes('PROPHET')) newAch.push('PROPHET');
          else if (newWins >= 3 && !ach.includes('ORACLE')) newAch.push('ORACLE');
        }

        if (newAch.length) {
          updates.achievements = FieldValue.arrayUnion(...newAch);
          for (const a of newAch) updates[`achievementDates.${a}`] = Date.now();
        }

        tx.update(userDoc.ref, updates);
        return payout;
      });

      if (paid > 0) {
        totalPaid += paid;
        await writeNotification(userDoc.id, {
          type: 'system',
          title: 'Prediction Payout',
          message: `Your "${winning}" shares paid out $${Math.round(paid).toLocaleString()} on "${market.question}".`,
          data: { marketId: market.id },
        });
      }
    }

    // House accounting: net cash the AMM took in over the market's life is
    // path-independent, so it equals cost(q) - cost(seedQ). seedQ is all-zeros
    // unless the market was created with admin-set opening odds.
    const b = market.b || EVENT_AMM_LIQUIDITY;
    const q = Array.isArray(market.q) ? market.q : [];
    const seedQ = (Array.isArray(market.seedQ) && market.seedQ.length === q.length)
      ? market.seedQ
      : q.map(() => 0);
    const collected = q.length ? round2(lmsrCost(q, b) - lmsrCost(seedQ, b)) : 0;
    const houseCost = round2(totalPaid - collected);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(predictionsRef);
      const l = (snap.data().list || []).slice();
      const i = l.findIndex((m) => m.id === market.id);
      if (i !== -1) {
        l[i] = { ...l[i], settled: true, settledAt: Date.now(), houseCost };
        tx.update(predictionsRef, { list: l });
      }
    });

    marketsSettled++;
  }

  return { settled: marketsSettled };
}

exports.processEventSettlements = cf().pubsub
  .schedule('every 30 minutes')
  .timeZone('UTC')
  .onRun(async () => {
    try {
      return await settleResolvedEventMarkets();
    } catch (error) {
      console.error('Event settlement failed:', error);
      return null;
    }
  });

/**
 * Admin: settle resolved markets immediately instead of waiting for the cron.
 */
exports.triggerEventSettlements = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.');
  }
  return await settleResolvedEventMarkets();
});

/**
 * Admin: cancel an unresolved event market and refund every holder their net
 * stake (cash put in minus anything already pulled out by selling), floored at
 * $0 so a cancellation never deducts from a user. Marks the market cancelled
 * (which blocks further trading) and settled (so the settlement cron ignores
 * it). Safe to retry: positions already marked settled are skipped.
 */
exports.cancelEventMarket = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.');
  }
  const marketId = data && data.marketId;
  if (!marketId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing market ID.');
  }

  const predictionsRef = db.collection('predictions').doc('current');

  // 1. Mark the market cancelled first so the trade guards block any new buy/sell
  //    while we refund. Reject if it is missing, already resolved, or already cancelled.
  const market = await db.runTransaction(async (tx) => {
    const snap = await tx.get(predictionsRef);
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Markets not found.');
    const list = (snap.data().list || []).slice();
    const idx = list.findIndex((m) => m.id === marketId && m.type === 'event');
    if (idx === -1) throw new functions.https.HttpsError('not-found', 'Market not found.');
    const m = list[idx];
    if (m.resolved) throw new functions.https.HttpsError('failed-precondition', 'Market already resolved.');
    if (m.cancelled) throw new functions.https.HttpsError('failed-precondition', 'Market already cancelled.');
    list[idx] = { ...m, cancelled: true, cancelledAt: Date.now() };
    tx.update(predictionsRef, { list });
    return list[idx];
  });

  // 2. Refund every holder their net stake, one transaction per user so a
  //    concurrent write cannot clobber cash. Full scan only happens on cancel (rare).
  const usersSnap = await db.collection('users').get();
  let refundedCount = 0;
  let refundedTotal = 0;

  for (const userDoc of usersSnap.docs) {
    const snapPos = userDoc.data().eventPositions?.[marketId];
    if (!snapPos || snapPos.settled) continue;

    const refund = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(userDoc.ref);
      if (!fresh.exists) return 0;
      const ud = fresh.data();
      const pos = ud.eventPositions?.[marketId];
      if (!pos || pos.settled) return 0;

      const amount = Math.max(0, round2(pos.costBasis || 0));
      tx.update(userDoc.ref, {
        cash: round2((ud.cash || 0) + amount),
        [`eventPositions.${marketId}`]: {
          shares: {},
          costBasis: 0,
          settled: true,
          refunded: true,
          payout: amount,
        },
      });
      return amount;
    });

    if (refund > 0) {
      refundedCount++;
      refundedTotal = round2(refundedTotal + refund);
      await writeNotification(userDoc.id, {
        type: 'system',
        title: 'Market Cancelled',
        message: `"${market.question}" was cancelled. $${Math.round(refund).toLocaleString()} refunded to your cash.`,
        data: { marketId },
      });
    }
  }

  // 3. Mark settled so processEventSettlements (resolved && !settled) never touches it.
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(predictionsRef);
    const list = (snap.data().list || []).slice();
    const idx = list.findIndex((m) => m.id === marketId);
    if (idx !== -1) {
      list[idx] = { ...list[idx], settled: true, settledAt: Date.now(), refundedTotal };
      tx.update(predictionsRef, { list });
    }
  });

  return { success: true, refunded: refundedCount, total: refundedTotal };
});
