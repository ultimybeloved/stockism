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
const { WEEKLY_HALT_START_MINUTE, PRE_MARKET_LOCK_MINUTE, REVIEW_COLLAPSE_MINUTE } = require('../constants');

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

/**
 * Fold a chapter review's price-history staircase down to a single point.
 *
 * Adjusting one stock drags every stock linked to it, so a review leaves each
 * stock with a run of points inside the halt — trailing, trailing, admin,
 * trailing — which on a chart is indistinguishable from people trading through
 * the halt. It caused a live argument on 2026-08-20.
 *
 * This NEVER changes a price. It removes the intermediate steps and keeps the
 * last one, so the stock closes the review exactly where the admin put it.
 * Points that are not the review (real trades, the 20:56 auction, the daily
 * drop) are left alone.
 *
 * The detail is stashed at market/reviewDetail first, in the same transaction,
 * so writeReviewChanges can still rebuild the set/knock-on split afterwards and
 * the admin can still view the real history.
 *
 * One transaction, because the doc it rewrites is the same one every trade
 * appends to. Reading it, rebuilding arrays and writing back outside one would
 * silently drop any point a trade added in between.
 */
const collapseReviewWindow = async ({ haltStart, haltEnd }) => {
  const reviewEnd = haltStart + (PRE_MARKET_LOCK_MINUTE - WEEKLY_HALT_START_MINUTE) * 60 * 1000;
  const stamp = haltStart + (REVIEW_COLLAPSE_MINUTE - WEEKLY_HALT_START_MINUTE) * 60 * 1000;
  const REVIEW_SOURCES = new Set(['admin_adjust', 'trailing']);

  let tidied = 0;
  let folded = 0;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(priceHistoryRef());
    const history = snap.exists ? (snap.data() || {}) : {};

    const updates = {};
    const detail = {};
    tidied = 0;
    folded = 0;

    for (const [ticker, points] of Object.entries(history)) {
      if (!Array.isArray(points)) continue;
      const sorted = points.slice().sort((a, b) => a.timestamp - b.timestamp);

      const reviewPts = sorted.filter((p) => p
        && p.timestamp >= haltStart && p.timestamp <= reviewEnd
        && REVIEW_SOURCES.has(p.source) && !p.collapsed);
      if (reviewPts.length < 2) continue; // already one move, nothing to tidy

      const last = reviewPts[reviewPts.length - 1];
      const kept = sorted.filter((p) => !reviewPts.includes(p));

      // Never let the collapsed point jump ahead of something real. Only points
      // AFTER the last review move can block it: anything earlier (a daily drop
      // mid-halt) should simply sit before it. Looking at the whole window
      // instead moved the point behind an earlier drop and rewrote the stock's
      // closing price, which the guard below then rejected outright.
      const blocker = kept.find((p) => p.timestamp > last.timestamp && p.timestamp <= haltEnd);
      const at = blocker ? Math.min(stamp, blocker.timestamp - 1) : stamp;

      // Tagged admin_adjust on purpose: isPriceProtected keys off that tag and
      // the review's result must stay protected from bots and the market maker.
      // `collapsed` tells the review-split readers the detail has moved.
      const merged = { timestamp: at, price: last.price, source: 'admin_adjust', collapsed: true };
      const next = [...kept, merged].sort((a, b) => a.timestamp - b.timestamp);

      // A collapse that moves the live price is a bug, not a tidy-up.
      if (sorted[sorted.length - 1].price !== next[next.length - 1].price) {
        throw new Error(`collapseReviewWindow: ${ticker} would change the last price`);
      }

      updates[ticker] = next;
      detail[ticker] = reviewPts;
      tidied += 1;
      folded += reviewPts.length - 1;
    }

    if (tidied === 0) return;

    tx.set(db.collection('market').doc('reviewDetail'), {
      windowStart: haltStart, windowEnd: haltEnd, savedAt: Date.now(), detail,
    });
    tx.set(priceHistoryRef(), updates, { merge: true });
  });

  console.log(`collapseReviewWindow: ${tidied} stocks tidied, ${folded} intermediate points folded`);
  return { tidied, folded };
};

module.exports = { writeReviewChanges, collapseReviewWindow };
