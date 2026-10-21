// One-of-a-kind auctions against the LOCAL Firebase emulator. Never touches
// production.
//
// Run via: npm run test:auction
//
// The money is the point: a held bid leaves cash, comes back in full when
// outbid, and is spent only by the winner. Every move books a ledger entry and
// the flow counter, so no gain board sees a hold as a loss.

import { it } from 'vitest';
import { createRequire } from 'module';
import { check, type Loose } from './harness';

const require = createRequire(import.meta.url);

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

const { placeAuctionBid, settleAuction, adminCreateAuction, adminCancelAuction } =
  require('../../functions/src/users/auctions') as typeof import('../../functions/src/users/auctions');
const { ADMIN_UID } = require('../../functions/src/shared/constants') as Loose;

const run = (fn: Loose, data: Loose, uid: string | null) =>
  fn.run(data, { auth: uid ? { uid } : undefined, rawRequest: {} });
const fails = (p: Promise<unknown>, pattern: RegExp) =>
  p.then(
    () => false,
    (e: Loose) => pattern.test(e.message),
  );
const user = async (uid: string) => (await db.collection('users').doc(uid).get()).data();
const auction = async (id: string) => (await db.collection('auctions').doc(id).get()).data();
const ledger = async (uid: string, type: string) =>
  (await db.collection('ledger').where('uid', '==', uid).where('type', '==', type).get()).docs.map(
    (d: Loose) => d.data().amount,
  );
const ITEM = 'glow_oo_blackmoney';

async function main() {
  for (const [uid, cash] of [
    ['ann', 500000],
    ['ben', 300000],
    ['cat', 1000],
  ] as const) {
    await db.collection('users').doc(uid).set({ displayName: uid.toUpperCase(), cash });
  }
  await db.collection('users').doc(ADMIN_UID).set({ displayName: 'Admin', cash: 0 });

  console.log('\n1: admin puts an item up');
  const now = Date.now();
  check(
    'a shop item is refused',
    await fails(
      run(adminCreateAuction, { itemId: 'glow_gold', startsAt: now, endsAt: now + 7200e3, startingBid: 1 }, ADMIN_UID),
      /one-of-one/,
    ),
  );
  const { id } = await run(
    adminCreateAuction,
    { itemId: ITEM, startsAt: now - 1000, endsAt: now + 2 * 3600e3, startingBid: 100000 },
    ADMIN_UID,
  );
  check('auction created', (await auction(id)).status === 'live');
  check(
    'the same item twice is refused',
    await fails(
      run(adminCreateAuction, { itemId: ITEM, startsAt: now, endsAt: now + 7200e3, startingBid: 1 }, ADMIN_UID),
      /already/,
    ),
  );

  console.log('\n2: bids and holds');
  check(
    'under the starting bid',
    await fails(run(placeAuctionBid, { auctionId: id, amount: 99999 }, 'ann'), /lowest bid/),
  );
  check('more than your cash', await fails(run(placeAuctionBid, { auctionId: id, amount: 200000 }, 'cat'), /cash/));
  await run(placeAuctionBid, { auctionId: id, amount: 100000 }, 'ann');
  let ann = await user('ann');
  check('ann holds 100k', ann.cash === 400000, ann.cash);
  check('hold booked as a flow, not a loss', ann.auctionFlowValue === -100000 && ann.grantedValue === -100000);
  const annN = ann.auctionNumbers[id];
  let a = await auction(id);
  check('public doc shows a number, not a name', a.topBidder === annN && !JSON.stringify(a).includes('ann'));

  await run(placeAuctionBid, { auctionId: id, amount: 105000 }, 'ben');
  ann = await user('ann');
  const ben = await user('ben');
  check('ann refunded in full when outbid', ann.cash === 500000 && ann.auctionFlowValue === 0, ann.cash);
  check('ben holds 105k', ben.cash === 195000);
  check('ann and ben have different numbers', ben.auctionNumbers[id] !== annN);
  const note = await db.collection('users').doc('ann').collection('notifications').where('title', '==', 'Outbid').get();
  check('ann told she was outbid', note.size === 1);

  await run(placeAuctionBid, { auctionId: id, amount: 200000 }, 'ann');
  await run(placeAuctionBid, { auctionId: id, amount: 250000 }, 'ann');
  ann = await user('ann');
  check('raising your own top bid holds only the difference', ann.cash === 250000, ann.cash);
  check('ann keeps her number', ann.auctionNumbers[id] === annN);
  check('ben refunded', (await user('ben')).cash === 300000);

  console.log('\n3: a late bid pushes the end back');
  await db
    .collection('auctions')
    .doc(id)
    .update({ endsAt: Date.now() + 60e3 });
  await run(placeAuctionBid, { auctionId: id, amount: 262500 }, 'ben');
  a = await auction(id);
  check('end moved to about 5 minutes out', a.endsAt > Date.now() + 4 * 60e3, a.endsAt - Date.now());

  console.log('\n4: it ends');
  check('not settled before the end', (await settleAuction(id)) === null);
  await db
    .collection('auctions')
    .doc(id)
    .update({ endsAt: Date.now() - 1 });
  await settleAuction(id);
  const won = await user('ben');
  a = await auction(id);
  check('item goes to the top bidder', won.ownedCosmetics.includes(ITEM));
  check('winning money is spent', won.cash === 300000 - 262500, won.cash);
  check('flow is reversed, so it counts like a purchase', won.auctionFlowValue === 0 && won.grantedValue === 0);
  check('winner named once it ends', a.status === 'ended' && a.winnerName === 'BEN');
  check('ann (outbid) got everything back', (await user('ann')).cash === 500000);
  check('a second settle does nothing', (await settleAuction(id)) === null);
  const holds = (await ledger('ben', 'auction_hold')).reduce((s: number, x: number) => s + x, 0);
  const refunds = (await ledger('ben', 'auction_refund')).reduce((s: number, x: number) => s + x, 0);
  check('ben ledger adds up to the price', holds + refunds === -262500, holds + refunds);
  check('win booked in the ledger', (await ledger('ben', 'auction_win'))[0] === 262500);
  check(
    'bidding after the end is refused',
    await fails(run(placeAuctionBid, { auctionId: id, amount: 400000 }, 'ann'), /ended/),
  );

  console.log('\n5: cancelling hands the top bid back');
  await db.collection('users').doc('ben').update({ ownedCosmetics: [] });
  await db.collection('auctions').doc(id).update({ status: 'cancelled' });
  const second = await run(
    adminCreateAuction,
    { itemId: ITEM, startsAt: Date.now() - 1000, endsAt: Date.now() + 2 * 3600e3, startingBid: 1000 },
    ADMIN_UID,
  );
  await run(placeAuctionBid, { auctionId: second.id, amount: 1000 }, 'cat');
  check('cat holds 1000', (await user('cat')).cash === 0);
  await run(adminCancelAuction, { auctionId: second.id }, ADMIN_UID);
  const cat = await user('cat');
  check('cat refunded on cancel', cat.cash === 1000 && cat.auctionFlowValue === 0);
  check('only an admin can create', await fails(run(adminCreateAuction, { itemId: ITEM }, 'ann'), /admin|permission/i));
}

it('auctions', main);
