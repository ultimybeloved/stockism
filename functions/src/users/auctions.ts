// One-of-a-kind auctions (rules: shared/rules/auctions). One cosmetic, one
// winner, and the winning money is gone for good: a money sink aimed at the
// players who hold most of it.
//
// auctions/{id} is public: the item, times, top bid and the recent bids, each
// under the bidder's number. auctionBidders/{id} is server-only: who has which
// number and who holds the top bid. A player's own number is copied to their
// user doc (auctionNumbers) so the page can say "You".
//
// The top bid is held: taken from the bidder's cash and booked as a flow
// (grantedFlowUpdate, own counter) like a Ladder deposit, so it isn't a loss on
// any gain board. Outbid, it comes straight back with the opposite flow. Won,
// the flow is reversed and it becomes a plain purchase, same as the shop.
import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import { cf, requireAdmin, requireAppCheck } from '../shared/fnConfig';
import { checkBanned, checkDiscordWall } from '../shared/accountGuards';
import { grantedFlowUpdate } from '../shared/equity';
import { recordLedger } from '../shared/ledger';
import { writeNotification } from '../shared/notifications';
import { touchLastActive, recordHeartbeat } from '../shared/activity';
import { logAdminAction } from '../shared/adminLog';
import { reportError } from '../shared/sentry';
import { COSMETIC_CATALOG } from '../shared/constants';
import { AUCTION_BIDS_SHOWN, bidProblem, endAfterBid, pickBidderNumber, type Auction } from '../shared/rules/auctions';

const db = admin.firestore();
const auctionRef = (id: string) => db.collection('auctions').doc(id);
const biddersRef = (id: string) => db.collection('auctionBidders').doc(id);

/** The held-bid counter, kept apart from the Ladder and prediction flows. */
const holdFlow = (signed: number) => grantedFlowUpdate(signed, 'auctionFlowValue');

interface Bidders {
  numbers: Record<string, number>;
  top: { uid: string; amount: number } | null;
}

const itemName = (itemId: string) => COSMETIC_CATALOG[itemId]?.name || itemId;
const money = (n: number) => `$${n.toLocaleString('en-US')}`;

/** Hand a held bid back (outbid or cancelled), inside the caller's transaction. */
function refundHold(
  tx: Transaction,
  uid: string,
  user: FirebaseFirestore.DocumentData,
  amount: number,
  auctionId: string,
) {
  const cash = (user.cash || 0) + amount;
  tx.update(db.collection('users').doc(uid), { cash, ...holdFlow(amount) });
  recordLedger(tx, { uid, type: 'auction_refund', amount, cashAfter: cash, ref: auctionId });
}

/** Bid on a live auction. The whole bid is held; raising your own top bid holds only the difference. */
export const placeAuctionBid = cf().https.onCall(async (data, context) => {
  requireAppCheck(context);
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in to bid.');
  const uid = context.auth.uid;
  const auctionId = String(data?.auctionId || '');
  const amount = Number(data?.amount);
  if (!auctionId || auctionId.includes('/')) throw new functions.https.HttpsError('invalid-argument', 'Which auction?');
  touchLastActive(uid);

  const outbid = await db.runTransaction(async (tx) => {
    const now = Date.now();
    const userRef = db.collection('users').doc(uid);
    const [aSnap, bSnap, uSnap] = await Promise.all([
      tx.get(auctionRef(auctionId)),
      tx.get(biddersRef(auctionId)),
      tx.get(userRef),
    ]);
    if (!aSnap.exists) throw new functions.https.HttpsError('not-found', 'No such auction.');
    if (!uSnap.exists) throw new functions.https.HttpsError('not-found', 'No account.');
    const a = aSnap.data() as Auction;
    const user = uSnap.data()!;
    checkBanned(user);
    checkDiscordWall(user);
    if (user.isBot) throw new functions.https.HttpsError('permission-denied', 'Bots cannot bid.');

    const bidders: Bidders = bSnap.exists ? (bSnap.data() as Bidders) : { numbers: {}, top: null };
    const prev = bidders.top;
    const held = prev && prev.uid === uid ? prev.amount : 0;
    const problem = bidProblem(a, amount, user.cash || 0, held, now);
    if (problem) throw new functions.https.HttpsError('failed-precondition', problem);

    // The player being outbid gets their money back in the same transaction.
    const prevSnap = prev && prev.uid !== uid ? await tx.get(db.collection('users').doc(prev.uid)) : null;

    const n = bidders.numbers[uid] ?? pickBidderNumber(Object.values(bidders.numbers));
    const charge = amount - held;
    const cash = (user.cash || 0) - charge;
    tx.update(userRef, { cash, ...holdFlow(-charge), [`auctionNumbers.${auctionId}`]: n });
    recordLedger(tx, { uid, type: 'auction_hold', amount: -charge, cashAfter: cash, ref: auctionId });
    if (prevSnap?.exists) refundHold(tx, prev!.uid, prevSnap.data()!, prev!.amount, auctionId);

    tx.set(biddersRef(auctionId), { numbers: { ...bidders.numbers, [uid]: n }, top: { uid, amount } });
    tx.update(auctionRef(auctionId), {
      topBid: amount,
      topBidder: n,
      bidCount: FieldValue.increment(1),
      bids: [{ n, amount, at: now }, ...(a.bids || [])].slice(0, AUCTION_BIDS_SHOWN),
      endsAt: endAfterBid(a.endsAt, now),
    });
    return prevSnap?.exists ? { uid: prev!.uid, amount: prev!.amount, item: itemName(a.itemId) } : null;
  });

  if (outbid) {
    await writeNotification(outbid.uid, {
      type: 'system',
      title: 'Outbid',
      message: `Someone bid more for ${outbid.item}. Your ${money(outbid.amount)} is back in your cash.`,
      data: { auctionId },
    });
  }
  return { ok: true };
});

