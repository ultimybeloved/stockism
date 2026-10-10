// Money-path test suite for weekly prediction bets (placeBet and
// claimPredictionPayout), against the LOCAL Firebase emulator. Never touches
// production (uses FIRESTORE_EMULATOR_HOST).
//
// Run via:
//   npm run test:predictions
//
// Cash leaves the portfolio into a shared pool and comes back as a share of it.
// Both legs are booked as a signed flow (predictionFlowValue, mirrored into
// grantedValue) so a bet is neither a loss nor a payout a gain on any percent
// board. Before that, one all-in bet at long odds read as a +1000% season. The
// long-term event markets have their own suite (test:eventmarket).
//
// Sections:
//   A. Placing a bet          B. Bet limits
//   C. Closed and halted      D. Payouts
//   E. Achievements           F. Account guards

import { it } from 'vitest';
import { createRequire } from 'module';
import { check, type Loose } from './harness';

const require = createRequire(import.meta.url);

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

// isWeeklyTradingHalt reads the wall clock. Swap it before the handlers load so
// the suite gives the same answer on a Thursday evening as any other time.
// The constants module's exports are read-only, so the cached module is
// replaced with a copy that carries the stub.
const constantsPath = require.resolve('../../functions/src/shared/constants');
const constants = require(constantsPath);
let weeklyHalt = false;
require.cache[constantsPath]!.exports = { ...constants, isWeeklyTradingHalt: () => weeklyHalt };

// Loaded AFTER initializeApp so their top-level admin.firestore() binds to the emulator.
const { placeBet, claimPredictionPayout } =
  require('../../functions/src/predictions/predictions') as typeof import('../../functions/src/predictions/predictions');

const DAY = 24 * 60 * 60 * 1000;
const near = (a: number, b: number, tol = 0.011) => Math.abs(a - b) < tol;
const ctx = (uid: string) => ({ auth: { uid } });
const today = () => new Date().toISOString().split('T')[0]!;

const predictionsRef = db.collection('predictions').doc('current');
const marketRef = db.collection('market').doc('current');

const prediction = (id: string, extra: Loose = {}) => ({
  id,
  question: `Question ${id}?`,
  options: ['Yes', 'No'],
  pools: {},
  endsAt: Date.now() + 7 * DAY,
  resolved: false,
  ...extra,
});
const setPredictions = (list: Loose[]) => predictionsRef.set({ list });
const getPrediction = async (id: string) =>
  ((await predictionsRef.get()).data().list as Loose[]).find((p) => p.id === id);

/** A player with `invested` dollars in stocks at cost, so the bet cap is known. */
async function seedUser(uid: string, { cash = 5000, invested = 2000, extra = {} as Loose } = {}) {
  await db
    .collection('users')
    .doc(uid)
    .set({
      displayName: uid,
      cash,
      holdings: invested ? { JAY: 100 } : {},
      costBasis: invested ? { JAY: invested / 100 } : {},
      shorts: {},
      ...extra,
    });
}
const getUser = async (uid: string) => (await db.collection('users').doc(uid).get()).data();
const bet = (uid: string, predictionId: string, option: string, amount: unknown) =>
  placeBet.run({ predictionId, option, amount }, ctx(uid));
const claim = (uid: string, predictionId: string) => claimPredictionPayout.run({ predictionId }, ctx(uid));

/** Resolve a prediction in place, as the admin panel does. */
async function resolve(id: string, fields: Loose) {
  const list = (await predictionsRef.get()).data().list as Loose[];
  await setPredictions(list.map((p) => (p.id === id ? { ...p, resolved: true, ...fields } : p)));
}

const rejects = async (fn: Loose, pattern: RegExp) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return pattern.test(e.message) ? true : e.message;
  }
};

