'use strict';
// Heavy player-data repair jobs, split out of adminOps.js when it passed the
// 600-line limit.
//
// Everything here rewrites historical player data in bulk, runs for minutes, and
// is triggered by hand from the admin panel after something has already gone
// wrong. Treat every function here as destructive until proven otherwise: prefer
// a dry-run/scan mode, and never wire any of it to a schedule.
const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const db = admin.firestore();
const {
  ADMIN_UID,
  STARTING_CASH,
} = require('../constants');
const { priceHistoryRef } = require('../helpers');

/**
 * Repair accounts damaged by the Jiho/Doo price spike.
 * Modes: scan (find victims), repair (fix one user), repairAll (fix all)
 */
exports.repairSpikeVictims = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const { mode, userId, victims: victimsInput, userIds } = data;
  const SPIKE_TICKERS = ['JIHO', 'DOO'];

  // --- DIAGNOSE MODE ---
  if (mode === 'diagnose') {
    if (!userIds || !Array.isArray(userIds)) {
      throw new functions.https.HttpsError('invalid-argument', 'userIds array required');
    }

    const results = [];
    for (const uid of userIds) {
      const userSnap = await db.collection('users').doc(uid).get();
      if (!userSnap.exists) {
        results.push({ userId: uid, error: 'not found' });
        continue;
      }
      const userData = userSnap.data();

      // Get all trades for this user
      const tradesSnap = await db.collection('trades')
        .where('uid', '==', uid)
        .get();

      const trades = [];
      tradesSnap.forEach(doc => {
        const t = doc.data();
        const ts = t.timestamp?._seconds
          ? t.timestamp._seconds * 1000
          : (t.timestamp?.seconds ? t.timestamp.seconds * 1000 : 0);
        trades.push({
          id: doc.id,
          action: t.action,
          ticker: t.ticker,
          amount: t.amount,
          price: t.price,
          totalValue: t.totalValue,
          pnl: t.pnl,
          cashBefore: t.cashBefore,
          cashAfter: t.cashAfter,
          automated: t.automated || false,
          timestamp: ts
        });
      });

      trades.sort((a, b) => b.timestamp - a.timestamp);

      results.push({
        userId: uid,
        displayName: userData.displayName || 'Unknown',
        cash: userData.cash || 0,
        isBankrupt: userData.isBankrupt || false,
        bankruptAt: userData.bankruptAt || null,
        lastBailout: userData.lastBailout || null,
        holdings: userData.holdings || {},
        shorts: userData.shorts || {},
        costBasis: userData.costBasis || {},
        marginEnabled: userData.marginEnabled || false,
        marginUsed: userData.marginUsed || 0,
        portfolioValue: userData.portfolioValue || 0,
        totalTrades: trades.length,
        recentTrades: trades.slice(0, 50) // Last 50 trades
      });
    }

    return { results };
  }

  // --- SCAN MODE ---
  if (mode === 'scan') {
    // Broad scan: find ALL users who are bankrupt, have negative cash, or have
    // empty shorts (position closed without trade log). Excludes bots.
    const usersSnap = await db.collection('users').get();
    const victims = [];

    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data();
      if (userData.isBot) continue;

      const uid = userDoc.id;
      const cash = userData.cash || 0;
      const isBankrupt = userData.isBankrupt || false;
      const holdings = userData.holdings || {};
      const shorts = userData.shorts || {};
      const hasHoldings = Object.values(holdings).some(v => v > 0);
      const hasShorts = Object.values(shorts).some(v => v && (typeof v === 'object' ? v.shares > 0 : v > 0));

      // Flag users who are: bankrupt, negative cash, or $0 with nothing
      const isDamaged = isBankrupt || cash < 0;
      if (!isDamaged) continue;

      // Get their trades for context
      const tradesSnap = await db.collection('trades')
        .where('uid', '==', uid)
        .get();

      const trades = [];
      tradesSnap.forEach(doc => {
        const t = doc.data();
        const ts = t.timestamp?._seconds
          ? t.timestamp._seconds * 1000
          : (t.timestamp?.seconds ? t.timestamp.seconds * 1000 : 0);
        trades.push({ ...t, _ts: ts, id: doc.id });
      });
      trades.sort((a, b) => a._ts - b._ts);

      // Find margin_call_cover trades on spike tickers
      const spikeTrades = trades.filter(t =>
        t.action === 'margin_call_cover' && SPIKE_TICKERS.includes(t.ticker)
      );

      // Find the last SHORT open on spike tickers (for users like Bbb with no cover trade)
      const spikeShortOpens = trades.filter(t =>
        (t.action === 'SHORT' || t.action === 'short' || t.action === 'SHORT_OPEN') &&
        SPIKE_TICKERS.includes(t.ticker)
      );

      // Determine corrected cash
      let correctedCash = null;
      let reason = '';

      if (spikeTrades.length > 0 && spikeShortOpens.length > 0) {
        // Has margin_call_cover AND short opens on spike tickers
        // Restore to cash BEFORE their first spike-ticker short (undo the whole sequence)
        correctedCash = spikeShortOpens[0].cashBefore;
        reason = 'margin_call_cover on ' + [...new Set(spikeTrades.map(t => t.ticker))].join('/');
      } else if (spikeTrades.length > 0) {
        // Has margin_call_cover but no short open found — use cashBefore of first cover
        correctedCash = spikeTrades[0].cashBefore;
        reason = 'margin_call_cover (no short open found)';
      } else if (spikeShortOpens.length > 0 && cash < 0) {
        // Shorted spike tickers, no cover trade logged, but negative cash
        // Restore to cash BEFORE the first spike short (margin should come back since position is gone)
        correctedCash = spikeShortOpens[0].cashBefore;
        reason = 'short closed without trade log (' + [...new Set(spikeShortOpens.map(t => t.ticker))].join('/') + ')';
      } else if (trades.length === 0 && cash <= 0) {
        // No trades at all, zero/negative cash — empty or broken account
        correctedCash = STARTING_CASH;
        reason = 'empty account (no trades)';
      }

      // Check if they took bailout
      const tookBailout = !!(userData.lastBailout);

      // For bailout users, try to reconstruct holdings from trade history
      let holdingsToRestore = null;
      let costBasisToRestore = null;

      if (tookBailout && trades.length > 0) {
        const replayHoldings = {};
        const replayCostBasis = {};

        // Replay all buy/sell trades (entire history, since bailout wiped everything)
        for (const t of trades) {
          const ticker = t.ticker;
          if (!ticker) continue;
          // Stop replaying if we hit the bailout or damage point
          if (t.action === 'margin_call_cover' && SPIKE_TICKERS.includes(ticker)) break;

          if (t.action === 'BUY' || t.action === 'buy') {
            const prevShares = replayHoldings[ticker] || 0;
            const prevCost = replayCostBasis[ticker] || 0;
            const newShares = prevShares + (t.amount || 0);
            if (newShares > 0) {
              replayCostBasis[ticker] = ((prevCost * prevShares) + (t.price * (t.amount || 0))) / newShares;
            }
            replayHoldings[ticker] = newShares;
          } else if (t.action === 'SELL' || t.action === 'sell') {
            replayHoldings[ticker] = Math.max(0, (replayHoldings[ticker] || 0) - (t.amount || 0));
            if (replayHoldings[ticker] === 0) delete replayCostBasis[ticker];
          }
        }

        // Clean up zero holdings
        for (const [ticker, shares] of Object.entries(replayHoldings)) {
          if (shares <= 0) {
            delete replayHoldings[ticker];
            delete replayCostBasis[ticker];
          }
        }

        if (Object.keys(replayHoldings).length > 0) {
          holdingsToRestore = replayHoldings;
          costBasisToRestore = replayCostBasis;
        }
      }

      // Get last 10 trades for display
      const recentTrades = trades.slice(-10).reverse().map(t => ({
        action: t.action,
        ticker: t.ticker,
        shares: t.amount,
        price: t.price,
        pnl: t.pnl,
        cashBefore: t.cashBefore,
        cashAfter: t.cashAfter,
        timestamp: t._ts
      }));

      victims.push({
        userId: uid,
        displayName: userData.displayName || 'Unknown',
        currentCash: cash,
        correctedCash,
        isBankrupt,
        bankruptAt: userData.bankruptAt || null,
        tookBailout,
        holdingsToRestore,
        costBasisToRestore,
        holdingsCount: holdingsToRestore ? Object.keys(holdingsToRestore).length : 0,
        hasHoldings,
        hasShorts,
        reason,
        totalTrades: trades.length,
        trades: recentTrades
      });
    }

    // Sort: most negative cash first
    victims.sort((a, b) => (a.currentCash || 0) - (b.currentCash || 0));

    return { victims };
  }

  // --- REPAIR MODE (single user) ---
  if (mode === 'repair') {
    if (!userId) {
      throw new functions.https.HttpsError('invalid-argument', 'userId required for repair mode');
    }

    // Find the victim data from victimsInput or re-scan
    let victim = victimsInput;
    if (!victim) {
      throw new functions.https.HttpsError('invalid-argument', 'victim data required');
    }

    const userRef = db.collection('users').doc(userId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'User not found');
    }

    const updates = {
      cash: Math.round(victim.correctedCash * 100) / 100,
      isBankrupt: false
    };

    // Clear bankruptcy timestamp
    const userData = userSnap.data();
    if (userData.bankruptAt) {
      updates.bankruptAt = admin.firestore.FieldValue.delete();
    }

    // Restore holdings for bailout users
    if (victim.tookBailout && victim.holdingsToRestore) {
      updates.holdings = victim.holdingsToRestore;
      if (victim.costBasisToRestore) {
        updates.costBasis = victim.costBasisToRestore;
      }
    }

    // Add repair log
    updates._repairLog = admin.firestore.FieldValue.arrayUnion({
      type: 'spike_repair',
      repairedAt: Date.now(),
      repairedBy: context.auth.uid,
      previousCash: userData.cash,
      correctedCash: victim.correctedCash,
      tookBailout: victim.tookBailout,
      holdingsRestored: victim.holdingsToRestore ? Object.keys(victim.holdingsToRestore).length : 0
    });

    await userRef.update(updates);

    return { success: true, userId, correctedCash: victim.correctedCash };
  }

  // --- REPAIR ALL MODE ---
  if (mode === 'repairAll') {
    if (!victimsInput || !Array.isArray(victimsInput)) {
      throw new functions.https.HttpsError('invalid-argument', 'victims array required');
    }

    const results = [];
    for (const victim of victimsInput) {
      try {
        const userRef = db.collection('users').doc(victim.userId);
        const userSnap = await userRef.get();
        if (!userSnap.exists) {
          results.push({ userId: victim.userId, success: false, error: 'not found' });
          continue;
        }

        const userData = userSnap.data();
        const updates = {
          cash: Math.round(victim.correctedCash * 100) / 100,
          isBankrupt: false
        };

        if (userData.bankruptAt) {
          updates.bankruptAt = admin.firestore.FieldValue.delete();
        }

        if (victim.tookBailout && victim.holdingsToRestore) {
          updates.holdings = victim.holdingsToRestore;
          if (victim.costBasisToRestore) {
            updates.costBasis = victim.costBasisToRestore;
          }
        }

        updates._repairLog = admin.firestore.FieldValue.arrayUnion({
          type: 'spike_repair',
          repairedAt: Date.now(),
          repairedBy: context.auth.uid,
          previousCash: userData.cash,
          correctedCash: victim.correctedCash,
          tookBailout: victim.tookBailout,
          holdingsRestored: victim.holdingsToRestore ? Object.keys(victim.holdingsToRestore).length : 0
        });

        await userRef.update(updates);
        results.push({ userId: victim.userId, success: true });
      } catch (err) {
        results.push({ userId: victim.userId, success: false, error: err.message });
      }
    }

    return { results };
  }

  throw new functions.https.HttpsError('invalid-argument', 'Invalid mode. Use scan, repair, or repairAll');
});

