// Read side of the admin history (shared/adminLog.ts writes it).
//
// Read-only on purpose, like adminCashLog.ts: a bug here can never change
// anything. One page, newest first; the panel filters what it has, so no
// composite index is needed.
import { cf, requireAdmin } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
const db = admin.firestore();

const PAGE_MAX = 500;

export const adminListLog = cf().https.onCall(async (data: { limit?: unknown } | undefined, context) => {
  requireAdmin(context);
  const requested = Number(data?.limit);
  const limit = Math.min(PAGE_MAX, Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : PAGE_MAX);

  const snap = await db.collection('adminLog').orderBy('at', 'desc').limit(limit).get();
  return {
    success: true,
    entries: snap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        at: d.at?.toMillis ? d.at.toMillis() : null,
        action: d.action,
        by: d.by || null,
        uid: d.uid || null,
        name: d.name || null,
        before: d.before ?? null,
        after: d.after ?? null,
        detail: d.detail ?? null,
      };
    }),
  };
});
