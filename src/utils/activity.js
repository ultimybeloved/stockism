// Mirror of getLastActiveMs in functions/helpers.js. Keep the two in sync so
// the admin panel's active-user counts match what gets posted to Discord.

// Coerce any of our timestamp shapes (Firestore Timestamp, epoch ms, ISO
// string) to epoch ms; 0 if missing or unparseable.
export function toMs(ts) {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

// Most-recent activity for a user. lastSynced is the widest net: every
// signed-in client syncs its portfolio ~30s into a session, so it catches
// players who log in and browse without ever placing an order. The rest are
// fallbacks for accounts that predate it.
export function getLastActiveMs(userData) {
  if (!userData) return 0;
  return Math.max(
    toMs(userData.lastSynced),
    toMs(userData.lastActive),
    toMs(userData.lastTradeTime),
    toMs(userData.lastCheckin)
  );
}
