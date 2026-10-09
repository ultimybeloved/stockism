'use strict';
// getLeaderboard's caller rank against the LOCAL Firebase emulator. Never
// touches production.
//
// Run via: npm run test:leaderboard
//
// The board lists the top 50. Anyone below that gets their rank from a count
// query instead, and that lookup failed silently until 2026-10-08, so nobody
// outside the top 50 ever saw a rank. Bots never count toward anyone's rank.

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

const admin = require('../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

const { getLeaderboard } = require('../functions/src/users/leaderboard');

let failures = 0;
const check = (label, cond, detail = '') => {
  console.log(`${cond ? '  ✅' : '  ❌'} ${label}${cond ? '' : ' — ' + detail}`);
  if (!cond) failures++;
};

// Distinct values so every rank is unambiguous: p001 is the richest.
const PLAYERS = 60;
const valueOf = (i) => 100000 - i * 100;
const uidOf = (i) => `p${String(i).padStart(3, '0')}`;

const call = (data, uid) => getLeaderboard.run(data, { auth: uid ? { uid } : undefined, rawRequest: {} });

async function main() {
  const batch = db.batch();
  for (let i = 1; i <= PLAYERS; i++) {
    batch.set(db.collection('users').doc(uidOf(i)), {
      displayName: uidOf(i),
      portfolioValue: valueOf(i),
      crew: i % 2 ? 'WORKERS' : 'HOSTEL',
    });
  }
  // A bot richer than everyone: it must not push any player's rank down.
  batch.set(db.collection('users').doc('bot_rich'), { displayName: 'bot', isBot: true, portfolioValue: 1e9 });
  await batch.commit();

  console.log('\n1 — inside the top 50, rank comes from the board');
  let r = await call({}, uidOf(10));
  check('board has 50 entries', r.leaderboard?.length === 50, `got ${r.leaderboard?.length}`);
  check('#10 is ranked 10', r.callerRank === 10, `got ${r.callerRank}`);

  console.log('\n2 — outside the top 50, rank comes from the count');
  r = await call({}, uidOf(55));
  check('#55 is ranked 55', r.callerRank === 55, `got ${r.callerRank}`);
  r = await call({}, uidOf(PLAYERS));
  check(`last player is ranked ${PLAYERS}`, r.callerRank === PLAYERS, `got ${r.callerRank}`);

  console.log('\n3 — crew board ranks within the crew');
  // Odd indexes are WORKERS: p001, p003, ... so p059 is the 30th of them.
  r = await call({ crew: 'WORKERS' }, uidOf(59));
  check('p059 is 30th in WORKERS', r.callerRank === 30, `got ${r.callerRank}`);

  console.log('\n4 — the weekly-gain boards never use the value count');
  r = await call({ sortBy: 'weeklyGain' }, uidOf(55));
  check('no rank from a value count on a gain board', r.callerRank === null, `got ${r.callerRank}`);

  console.log('\n5 — signed out gets no rank');
  r = await call({}, null);
  check('callerRank is null', r.callerRank === null, `got ${r.callerRank}`);

  console.log(failures === 0 ? '\nALL LEADERBOARD CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Test crashed:', err);
  process.exit(1);
});