/** Close one auction whose time is up: the item to the top bidder, their held money spent. */
export async function settleAuction(auctionId: string, now = Date.now()) {
  const result = await db.runTransaction(async (tx) => {
    const [aSnap, bSnap] = await Promise.all([tx.get(auctionRef(auctionId)), tx.get(biddersRef(auctionId))]);
    const a = aSnap.data() as Auction | undefined;
    if (!a || a.status !== 'live' || a.endsAt > now) return null;
    const top = (bSnap.data() as Bidders | undefined)?.top || null;
    if (!top) {
      tx.update(auctionRef(auctionId), { status: 'ended', winnerName: null });
      return { winner: null, itemId: a.itemId };
    }
    const uRef = db.collection('users').doc(top.uid);
    const user = (await tx.get(uRef)).data() || {};
    // The held money becomes a purchase: undo the flow so it counts like a shop buy.
    tx.update(uRef, {
      ownedCosmetics: FieldValue.arrayUnion(a.itemId),
      ...holdFlow(top.amount),
    });
    recordLedger(tx, {
      uid: top.uid,
      type: 'auction_win',
      account: 'cosmetics',
      amount: top.amount,
      ref: auctionId,
      detail: { itemId: a.itemId },
    });
    tx.update(auctionRef(auctionId), { status: 'ended', winnerName: user.displayName || 'A trader' });
    return { winner: top.uid, amount: top.amount, itemId: a.itemId };
  });
  if (result?.winner) {
    await writeNotification(result.winner, {
      type: 'system',
      title: 'You won the auction',
      message: `${itemName(result.itemId)} is yours, one of one. Find it in Customization.`,
      data: { auctionId },
    });
  }
  return result;
}

/** Every 10 minutes: close any auction whose time is up. */
export const settleAuctions = cf()
  .pubsub.schedule('every 10 minutes')
  .onRun(async () => {
    try {
      const due = await db.collection('auctions').where('status', '==', 'live').where('endsAt', '<=', Date.now()).get();
      for (const d of due.docs) {
        const r = await settleAuction(d.id);
        logger.info(`settleAuctions: ${d.id}`, r);
      }
      await recordHeartbeat('settleAuctions');
    } catch (err) {
      reportError(err, { where: 'settleAuctions' });
    }
    return null;
  });

/** Admin: put a one-of-one item up for auction. */
export const adminCreateAuction = cf().https.onCall(async (data, context) => {
  requireAdmin(context);
  const itemId = String(data?.itemId || '');
  const startsAt = Number(data?.startsAt);
  const endsAt = Number(data?.endsAt);
  const startingBid = Math.floor(Number(data?.startingBid));
  const item = COSMETIC_CATALOG[itemId];
  if (!item?.oneOfOne) throw new functions.https.HttpsError('invalid-argument', 'That item is not a one-of-one.');
  if (!(startsAt > 0 && endsAt > startsAt + 60 * 60 * 1000)) {
    throw new functions.https.HttpsError('invalid-argument', 'It has to run at least an hour.');
  }
  if (!(startingBid >= 1)) throw new functions.https.HttpsError('invalid-argument', 'Set a starting bid.');
  const taken = await db.collection('auctions').where('itemId', '==', itemId).get();
  if (taken.docs.some((d) => d.data().status !== 'cancelled')) {
    throw new functions.https.HttpsError('already-exists', 'That item has already been auctioned.');
  }
  const owners = await db.collection('users').where('ownedCosmetics', 'array-contains', itemId).limit(1).get();
  if (!owners.empty) throw new functions.https.HttpsError('already-exists', 'Someone already owns that item.');

  const ref = db.collection('auctions').doc();
  const auction: Auction = {
    id: ref.id,
    itemId,
    startsAt,
    endsAt,
    startingBid,
    topBid: null,
    topBidder: null,
    bidCount: 0,
    bids: [],
    status: 'live',
  };
  await ref.set(auction);
  await logAdminAction(context, { action: 'create_auction', after: `${itemId} from ${money(startingBid)}` });
  return { id: ref.id };
});

/** Admin: call an auction off. The top bid goes back. */
export const adminCancelAuction = cf().https.onCall(async (data, context) => {
  requireAdmin(context);
  const auctionId = String(data?.auctionId || '');
  await db.runTransaction(async (tx) => {
    const [aSnap, bSnap] = await Promise.all([tx.get(auctionRef(auctionId)), tx.get(biddersRef(auctionId))]);
    const a = aSnap.data() as Auction | undefined;
    if (!a || a.status !== 'live') throw new functions.https.HttpsError('failed-precondition', 'Not a live auction.');
    const top = (bSnap.data() as Bidders | undefined)?.top || null;
    const uSnap = top ? await tx.get(db.collection('users').doc(top.uid)) : null;
    if (top && uSnap?.exists) refundHold(tx, top.uid, uSnap.data()!, top.amount, auctionId);
    tx.update(auctionRef(auctionId), { status: 'cancelled' });
  });
  await logAdminAction(context, { action: 'cancel_auction', after: auctionId });
  return { ok: true };
});
