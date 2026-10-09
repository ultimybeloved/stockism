// GENERATED from src/rules/activity.ts by `npm run sync:chars`. Do not edit.
// When a player was last active. Shared rule module (see src/rules/ladder.ts for
// what that means): the admin panel's active-user counts and the numbers posted
// to Discord are computed by this one copy.

/** Any of the timestamp shapes the user doc has held over the years. */
export type TimeLike = number | string | Date | { toMillis?: () => number; seconds?: number } | null | undefined;

// Coerce any of our timestamp shapes (Firestore Timestamp, epoch ms number, or
// ISO string) to epoch ms; 0 if missing/unparseable.
export function toMs(ts: TimeLike): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  const stamp = ts as { toMillis?: () => number; seconds?: unknown };
  if (typeof stamp.toMillis === 'function') return stamp.toMillis();
  if (typeof stamp.seconds === 'number') return stamp.seconds * 1000;
  if (typeof ts === 'string') {
    const p = Date.parse(ts);
    return isNaN(p) ? 0 : p;
  }
  return 0;
}

/** The user-doc fields that count as activity. */
export interface ActivityFields {
  lastSynced?: TimeLike;
  lastActive?: TimeLike;
  lastTradeTime?: TimeLike;
  lastCheckin?: TimeLike;
  [field: string]: unknown;
}

// Most-recent activity for a user, used by the active-user metric.
//
// "Active" means opened the app, not just traded. lastSynced is the widest net:
// every signed-in client calls syncPortfolio ~30s into a session, so it stamps
// for lurkers who log in, look at charts, and never place an order. The rest are
// fallbacks so nobody is missed: lastActive (any write action), plus the older
// lastTradeTime / lastCheckin stamps for accounts that predate it. Signups stamp
// lastActive at creation, so brand-new accounts are covered too.
export function getLastActiveMs(userData: ActivityFields | null | undefined): number {
  if (!userData) return 0;
  return Math.max(
    toMs(userData.lastSynced),
    toMs(userData.lastActive),
    toMs(userData.lastTradeTime),
    toMs(userData.lastCheckin),
  );
}
