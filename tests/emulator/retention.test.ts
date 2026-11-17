// The nightly clean-up, against the LOCAL Firebase emulator. Never touches
// production.
//
// Old read notifications, old order connection records and year-old copies of
// deleted accounts go; everything newer, and every unread notification, stays.

import { beforeAll, it } from 'vitest';
import { createRequire } from 'module';
import { check, resetEmulator } from './harness';

const require = createRequire(import.meta.url);

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
const { Timestamp } = admin.firestore;

const { runRetentionCleanup } =
  require('../../functions/src/admin/retention') as typeof import('../../functions/src/admin/retention');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const ago = (days: number) => Timestamp.fromMillis(NOW - days * DAY);
const exists = async (path: string) => (await db.doc(path).get()).exists;

beforeAll(resetEmulator);

it('removes only what is past its limit', async () => {
  const note = (id: string, read: boolean, days: number) =>
    db.doc(`users/rt_user/notifications/${id}`).set({ read, createdAt: ago(days), title: id });
  await Promise.all([
    note('old_read', true, 100),
    note('old_unread', false, 100),
    note('new_read', true, 10),
    db.doc('orderOrigins/old').set({ uid: 'rt_user', ipKey: 'k', createdAt: NOW - 200 * DAY }),
    db.doc('orderOrigins/new').set({ uid: 'rt_user', ipKey: 'k', createdAt: NOW - 100 * DAY }),
    db.doc('deletedUsers/old').set({ uid: 'old', deletedAt: ago(400) }),
    db.doc('deletedUsers/new').set({ uid: 'new', deletedAt: ago(300) }),
  ]);

  const result = await runRetentionCleanup(NOW);
  check(
    'one of each kind was removed',
    result.notifications === 1 && result.orderOrigins === 1 && result.deletedAccounts === 1,
    result,
  );
  check('the old read notification is gone', !(await exists('users/rt_user/notifications/old_read')));
  check('an old unread notification stays', await exists('users/rt_user/notifications/old_unread'));
  check('a recent read notification stays', await exists('users/rt_user/notifications/new_read'));
  check('the old connection record is gone', !(await exists('orderOrigins/old')));
  check('a newer connection record stays', await exists('orderOrigins/new'));
  check('the year-old account copy is gone', !(await exists('deletedUsers/old')));
  check('a newer account copy stays', await exists('deletedUsers/new'));

  const again = await runRetentionCleanup(NOW);
  check('a second run finds nothing', again.notifications + again.orderOrigins + again.deletedAccounts === 0, again);
});
