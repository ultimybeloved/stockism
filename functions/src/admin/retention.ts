// Nightly clean-up of records nobody needs any more. INTERNAL MODULE, not in
// services.ts: scheduledArchiving runs it.
//
// Before this, read notifications, the connection record behind every limit
// order and the private copies of deleted accounts were kept forever.
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import {
  READ_NOTIFICATION_KEEP_MS,
  ORDER_ORIGIN_KEEP_MS,
  DELETED_ACCOUNT_KEEP_MS,
  RETENTION_MAX_DELETES_PER_RUN,
} from '../shared/constants';

const db = admin.firestore();
const BATCH_SIZE = 400;

/** Delete what the query matches, up to the nightly cap. Returns how many went. */
const purge = async (query: admin.firestore.Query): Promise<number> => {
  const snap = await query.limit(RETENTION_MAX_DELETES_PER_RUN).get();
  for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    snap.docs.slice(i, i + BATCH_SIZE).forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
  return snap.size;
};

export const runRetentionCleanup = async (now = Date.now()) => {
  const before = (keepMs: number) => Timestamp.fromMillis(now - keepMs);
  return {
    // Needs the notifications (read, createdAt) collection-group index.
    notifications: await purge(
      db
        .collectionGroup('notifications')
        .where('read', '==', true)
        .where('createdAt', '<', before(READ_NOTIFICATION_KEEP_MS)),
    ),
    // createdAt here is a plain millisecond number (orderNetwork.ts).
    orderOrigins: await purge(db.collection('orderOrigins').where('createdAt', '<', now - ORDER_ORIGIN_KEEP_MS)),
    deletedAccounts: await purge(
      db.collection('deletedUsers').where('deletedAt', '<', before(DELETED_ACCOUNT_KEEP_MS)),
    ),
  };
};
