// Bot giveaways, end to end against the LOCAL emulator. Never touches
// production. Run via: npm run test:giveaways
//
// Entries go in as the Enter button writes them; the draw must skip banned
// players and anyone whose Discord no longer matches the entry, nobody wins
// twice, each prize kind lands with a ledger entry, and running the finisher
// again pays nobody twice. Discord calls fail soft here (no bot token).

import { it } from 'vitest';
import { createRequire } from 'module';
import { check, type Loose } from './harness';

const require = createRequire(import.meta.url);

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

const { finishGiveaway } =
  require('../../functions/src/admin/giveawayCore') as typeof import('../../functions/src/admin/giveawayCore');

const ID = 'gw_test';

async function main() {
  const users: Loose[] = [];
  for (let i = 0; i < 8; i++) {
    const uid = `gw_u${i}`;
    const data: Loose = {
      displayName: `Gw${i}`,
      cash: 1000,
      shopCredit: 0,
      discordId: `1000000000000000${i}0`,
      ownedCosmetics: [],
    };
    if (i === 6) data.isBanned = true;
    if (i === 5) data.ownedCosmetics = ['frame_steel'];
    await db.collection('users').doc(uid).set(data);
    users.push({ uid, ...data });
  }
  await db
    .collection('giveaways')
    .doc(ID)
    .set({
      title: 'Test',
      channelId: '123456789012345678',
      endsAt: Date.now() - 1000,
      status: 'open',
      entries: 8,
      tiers: [
        { prize: { kind: 'credit', amount: 500000 }, winners: 1 },
        { prize: { kind: 'cash', amount: 1000 }, winners: 2 },
        { prize: { kind: 'cosmetic', cosmeticId: 'frame_steel' }, winners: 10 },
      ],
    });
  for (const u of users) {
    // gw_u7's entry was made from a Discord that is no longer theirs.
    const discordId = u.uid === 'gw_u7' ? '99999999999999999' : u.discordId;
    await db.collection('giveaways').doc(ID).collection('entries').doc(discordId).set({ uid: u.uid, at: Date.now() });
  }

  const g = await finishGiveaway(ID);
  const winners = g!.winners!;
  check(
    'the draw skips banned and relinked entries',
    winners.length === 6 && !winners.some((w) => ['gw_u6', 'gw_u7'].includes(w.uid)),
    JSON.stringify(winners),
  );
  check('nobody wins twice', new Set(winners.map((w) => w.uid)).size === winners.length);
  check('top prize drawn first', winners[0]!.tier === 0 && winners.filter((w) => w.tier === 1).length === 2);
  check('it ends', g!.status === 'ended');

  const top = (await db.collection('users').doc(winners[0]!.uid).get()).data();
  check('credit prize lands', top.shopCredit === 500000, JSON.stringify(top.shopCredit));
  const cashWinner = (await db.collection('users').doc(winners[1]!.uid).get()).data();
  check(
    'cash prize lands as granted value',
    cashWinner.cash === 2000 && cashWinner.grantedValue === 1000,
    JSON.stringify(cashWinner),
  );
  for (const w of winners.filter((x) => x.tier === 2)) {
    const u = (await db.collection('users').doc(w.uid).get()).data();
    check(
      `cosmetic prize lands for ${w.name} (or its price as credit if already owned)`,
      w.uid === 'gw_u5' ? u.shopCredit > 0 : u.ownedCosmetics.includes('frame_steel'),
      JSON.stringify(u),
    );
  }

  await db.collection('giveaways').doc(ID).update({ status: 'drawing' });
  await finishGiveaway(ID);
  const again = (await db.collection('users').doc(winners[0]!.uid).get()).data();
  check('running the finisher again pays nobody twice', again.shopCredit === 500000, JSON.stringify(again.shopCredit));
  const ledger = (await db.collection('ledger').where('type', '==', 'giveaway_prize').get()).docs.map((d: Loose) =>
    d.data(),
  );
  check(
    'one ledger entry per winner',
    ledger.filter((e: Loose) => e.ref === ID || e.detail?.giveaway === ID).length === 6,
    JSON.stringify(ledger),
  );
}

