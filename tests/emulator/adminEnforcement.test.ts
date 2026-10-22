// The player-file enforcement tools against the LOCAL Firebase emulator.
// Never touches production.
//
//   npm run test:enforcement
//
// Cut account: the preview writes nothing, the cut shrinks everything by one
// factor and books the ledger, history and bell. Co-traders: someone trading
// the same stock the same way within 10 minutes is found; someone outside the
// window or the other way is not.

import { it } from 'vitest';
import { createRequire } from 'module';
import { check, type Loose } from './harness';

const require = createRequire(import.meta.url);

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

const { adminCutAccount, adminCoTraders } =
  require('../../functions/src/admin/adminEnforcement') as typeof import('../../functions/src/admin/adminEnforcement');
const { ADMIN_UID } =
  require('../../functions/src/shared/constants') as typeof import('../../functions/src/shared/constants');

const adminCtx = { auth: { uid: ADMIN_UID } };
const MIN = 60000;
const near = (a: number, b: number) => Math.abs(a - b) < 0.02;
const user = async (uid: string) => (await db.collection('users').doc(uid).get()).data();

async function main() {
  await db.doc('market/current').set({ prices: { ENF_A: 10, ENF_B: 50 } }, { merge: true });

  // ── Cut account ────────────────────────────────────────────────────────────
  await db
    .collection('users')
    .doc('cut_1')
    .set({
      displayName: 'CutMe',
      cash: 1000,
      marginUsed: 2000,
      holdings: { ENF_A: 100, ENF_B: 40 },
      holdingCohorts: { ENF_A: { eligible: 100, pending: [] } },
    });
  const preview = (await adminCutAccount.run(
    { uid: 'cut_1', target: 500, note: 'Bye.', preview: true },
    adminCtx,
  )) as Loose;
  check(
    'the preview shows the cut',
    preview.preview === true && near(preview.after, 500) && preview.dropPercent === 75,
    preview,
  );
  check('the preview shows the message', preview.message === 'Your account dropped by 75%. Bye.', preview.message);
  check('the preview writes nothing', (await user('cut_1')).cash === 1000);

  const applied = (await adminCutAccount.run(
    { uid: 'cut_1', target: 500, note: 'Bye.', preview: false },
    adminCtx,
  )) as Loose;
  const cut = await user('cut_1');
  check('the cut applies', applied.preview === false && cut.cash === 250 && cut.marginUsed === 500, cut);
  check(
    'shares and lots shrink by the same factor',
    cut.holdings.ENF_A === 25 && cut.holdingCohorts.ENF_A.eligible === 25,
  );
  const ledger = await db.collection('ledger').where('uid', '==', 'cut_1').get();
  const types = ledger.docs.map((d: Loose) => `${d.data().account}:${d.data().type}`).sort();
  check('cash and shares are both booked', types.join() === 'cash:admin_slash,shares:admin_slash', types);
  const log = await db.collection('adminLog').where('uid', '==', 'cut_1').get();
  check('the admin history records it', log.size === 1 && log.docs[0].data().action === 'slash_account');
  const bell = await db.collection('users').doc('cut_1').collection('notifications').get();
  check('the player gets the bell', bell.size === 1 && bell.docs[0].data().message.includes('75%'));

  const again = (await adminCutAccount.run({ uid: 'cut_1', target: 500, preview: false }, adminCtx)) as Loose;
  check('cutting again to the same target does nothing', again.skipped === true && (await user('cut_1')).cash === 250);

  await db
    .collection('users')
    .doc('cut_short')
    .set({ cash: 5000, shorts: { ENF_A: { shares: 3 } } });
  let refused = false;
  try {
    await adminCutAccount.run({ uid: 'cut_short', target: 100, preview: true }, adminCtx);
  } catch (e) {
    refused = /shorts/.test((e as Error).message);
  }
  check('an account with open shorts is refused', refused);

  let notAdmin = false;
  try {
    await adminCutAccount.run({ uid: 'cut_1', target: 100, preview: true }, { auth: { uid: 'someone' } });
  } catch {
    notAdmin = true;
  }
  check('only the admin can use it', notAdmin);

  // ── Co-traders ─────────────────────────────────────────────────────────────
  const now = Date.now() - 60 * MIN;
  const trade = (uid: string, ticker: string, action: string, at: number) =>
    db
      .collection('trades')
      .add({ uid, ticker, action, amount: 10, price: 10, timestamp: admin.firestore.Timestamp.fromMillis(at) });
  for (const u of ['co_lead', 'co_shadow', 'co_late', 'co_other']) {
    await db.collection('users').doc(u).set({ displayName: u });
  }
  await trade('co_lead', 'ENF_A', 'buy', now);
  await trade('co_lead', 'ENF_B', 'sell', now + 30 * MIN);
  await trade('co_shadow', 'ENF_A', 'buy', now + 2 * MIN);
  await trade('co_shadow', 'ENF_B', 'short', now + 31 * MIN);
  await trade('co_late', 'ENF_A', 'buy', now + 20 * MIN);
  await trade('co_other', 'ENF_A', 'sell', now + MIN);
  await db
    .collection('watchlist_alerts')
    .add({ type: 'coordinated_pressure', participantUIDs: ['co_lead', 'co_late'] });

  const co = (await adminCoTraders.run({ uid: 'co_lead', days: 7 }, adminCtx)) as Loose;
  const shadow = co.rows.find((r: Loose) => r.uid === 'co_shadow');
  check('their own trades are counted', co.trades === 2, co.trades);
  check(
    'a shadow trading the same way within 10 minutes is found',
    shadow?.matches === 2 && shadow?.ownTrades === 2,
    co.rows,
  );
  check(
    'someone outside the window or trading the other way is not',
    !co.rows.some((r: Loose) => r.uid === 'co_late' || r.uid === 'co_other'),
  );
  check(
    'a shared flag without trading together is listed separately',
    co.flagOnly.length === 1 && co.flagOnly[0].uid === 'co_late' && co.flagOnly[0].sharedFlags === 1,
    co.flagOnly,
  );
}

it('admin enforcement tools', main);
