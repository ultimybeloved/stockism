// The admin player file: everything stored about one player, in one read.
//
// Read-only apart from the private notes, which live in `adminNotes/{uid}`
// (Cloud Functions only, never shown to the player). Each source is fetched
// separately and a failing one comes back empty, so one missing index or
// collection can never blank the whole file.
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { cf, requireAdmin } from '../shared/fnConfig';
import { logAdminAction } from '../shared/adminLog';
import { reportError } from '../shared/sentry';

const db = admin.firestore();

const LEDGER_LIMIT = 400;
const TRADES_LIMIT = 300;
const HISTORY_LIMIT = 180;
const NOTE_MAX_LENGTH = 2000;
const NOTES_MAX = 300;

/** Firestore values made JSON-safe: Timestamps become milliseconds. */
export function toPlain(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toMillis();
  if (Array.isArray(value)) return value.map(toPlain);
  if (value && typeof value === 'object') {
    const v = value as { toMillis?: () => number; _seconds?: number };
    if (typeof v.toMillis === 'function') return v.toMillis();
    const out: Record<string, unknown> = {};
    for (const [k, inner] of Object.entries(value)) out[k] = toPlain(inner);
    return out;
  }
  return value;
}

const docs = (snap: admin.firestore.QuerySnapshot) =>
  snap.docs.map((d) => ({ id: d.id, ...(toPlain(d.data()) as object) }));

// One source of the file. A failure is reported and comes back as `fallback`.
async function part<T>(name: string, uid: string, fallback: T, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    reportError(err, { where: 'adminGetPlayerFile', part: name, uid });
    return fallback;
  }
}

const cleanUid = (data: unknown) => {
  const uid = String((data as { uid?: unknown } | null)?.uid || '').trim();
  if (!uid || uid.length > 128 || uid.includes('/')) {
    throw new functions.https.HttpsError('invalid-argument', 'uid required');
  }
  return uid;
};

export const adminGetPlayerFile = cf({ memory: '512MB' }).https.onCall(async (data, context) => {
  requireAdmin(context);
  const uid = cleanUid(data);

  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) throw new functions.https.HttpsError('not-found', 'No player with that ID');
  const user = toPlain(userSnap.data()) as Record<string, unknown>;
  const discordId = typeof user.discordId === 'string' ? user.discordId : null;
  const userRef = db.collection('users').doc(uid);

  const [
    auth,
    ledger,
    trades,
    eventTrades,
    adminActions,
    giftsSent,
    giftsReceived,
    notes,
    welcome,
    discordActivity,
    ladder,
    limitOrders,
    preMarketOrders,
    priceAlerts,
    watched,
    watchAlerts,
    history,
    notifications,
    confirmedManipulator,
    pastDiscords,
  ] = await Promise.all([
    part('auth', uid, null, async () => {
      const rec = await admin.auth().getUser(uid);
      return {
        email: rec.email || null,
        emailVerified: rec.emailVerified,
        disabled: rec.disabled,
        providers: rec.providerData.map((p) => p.providerId),
        createdAt: Date.parse(rec.metadata.creationTime) || null,
        lastSignInAt: Date.parse(rec.metadata.lastSignInTime) || null,
        lastRefreshAt: rec.metadata.lastRefreshTime ? Date.parse(rec.metadata.lastRefreshTime) : null,
      };
    }),
    part('ledger', uid, [], async () =>
      docs(
        await db.collection('ledger').where('uid', '==', uid).orderBy('timestamp', 'desc').limit(LEDGER_LIMIT).get(),
      ),
    ),
    part('trades', uid, [], async () =>
      docs(
        await db.collection('trades').where('uid', '==', uid).orderBy('timestamp', 'desc').limit(TRADES_LIMIT).get(),
      ),
    ),
    part('eventTrades', uid, [], async () =>
      docs(await db.collection('eventTrades').where('uid', '==', uid).limit(200).get()),
    ),
    part('adminLog', uid, [], async () =>
      docs(await db.collection('adminLog').where('uid', '==', uid).limit(300).get()),
    ),
    part('giftsSent', uid, [], async () =>
      docs(await db.collection('giftLog').where('fromUid', '==', uid).limit(200).get()),
    ),
    part('giftsReceived', uid, [], async () =>
      docs(await db.collection('giftLog').where('toUid', '==', uid).limit(200).get()),
    ),
    part('notes', uid, [], async () => {
      const snap = await db.collection('adminNotes').doc(uid).get();
      return (toPlain(snap.data()?.notes || []) as unknown[]) || [];
    }),
    part('welcome', uid, null, async () => {
      if (!discordId) return null;
      const snap = await db.collection('welcomeStreaks').doc(discordId).get();
      return snap.exists ? toPlain(snap.data()) : null;
    }),
    part('discordActivity', uid, null, async () => {
      if (!discordId) return null;
      const snap = await db.collection('discordActivity').doc(discordId).get();
      return snap.exists ? toPlain(snap.data()) : null;
    }),
    part('ladder', uid, null, async () => {
      const snap = await db.collection('ladderGameUsers').doc(uid).get();
      return snap.exists ? toPlain(snap.data()) : null;
    }),
    part('limitOrders', uid, [], async () =>
      docs(await db.collection('limitOrders').where('userId', '==', uid).limit(100).get()),
    ),
    part('preMarketOrders', uid, [], async () =>
      docs(await db.collection('preMarketOrders').where('userId', '==', uid).limit(100).get()),
    ),
    part('priceAlerts', uid, [], async () => docs(await userRef.collection('priceAlerts').limit(100).get())),
    part('watched', uid, null, async () => {
      const snap = await db.collection('watchedUsers').doc(uid).get();
      return snap.exists ? toPlain(snap.data()) : null;
    }),
    part('watchAlerts', uid, [], async () => {
      const [a, b] = await Promise.all([
        db.collection('watchlist_alerts').where('watchedUID', '==', uid).limit(100).get(),
        db.collection('watchlist_alerts').where('relatedUID', '==', uid).limit(100).get(),
      ]);
      return [...docs(a), ...docs(b)];
    }),
    part('history', uid, [], async () =>
      docs(await userRef.collection('portfolioHistory').orderBy('timestamp', 'desc').limit(HISTORY_LIMIT).get()),
    ),
    part('notifications', uid, [], async () =>
      docs(await userRef.collection('notifications').orderBy('createdAt', 'desc').limit(50).get()),
    ),
    part('confirmedManipulator', uid, false, async () => {
      const snap = await db.collection('botState').doc('manipulators').get();
      return !!snap.data()?.uids?.[uid];
    }),
    // Discords the player unlinked themselves (the binding is keyed by Discord
    // ID). Admin unlinks and moves are in adminActions instead.
    part('pastDiscords', uid, [], async () =>
      docs(await db.collection('discordBindings').where('uid', '==', uid).limit(50).get()),
    ),
  ]);

  return {
    uid,
    user,
    auth,
    ledger,
    trades,
    eventTrades,
    adminActions,
    giftsSent,
    giftsReceived,
    notes,
    welcome,
    discordActivity,
    ladder,
    limitOrders,
    preMarketOrders,
    priceAlerts,
    watched,
    watchAlerts,
    history,
    notifications,
    confirmedManipulator,
    pastDiscords,
  };
});

