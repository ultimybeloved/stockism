// Replays the 2026-10-31 exploit audit against the LOCAL emulator. Never touches
// production. Run: npm run test:audit1031
import { beforeAll, it } from 'vitest';
import { createRequire } from 'module';
import { check, seedEmulator } from './harness';

const require = createRequire(import.meta.url);

beforeAll(seedEmulator);

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

const { executeTrade } =
  require('../../functions/src/trading/trading') as typeof import('../../functions/src/trading/trading');
const { bailout } = require('../../functions/src/margin/margin') as typeof import('../../functions/src/margin/margin');
const { syncPortfolio } =
  require('../../functions/src/users/portfolio') as typeof import('../../functions/src/users/portfolio');
const { sweepDustPositions } =
  require('../../functions/src/users/dustSweep') as typeof import('../../functions/src/users/dustSweep');
const { createLimitOrder } =
  require('../../functions/src/orders/limitOrders') as typeof import('../../functions/src/orders/limitOrders');
const { buyEventShares, sellEventShares } =
  require('../../functions/src/predictions/eventMarket') as typeof import('../../functions/src/predictions/eventMarket');
const { computeDividend } =
  require('../../functions/src/market/dividends') as typeof import('../../functions/src/market/dividends');
const { buildTickerFlowUpdate } =
  require('../../functions/src/shared/marketData') as typeof import('../../functions/src/shared/marketData');

const T = 'JAY';
const DAY = 86400000;
let ipSeed = 0;
type Run = { run: (data: unknown, ctx: never) => Promise<unknown> };
const ctx = (uid: string) => ({ auth: { uid }, rawRequest: { ip: `203.0.113.${++ipSeed}` } }) as never;
const call = async (fn: unknown, data: unknown, uid: string) => {
  try {
    await (fn as Run).run(data, ctx(uid));
    return null;
  } catch (e) {
    return (e as Error).message || String(e);
  }
};
const setUser = (uid: string, data: Record<string, unknown>) =>
  db
    .collection('users')
    .doc(uid)
    .set({ displayName: uid, createdAt: Date.now() - 60 * DAY, ...data });
const getUser = async (uid: string) => (await db.collection('users').doc(uid).get()).data();
const seed = async (list: unknown[] = []) => {
  await db
    .collection('market')
    .doc('current')
    .set({ prices: { [T]: 100 }, launchedTickers: [], marketHalted: false, haltedTickers: {} });
  await db.collection('market').doc('priceHistory').set({});
  await db.collection('predictions').doc('current').set({ list });
};
const eventMarket = (extra = {}) => ({
  id: 'evt_a',
  type: 'event',
  question: 'Q',
  outcomes: ['Yes', 'No'],
  q: [0, 0],
  b: 5000,
  ...extra,
});

it('bailout: side money blocks the flag and the payout', async () => {
  await seed([eventMarket({ q: [1000, 0] })]);
  await setUser('rich_side', { cash: 40, holdings: {}, shorts: {} });
  await db.collection('ladderGameUsers').doc('rich_side').set({ balance: 8000, chipsMigrated: true });
  await syncPortfolio.run({}, ctx('rich_side'));
  check('not flagged with $8,000 in the ladder', !(await getUser('rich_side')).isBankrupt);

  await setUser('flagged_side', { cash: 40, isBankrupt: true, holdings: {}, shorts: {} });
  await db.collection('ladderGameUsers').doc('flagged_side').set({ balance: 8000, chipsMigrated: true });
  const err = await call(bailout, {}, 'flagged_side');
  check('old flag cannot collect while side money remains', !!err && err.includes('ladder'), err || 'no error');
  check('cash untouched', (await getUser('flagged_side')).cash === 40);

  await setUser('in_market', {
    cash: 40,
    isBankrupt: true,
    eventPositions: { evt_a: { shares: { Yes: 1000 }, costBasis: 500, settled: false } },
  });
  check('market position blocks bailout too', !!(await call(bailout, {}, 'in_market')));

  await setUser('wiped', { cash: 40, holdings: {}, shorts: {} });
  await syncPortfolio.run({}, ctx('wiped'));
  check('a truly broke player is flagged', (await getUser('wiped')).isBankrupt === true);
  await db.collection('limitOrders').doc('old_buy').set({ userId: 'wiped', status: 'PENDING', type: 'BUY' });
  await db.collection('preMarketOrders').doc('old_pm').set({ userId: 'wiped', status: 'PENDING', action: 'buy' });
  const ok = await call(bailout, {}, 'wiped');
  check('and still gets the bailout', ok === null && (await getUser('wiped')).cash === 1500, ok || '');
  const lim = (await db.collection('limitOrders').doc('old_buy').get()).data();
  const pm = (await db.collection('preMarketOrders').doc('old_pm').get()).data();
  check('bailout cancels live orders', lim.status === 'CANCELED' && pm.status === 'CANCELED');
});

