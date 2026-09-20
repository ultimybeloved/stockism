'use strict';
// Coordinated-pressure detection.
//
// Why this file exists: altDetection.js asks "is this one person running many
// accounts" and answers it from shared networks. That misses the opposite
// shape entirely — several DIFFERENT people, on different connections, pushing
// the same stock the same way at the same time. Nothing looked for that, so the
// only incidents that ever reached the admin were the ones a player complained
// loudly enough about. On 2026-09-17 six accounts took $SHNG down 23% in 21
// minutes and the first anyone here knew of it was a Discord argument two days
// later.
//
// This scanner goes looking on its own. It groups every trade by ticker and UTC
// day, sums each account's price impact in each direction, and reports the days
// where several accounts leaned the same way hard enough to move the stock
// further than any one of them could alone.
//
// It reports on IMPACT, never on share count or dollars, so a threshold means
// the same thing on a $9 stock as on a $2,000 one.
//
// IMPORTANT: coordinated trading is NOT against the rules. A finding here is a
// lead for a human to read, never an accusation and never grounds for automatic
// action. The names in an alert are players who traded the same way on the same
// day, which happens innocently all the time — crews hold the same stocks, and
// good news moves everyone at once.
//
// Cost: one scheduled pass reads COORD_SCAN_WINDOW_DAYS of trades and writes one
// state doc. It adds nothing to the trade path itself.

const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const db = admin.firestore();

const {
  ADMIN_UID,
  ADMIN_DISCORD_USER_ID,
  ALT_SCAN_MAX_TRADES,
  COORD_SCAN_WINDOW_DAYS,
} = require('../constants');
const { sendDiscordDM, reportError } = require('../helpers');
// Pure clustering lives apart so its thresholds can be tested without a
// database. Internal module — not in servicePaths.js.
const { clusterTrades, dayIdOf } = require('./coordClustering');

const STATE_REF = () => db.collection('coordDetection').doc('state');

const DAY_MS = 24 * 60 * 60 * 1000;
const toMs = (ts) => {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts._seconds) return ts._seconds * 1000;
  if (ts.seconds) return ts.seconds * 1000;
  return 0;
};
const pct = (n) => `${(n * 100).toFixed(1)}%`;

/**
 * One pass. Returns the findings without writing when `dryRun` is set, so the
 * admin panel can look without filling the alert queue.
 */