async function main() {
  console.log('\n=== Prediction bets money-path suite (emulator) ===');
  await marketRef.set({ prices: { JAY: 20 } });
  await setPredictions([
    prediction('p_main'),
    prediction('p_limits'),
    prediction('p_ended', { endsAt: Date.now() - 1000 }),
    prediction('p_resolved', { resolved: true, outcome: 'Yes' }),
    prediction('p_multi', { options: ['A', 'B', 'C'] }),
    prediction('p_under', { seedPerOption: 1000, pools: { Yes: 1000, No: 1000 } }),
    prediction('p_even', { seedPerOption: 1000, pools: { Yes: 1000, No: 1000 } }),
  ]);

  // ── A. Placing a bet ──────────────────────────────────────────────────────
  console.log('\nA. Placing a bet');

  await seedUser('b_first');
  const first = await bet('b_first', 'p_main', 'Yes', 300);
  const firstUser = await getUser('b_first');
  check('a bet comes out of cash', firstUser.cash === 4700, `cash=${firstUser.cash}`);
  check('and goes into its side of the pool', (await getPrediction('p_main')).pools.Yes === 300);
  check(
    'the bet is recorded on the player',
    firstUser.bets?.p_main?.option === 'Yes' && firstUser.bets.p_main.amount === 300 && first.newBetAmount === 300,
    firstUser.bets,
  );
  check(
    'it is booked as money leaving for a side game, not a loss',
    firstUser.predictionFlowValue === -300 && firstUser.grantedValue === -300,
    `flow=${firstUser.predictionFlowValue} granted=${firstUser.grantedValue}`,
  );
  check('the daily mission flag is set', firstUser.dailyMissions?.[today()]?.placedBet === true);

  const more = await bet('b_first', 'p_main', 'Yes', 200);
  const moreUser = await getUser('b_first');
  check('adding to the same side stacks the bet', more.newBetAmount === 500 && moreUser.bets.p_main.amount === 500);
  check('and the booking with it', moreUser.predictionFlowValue === -500 && moreUser.grantedValue === -500);
  check(
    'switching sides is refused',
    (await rejects(() => bet('b_first', 'p_main', 'No', 50), /different option/i)) === true,
  );

  // ── B. Bet limits ─────────────────────────────────────────────────────────
  console.log('\nB. Bet limits');

  await seedUser('b_cap', { cash: 5000, invested: 1000 });
  check(
    'a bet over what the player has invested in stocks is refused',
    (await rejects(() => bet('b_cap', 'p_limits', 'Yes', 1001), /exceeds limit/i)) === true,
  );
  await bet('b_cap', 'p_limits', 'Yes', 600);
  check(
    'and the cap counts what is already bet on that question',
    (await rejects(() => bet('b_cap', 'p_limits', 'Yes', 401), /Max: \$400\.00/)) === true,
  );
  await bet('b_cap', 'p_limits', 'Yes', 400);
  check('right up to the cap is fine', (await getUser('b_cap')).bets.p_limits.amount === 1000);

  await seedUser('b_poor', { cash: 100, invested: 5000 });
  check(
    'a bet over cash is refused',
    (await rejects(() => bet('b_poor', 'p_limits', 'Yes', 101), /insufficient funds/i)) === true,
  );

  await seedUser('b_noinv', { invested: 0 });
  check(
    'no stocks, no betting',
    (await rejects(() => bet('b_noinv', 'p_limits', 'Yes', 10), /invest in stocks/i)) === true,
  );

  await seedUser('b_bad');
  for (const [label, amount] of [
    ['zero', 0],
    ['negative', -50],
    ['not a number', 'lots'],
    ['NaN', NaN],
  ] as const) {
    check(
      `a ${label} amount is refused`,
      (await rejects(() => bet('b_bad', 'p_limits', 'Yes', amount), /invalid bet/i)) === true,
    );
  }
  check(
    'an option the question does not have is refused',
    (await rejects(() => bet('b_bad', 'p_limits', 'Maybe', 10), /unknown option/i)) === true,
  );
  check(
    'an unknown question is refused',
    (await rejects(() => bet('b_bad', 'p_nope', 'Yes', 10), /prediction not found/i)) === true,
  );
  const bad = await getUser('b_bad');
  check('refused bets cost nothing and book nothing', bad.cash === 5000 && !bad.grantedValue && !bad.bets);

  // ── C. Closed and halted ──────────────────────────────────────────────────
  console.log('\nC. Closed and halted');

  await seedUser('b_closed');
  check(
    'a question past its end time takes no bets',
    (await rejects(() => bet('b_closed', 'p_ended', 'Yes', 10), /betting has ended/i)) === true,
  );
  check(
    'nor does a resolved one',
    (await rejects(() => bet('b_closed', 'p_resolved', 'Yes', 10), /betting has ended/i)) === true,
  );

  weeklyHalt = true;
  check(
    'no betting during the weekly chapter-review halt',
    (await rejects(() => bet('b_closed', 'p_main', 'Yes', 10), /.+/)) === true,
  );
  weeklyHalt = false;

  await marketRef.set({ prices: { JAY: 20 }, marketHalted: true, haltReason: 'Emergency maintenance' });
  check(
    'no betting during an admin halt, with the halt reason shown',
    (await rejects(() => bet('b_closed', 'p_main', 'Yes', 10), /emergency maintenance/i)) === true,
  );
  await marketRef.set({ prices: { JAY: 20 } });

  const closed = await getUser('b_closed');
  check('the refused bets cost nothing', closed.cash === 5000 && !closed.grantedValue);
  check('and the pool never saw them', !(await getPrediction('p_main')).pools.No);

  // ── D. Payouts ────────────────────────────────────────────────────────────
  console.log('\nD. Payouts');

  // p_main: b_first has 500 on Yes. Add a second Yes and a No.
  await seedUser('b_yes2');
  await bet('b_yes2', 'p_main', 'Yes', 1500);
  await seedUser('b_no');
  await bet('b_no', 'p_main', 'No', 2000);

  check(
    'nothing can be claimed before the question is resolved',
    (await rejects(() => claim('b_first', 'p_main'), /not resolved/i)) === true,
  );

  await resolve('p_main', { outcome: 'Yes' });
  const before = await getUser('b_first');
  const won = await claim('b_first', 'p_main');
  const after = await getUser('b_first');
  // Pool 4000, Yes side 2000, b_first holds a quarter of Yes: 4000 * 500/2000.
  check('a winner gets their share of the whole pool', won.won === true && near(won.payout, 1000), won);
  check('paid into cash', near(after.cash, before.cash + 1000), `cash=${after.cash}`);
  check(
    'and booked as money coming back from a side game',
    near(after.predictionFlowValue, -500 + 1000) && near(after.grantedValue, -500 + 1000),
    `flow=${after.predictionFlowValue} granted=${after.grantedValue}`,
  );
  check(
    'so over the round trip, the change in cash is exactly the change in the booking',
    near(after.cash - 5000, after.grantedValue),
    `cashChange=${after.cash - 5000} granted=${after.grantedValue}`,
  );
  check('the bet is marked paid', after.bets.p_main.paid === true && near(after.bets.p_main.payout, 1000));
  check('and the win counted', after.predictionWins === 1);

  check('a second claim is refused', (await rejects(() => claim('b_first', 'p_main'), /already paid/i)) === true);
  check('and pays nothing', near((await getUser('b_first')).cash, after.cash));

  const notes = await db.collection('users').doc('b_first').collection('notifications').get();
  check(
    'the winner gets a payout notification',
    notes.docs.some((d: Loose) => /won \$1,000/.test(d.data().message || '')),
    notes.docs.map((d: Loose) => d.data().message),
  );

  const lostBefore = await getUser('b_no');
  const lost = await claim('b_no', 'p_main');
  const lostUser = await getUser('b_no');
  check('a loser is paid nothing', lost.won === false && lost.payout === 0 && lostUser.cash === lostBefore.cash);
  check('but the bet is closed out', lostUser.bets.p_main.paid === true && lostUser.bets.p_main.payout === 0);
  check(
    'and the stake stays booked as gone to the side game',
    lostUser.predictionFlowValue === -2000 && lostUser.grantedValue === -2000,
  );
  check('no win is counted', !lostUser.predictionWins);

  await seedUser('b_nobet');
  check(
    'a player with no bet cannot claim',
    (await rejects(() => claim('b_nobet', 'p_main'), /no bet found/i)) === true,
  );

  // Several winning outcomes share the pool.
  await seedUser('m_a');
  await seedUser('m_b');
  await seedUser('m_c');
  await bet('m_a', 'p_multi', 'A', 100);
  await bet('m_b', 'p_multi', 'B', 300);
  await bet('m_c', 'p_multi', 'C', 600);
  await resolve('p_multi', { outcomes: ['A', 'B'] });
  const mA = await claim('m_a', 'p_multi');
  const mB = await claim('m_b', 'p_multi');
  const mC = await claim('m_c', 'p_multi');
  check(
    'with two winning outcomes, both share the whole pool by stake',
    near(mA.payout, 250) && near(mB.payout, 750) && mC.won === false,
    { a: mA.payout, b: mB.payout, c: mC.payout },
  );

  // ── E. Achievements ───────────────────────────────────────────────────────
  console.log('\nE. Achievements');

  // p_under: house seeds 1000 a side. Players: 100 on Yes, 900 on No, so Yes
  // had 10% of the player money even though the seed makes it look like 37%.
  await seedUser('u_yes');
  await seedUser('u_no');
  await bet('u_yes', 'p_under', 'Yes', 100);
  await bet('u_no', 'p_under', 'No', 900);
  await resolve('p_under', { outcome: 'Yes' });
  const under = await claim('u_yes', 'p_under');
  const underUser = await getUser('u_yes');
  check(
    'winning a side with under 20% of player money earns UNDERDOG',
    (underUser.achievements || []).includes('UNDERDOG'),
    underUser.achievements,
  );
  // The house seed sits in the pool too: 3000 total, 1100 on Yes.
  check('the payout includes the house seed', near(under.payout, (100 / 1100) * 3000), `payout=${under.payout}`);

  // p_even: 500 a side of player money. Not an underdog win.
  await seedUser('e_yes');
  await seedUser('e_no');
  await bet('e_yes', 'p_even', 'Yes', 500);
  await bet('e_no', 'p_even', 'No', 500);
  await resolve('p_even', { outcome: 'Yes' });
  await claim('e_yes', 'p_even');
  check('an even split is no underdog win', !((await getUser('e_yes')).achievements || []).includes('UNDERDOG'));

  await seedUser('o_third', { extra: { predictionWins: 2 } });
  await setPredictions([...(await predictionsRef.get()).data().list, prediction('p_oracle')]);
  await bet('o_third', 'p_oracle', 'Yes', 10);
  await resolve('p_oracle', { outcome: 'Yes' });
  await claim('o_third', 'p_oracle');
  check('the third win earns ORACLE', ((await getUser('o_third')).achievements || []).includes('ORACLE'));

  // ── F. Account guards ─────────────────────────────────────────────────────
  console.log('\nF. Account guards');

  check('betting needs a login', (await rejects(() => placeBet.run({}, {}), /logged in/i)) === true);

  await setPredictions([...(await predictionsRef.get()).data().list, prediction('p_guard')]);
  for (const [uid, extra, pattern] of [
    ['g_banned', { isBanned: true }, /banned/i],
    ['g_wall', { requiresDiscordLink: true }, /link your discord/i],
  ] as const) {
    await seedUser(uid, { extra: { ...extra, bets: { p_main: { option: 'Yes', amount: 100 } } } });
    check(`${uid}: bet refused`, (await rejects(() => bet(uid, 'p_guard', 'Yes', 10), pattern)) === true);
    check(`${uid}: payout claim refused`, (await rejects(() => claim(uid, 'p_main'), pattern)) === true);
    const u = await getUser(uid);
    check(`${uid}: nothing moved`, u.cash === 5000 && !u.grantedValue && !u.bets.p_main.paid);
  }
}

it('prediction bets', main);
