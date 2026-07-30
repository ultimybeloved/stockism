'use strict';
// End-to-end test of loyalty tier-up notifications inside syncAllPortfolios,
// against the LOCAL Firebase emulator. Never touches production.
//
// Run via: npm run test:loyalty
//
// This path is worth pinning down because the failure mode is loud: a mistake
// here spams a notification to every player on the site, every single day.
//
// Scenarios covered:
//   1. A never-scanned user is seeded silently (no notification on deploy day)
//   2. A user whose lot aged past a rung gets exactly one notification
//   3. Re-running the same day adds nothing
//   4. Two tickers crossing in one run collapse into a single digest
//   5. Bots are never notified
//   6. Selling the old shares lowers the stored tier silently
//   7. Dust below the share floor doesn't trigger anything

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

const admin = require('../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

const { syncAllPortfolios } = require('../functions/services/archiving');
const { DIVIDEND_HOLD_MS, DIVIDEND_HOLD_DAYS, LOYALTY_NOTIFY_MIN_SHARES } = require('../functions/characters');

const DAY = 24 * 60 * 60 * 1000;
const T1 = 'SOPH';
const T2 = 'CROC';

let failures = 0;
const check = (label, cond, detail = '') => {
  console.log(`${cond ? '  ✅' : '  ❌'} ${label}${cond ? '' : ' — ' + detail}`);
  if (!cond) failures++;
};

// A pending lot that is `ageDays` old right now
const agedLot = (shares, ageDays) => ({ shares, availableAt: Date.now() - ageDays * DAY + DIVIDEND_HOLD_MS });

const setUser = (uid, data) => db.collection('users').doc(uid).set({ displayName: uid, cash: 0, ...data });
const getUser = async (uid) => (await db.collection('users').doc(uid).get()).data();
const notes = async (uid) =>
  (await db.collection('users').doc(uid).collection('notifications').get()).docs.map(d => d.data());
const clearNotes = async (uid) => {
  const snap = await db.collection('users').doc(uid).collection('notifications').get();
  await Promise.all(snap.docs.map(d => d.ref.delete()));
};

const runSync = () => syncAllPortfolios.run({});

async function main() {
  // Prices so portfolio value is computable; the sync bails without a market doc.
  await db.collection('market').doc('current').set({ prices: { [T1]: 50, [T2]: 80 } }, { merge: true });

  // ── Seed ────────────────────────────────────────────────────────────────
  // Everyone below already qualifies for a tier. None has been scanned before,
  // so pass 1 must stay silent for all of them.
  await setUser('loy_seed', {
    holdings: { [T1]: 100 },
    holdingCohorts: { [T1]: { eligible: 0, pending: [agedLot(100, 60)] } },
  });
  await setUser('loy_climber', {
    holdings: { [T1]: 100 },
    holdingCohorts: { [T1]: { eligible: 0, pending: [agedLot(100, 30)] } },
  });
  await setUser('loy_double', {
    holdings: { [T1]: 100, [T2]: 40 },
    holdingCohorts: {
      [T1]: { eligible: 0, pending: [agedLot(100, 60)] },
      [T2]: { eligible: 0, pending: [agedLot(40, 30)] },
    },
  });
  await setUser('loy_bot', {
    isBot: true,
    holdings: { [T1]: 100 },
    holdingCohorts: { [T1]: { eligible: 0, pending: [agedLot(100, 60)] } },
  });
  await setUser('loy_dust', {
    holdings: { [T1]: LOYALTY_NOTIFY_MIN_SHARES / 2 },
    holdingCohorts: { [T1]: { eligible: 0, pending: [agedLot(LOYALTY_NOTIFY_MIN_SHARES / 2, 60)] } },
  });

  // ── 1. First pass seeds silently ────────────────────────────────────────
  console.log('\nPass 1 (first ever scan)\n');
  const first = await runSync();
  check('first scan sends no notifications', first.loyaltyNotified === 0, JSON.stringify(first));

  for (const uid of ['loy_seed', 'loy_climber', 'loy_double']) {
    const n = await notes(uid);
    check(`${uid}: silent on the first scan`, n.length === 0, JSON.stringify(n));
  }
  const seeded = await getUser('loy_seed');
  check('first scan still records where they stand',
    seeded.loyaltyTierNotified?.[T1] === 56, JSON.stringify(seeded.loyaltyTierNotified));
  const dustUser = await getUser('loy_dust');
  check('dust below the share floor records no tier',
    !dustUser.loyaltyTierNotified?.[T1], JSON.stringify(dustUser.loyaltyTierNotified));

  // ── 2. Pass 2 with nothing changed ──────────────────────────────────────
  console.log('\nPass 2 (nothing aged)\n');
  const second = await runSync();
  check('a quiet day notifies nobody', second.loyaltyNotified === 0, JSON.stringify(second));
  check('loy_seed still has no notifications', (await notes('loy_seed')).length === 0);

  // ── 3. A holding crosses a rung ─────────────────────────────────────────
  // Rewind the stored tier to simulate the climber crossing overnight.
  console.log('\nPass 3 (climber crosses 4 weeks)\n');
  await db.collection('users').doc('loy_climber')
    .update({ loyaltyTierNotified: { [T1]: DIVIDEND_HOLD_DAYS } });
  const third = await runSync();

  const climberNotes = await notes('loy_climber');
  check('crossing a rung sends exactly one notification', climberNotes.length === 1, JSON.stringify(climberNotes));
  const cn = climberNotes[0] || {};
  check('notification is typed loyalty', cn.type === 'loyalty', JSON.stringify(cn));
  check('single-stock title names the ticker and tier',
    /\$SOPH/.test(cn.title || '') && /4 weeks/.test(cn.title || ''), cn.title);
  check('message quotes BOTH rewards',
    /1\.25x/.test(cn.message || '') && /25% off/.test(cn.message || ''), cn.message);
  check('data.ticker set so the row links to the stock',
    cn.data?.ticker === T1, JSON.stringify(cn.data));
  check('stored tier advanced to 28',
    (await getUser('loy_climber')).loyaltyTierNotified?.[T1] === 28);
  check('unaffected users got nothing new', (await notes('loy_seed')).length === 0);

  // ── 4. Re-running the same day is a no-op ───────────────────────────────
  console.log('\nPass 4 (re-run after the crossing)\n');
  const fourth = await runSync();
  check('re-running does not repeat the notification',
    fourth.loyaltyNotified === 0 && (await notes('loy_climber')).length === 1,
    JSON.stringify(fourth));

  // ── 5. Two tickers crossing at once → one digest ────────────────────────
  console.log('\nPass 5 (two holdings cross together)\n');
  await clearNotes('loy_double');
  await db.collection('users').doc('loy_double')
    .update({ loyaltyTierNotified: { [T1]: DIVIDEND_HOLD_DAYS, [T2]: DIVIDEND_HOLD_DAYS } });
  await runSync();

  const doubleNotes = await notes('loy_double');
  check('two crossings produce ONE notification, not two',
    doubleNotes.length === 1, JSON.stringify(doubleNotes.map(n => n.title)));
  const dn = doubleNotes[0] || {};
  check('digest title counts the holdings',
    /2 holdings/.test(dn.title || ''), dn.title);
  check('digest carries a per-ticker tier map for the expanded view',
    dn.data?.tiers?.[T1] === 56 && dn.data?.tiers?.[T2] === 28, JSON.stringify(dn.data));

  // ── 6. Bots stay silent ─────────────────────────────────────────────────
  check('bots are never notified', (await notes('loy_bot')).length === 0);
  const bot = await getUser('loy_bot');
  check('bot portfolio value still synced (sync itself untouched)',
    typeof bot.portfolioValue === 'number' && bot.portfolioValue > 0, JSON.stringify(bot.portfolioValue));

  // ── 7. Selling the old shares drops the tier silently ───────────────────
  console.log('\nPass 6 (sold the mature shares)\n');
  await clearNotes('loy_seed');
  await db.collection('users').doc('loy_seed').update({
    holdings: { [T1]: 100 },
    holdingCohorts: { [T1]: { eligible: 0, pending: [agedLot(100, 2)] } },
  });
  const sixth = await runSync();
  const dropped = await getUser('loy_seed');
  check('a tier drop is recorded without a notification',
    sixth.loyaltyNotified === 0 && (await notes('loy_seed')).length === 0,
    JSON.stringify(sixth));
  check('stored tier cleared once the old shares are gone',
    !dropped.loyaltyTierNotified?.[T1], JSON.stringify(dropped.loyaltyTierNotified));

  // Climbing back after a drop must be able to notify again.
  await db.collection('users').doc('loy_seed').update({
    holdingCohorts: { [T1]: { eligible: 0, pending: [agedLot(100, 60)] } },
  });
  await runSync();
  check('re-climbing after a drop notifies again',
    (await notes('loy_seed')).length === 1, JSON.stringify(await notes('loy_seed')));

  console.log(failures === 0 ? '\nALL LOYALTY NOTIFICATION CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error('Test crashed:', err); process.exit(1); });