/** Admin-only: add a private note to a player's file. */
export const adminAddPlayerNote = cf().https.onCall(async (data, context) => {
  requireAdmin(context);
  const uid = cleanUid(data);
  const text = String(data?.text || '')
    // eslint-disable-next-line no-control-regex -- strips control characters except newlines on purpose
    .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '')
    .trim();
  if (!text) throw new functions.https.HttpsError('invalid-argument', 'Write something first');
  if (text.length > NOTE_MAX_LENGTH) {
    throw new functions.https.HttpsError('invalid-argument', `Notes must be ${NOTE_MAX_LENGTH} characters or less`);
  }
  const ref = db.collection('adminNotes').doc(uid);
  const note = { id: db.collection('adminNotes').doc().id, text, at: Date.now(), by: context.auth!.uid };
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const notes = (snap.data()?.notes || []) as unknown[];
    if (notes.length >= NOTES_MAX) {
      throw new functions.https.HttpsError('resource-exhausted', 'This player has too many notes. Delete some first.');
    }
    tx.set(ref, { notes: FieldValue.arrayUnion(note), updatedAt: note.at }, { merge: true });
  });
  await logAdminAction(context, { action: 'add_note', uid, after: text });
  return { note };
});

/** Admin-only: delete one private note. */
export const adminDeletePlayerNote = cf().https.onCall(async (data, context) => {
  requireAdmin(context);
  const uid = cleanUid(data);
  const noteId = String(data?.noteId || '');
  const ref = db.collection('adminNotes').doc(uid);
  const removed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const notes = (snap.data()?.notes || []) as { id: string; text: string }[];
    const gone = notes.find((n) => n.id === noteId);
    if (!gone) throw new functions.https.HttpsError('not-found', 'Note not found');
    tx.set(ref, { notes: notes.filter((n) => n.id !== noteId), updatedAt: Date.now() }, { merge: true });
    return gone;
  });
  await logAdminAction(context, { action: 'delete_note', uid, before: removed.text });
  return { ok: true };
});
