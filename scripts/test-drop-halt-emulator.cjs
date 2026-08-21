'use strict';
// Proves the daily drop cannot move prices while the market is halted, against
// the LOCAL Firebase emulator. Never touches production.
//
// Run via: npm run test:drophalt
//
// Why this exists: the drop claim had NO halt check at all until 2026-08-21. It
// grants free shares and then applies buy-side price impact, so claiming during
// a chapter review moved prices while players were told the market was frozen.
// It did that ~15 times across ~40 stocks on 2026-08-20 and nothing said so,
// because those points carried no source tag. The fix keeps the gift and drops
// the price impact. This proves it, for both the weekly halt and a manual one.
//
// Checks:
//   1. No halt: a claim grants shares AND moves prices, tagged 'daily_drop'
//   2. Weekly halt: shares still granted, prices frozen, no new history points
//   3. Manual halt: same
//   4. The tag is present, so this mover is identifiable on a chart

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

const crypto = require('crypto');
const admin = require('../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

// A real Ed25519 keypair, so verifyKey exercises the genuine crypto path.
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
process.env.DISCORD_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'der' }).slice(-32).toString('hex');
process.env.DISCORD_BOT_TOKEN = 'test-token';

// Discord is not reachable from the emulator. Stub the transport BEFORE the
// handler is required, or every deferred reply sits waiting on a real socket.
const axios = require('../functions/node_modules/axios');
for (const method of ['get', 'post', 'patch', 'put', 'delete', 'request']) {
  axios[method] = async () => ({ data: {}, status: 200 });
}

// isWeeklyTradingHalt reads the wall clock, and the handler destructures it at
// require time — so it has to be swapped before the require below, not after.
const constants = require('../functions/constants');
let weeklyHalt = false;
constants.isWeeklyTradingHalt = () => weeklyHalt;

const { discordInteractions } = require('../functions/services/discordInteractions');
const { CHARACTERS } = require('../functions/characters');

let failures = 0;
const check = (label, cond, detail = '') => {
  console.log(`${cond ? '  [PASS]' : '  [FAIL]'} ${label}${cond ? '' : ' - ' + detail}`);
  if (!cond) failures++;
};

const DISCORD_ID = 'drop-halt-tester';
const UID = 'drop_halt_uid';

// Discord snowflake for "now", so the 72-hour expiry check passes.
const freshMessageId = () => String(BigInt(Date.now() - 1420070400000) << 22n);

const callClaim = (messageId) => new Promise((resolve) => {
  const body = {
    type: 3,
    application_id: 'app-id',
    token: `tok-${Math.random()}`,
    data: { custom_id: 'claim_daily_stock' },
    member: { user: { id: DISCORD_ID } },
    message: { id: messageId },
  };
  const rawBody = Buffer.from(JSON.stringify(body));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto
    .sign(null, Buffer.concat([Buffer.from(timestamp), rawBody]), privateKey)
    .toString('hex');

  let settled = false;
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    send() { return this; },
    json() { return this; },
  };
  const req = {
    method: 'POST',
    rawBody,
    body,
    headers: { 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp },
  };

  // The handler answers Discord immediately and keeps working, so wait on the
  // returned promise rather than on the response.
  const done = () => { if (!settled) { settled = true; resolve(); } };
  Promise.resolve(discordInteractions.run ? discordInteractions.run(req, res) : discordInteractions(req, res))
    .then(done)
    .catch((err) => { console.log('    (handler finished with:', err.message + ')'); done(); });
});

const marketRef = db.collection('market').doc('current');
const histRef = db.collection('market').doc('priceHistory');

const readState = async () => {
  const prices = (await marketRef.get()).data().prices || {};
  const hist = (await histRef.get()).data() || {};
  const user = (await db.collection('users').doc(UID).get()).data() || {};
  const dropPoints = Object.values(hist)
    .filter(Array.isArray)
    .flat()
    .filter((p) => p && p.source === 'daily_drop');
  const shares = Object.values(user.holdings || {}).reduce((a, b) => a + b, 0);
  return { prices, dropPoints, shares };
};

async function seed() {
  // Whole roster priced, so the drop's rarity tiers behave like production.
  const prices = {};
  for (const c of CHARACTERS) if (!c.ipoRequired) prices[c.ticker] = c.basePrice;
  await marketRef.set({ prices, launchedTickers: [], marketHalted: false });
  await histRef.set({});
  await db.collection('users').doc(UID).set({
    discordId: DISCORD_ID,
    displayName: 'Drop Halt Tester',
    cash: 10000,
    holdings: {},
    claimedDailyStockMessages: [],
    createdAt: admin.firestore.Timestamp.fromMillis(Date.now() - 30 * 86400000),
  });
}

async function claimUnder(label, { weekly = false, manual = false }) {
  weeklyHalt = weekly;
  await marketRef.update({ marketHalted: manual });
  const before = await readState();
  await callClaim(freshMessageId());
  const after = await readState();

  const moved = Object.keys(after.prices)
    .filter((t) => after.prices[t] !== before.prices[t]);
  return {
    label,
    moved,
    granted: after.shares - before.shares,
    newDropPoints: after.dropPoints.length - before.dropPoints.length,
  };
}

async function main() {
  await seed();

  console.log('\n--- No halt: the drop should behave normally ---');
  const open = await claimUnder('open market', {});
  check('shares were granted', open.granted > 0, `granted ${open.granted}`);
  check('prices moved', open.moved.length > 0, `moved ${open.moved.length} tickers`);
  check('the points are tagged daily_drop', open.newDropPoints > 0,
    `${open.newDropPoints} tagged points`);
  check('one point per moved ticker', open.newDropPoints === open.moved.length,
    `${open.newDropPoints} points vs ${open.moved.length} moved`);

  console.log('\n--- Weekly chapter-review halt ---');
  const weekly = await claimUnder('weekly halt', { weekly: true });
  check('shares are STILL granted (a drop is a gift)', weekly.granted > 0,
    `granted ${weekly.granted}`);
  check('NO price moved', weekly.moved.length === 0, `moved: ${weekly.moved.join(', ')}`);
  check('no price-history points written', weekly.newDropPoints === 0,
    `${weekly.newDropPoints} points`);

  console.log('\n--- Manual admin halt ---');
  const manual = await claimUnder('manual halt', { manual: true });
  check('shares are still granted', manual.granted > 0, `granted ${manual.granted}`);
  check('NO price moved', manual.moved.length === 0, `moved: ${manual.moved.join(', ')}`);
  check('no price-history points written', manual.newDropPoints === 0,
    `${manual.newDropPoints} points`);

  console.log('\n--- Back to open, to prove the gate released ---');
  const reopened = await claimUnder('reopened', {});
  check('prices move again once the halt lifts', reopened.moved.length > 0,
    `moved ${reopened.moved.length} tickers`);

  console.log(failures === 0 ? '\nALL DROP-HALT E2E CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error('Test crashed:', err); process.exit(1); });
