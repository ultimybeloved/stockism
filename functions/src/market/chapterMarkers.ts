// Chapter markers on the charts (rules/chapterMarkers): market/chapterMarkers,
// world-readable, one entry per Thursday review, newest first.
//
// weeklyCallsLock saves the prices when the halt begins (13:00 UTC) and
// weeklyCallsResolve records the marker from them at 20:55, before the opening
// auction moves anything. Both are named for the weekly Calls they once scored
// (removed before launch); deployed functions can't be renamed. The price lock
// doc keeps its old name too, market/callBaseline. adminSetChapterNote lets the
// admin name a chapter and add a line about it.
import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { cf, requireAdmin } from '../shared/fnConfig';
import { recordHeartbeat } from '../shared/activity';
import { reportError } from '../shared/sentry';
import { isRosterTicker } from '../shared/roster';
import { indexFromStored, type StoredIndex } from '../shared/indexMaintenance';
import { logAdminAction } from '../shared/adminLog';
import { getWeekId } from '../shared/tradeRecords';
import {
  buildChapterMarker,
  upsertChapterMarker,
  CHAPTER_LABEL_MAX,
  CHAPTER_NOTE_MAX,
  type ChapterMarker,
} from '../shared/rules/chapterMarkers';
const db = admin.firestore();

export const chapterMarkersRef = () => db.collection('market').doc('chapterMarkers');

/** market/callBaseline: { weekId, prices, savedAt }, the prices when the halt began. */
export const haltPriceLockRef = () => db.collection('market').doc('callBaseline');

export async function lockHaltPrices(now = Date.now()) {
  const market = await db.collection('market').doc('current').get();
  await haltPriceLockRef().set({ weekId: getWeekId(now), prices: market.data()?.prices || {}, savedAt: now });
}

const onlyRoster = (prices: Record<string, number>) =>
  Object.fromEntries(Object.entries(prices).filter(([t]) => isRosterTicker(t)));

/** This week's marker from the halt lock and the current prices. Safe to re-run. */
export async function recordChapterMarker(now = Date.now()) {
  const weekId = getWeekId(now);
  const [base, market, idx] = await Promise.all([
    haltPriceLockRef().get(),
    db.collection('market').doc('current').get(),
    db.collection('market').doc('indexHistory').get(),
  ]);
  const b = base.data();
  if (!b || b.weekId !== weekId) throw new Error(`No halt price lock for week ${weekId}; no chapter marker.`);
  const before = onlyRoster(b.prices || {});
  const after = onlyRoster(market.data()?.prices || {});
  const stored = (idx.exists ? idx.data() : null) as StoredIndex | null;
  const marker = buildChapterMarker({
    weekId,
    at: Number(b.savedAt) || now,
    before,
    after,
    indexBefore: indexFromStored(before, stored),
    indexAfter: indexFromStored(after, stored),
  });
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(chapterMarkersRef());
    tx.set(chapterMarkersRef(), {
      markers: upsertChapterMarker((snap.data()?.markers as ChapterMarker[]) || [], marker),
      updatedAt: now,
    });
  });
  return marker;
}

export const adminSetChapterNote = cf().https.onCall(
  async (data: { weekId?: unknown; label?: unknown; note?: unknown }, context) => {
    requireAdmin(context);
    const weekId = typeof data?.weekId === 'string' ? data.weekId : '';
    const label = typeof data?.label === 'string' ? data.label.trim().slice(0, CHAPTER_LABEL_MAX) : '';
    const note = typeof data?.note === 'string' ? data.note.trim().slice(0, CHAPTER_NOTE_MAX) : '';
    if (!weekId) throw new functions.https.HttpsError('invalid-argument', 'Pick a chapter.');
    const before = await db.runTransaction(async (tx) => {
      const snap = await tx.get(chapterMarkersRef());
      const markers = ((snap.data()?.markers as ChapterMarker[]) || []).slice();
      const i = markers.findIndex((m) => m.weekId === weekId);
      if (i === -1) throw new functions.https.HttpsError('not-found', 'No marker for that week.');
      const old = markers[i]!;
      const next: ChapterMarker = { ...old };
      delete next.label;
      delete next.note;
      if (label) next.label = label;
      if (note) next.note = note;
      markers[i] = next;
      tx.update(chapterMarkersRef(), { markers });
      return { label: old.label || null, note: old.note || null };
    });
    await logAdminAction(context, {
      action: 'set_chapter_note',
      before,
      after: { label: label || null, note: note || null },
      detail: { weekId },
    });
    return { success: true };
  },
);

/** Thursday 13:00 UTC: the prices when the halt begins. */
export const weeklyCallsLock = cf()
  .pubsub.schedule('0 13 * * 4')
  .timeZone('UTC')
  .onRun(async () => {
    try {
      await lockHaltPrices();
      await recordHeartbeat('weeklyCallsLock');
    } catch (err) {
      reportError(err, { where: 'weeklyCallsLock' });
    }
    return null;
  });

/** Thursday 20:55 UTC: this chapter's marker, before the opening auction fills. */
export const weeklyCallsResolve = cf()
  .pubsub.schedule('55 20 * * 4')
  .timeZone('UTC')
  .onRun(async () => {
    try {
      await recordChapterMarker();
      await recordHeartbeat('weeklyCallsResolve');
    } catch (err) {
      reportError(err, { where: 'recordChapterMarker' });
    }
    return null;
  });
