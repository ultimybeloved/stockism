// Exercises every Discord slash command against the Firestore emulator.
//
// Run: npm run test:discord
//
// These are the commands partner servers will hit, so the things worth proving
// are: they return a valid Discord payload, they never throw, they show the
// signup pitch to strangers instead of an error, and they stay read-only.

// Must resolve firebase-admin from functions/node_modules — the service files
// require it from there, and two copies of the SDK do not share the initialized
// app (same trap the trading suite documents).
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

const admin = require('../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

const { handleSlashCommand, isPrivate } = require('../functions/services/discordCommands');
const { CHARACTERS } = require('../functions/characters');

let passed = 0;
let failed = 0;

const check = (name, condition, detail) => {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

// A slash-command interaction as Discord actually sends it.
const interaction = (name, options = [], discordId = 'discord-linked-1') => ({
  type: 2,
  application_id: 'app',
  token: 'tok',
  data: { name, options },
  member: { user: { id: discordId } },
});

// Discord rejects embeds with empty field values or missing descriptions, so a
// payload that "works" in JS can still fail at the API. Validate shape here.
const validPayload = (p) => {
  if (!p || typeof p !== 'object') return 'not an object';
  if (p.content && typeof p.content !== 'string') return 'content not a string';
  if (p.embeds) {
    if (!Array.isArray(p.embeds)) return 'embeds not an array';
    for (const e of p.embeds) {
      if (!e.title && !e.description && !e.fields) return 'embed has no content';
      if (e.fields) {
        for (const f of e.fields) {
          if (!f.name || !f.value) return `embed field empty: ${JSON.stringify(f)}`;
          if (f.value.length > 1024) return `embed field too long: ${f.name}`;
        }
      }
      if (e.description && e.description.length > 4096) return 'description too long';
    }
  }
  if (p.components) {
    for (const row of p.components) {
      for (const btn of row.components) {
        if (btn.style === 5 && !btn.url) return 'link button without url';
        if (!btn.label) return 'button without label';
      }
    }
  }
  return null;
};

const TICKER_A = CHARACTERS[0].ticker;
const NAME_A = CHARACTERS[0].name;

async function seed() {
  await db.collection('market').doc('current').set({
    prices: { [TICKER_A]: 120.5, [CHARACTERS[1].ticker]: 40 },
    launchedTickers: [],
    marketHalted: false,
  });
  await db.collection('market').doc('preHaltSnapshot').set({
    prices: { [TICKER_A]: 100 },
  });
  await db.collection('leaderboard').doc('global').set({
    generatedAt: Date.now(),
    entries: [
      { userId: 'u1', displayName: 'Alpha', portfolioValue: 50000 },
      { userId: 'u2', displayName: 'Beta', portfolioValue: 42000 },
      { userId: 'u3', displayName: 'Gamma', portfolioValue: 31000 },
    ],
  });
  await db.collection('users').doc('u1').set({
    discordId: 'discord-linked-1',
    displayName: 'Alpha',
    cash: 5000,
    portfolioValue: 50000,
    crew: Object.keys(require('../functions/constants').CREW_MEMBERS)[0],
    holdings: { [TICKER_A]: 100, [CHARACTERS[1].ticker]: 50 },
    achievements: ['DISCORD_LINKED'],
    isPublic: true,
    isBot: false,
  });
}

async function run() {
  console.log('\nSeeding emulator...');
  await seed();

  console.log('\n--- Linked user ---');
  for (const name of ['leaderboard', 'profile', 'price', 'portfolio', 'missions', 'buy']) {
    const options = (name === 'price' || name === 'buy')
      ? [{ name: 'stock', value: TICKER_A }]
      : [];
    let payload;
    try {
      payload = await handleSlashCommand(interaction(name, options, `discord-linked-1`));
    } catch (err) {
      check(`/${name} does not throw`, false, err.message);
      continue;
    }
    check(`/${name} returns a payload`, !!payload);
    const problem = validPayload(payload);
    check(`/${name} payload is valid for Discord`, problem === null, problem);
  }

  console.log('\n--- Stranger with no account (the partner-server case) ---');
  for (const name of ['profile', 'portfolio', 'missions']) {
    const payload = await handleSlashCommand(interaction(name, [], `stranger-${name}`));
    const problem = validPayload(payload);
    check(`/${name} valid payload for stranger`, problem === null, problem);
    const text = JSON.stringify(payload);
    check(`/${name} pitches signup rather than erroring`,
      /not on Stockism|No account found|Create an account/i.test(text));
    check(`/${name} offers a link back to the site`, /stockism\.app/.test(text));
  }

  console.log('\n--- Lookup by character name, not just ticker ---');
  const byName = await handleSlashCommand(interaction('price', [{ name: 'stock', value: NAME_A }], 'u-name'));
  check('/price resolves a full character name', JSON.stringify(byName).includes(TICKER_A));

  const bogus = await handleSlashCommand(interaction('price', [{ name: 'stock', value: 'zzzz-not-real' }], 'u-bogus'));
  check('/price handles an unknown stock gracefully', validPayload(bogus) === null && /Not found/i.test(JSON.stringify(bogus)));

  console.log('\n--- Price change is computed from the chapter snapshot ---');
  const priced = await handleSlashCommand(interaction('price', [{ name: 'stock', value: TICKER_A }], 'u-price'));
  // Seeded 100 -> 120.50 = +20.50%
  check('/price shows the correct move since chapter open', /\+20\.50%/.test(JSON.stringify(priced)),
    JSON.stringify(priced.embeds[0].fields));

  console.log('\n--- Markdown injection via echoed input ---');
  const inject = await handleSlashCommand(
    interaction('price', [{ name: 'stock', value: '[click me](https://evil.example)' }], 'u-inject')
  );
  // Check the real description string, not its JSON encoding — JSON doubles
  // every backslash, which makes escaped output look unescaped.
  const injectDesc = inject.embeds[0].description;
  check('/price does not render an injected markdown link',
    !injectDesc.includes(']('), injectDesc);
  check('/price escapes the injected brackets', injectDesc.includes('\\['), injectDesc);

  const longInput = 'x'.repeat(5000);
  const longReply = await handleSlashCommand(
    interaction('buy', [{ name: 'stock', value: longInput }], 'u-long')
  );
  check('/buy truncates an oversized input', validPayload(longReply) === null);

  console.log('\n--- Privacy ---');
  check('/portfolio is private', isPrivate('portfolio'));
  check('/missions is private', isPrivate('missions'));
  check('/leaderboard is public', !isPrivate('leaderboard'));
  check('/price is public', !isPrivate('price'));

  console.log('\n--- Cooldown ---');
  const spammer = 'discord-spammer';
  await handleSlashCommand(interaction('leaderboard', [], spammer));
  const second = await handleSlashCommand(interaction('leaderboard', [], spammer));
  check('rapid repeat is rate limited', /Slow down/i.test(JSON.stringify(second)));

  console.log('\n--- Unknown command ---');
  const unknown = await handleSlashCommand(interaction('definitely-not-a-command', [], 'u-unknown'));
  check('unknown command returns null instead of throwing', unknown === null);

  console.log('\n--- Read-only guarantee ---');
  const userBefore = (await db.collection('users').doc('u1').get()).data();
  await handleSlashCommand(interaction('portfolio', [], 'discord-linked-1'));
  await handleSlashCommand(interaction('buy', [{ name: 'stock', value: TICKER_A }], 'discord-linked-2'));
  const userAfter = (await db.collection('users').doc('u1').get()).data();
  check('commands do not mutate the user doc',
    JSON.stringify(userBefore) === JSON.stringify(userAfter));
  const marketAfter = (await db.collection('market').doc('current').get()).data();
  check('commands do not move prices', marketAfter.prices[TICKER_A] === 120.5);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('\nTest run crashed:', err);
  process.exit(1);
});
