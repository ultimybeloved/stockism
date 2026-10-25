'use strict';

// WRITES (with --apply): bans a group of accounts and closes every connection
// that ONLY that group ever used to new signups, for good.
//
//   npx tsx scripts/ban-group.cjs --reason "..." Name1 Name2 ... [--apply]
//
// Names match exactly (case-insensitive). For each member it collects every
// connection on record: trades, long-term market trades, queued orders, gifts,
// the signup address and the per-connection tracking docs. A connection is
// blocked only if nobody outside the group appears on it anywhere; shared ones
// (a school, a mobile carrier, a sibling) are listed and left open. IPv6 counts
// as its /64 network, same as the signup cap. We have no record of plain
// logins, only of these actions.
//
// Then each member is banned through the real banUser (same reset, order
// cancels and records as the admin panel), and their Discord ID is tombstoned
// permanently so it can never verify another account. Without --apply it only
// prints.

const fs = require('fs');
const path = require('path');
const admin = require('../functions/node_modules/firebase-admin');

// The bot settings, so banUser's Discord alert goes out like it does from the admin panel.
const ENV_PATH = path.join(__dirname, '..', 'functions', '.env');
if (fs.existsSync(ENV_PATH)) {
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
}

const KEY_PATH = path.join(__dirname, '..', 'service-account-key.json');
if (!fs.existsSync(KEY_PATH)) {
  console.error('No service-account-key.json in the repo root.');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
const db = admin.firestore();
const { ipTrackingKey } = require('../functions/src/shared/accountGuards');
const { ADMIN_UID } = require('../functions/src/shared/constants');

// A raw address → its tracking key. Signup IPs and order origins are stored
// with separators already swapped for underscores.
const keyOfRaw = (ip) => ipTrackingKey(ip);
const keyOfStored = (s) => {
  if (!s) return null;
  const raw =
    s.includes('.') || s.includes(':') ? s : s.split('_').length === 4 ? s.replace(/_/g, '.') : s.replace(/_/g, ':');
  return ipTrackingKey(raw) || s;
};
// The text every raw address on this connection starts with, for range queries.
const rawPrefixOf = (key) => {
  if (key.endsWith('___64')) return key.slice(0, -5).replace(/_/g, ':') + ':';
  return null; // IPv4: exact match
};
const rawOf = (key) => key.replace(/_/g, '.');

async function main() {
  const args = process.argv.slice(2);
  const ri = args.indexOf('--reason');
  const reason = ri >= 0 ? args.splice(ri, 2)[1] : 'Repeated market manipulation';
  const apply = args.includes('--apply');
  const names = args.filter((a) => a !== '--apply').map((n) => n.toLowerCase());
  if (!names.length) throw new Error('usage: --reason "..." Name1 Name2 ... [--apply]');

  const all = await db
    .collection('users')
    .select('displayName', 'displayNameLower', 'signupIp', 'discordId', 'isBanned')
    .get();
  const group = all.docs.filter((d) =>
    names.includes((d.data().displayNameLower || d.data().displayName || '').toLowerCase()),
  );
  const found = new Set(group.map((d) => (d.data().displayNameLower || '').toLowerCase()));
  for (const n of names) if (!found.has(n)) console.log(`No account named "${n}"`);
  const ids = new Set(group.map((d) => d.id));
  const nameOf = new Map(all.docs.map((d) => [d.id, d.data().displayName || d.id.slice(0, 8)]));
  group.forEach((d) => console.log(`${d.data().displayName} ${d.id}${d.data().isBanned ? ' (already banned)' : ''}`));

  // 1. Every connection the group used, and who in the group used it.
  const keys = new Map(); // key -> Set of member uids
  // Everything is keyed by connection (IPv6 /64). Older records hold the full
  // address, so they are folded into their connection first.
  const note = (stored, uid) => {
    const key = keyOfStored(stored);
    if (key) (keys.get(key) || keys.set(key, new Set()).get(key)).add(uid);
  };
  for (const d of group) {
    note(keyOfStored(d.data().signupIp), d.id);
    for (const col of ['trades', 'eventTrades']) {
      const snap = await db.collection(col).where('uid', '==', d.id).select('ip').get();
      snap.forEach((t) => note(keyOfRaw(t.data().ip), d.id));
    }
    (await db.collection('orderOrigins').where('uid', '==', d.id).get()).forEach((o) => note(o.data().ipKey, d.id));
    (await db.collection('giftLog').where('fromUid', '==', d.id).get()).forEach((g) =>
      note(g.data().fromNet ? g.data().fromNet.replace(/[.:/]/g, '_') : null, d.id),
    );
  }
  const tracking = await db.collection('ipTracking').get();
  const usersOnKey = new Map(); // connection -> every uid any tracking doc lists on it
  for (const d of tracking.docs) {
    const key = keyOfStored(d.id);
    const t = d.data();
    const set = usersOnKey.get(key) || usersOnKey.set(key, new Set()).get(key);
    for (const uid of [...Object.keys(t.accounts || {}), ...Object.keys(t.recentTraders || {})]) {
      set.add(uid);
      if (ids.has(uid)) note(d.id, uid);
    }
  }

  // 2. Anyone outside the group on each connection.
  const exclusive = [];
  const shared = [];
  for (const [key, members] of keys) {
    const others = new Set();
    for (const uid of usersOnKey.get(key) || []) others.add(uid);
    const prefix = rawPrefixOf(key);
    for (const col of ['trades', 'eventTrades']) {
      const q = prefix
        ? db
            .collection(col)
            .where('ip', '>=', prefix)
            .where('ip', '<', prefix + '')
        : db.collection(col).where('ip', '==', rawOf(key));
      (await q.select('uid').get()).forEach((x) => others.add(x.data().uid));
    }
    if (prefix) {
      const p = prefix.replace(/:/g, '_');
      (
        await db
          .collection('orderOrigins')
          .where('ipKey', '>=', p)
          .where('ipKey', '<', p + '')
          .get()
      ).forEach((o) => others.add(o.data().uid));
    } else {
      (await db.collection('orderOrigins').where('ipKey', '==', key).get()).forEach((o) => others.add(o.data().uid));
    }
    const net = prefix ? key.slice(0, -5).replace(/_/g, ':') + '::/64' : rawOf(key);
    (await db.collection('giftLog').where('fromNet', '==', net).get()).forEach((g) => others.add(g.data().fromUid));
    for (const d of all.docs) if (keyOfStored(d.data().signupIp) === key) others.add(d.id);
    const outsiders = [...others].filter((u) => u && !ids.has(u));
    (outsiders.length ? shared : exclusive).push({ key, members: [...members], outsiders });
  }

  const who = (us) => us.map((u) => nameOf.get(u) || `(deleted ${u.slice(0, 6)})`).join(', ');
  console.log(`\n${exclusive.length} connections used only by the group (will be blocked):`);
  exclusive.forEach((e) => console.log(`  ${e.key.padEnd(30)} ${who(e.members)}`));
  console.log(`\n${shared.length} shared connections (left open):`);
  shared.forEach((e) =>
    console.log(`  ${e.key.padEnd(30)} ${who(e.members)}  also: ${who(e.outsiders).slice(0, 120)}`),
  );

  if (!apply) return console.log('\nDry run. Nothing written. Add --apply to ban and block.');

  // 3. Block, ban, tombstone.
  const now = Date.now();
  for (let i = 0; i < exclusive.length; i += 400) {
    const batch = db.batch();
    for (const e of exclusive.slice(i, i + 400)) {
      batch.set(db.collection('blockedNetworks').doc(e.key), {
        reason,
        group: names,
        uids: e.members,
        blockedAt: now,
        blockedBy: ADMIN_UID,
      });
    }
    await batch.commit();
  }
  const { banUser } = require('../functions/src/admin/admin');
  for (const d of group) {
    if (!d.data().isBanned) {
      await banUser.run({ userId: d.id, reason }, { auth: { uid: ADMIN_UID }, app: {} });
      console.log(`Banned ${d.data().displayName}`);
    }
    if (d.data().discordId) {
      await db
        .collection('discordTombstones')
        .doc(String(d.data().discordId))
        .set({ permanent: true, lastUid: d.id, reason, at: now }, { merge: true });
    }
  }
  await db.collection('adminLog').add({
    action: 'ban_group',
    by: ADMIN_UID,
    uid: null,
    name: null,
    before: null,
    after: { banned: group.map((d) => d.data().displayName), blockedNetworks: exclusive.length },
    detail: { reason, shared: shared.length, source: 'script' },
    at: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`\nDone: ${group.length} banned, ${exclusive.length} connections blocked.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
