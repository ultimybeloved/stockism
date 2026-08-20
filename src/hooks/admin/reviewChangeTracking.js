import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { getMostRecentHaltWindow } from '../../utils/marketHours';

// Keeps market/reviewChanges — what the Review tab shows for the chapter — in
// step with the admin panel while a review is still in progress.
//
// The server builds that doc once, when the recap posts at 20:30 UTC. Anything
// adjusted after that used to land outside it, so a second pass at the same
// stock (the usual "that move was too small, nudge it again") was read as market
// drift and shown as "since then" instead of as part of the review. Every
// adjustment now folds itself in: the first move on a stock fixes oldPrice, and
// each later one only moves newPrice.
//
// Direct and knock-on moves are tracked apart. Adjusting one stock drags every
// stock linked to it, and those moves are the admin's doing but not the admin's
// decision, so the badge has to be able to say which was which.
//
// Halt window only. Outside it the market is trading, and start → finish would
// sweep real price movement in with the admin's.
const reviewChangesRef = () => doc(db, 'market', 'reviewChanges');

const blank = (openPrice) => ({
  oldPrice: openPrice,
  newPrice: openPrice,
  percentChange: 0,
  directChange: 0,
  trailingChange: 0,
  drivers: [],
});

/**
 * What the current review has done to each stock so far, keyed by ticker.
 * Empty outside a review, or when the stored doc is last week's.
 */
export const loadReviewChanges = async () => {
  const { end } = getMostRecentHaltWindow();
  const snap = await getDoc(reviewChangesRef());
  const stored = snap.exists() ? (snap.data() || {}) : {};
  return stored.windowEnd === end ? (stored.changes || {}) : {};
};

/**
 * Fold one price adjustment, plus every knock-on move it caused, into the
 * stored review changes.
 *
 *   direct   — { ticker, from, to } the admin set by hand
 *   trailing — [{ ticker, from, to }] dragged along by it
 */
export const recordReviewMoves = async ({ direct, trailing = [], at = Date.now() }) => {
  const { start, end } = getMostRecentHaltWindow();
  if (at < start || at > end) return false;

  const snap = await getDoc(reviewChangesRef());
  const stored = snap.exists() ? (snap.data() || {}) : {};
  // A doc from a previous review is last week's news — start the window clean.
  const changes = stored.windowEnd === end ? { ...(stored.changes || {}) } : {};

  // Every knock-on move in one adjustment traces back to the stock that was
  // typed in, which is what the Review tab groups by.
  const root = direct?.ticker;

  const apply = (move, key) => {
    if (!move || !(move.from > 0) || !(move.to > 0) || move.from === move.to) return;
    // No entry yet means this is the stock's first move of the review, so the
    // price it came in at is the price this move started from.
    const entry = { ...(changes[move.ticker] || blank(move.from)) };
    // Compound onto whichever half caused it, the same way the prices did.
    const factor = (1 + (entry[key] || 0) / 100) * (move.to / move.from);
    entry[key] = (factor - 1) * 100;
    entry.newPrice = move.to;
    if (key === 'trailingChange' && root) {
      entry.drivers = [...new Set([...(entry.drivers || []), root])];
    }
    entry.percentChange = entry.oldPrice > 0
      ? ((entry.newPrice - entry.oldPrice) / entry.oldPrice) * 100
      : 0;
    changes[move.ticker] = entry;
  };

  apply(direct, 'directChange');
  for (const move of trailing) apply(move, 'trailingChange');

  // A stock nudged back to exactly where it started did not change this review.
  for (const [ticker, change] of Object.entries(changes)) {
    if (change.oldPrice === change.newPrice) delete changes[ticker];
  }

  await setDoc(reviewChangesRef(), {
    windowStart: start,
    windowEnd: end,
    generatedAt: Date.now(),
    tickerCount: Object.keys(changes).length,
    changes,
  });
  return true;
};