// The Thanksgiving 2026 shape: a credit draw, a separate cash draw whose top
// prize skips the leaderboard's top 2, and a random pin for every entrant.
async function stacked() {
  const SID = 'gw_stack';
  const uids = Array.from({ length: 6 }, (_, i) => `gs_u${i}`);
  for (const [i, uid] of uids.entries()) {
    await db
      .collection('users')
      .doc(uid)
      .set({
        displayName: `Gs${i}`,
        cash: 1000,
        shopCredit: 0,
        discordId: `2000000000000000${i}0`,
        // gs_u1 already owns every Thanksgiving pin but one, gs_u2 owns them all.
        ownedShopPins:
          i === 1
            ? ['tg26_turkey', 'tg26_pie', 'tg26_drumstick', 'tg26_pilgrim', 'tg26_pumpkin']
            : i === 2
              ? ['tg26_turkey', 'tg26_pie', 'tg26_drumstick', 'tg26_pilgrim', 'tg26_pumpkin', 'tg26_corn']
              : [],
      });
    await db
      .collection('giveaways')
      .doc(SID)
      .collection('entries')
      .doc(`2000000000000000${i}0`)
      .set({ uid, at: Date.now() });
  }
  // gs_u0 and gs_u1 are the top 2.
  await db
    .collection('leaderboard')
    .doc('global')
    .set({ generatedAt: Date.now(), entries: [{ userId: 'gs_u0' }, { userId: 'gs_u1' }, { userId: 'someone' }] });
  await db
    .collection('giveaways')
    .doc(SID)
    .set({
      title: 'Stacked',
      channelId: '123456789012345678',
      endsAt: Date.now() - 1000,
      status: 'open',
      entries: 6,
      tiers: [
        { prize: { kind: 'credit', amount: 150000 }, winners: 3 },
        { prize: { kind: 'cash', amount: 75000 }, winners: 2, draw: 2, skipTop: 2 },
        { prize: { kind: 'cash', amount: 25000 }, winners: 3, draw: 2 },
        { prize: { kind: 'pin', collection: 'thanksgiving_2026' }, winners: 0, everyone: true },
      ],
    });

  const g = await finishGiveaway(SID);
  const w = g!.winners!;
  const of = (tier: number) => w.filter((x) => x.tier === tier).map((x) => x.uid);
  check('credit draw has 3 different winners', new Set(of(0)).size === 3, JSON.stringify(of(0)));
  const cash = [...of(1), ...of(2)];
  check('cash draw has 5 different winners', cash.length === 5 && new Set(cash).size === 5, JSON.stringify(cash));
  check(
    'the top 2 never win the skip-top prize',
    !of(1).some((u) => u === 'gs_u0' || u === 'gs_u1'),
    JSON.stringify(of(1)),
  );
  check('everyone gets the pin prize', of(3).length === 6, JSON.stringify(of(3)));
  check(
    'someone won in both draws',
    of(0).some((u) => cash.includes(u)),
  );

  const get = async (uid: string) => (await db.collection('users').doc(uid).get()).data();
  const u1 = await get('gs_u1');
  check('a random pin prefers one they lack', u1.ownedShopPins.includes('tg26_corn'), JSON.stringify(u1.ownedShopPins));
  const u2 = await get('gs_u2');
  const u2Credit = (of(0).includes('gs_u2') ? 150000 : 0) + 0;
  check(
    'owning the whole set pays a pin price in credit instead',
    u2.ownedShopPins.length === 6 && u2.shopCredit > u2Credit && u2.shopCredit <= u2Credit + 10000,
    JSON.stringify(u2),
  );
  for (const uid of uids) {
    const u = await get(uid);
    const want = 1000 + (of(1).includes(uid) ? 75000 : 0) + (of(2).includes(uid) ? 25000 : 0);
    check(`${uid} got every cash prize they won`, u.cash === want, JSON.stringify({ cash: u.cash, want }));
  }

  await db.collection('giveaways').doc(SID).update({ status: 'drawing' });
  await finishGiveaway(SID);
  const marks = await db.collection('giveaways').doc(SID).collection('payouts').get();
  check('one payout mark per prize won, none repeated', marks.size === w.length, String(marks.size));
  const again = await get(of(1)[0]!);
  check('running again pays nobody twice', again.cash >= 76000 && again.cash <= 101000, JSON.stringify(again.cash));
}

it('bot giveaways draw and pay once', main);
it('stacked draws, skip-top, and everyone pins pay correctly', stacked);
