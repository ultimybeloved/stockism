import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import type { DocumentData } from 'firebase-admin/firestore';
import { RANK_BASE_MIN_AGE_MS, RANK_SNAP_EVERY_MS, RANK_SNAP_KEEP_MS } from '../shared/constants';

const db = admin.firestore();

// How many places each player on a net-worth board moved over the last day.
// Every recompute leaves an hourly snapshot of the ranks in
// leaderboardRanks/{key} (server only, so clients never download it) and the
// board compares against the oldest snapshot still in the window.
// No arrows until the oldest snapshot is old enough to be "a day ago".
type Snap = { at: number; ranks: Record<string, number> };

/** The entries with `rankChange` (places up since about a day ago, negative
 * for down, null for new to the board), or unchanged before there's a base. */
export const withRankMoves = async <T extends DocumentData & { userId: string }>(
  key: string,
  entries: T[],
  now: number,
): Promise<T[]> => {
  const ref = db.collection('leaderboardRanks').doc(key);
  let snaps: Snap[] = [];
  try {
    const snap = await ref.get();
    snaps = ((snap.data()?.snaps as Snap[] | undefined) || []).filter((s) => now - s.at <= RANK_SNAP_KEEP_MS);
    const last = snaps[snaps.length - 1];
    if (!last || now - last.at >= RANK_SNAP_EVERY_MS) {
      const ranks = Object.fromEntries(entries.map((e, i) => [e.userId, i + 1]));
      await ref.set({ snaps: [...snaps, { at: now, ranks }] });
    }
  } catch (e) {
    logger.warn('rank snapshot failed:', (e as Error).message);
  }
  const base = snaps[0] && now - snaps[0].at >= RANK_BASE_MIN_AGE_MS ? snaps[0] : null;
  if (!base) return entries;
  return entries.map((e, i) => {
    const was = base.ranks[e.userId];
    return { ...e, rankChange: was ? was - (i + 1) : null };
  });
};
