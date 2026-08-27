'use strict';
// Money-path test suite for the ladder minigame, against the LOCAL Firebase
// emulator. Never touches production (uses FIRESTORE_EMULATOR_HOST).
//
// Run via:
//   npm run test:ladder
//
// The ladder moves real portfolio value in three directions — a deposit out of
// cash, a bet, and a taxed withdrawal back — and until now none of it had a
// single test. It also shipped a live bug on 2026-08-23 that needed a one-time
// repair of player documents, which is the kind of thing this exists to catch.
//
// Sections:
//   A. Deposit gating          B. Deposit caps
//   C. Play: house chips       D. Legacy chip migration
//   E. Withdrawal and tax      F. Season/leaderboard neutrality
//   G. Admin transfer

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

const admin = require('../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

// Loaded AFTER initializeApp so their top-level admin.firestore() binds to the emulator.
const { depositToLadderGame, withdrawFromLadderGame, adminTransferToLadder } =
  require('../functions/services/ladderTransfers');
const { playLadderGame } = require('../functions/services/ladderGame');
const { getLadderChips, getLadderWithdrawable } = require('../functions/helpers');
const {
  ADMIN_UID, LADDER_GAME_MAX_BALANCE, LADDER_GAME_MAX_DEPOSIT_PER_WINDOW,
  LADDER_MIN_BET, LADDER_WITHDRAW_PRINCIPAL_FEE_RATE, LADDER_WITHDRAW_RUSH_RATE,
  LADDER_RAMP_MIN_FACTOR, LADDER_DEPOSIT_WINDOW_MS,
} = require('../functions/constants');

let failures = 0;
let checks = 0;
const check = (label, cond, detail = '') => {
  checks++;
  console.log(`${cond ? '  ✅' : '  ❌'} ${label}${cond ? '' : ' — ' + detail}`);
  if (!cond) failures++;
};
const near = (a, b, tol = 0.011) => Math.abs(a - b) < tol;
const ctx = (uid) => ({ auth: { uid } });
const DAY = 24 * 60 * 60 * 1000;

// Deterministic ladder outcomes. playLadderGame derives the result from
// Math.random: below 0.5 gives 2 rungs and paths that do NOT cross, so starting
// left lands on "odd". Above 0.5 gives 3 rungs, paths cross, left lands "even".
const realRandom = Math.random;
const forceWin = () => { Math.random = () => 0.1; };   // left + odd wins
const forceLoss = () => { Math.random = () => 0.9; };  // left + odd loses
const restoreRandom = () => { Math.random = realRandom; };

const play = (uid, amount) => playLadderGame.run(
  { startSide: 'left', bet: 'odd', amount }, ctx(uid)
);

/** Seed a main user with enough invested value to clear the side-game cap. */
async function seedUser(uid, { cash = 50000, invested = 20000, ageDays = 30, extra = {} } = {}) {
  await db.collection('users').doc(uid).set({
    displayName: uid,
    cash,
    holdings: { JAY: 100 },
    costBasis: { JAY: invested / 100 },
    shorts: {},
    createdAt: admin.firestore.Timestamp.fromMillis(Date.now() - ageDays * DAY),
    ...extra,
  });
}
const seedLadder = (uid, data) => db.collection('ladderGameUsers').doc(uid).set(data);
const getUser = async (uid) => (await db.collection('users').doc(uid).get()).data();
const getLadder = async (uid) => (await db.collection('ladderGameUsers').doc(uid).get()).data();
/** Clear the 3-second play cooldown without waiting for it. */
const clearCooldown = (uid) =>
  db.collection('ladderGameUsers').doc(uid).update({
    lastPlayed: admin.firestore.Timestamp.fromMillis(Date.now() - 60000),
  });

const rejects = async (fn, pattern) => {
  try { await fn(); return null; } catch (e) { return pattern.test(e.message) ? true : e.message; }
};

async function main() {
  console.log('\n=== Ladder money-path suite (emulator) ===');

  // ── A. Deposit gating ─────────────────────────────────────────────────────
  console.log('\nA. Deposit gating');

  await seedUser('lad_nostock', { invested: 0 });
  await db.collection('users').doc('lad_nostock').update({ holdings: {}, costBasis: {} });
  check('deposit blocked with nothing invested in stocks',
    await rejects(() => depositToLadderGame.run({ amount: 100 }, ctx('lad_nostock')), /invest in stocks/i) === true);

  await seedUser('lad_poor', { cash: 10 });
  check('deposit blocked without the cash to cover it',
    await rejects(() => depositToLadderGame.run({ amount: 100 }, ctx('lad_poor')), /insufficient/i) === true);

  await seedUser('lad_frac');
  check('a sub-dollar deposit is rejected outright',
    await rejects(() => depositToLadderGame.run({ amount: 0.4 }, ctx('lad_frac')), /whole dollar/i) === true);

  await depositToLadderGame.run({ amount: 100.9 }, ctx('lad_frac'));
  const frac = await getLadder('lad_frac');
  const fracUser = await getUser('lad_frac');
  check('decimals are floored away, not rounded up', frac.balance === 100, `balance=${frac.balance}`);
  check('the floored remainder stays in main cash, never destroyed',
    near(fracUser.cash, 50000 - 100), `cash=${fracUser.cash}`);

  await seedUser('lad_banned', { extra: { isBanned: true } });
  check('a banned account cannot deposit',
    await rejects(() => depositToLadderGame.run({ amount: 100 }, ctx('lad_banned')), /ban/i) === true);

  await seedUser('lad_walled', { extra: { requiresDiscordLink: true } });
  check('the Discord wall gates deposits like every other order path',
    await rejects(() => depositToLadderGame.run({ amount: 100 }, ctx('lad_walled')), /discord/i) === true);

  // ── B. Deposit caps ───────────────────────────────────────────────────────
  console.log('\nB. Deposit caps');

  await seedUser('lad_capped', { cash: 100000, invested: 500 });
  check('balance is capped at what the player has invested in stocks',
    await rejects(() => depositToLadderGame.run({ amount: 600 }, ctx('lad_capped')), /capped at what you've invested/i) === true);

  await seedUser('lad_max', { cash: 100000, invested: 100000 });
  check('balance cannot exceed the hard ladder ceiling',
    await rejects(
      () => depositToLadderGame.run({ amount: LADDER_GAME_MAX_BALANCE + 1 }, ctx('lad_max')),
      /cap|limit/i
    ) === true);

  await seedUser('lad_window', { cash: 100000, invested: 100000 });
  await depositToLadderGame.run({ amount: LADDER_GAME_MAX_DEPOSIT_PER_WINDOW }, ctx('lad_window'));
  check('the rolling window cap blocks a second deposit',
    await rejects(() => depositToLadderGame.run({ amount: 1 }, ctx('lad_window')), /limit|frees up/i) === true);

  // A brand new account only has a slice of the caps unlocked, so its signup cash
  // can't be run straight through the casino.
  await seedUser('lad_new', { cash: 100000, invested: 100000, ageDays: 0 });
  const newAccountCeiling = Math.floor(LADDER_GAME_MAX_BALANCE * LADDER_RAMP_MIN_FACTOR);
  check('a day-old account is held to the ramped ceiling',
    await rejects(
      () => depositToLadderGame.run({ amount: newAccountCeiling + 50 }, ctx('lad_new')),
      /cap|limit|more before/i
    ) === true);
  await depositToLadderGame.run({ amount: newAccountCeiling }, ctx('lad_new'));
  check('and can deposit right up to it', (await getLadder('lad_new')).balance === newAccountCeiling);

  // ── C. Play: house chips ──────────────────────────────────────────────────
  console.log('\nC. Play: house chips');

  // Chips are check-in grants and the welcome stake: playable, never cashable.
  // A loss burns them FIRST, a win leaves them intact and pays profit as real
  // money. This is the logic that shipped broken and needed a data repair.
  await seedUser('lad_chips');
  await seedLadder('lad_chips', {
    balance: 500, nonWithdrawable: 500, chipsMigrated: true, totalDeposited: 0,
    totalWon: 0, totalLost: 0, gamesPlayed: 0, wins: 0, losses: 0,
    currentStreak: 0, bestStreak: 0, highBetGames: 0, lastPlayed: null,
  });
  check('a pure-chip balance has nothing to withdraw',
    getLadderWithdrawable(await getLadder('lad_chips')) === 0);

  forceLoss();
  await play('lad_chips', 100);
  restoreRandom();
  const afterLoss = await getLadder('lad_chips');
  check('a loss burns chips first', getLadderChips(afterLoss) === 400, `chips=${getLadderChips(afterLoss)}`);
  check('and the balance falls with them', afterLoss.balance === 400, `balance=${afterLoss.balance}`);
  check('still nothing withdrawable after a loss', getLadderWithdrawable(afterLoss) === 0);

  await clearCooldown('lad_chips');
  forceWin();
  await play('lad_chips', 100);
  restoreRandom();
  const afterWin = await getLadder('lad_chips');
  check('a win leaves the chip pile alone', getLadderChips(afterWin) === 400, `chips=${getLadderChips(afterWin)}`);
  check('balance grows by the profit', afterWin.balance === 500, `balance=${afterWin.balance}`);
  check('winnings on top of chips ARE withdrawable',
    getLadderWithdrawable(afterWin) === 100, `withdrawable=${getLadderWithdrawable(afterWin)}`);

  // The invariant the whole design rests on: free money can never be cashed out,
  // so chips must never exceed the balance sitting behind them.
  await clearCooldown('lad_chips');
  forceLoss();
  await play('lad_chips', 450);
  restoreRandom();
  const wiped = await getLadder('lad_chips');
  check('chips never exceed the balance backing them',
    getLadderChips(wiped) <= wiped.balance, `chips=${getLadderChips(wiped)} balance=${wiped.balance}`);
  check('chips floor at zero rather than going negative', getLadderChips(wiped) >= 0);

  await seedUser('lad_bet');
  await seedLadder('lad_bet', { balance: 10, nonWithdrawable: 0, chipsMigrated: true, totalDeposited: 10,
    totalWon: 0, totalLost: 0, gamesPlayed: 0, wins: 0, losses: 0, currentStreak: 0, bestStreak: 0,
    highBetGames: 0, lastPlayed: null });
  check('a bet bigger than the balance is refused',
    await rejects(() => play('lad_bet', 999), /insufficient/i) === true);
  check(`a bet under the $${LADDER_MIN_BET} minimum is refused`,
    await rejects(() => play('lad_bet', 0.4), /minimum bet/i) === true);
  await clearCooldown('lad_bet');
  await play('lad_bet', 5);
  check('the 3-second cooldown blocks a rapid second play',
    await rejects(() => play('lad_bet', 1), /cooldown/i) === true);

  // ── D. Legacy chip migration ──────────────────────────────────────────────
  console.log('\nD. Legacy chip migration');

  // Before 2026-08-23 nonWithdrawable held the LIFETIME total ever granted and
  // never came down, so every check-in top-up raised a floor the balance could
  // never clear and regular players could not withdraw anything at all. An
  // unmigrated document is repaired on read: what is left of the chips is
  // (granted - lost), capped at the balance actually there.
  const legacy = { balance: 800, nonWithdrawable: 900, totalLost: 600, totalDeposited: 1000 };
  check('an unmigrated doc nets lifetime losses off the granted total',
    getLadderChips(legacy) === 300, `chips=${getLadderChips(legacy)}`);
  check('and so has something to withdraw again',
    getLadderWithdrawable(legacy) === 500, `withdrawable=${getLadderWithdrawable(legacy)}`);
  check('a player who lost more than they were ever granted has zero chips',
    getLadderChips({ balance: 800, nonWithdrawable: 500, totalLost: 900 }) === 0);
  check('repaired chips can never exceed the balance present',
    getLadderChips({ balance: 100, nonWithdrawable: 900, totalLost: 0 }) === 100);
  check('a migrated doc is trusted as-is and not re-netted',
    getLadderChips({ balance: 800, nonWithdrawable: 300, totalLost: 600, chipsMigrated: true }) === 300);

  // ── E. Withdrawal and tax ─────────────────────────────────────────────────
  console.log('\nE. Withdrawal and tax');

  await seedUser('lad_wd', { cash: 1000 });
  await seedLadder('lad_wd', {
    balance: 2000, nonWithdrawable: 0, chipsMigrated: true, totalDeposited: 1000,
    principalWithdrawn: 0, profitWithdrawn: 0, totalWon: 1000, totalLost: 0,
    gamesPlayed: 1, wins: 1, losses: 0, currentStreak: 1, bestStreak: 1, recentDeposits: [],
  });
  const wdRes = (await withdrawFromLadderGame.run({ amount: 1000 }, ctx('lad_wd')));
  check('principal back pays the flat fee',
    near(wdRes.principalFee, 1000 * LADDER_WITHDRAW_PRINCIPAL_FEE_RATE), `fee=${wdRes.principalFee}`);
  check('a withdrawal with no recent deposit pays no rush surcharge', wdRes.rushSurcharge === 0);
  const wdLadder = await getLadder('lad_wd');
  const wdUser = await getUser('lad_wd');
  check('the ladder balance loses the FULL gross, not the net',
    wdLadder.balance === 1000, `balance=${wdLadder.balance}`);
  check('main cash gains only the net', near(wdUser.cash, 1000 + wdRes.netReceived), `cash=${wdUser.cash}`);
  check('the tax is a sink — gross out exceeds net in',
    wdRes.netReceived < wdRes.grossAmount, `${wdRes.netReceived} vs ${wdRes.grossAmount}`);
  check('principal drawn down is recorded for the bracket maths',
    near(wdLadder.principalWithdrawn, 1000), `principalWithdrawn=${wdLadder.principalWithdrawn}`);

  // A deposit inside the window makes the whole withdrawal a rush job.
  await seedUser('lad_rush', { cash: 0 });
  await seedLadder('lad_rush', {
    balance: 2000, nonWithdrawable: 0, chipsMigrated: true, totalDeposited: 1000,
    principalWithdrawn: 0, profitWithdrawn: 0, totalWon: 0, totalLost: 0,
    gamesPlayed: 0, wins: 0, losses: 0, currentStreak: 0, bestStreak: 0,
    recentDeposits: [{ ts: Date.now() - 1000, amount: 1000 }],
  });
  const rush = await withdrawFromLadderGame.run({ amount: 500 }, ctx('lad_rush'));
  check('a deposit inside the window adds the rush surcharge',
    near(rush.rushSurcharge, 500 * LADDER_WITHDRAW_RUSH_RATE), `rush=${rush.rushSurcharge}`);

  // Chips are not withdrawable, and the error has to say so.
  await seedUser('lad_chipwd');
  await seedLadder('lad_chipwd', {
    balance: 600, nonWithdrawable: 500, chipsMigrated: true, totalDeposited: 100,
    principalWithdrawn: 0, profitWithdrawn: 0, totalWon: 0, totalLost: 0,
    gamesPlayed: 0, wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, recentDeposits: [],
  });
  check('a withdrawal that would eat into chips is refused',
    await rejects(() => withdrawFromLadderGame.run({ amount: 200 }, ctx('lad_chipwd')), /bonus chips/i) === true);
  await withdrawFromLadderGame.run({ amount: 100 }, ctx('lad_chipwd'));
  const chipWd = await getLadder('lad_chipwd');
  check('withdrawing everything above the chips is allowed', chipWd.balance === 500);
  check('and the chips are still there afterwards', getLadderChips(chipWd) === 500);

  // ── F. Season and leaderboard neutrality ──────────────────────────────────
  console.log('\nF. Season and leaderboard neutrality');

  // portfolioValue is cash + holdings + shorts, so the ladder balance sits
  // OUTSIDE it: a deposit reads as a loss and a withdrawal as a gain. Both
  // directions are booked as signed flow so a round trip cancels, which is what
  // keeps a hot streak at the casino out of season and leaderboard returns.
  await seedUser('lad_flow', { cash: 50000, invested: 50000 });
  const flowBefore = (await getUser('lad_flow')).grantedValue || 0;
  await depositToLadderGame.run({ amount: 1000 }, ctx('lad_flow'));
  const afterDep = await getUser('lad_flow');
  check('a deposit books a NEGATIVE flow, so parked money is not a fake loss',
    near((afterDep.grantedValue || 0) - flowBefore, -1000), `flow=${afterDep.grantedValue}`);
  check('the ladder flow is also tracked separately for the shadow stat',
    near(afterDep.ladderFlowValue || 0, -1000), `ladderFlow=${afterDep.ladderFlowValue}`);

  const back = await withdrawFromLadderGame.run({ amount: 1000 }, ctx('lad_flow'));
  const afterWd = await getUser('lad_flow');
  check('a withdrawal books the net back as positive flow',
    near((afterWd.grantedValue || 0) - flowBefore, back.netReceived - 1000),
    `flow=${afterWd.grantedValue} net=${back.netReceived}`);
  check('the round trip nets to only the tax, not the whole balance',
    near((afterWd.grantedValue || 0) - flowBefore, -back.totalTax),
    `flow=${afterWd.grantedValue} tax=${back.totalTax}`);

  // ── G. Admin transfer ─────────────────────────────────────────────────────
  console.log('\nG. Admin transfer');

  await seedUser('lad_admin');
  await seedLadder('lad_admin', {
    balance: 900, nonWithdrawable: 800, chipsMigrated: true, totalDeposited: 100,
    totalWon: 0, totalLost: 0, gamesPlayed: 0, wins: 0, losses: 0,
    currentStreak: 0, bestStreak: 0,
  });
  check('a non-admin cannot move ladder money',
    await rejects(
      () => adminTransferToLadder.run({ userId: 'lad_admin', amount: -500 }, ctx('lad_admin')),
      /admin/i
    ) === true);

  await adminTransferToLadder.run({ userId: 'lad_admin', amount: -500 }, ctx(ADMIN_UID));
  const pulled = await getLadder('lad_admin');
  check('an admin pull lowers the balance', pulled.balance === 400, `balance=${pulled.balance}`);
  check('and chips are clamped down with it, never left above the balance',
    getLadderChips(pulled) === 400, `chips=${getLadderChips(pulled)}`);

  console.log(`\n${checks} checks run.`);
  console.log(failures === 0 ? 'ALL LADDER CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { restoreRandom(); console.error('Suite crashed:', err); process.exit(1); });
