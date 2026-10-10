// The money ledger, end to end against the LOCAL emulator. Never touches
// production. Run via: npm run test:ledger
//
// One player goes through a spread of real money paths (stock buy and sell,
// daily check-in, ladder deposit / play / withdrawal, an admin cash grant).
// Afterwards the ledger must account for every dollar: the cash entries sum to
// the change in cash, and the ladder entries sum to the ladder balance.
// functions/src/shared/ledger.test.ts separately fails the build if any
// backend file writes cash without booking an entry.

import { beforeAll, it } from 'vitest';
import { createRequire } from 'module';
import { check, seedEmulator, type Loose } from './harness';

const require = createRequire(import.meta.url);

beforeAll(seedEmulator);

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

// Loaded AFTER initializeApp so their top-level admin.firestore() binds to the emulator.
const { executeTrade } =
  require('../../functions/src/trading/trading') as typeof import('../../functions/src/trading/trading');
const { dailyCheckin } =
  require('../../functions/src/missions/missions') as typeof import('../../functions/src/missions/missions');
const { depositToLadderGame, withdrawFromLadderGame } =
  require('../../functions/src/ladder/ladderTransfers') as typeof import('../../functions/src/ladder/ladderTransfers');
const { playLadderGame } =
  require('../../functions/src/ladder/ladderGame') as typeof import('../../functions/src/ladder/ladderGame');
const { adminSetCash } =
  require('../../functions/src/admin/adminOps') as typeof import('../../functions/src/admin/adminOps');
const { ADMIN_UID, isWeeklyTradingHalt } =
  require('../../functions/src/shared/constants') as typeof import('../../functions/src/shared/constants');

const DAY = 24 * 60 * 60 * 1000;
const UID = 'ledger_user';
const START_CASH = 50000;
let ipSeed = 0;
const ctx = (uid: string) => ({ auth: { uid }, rawRequest: { ip: `192.0.2.${++ipSeed}` } }) as Loose;
const run = (fn: Loose, data: Loose, uid = UID) => fn.run(data, ctx(uid));
const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

async function main() {
  await db
    .collection('market')
    .doc('current')
    .set({ prices: { SOPH: 80, JAY: 50 }, launchedTickers: [], marketHalted: false, haltedTickers: {} });
  await db.collection('market').doc('priceHistory').set({});
  await db
    .collection('users')
    .doc(UID)
    .set({
      displayName: 'LedgerUser',
      cash: START_CASH,
      holdings: { JAY: 100 },
      costBasis: { JAY: 200 },
      shorts: {},
      createdAt: admin.firestore.Timestamp.fromMillis(Date.now() - 30 * DAY),
    });

  const expected = new Set<string>();
  // executeTrade rejects everything during the Thursday halt; the rest still runs.
  if (!isWeeklyTradingHalt()) {
    await run(executeTrade, { ticker: 'SOPH', action: 'buy', amount: 5 });
    // Clear the 3-second trade cooldown without waiting for it.
    await db
      .collection('users')
      .doc(UID)
      .update({ lastTradeTime: admin.firestore.Timestamp.fromMillis(Date.now() - 60000) });
    await run(executeTrade, { ticker: 'JAY', action: 'sell', amount: 10 });
    expected.add('trade_buy').add('trade_sell');
  }
  await run(dailyCheckin, {});
  expected.add('checkin_reward');

  await run(depositToLadderGame, { amount: 1000 });
  const realRandom = Math.random;
  Math.random = () => 0.1; // left + odd wins (see ladder.test.ts)
  try {
    await run(playLadderGame, { startSide: 'left', bet: 'odd', amount: 100 });
  } finally {
    Math.random = realRandom;
  }
  await db
    .collection('ladderGameUsers')
    .doc(UID)
    .update({ lastPlayed: admin.firestore.Timestamp.fromMillis(Date.now() - 60000) });
  await run(withdrawFromLadderGame, { amount: 500 });
  expected.add('ladder_deposit').add('ladder_withdraw');

  await run(adminSetCash, { userId: UID, mode: 'add', amount: 123.45, memo: 'ledger test' }, ADMIN_UID);
  expected.add('admin_set_cash');

  const user = (await db.collection('users').doc(UID).get()).data();
  const ladder = (await db.collection('ladderGameUsers').doc(UID).get()).data();
  const entries = (await db.collection('ledger').where('uid', '==', UID).get()).docs.map((d: Loose) => d.data());
  const cash = entries.filter((e: Loose) => e.account === 'cash');
  const lad = entries.filter((e: Loose) => e.account === 'ladder');

  const types = new Set(cash.map((e: Loose) => e.type));
  const missingTypes = [...expected].filter((t) => !types.has(t));
  check('every money action left a ledger entry', missingTypes.length === 0, `missing ${missingTypes.join(', ')}`);

  const cashSum = sum(cash.map((e: Loose) => e.amount));
  const cashDelta = Math.round((user.cash - START_CASH) * 100) / 100;
  check(
    `cash entries add up to the change in cash ($${cashDelta})`,
    Math.abs(cashSum - cashDelta) < 0.02,
    `ledger ${cashSum} vs actual ${cashDelta}`,
  );

  const ladderSum = sum(lad.map((e: Loose) => e.amount));
  check(
    `ladder entries add up to the ladder balance ($${ladder.balance})`,
    Math.abs(ladderSum - ladder.balance) < 0.02,
    `ledger ${ladderSum} vs balance ${ladder.balance}: ${JSON.stringify(lad.map((e: Loose) => [e.type, e.amount]))}`,
  );
  check(
    'ladder play recorded as a win',
    lad.some((e: Loose) => e.type === 'ladder_win' && e.amount === 100),
  );

  const adminEntry = cash.find((e: Loose) => e.type === 'admin_set_cash');
  check(
    'admin grant names the admin, never the private memo',
    adminEntry?.detail?.by === ADMIN_UID && !JSON.stringify(adminEntry).includes('ledger test'),
    JSON.stringify(adminEntry),
  );

  const trade = cash.find((e: Loose) => e.type === 'trade_buy');
  if (trade) {
    const rec = (await db.doc(trade.ref).get()).data();
    check(
      'trade entry points at its trade record and matches its cash',
      rec && Math.abs(trade.amount - (rec.cashAfter - rec.cashBefore)) < 0.01,
      JSON.stringify({ trade, rec }),
    );
  }
}

it('money ledger accounts for every dollar', main);