it('long and short never mix', async () => {
  await seed();
  const base = { cash: 50000, portfolioValue: 60000, holdings: {}, shorts: {}, costBasis: {} };
  await setUser('longer', { ...base, holdings: { [T]: 100 }, costBasis: { [T]: 100 } });
  const shortErr = await call(executeTrade, { ticker: T, action: 'short', amount: 5 }, 'longer');
  check('holder cannot short', !!shortErr && shortErr.includes('Sell your shares'), shortErr || 'no error');

  const openShort = { shares: 10, costBasis: 100, margin: 1000, openedAt: Date.now() - DAY, system: 'v2' };
  await setUser('shorter', { ...base, hasOpenShorts: true, shorts: { [T]: openShort } });
  const buyErr = await call(executeTrade, { ticker: T, action: 'buy', amount: 5 }, 'shorter');
  check('short seller cannot buy', !!buyErr && buyErr.includes('Cover your short'), buyErr || 'no error');
  const limitErr = await call(
    createLimitOrder,
    { ticker: T, type: 'BUY', shares: 5, limitPrice: 90, allowPartialFills: false },
    'shorter',
  );
  check('nor place a limit buy', !!limitErr && limitErr.includes('Cover your short'), limitErr || 'no error');

  await setUser('sliver', { ...base, holdings: { [T]: 0.004 }, costBasis: { [T]: 100 } });
  check(
    'an unsellable sliver does not block a short',
    (await call(executeTrade, { ticker: T, action: 'short', amount: 5 }, 'sliver')) === null,
  );
});

it('hedged shares earn no dividend', () => {
  const now = Date.now();
  const data = {
    holdings: { [T]: 100 },
    holdingCohorts: { [T]: { eligible: 100, pending: [] } },
  };
  const full = computeDividend(data, now, { [T]: 100 }, () => 0.01).totalPaid;
  const half = computeDividend({ ...data, shorts: { [T]: { shares: 50 } } }, now, { [T]: 100 }, () => 0.01).totalPaid;
  const none = computeDividend({ ...data, shorts: { [T]: { shares: 100 } } }, now, { [T]: 100 }, () => 0.01).totalPaid;
  check('half hedged pays half', full > 0 && Math.abs(half - full / 2) < 0.02, `${full} / ${half}`);
  check('fully hedged pays nothing', none === 0, String(none));
});

it('closed long-term markets refuse buys and sells', async () => {
  await seed([eventMarket({ tradingClosed: true })]);
  await setUser('bettor', {
    cash: 10000,
    holdings: { [T]: 200 },
    costBasis: { [T]: 100 },
    shorts: {},
    eventPositions: { evt_a: { shares: { No: 100 }, costBasis: 50, settled: false } },
  });
  const buy = await call(buyEventShares, { marketId: 'evt_a', outcome: 'Yes', shares: 500 }, 'bettor');
  check('buy refused', !!buy && buy.includes('closed'), buy || 'no error');
  const sell = await call(sellEventShares, { marketId: 'evt_a', outcome: 'No', shares: 100 }, 'bettor');
  check('sell refused', !!sell && sell.includes('closed'), sell || 'no error');

  await seed([eventMarket({ q: [0, 1000] })]);
  check(
    'open market still sells',
    (await call(sellEventShares, { marketId: 'evt_a', outcome: 'No', shares: 100 }, 'bettor')) === null,
  );
  check('selling out frees the side-game room', (await getUser('bettor')).eventPositions.evt_a.costBasis === 0);
});

it('a market not reopened since the halt stays closed', async () => {
  await seed([eventMarket({ q: [0, 0], reopenedAt: Date.now() - 8 * DAY, opensAt: 1 })]);
  const before = Date.UTC(2026, 9, 31);
  if (Date.now() - before > 7 * DAY) {
    const err = await call(buyEventShares, { marketId: 'evt_a', outcome: 'Yes', shares: 500 }, 'bettor');
    check('stale market refuses', !!err && err.includes('closed'), err || 'no error');
  }
  await seed([eventMarket({ q: [0, 0], reopenedAt: Date.now() })]);
  const ok = await call(buyEventShares, { marketId: 'evt_a', outcome: 'Yes', shares: 500 }, 'bettor');
  check('reopened market trades', ok === null, ok || '');
});

it('hold gate covers dust and added shorts', async () => {
  await seed();
  await setUser('duster', {
    cash: 0,
    holdings: { [T]: 0.004 },
    costBasis: { [T]: 100 },
    lastBuyTime: { [T]: Date.now() },
  });
  await sweepDustPositions.run({}, ctx('duster'));
  check('fresh dust stays', (await getUser('duster')).holdings[T] === 0.004);

  const old = { shares: 10, costBasis: 100, margin: 1000, openedAt: Date.now() - DAY, system: 'v2' };
  await setUser('adder', {
    cash: 5000,
    shorts: { [T]: old },
    holdings: {},
    hasOpenShorts: true,
    lastBuyTime: { [T]: Date.now() },
  });
  const cover = await call(executeTrade, { ticker: T, action: 'cover', amount: 5 }, 'adder');
  check('cover waits after adding to an old short', !!cover && cover.includes('Hold period'), cover || 'no error');
});

it('tiny trades no longer reset the neglect clock', () => {
  const now = Date.now();
  const tiny = buildTickerFlowUpdate({ ticker: T, action: 'buy', amount: 0.01, totalValue: 1, now })[T] as Record<
    string,
    unknown
  >;
  const real = buildTickerFlowUpdate({ ticker: T, action: 'buy', amount: 2, totalValue: 200, now })[T] as Record<
    string,
    unknown
  >;
  check('$1 trade ignored', !('lastTradedAt' in tiny));
  check('$200 trade counts', real.lastTradedAt === now);
});
