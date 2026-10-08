// Player notifications and the public feed.

import * as admin from 'firebase-admin';
import { FEED_TTL_MS } from './constants';
const db = admin.firestore();

// ============================================
// NOTIFICATION HELPER
// ============================================
// Writes a notification doc to users/{uid}/notifications subcollection
// Fire-and-forget — errors are logged but don't block the caller
export const writeNotification = async (
  uid: string,
  { type, title, message, data = {} }: { type: string; title: string; message: string; data?: Record<string, unknown> },
) => {
  try {
    await db.collection('users').doc(uid).collection('notifications').add({
      type, // 'trade', 'alert', 'achievement', 'margin', 'system'
      title,
      message,
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      data, // { ticker?, price?, orderId?, achievementId? }
    });
  } catch (err) {
    console.error(`Failed to write notification for ${uid}:`, (err as Error).message);
  }
};

// One public feed entry. Optional fields are stored as null when absent.
interface FeedEntry {
  type: string;
  userId?: string;
  displayName?: string;
  crew?: string | null;
  message: string;
  ticker?: string | null;
  action?: string | null;
  amount?: number | null;
  price?: number | null;
  achievementId?: string | null;
  displayAfter?: unknown;
}

// Writes a feed doc to the global feed collection (fire-and-forget)
export const writeFeedEntry = async ({
  type,
  userId,
  displayName,
  crew,
  message,
  ticker,
  action,
  amount,
  price,
  achievementId,
  displayAfter,
}: FeedEntry) => {
  try {
    // A Firestore TTL policy only acts on a TIMESTAMP field — it silently
    // ignores a numeric one. This was written as a plain number for as long as
    // the feed has existed, so even once the policy is switched on it would
    // have deleted nothing, with no error and no way to tell from the console.
    // 96.3% of the collection (54,817 docs) was still sitting there on
    // 2026-09-22, the oldest expired 190 days earlier.
    //
    // Nothing reads this field; it exists purely for the TTL policy to act on.
    const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + FEED_TTL_MS);
    await db.collection('feed').add({
      type, // 'trade', 'achievement', 'mission_complete'
      userId,
      displayName,
      crew: crew || null,
      ticker: ticker || null,
      action: action || null,
      amount: amount || null,
      price: price || null,
      achievementId: achievementId || null,
      message,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt,
      displayAfter: displayAfter || null,
    });
  } catch (err) {
    console.error('Failed to write feed entry:', (err as Error).message);
  }
};
