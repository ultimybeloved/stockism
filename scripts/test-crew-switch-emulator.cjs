'use strict';
// switchCrew against the LOCAL Firebase emulator. Never touches production.
//
// Run via: npm run test:crewswitch
//
// This path moves real portfolio value, so the two directions both matter: a
// normal switch must take exactly CREW_SWITCH_PENALTY of cash AND shares and
// stamp the 30-day lockout, while a free-switch-event move must take nothing
// and leave no lockout behind. Getting either wrong either robs players or
// hands everyone free switches.

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

const admin = require('../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

const { switchCrew } = require('../functions/services/crew');
const { CREW_SWITCH_PENALTY, CREW_REJOIN_LOCKOUT_MS } = require('../functions/constants');
const { CREW_SWITCH_EVENT, isFreeSwitchTarget } = require('../functions/crews');

const EVENT_CREW = CREW_SWITCH_EVENT?.crewId;
const PAID_CREW = 'YAMAZAKI';   // no event running on this one
const FROM_CREW = 'WORKERS';
const TICKER = 'GUN';

let failures = 0;
const check = (label, cond, detail = '') => {
  console.log(`${cond ? '  ✅' : '  ❌'} ${label}${cond ? '' : ' — ' + detail}`);
  if (!cond) failures++;
};

const ctx = (uid) => ({ auth: { uid }, rawRequest: { ip: '203.0.113.9' } });
const call = (data, uid) => switchCrew.run(data, ctx(uid));
const err = async (data, uid) => {
  try { await call(data, uid); return null; }
  catch (e) { return e.message || String(e); }
};

const seedUser = async (uid, extra = {}) => {
  await db.collection('users').doc(uid).set({
    displayName: uid,
    cash: 1000,
    holdings: { [TICKER]: 100 },
    portfolioValue: 9500,
    crew: FROM_CREW,
    ...extra,
  });
};
const readUser = async (uid) => (await db.collection('users').doc(uid).get()).data();

async function main() {
  if (!EVENT_CREW) throw new Error('No CREW_SWITCH_EVENT configured — nothing to test');
  if (!isFreeSwitchTarget(EVENT_CREW)) {
    console.log(`\n⚠️  The free-switch window for ${EVENT_CREW} has expired. Free-switch checks skipped.`);
  }

  await db.collection('market').doc('current').set({ prices: { [TICKER]: 85 } }, { merge: true });

  // ── 1. Free switch into the event crew ─────────────────────────────────
  if (isFreeSwitchTarget(EVENT_CREW)) {
    console.log(`\n1 — free switch into ${EVENT_CREW}`);
    await seedUser('cs_free');
    const res = await call({ crewId: EVENT_CREW }, 'cs_free');
    const u = await readUser('cs_free');

    check('reported as a free switch', res.freeSwitch === true && res.totalTaken === 0, JSON.stringify(res));
    check('crew actually changed', u.crew === EVENT_CREW, u.crew);
    check('cash untouched', u.cash === 1000, `cash=${u.cash}`);
    check('shares untouched', u.holdings[TICKER] === 100, `shares=${u.holdings[TICKER]}`);
    check('portfolio value untouched', u.portfolioValue === 9500, `pv=${u.portfolioValue}`);
    check('no lockout stamped on the old crew',
      !(u.crewLockouts || {})[FROM_CREW], JSON.stringify(u.crewLockouts || {}));
    check('cooldown still recorded', typeof u.lastCrewChange === 'number', String(u.lastCrewChange));
  }

  // ── 2. Normal switch still charges the penalty ──────────────────────────
  console.log(`\n2 — normal switch into ${PAID_CREW}`);
  await seedUser('cs_paid');
  const paidRes = await call({ crewId: PAID_CREW }, 'cs_paid');
  const paid = await readUser('cs_paid');

  const expectedCash = Math.floor(1000 * (1 - CREW_SWITCH_PENALTY));
  const expectedShares = Math.round((100 - Math.round(100 * CREW_SWITCH_PENALTY * 100) / 100) * 10000) / 10000;
  check('not reported as free', paidRes.freeSwitch === false, JSON.stringify(paidRes));
  check(`cash cut by ${CREW_SWITCH_PENALTY * 100}% (${expectedCash})`, paid.cash === expectedCash, `cash=${paid.cash}`);
  check(`shares cut to ${expectedShares}`, paid.holdings[TICKER] === expectedShares, `shares=${paid.holdings[TICKER]}`);
  check('something was actually taken', paidRes.totalTaken > 0, String(paidRes.totalTaken));
  const lock = (paid.crewLockouts || {})[FROM_CREW] || 0;
  check('30-day lockout stamped on the old crew',
    lock > Date.now() + CREW_REJOIN_LOCKOUT_MS - 60000, `lock=${lock}`);

  // ── 3. Switching to your own crew is rejected ───────────────────────────
  console.log('\n3 — switching to the crew you are already in');
  await seedUser('cs_same', { crew: EVENT_CREW });
  const sameErr = await err({ crewId: EVENT_CREW }, 'cs_same');
  check('rejected with a clear reason', !!sameErr && /already in this crew/i.test(sameErr), sameErr || 'no error');
  const same = await readUser('cs_same');
  check('nothing was taken on the rejected call', same.cash === 1000 && same.holdings[TICKER] === 100,
    `cash=${same.cash} shares=${same.holdings[TICKER]}`);
  check('no lockout stamped on their own crew',
    !(same.crewLockouts || {})[EVENT_CREW], JSON.stringify(same.crewLockouts || {}));

  // ── 4. The window is what gates it, not the crew alone ──────────────────
  console.log('\n4 — window boundary');
  check('free before endsAt', isFreeSwitchTarget(EVENT_CREW, CREW_SWITCH_EVENT.endsAt - 1) === true);
  check('not free at endsAt', isFreeSwitchTarget(EVENT_CREW, CREW_SWITCH_EVENT.endsAt) === false);
  check('not free after endsAt', isFreeSwitchTarget(EVENT_CREW, CREW_SWITCH_EVENT.endsAt + 1) === false);
  check('never free for another crew', isFreeSwitchTarget(PAID_CREW, Date.now()) === false);

  console.log(failures === 0 ? '\nALL CREW-SWITCH CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error('Test crashed:', err); process.exit(1); });
