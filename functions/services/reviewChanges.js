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

const { priceHistoryRef, getReviewWindowChanges } = require('../helpers');
const { WEEKLY_HALT_START_MINUTE, PRE_MARKET_LOCK_MINUTE } = require('../constants');

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
 * Put a collapsed review's detail back, just for measuring.
 *
 * Once a review is collapsed the chart keeps ONE point per stock and the
 * step-by-step detail moves to market/reviewDetail. Nothing is lost, but a
 * rebuild reading only the live history would find a single point it cannot
 * split and would drop the stock from the tab entirely — 20 of 39 stocks on
 * 2026-08-20. So the stash is spliced back in here. The chart is untouched;
 * this copy only ever exists in memory for the length of the rebuild.
 */
const withCollapsedDetail = async (history, haltEnd) => {
  const snap = await db.collection('market').doc('reviewDetail').get();
  const stash = snap.exists ? snap.data() : null;
  if (!stash || stash.windowEnd !== haltEnd) return history;

  const restored = { ...history };
  for (const [ticker, points] of Object.entries(stash.detail || {})) {
    if (!Array.isArray(points) || points.length === 0) continue;
    const withoutPlaceholder = (restored[ticker] || []).filter((p) => !p?.collapsed);
    restored[ticker] = [...withoutPlaceholder, ...points].sort((a, b) => a.timestamp - b.timestamp);
  }
  return restored;
};

/**
 * Compute the review changes for one halt window and store them.
 * Returns the stored payload.
 */
const writeReviewChanges = async ({ haltStart, haltEnd, fallbackPrices = {}, includeArchive = false }) => {
  const priceHistory = await withCollapsedDetail(await loadHistory({ includeArchive }), haltEnd);
  // The review stops at the pre-market lock. The opening auction settles at
  // 20:56, still inside the halt, and those are real fills at real demand — not
  // something the chapter review did.
  const reviewEnd = haltStart + (PRE_MARKET_LOCK_MINUTE - WEEKLY_HALT_START_MINUTE) * 60 * 1000;

  // Already in the shape the Review tab speaks, so nothing to translate.
  const changes = getReviewWindowChanges(priceHistory, haltStart, reviewEnd, fallbackPrices);

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
