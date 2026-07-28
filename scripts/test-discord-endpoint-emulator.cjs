// Exercises the discordInteractions HTTP endpoint end to end, with REAL Ed25519
// signatures, against the Firestore emulator.
//
// Run: npm run test:discord:endpoint
//
// The point of this suite is the reply strategy. Discord hard-kills any
// interaction not acknowledged within 3 seconds, so the handler either answers
// directly (one round-trip, no "thinking..." flicker) or defers and edits. This
// verifies the choice is made correctly and that exactly one response is sent
// on every path — sending twice would throw and lose the interaction.

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

const crypto = require('crypto');
const admin = require('../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

// A real Ed25519 keypair, so verifyKey exercises the genuine crypto path.
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const rawPublic = publicKey.export({ type: 'spki', format: 'der' }).slice(-32);
process.env.DISCORD_PUBLIC_KEY = rawPublic.toString('hex');

const { CHARACTERS } = require('../functions/characters');
const { discordInteractions } = require('../functions/services/discordInteractions');

let passed = 0;
let failed = 0;
const check = (name, cond, detail) => {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? ` - ${detail}` : ''}`); }
};

const TICKER = CHARACTERS[0].ticker;

// Drives the exported onRequest handler the way Cloud Functions would.
const callEndpoint = (body, { sign = true } = {}) => new Promise((resolve) => {
  const rawBody = Buffer.from(JSON.stringify(body));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = sign
    ? crypto.sign(null, Buffer.concat([Buffer.from(timestamp), rawBody]), privateKey).toString('hex')
    : 'deadbeef';

  const responses = [];
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    send(payload) { responses.push({ kind: 'send', code: this.statusCode, payload }); this._done(); return this; },
    json(payload) { responses.push({ kind: 'json', code: this.statusCode, payload }); this._done(); return this; },
    _done() { if (!this._settled) { this._settled = true; setImmediate(() => resolve(responses)); } },
  };

  const req = {
    method: 'POST',
    rawBody,
    body,
    headers: {
      'x-signature-ed25519': signature,
      'x-signature-timestamp': timestamp,
    },
  };

  // .run() is the undecorated handler on a firebase-functions onRequest export.
  const result = discordInteractions.run
    ? discordInteractions.run(req, res)
    : discordInteractions(req, res);
  Promise.resolve(result).catch((err) => {
    responses.push({ kind: 'threw', error: err });
    resolve(responses);
  });
});

const commandBody = (name, options = [], discordId = 'endpoint-user') => ({
  type: 2,
  application_id: 'app-id',
  token: `tok-${Math.random()}`,
  data: { name, options },
  member: { user: { id: discordId } },
});

async function seed() {
  await db.collection('market').doc('current').set({
    prices: { [TICKER]: 100 }, launchedTickers: [], marketHalted: false,
  });
  await db.collection('market').doc('preHaltSnapshot').set({ prices: { [TICKER]: 80 } });
  await db.collection('leaderboard').doc('global').set({
    generatedAt: Date.now(),
    entries: [{ userId: 'u1', displayName: 'Alpha', portfolioValue: 1000 }],
  });
}

async function run() {
  await seed();

  console.log('\n--- Signature verification ---');
  const unsigned = await callEndpoint(commandBody('leaderboard'), { sign: false });
  check('unsigned request is rejected 401',
    unsigned.length === 1 && unsigned[0].code === 401, JSON.stringify(unsigned));

  const ping = await callEndpoint({ type: 1 });
  check('signed PING gets PONG',
    ping.length === 1 && ping[0].payload && ping[0].payload.type === 1, JSON.stringify(ping));

  console.log('\n--- Reply strategy ---');
  // Distinct callers throughout: the per-user cooldown would otherwise turn the
  // second call into a "slow down" reply and mask what is being tested.
  // First interaction on this instance: no headroom assumed, must defer (type 5).
  const first = await callEndpoint(commandBody('price', [{ name: 'stock', value: TICKER }], 'endpoint-cold'));
  check('exactly one response sent', first.length === 1, JSON.stringify(first));
  check('first request on a cold instance defers (type 5)',
    first[0].payload && first[0].payload.type === 5, JSON.stringify(first[0].payload));

  // Instance is now warm: the reads are fast, so it should answer in one shot.
  const second = await callEndpoint(commandBody('price', [{ name: 'stock', value: TICKER }], 'endpoint-warm'));
  check('exactly one response sent', second.length === 1, JSON.stringify(second));
  check('warm request replies directly (type 4)',
    second[0].payload && second[0].payload.type === 4, JSON.stringify(second[0].payload));
  check('direct reply carries the embed',
    second[0].payload.data && Array.isArray(second[0].payload.data.embeds)
      && second[0].payload.data.embeds.length > 0);
  check('direct reply shows the right price',
    JSON.stringify(second[0].payload.data).includes('100.00'));

  console.log('\n--- Rate limiting ---');
  const spam1 = await callEndpoint(commandBody('price', [{ name: 'stock', value: TICKER }], 'endpoint-spam'));
  const spam2 = await callEndpoint(commandBody('price', [{ name: 'stock', value: TICKER }], 'endpoint-spam'));
  check('same user twice in a row is rate limited',
    JSON.stringify(spam2[0].payload).includes('Slow down'),
    JSON.stringify(spam2[0].payload));
  check('the rate-limited reply is still a valid single response',
    spam1.length === 1 && spam2.length === 1);

  console.log('\n--- Private commands stay private on the direct path ---');
  const priv = await callEndpoint(commandBody('portfolio', [], 'endpoint-private-2'));
  const privData = priv[0].payload.data || {};
  check('private command reply is ephemeral', privData.flags === 64,
    `type=${priv[0].payload.type} flags=${privData.flags}`);

  console.log('\n--- Public commands are not ephemeral ---');
  const pub = await callEndpoint(commandBody('leaderboard', [], 'endpoint-pub'));
  check('public command reply has no ephemeral flag',
    !(pub[0].payload.data || {}).flags, JSON.stringify(pub[0].payload.data));

  console.log('\n--- Unknown command still answers ---');
  const unknown = await callEndpoint(commandBody('no-such-command', [], 'endpoint-unknown'));
  check('unknown command sends exactly one response', unknown.length === 1);
  check('unknown command does not throw',
    !unknown.some((r) => r.kind === 'threw'), JSON.stringify(unknown));

  console.log('\n--- Bad input does not crash the endpoint ---');
  const noOptions = await callEndpoint(commandBody('price', [], 'endpoint-nooptions'));
  check('/price with no argument responds without throwing',
    noOptions.length === 1 && !noOptions.some((r) => r.kind === 'threw'), JSON.stringify(noOptions));

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => { console.error('\nCrashed:', err); process.exit(1); });
