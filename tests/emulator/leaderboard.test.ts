// getLeaderboard's caller rank against the LOCAL Firebase emulator. Never
// touches production.
//
// Run via: npm run test:leaderboard
//
// The board lists the top 50. Anyone below that gets their rank from a count
// query instead, and that lookup failed silently until 2026-10-08, so nobody
// outside the top 50 ever saw a rank. Bots never count toward anyone's rank.

import { it } from 'vitest';
import { createRequire } from 'module';
import { check, type Loose } from './harness';

const require = createRequire(import.meta.url);

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

const { getLeaderboard } =
  require('../../functions/src/users/leaderboard') as typeof import('../../functions/src/users/leaderboard');

// Distinct values so every rank is unambiguous: p001 is the richest.
const PLAYERS = 60;
const valueOf = (i: number) => 100000 - i * 100;
const uidOf = (i: number) => `p${String(i).padStart(3, '0')}`;

const call = (data: Loose, uid: string | null) =>
  getLeaderboard.run(data, { auth: uid ? { uid } : undefined, rawRequest: {} });

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
  check('#55 is $100 behind #54', r.nextGap === 100, `got ${r.nextGap}`);
  r = await call({}, uidOf(PLAYERS));
  check(`last player is ranked ${PLAYERS}`, r.callerRank === PLAYERS, `got ${r.callerRank}`);

  console.log('\n3 — crew board ranks within the crew');
  // Odd indexes are WORKERS: p001, p003, ... so p059 is the 30th of them.
  r = await call({ crew: 'WORKERS' }, uidOf(59));
  check('p059 is 30th in WORKERS', r.callerRank === 30, `got ${r.callerRank}`);
  // Only 30 WORKERS, so p059 is on the board: the page reads the gap off the row above.
  check('no server gap for a player on the board', r.nextGap === null, `got ${r.nextGap}`);

  console.log('\n4 — the weekly-gain boards never use the value count');
  r = await call({ sortBy: 'weeklyGain' }, uidOf(55));
  check('no rank from a value count on a gain board', r.callerRank === null, `got ${r.callerRank}`);

  console.log('\n5 — signed out gets no rank');
  r = await call({}, null);
  check('callerRank is null', r.callerRank === null, `got ${r.callerRank}`);

  console.log('\n6: only real crews and boards');
  const refused = (data: Loose) =>
    call(data, null).then(
      () => false,
      (e: Loose) => e.code === 'invalid-argument',
    );
  check('an unknown crew is refused', await refused({ crew: 'NOT_A_CREW' }));
  check('an unknown board is refused', await refused({ sortBy: 'nonsense' }));

  console.log('\n7: rank arrows compare against the snapshot from a day ago');
  // HOSTEL is the even players, so p002 leads it now. A day ago p004 led and
  // p002 was third; p006 wasn't on the board.
  await db
    .collection('leaderboardRanks')
    .doc('HOSTEL')
    .set({ snaps: [{ at: Date.now() - 21 * 60 * 60 * 1000, ranks: { p004: 1, p008: 2, p002: 3 } }] });
  r = await call({ crew: 'HOSTEL' }, null);
  const move = (uid: string) => r.leaderboard?.find((e: Loose) => e.userId === uid)?.rankChange;
  check('p002 climbed 2', move('p002') === 2, `got ${move('p002')}`);
  check('p004 slipped 1', move('p004') === -1, `got ${move('p004')}`);
  check('p006 is new to the board', move('p006') === null, `got ${move('p006')}`);
  const snaps = (await db.collection('leaderboardRanks').doc('HOSTEL').get()).data().snaps;
  check("today's ranks were saved for tomorrow", snaps.length === 2 && snaps[1].ranks.p002 === 1, `${snaps.length}`);
}

it('leaderboard', main);
