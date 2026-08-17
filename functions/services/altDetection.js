'use strict';
// Proactive alt-account detection.
//
// Why this file exists: watchlist.js can only follow accounts an admin already
// flagged by hand. Every one of its hooks starts with a lookup in `watchedIPs`,
// and `watchedIPs` is only ever written by addWatchedUser / addWatchedIP. If
// nobody suspected a pair, nothing ever compared them — which is how two
// accounts traded from the same house for four months and produced zero alerts.
//
// This scanner goes looking on its own. It reads the `ip` already stored on
// every trade record, groups accounts by the network they traded from, and
// reports pairs that keep showing up together.
//
// The trick that makes it work is normalising IPv6 to its /64 prefix. A home
// connection rotates through dozens of IPv6 addresses, so raw-address matching
// badly understates the overlap; the prefix is the household and stays fixed.
//
// Cost: one scheduled pass reads ALT_SCAN_WINDOW_DAYS of trades (a few thousand
// reads) and writes one state doc. It adds nothing to the trade path itself.

const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const db = admin.firestore();

const {
  ADMIN_UID,
  ALT_SCAN_WINDOW_DAYS,
  ALT_SCAN_MAX_TRADES,
  ALT_IPV6_PREFIX_GROUPS,
  ALT_CROWDED_NETWORK_LIMIT,
  ALT_SHARED_NETWORKS_HIGH,
  ALT_REALERT_MS,
  ALT_STATE_TTL_MS,
  ADMIN_DISCORD_USER_ID,
} = require('../constants');
const { sendDiscordDM, reportError } = require('../helpers');

const STATE_REF = () => db.collection('altDetection').doc('state');

// Collapse an address to the thing that identifies a connection rather than a
// session. IPv4 is used whole. IPv6 keeps only the routing prefix, because the
// interface half of the address changes on its own throughout the day.
function networkKey(ip) {
  if (!ip || typeof ip !== 'string' || ip === 'unknown') return null;
  const addr = ip.trim().toLowerCase();
  if (!addr.includes(':')) return addr; // IPv4
  const groups = addr.split(':');
  if (groups.length < ALT_IPV6_PREFIX_GROUPS) return addr;
  return groups.slice(0, ALT_IPV6_PREFIX_GROUPS).join(':') + '::/64';
}

const pairKey = (a, b) => [a, b].sort().join('|');
// Firestore map keys can't contain '/', and a uid pair joined by '|' is safe
// once the slashes from the network suffix are gone.
const safeKey = (k) => k.replace(/[./]/g, '_');

/**
 * The scan itself, split out so both the schedule and the admin "run now"
 * button drive identical logic.
 *
 * @param {boolean} dryRun - when true, report findings without recording or
 *   announcing them, so the admin can look before anything is written.
 */
