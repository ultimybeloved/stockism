'use strict';

// Deletes the harassment / throwaway accounts listed in spam-name-targets.cjs.
//
//   node scripts/spam-name-purge.cjs            (dry run)
//   node scripts/spam-name-purge.cjs --confirm  (applies)
//
// Same teardown the player-facing deleteAccount does, in the same order, so a
// purged account leaves the database in the identical state to a self-delete:
//
//   1. Audit record into `moderationDeletions` FIRST. Deletion is irreversible;
//      the record is what is left to point at afterwards.
//   2. Username tombstoned in `usernames`. The doc keeps existing, which is what
//      blocks re-registration — createUser rejects any name whose reservation
//      doc exists, deleted or not. The slur can never be claimed again.
//   3. Open limit / pre-market orders cancelled, so the sweeps do not later try
//      to fill an order for a user document that is gone.
//   4. recursiveDelete of the user doc AND its subcollections. Firestore does
//      not cascade, so a plain delete would orphan notifications and
//      portfolioHistory forever.
//   5. Signup IP slot tombstoned, holding the per-IP signup slot for ~a month.
//   6. Discord tombstoned if one is linked, so it cannot verify a fresh account.
//   7. Firebase Auth account deleted, so the credentials stop working.
//
// Shares are deleted, never sold, so nothing here moves a stock price.
// Trade records are deliberately left in place: they are market history, and
// removing them would change how past prices reconstruct.
//
// Guard: every target carries its expected display name and the script aborts
// the whole run if any uid no longer matches. Nothing is deleted on a mismatch.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const KEY_PATH = path.join(__dirname, '..', 'service-account-key.json');
if (!fs.existsSync(KEY_PATH)) { console.error('No service-account-key.json in the repo root.'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
const db = admin.firestore();

const TARGETS = require('./spam-name-targets.cjs');

const REASON = 'Harassment username targeting another player. Account abandoned: '
  + 'no human activity, only scheduled dividend payouts.';

const money = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const norm = (s) => String(s || '').trim().toLowerCase();

async function main() {
  const apply = process.argv.includes('--confirm');
  console.log('\n' + (apply ? 'APPLYING - this deletes live accounts' : 'DRY RUN - nothing will be written') + '\n');

  const mk = await db.collection('market').doc('current').get();
  const prices = (mk.data() || {}).prices || {};

  // ---- Pass 1: read and verify everything before deleting anything. ----
  const plan = [];
  const problems = [];

  for (const t of TARGETS) {
    const snap = await db.collection('users').doc(t.uid).get();
    if (!snap.exists) { problems.push(t.name + ' (' + t.uid + '): user doc not found'); continue; }
    const u = snap.data();

    if (norm(u.displayName) !== norm(t.name)) {
      problems.push('NAME MISMATCH ' + t.uid + ': expected "' + t.name + '", found "' + u.displayName + '"');
      continue;
    }

    let holdingsValue = 0;
    const holdings = [];
    for (const [ticker, shares] of Object.entries(u.holdings || {})) {
      if (!(shares > 0)) continue;
      holdingsValue += (prices[ticker] || 0) * shares;
      holdings.push(ticker + ' x' + shares);
    }

    const [limits, pre] = await Promise.all([
      db.collection('limitOrders').where('uid', '==', t.uid).where('status', '==', 'OPEN').get(),
      db.collection('preMarketOrders').where('uid', '==', t.uid).where('status', '==', 'QUEUED').get(),
    ]);

    plan.push({
      uid: t.uid, name: t.name, data: u,
      netWorth: (u.cash || 0) + holdingsValue - (u.marginUsed || 0),
      holdings, limits, pre,
    });
  }

  if (problems.length) {
    console.error('ABORT. Refusing to delete anything while these are unresolved:\n');
    for (const p of problems) console.error('  ' + p);
    console.error('\nRe-run scripts/spam-name-audit.cjs and update spam-name-targets.cjs.\n');
    process.exit(1);
  }

  console.log('Verified ' + plan.length + ' of ' + TARGETS.length + ' targets. Every name matches its uid.\n');
  for (const p of plan) {
    console.log('  ' + p.name.padEnd(22) + money(p.netWorth).padStart(12)
      + '   ' + (p.holdings.length ? p.holdings.join(', ') : 'no holdings')
      + (p.data.discordId ? '   DISCORD LINKED' : '')
      + (p.limits.size || p.pre.size ? '   ' + (p.limits.size + p.pre.size) + ' open orders' : ''));
  }

  const total = plan.reduce((s, p) => s + p.netWorth, 0);
  console.log('\n  ' + plan.length + ' accounts, ' + money(total) + ' of fake money removed from the economy.');
  console.log('  Shares are deleted rather than sold, so no stock price moves.');

  if (!apply) {
    console.log('\nDry run complete. Re-run with --confirm to apply.\n');
    return;
  }

  // ---- Pass 2: delete. ----
  console.log('\n' + '='.repeat(60) + '\n');
  const stamp = admin.firestore.FieldValue.serverTimestamp();

  for (const p of plan) {
    const u = p.data;

    // 1. Evidence first.
    await db.collection('moderationDeletions').doc(p.uid).set({
      uid: p.uid,
      displayName: u.displayName,
      displayNameLower: u.displayNameLower || norm(u.displayName),
      reason: REASON,
      deletedAt: stamp,
      deletedBy: 'admin-script (spam-name-purge)',
      netWorthAtDeletion: p.netWorth,
      cash: u.cash || 0,
      holdings: u.holdings || {},
      totalTrades: u.totalTrades || 0,
      crew: u.crew || null,
      createdAt: u.createdAt || null,
      signupIp: u.signupIp || null,
      discordId: u.discordId || null,
      wasBanned: !!u.isBanned,
    });

    // 2. Keep the name claimed forever.
    if (u.displayNameLower || u.displayName) {
      await db.collection('usernames').doc(u.displayNameLower || norm(u.displayName)).set({
        deleted: true, deletedAt: stamp, deletedUid: p.uid,
        blockedReason: 'harassment username, removed by moderation',
      }, { merge: true });
    }

    // 3. No orphaned orders for the sweeps to trip over.
    if (p.limits.size || p.pre.size) {
      const batch = db.batch();
      p.limits.docs.forEach((d) => batch.update(d.ref, { status: 'CANCELED', cancelReason: 'Account removed', updatedAt: stamp }));
      p.pre.docs.forEach((d) => batch.update(d.ref, { status: 'CANCELED', cancelReason: 'Account removed', updatedAt: stamp }));
      await batch.commit();
    }

    // 4. Doc and every subcollection under it.
    await db.recursiveDelete(db.collection('users').doc(p.uid));

    // 5. Hold the signup slot so the same connection cannot immediately re-spam.
    if (u.signupIp) {
      try {
        await db.collection('ipTracking').doc(u.signupIp).update({
          ['accounts.' + p.uid]: admin.firestore.FieldValue.delete(),
          ['deletedAccounts.' + p.uid]: Date.now(),
        });
      } catch (e) { /* tracking doc may not exist */ }
    }

    // 6. Discord cannot immediately re-verify a fresh account.
    if (u.discordId) {
      try {
        await db.collection('discordTombstones').doc(String(u.discordId))
          .set({ deletedAt: Date.now(), lastUid: p.uid }, { merge: true });
      } catch (e) { /* best effort */ }
    }

    // 7. Credentials stop working.
    let authNote = 'auth deleted';
    try {
      await admin.auth().deleteUser(p.uid);
    } catch (e) {
      authNote = e.code === 'auth/user-not-found' ? 'no auth account' : 'AUTH DELETE FAILED: ' + e.code;
    }

    console.log('  removed  ' + p.name.padEnd(22) + authNote);
  }

  // Leaderboard reads a cached doc for 5 minutes. Drop the caches so the names
  // disappear from the board now instead of at the next recompute.
  const cache = await db.collection('leaderboard').get();
  if (!cache.empty) {
    const batch = db.batch();
    cache.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    console.log('\n  cleared ' + cache.size + ' cached leaderboard docs so the names drop off immediately');
  }

  console.log('\nDone. ' + plan.length + ' accounts removed.\n');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
