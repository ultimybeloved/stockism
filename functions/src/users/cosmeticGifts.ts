// Gifting: buy a shop cosmetic, or a bundle, for another player.
//
// The giver pays what they would pay to buy it themselves (this week's featured
// discount included) and the item lands in the recipient's collection. A gifted
// bundle always costs the whole set at the bundle discount, even when the
// recipient already owns some pieces (Darth YG's call); they get the rest. There is
// deliberately no message box: free text sent to another player is a harassment
// channel, so the notification only names the sender.
//
// Both sides go in the ledger: the giver's cash out ('cosmetic_gift_sent') and
// the recipient's item in ('cosmetic_gift_received', account 'cosmetics'), so a
// gifted item can always be told apart from a purchase or an admin grant.
//
// Every gift also writes an admin-only `giftLog` entry with the giver's
// connection, so the admin gift log (adminGiftLog.ts) can spot an alt feeding
// its main. The ledger is player-readable, so the connection never goes there.
import * as functions from 'firebase-functions/v1';
import { cf, requireAppCheck } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { COSMETIC_CATALOG, COSMETIC_PRICE_LIST } from '../shared/constants/cosmetics';
import { BUNDLE_MAP, bundleQuote, featuredCosmeticId, featuredPrice } from '../shared/rules/shop';
import { ownEntry } from '../shared/lookup';
import { networkKey, checkDiscordWall } from '../shared/accountGuards';
import { recordLedger } from '../shared/ledger';
import { chargeShop } from '../shared/shopPayment';
import { touchLastActive } from '../shared/activity';
import { writeNotification } from '../shared/notifications';
import { sendDiscordDM, pxe } from '../shared/discordApi';
import type { UserData } from '../shared/types';

const db = admin.firestore();

// Enough for generosity, too few to flood someone's notifications.
const GIFTS_PER_DAY = 10;

