// Hostile-input sweep over every player-facing callable, against the LOCAL
// emulator. Each callable gets plausible input with one field swapped for
// something nasty (wrong type, NaN, Infinity, negative, huge, "constructor",
// ...). Whatever the call answers, afterwards the player's doc, their ledger
// and the shared market docs must hold no NaN or Infinity, no junk keys, and
// the player must not have gained cash or credit from a call that can't pay.
//
// Run via: npm run test:fuzz

import { beforeAll, it } from 'vitest';
import { createRequire } from 'module';
import { writeFileSync } from 'fs';
import { check, leaveWeeklyHalt, seedEmulator, type Loose } from './harness';

leaveWeeklyHalt();
const require = createRequire(import.meta.url);
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

type Callable = { run: (data: unknown, context: unknown) => Promise<unknown> };
const load = (p: string) => require(`../../functions/src/${p}`) as Record<string, Callable>;
const trading = load('trading/trading');
const limit = load('orders/limitOrders');
const pre = load('orders/preMarket');
const margin = load('margin/margin');
const ladderT = load('ladder/ladderTransfers');
const ladderG = load('ladder/ladderGame');
const preds = load('predictions/predictions');
const events = load('predictions/eventMarket');
const missions = load('missions/missions');
const crew = load('crews/crew');
const profile = load('users/userProfile');
const gifts = load('users/cosmeticGifts');
const dust = load('users/dustSweep');
const pub = load('users/publicProfile');
const alerts = load('market/alerts');
const board = load('users/leaderboard');
const search = load('users/playerSearch');
const portfolio = load('users/portfolio');
const { COSMETIC_CATALOG } =
  require('../../functions/src/shared/constants') as typeof import('../../functions/src/shared/constants');
const { BUNDLES } =
  require('../../functions/src/shared/rules/shop') as typeof import('../../functions/src/shared/rules/shop');
const { SHOP_PINS } = require('../../functions/src/shared/crews') as typeof import('../../functions/src/shared/crews');

const UID = 'fz_player';
const ctx = { auth: { uid: UID, token: { email: 'fz@example.com' } } };
const COSMETIC = Object.keys(COSMETIC_CATALOG).find((id) => !COSMETIC_CATALOG[id]!.earned)!;

