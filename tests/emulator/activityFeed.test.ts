// The Recent trades card's job against the LOCAL Firebase emulator. Never
// touches production.
//
// Run via: npm run test:activity
//
// The doc is world-readable, so the point is what it leaves out: no names, no
// sizes, nothing from the last few minutes, nothing but real trades and bots.

import { it } from 'vitest';
import { createRequire } from 'module';
import { check, type Loose } from './harness';

const require = createRequire(import.meta.url);

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

const { publishActivity } =
  require('../../functions/src/market/activityFeed') as typeof import('../../functions/src/market/activityFeed');

const MIN = 60_000;

async function main() {
  const now = Date.now();
  const trade = (ticker: string, action: string, minsAgo: number) =>
    db.collection('trades').add({
      uid: 'secret_uid',
      ticker,
      action,
      amount: 5000,
      totalValue: 99999,
      timestamp: new Date(now - minsAgo * MIN),
    });
  await trade('JAKE', 'buy', 12);
  await trade('JAKE', 'short', 10);
  await trade('GUN', 'cover', 8);
  await trade('GOO', 'dividend', 9);
  await trade('DG', 'buy', 2);

  console.log('\n1: first run');
  await publishActivity([{ ticker: 'BDNL', frac: 0.01 }], now);
  let doc = (await db.collection('market').doc('activity').get()).data() as Loose;
  const real = doc.entries.filter((e: Loose) => e.t !== 'BDNL');
  check('the three real trades are in', real.length === 3, real);
  check(
    'short reads as a sell, cover as a buy',
    real.find((e: Loose) => e.t === 'GUN').s === 'b' && real.some((e: Loose) => e.t === 'JAKE' && e.s === 's'),
  );
  check('dividends are left out', !doc.entries.some((e: Loose) => e.t === 'GOO'));
  check('the last few minutes are left out', !doc.entries.some((e: Loose) => e.t === 'DG'));
  check(
    'bot moves are in',
    doc.entries.some((e: Loose) => e.t === 'BDNL' && e.s === 'b'),
  );
  check('no names or sizes', !/secret_uid|5000|99999/.test(JSON.stringify(doc)));
  check(
    'only ticker, side and time',
    doc.entries.every((e: Loose) => Object.keys(e).sort().join() === 'at,s,t'),
  );
  check(
    'entries in time order',
    doc.entries.every((e: Loose, i: number) => i === 0 || doc.entries[i - 1].at <= e.at),
  );

  console.log('\n2: next run picks up only what is new');
  await publishActivity([], now + 15 * MIN);
  doc = (await db.collection('market').doc('activity').get()).data() as Loose;
  check(
    'the held-back trade arrives',
    doc.entries.some((e: Loose) => e.t === 'DG'),
  );
  check('nothing doubled', doc.entries.filter((e: Loose) => e.t === 'JAKE').length === 2, doc.entries);
}

it('activity feed', main);
