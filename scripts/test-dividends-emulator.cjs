'use strict';
// Money-path test suite for the weekly dividend payout, against the LOCAL
// Firebase emulator. Never touches production (uses FIRESTORE_EMULATOR_HOST).
//
// Run via:
//   npm run test:dividends
//
// Dividends run every Thursday across every account and pay in cash or in stock.
// A bug here is silent and compounds week on week, and until now none of it had
// a test. The loyalty ladder in particular decides how much each purchase lot
// earns purely from its age, which is impossible to eyeball in production.
//
// Sections:
//   A. Who gets paid            B. The 10-day hold gate
//   C. Loyalty ladder           D. Cohort self-heal
//   E. DRIP                     F. Bookkeeping

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

const admin = require('../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

// Loaded AFTER initializeApp so their top-level admin.firestore() binds to the emulator.
const { runDividendPayoutNow } = require('../functions/services/dividends');
const { ADMIN_UID } = require('../functions/constants');
const {
  CHARACTERS, computeRarityTiers, getDividendRate, dividendWeightedShares,
  dividendMultiplierForAgeMs, DIVIDEND_HOLD_MS, DIVIDEND_LOYALTY_LADDER,
  DIVIDEND_MATURE_MS, DIVIDEND_LADDER_EPOCH,
} = require('../functions/characters');

let failures = 0;
let checks = 0;
const check = (label, cond, detail = '') => {
  checks++;
  console.log(`${cond ? '  ✅' : '  ❌'} ${label}${cond ? '' : ' — ' + detail}`);
  if (!cond) failures++;
};
const near = (a, b, tol = 0.011) => Math.abs(a - b) < tol;
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

// A plain, non-ETF character so the tier maths is the ordinary path.
const T = 'SOPH';
const PRICE = 100;

/** A pending lot acquired `ageDays` ago. availableAt is acquisition + the hold. */
const lot = (shares, ageDays) => ({
  shares,
  availableAt: NOW - ageDays * DAY + DIVIDEND_HOLD_MS,
});

async function seed(uid, { holdings, cohorts, drip, extra = {} } = {}) {
  await db.collection('users').doc(uid).set({
    displayName: uid,
    cash: 1000,
    holdings: holdings || {},
    costBasis: {},
    shorts: {},
    ...(cohorts ? { holdingCohorts: cohorts } : {}),
    ...(drip ? { drip } : {}),
    ...extra,
  });
}
const getUser = async (uid) => (await db.collection('users').doc(uid).get()).data();
const cashOf = async (uid) => (await getUser(uid)).cash;

async function main() {
  console.log('\n=== Dividend money-path suite (emulator) ===');

  // Payouts price from the pre-halt snapshot, NOT live market prices.
  await db.collection('market').doc('preHaltSnapshot').set({ prices: { [T]: PRICE } });
  // Deliberately different, so anything reading the wrong doc shows up.
  await db.collection('market').doc('current').set({ prices: { [T]: PRICE * 5 } }, { merge: true });

  const rarityTiers = computeRarityTiers(CHARACTERS, { [T]: PRICE });
  const RATE = getDividendRate(T, rarityTiers, {});
  console.log(`  (${T} at $${PRICE}, weekly rate ${(RATE * 100).toFixed(2)}%)`);

  const expected = (weighted) => Math.round(weighted * PRICE * RATE * 100) / 100;

  // ── A. Who gets paid ──────────────────────────────────────────────────────
  console.log('\nA. Who gets paid');

  await seed('div_bot', {
    holdings: { [T]: 1000 }, cohorts: { [T]: { eligible: 1000, pending: [] } },
    extra: { isBot: true },
  });
  await seed('div_empty', { holdings: {} });
  await seed('div_holder', {
    holdings: { [T]: 100 }, cohorts: { [T]: { eligible: 0, pending: [lot(100, 30)] } },
  });
  // Holds a ticker with no price in the snapshot: nothing to value, nothing paid.
  await seed('div_unpriced', {
    holdings: { GHOSTTICKER: 500 },
    cohorts: { GHOSTTICKER: { eligible: 500, pending: [] } },
  });

  const botCashBefore = await cashOf('div_bot');
  await runDividendPayoutNow.run({}, { auth: { uid: ADMIN_UID } });

  check('a bot is skipped entirely', (await cashOf('div_bot')) === botCashBefore);
  check('an account holding nothing is paid nothing', (await cashOf('div_empty')) === 1000);
  check('a holder is paid', (await cashOf('div_holder')) > 1000);
  check('a holding with no snapshot price pays nothing',
    (await cashOf('div_unpriced')) === 1000);

  check('a non-admin cannot trigger a payout',
    await (async () => {
      try { await runDividendPayoutNow.run({}, { auth: { uid: 'div_holder' } }); return false; }
      catch (e) { return /admin/i.test(e.message); }
    })());

  // ── B. The 10-day hold gate ───────────────────────────────────────────────
  console.log('\nB. The 10-day hold gate');

  await seed('div_fresh', {
    holdings: { [T]: 100 }, cohorts: { [T]: { eligible: 0, pending: [lot(100, 2)] } },
  });
  await seed('div_justin', {
    holdings: { [T]: 100 }, cohorts: { [T]: { eligible: 0, pending: [lot(100, 11)] } },
  });
  await runDividendPayoutNow.run({}, { auth: { uid: ADMIN_UID } });

  check('shares bought two days ago earn nothing', (await cashOf('div_fresh')) === 1000,
    `cash=${await cashOf('div_fresh')}`);
  check('shares past the 10-day gate start earning',
    near((await cashOf('div_justin')) - 1000, expected(100)), `cash=${await cashOf('div_justin')}`);
  check('a blocked lot is still recorded as pending, not dropped',
    ((await getUser('div_fresh')).holdingCohorts[T].pending || []).length === 1);

  // ── C. Loyalty ladder ─────────────────────────────────────────────────────
  console.log('\nC. Loyalty ladder');

  const rungs = [...DIVIDEND_LOYALTY_LADDER].sort((a, b) => a.minDays - b.minDays);
  const top = rungs[rungs.length - 1];
  // Rungs BELOW full maturity stay pending, so a payout shows their multiplier
  // directly. A lot at or past maturity is folded into `eligible` first, and
  // eligible is aged from the ladder epoch rather than from the lot — see the
  // invariant check below for why that is safe.
  const payoutRungs = rungs.filter((r) => r.minDays < top.minDays);
  for (const rung of payoutRungs) {
    await seed(`div_rung_${rung.minDays}`, {
      holdings: { [T]: 100 },
      cohorts: { [T]: { eligible: 0, pending: [lot(100, rung.minDays + 1)] } },
    });
  }
  await seed('div_mature', {
    holdings: { [T]: 100 },
    cohorts: { [T]: { eligible: 0, pending: [lot(100, top.minDays + 1)] } },
  });
  await runDividendPayoutNow.run({}, { auth: { uid: ADMIN_UID } });

  for (const rung of payoutRungs) {
    const paid = (await cashOf(`div_rung_${rung.minDays}`)) - 1000;
    check(`a ${rung.minDays}-day lot pays the ${rung.multiplier}x rung`,
      near(paid, expected(100 * rung.multiplier)),
      `paid=${paid} expected=${expected(100 * rung.multiplier)}`);
  }

  check(`the ladder tops out at ${top.multiplier}x for a ${top.minDays}-day lot`,
    dividendWeightedShares({ eligible: 0, pending: [lot(100, top.minDays + 1)] }, NOW) === 100 * top.multiplier);
  check('the longest hold earns more than the shortest',
    expected(100 * top.multiplier) > expected(100 * rungs[0].multiplier));

  const matured = await getUser('div_mature');
  check('a fully matured lot is folded into eligible',
    (matured.holdingCohorts[T].eligible || 0) === 100 &&
    (matured.holdingCohorts[T].pending || []).length === 0,
    JSON.stringify(matured.holdingCohorts[T]));

  // The sharp edge worth guarding. Folding a matured lot into `eligible` throws
  // its real age away — eligible is aged from DIVIDEND_LADDER_EPOCH instead,
  // because pre-ladder shares have no known purchase date. So a graduate could
  // in principle be DEMOTED by graduating. What stops that is a date
  // relationship: eligible reaches the top rung before any real lot can possibly
  // mature. Nobody would notice that breaking, so it is asserted rather than
  // trusted. Move the epoch forward and this fails.
  const eligibleAge = NOW - (DIVIDEND_LADDER_EPOCH - DIVIDEND_HOLD_MS);
  const earliestRealMaturity = DIVIDEND_LADDER_EPOCH + DIVIDEND_MATURE_MS;
  check('graduating a lot can never demote it: eligible hits the top rung first',
    dividendMultiplierForAgeMs(eligibleAge) === top.multiplier || NOW < earliestRealMaturity,
    `eligible is ${(eligibleAge / DAY).toFixed(0)}d (${dividendMultiplierForAgeMs(eligibleAge)}x) and real lots mature from ${new Date(earliestRealMaturity).toISOString().slice(0, 10)}`);

  // Mixed lots are weighted per lot, not averaged across the position.
  await seed('div_mixed', {
    holdings: { [T]: 200 },
    cohorts: { [T]: { eligible: 0, pending: [lot(100, 12), lot(100, 30)] } },
  });
  await runDividendPayoutNow.run({}, { auth: { uid: ADMIN_UID } });
  const mixedWeighted = 100 * 1.0 + 100 * 1.25;
  check('a mixed position is weighted lot by lot, not averaged',
    near((await cashOf('div_mixed')) - 1000, expected(mixedWeighted)),
    `paid=${(await cashOf('div_mixed')) - 1000} expected=${expected(mixedWeighted)}`);

  // ── D. Cohort self-heal ───────────────────────────────────────────────────
  console.log('\nD. Cohort self-heal');

  // Holdings above the cohort sum (an admin edit, or the backfill not yet run):
  // the unexplained shares must enter a FRESH pending bucket, never pay at once.
  await seed('div_extra', {
    holdings: { [T]: 300 }, cohorts: { [T]: { eligible: 0, pending: [lot(100, 30)] } },
  });
  // Holdings below the cohort sum: trim, and never pay on shares not held.
  await seed('div_short', {
    holdings: { [T]: 50 }, cohorts: { [T]: { eligible: 200, pending: [] } },
  });
  await runDividendPayoutNow.run({}, { auth: { uid: ADMIN_UID } });

  const extraUser = await getUser('div_extra');
  const extraCohort = extraUser.holdingCohorts[T];
  const extraSum = (extraCohort.eligible || 0) + (extraCohort.pending || []).reduce((s, p) => s + p.shares, 0);
  check('unexplained shares are added to the cohort', near(extraSum, 300), `sum=${extraSum}`);
  check('and they earn nothing this run — no retroactive dividends',
    near((await cashOf('div_extra')) - 1000, expected(100 * 1.25)),
    `paid=${(await cashOf('div_extra')) - 1000}`);

  const shortUser = await getUser('div_short');
  const shortCohort = shortUser.holdingCohorts[T];
  const shortSum = (shortCohort.eligible || 0) + (shortCohort.pending || []).reduce((s, p) => s + p.shares, 0);
  check('a cohort larger than the holding is trimmed down to it', near(shortSum, 50), `sum=${shortSum}`);
  check('and pays only on the shares actually held',
    (await cashOf('div_short')) - 1000 <= expected(50 * 1.5) + 0.01,
    `paid=${(await cashOf('div_short')) - 1000}`);

  // ── E. DRIP ───────────────────────────────────────────────────────────────
  console.log('\nE. DRIP');

  await seed('div_drip', {
    holdings: { [T]: 100 },
    cohorts: { [T]: { eligible: 0, pending: [lot(100, 30)] } },
    drip: { [T]: true },
  });
  await runDividendPayoutNow.run({}, { auth: { uid: ADMIN_UID } });

  const dripUser = await getUser('div_drip');
  const payout = expected(100 * 1.25);
  const sharesAdded = Math.floor((payout / PRICE) * 100) / 100;
  check('DRIP buys shares instead of paying cash',
    near(dripUser.holdings[T], 100 + sharesAdded), `holdings=${dripUser.holdings[T]}`);
  check('the sub-share remainder is still paid as cash',
    near(dripUser.cash - 1000, Math.round((payout - sharesAdded * PRICE) * 100) / 100),
    `cash=${dripUser.cash}`);
  const dripPending = dripUser.holdingCohorts[T].pending || [];
  check('reinvested shares enter pending, so they cannot earn again immediately',
    dripPending.some((p) => near(p.shares, sharesAdded)), JSON.stringify(dripPending));
  check('the reinvestment is recorded on the trade row',
    (await db.collection('trades').where('uid', '==', 'div_drip').get())
      .docs.some((d) => d.data().reinvested), 'no reinvested breakdown found');

  // ── F. Bookkeeping ────────────────────────────────────────────────────────
  console.log('\nF. Bookkeeping');

  const holderTrades = await db.collection('trades').where('uid', '==', 'div_holder').get();
  check('a payout writes a trade row so it shows in trade history',
    holderTrades.docs.some((d) => d.data().action === 'dividend'));
  const holderDoc = await getUser('div_holder');
  check('and a DIVIDEND entry on the transaction log',
    (holderDoc.transactionLog || []).some((e) => e.type === 'DIVIDEND'));
  check('the log entry breaks the payout down by ticker',
    (holderDoc.transactionLog || []).some((e) => e.breakdown && e.breakdown[T] > 0));

  const runs = await db.collection('dividendConfig').doc('runs').collection('log').get();
  check('every run is logged for the admin readout', runs.size >= 1, `runs=${runs.size}`);
  check('the run log records who triggered it',
    runs.docs.every((d) => d.data().source === 'manual-admin'));

  // market/current is seeded at 5x the snapshot, so a payout that read the wrong
  // doc would be obvious. Checked on a user seeded fresh for this one run —
  // everyone above has been through several by now.
  await seed('div_price', {
    holdings: { [T]: 100 }, cohorts: { [T]: { eligible: 0, pending: [lot(100, 11)] } },
  });
  await runDividendPayoutNow.run({}, { auth: { uid: ADMIN_UID } });
  check('payouts price from the pre-halt snapshot, not the live market',
    near((await cashOf('div_price')) - 1000, expected(100)),
    `paid=${(await cashOf('div_price')) - 1000}, a live-price read would pay 5x`);

  console.log(`\n${checks} checks run.`);
  console.log(failures === 0 ? 'ALL DIVIDEND CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error('Suite crashed:', err); process.exit(1); });
