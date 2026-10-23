// The home page's "Recent trades" card (src/features/activity). Each bot round
// copies the trades since its last run into market/activity, with no name and
// no size, mixed with entries for the bot moves it just made. Bot entries are
// placed at random times across the same window so the bot clock can't be
// used to tell them apart. The window ends a few minutes back and the page
// shows each entry only once it is ACTIVITY_REVEAL_MS old, so the card fills
// in one trade at a time and never shows anything recent.
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import {
  ACTIVITY_LAG_MS,
  PER_RUN,
  JITTER_MS,
  MAX_WINDOW_MS,
  botItems,
  mergeItems,
  sideOf,
  thin,
  type ActivityItem,
} from './activityFeedRules';

const db = admin.firestore();
export const activityRef = () => db.collection('market').doc('activity');

/**
 * Called at the end of each bot round with the moves it applied. Never throws:
 * the card is decoration, the bot round is not.
 */
export async function publishActivity(moves: { ticker: string; frac: number }[], now = Date.now()) {
  try {
    const snap = await activityRef().get();
    const data = snap.data() || {};
    const to = now - ACTIVITY_LAG_MS;
    const from = Math.max(Number(data.cursor) || 0, to - MAX_WINDOW_MS);
    if (to <= from) return;

    const trades = await db
      .collection('trades')
      .where('timestamp', '>', new Date(from))
      .where('timestamp', '<=', new Date(to))
      .orderBy('timestamp')
      .select('ticker', 'action', 'timestamp')
      .get();
    const real: ActivityItem[] = [];
    for (const d of trades.docs) {
      const x = d.data();
      const s = sideOf(x.action);
      // Nudged up to a minute either way, so entries can't be lined up with chart points.
      const at = x.timestamp.toMillis() + Math.round((Math.random() - 0.5) * JITTER_MS);
      if (s && x.ticker) real.push({ t: x.ticker, s, at: Math.min(to, Math.max(from + 1, at)) });
    }
    const add = [...thin(real, PER_RUN), ...botItems(moves, from, to)];
    await activityRef().set({
      entries: mergeItems(data.entries || [], add),
      cursor: to,
      updatedAt: now,
    });
  } catch (err) {
    logger.error('publishActivity failed', err);
  }
}
