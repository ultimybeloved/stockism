// End-to-end coordination enforcement against the LOCAL Firebase emulator.
// Never touches production.
//
//   npm run test:coord
//
// Seeds trade records the way executeTrade writes them, runs the scan, and
// checks what it does: the alert, the 48h group block on a tight downward
// cluster (and not on a loose one, or on someone who only traded alone), the
// "all in on borrowed money" flag on an upward cluster, and the admin tools
// that measure and remove what a push made.

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';
// Never DM the real admin from a test.
process.env.ADMIN_DISCORD_USER_ID = '';

const admin = require('../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

const { triggerCoordScan } = require('../functions/services/coordDetection');
const { getCoordProfit, adminRemoveCoordProfit } = require('../functions/services/coordReview');
const { washRuleRemainingMs, shortAfterDumpRemainingMs } = require('../functions/helpers');
const { ADMIN_UID } = require('../functions/constants');

const adminCtx = { auth: { uid: ADMIN_UID } };
const MIN = 60000;
const H = 60 * MIN;

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ''}`); }
};
const user = async (uid) => (await db.collection('users').doc(uid).get()).data();

// Clusters are grouped by UTC day, so everything is placed early in today.
const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
const base = Math.min(Date.now() - 2 * H, dayStart.getTime() + 60 * MIN);

const trade = (uid, ticker, action, amount, price, impact, at) => db.collection('trades').add({
  uid, ticker, action, amount, price, totalValue: amount * price, priceImpact: impact,
  timestamp: admin.firestore.Timestamp.fromMillis(at),
});

const run = async () => {
  await db.collection('market').doc('current').set({ prices: { SHNG: 200, JYNG: 330, GOO: 50 } });
  const users = {
    // Holds 30 SHNG ($6,000 at 200) and 10 GOO; a sliver of cohort bookkeeping.
    raidA: { cash: 1000, holdings: { SHNG: 30, GOO: 10 }, costBasis: { SHNG: 180, GOO: 40 },
      holdingCohorts: { SHNG: { eligible: 30, pending: [] }, GOO: { eligible: 10, pending: [] } },
      portfolioValue: 7500, marginUsed: 0, marginEnabled: true },
    // Holds exactly $1,000 of SHNG, so taking $1,000 closes the position.
    closer: { cash: 0, holdings: { SHNG: 5 }, costBasis: { SHNG: 150 }, lowestWhileHolding: { SHNG: 140 },
      holdingCohorts: { SHNG: { eligible: 5, pending: [] } }, portfolioValue: 1000, marginEnabled: true },
    raidB: { cash: 0, holdings: {} },
    raidC: { cash: 0, holdings: {} },
    alone: { cash: 0, holdings: {} },
    looseG: { cash: 0, holdings: {} },
    looseH: { cash: 0, holdings: {} },
    // 90% of holdings in JYNG, 40% of gross borrowed.
    allinE: { cash: 0, holdings: { JYNG: 900, GOO: 200 }, portfolioValue: 307000, marginUsed: 122800 },
    spreadF: { cash: 0, holdings: { JYNG: 100, GOO: 2000 }, portfolioValue: 133000, marginUsed: 0 },
    small: { cash: 100, holdings: {}, portfolioValue: 1000, marginUsed: 600, marginEnabled: true },
  };
  const batch = db.batch();
  for (const [uid, u] of Object.entries(users)) batch.set(db.collection('users').doc(uid), { displayName: uid, ...u });
  await batch.commit();

  // Tight downward cluster on SHNG: three accounts inside 10 minutes.
  await trade('raidA', 'SHNG', 'sell', 100, 200, 0.05, base);
  await trade('raidB', 'SHNG', 'short', 50, 195, 0.04, base + 4 * MIN);
  await trade('raidC', 'SHNG', 'sell', 30, 190, 0.03, base + 9 * MIN);
  // raidA buys it back cheaper inside the window.
  await trade('raidA', 'SHNG', 'buy', 100, 150, 0.02, base + 50 * MIN);
  // Someone selling a stock hard, alone.
  await trade('alone', 'JYNG', 'sell', 10, 330, 0.05, base + 20 * MIN);
  // Loose downward cluster on GOO: same day, 50 minutes apart (not tight).
  await trade('looseG', 'GOO', 'sell', 10, 50, 0.05, base + 10 * MIN);
  await trade('looseH', 'GOO', 'sell', 10, 50, 0.05, base + 60 * MIN);
  // Upward cluster on JYNG.
  await trade('allinE', 'JYNG', 'buy', 900, 290, 0.05, base + 5 * MIN);
  await trade('spreadF', 'JYNG', 'buy', 100, 300, 0.04, base + 8 * MIN);

  console.log('\nA. Scan');
  const scan = await triggerCoordScan.run({}, adminCtx);
  check('scan found the clusters', scan.candidates >= 3, scan);
  const alerts = (await db.collection('watchlist_alerts').where('type', '==', 'coordinated_pressure').get()).docs.map((d) => d.data());
  const shng = alerts.find((a) => a.ticker === 'SHNG');
  check('SHNG alert written, tight, with its start time', shng?.tightCluster === true && typeof shng.startedAt === 'number'
    && shng.groupBlocked === true, shng);

  console.log('\nB. Group block');
  for (const uid of ['raidA', 'raidB', 'raidC']) {
    const u = await user(uid);
    check(`${uid}: buy-back blocked`, washRuleRemainingMs(u, 'SHNG') > 0, u.lastHeavySell);
    check(`${uid}: shorting blocked`, shortAfterDumpRemainingMs(u, 'SHNG') > 0, u.lastHeavyExit);
  }
  check('the block runs from their own last trade', Math.abs((await user('raidC')).lastHeavySell.SHNG.toMillis() - (base + 9 * MIN)) < 1000);
  check('a loose same-day cluster blocks nobody', !(await user('looseG')).lastHeavySell && !(await user('looseH')).lastHeavySell);
  check('selling alone is not caught by the group block', !(await user('alone')).lastHeavySell);
  check('an upward cluster blocks nobody', !(await user('allinE')).lastHeavySell);

  const rescan = await triggerCoordScan.run({}, adminCtx);
  check('re-running changes nothing already stamped', rescan.blocked === 0 && rescan.reported === 0, rescan);

  console.log('\nC. All in on borrowed money');
  const jyng = alerts.find((a) => a.ticker === 'JYNG');
  check('the all-in player is named on the pump alert', jyng?.allIn?.length === 1 && jyng.allIn[0].uid === 'allinE', jyng?.allIn);
  check('the alert text says so', /all in on borrowed money: allinE/.test(jyng?.details || ''), jyng?.details);

  console.log('\nD. What it made them');
  const p = await getCoordProfit.run({ uid: 'raidA' }, adminCtx);
  check('raidA: sold 100 at 200, bought back at 150 = $5,000 locked in', p.pushes.length === 1
    && p.pushes[0].lockedIn === 5000 && p.suggested === 5000, p);
  check('preview: 25 SHNG, no cash, no debt', p.preferTickers[0] === 'SHNG' && p.preview.shares.length === 1
    && p.preview.shares[0].ticker === 'SHNG' && p.preview.shares[0].shares === 25
    && p.preview.fromCash === 0 && p.preview.toDebt === 0, p.preview);

  let denied = null;
  try { await adminRemoveCoordProfit.run({ uid: 'raidA', amount: 5000, memo: 'x' }, { auth: { uid: 'raidB' } }); } catch (e) { denied = e.message; }
  check('only the admin can remove profit', /Admin only/.test(denied || ''), denied);

  let noMemo = null;
  try { await adminRemoveCoordProfit.run({ uid: 'raidA', amount: 5000 }, adminCtx); } catch (e) { noMemo = e.message; }
  check('a memo is required', /memo/i.test(noMemo || ''), noMemo);

  const pre = await adminRemoveCoordProfit.run({ uid: 'raidA', amount: 5000, preview: true, preferTickers: p.preferTickers }, adminCtx);
  check('preview changes nothing', pre.preview === true && (await user('raidA')).holdings.SHNG === 30, pre);
  const priceBefore = (await db.collection('market').doc('current').get()).data().prices.SHNG;

  const done = await adminRemoveCoordProfit.run({ uid: 'raidA', amount: 5000, memo: 'test raid', preferTickers: p.preferTickers }, adminCtx);
  const a = await user('raidA');
  check('25 SHNG taken; cash, GOO and debt untouched', a.holdings.SHNG === 5 && a.holdings.GOO === 10 && a.cash === 1000
    && a.marginUsed === 0 && done.toDebt === 0, { holdings: a.holdings, cash: a.cash, marginUsed: a.marginUsed });
  check('dividend lots shrink with the shares', a.holdingCohorts.SHNG.eligible === 5, a.holdingCohorts);
  check('stored value drops by what was taken', a.portfolioValue === 2500, a.portfolioValue);
  check('the price does not move', (await db.collection('market').doc('current').get()).data().prices.SHNG === priceBefore);
  const logs = (await db.collection('adminCashLog').where('userId', '==', 'raidA').get()).docs.map((d) => d.data());
  check('logged with the memo', logs.length === 1 && logs[0].mode === 'remove_coord_profit' && logs[0].memo === 'test raid', logs);
  const notes = (await db.collection('users').doc('raidA').collection('notifications').get()).docs.map((d) => d.data());
  check('the player is told the amount and the shares, not the memo', notes.length === 1 && /\$5,000/.test(notes[0].message)
    && /25 \$SHNG/.test(notes[0].message)
    && !/test raid/.test(notes[0].message) && notes[0].title === 'Profit removed', notes);

  await adminRemoveCoordProfit.run({ uid: 'closer', amount: 1000, memo: 'close', preferTickers: ['SHNG'] }, adminCtx);
  const c = await user('closer');
  check('taking a whole position leaves nothing behind', c.holdings.SHNG === undefined && c.costBasis.SHNG === undefined
    && c.lowestWhileHolding.SHNG === undefined && c.holdingCohorts.SHNG === undefined, c);

  let tooMuch = null;
  try { await adminRemoveCoordProfit.run({ uid: 'small', amount: 200, memo: 'x' }, adminCtx); } catch (e) { tooMuch = e.message; }
  check('refused when it would force a sale', /forced-sale/.test(tooMuch || ''), tooMuch);
  check('...and nothing changed', (await user('small')).marginUsed === 600);

  let noMargin = null;
  try { await adminRemoveCoordProfit.run({ uid: 'raidB', amount: 10, memo: 'x' }, adminCtx); } catch (e) { noMargin = e.message; }
  check('refused past their cash when margin is off', /margin is off/.test(noMargin || ''), noMargin);

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll coordination checks passed.');
  process.exit(failures ? 1 : 0);
};

run().catch((e) => { console.error(e); process.exit(1); });