async function runAltScan({ dryRun = false } = {}) {
  const now = Date.now();
  const cutoff = new Date(now - ALT_SCAN_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const snap = await db.collection('trades')
    .where('timestamp', '>', cutoff)
    .select('uid', 'ip')
    .limit(ALT_SCAN_MAX_TRADES)
    .get();

  // network -> Set(uid), and uid -> Set(network)
  const accountsByNetwork = new Map();
  const networksByAccount = new Map();

  snap.forEach((doc) => {
    const { uid, ip } = doc.data();
    const key = networkKey(ip);
    if (!uid || !key) return;
    if (!accountsByNetwork.has(key)) accountsByNetwork.set(key, new Set());
    accountsByNetwork.get(key).add(uid);
    if (!networksByAccount.has(uid)) networksByAccount.set(uid, new Set());
    networksByAccount.get(uid).add(key);
  });

  // Build candidate pairs from every network that carried more than one account.
  // Networks shared by a crowd are recorded but not counted as evidence on their
  // own — a school or a mobile carrier legitimately puts strangers together.
  const pairs = new Map();
  for (const [network, uids] of accountsByNetwork) {
    if (uids.size < 2) continue;
    const crowded = uids.size > ALT_CROWDED_NETWORK_LIMIT;
    const list = [...uids];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const key = pairKey(list[i], list[j]);
        if (!pairs.has(key)) {
          pairs.set(key, { uids: [list[i], list[j]], networks: [], exclusive: 0, crowdedOnly: true });
        }
        const p = pairs.get(key);
        p.networks.push({ network, accounts: uids.size });
        if (uids.size === 2) p.exclusive++;
        if (!crowded) p.crowdedOnly = false;
      }
    }
  }

  // Score what's left. A pair that only ever met on crowded infrastructure is
  // dropped entirely — that is the false-positive factory.
  const findings = [];
  for (const [key, p] of pairs) {
    if (p.crowdedOnly) continue;
    const solid = p.networks.filter((n) => n.accounts <= ALT_CROWDED_NETWORK_LIMIT);
    const severity = (solid.length >= ALT_SHARED_NETWORKS_HIGH || p.exclusive > 0)
      ? 'high'
      : 'medium';
    findings.push({
      key,
      uids: p.uids,
      sharedNetworks: solid.length,
      exclusiveNetworks: p.exclusive,
      severity,
      networks: solid.slice(0, 10).map((n) => n.network),
    });
  }

  findings.sort((a, b) =>
    (b.severity === 'high') - (a.severity === 'high') || b.sharedNetworks - a.sharedNetworks);

  if (!findings.length) {
    return { scanned: snap.size, candidates: 0, reported: 0, findings: [] };
  }

  // Enrich with account detail. Only the accounts that actually surfaced get
  // read, so this stays proportional to findings rather than to the player base.
  const uidsNeeded = [...new Set(findings.flatMap((f) => f.uids))];
  const userDocs = await db.getAll(
    ...uidsNeeded.map((uid) => db.collection('users').doc(uid)),
    { fieldMask: ['displayName', 'isBot', 'isBanned', 'crew', 'portfolioValue', 'holdings'] }
  );
  const users = new Map();
  userDocs.forEach((d) => { if (d.exists) users.set(d.id, d.data()); });

  const enriched = [];
  for (const f of findings) {
    const [a, b] = f.uids.map((uid) => users.get(uid));
    if (!a || !b) continue;
    if (a.isBot || b.isBot) continue;          // bots share the server's address
    if (a.isBanned && b.isBanned) continue;    // already dealt with

    const holdingsA = Object.keys(a.holdings || {}).filter((t) => a.holdings[t] > 0);
    const holdingsB = new Set(Object.keys(b.holdings || {}).filter((t) => b.holdings[t] > 0));
    const sharedTickers = holdingsA.filter((t) => holdingsB.has(t));

    enriched.push({
      ...f,
      names: [a.displayName || f.uids[0], b.displayName || f.uids[1]],
      sameCrew: !!(a.crew && a.crew === b.crew),
      sharedTickers: sharedTickers.slice(0, 5),
      combinedValue: (a.portfolioValue || 0) + (b.portfolioValue || 0),
      alreadyBanned: a.isBanned || b.isBanned,
    });
  }

  if (dryRun) {
    return { scanned: snap.size, candidates: enriched.length, reported: 0, findings: enriched, dryRun: true };
  }

  // Only report pairs we haven't already nagged about recently, so the alert
  // list stays a list of news rather than the same two names every night.
  const stateSnap = await STATE_REF().get();
  const seen = (stateSnap.exists ? stateSnap.data().pairs : null) || {};

  const fresh = enriched.filter((f) => {
    const last = seen[safeKey(f.key)];
    return !last || (now - last) > ALT_REALERT_MS;
  });

  const nextSeen = {};
  for (const [k, ts] of Object.entries(seen)) {
    if (now - ts < ALT_STATE_TTL_MS) nextSeen[k] = ts;
  }
  for (const f of fresh) nextSeen[safeKey(f.key)] = now;

  await STATE_REF().set({
    pairs: nextSeen,
    lastScanAt: now,
    lastScanTrades: snap.size,
    lastScanCandidates: enriched.length,
  }, { merge: true });

  // One alert doc per pair. These render in the admin Watchlist tab alongside
  // the manual-watchlist alerts, and drive the badge on the admin button.
  const batch = db.batch();
  for (const f of fresh) {
    batch.set(db.collection('watchlist_alerts').doc(), {
      type: 'alt_suspected',
      severity: f.severity,
      watchedUID: f.uids[0],
      relatedUID: f.uids[1],
      action: 'flagged',
      reviewed: false,
      details: `"${f.names[0]}" and "${f.names[1]}" traded from ${f.sharedNetworks} shared network(s)`
        + `${f.exclusiveNetworks ? `, ${f.exclusiveNetworks} used by nobody else` : ''}`
        + `${f.sameCrew ? ', same crew' : ''}`
        + `${f.sharedTickers.length ? `, both holding ${f.sharedTickers.join('/')}` : ''}`,
      names: f.names,
      networks: f.networks,
      sharedTickers: f.sharedTickers,
      combinedValue: f.combinedValue,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  if (fresh.length) await batch.commit();

  // Straight to the admin's DMs. These are unproven suspicions about named
  // players, so they must not touch the public channel.
  const high = fresh.filter((f) => f.severity === 'high');
  if (high.length && !ADMIN_DISCORD_USER_ID) {
    // The alerts are still written and still show in the admin panel; only the
    // DM is lost. Say so loudly rather than failing quietly.
    console.warn(`ADMIN_DISCORD_USER_ID not set — ${high.length} high-severity alt alert(s) written but not DMed.`);
  }
  if (high.length && ADMIN_DISCORD_USER_ID) {
    try {
      await sendDiscordDM(
        ADMIN_DISCORD_USER_ID,
        `🕵️ **Possible alt accounts** (private — nobody else can see this)\n` +
        high.slice(0, 5).map((f) =>
          `• **${f.names[0]}** + **${f.names[1]}** — ${f.sharedNetworks} shared network(s)`
          + `${f.exclusiveNetworks ? ` (${f.exclusiveNetworks} exclusive)` : ''}`
          + `${f.sameCrew ? ', same crew' : ''}`
          + `${f.sharedTickers.length ? `, both in ${f.sharedTickers.join('/')}` : ''}`
        ).join('\n') +
        (high.length > 5 ? `\n...and ${high.length - 5} more` : '') +
        `\nAdmin panel → Watchlist for detail. Shared connection is a lead, not proof.`
      );
    } catch (err) {
      // The alerts are already written; a failed ping must not lose the scan.
      reportError(err, { where: 'runAltScan.discordDM' });
    }
  }

  return { scanned: snap.size, candidates: enriched.length, reported: fresh.length, findings: fresh };
}

/**
 * Nightly sweep. 04:00 UTC — outside the Thursday halt window and away from the
 * market-open jobs, so it never competes with anything that has to be on time.
 */
exports.scanForAltAccounts = cf({ timeoutSeconds: 540, memory: '1GB' }).pubsub
  .schedule('0 4 * * *')
  .timeZone('UTC')
  .onRun(async () => {
    try {
      const result = await runAltScan();
      console.log(`Alt scan: ${result.scanned} trades, ${result.candidates} candidates, ${result.reported} new`);
      return result;
    } catch (err) {
      reportError(err, { where: 'scanForAltAccounts' });
      throw err;
    }
  });

/**
 * Admin "run now". Pass dryRun to look without writing alerts or pinging.
 */
exports.triggerAltScan = cf({ timeoutSeconds: 540, memory: '1GB' }).https.onCall(async (data, context) => {
  requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.');
  }
  return runAltScan({ dryRun: !!(data && data.dryRun) });
});

/**
 * Marks an alert as dealt with so it stops counting toward the admin badge.
 */
exports.reviewWatchlistAlert = cf().https.onCall(async (data, context) => {
  requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.');
  }
  const { alertId } = data || {};
  if (!alertId || typeof alertId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'alertId required');
  }
  await db.collection('watchlist_alerts').doc(alertId).update({
    reviewed: true,
    reviewedAt: Date.now(),
  });
  return { success: true };
});
