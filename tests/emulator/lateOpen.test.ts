// A late Thursday open, end to end, against the LOCAL emulator: the admin
// pushes the open back two hours, the usual 20:56 auction stands down, the
// pre-market queue opens at 22:30 instead, and delayedOpenTick runs the auction
// and the open at their new times.

import { beforeAll, it, vi } from 'vitest';
import { createRequire } from 'module';
import { check, seedEmulator, type Loose } from './harness';

const require = createRequire(import.meta.url);

beforeAll(seedEmulator);

const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'stockism-abb28' });
const db = admin.firestore();

const { adminDelayOpen, delayedOpenTick } =
  require('../../functions/src/market/delayedOpen') as typeof import('../../functions/src/market/delayedOpen');
const { processMarketOpenOrders } =
  require('../../functions/src/orders/marketOrders') as typeof import('../../functions/src/orders/marketOrders');
const { createPreMarketOrder } =
  require('../../functions/src/orders/preMarket') as typeof import('../../functions/src/orders/preMarket');
const { ADMIN_UID } =
  require('../../functions/src/shared/constants') as typeof import('../../functions/src/shared/constants');

const TICKER = 'GUN';

// This week's Thursday, at a UTC time.
const thursday = (() => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  while (d.getUTCDay() !== 4) d.setUTCDate(d.getUTCDate() + 1);
  return d.getTime();
})();
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  vi.setSystemTime(thursday + (h! * 60 + m!) * 60 * 1000);
};

let ipSeed = 0;
const ctx = (uid: string) => ({ auth: { uid }, rawRequest: { ip: `203.0.113.${++ipSeed}` } });
const err = async (fn: Loose, data: Loose, uid: string) => {
  try {
    await fn.run(data, ctx(uid));
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};
const market = async () => (await db.collection('market').doc('current').get()).data();

async function main() {
  vi.useFakeTimers({ toFake: ['Date'] });
  await db.collection('users').doc('lo_buyer').set({ displayName: 'lo_buyer', cash: 100000, holdings: {} });

  at('19:00');
  const setErr = await err(adminDelayOpen, { minutes: 120 }, ADMIN_UID);
  let m = await market();
  check('the admin can push the open back', !setErr && m.delayedOpen?.openAt === thursday + 23 * 3600000, setErr);
  check('the market stays halted until then', m.marketHalted === true);
  check('only the admin can', !!(await err(adminDelayOpen, { minutes: 60 }, 'lo_buyer')));

  at('20:40');
  const early = await err(createPreMarketOrder, { ticker: TICKER, action: 'buy', shares: 2 }, 'lo_buyer');
  check('the usual queue stays shut', !!early && /late/i.test(early), early);

  at('22:40');
  const placed = await err(createPreMarketOrder, { ticker: TICKER, action: 'buy', shares: 2 }, 'lo_buyer');
  check('the queue opens 30 minutes before the late open', placed === null, placed);
  const orderSnap = await db.collection('preMarketOrders').where('userId', '==', 'lo_buyer').get();
  const orderRef = orderSnap.docs[0]?.ref;
  // The emulator stamps createdAt with the real clock; this test's clock is set.
  await orderRef.update({ createdAt: admin.firestore.Timestamp.fromMillis(Date.now()) });

  at('22:56');
  await (processMarketOpenOrders as Loose).run({});
  check('the usual auction stands down', (await orderRef.get()).data().status === 'PENDING');

  at('22:54');
  await (delayedOpenTick as Loose).run({});
  m = await market();
  check(
    'the tick runs the review steps on time',
    ['chapterReviewRecap', 'preMarketOpenAlert', 'collapseReviewHistory'].every((s) => m.delayedOpen.done.includes(s)),
    m.delayedOpen.done,
  );
  check('and nothing early', !m.delayedOpen.done.includes('processMarketOpenOrders'));

  at('22:56');
  await (delayedOpenTick as Loose).run({});
  m = await market();
  const filled = (await orderRef.get()).data();
  check('the late auction fills the order', filled.status === 'FILLED', filled);
  check('the market is still halted before the open', m.marketHalted === true);

  at('23:00');
  await (delayedOpenTick as Loose).run({});
  m = await market();
  check('the open lifts the halt', m.marketHalted === false && !m.haltReason);

  at('23:16');
  await (delayedOpenTick as Loose).run({});
  m = await market();
  check('every step ran once', m.delayedOpen.done.length === 9, m.delayedOpen.done);

  vi.useRealTimers();
}

it('late open', main);