async function runCoordScan({ dryRun = false } = {}) {
  const now = Date.now();
  const cutoff = new Date(now - COORD_SCAN_WINDOW_DAYS * DAY_MS);

  const snap = await db.collection('trades')
    .where('timestamp', '>', cutoff)
    .limit(ALT_SCAN_MAX_TRADES)
    .get();

  const rows = [];
  snap.forEach((doc) => {
    const t = doc.data();
    rows.push({
      uid: t.uid, ticker: t.ticker, action: t.action,
      priceImpact: t.priceImpact, source: t.source, ts: toMs(t.timestamp),
    });
  });

  const candidates = clusterTrades(rows);

  // Resolve names only for what survived, so a quiet scan costs no user reads.
  const uids = [...new Set(candidates.flatMap((c) => c.uids))];
  const names = {};
  await Promise.all(uids.map(async (uid) => {
    try {
      const d = await db.collection('users').doc(uid).get();
      names[uid] = d.exists ? (d.data().displayName || uid.slice(0, 6)) : uid.slice(0, 6);
    } catch {
      names[uid] = uid.slice(0, 6);
    }
  }));
  candidates.forEach((c) => { c.names = c.uids.map((u) => names[u]); });

  // Don't re-alert a cluster already reported. Keyed by ticker+day+direction,
  // which is stable: a later trade on the same day raises the combined number
  // but it is the same event, and a second alert would just be noise.
  const stateSnap = await STATE_REF().get();
  const seen = (stateSnap.exists && stateSnap.data().seen) || {};
  const fresh = candidates.filter((c) => !seen[`${c.ticker}|${c.day}|${c.direction}`]);

  if (dryRun) {
    return { scanned: snap.size, candidates: candidates.length, reported: 0, findings: candidates, dryRun: true };
  }

  // Keep only keys still inside the window, so this doc cannot grow forever.
  const keepAfter = dayIdOf(now - (COORD_SCAN_WINDOW_DAYS + 2) * DAY_MS);
  const nextSeen = {};
  for (const [k, v] of Object.entries(seen)) {
    if ((k.split('|')[1] || '') >= keepAfter) nextSeen[k] = v;
  }
  for (const c of fresh) nextSeen[`${c.ticker}|${c.day}|${c.direction}`] = now;

  await STATE_REF().set({
    seen: nextSeen,
    lastScanAt: now,
    lastScanTrades: snap.size,
    lastScanCandidates: candidates.length,
  }, { merge: true });

  // One alert per cluster, into the same queue the alt alerts use, so the admin
  // Watchlist tab and its badge pick these up with no new UI.
  const batch = db.batch();
  for (const c of fresh) {
    const arrow = c.direction === 'down' ? 'down' : 'up';
    batch.set(db.collection('watchlist_alerts').doc(), {
      type: 'coordinated_pressure',
      severity: c.severity,
      watchedUID: c.uids[0],
      relatedUID: c.uids[1] || null,
      action: 'flagged',
      reviewed: false,
      details: `${c.uids.length} accounts pushed $${c.ticker} ${arrow} ${pct(c.combined)} combined on ${c.day}`
        + `${c.tight ? `, all starting within ${Math.round(c.spreadMs / 60000)} min of each other` : ''}`
        + ` — ${c.names.map((n, i) => `${n} ${pct(c.impacts[i])}`).join(', ')}`,
      ticker: c.ticker,
      day: c.day,
      direction: c.direction,
      combinedImpact: Math.round(c.combined * 10000) / 100,
      participants: c.names,
      participantUIDs: c.uids,
      tightCluster: c.tight,
      spreadMinutes: Math.round(c.spreadMs / 60000),
      tradeCount: c.trades,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  if (fresh.length) await batch.commit();

  // Private DM only. These name players who have broken no rule, so they must
  // never reach a public channel.
  const high = fresh.filter((f) => f.severity === 'high');
  if (high.length && !ADMIN_DISCORD_USER_ID) {
    console.warn(`ADMIN_DISCORD_USER_ID not set — ${high.length} coordinated-pressure alert(s) written but not DMed.`);
  }
  if (high.length && ADMIN_DISCORD_USER_ID) {
    try {
      await sendDiscordDM(
        ADMIN_DISCORD_USER_ID,
        `📊 **Coordinated pressure** (private — nobody else can see this)\n` +
        high.slice(0, 5).map((c) =>
          `• **$${c.ticker}** ${c.direction} ${pct(c.combined)} on ${c.day} — `
          + c.names.map((n, i) => `${n} ${pct(c.impacts[i])}`).join(', ')
          + `${c.tight ? ` _(all within ${Math.round(c.spreadMs / 60000)} min)_` : ''}`
        ).join('\n') +
        (high.length > 5 ? `\n...and ${high.length - 5} more` : '') +
        `\nAdmin panel → Watchlist for detail. Trading together is allowed — this is a lead, not a violation.`
      );
    } catch (err) {
      reportError(err, { where: 'runCoordScan.discordDM' });
    }
  }

  return { scanned: snap.size, candidates: candidates.length, reported: fresh.length, findings: fresh };
}

/**
 * Nightly sweep, 04:30 UTC. Half an hour after the alt scan so the two never
 * read the trades collection at the same moment.
 */
exports.scanForCoordination = cf({ timeoutSeconds: 540, memory: '1GB' }).pubsub
  .schedule('30 4 * * *')
  .timeZone('UTC')
  .onRun(async () => {
    try {
      const result = await runCoordScan();
      console.log(`Coord scan: ${result.scanned} trades, ${result.candidates} clusters, ${result.reported} new`);
      return result;
    } catch (err) {
      reportError(err, { where: 'scanForCoordination' });
      throw err;
    }
  });

/**
 * Admin "run now". Pass dryRun to look without writing alerts or pinging.
 */
exports.triggerCoordScan = cf({ timeoutSeconds: 540, memory: '1GB' }).https.onCall(async (data, context) => {
  requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.');
  }
  return runCoordScan({ dryRun: !!(data && data.dryRun) });
});
