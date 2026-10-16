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

import { it } from 'vitest';
import { createRequire } from 'module';
import { check } from './harness';

const require = createRequire(import.meta.url);

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

const crypto = require('crypto');
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

// A real Ed25519 keypair, so verifyKey exercises the genuine crypto path.
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const rawPublic = publicKey.export({ type: 'spki', format: 'der' }).slice(-32);
process.env.DISCORD_PUBLIC_KEY = rawPublic.toString('hex');

const { CHARACTERS } =
  require('../../functions/src/shared/characters') as typeof import('../../functions/src/shared/characters');
const { discordInteractions } =
  require('../../functions/src/discord/discordInteractions') as typeof import('../../functions/src/discord/discordInteractions');

const TICKER = CHARACTERS[0].ticker;
const { DISCORD_GUILD_ID, LADDER_CHANNEL_IDS } =
  require('../../functions/src/shared/constants') as typeof import('../../functions/src/shared/constants');

// The ladder edits its message through Discord's webhook API after replying.
// Capture those calls instead of sending them.
const axios = require('../../functions/node_modules/axios');
const sent: { method: string; url: string; body: Record<string, unknown> }[] = [];
axios.patch = async (url: string, body: Record<string, unknown>) => {
  sent.push({ method: 'patch', url, body });
  return { status: 200 };
};
axios.post = async (url: string, body: Record<string, unknown>) => {
  sent.push({ method: 'post', url, body });
  return { status: 200 };
};

interface EndpointResponse {
  kind: string;
  code?: number;
  payload: {
    type?: number;
    data?: { flags?: number; embeds?: unknown[]; components?: { components: { custom_id?: string }[] }[] };
  };
  error?: unknown;
}
type Handler = (req: unknown, res: unknown) => unknown;