type GiftUser = UserData & { giftsSent?: { day?: string; count?: number } };

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const giftCosmetic = cf().https.onCall(
  async (data: { cosmeticId?: unknown; bundleId?: unknown; recipient?: unknown } | null, context) => {
    requireAppCheck(context);
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');

    const { cosmeticId, bundleId, recipient } = data || {};
    const cosmetic = ownEntry(COSMETIC_CATALOG, cosmeticId);
    const bundle = ownEntry(BUNDLE_MAP, bundleId);
    if (bundle ? cosmetic || bundle.items.some((id) => !COSMETIC_CATALOG[id]) : !cosmetic) {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid item.');
    }
    // Season rewards are earned, never bought, so they can't be gifted either.
    if (cosmetic?.earned) {
      throw new functions.https.HttpsError('failed-precondition', 'This one is earned in seasons, not sold.');
    }
    const itemId = (bundle?.id || cosmeticId) as string;
    const giftName = bundle ? `the ${bundle.name} bundle` : cosmetic!.name;
    const recipientName = typeof recipient === 'string' ? recipient.trim() : '';
    if (!recipientName || recipientName.length > 40) {
      throw new functions.https.HttpsError('invalid-argument', "Enter the player's name.");
    }

    const uid = context.auth.uid;
    touchLastActive(uid, 'cosmetics');
    const featured = !bundle && featuredCosmeticId(COSMETIC_PRICE_LIST) === cosmeticId;

    // Resolve the name outside the transaction; the transaction re-reads both
    // accounts, so nothing decided here can go stale.
    const nameDoc = await db.collection('usernames').doc(recipientName.toLowerCase()).get();
    const recipientUid: string | undefined = nameDoc.exists ? nameDoc.data()!.uid : undefined;
    if (!recipientUid) throw new functions.https.HttpsError('not-found', 'No player has that name.');
    if (recipientUid === uid) throw new functions.https.HttpsError('invalid-argument', "You can't gift yourself.");

    const giverRef = db.collection('users').doc(uid);
    const recipientRef = db.collection('users').doc(recipientUid);
    const now = Date.now();
    const today = utcDay(now);

    const result = await db.runTransaction(async (tx) => {
      const [giverDoc, recipientDoc] = await Promise.all([tx.get(giverRef), tx.get(recipientRef)]);
      if (!giverDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');
      if (!recipientDoc.exists) throw new functions.https.HttpsError('not-found', 'No player has that name.');

      const giver = giverDoc.data() as GiftUser;
      const target = recipientDoc.data() as GiftUser;
      if (giver.isBot || giver.isBanned) {
        throw new functions.https.HttpsError('permission-denied', 'Action not allowed.');
      }
      // A suspected alt behind the Discord wall can't trade, so it must not be able to
      // turn its cash into gifts for another account either.
      checkDiscordWall(giver);
      if (target.isBot || target.isBanned) {
        throw new functions.https.HttpsError('failed-precondition', "That player can't receive gifts.");
      }
      const owned = (target.ownedCosmetics as string[] | undefined) || [];
      // What lands, what it's worth at list price, and what the giver pays.
      let items: string[];
      let listValue: number;
      let price: number;
      if (bundle) {
        const quote = bundleQuote(bundle, owned, (id) => COSMETIC_CATALOG[id]?.price);
        items = quote.missing;
        listValue = quote.fullPrice;
        price = bundleQuote(bundle, [], (id) => COSMETIC_CATALOG[id]?.price).price;
      } else {
        items = owned.includes(itemId) ? [] : [itemId];
        listValue = cosmetic!.price;
        price = featured ? featuredPrice(cosmetic!.price) : cosmetic!.price;
      }
      if (!items.length) {
        throw new functions.https.HttpsError(
          'already-exists',
          `${target.displayName || 'They'} already own ${bundle ? 'the whole set' : 'this'}.`,
        );
      }
      const sentToday = giver.giftsSent?.day === today ? giver.giftsSent.count || 0 : 0;
      if (sentToday >= GIFTS_PER_DAY) {
        throw new functions.https.HttpsError(
          'resource-exhausted',
          `You can send ${GIFTS_PER_DAY} gifts a day. More tomorrow.`,
        );
      }
      const { updates } = chargeShop(tx, uid, giver, price, {
        type: 'cosmetic_gift_sent',
        ref: itemId,
        detail: {
          to: recipientUid,
          ...(bundle && { items }),
          ...(featured && { featured: true, listPrice: listValue }),
        },
      });
      tx.update(giverRef, { ...updates, giftsSent: { day: today, count: sentToday + 1 } });
      tx.update(recipientRef, { ownedCosmetics: FieldValue.arrayUnion(...items) });
      recordLedger(tx, {
        uid: recipientUid,
        type: 'cosmetic_gift_received',
        account: 'cosmetics',
        amount: listValue,
        ref: itemId,
        detail: { from: uid, ...(bundle && { items }) },
      });
      tx.set(db.collection('giftLog').doc(), {
        at: now,
        fromUid: uid,
        fromName: giver.displayName || null,
        fromNet: networkKey(context.rawRequest?.ip),
        toUid: recipientUid,
        toName: target.displayName || recipientName,
        itemId,
        itemName: bundle ? `${bundle.name} bundle` : cosmetic!.name,
        items,
        price,
        value: listValue,
      });

      return {
        price,
        giverName: giver.displayName || 'A player',
        recipientName: target.displayName || recipientName,
        recipientDiscordId: target.discordId as string | undefined,
      };
    });

    // Fail-soft: the gift has landed; a missed notification must not undo it.
    const text = `${result.giverName} gifted you ${giftName}! Find it in Customize, under My Look.`;
    try {
      await writeNotification(recipientUid, {
        type: 'system',
        title: '🎁 You got a gift',
        message: text,
        data: { ...(bundle ? { bundleId } : { cosmeticId }), from: result.giverName },
      });
      if (result.recipientDiscordId) await sendDiscordDM(result.recipientDiscordId, `${pxe('gift')} ${text}`);
    } catch (err) {
      logger.warn('giftCosmetic: notification failed:', (err as Error).message);
    }

    return { success: true, price: result.price, recipientName: result.recipientName };
  },
);
