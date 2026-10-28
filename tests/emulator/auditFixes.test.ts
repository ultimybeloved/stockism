// Holes found in the 2026-10-28 audit, against the LOCAL emulator. Each check
// is the attack that worked before the fix.
//
//   A. Catalog lookups: "constructor" and friends are not shop items or crews
//   B. Margin: turning margin on again can't erase debt

import { beforeAll, it } from 'vitest';
import { createRequire } from 'module';
import { check, leaveWeeklyHalt, seedEmulator, type Loose } from './harness';

leaveWeeklyHalt();
const require = createRequire(import.meta.url);
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

const { purchasePin } =
  require('../../functions/src/missions/missions') as typeof import('../../functions/src/missions/missions');
const { purchaseCosmetic, purchaseBundle } =
  require('../../functions/src/users/userProfile') as typeof import('../../functions/src/users/userProfile');
const { giftCosmetic } =
  require('../../functions/src/users/cosmeticGifts') as typeof import('../../functions/src/users/cosmeticGifts');
const { switchCrew } = require('../../functions/src/crews/crew') as typeof import('../../functions/src/crews/crew');
const { getLeaderboard } =
  require('../../functions/src/users/leaderboard') as typeof import('../../functions/src/users/leaderboard');
const { toggleMargin } =
  require('../../functions/src/margin/margin') as typeof import('../../functions/src/margin/margin');

beforeAll(seedEmulator);

const ctx = (uid: string) => ({ auth: { uid } });
const seed = (uid: string, extra: Loose = {}) =>
  db.doc(`users/${uid}`).set({ displayName: uid, cash: 1000, portfolioValue: 1000, holdings: {}, ...extra });
const get = async (uid: string) => (await db.doc(`users/${uid}`).get()).data() as Loose;
const refused = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
};
const PROTO_KEYS = ['constructor', 'toString', '__proto__', 'hasOwnProperty'];

it('A. catalog lookups', async () => {
  await seed('a_buyer', { cash: 100000 });
  await seed('a_friend');
  await db.doc('usernames/a_friend').set({ uid: 'a_friend' });
  for (const key of PROTO_KEYS) {
    check(
      `pin slot "${key}" refused`,
      await refused(() => purchasePin.run({ action: 'buySlot', slotType: key }, ctx('a_buyer'))),
    );
    check(
      `pin "${key}" refused`,
      await refused(() => purchasePin.run({ action: 'buyPin', pinId: key }, ctx('a_buyer'))),
    );
    check(
      `streak saver "${key}" refused`,
      await refused(() => purchasePin.run({ action: 'buyStreakSaver', plan: key }, ctx('a_buyer'))),
    );
    check(`cosmetic "${key}" refused`, await refused(() => purchaseCosmetic.run({ cosmeticId: key }, ctx('a_buyer'))));
    check(`bundle "${key}" refused`, await refused(() => purchaseBundle.run({ bundleId: key }, ctx('a_buyer'))));
    check(
      `gift "${key}" refused`,
      await refused(() => giftCosmetic.run({ cosmeticId: key, recipient: 'a_friend' }, ctx('a_buyer'))),
    );
    check(
      `gift bundle "${key}" refused`,
      await refused(() => giftCosmetic.run({ bundleId: key, recipient: 'a_friend' }, ctx('a_buyer'))),
    );
    check(`crew "${key}" refused`, await refused(() => switchCrew.run({ crewId: key }, ctx('a_buyer'))));
    check(`board for crew "${key}" refused`, await refused(() => getLeaderboard.run({ crew: key }, {})));
  }
  const u = await get('a_buyer');
  check('buyer untouched', u.cash === 100000 && !u.extraShopSlot && !u.ownedCosmetics && !u.crew, u);
  check(
    'real slot still sells',
    (await purchasePin.run({ action: 'buySlot', slotType: 'shop' }, ctx('a_buyer'))).success,
  );
});

it('B. margin re-enable keeps the debt', async () => {
  await seed('b_margin', {
    cash: 50000,
    marginEnabled: true,
    marginUsed: 20000,
    totalCheckins: 99,
    totalTrades: 999,
    peakPortfolioValue: 999999,
  });
  await toggleMargin.run({ enable: true }, ctx('b_margin'));
  check('debt still there', (await get('b_margin')).marginUsed === 20000);
});

it('C. one Discord can not land on two accounts at once', async () => {
  const { applyPendingDiscordLink } =
    require('../../functions/src/users/signupHelpers') as typeof import('../../functions/src/users/signupHelpers');
  const discordId = '123456789012345678';
  for (const uid of ['c_one', 'c_two', 'c_three']) {
    await seed(uid, { startingCashUnlocked: false });
    await db.doc(`discordPending/${uid}`).set({ discordId, discordUsername: 'racer' });
  }
  const results = await Promise.all(['c_one', 'c_two', 'c_three'].map((uid) => applyPendingDiscordLink(uid)));
  const holders = (await db.collection('users').where('discordId', '==', discordId).get()).size;
  check('exactly one account got the Discord', holders === 1 && results.filter(Boolean).length === 1, {
    results,
    holders,
  });
});
