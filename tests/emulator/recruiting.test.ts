// Recruiting rewards against the LOCAL Firestore emulator (never production):
// who counts as a recruit at sign-up, and that both sides are paid exactly once,
// only after the recruit has earned it.
//
// Run via: npm run test:recruiting

import { it } from 'vitest';
import { createRequire } from 'module';
import { check, type Loose } from './harness';

const PROJECT_ID = 'stockism-abb28';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT_ID;

const require = createRequire(import.meta.url);
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const { recordRecruit, settleRecruit } =
  require('../../functions/src/users/recruiting') as typeof import('../../functions/src/users/recruiting');
const { RECRUITER_REWARD, RECRUIT_BONUS, RECRUIT_WEEKLY_CAP, RECRUIT_EXPIRY_DAYS, recruitWeek } =
  require('../../functions/src/shared/rules/recruiting') as typeof import('../../functions/src/shared/rules/recruiting');

const DAY = 24 * 60 * 60 * 1000;
const user = (uid: string) => db.collection('users').doc(uid);
const read = async (uid: string): Promise<Loose> => (await user(uid).get()).data();
const record = async (uid: string): Promise<Loose> => (await db.collection('recruits').doc(uid).get()).data();

async function addPlayer(uid: string, name: string, connection: string, extra: Record<string, unknown> = {}) {
  await user(uid).set({ displayName: name, cash: 1000, signupTrackingKey: connection, signupIp: connection, ...extra });
  await db.collection('usernames').doc(name.toLowerCase()).set({ uid });
  await db
    .collection('ipTracking')
    .doc(connection)
    .set({ accounts: { [uid]: Date.now() } }, { merge: true });
}

const signUp = (recruitUid: string, ref: unknown, connection: string | null) =>
  recordRecruit({ recruitUid, ref, signupTrackingKey: connection, sanitizedSignupIp: connection });

/** Makes a recruit look like they have played long enough. */
async function makeReady(uid: string) {
  await user(uid).update({ totalCheckins: 7, discordId: `discord_${uid}` });
  await db
    .collection('recruits')
    .doc(uid)
    .update({ createdAt: Date.now() - 15 * DAY });
}

async function main() {
  await addPlayer('boss', 'Boss_Man', 'net_a');

  // --- Who counts at sign-up ---
  await addPlayer('alt', 'AltAccount', 'net_a');
  check('a recruit on the recruiter connection does not count', (await signUp('alt', 'Boss_Man', 'net_a')) === null);
  await addPlayer('ghost', 'Ghost', 'net_g');
  check('an unknown name does not count', (await signUp('ghost', 'Nobody_Here', 'net_g')) === null);
  check('a malformed name does not count', (await signUp('ghost', 'x y<z>', 'net_g')) === null);
  check('an unidentified connection does not count', (await signUp('ghost', 'Boss_Man', null)) === null);
  check('you cannot recruit yourself', (await signUp('boss', 'boss_man', 'net_z')) === null);
  check('none of those left a record', !(await record('alt')) && !(await record('ghost')) && !(await record('boss')));

  await addPlayer('newbie', 'Newbie', 'net_b');
  const named = await signUp('newbie', 'boss_man', 'net_b');
  check('a real recruit is recorded, any letter case', named === 'Boss_Man', named);
  check('the recruit is flagged for the check-in', (await read('newbie')).recruitPending === true);
  check('the recruiter sees one pending', (await read('boss')).recruiting?.pending === 1);
  let threw = false;
  await signUp('newbie', 'Boss_Man', 'net_b').catch(() => (threw = true));
  check('the same account cannot be recorded twice', threw && (await read('boss')).recruiting?.pending === 1);

  // --- Paying ---
  check('nothing is paid before the recruit qualifies', (await settleRecruit('newbie')) === 'waiting');
  check('cash untouched while waiting', (await read('boss')).cash === 1000 && (await read('newbie')).cash === 1000);

  await makeReady('newbie');
  await user('newbie').update({ discordId: null });
  check('no Discord link, no payout', (await settleRecruit('newbie')) === 'waiting');
  await user('newbie').update({ discordId: 'discord_newbie' });

  check('a qualified recruit pays out', (await settleRecruit('newbie')) === 'paid');
  const boss = await read('boss');
  const newbie = await read('newbie');
  check('recruiter got the reward', boss.cash === 1000 + RECRUITER_REWARD, boss.cash);
  check('recruit got the bonus', newbie.cash === 1000 + RECRUIT_BONUS, newbie.cash);
  check(
    'both booked as granted value',
    boss.grantedValue === RECRUITER_REWARD && newbie.grantedValue === RECRUIT_BONUS,
  );
  check('counts moved from pending to paid', boss.recruiting.pending === 0 && boss.recruiting.paid === 1);
  check('the flag is cleared', newbie.recruitPending === undefined);
  check('the record is closed as paid', (await record('newbie')).status === 'paid');
  const ledger = await db.collection('ledger').where('ref', '==', 'recruits/newbie').get();
  const booked = ledger.docs.map((d: Loose) => `${d.data().type}:${d.data().uid}:${d.data().amount}`).sort();
  check(
    'one ledger entry per side',
    booked.join() === [`recruit_bonus:newbie:${RECRUIT_BONUS}`, `recruit_reward:boss:${RECRUITER_REWARD}`].join(),
    booked,
  );

  check('a second settle pays nothing', (await settleRecruit('newbie')) === 'closed');
  check('still paid once', (await read('boss')).cash === 1000 + RECRUITER_REWARD);

  // --- Weekly cap ---
  await addPlayer('sixth', 'SixthOne', 'net_c');
  await signUp('sixth', 'Boss_Man', 'net_c');
  await makeReady('sixth');
  await user('boss').update({ 'recruiting.week': recruitWeek(Date.now()), 'recruiting.weekPaid': RECRUIT_WEEKLY_CAP });
  check('over the weekly cap, the recruit waits', (await settleRecruit('sixth')) === 'waiting');
  check('and stays pending for later', (await record('sixth')).status === 'pending');
  await user('boss').update({ 'recruiting.week': recruitWeek(Date.now()) - 1 });
  check('a new week pays them', (await settleRecruit('sixth')) === 'paid');
  check('the new week starts its own count', (await read('boss')).recruiting.weekPaid === 1);

  // --- Closing without paying ---
  await addPlayer('slow', 'SlowPoke', 'net_d');
  await signUp('slow', 'Boss_Man', 'net_d');
  await makeReady('slow');
  await db
    .collection('recruits')
    .doc('slow')
    .update({ createdAt: Date.now() - (RECRUIT_EXPIRY_DAYS + 1) * DAY });
  const before = (await read('boss')).cash;
  check('a recruit past the deadline is closed', (await settleRecruit('slow')) === 'closed');
  check('expired pays nothing', (await read('boss')).cash === before && (await record('slow')).status === 'expired');
  check('expired comes off the pending count', (await read('boss')).recruiting.pending === 0);

  await addPlayer('late', 'LateJoin', 'net_e');
  await signUp('late', 'Boss_Man', 'net_e');
  await makeReady('late');
  await user('boss').update({ isBanned: true });
  check('a banned recruiter is never paid', (await settleRecruit('late')) === 'closed');
  check(
    'and the recruit gets nothing either',
    (await read('late')).cash === 1000 && (await record('late')).status === 'void',
  );
  check('a banned recruiter cannot take new recruits', (await signUp('ghost', 'Boss_Man', 'net_g')) === null);
}

it('recruiting rewards', main);