// Drives the exported onRequest handler the way Cloud Functions would.
const callEndpoint = (body: unknown, { sign = true } = {}) =>
  new Promise<EndpointResponse[]>((resolve) => {
    const rawBody = Buffer.from(JSON.stringify(body));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign
      ? crypto.sign(null, Buffer.concat([Buffer.from(timestamp), rawBody]), privateKey).toString('hex')
      : 'deadbeef';

    const responses: EndpointResponse[] = [];
    const res = {
      statusCode: 200,
      _settled: false,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      send(payload: EndpointResponse['payload']) {
        responses.push({ kind: 'send', code: this.statusCode, payload });
        this._done();
        return this;
      },
      json(payload: EndpointResponse['payload']) {
        responses.push({ kind: 'json', code: this.statusCode, payload });
        this._done();
        return this;
      },
      _done() {
        if (!this._settled) {
          this._settled = true;
          setImmediate(() => resolve(responses));
        }
      },
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
    const handler = discordInteractions as unknown as Handler & { run?: Handler };
    const result = handler.run ? handler.run(req, res) : handler(req, res);
    Promise.resolve(result).catch((err) => {
      responses.push({ kind: 'threw', error: err } as EndpointResponse);
      resolve(responses);
    });
  });

const commandBody = (name: string, options: { name: string; value: string }[] = [], discordId = 'endpoint-user') => ({
  type: 2,
  id: 'cmd-id',
  application_id: 'app-id',
  token: `tok-${Math.random()}`,
  data: { name, options },
  member: { user: { id: discordId } },
});

async function seed() {
  await db
    .collection('market')
    .doc('current')
    .set({
      prices: { [TICKER]: 100 },
      launchedTickers: [],
      marketHalted: false,
    });
  await db
    .collection('market')
    .doc('preHaltSnapshot')
    .set({ prices: { [TICKER]: 80 } });
  await db
    .collection('leaderboard')
    .doc('global')
    .set({
      generatedAt: Date.now(),
      entries: [{ userId: 'u1', displayName: 'Alpha', portfolioValue: 1000 }],
    });
}

const ladderBody = (bet: number, discordId: string, guild = DISCORD_GUILD_ID, channel = LADDER_CHANNEL_IDS[0]) => ({
  ...commandBody('ladder', [{ name: 'bet', value: String(bet) }], discordId),
  guild_id: guild,
  channel_id: channel,
});
const clickBody = (custom_id: string, discordId: string) => ({
  type: 3,
  id: 'click-id',
  application_id: 'app-id',
  token: `tok-${Math.random()}`,
  guild_id: DISCORD_GUILD_ID,
  data: { custom_id },
  member: { user: { id: discordId } },
});
const buttonIds = (r: EndpointResponse[]) =>
  (r[0]?.payload.data?.components || []).flatMap((row) => row.components.map((b) => b.custom_id));
const waitFor = async (cond: () => boolean, ms = 15000) => {
  const until = Date.now() + ms;
  while (!cond() && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
  return cond();
};

async function runLadder() {
  console.log('\n--- /ladder ---');
  const away = await callEndpoint(ladderBody(10, 'lad-owner', 'some-partner-guild'));
  check('outside the Stockism server it refuses privately', away[0].payload.data?.flags === 64);

  const general = await callEndpoint(ladderBody(10, 'lad-owner', DISCORD_GUILD_ID, 'general-chat'));
  check(
    'in any other channel it refuses privately',
    general[0].payload.data?.flags === 64 && JSON.stringify(general[0].payload).includes('can only be played in'),
  );

  const start = await callEndpoint(ladderBody(10, 'lad-owner'));
  check(
    'posts the board publicly (type 4, not ephemeral)',
    start[0].payload.type === 4 && !start[0].payload.data?.flags,
  );
  check(
    'offers Left and Right',
    JSON.stringify(buttonIds(start)) ===
      JSON.stringify(['ladder:side:left:10:lad-owner', 'ladder:side:right:10:lad-owner']),
  );

  const stranger = await callEndpoint(clickBody('ladder:side:left:10:lad-owner', 'lad-stranger'));
  check(
    "someone else's click is refused privately",
    stranger[0].payload.type === 4 && stranger[0].payload.data?.flags === 64,
  );

  const side = await callEndpoint(clickBody('ladder:side:left:10:lad-owner', 'lad-owner'));
  check(
    'picking a side updates the message with ODD and EVEN',
    side[0].payload.type === 7 && buttonIds(side).includes('ladder:bet:left:odd:10:lad-owner'),
  );

  sent.length = 0;
  const unlinked = await callEndpoint(clickBody('ladder:bet:left:odd:10:lad-owner', 'lad-owner'));
  const ack = sent.find((c) => c.url.includes('/interactions/click-id/'));
  check(
    'a bet takes the buttons off at once, through the callback API',
    ack && ack.body.type === 7 && JSON.stringify((ack.body.data as { components: unknown[] }).components) === '[]',
    JSON.stringify(sent[0]),
  );
  check(
    'the HTTP reply is held until the game is over, then sent once',
    unlinked.length === 1 && unlinked[0].code === 204 && sent.some((c) => String(c.body.content).includes('Link this')),
    JSON.stringify(unlinked),
  );
  check(
    'not linked: the player is told privately how to link',
    await waitFor(() => sent.some((c) => c.method === 'post' && String(c.body.content).includes('Link this Discord'))),
    JSON.stringify(sent),
  );

  await db.collection('users').doc('lad-uid').set({ displayName: 'Ladderer', discordId: 'lad-linked', cash: 1000 });
  sent.length = 0;
  await callEndpoint(clickBody('ladder:bet:right:even:25:lad-linked', 'lad-linked'));
  const done = await waitFor(() => sent.some((c) => JSON.stringify(c.body).includes('Landed on')));
  check('linked: the game plays through to a result', done, JSON.stringify(sent.map((c) => c.body)));
  const edits = sent.filter((c) => c.method === 'patch');
  check('animates over several edits', edits.length >= 4, edits.length);
  const ladder = (await db.collection('ladderGameUsers').doc('lad-uid').get()).data();
  check(
    'the bet is settled on the ladder balance',
    ladder && [475, 525].includes(ladder.balance),
    JSON.stringify(ladder),
  );
  check('ends with Play again', JSON.stringify(edits[edits.length - 1]?.body).includes('ladder:again:25:lad-linked'));

  sent.length = 0;
  await callEndpoint(clickBody('ladder:bet:right:even:100000:lad-linked', 'lad-linked'));
  check(
    'too big a bet is refused privately',
    await waitFor(() => sent.some((c) => c.method === 'post' && String(c.body.content).includes('Not enough'))),
    JSON.stringify(sent),
  );
}

async function run() {
  await seed();
  await runLadder();

  console.log('\n--- Signature verification ---');
  const unsigned = await callEndpoint(commandBody('leaderboard'), { sign: false });
  check(
    'unsigned request is rejected 401',
    unsigned.length === 1 && unsigned[0].code === 401,
    JSON.stringify(unsigned),
  );

  const ping = await callEndpoint({ type: 1 });
  check(
    'signed PING gets PONG',
    ping.length === 1 && ping[0].payload && ping[0].payload.type === 1,
    JSON.stringify(ping),
  );

  console.log('\n--- Reply strategy ---');
  // Distinct callers throughout: the per-user cooldown would otherwise turn the
  // second call into a "slow down" reply and mask what is being tested.
  // First interaction on this instance: no headroom assumed, must defer (type 5),
  // through the callback API, holding the HTTP reply until the edit is in.
  sent.length = 0;
  const first = await callEndpoint(commandBody('price', [{ name: 'stock', value: TICKER }], 'endpoint-cold'));
  check('exactly one response sent', first.length === 1, JSON.stringify(first));
  check(
    'first request on a cold instance defers (type 5) through the callback API',
    sent[0]?.url.includes('/interactions/cmd-id/') && sent[0]?.body.type === 5,
    JSON.stringify(sent[0]),
  );
  check(
    'the HTTP reply waits until the real answer is edited in',
    first[0].code === 204 && sent.some((c) => c.method === 'patch' && c.url.includes('@original')),
    JSON.stringify(sent.map((c) => c.url)),
  );

  // Instance is now warm: the reads are fast, so it should answer in one shot.
  const second = await callEndpoint(commandBody('price', [{ name: 'stock', value: TICKER }], 'endpoint-warm'));
  check('exactly one response sent', second.length === 1, JSON.stringify(second));
  check(
    'warm request replies directly (type 4)',
    second[0].payload && second[0].payload.type === 4,
    JSON.stringify(second[0].payload),
  );
  check(
    'direct reply carries the embed',
    second[0].payload.data && Array.isArray(second[0].payload.data.embeds) && second[0].payload.data.embeds.length > 0,
  );
  check('direct reply shows the right price', JSON.stringify(second[0].payload.data).includes('100.00'));

  console.log('\n--- Rate limiting ---');
  const spam1 = await callEndpoint(commandBody('price', [{ name: 'stock', value: TICKER }], 'endpoint-spam'));
  const spam2 = await callEndpoint(commandBody('price', [{ name: 'stock', value: TICKER }], 'endpoint-spam'));
  check(
    'same user twice in a row is rate limited',
    JSON.stringify(spam2[0].payload).includes('Slow down'),
    JSON.stringify(spam2[0].payload),
  );
  check('the rate-limited reply is still a valid single response', spam1.length === 1 && spam2.length === 1);

  console.log('\n--- Private commands stay private on the direct path ---');
  const priv = await callEndpoint(commandBody('portfolio', [], 'endpoint-private-2'));
  const privData = priv[0].payload.data || {};
  check(
    'private command reply is ephemeral',
    privData.flags === 64,
    `type=${priv[0].payload.type} flags=${privData.flags}`,
  );

  console.log('\n--- Public commands are not ephemeral ---');
  const pub = await callEndpoint(commandBody('leaderboard', [], 'endpoint-pub'));
  check(
    'public command reply has no ephemeral flag',
    !(pub[0].payload.data || {}).flags,
    JSON.stringify(pub[0].payload.data),
  );

  console.log('\n--- Unknown command still answers ---');
  const unknown = await callEndpoint(commandBody('no-such-command', [], 'endpoint-unknown'));
  check('unknown command sends exactly one response', unknown.length === 1);
  check('unknown command does not throw', !unknown.some((r) => r.kind === 'threw'), JSON.stringify(unknown));

  console.log('\n--- Bad input does not crash the endpoint ---');
  const noOptions = await callEndpoint(commandBody('price', [], 'endpoint-nooptions'));
  check(
    '/price with no argument responds without throwing',
    noOptions.length === 1 && !noOptions.some((r) => r.kind === 'threw'),
    JSON.stringify(noOptions),
  );
}

it('Discord interactions endpoint', run);
