'use strict';
// End-to-end test of the long-term event-share market, run entirely against the
// LOCAL emulators. Drives the real Cloud Functions (buyEventShares /
// sellEventShares / triggerEventSettlements) exactly as the UI would, and an
// admin Firestore write for create/resolve exactly as the admin panel does.
// Never touches production. Run with emulators up: node scripts/test-event-market.cjs

// Defaults match firebase.json, but emulators:exec sets these itself — don't
// stomp on what it chose or the suite silently talks to the wrong ports.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';
const [AUTH_HOST, AUTH_PORT] = process.env.FIREBASE_AUTH_EMULATOR_HOST.split(':');
const FUNCTIONS_PORT = Number(process.env.FUNCTIONS_EMULATOR_PORT || 5001);

const admin = require('firebase-admin');
const { initializeApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require('firebase/functions');
const { EVENT_AMM_LIQUIDITY } = require('../functions/constants');

// LMSR price formula, inlined (identical to functions/helpers.js + frontend).
// Inlined here only to avoid helpers.js's load-time admin.firestore() call.
const lmsrPrices = (q, b) => {
  const xs = q.map((x) => x / b);
  const m = Math.max(...xs);
  const ex = xs.map((x) => Math.exp(x - m));
  const sum = ex.reduce((a, c) => a + c, 0);
  return ex.map((e) => e / sum);
};

const ADMIN_UID = '4usiVxPmHLhmitEKH2HfCpbx4Yi1';
const PROJECT = 'stockism-abb28';
const pass = (m) => console.log(`  ✅ ${m}`);
const fail = (m) => { console.log(`  ❌ ${m}`); process.exitCode = 1; };
const r2 = (n) => Math.round(n * 100) / 100;

admin.initializeApp({ projectId: PROJECT });
const adb = admin.firestore();
const aauth = admin.auth();

const clientApp = initializeApp({ projectId: PROJECT, apiKey: 'fake-emulator-key', authDomain: `${PROJECT}.firebaseapp.com` });
const auth = getAuth(clientApp);
connectAuthEmulator(auth, `http://${AUTH_HOST}:${AUTH_PORT}`, { disableWarnings: true });
const fns = getFunctions(clientApp);
connectFunctionsEmulator(fns, '127.0.0.1', FUNCTIONS_PORT);

const marketId = `evt_test_${Date.now()}`;

async function ensureUser(uid, email) {
  try { await aauth.getUser(uid); } catch { await aauth.createUser({ uid, email, password: 'test123456' }); }
}

async function readMarket() {
  const snap = await adb.collection('predictions').doc('current').get();
  return (snap.data().list || []).find(m => m.id === marketId);
}

async function main() {
  console.log('\n=== Event-market end-to-end test (emulator) ===\n');

  // Setup: an admin user, a tester user, a tester user-doc with cash, and a market doc.
  await ensureUser(ADMIN_UID, 'admin@test.local');
  await ensureUser('tester1', 'tester@test.local');
  // Holdings are NOT decoration. Event-market exposure is capped at what a player
  // has invested in stocks (added 2026-06-21, after this test was written), so a
  // fixture with an empty holdings map fails on the very first buy. That is what
  // had this suite dead: it was never wired into package.json, so nobody saw it.
  await adb.collection('users').doc('tester1').set({
    cash: 10000, holdings: { JAY: 200 }, costBasis: { JAY: 50 }, shorts: {},
    achievements: [], predictionWins: 0, createdAt: Date.now(),
  });
  // Two more fixtures for the cap itself, which nothing tested.
  await ensureUser('tester_nostock', 'nostock@test.local');
  await adb.collection('users').doc('tester_nostock').set({
    cash: 10000, holdings: {}, costBasis: {}, shorts: {}, achievements: [], predictionWins: 0, createdAt: Date.now(),
  });
  await ensureUser('tester_small', 'small@test.local');
  await adb.collection('users').doc('tester_small').set({
    cash: 10000, holdings: { JAY: 1 }, costBasis: { JAY: 20 }, shorts: {},
    achievements: [], predictionWins: 0, createdAt: Date.now(),
  });
  await adb.collection('market').doc('current').set({ marketHalted: false, prices: {}, launchedTickers: [] }, { merge: true });

  // 1) Admin creates the long-term market (same shape the admin panel writes).
  const predRef = adb.collection('predictions').doc('current');
  const existing = (await predRef.get()).data()?.list || [];
  await predRef.set({ list: [...existing, {
    id: marketId, type: 'event', question: 'TEST - will X happen?',
    outcomes: ['Yes', 'No'], options: ['Yes', 'No'],
    q: [0, 0], b: EVENT_AMM_LIQUIDITY, seededLiquidity: EVENT_AMM_LIQUIDITY,
    volume: 0, createdAt: Date.now(), resolved: false, outcome: null, settled: false,
  }] }, { merge: true });
  const created = await readMarket();
  created ? pass('market created, starts at 50/50') : fail('market not created');
  const p0 = lmsrPrices(created.q, created.b);
  Math.abs(p0[0] - 0.5) < 1e-6 ? pass(`Yes price = ${(p0[0] * 100).toFixed(1)}¢`) : fail(`Yes price wrong: ${p0[0]}`);

  // 2) Tester buys 100 Yes — price should rise, cash should fall by the cost.
  await signInWithEmailAndPassword(auth, 'tester@test.local', 'test123456');
  const buy = httpsCallable(fns, 'buyEventShares');
  const cashBefore = (await adb.collection('users').doc('tester1').get()).data().cash;
  const buyRes = (await buy({ marketId, outcome: 'Yes', shares: 100 })).data;
  const afterBuy = await readMarket();
  const userAfterBuy = (await adb.collection('users').doc('tester1').get()).data();
  const pBuy = lmsrPrices(afterBuy.q, afterBuy.b);
  pBuy[0] > 0.5 ? pass(`buy 100 Yes → Yes rose to ${(pBuy[0] * 100).toFixed(1)}¢ (cost $${buyRes.cost})`) : fail('price did not rise after buy');
  Math.abs(userAfterBuy.cash - r2(cashBefore - buyRes.cost)) < 0.02 ? pass(`cash fell correctly to $${userAfterBuy.cash}`) : fail(`cash mismatch: ${userAfterBuy.cash}`);
  (userAfterBuy.eventPositions?.[marketId]?.shares?.Yes === 100) ? pass('position records 100 Yes shares') : fail('position not recorded');

  // 3) Tester sells 50 back — price eases, cash returns.
  const sell = httpsCallable(fns, 'sellEventShares');
  const sellRes = (await sell({ marketId, outcome: 'Yes', shares: 50 })).data;
  const afterSell = await readMarket();
  const userAfterSell = (await adb.collection('users').doc('tester1').get()).data();
  const pSell = lmsrPrices(afterSell.q, afterSell.b);
  pSell[0] < pBuy[0] ? pass(`sell 50 Yes → Yes eased to ${(pSell[0] * 100).toFixed(1)}¢ (refund $${sellRes.refund})`) : fail('price did not ease after sell');
  (userAfterSell.eventPositions?.[marketId]?.shares?.Yes === 50) ? pass('position now 50 Yes shares') : fail('position not decremented');

  // 3b) Announce-before-open gate: a market with opensAt in the future rejects
  //     buys; once opensAt has passed, buying is allowed. (tester1 still signed in)
  const timerId = `evt_timer_${Date.now()}`;
  const baseList = (await predRef.get()).data().list;
  await predRef.set({ list: [...baseList, {
    id: timerId, type: 'event', question: 'TEST - announced market?',
    outcomes: ['Yes', 'No'], options: ['Yes', 'No'],
    q: [0, 0], b: EVENT_AMM_LIQUIDITY, seededLiquidity: EVENT_AMM_LIQUIDITY,
    volume: 0, createdAt: Date.now(), resolved: false, outcome: null, settled: false,
    opensAt: Date.now() + 60 * 60 * 1000, // opens in 1h
  }] }, { merge: true });
  let blocked = false;
  try { await buy({ marketId: timerId, outcome: 'Yes', shares: 10 }); }
  catch (e) { blocked = /not open/i.test(e.message); }
  blocked ? pass('buy rejected while market is announced but not yet open') : fail('buy was NOT blocked before open');

  const openedList = (await predRef.get()).data().list.map(m =>
    m.id === timerId ? { ...m, opensAt: Date.now() - 1000 } : m);
  await predRef.set({ list: openedList }, { merge: true });
  let openedOk = false;
  try { openedOk = (await buy({ marketId: timerId, outcome: 'Yes', shares: 10 })).data.success === true; }
  catch (e) { openedOk = false; }
  openedOk ? pass('buy allowed once opensAt has passed') : fail('buy still blocked after open time');

  // 3c) The invested-value cap. Every value-farming side game is capped at what
  //      the player has put into stocks, server-side, so the AMM can't be farmed
  //      by a barely-invested account. Both halves of that gate are checked.
  await auth.signOut();
  await signInWithEmailAndPassword(auth, 'nostock@test.local', 'test123456');
  let gated = false;
  try { await buy({ marketId, outcome: 'Yes', shares: 20 }); }
  catch (e) { gated = /invest in stocks/i.test(e.message); }
  gated ? pass('buy rejected for a player with nothing invested') : fail('uninvested player was allowed to buy');

  await auth.signOut();
  await signInWithEmailAndPassword(auth, 'small@test.local', 'test123456');
  let capped = false;
  try { await buy({ marketId, outcome: 'Yes', shares: 200 }); } // ~$100 against $20 invested
  catch (e) { capped = /capped at what you've invested/i.test(e.message); }
  capped ? pass('buy rejected when it would exceed the invested-value cap') : fail('cap did not hold');

  let underCap = false;
  try { underCap = (await buy({ marketId, outcome: 'Yes', shares: 10 })).data.success === true; }
  catch (e) { underCap = false; }
  underCap ? pass('a buy inside the cap still goes through') : fail('buy inside the cap was wrongly rejected');

  await auth.signOut();
  await signInWithEmailAndPassword(auth, 'tester@test.local', 'test123456');

  // 4) Admin resolves Yes, then settles. Winners redeem at $1/share.
  const list = (await predRef.get()).data().list.map(m => m.id === marketId ? { ...m, resolved: true, outcomes: ['Yes'], outcome: 'Yes' } : m);
  await predRef.set({ list }, { merge: true });
  await auth.signOut();
  await signInWithEmailAndPassword(auth, 'admin@test.local', 'test123456');
  const cashBeforeSettle = (await adb.collection('users').doc('tester1').get()).data().cash;
  const settle = httpsCallable(fns, 'triggerEventSettlements');
  const settleRes = (await settle({})).data;
  settleRes.settled >= 1 ? pass(`settlement ran (${settleRes.settled} market settled)`) : fail('settlement did not run');

  const finalUser = (await adb.collection('users').doc('tester1').get()).data();
  const expectedPayout = 50; // 50 Yes shares × $1
  const pos = finalUser.eventPositions?.[marketId];
  Math.abs((pos?.payout || 0) - expectedPayout) < 0.01 ? pass(`paid out $${pos.payout} for 50 winning shares`) : fail(`payout wrong: ${pos?.payout}`);
  pos?.settled === true ? pass('position marked settled') : fail('position not settled');
  Math.abs(finalUser.cash - r2(cashBeforeSettle + expectedPayout)) < 0.02 ? pass(`final cash credited to $${finalUser.cash}`) : fail(`final cash mismatch: ${finalUser.cash}`);
  (finalUser.achievements || []).includes('TRUE_BELIEVER') ? pass('True Believer achievement awarded') : fail('achievement not awarded');
  finalUser.predictionWins === 1 ? pass('predictionWins incremented (feeds Oracle/Prophet)') : fail(`predictionWins = ${finalUser.predictionWins}`);

  console.log('\n=== Test complete ===\n');
  process.exit(process.exitCode || 0);
}

main().catch(e => { console.error('TEST ERROR:', e.message); process.exit(1); });
