// Admin market guard: the confirmed-manipulator list the bot guard and the
// stabilizer act on, what the guard has done lately, and the accounts the
// coordination scan flags most (to help decide who to confirm).
//
// Confirming is always the admin's click. Nothing adds anyone automatically.
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { cf, requireAdmin } from '../shared/fnConfig';
import { logAdminAction } from '../shared/adminLog';
import { manipulatorsRef, storylinesRef } from '../market/manipulatorActivity';

const db = admin.firestore();
const CANDIDATE_DAYS = 60;
const CANDIDATES_MAX = 25;

const toMs = (v: unknown) => (v instanceof Timestamp ? v.toMillis() : typeof v === 'number' ? v : 0);

const buildList = async () => {
  const [confSnap, stateSnap, alertSnap] = await Promise.all([
    manipulatorsRef().get(),
    storylinesRef().get(),
    db.collection('watchlist_alerts').where('type', '==', 'coordinated_pressure').get(),
  ]);
  const confirmedMap = (confSnap.data()?.uids || {}) as Record<string, { name?: string; at?: number; by?: string }>;
  const confirmed = Object.entries(confirmedMap)
    .map(([uid, e]) => ({ uid, name: e.name || uid, at: e.at || 0 }))
    .sort((a, b) => b.at - a.at);

  // Most-flagged accounts over the last 60 days, with who they were flagged with.
  const since = Date.now() - CANDIDATE_DAYS * 86_400_000;
  const flagged = new Map<
    string,
    { uid: string; name: string; flags: number; tight: number; last: number; partners: Record<string, number> }
  >();
  for (const doc of alertSnap.docs) {
    const a = doc.data();
    const at = toMs(a.timestamp);
    if (at < since) continue;
    const uids: string[] = a.participantUIDs || [a.watchedUID, a.relatedUID].filter(Boolean);
    const names: string[] = a.participants || [];
    uids.forEach((uid, i) => {
      const row = flagged.get(uid) || { uid, name: names[i] || uid, flags: 0, tight: 0, last: 0, partners: {} };
      row.flags++;
      if (a.tightCluster) row.tight++;
      row.last = Math.max(row.last, at);
      uids.forEach((other, j) => {
        if (other !== uid) row.partners[names[j] || other] = (row.partners[names[j] || other] || 0) + 1;
      });
      flagged.set(uid, row);
    });
  }
  const candidates = [...flagged.values()]
    .sort((a, b) => b.flags - a.flags)
    .slice(0, CANDIDATES_MAX)
    .map((r) => ({
      ...r,
      confirmed: !!confirmedMap[r.uid],
      partners: Object.entries(r.partners)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([name, n]) => ({ name, n })),
    }));

  return {
    confirmed,
    candidates,
    guardLog: stateSnap.data()?.guardLog || [],
    botsUpdatedAt: stateSnap.data()?.updatedAt || null,
  };
};

/**
 * Admin-only. `{ action: 'list' }` returns the screen; `{ action: 'set', uid,
 * confirmed }` adds or removes one account and returns the screen.
 */
export const adminMarketGuard = cf().https.onCall(async (data, context) => {
  requireAdmin(context);
  if (data?.action === 'set') {
    const uid = String(data.uid || '').trim();
    if (!uid || uid.length > 128 || uid.includes('/')) {
      throw new functions.https.HttpsError('invalid-argument', 'uid required');
    }
    const confirmed = !!data.confirmed;
    if (confirmed) {
      const user = await db.collection('users').doc(uid).get();
      if (!user.exists) throw new functions.https.HttpsError('not-found', 'No player with that ID');
      if (user.data()?.isAdmin)
        throw new functions.https.HttpsError('failed-precondition', 'Admins cannot be confirmed');
      await manipulatorsRef().set(
        { uids: { [uid]: { name: user.data()?.displayName || uid, at: Date.now(), by: context.auth!.uid } } },
        { merge: true },
      );
    } else {
      await manipulatorsRef().set({ uids: { [uid]: FieldValue.delete() } }, { merge: true });
    }
    await logAdminAction(context, {
      action: confirmed ? 'confirm_manipulator' : 'unconfirm_manipulator',
      uid,
    });
  }
  return buildList();
});
