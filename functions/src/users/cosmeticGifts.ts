// Gifting: buy a shop cosmetic for another player.
//
// The giver pays what they would pay to buy it themselves (this week's featured
// discount included) and the item lands in the recipient's collection. There is
// deliberately no message box: free text sent to another player is a harassment
// channel, so the notification only names the sender.
//
// Both sides go in the ledger: the giver's cash out ('cosmetic_gift_sent') and
// the recipient's item in ('cosmetic_gift_received', account 'cosmetics'), so a
// gifted item can always be told apart from a purchase or an admin grant.
import * as functions from 'firebase-functions/v1';
import { cf, requireAppCheck } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { COSMETIC_CATALOG, COSMETIC_PRICE_LIST } from '../shared/constants/cosmetics';
import { featuredCosmeticId, featuredPrice } from '../shared/rules/shop';
import { recordLedger } from '../shared/ledger';
import { touchLastActive } from '../shared/activity';
import { writeNotification } from '../shared/notifications';
import { sendDiscordDM } from '../shared/discordApi';
import type { UserData } from '../shared/types';

const db = admin.firestore();

// Enough for generosity, too few to flood someone's notifications.
const GIFTS_PER_DAY = 10;

type GiftUser = UserData & { giftsSent?: { day?: string; count?: number } };

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const giftCosmetic = cf().https.onCall(
  async (data: { cosmeticId?: unknown; recipient?: unknown } | null, context) => {
    requireAppCheck(context);
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');

    const { cosmeticId, recipient } = data || {};
    const cosmetic = typeof cosmeticId === 'string' ? COSMETIC_CATALOG[cosmeticId] : undefined;
    if (!cosmetic) throw new functions.https.HttpsError('invalid-argument', 'Invalid cosmetic.');
    const recipientName = typeof recipient === 'string' ? recipient.trim() : '';
    if (!recipientName || recipientName.length > 40) {
      throw new functions.https.HttpsError('invalid-argument', "Enter the player's name.");
    }

    const uid = context.auth.uid;
    touchLastActive(uid, 'cosmetics');
    const featured = featuredCosmeticId(COSMETIC_PRICE_LIST) === cosmeticId;
    const price = featured ? featuredPrice(cosmetic.price) : cosmetic.price;

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
      if (target.isBot || target.isBanned) {
        throw new functions.https.HttpsError('failed-precondition', "That player can't receive gifts.");
      }
      if (((target.ownedCosmetics as string[] | undefined) || []).includes(cosmeticId as string)) {
        throw new functions.https.HttpsError('already-exists', `${target.displayName || 'They'} already own this.`);
      }
      const sentToday = giver.giftsSent?.day === today ? giver.giftsSent.count || 0 : 0;
      if (sentToday >= GIFTS_PER_DAY) {
        throw new functions.https.HttpsError(
          'resource-exhausted',
          `You can send ${GIFTS_PER_DAY} gifts a day. More tomorrow.`,
        );
      }
      if ((giver.cash || 0) < price) throw new functions.https.HttpsError('failed-precondition', 'Not enough cash.');

      tx.update(giverRef, {
        cash: FieldValue.increment(-price),
        giftsSent: { day: today, count: sentToday + 1 },
      });
      tx.update(recipientRef, { ownedCosmetics: FieldValue.arrayUnion(cosmeticId) });
      recordLedger(tx, {
        uid,
        type: 'cosmetic_gift_sent',
        amount: -price,
        cashAfter: (giver.cash || 0) - price,
        ref: cosmeticId as string,
        detail: { to: recipientUid, ...(featured && { featured: true, listPrice: cosmetic.price }) },
      });
      recordLedger(tx, {
        uid: recipientUid,
        type: 'cosmetic_gift_received',
        account: 'cosmetics',
        amount: cosmetic.price,
        ref: cosmeticId as string,
        detail: { from: uid },
      });

      return {
        giverName: giver.displayName || 'A player',
        recipientName: target.displayName || recipientName,
        recipientDiscordId: target.discordId as string | undefined,
      };
    });

    // Fail-soft: the gift has landed; a missed notification must not undo it.
    const text = `${result.giverName} gifted you ${cosmetic.name}! Find it in Customize, under My Look.`;
    try {
      await writeNotification(recipientUid, {
        type: 'system',
        title: '🎁 You got a gift',
        message: text,
        data: { cosmeticId, from: result.giverName },
      });
      if (result.recipientDiscordId) await sendDiscordDM(result.recipientDiscordId, `🎁 ${text}`);
    } catch (err) {
      logger.warn('giftCosmetic: notification failed:', (err as Error).message);
    }

    return { success: true, price, recipientName: result.recipientName };
  },
);
