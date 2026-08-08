'use strict';
// Persist what the admin actually changed during a chapter review. INTERNAL
// MODULE — required by market.js, not exported through functions/index.js.
//
// Why this exists: the Review tab used to recompute the whole thing in the
// browser from the LIVE price history, which only keeps PRICE_HISTORY_LIVE_MAX
// points per ticker. Deriving a change needs the point *immediately before* the
// admin's first adjustment, and an actively traded stock churns past that in
// under a day — at which point the ticker silently disappeared from the tab.
// SHNG dropped off within a day of the 2026-08-06 review for exactly this
// reason; its oldest surviving live point was already past the halt window.
//
// So the result is computed once, while the data is still complete, and stored
// at market/reviewChanges for the tab to read.

const admin = require('firebase-admin');
const db = admin.firestore();

const { priceHistoryRef, getAdminReviewAdjustments } = require('../helpers');

const REVIEW_DOC = 'reviewChanges';

/**
 * Live price history, optionally with the permanent archive stitched in front.
 *
 * The scheduled run does not need the archive — at 20:30 on review day nothing
 * has been trimmed yet. The admin backfill does, because by then the window may
 * have rolled out of the live doc entirely.
 */
const loadHistory = async ({ includeArchive }) => {
  const snap = await priceHistoryRef().get();
  const live = snap.exists ? (snap.data() || {}) : {};
  if (!includeArchive) return live;

  const archiveColRef = db.collection('market').doc('current').collection('price_history');
  const archiveSnap = await archiveColRef.get();

  const merged = { ...live };
  archiveSnap.forEach((doc) => {
    const archived = doc.data()?.history;
    if (!Array.isArray(archived) || archived.length === 0) return;
    // Archive holds the OLDER points, so it goes in front.
    merged[doc.id] = [...archived, ...(live[doc.id] || [])];
  });
  return merged;
};

/**
 * Compute the review changes for one halt window and store them.
 * Returns the stored payload.
 */
const writeReviewChanges = async ({ haltStart, haltEnd, fallbackPrices = {}, includeArchive = false }) => {
  const priceHistory = await loadHistory({ includeArchive });
  const adjustments = getAdminReviewAdjustments(priceHistory, haltStart, haltEnd, fallbackPrices);

  // Stored in the shape the Review tab already speaks, so the frontend does not
  // have to translate two vocabularies.
  const changes = {};
  for (const [ticker, adj] of Object.entries(adjustments)) {
    changes[ticker] = {
      oldPrice: adj.before,
      newPrice: adj.after,
      percentChange: adj.change,
    };
  }

  const payload = {
    windowStart: haltStart,
    windowEnd: haltEnd,
    generatedAt: Date.now(),
    tickerCount: Object.keys(changes).length,
    changes,
  };

  await db.collection('market').doc(REVIEW_DOC).set(payload);
  console.log(`reviewChanges written: ${payload.tickerCount} tickers for window ending ${new Date(haltEnd).toISOString()}`);
  return payload;
};

module.exports = { writeReviewChanges };