/**
 * Reconstruct portfolio history from permanent trades + price history archives.
 * For each user's trades (sorted ascending), rebuild holdings state and calculate
 * portfolio value = cashAfter + sum(longShares * historicalPrice).
 * Writes reconstructed points to users/{uid}/portfolioHistory subcollection,
 * skipping timestamps that already have entries.
 *
 * data.uid — optional; if provided, runs for that user only. Otherwise all non-bot users.
 */
exports.reconstructPortfolioHistory = cf({ timeoutSeconds: 540, memory: '1GB' })
  .https.onCall(async (data, context) => {
    requireAppCheck(context);
    if (!context.auth || context.auth.uid !== ADMIN_UID) {
      throw new functions.https.HttpsError('permission-denied', 'Admin only');
    }

    const targetUid = data && data.uid ? data.uid : null;
    const batchLimit = (data && data.limit) ? Math.min(data.limit, 100) : 50;
    const startAfterUid = data && data.startAfterUid ? data.startAfterUid : null;

    // 1. Determine which users to process
    let userDocs = [];
    let nextCursor = null;
    let done = true;

    if (targetUid) {
      const doc = await db.collection('users').doc(targetUid).get();
      if (!doc.exists) throw new functions.https.HttpsError('not-found', 'User not found');
      userDocs = [doc];
    } else {
      // Order by document ID for stable cursor-based pagination.
      // Pass startAfterUid as the raw string cursor value (documentId ordering
      // accepts the ID value directly without needing a snapshot fetch).
      let q = db.collection('users')
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(batchLimit + 1); // fetch one extra to detect if more pages remain
      if (startAfterUid) {
        q = q.startAfter(startAfterUid);
      }
      const snap = await q.get();
      // Filter bots; if extra doc exists, there are more pages
      const allDocs = snap.docs;
      const hasMore = allDocs.length > batchLimit;
      const pageDocs = hasMore ? allDocs.slice(0, batchLimit) : allDocs;
      userDocs = pageDocs.filter(d => !d.data().isBot);
      if (hasMore) {
        nextCursor = pageDocs[pageDocs.length - 1].id;
        done = false;
      }
    }

    // 2. Load full price history for all tickers (recent + archived) — done once
    const liveHistDoc = await priceHistoryRef().get();
    const recentPriceHistory = liveHistDoc.exists ? (liveHistDoc.data() || {}) : {};

    const archivedSnaps = await db.collection('market').doc('current')
      .collection('price_history').get();

    // Merge: archived (older) + recent (newer), sorted ascending by timestamp
    const fullPriceHistory = {};
    for (const [ticker, entries] of Object.entries(recentPriceHistory)) {
      fullPriceHistory[ticker] = Array.isArray(entries) ? [...entries] : [];
    }
    for (const archDoc of archivedSnaps.docs) {
      const ticker = archDoc.id;
      const archived = archDoc.data().history || [];
      const existing = fullPriceHistory[ticker] || [];
      const merged = [...archived, ...existing];
      merged.sort((a, b) => a.timestamp - b.timestamp);
      fullPriceHistory[ticker] = merged;
    }

    // Helper: binary-search closest price for a ticker at a timestamp
    const getPriceAt = (ticker, ts) => {
      const hist = fullPriceHistory[ticker];
      if (!hist || hist.length === 0) return 0;
      let lo = 0, hi = hist.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (hist[mid].timestamp < ts) lo = mid + 1;
        else hi = mid;
      }
      if (lo > 0 && Math.abs(hist[lo - 1].timestamp - ts) < Math.abs(hist[lo].timestamp - ts)) {
        return hist[lo - 1].price || 0;
      }
      return hist[lo].price || 0;
    };

    const toMs = (ts) => (ts && ts.toMillis) ? ts.toMillis() : (ts || 0);

    // 3. Process each user
    let totalPointsWritten = 0;
    let usersProcessed = 0;
    let usersSkipped = 0;
    let errors = 0;

    for (const userDoc of userDocs) {
      const uid = userDoc.id;
      try {
        // Load trades sorted by timestamp ascending
        const tradesSnap = await db.collection('trades')
          .where('uid', '==', uid)
          .orderBy('timestamp', 'asc')
          .get();

        if (tradesSnap.empty) { usersSkipped++; continue; }

        // Load existing subcollection timestamps to avoid duplicates
        const existingSnap = await db.collection('users').doc(uid)
          .collection('portfolioHistory').select('timestamp').get();
        const existingTs = new Set(existingSnap.docs.map(d => d.data().timestamp));

        // Walk trades forward, maintaining long holdings state
        const longHoldings = {}; // ticker -> shares
        const points = [];

        for (const tradeDoc of tradesSnap.docs) {
          const t = tradeDoc.data();
          const ts = toMs(t.timestamp);
          const { ticker, action, amount, cashAfter } = t;

          if (typeof cashAfter !== 'number' || !ticker || !action) continue;

          // Update long holdings
          if (action === 'buy') {
            longHoldings[ticker] = (longHoldings[ticker] || 0) + (amount || 0);
          } else if (action === 'sell') {
            longHoldings[ticker] = Math.max(0, (longHoldings[ticker] || 0) - (amount || 0));
          }
          // short/cover: cashAfter already captures margin effects on cash;
          // unrealized short P&L is omitted (approximation).

          const holdingsValue = Object.entries(longHoldings).reduce((sum, [t2, shares]) => {
            return shares > 0 ? sum + shares * getPriceAt(t2, ts) : sum;
          }, 0);

          const value = Math.round((cashAfter + holdingsValue) * 100) / 100;

          if (!existingTs.has(ts) && value > 0) {
            points.push({ timestamp: ts, value });
            existingTs.add(ts); // dedupe within this run
          }
        }

        // Write in batches of 400
        const histRef = db.collection('users').doc(uid).collection('portfolioHistory');
        for (let i = 0; i < points.length; i += 400) {
          const batch = db.batch();
          for (const point of points.slice(i, i + 400)) {
            batch.set(histRef.doc(), point);
          }
          await batch.commit();
        }

        totalPointsWritten += points.length;
        usersProcessed++;
      } catch (err) {
        console.error(`Reconstruction failed for ${uid}:`, err.message);
        errors++;
      }
    }

    return { usersProcessed, usersSkipped, totalPointsWritten, errors, nextCursor, done };
  });
