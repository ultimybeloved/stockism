// Puts a Discord on an existing account. INTERNAL MODULE, not in services.ts.
//
// One transaction, reading the account fresh. discordLink and the login path
// used to read the account, then write later in a batch: two links finishing
// at the same moment both saw "starting cash not unlocked yet" and both paid
// the one-time top-up.
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { STARTING_CASH, UNVERIFIED_STARTING_CASH } from '../shared/constants';
import { grantedValueUpdate } from '../shared/equity';
import { recordLedger } from '../shared/ledger';

const db = admin.firestore();

/**
 * 'linked' when the Discord is now on the account, 'other' when the account
 * already carries a different Discord (never overwritten: that would free the
 * old one for reuse on an alt), 'missing' when the account has no profile.
 */
export const attachDiscordToAccount = (
  uid: string,
  discordId: string,
  discordUsername: string | null | undefined,
): Promise<'linked' | 'other' | 'missing'> =>
  db.runTransaction(async (tx) => {
    const ref = db.collection('users').doc(uid);
    const snap = await tx.get(ref);
    if (!snap.exists) return 'missing';
    const user = snap.data()!;
    if (user.discordId && user.discordId !== discordId) return 'other';

    const update: Record<string, unknown> = { discordId, discordUsername: discordUsername || null };

    // One-time: the first Discord verification unlocks the full starting cash.
    // Must be `=== false`, not `!== true`: accounts older than the gate (May
    // 2026) have no flag and already started on the full amount.
    if (user.startingCashUnlocked === false && !user.discordId) {
      const topUp = STARTING_CASH - UNVERIFIED_STARTING_CASH;
      update.cash = FieldValue.increment(topUp);
      update.startingCashUnlocked = true;
      Object.assign(update, grantedValueUpdate(topUp));
      recordLedger(tx, { uid, type: 'starting_cash_unlock', amount: topUp });
    }

    if (!(user.achievements || []).includes('DISCORD_LINKED')) {
      update.achievements = FieldValue.arrayUnion('DISCORD_LINKED');
      update['achievementDates.DISCORD_LINKED'] = Date.now();
    }

    tx.update(ref, update);
    return 'linked';
  });
