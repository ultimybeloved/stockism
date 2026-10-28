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

it('bot giveaways draw and pay once', main);
