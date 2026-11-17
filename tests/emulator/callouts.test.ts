// Discord call-outs against the LOCAL Firebase emulator. Never touches
// production, and Discord itself is stubbed: every post is captured instead.
//
// Run via: npm run test:callouts
//
// A big win is queued only by a trade that closes the position out, and only
// posted for a public profile. The leaderboard posts newcomers to the top 10
// and a new #1 once they hold it. Streak milestones are posted with the name.

import { it } from 'vitest';
import { createRequire } from 'module';
import { check, type Loose } from './harness';

const require = createRequire(import.meta.url);

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';
process.env.DISCORD_BOT_TOKEN = 'test-token';
process.env.DISCORD_CHANNEL_ID = 'test-channel';

const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

// Discord is not reachable from the emulator: capture what would be posted.
const posts: Loose[] = [];
const axios = require('../../functions/node_modules/axios');
for (const method of ['get', 'patch', 'put', 'delete', 'request'])
  axios[method] = async () => ({ data: {}, status: 200 });
axios.post = async (_url: string, body: Loose) => {
  posts.push(body);
  return { data: {}, status: 200 };
};

const { executeTrade } =
  require('../../functions/src/trading/trading') as typeof import('../../functions/src/trading/trading');
const { runCallouts, announceStreak } =
  require('../../functions/src/discord/callouts') as typeof import('../../functions/src/discord/callouts');
const { isWeeklyTradingHalt } =
  require('../../functions/src/shared/constants') as typeof import('../../functions/src/shared/constants');

const T = 'SOPH';
const DAY = 24 * 60 * 60 * 1000;
const MIN = 60 * 1000;
let ipSeed = 0;
type CallContext = Parameters<typeof executeTrade.run>[1];
const sell = (uid: string, amount: number) =>
  executeTrade.run({ ticker: T, action: 'sell', amount }, {
    auth: { uid },
    rawRequest: { ip: `198.51.100.${++ipSeed}` },
  } as unknown as CallContext);
const queued = async () => (await db.collection('calloutQueue').get()).docs.map((d: Loose) => d.data());
const texts = () => posts.map((p) => `${p.embeds?.[0]?.title} | ${p.embeds?.[0]?.description}`);

const holder = (extra: Loose) => ({
  cash: 1000,
  holdings: { [T]: 1000 },
  costBasis: { [T]: 10 },
  lastBuyTime: { [T]: Date.now() - 10 * DAY },
  createdAt: Date.now() - 60 * DAY,
  portfolioValue: 81000,
  ...extra,
});

async function main() {
  if (isWeeklyTradingHalt()) {
    console.error('executeTrade rejects everything during the halt. Re-run outside that window.');
    return;
  }
  await db
    .collection('market')
    .doc('current')
    .set({
      prices: { [T]: 80 },
      launchedTickers: [],
      marketHalted: false,
      haltedTickers: {},
    });
  await db.collection('market').doc('priceHistory').set({});

  console.log('\n1: big wins');
  await db
    .collection('users')
    .doc('winner')
    .set(holder({ displayName: 'big_winner', isPublic: true, crew: 'ALLIED' }));
  await sell('winner', 500);
  check('a partial exit queues nothing', (await queued()).length === 0, await queued());
  // Past the 3-second gap between trades.
  await db
    .collection('users')
    .doc('winner')
    .update({ lastTradeTime: Date.now() - MIN });
  await sell('winner', 500);
  const q = await queued();
  check('closing it out queues the win', q.length === 1 && q[0].uid === 'winner' && q[0].profit >= 25000, q);

  await db
    .collection('users')
    .doc('quiet')
    .set(holder({ displayName: 'quiet_one', isPublic: false }));
  await sell('quiet', 1000);
  check('a private player is queued too (filtered at posting)', (await queued()).length === 2);

  posts.length = 0;
  await runCallouts(Date.now() + MIN);
  const wins = texts().filter((t) => t.includes('Big win'));
  check('one post, for the public player', wins.length === 1 && wins[0]!.includes('big\\_winner'), texts());
  check('it names the stock and the profit', /\$SOPH/.test(wins[0] || '') && /\+\$\d/.test(wins[0] || ''), wins);
  check('the queue is drained', (await queued()).length === 0);

  console.log('\n2: leaderboard');
  const batch = db.batch();
  for (let i = 0; i < 12; i++) {
    batch.set(db.collection('users').doc(`lb${i}`), { displayName: `lb${i}`, portfolioValue: 1_000_000 - i * 10_000 });
  }
  await batch.commit();
  // Start the board's memory over (section 1's run recorded the old top).
  await db.collection('botState').doc('callouts').delete();
  const t0 = Date.now() + 2 * MIN;
  posts.length = 0;
  await runCallouts(t0);
  check('the first run only records', posts.length === 0, texts());

  await db.collection('users').doc('climber').set({ displayName: 'climber', portfolioValue: 955_000 });
  await runCallouts(t0 + 15 * MIN);
  check(
    'a newcomer to the top 10 is posted with their place',
    texts().some((t) => t.includes('Top 10') && t.includes('climber') && t.includes('#6')),
    texts(),
  );

  posts.length = 0;
  await db.collection('users').doc('climber').update({ portfolioValue: 2_000_000 });
  await runCallouts(t0 + 30 * MIN);
  check('a new #1 waits until they have held it', !texts().some((t) => t.includes('New #1')), texts());
  await runCallouts(t0 + 60 * MIN);
  check(
    'then posts, naming who they passed',
    texts().some((t) => t.includes('New #1') && t.includes('climber') && t.includes('lb0')),
    texts(),
  );

  console.log('   a crowd arriving at once is capped');
  posts.length = 0;
  const crowd = db.batch();
  for (let i = 0; i < 6; i++) {
    crowd.set(db.collection('users').doc(`new${i}`), { displayName: `new${i}`, portfolioValue: 1_500_000 - i * 1000 });
  }
  await crowd.commit();
  await runCallouts(t0 + 75 * MIN);
  check('at most 3 top-10 posts in one run', texts().filter((t) => t.includes('Top 10')).length === 3, texts());

  posts.length = 0;
  await db.collection('users').doc('lb3').update({ isBanned: true });
  await db
    .collection('users')
    .doc('banned_rich')
    .set({ displayName: 'banned_rich', portfolioValue: 5_000_000, isBanned: true });
  await runCallouts(t0 + 90 * MIN);
  check('banned players are never posted', !texts().some((t) => t.includes('banned_rich')), texts());

  console.log('\n3: streaks');
  posts.length = 0;
  await announceStreak('winner', 30);
  check(
    'a streak milestone names the player',
    texts().some((t) => t.includes('30-day streak') && t.includes('big\\_winner')),
    texts(),
  );
  posts.length = 0;
  await db.collection('users').doc('banned_rich').update({ displayName: 'banned_rich' });
  await announceStreak('banned_rich', 30);
  check('but never a banned one', posts.length === 0, texts());
}

it('discord call-outs', main);
