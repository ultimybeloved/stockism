// Profiles and the trophy case against the LOCAL Firebase emulator. Never
// touches production.
//
// Run via: npm run test:profile
//
// Every profile opens since 2026-10-21, so the line that matters is what a
// private one leaves out: holdings, shorts, the chart and trading stats. The
// trophy case may only hold what the player owns, on save and on read.

import { it } from 'vitest';
import { createRequire } from 'module';
import { check, type Loose } from './harness';

const require = createRequire(import.meta.url);

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

const { getPublicProfile, setTrophyCase } =
  require('../../functions/src/users/publicProfile') as typeof import('../../functions/src/users/publicProfile');

const run = (fn: Loose, data: Loose, uid: string | null) =>
  fn.run(data, { auth: uid ? { uid } : undefined, rawRequest: {} });
const fails = (p: Promise<unknown>, code: string) =>
  p.then(
    () => false,
    (e: Loose) => e.code === code,
  );

const owned = {
  achievements: ['SHARK', 'CROWNED'],
  ownedTitles: ['p1_diamond'],
  titleMeta: { p1_diamond: 'Preseason Diamond' },
  ownedCosmetics: ['glow_gold'],
  ownedShopPins: ['black_card'],
};

async function main() {
  await db
    .collection('users')
    .doc('pub')
    .set({
      displayName: 'Pub',
      isPublic: true,
      portfolioValue: 5000,
      holdings: { JAKE: 3 },
      totalTrades: 40,
      ...owned,
      crewHeadBest: { weeks: 4, crew: 'ALLIED' },
    });
  await db
    .collection('users')
    .doc('priv')
    .set({
      displayName: 'Priv',
      portfolioValue: 3000,
      holdings: { JAKE: 9 },
      shorts: { GUN: { shares: 2 } },
      totalTrades: 12,
      createdAt: 1767225600000,
      achievements: ['SHARK'],
      trophyCase: ['ach:SHARK', 'ach:ORACLE'],
    });
  await db.collection('usernames').doc('pub').set({ uid: 'pub' });
  await db.collection('usernames').doc('priv').set({ uid: 'priv' });

  console.log('\n1: a private profile opens, without the trading side');
  const p = await run(getPublicProfile, { username: 'Priv' }, 'pub');
  check('it opens', p.displayName === 'Priv');
  check('marked not public', p.isPublic === false);
  check('no holdings or shorts', p.holdingTickers.length === 0 && p.shortTickers.length === 0);
  check('no chart', p.portfolioHistory.length === 0);
  check('no trading stats', p.stats.totalTrades === 0);
  check('join date still shown', p.stats.createdAt === 1767225600000);
  check('achievements still shown', p.achievements.includes('SHARK'));
  check('an unowned trophy is dropped on read', JSON.stringify(p.trophyCase) === '["ach:SHARK"]', p.trophyCase);

  console.log('\n2: the owner sees their own private profile in full');
  const own = await run(getPublicProfile, { username: 'Priv' }, 'priv');
  check('holdings shown to the owner', own.holdingTickers.includes('JAKE'));

  console.log('\n3: saving a trophy case');
  const ids = ['head', 'title:p1_diamond', 'cos:glow_gold', 'pin:black_card', 'ach:SHARK'];
  const saved = await run(setTrophyCase, { trophies: ids }, 'pub');
  check('owned items save in order', JSON.stringify(saved.trophyCase) === JSON.stringify(ids));
  const pub = await run(getPublicProfile, { username: 'pub' }, null);
  check('title label comes along', pub.trophyTitles.p1_diamond === 'Preseason Diamond');
  check('crew head record comes along', pub.headReign?.weeks === 4 && pub.headReign?.crew === 'ALLIED');
  check('holdings shown on a public profile', pub.holdingTickers.includes('JAKE'));

  console.log('\n4: what a save refuses');
  check(
    'something not owned',
    await fails(run(setTrophyCase, { trophies: ['ach:ORACLE'] }, 'pub'), 'invalid-argument'),
  );
  check(
    'more than six',
    await fails(run(setTrophyCase, { trophies: [...ids, 'ach:CROWNED', 'ach:SHARK'] }, 'pub'), 'invalid-argument'),
  );
  check(
    'a repeat',
    await fails(run(setTrophyCase, { trophies: ['ach:SHARK', 'ach:SHARK'] }, 'pub'), 'invalid-argument'),
  );
  check('not a list', await fails(run(setTrophyCase, { trophies: 'ach:SHARK' }, 'pub'), 'invalid-argument'));
  check('signed out', await fails(run(setTrophyCase, { trophies: [] }, null), 'unauthenticated'));
  const after = (await db.collection('users').doc('pub').get()).data();
  check('a refused save changes nothing', after.trophyCase.length === ids.length);
}

it('public profile', main);
