// Proves the per-IP signup cap holds under concurrency, against the LOCAL
// Firestore emulator (never production). It runs the SAME count-and-reserve
// transaction shape createUser uses (read ipTracking -> countIpAccounts ->
// reserve slot in the same transaction) and fires N simultaneous signups from
// one IP, asserting only MAX get through. This is the regression guard for the
// race where a burst of VPN signups all read a stale count and slipped past.
//
// Run via: npm run test:ipcap  (uses emulators:exec on an isolated port).

import admin from 'firebase-admin';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { countIpAccounts } = require('../functions/ipCap.js');

const PROJECT_ID = 'stockism-abb28';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT_ID;

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const MAX_ACCOUNTS_PER_IP = 2;
const SLOT_RELEASE_MS = 30 * 24 * 60 * 60 * 1000;

// Mirrors the createUser transaction: count this IP atomically, reject if at cap,
// otherwise reserve the slot. Returns true if the signup committed.
async function attemptSignup(ip, uid) {
  const ipRef = db.collection('ipTracking').doc(ip);
  const userRef = db.collection('users').doc(uid);
  try {
    await db.runTransaction(async (tx) => {
      const ipSnap = await tx.get(ipRef);
      const ipData = ipSnap.exists ? ipSnap.data() : {};
      const { effectiveAccounts } = countIpAccounts(ipData, uid, Date.now(), SLOT_RELEASE_MS);
      if (effectiveAccounts >= MAX_ACCOUNTS_PER_IP) {
        throw new Error('CAP');
      }
      tx.set(userRef, { signupIp: ip });
      tx.set(ipRef, { accounts: { [uid]: Date.now() } }, { merge: true });
    });
    return true;
  } catch (err) {
    if (err.message === 'CAP') return false;
    throw err;
  }
}

let pass = 0, fail = 0;
const check = (label, cond) => { if (cond) { console.log(`  PASS  ${label}`); pass++; } else { console.log(`  FAIL  ${label}`); fail++; } };

async function main() {
  // Case 1: 6 simultaneous signups from one IP — exactly MAX should commit.
  const ip1 = '203_0_113_7';
  const results = await Promise.all(
    Array.from({ length: 6 }, (_, i) => attemptSignup(ip1, `burst_${i}`))
  );
  const committed = results.filter(Boolean).length;
  check(`burst of 6 → exactly ${MAX_ACCOUNTS_PER_IP} committed (got ${committed})`, committed === MAX_ACCOUNTS_PER_IP);

  const ipDoc = await db.collection('ipTracking').doc(ip1).get();
  const stored = Object.keys(ipDoc.data().accounts || {}).length;
  check(`ipTracking records exactly ${MAX_ACCOUNTS_PER_IP} accounts (got ${stored})`, stored === MAX_ACCOUNTS_PER_IP);

  // Case 2: a 3rd sequential signup on a now-full IP is rejected.
  const third = await attemptSignup(ip1, 'late_arrival');
  check('3rd signup on a full IP is rejected', third === false);

  // Case 3: a different IP is unaffected.
  const other = await attemptSignup('198_51_100_5', 'fresh_ip_user');
  check('signup on a fresh IP still succeeds', other === true);

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES PRESENT'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => { console.error('Test harness error:', err); process.exit(2); });