// Calls that can never pay out cash or credit.
type Case = { name: string; fn: Callable; base: Loose; pays?: boolean };
const CASES: Case[] = [
  { name: 'executeTrade', fn: trading.executeTrade!, base: { ticker: 'JAY', action: 'buy', amount: 1 }, pays: true },
  {
    name: 'createLimitOrder',
    fn: limit.createLimitOrder!,
    base: { ticker: 'JAY', type: 'BUY', shares: 1, limitPrice: 1, allowPartialFills: true },
  },
  { name: 'createPreMarketOrder', fn: pre.createPreMarketOrder!, base: { ticker: 'JAY', action: 'buy', shares: 1 } },
  { name: 'cancelPreMarketOrder', fn: pre.cancelPreMarketOrder!, base: { orderId: 'x' } },
  { name: 'repayMargin', fn: margin.repayMargin!, base: { amount: 1 } },
  { name: 'toggleMargin', fn: margin.toggleMargin!, base: { enable: true } },
  { name: 'bailout', fn: margin.bailout!, base: {} },
  { name: 'depositToLadderGame', fn: ladderT.depositToLadderGame!, base: { amount: 10 } },
  { name: 'withdrawFromLadderGame', fn: ladderT.withdrawFromLadderGame!, base: { amount: 10 }, pays: true },
  { name: 'playLadderGame', fn: ladderG.playLadderGame!, base: { startSide: 'left', bet: 'odd', amount: 1 } },
  { name: 'getLadderLeaderboard', fn: ladderG.getLadderLeaderboard!, base: { board: 'net' } },
  { name: 'placeBet', fn: preds.placeBet!, base: { predictionId: 'p1', option: 'Yes', amount: 1 } },
  { name: 'claimPredictionPayout', fn: preds.claimPredictionPayout!, base: { predictionId: 'p1' }, pays: true },
  { name: 'buyIPOShares', fn: preds.buyIPOShares!, base: { ticker: 'JAY', quantity: 1 } },
  { name: 'buyEventShares', fn: events.buyEventShares!, base: { marketId: 'e1', outcome: 'Yes', shares: 1 } },
  {
    name: 'sellEventShares',
    fn: events.sellEventShares!,
    base: { marketId: 'e1', outcome: 'Yes', shares: 1 },
    pays: true,
  },
  { name: 'claimMissionReward', fn: missions.claimMissionReward!, base: { missionId: 'x', type: 'daily' }, pays: true },
  { name: 'rerollMissions', fn: missions.rerollMissions!, base: {} },
  { name: 'purchasePin', fn: missions.purchasePin!, base: { action: 'buySlot', slotType: 'shop' } },
  {
    name: 'purchasePin pin',
    fn: missions.purchasePin!,
    base: { action: 'buyPin', pinId: Object.keys(SHOP_PINS)[0] },
  },
  { name: 'purchasePin saver', fn: missions.purchasePin!, base: { action: 'buyStreakSaver', plan: 'month' } },
  { name: 'dailyCheckin', fn: missions.dailyCheckin!, base: {}, pays: true },
  { name: 'switchCrew', fn: crew.switchCrew!, base: { crewId: 'ALLIED' } },
  { name: 'leaveCrew', fn: crew.leaveCrew!, base: {} },
  { name: 'changeDisplayName', fn: profile.changeDisplayName!, base: { displayName: 'Fuzzer2' } },
  { name: 'checkUsername', fn: profile.checkUsername!, base: { displayName: 'Fuzzer3' } },
  { name: 'purchaseCosmetic', fn: profile.purchaseCosmetic!, base: { cosmeticId: COSMETIC } },
  { name: 'purchaseBundle', fn: profile.purchaseBundle!, base: { bundleId: BUNDLES[0]?.id } },
  { name: 'giftCosmetic', fn: gifts.giftCosmetic!, base: { cosmeticId: COSMETIC, recipient: 'fz_friend' } },
  { name: 'sweepDustPositions', fn: dust.sweepDustPositions!, base: { side: 'long' }, pays: true },
  { name: 'setTrophyCase', fn: pub.setTrophyCase!, base: { trophies: [] } },
  { name: 'getPublicProfile', fn: pub.getPublicProfile!, base: { username: 'fz_friend' } },
  {
    name: 'createPriceAlert',
    fn: alerts.createPriceAlert!,
    base: { ticker: 'JAY', targetPrice: 5, direction: 'above' },
  },
  { name: 'deletePriceAlert', fn: alerts.deletePriceAlert!, base: { alertId: 'x' } },
  { name: 'getLeaderboard', fn: board.getLeaderboard!, base: { crew: null, sortBy: 'value' } },
  { name: 'searchPlayers', fn: search.searchPlayers!, base: { query: 'fz' } },
  { name: 'syncPortfolio', fn: portfolio.syncPortfolio!, base: {} },
];

const NASTY: unknown[] = [
  undefined,
  null,
  NaN,
  Infinity,
  -Infinity,
  -1,
  -0.001,
  0,
  1e-12,
  0.1 + 0.2,
  1e21,
  Number.MAX_SAFE_INTEGER + 2,
  '5',
  '',
  ' ',
  'constructor',
  '__proto__',
  'toString',
  'hasOwnProperty',
  'JAY\u0000',
  'x'.repeat(5000),
  [],
  [1],
  ['constructor'],
  {},
  { a: 1 },
  true,
  false,
];
const JUNK_KEYS = new Set(['constructor', '__proto__', 'toString', 'hasOwnProperty', 'undefined', 'NaN', 'null']);

/** Every path to a non-finite number or a junk key in a Firestore doc. */
function problems(value: unknown, path = ''): string[] {
  if (typeof value === 'number') return Number.isFinite(value) ? [] : [`${path}=${value}`];
  if (!value || typeof value !== 'object') return [];
  if (typeof (value as { toMillis?: unknown }).toMillis === 'function') return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    if (JUNK_KEYS.has(k)) out.push(`${path}.${k} (junk key)`);
    out.push(...problems(v, `${path}.${k}`));
  }
  return out;
}

