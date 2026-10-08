// Keeping repeat coordinators out of Platinum and Diamond.
//
// Coordinated-pressure alerts (coordDetection.js) are leads, not verdicts: a
// chapter drop sends dozens of honest players the same way within minutes. So
// nothing here acts on its own. The admin sees who keeps getting flagged this
// season and decides; a player they exclude still scores, still earns Bronze,
// Silver and Gold, and still counts toward their division's size, but can't
// take a Platinum or Diamond place (see rankTopTiers in seasonTiers.js).
//
// The mark lives on the user doc, which only the player and the admin can read,
// so the public board never shows who was excluded.
import * as functions from 'firebase-functions';
import { cf, requireAdmin } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
const db = admin.firestore();

import { toMs } from '../shared/activity';
import type { SeasonDoc } from '../shared/types';

/** One player as the flags report builds them. */
interface FlaggedPlayer {
  uid: string;
  name: string;
  flags: number;
  tickers: Set<string>;
  partners: Map<string, number>;
}

const seasonRef = () => db.collection('market').doc('season');

const activeSeason = async (): Promise<SeasonDoc> => {
  const snap = await seasonRef().get();
  const season = snap.exists ? (snap.data() as SeasonDoc) : null;
  if (!season || season.status !== 'active') {
    throw new functions.https.HttpsError('failed-precondition', 'No season is running');
  }
  return season;
};

/**
 * Everyone named in a coordinated-pressure alert since the season started,
 * most-flagged first, with who they were flagged alongside and whether they're
 * already excluded.
 */
export const getSeasonCoordFlags = cf().https.onCall(async (_data: unknown, context) => {
  requireAdmin(context);
  const season = await activeSeason();
  const since = season.startedAt || 0;

  // Filtered by date here rather than in the query, so it needs no composite
  // index. There are only ever a handful of these alerts a day.
  const snap = await db.collection('watchlist_alerts').where('type', '==', 'coordinated_pressure').get();

  const players = new Map<string, FlaggedPlayer>();
  snap.forEach((doc) => {
    const a = doc.data();
    if (toMs(a.timestamp) < since) return;
    const uids: string[] = a.participantUIDs || [];
    uids.forEach((uid, i) => {
      if (!players.has(uid)) {
        players.set(uid, {
          uid,
          name: (a.participants || [])[i] || uid,
          flags: 0,
          tickers: new Set(),
          partners: new Map(),
        });
      }
      const p = players.get(uid)!;
      p.flags++;
      if (a.ticker) p.tickers.add(a.ticker);
      uids.forEach((other, j) => {
        if (other === uid) return;
        const name = (a.participants || [])[j] || other;
        p.partners.set(name, (p.partners.get(name) || 0) + 1);
      });
    });
  });

  const rows = [...players.values()];
  const userDocs = rows.length
    ? await db.getAll(...rows.map((p) => db.collection('users').doc(p.uid)), { fieldMask: ['seasonTopTierExclusion'] })
    : [];
  const excluded = new Set(
    userDocs.filter((d) => d.exists && d.data()!.seasonTopTierExclusion?.seasonId === season.id).map((d) => d.id),
  );

  return {
    seasonId: season.id,
    since,
    players: rows
      .map((p) => ({
        uid: p.uid,
        name: p.name,
        flags: p.flags,
        tickers: [...p.tickers].sort(),
        partners: [...p.partners.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n })),
        excluded: excluded.has(p.uid),
      }))
      .sort((a, b) => b.flags - a.flags || a.name.localeCompare(b.name)),
  };
});

/** Exclude a player from Platinum and Diamond for the running season, or undo it. */
export const setSeasonTopTierExclusion = cf().https.onCall(
  async (data: { uid?: unknown; excluded?: unknown } | null, context) => {
    requireAdmin(context);
    const { uid, excluded } = data || {};
    if (!uid || typeof uid !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'uid is required');
    }
    const season = await activeSeason();

    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();
    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found');

    await userRef.update({
      seasonTopTierExclusion: excluded ? { seasonId: season.id, at: Date.now() } : FieldValue.delete(),
    });
    // The cached board would keep projecting their old tier until it expired.
    await db.collection('leaderboard').doc('season').delete();

    console.log(
      `SEASON EXCLUSION: ${uid} ${excluded ? 'excluded from' : 'restored to'} Platinum/Diamond in ${season.id}`,
    );
    return { success: true, uid, excluded: !!excluded };
  },
);
