// Naming unnamed players, against the LOCAL Firebase emulator. Never touches
// production.
//
// The preview writes nothing. Apply names players with no name or a placeholder,
// leaves named players alone, sends a bell and gives one free name change. The
// free change skips the $10,000 cost and the cooldown, once.

import { beforeAll, it } from 'vitest';
import { createRequire } from 'module';
import { check, resetEmulator } from './harness';

const require = createRequire(import.meta.url);

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

const { adminNameUnnamed } =
  require('../../functions/src/admin/adminNameUnnamed') as typeof import('../../functions/src/admin/adminNameUnnamed');
const { changeDisplayName } =
  require('../../functions/src/users/userProfile') as typeof import('../../functions/src/users/userProfile');
const { ADMIN_UID } =
  require('../../functions/src/shared/constants') as typeof import('../../functions/src/shared/constants');

const adminCtx = { auth: { uid: ADMIN_UID } };
const ctx = (uid: string) => ({ auth: { uid }, rawRequest: { ip: '203.0.113.7' } });
const user = async (uid: string) => (await db.collection('users').doc(uid).get()).data();

beforeAll(resetEmulator);

it('names unnamed players and gives a free name change', async () => {
  await db.collection('users').doc('nn_blank').set({ cash: 500 });
  await db.collection('users').doc('nn_user').set({ cash: 500, displayName: 'User', displayNameLower: 'user' });
  await db.collection('usernames').doc('user').set({ uid: 'nn_user' });
  await db.collection('users').doc('nn_named').set({ cash: 500, displayName: 'Keeper', displayNameLower: 'keeper' });
  await db.collection('users').doc('nn_bot').set({ isBot: true });

  const preview = await adminNameUnnamed.run({}, adminCtx);
  const ids = preview.plan.map((p: { uid: string }) => p.uid).sort();
  check('the preview lists the blank and placeholder accounts only', ids.join() === 'nn_blank,nn_user', ids);
  check('the preview writes nothing', !(await user('nn_blank'))!.displayName);

  const again = await adminNameUnnamed.run({ dryRun: true }, adminCtx);
  check(
    'the same names come back on a second preview',
    JSON.stringify(again.plan) === JSON.stringify(preview.plan),
    again.plan,
  );

  const done = await adminNameUnnamed.run({ dryRun: false }, adminCtx);
  check('both are named', done.applied === 2 && done.skipped.length === 0, done);
  const blank = (await user('nn_blank'))!;
  const planned = preview.plan.find((p: { uid: string; to: string }) => p.uid === 'nn_blank')!;
  check('the applied name is the previewed one', blank.displayName === planned.to, blank.displayName);
  check('the name is reserved', (await db.collection('usernames').doc(planned.to.toLowerCase()).get()).exists);
  check('one free name change is given', blank.freeNameChanges === 1);
  check('no cooldown is started', !blank.nameChangedAt);
  const bells = await db.collection('users').doc('nn_blank').collection('notifications').get();
  check('the player gets a bell', bells.size === 1 && bells.docs[0].data().message.includes(planned.to));
  check('a named player is left alone', (await user('nn_named'))!.displayName === 'Keeper');
  check('a bot is left alone', !(await user('nn_bot'))!.displayName);
  check('a second run finds nobody', (await adminNameUnnamed.run({ dryRun: false }, adminCtx)).plan.length === 0);

  await changeDisplayName.run({ displayName: 'MyOwnPick' }, ctx('nn_blank'));
  const picked = (await user('nn_blank'))!;
  check(
    'the free change costs nothing and uses up the credit',
    picked.displayName === 'MyOwnPick' && picked.cash === 500 && picked.freeNameChanges === 0,
    picked,
  );
  check(
    'the old assigned name is freed',
    !(await db.collection('usernames').doc(planned.to.toLowerCase()).get()).exists,
  );

  await db.collection('users').doc('nn_blank').update({ cash: 50000 });
  let refused = false;
  try {
    await changeDisplayName.run({ displayName: 'SecondPick' }, ctx('nn_blank'));
  } catch (err) {
    refused = /change your name again/i.test((err as Error).message);
  }
  check('the next change is back under the cooldown', refused);

  let blocked = false;
  try {
    await adminNameUnnamed.run({}, ctx('nn_blank'));
  } catch {
    blocked = true;
  }
  check('players cannot run it', blocked);
});