async function seedWorld() {
  await db.doc(`users/${UID}`).set({
    displayName: 'Fuzzer',
    displayNameLower: 'fuzzer',
    cash: 100000,
    portfolioValue: 110000,
    holdings: { JAY: 100 },
    costBasis: { JAY: 100 },
    shorts: {},
    crew: null,
    marginEnabled: false,
    marginUsed: 0,
    totalCheckins: 99,
    totalTrades: 999,
    peakPortfolioValue: 1e6,
    shopCredit: 1000,
    startingCashUnlocked: true,
    discordId: '999999999999999999',
    createdAt: Date.now() - 90 * 24 * 60 * 60 * 1000,
  });
  await db.doc('usernames/fuzzer').set({ uid: UID });
  await db.doc('users/fz_friend').set({ displayName: 'fz_friend', displayNameLower: 'fz_friend', cash: 1000 });
  await db.doc('usernames/fz_friend').set({ uid: 'fz_friend' });
  await db.doc(`ladderGameUsers/${UID}`).set({ uid: UID, balance: 500, nonWithdrawable: 0, chipsMigrated: true });
  await db.doc('predictions/current').set({
    list: [
      { id: 'p1', question: 'Q?', options: ['Yes', 'No'], pools: { Yes: 0, No: 0 }, endsAt: Date.now() + 864e5 },
      {
        id: 'e1',
        type: 'event',
        question: 'E?',
        outcomes: ['Yes', 'No'],
        options: ['Yes', 'No'],
        q: [0, 0],
        b: 20000,
        seededLiquidity: 20000,
        volume: 0,
        createdAt: Date.now(),
        resolved: false,
        outcome: null,
        settled: false,
      },
    ],
  });
}

beforeAll(seedEmulator);

it('hostile input never corrupts money', { timeout: 30 * 60 * 1000 }, async () => {
  const errors = new Map<string, number>();
  let calls = 0;
  for (const c of CASES) {
    const payloads: unknown[] = [null, 'string', 42, []];
    for (const key of Object.keys(c.base)) for (const v of NASTY) payloads.push({ ...c.base, [key]: v });
    for (const data of payloads) {
      await seedWorld();
      const before = (await db.doc(`users/${UID}`).get()).data() as Loose;
      let crash: string | null = null;
      try {
        await c.fn.run(data, ctx);
      } catch (e) {
        const err = e as { code?: string; message?: string };
        // Plain TypeErrors and 'internal' are bad input reaching code that
        // never checked it: the caller gets a raw error and Sentry a report.
        if (!err.code || err.code === 'internal') crash = (err.message || String(e)).slice(0, 120);
      }
      calls++;
      const after = (await db.doc(`users/${UID}`).get()).data() as Loose;
      const ledger = await db.collection('ledger').where('uid', '==', UID).get();
      const market = (await db.doc('market/current').get()).data();
      const predictions = (await db.doc('predictions/current').get()).data();
      const label = `${c.name} ${JSON.stringify(data)?.slice(0, 80)}`;
      const bad = [
        ...problems(after, 'user'),
        ...ledger.docs.flatMap((d: Loose) => problems(d.data(), 'ledger')),
        ...problems(market?.prices, 'prices'),
        ...problems(predictions, 'predictions'),
      ];
      check(`${label}: data stays clean`, bad.length === 0, bad.slice(0, 5));
      if (!c.pays) {
        check(
          `${label}: no free money`,
          (after?.cash ?? 0) <= before.cash + 0.01 && (after?.shopCredit ?? 0) <= before.shopCredit + 0.01,
          { cash: after?.cash, credit: after?.shopCredit },
        );
      }
      if (crash) errors.set(`${c.name}: ${crash}`, (errors.get(`${c.name}: ${crash}`) || 0) + 1);
      for (const d of ledger.docs) await d.ref.delete();
    }
  }
  const report = [`${calls} calls. Unhandled errors (bad input not rejected cleanly):`];
  for (const [msg, n] of errors) report.push(`  ${n}x ${msg}`);
  console.log(report.join('\n'));
  if (process.env.FUZZ_REPORT) writeFileSync(process.env.FUZZ_REPORT, report.join('\n'));
});
