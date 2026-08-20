import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { getMostRecentHaltWindow } from '../../utils/marketHours';

// Keeps market/reviewChanges — what the Review tab shows as the chapter's
// adjustment — in step with the admin panel while a review is still in progress.
//
// The server builds that doc once, when the recap posts at 20:30 UTC. Anything
// the admin adjusted after that landed outside it, so a second pass at the same
// stock (the usual "that move was too small, nudge it again") was read as market
// drift and shown as "since then" instead of as part of the adjustment. Every
// adjustment now folds itself in: the first one for a ticker fixes oldPrice, and
// each later one only moves newPrice, so the badge always shows the whole
// change from where the stock started the review.
//
// Halt window only. Outside it the market is trading, and start → finish would
// sweep real price movement into the admin's number.
const reviewChangesRef = () => doc(db, 'market', 'reviewChanges');

export const recordReviewAdjustment = async ({ ticker, oldPrice, newPrice, at = Date.now() }) => {
  const { start, end } = getMostRecentHaltWindow();
  if (at < start || at > end) return false;

  const snap = await getDoc(reviewChangesRef());
  const stored = snap.exists() ? (snap.data() || {}) : {};
  // A doc from a previous review is last week's news — start the window clean.
  const changes = stored.windowEnd === end ? { ...(stored.changes || {}) } : {};

  // Where the stock stood before the admin's FIRST adjustment this review.
  const basePrice = changes[ticker]?.oldPrice ?? oldPrice;
  if (!(basePrice > 0)) return false;

  if (basePrice === newPrice) {
    // Adjusted back to where it started — nothing changed this review.
    delete changes[ticker];
  } else {
    changes[ticker] = {
      oldPrice: basePrice,
      newPrice,
      percentChange: ((newPrice - basePrice) / basePrice) * 100,
    };
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
