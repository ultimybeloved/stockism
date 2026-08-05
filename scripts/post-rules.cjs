// Posts (and later edits) the server rules in Discord.
//
// Usage:
//   node scripts/post-rules.cjs --channel 123456789012345678   # first run
//   node scripts/post-rules.cjs                                # edit in place
//
// Sends TWO messages: a bare invite link first, so Discord unfurls it into the
// server card, then the rules embed under it. Both are sent by the bot, so both
// stay editable forever. Re-running EDITS the existing messages rather than
// posting new ones, which keeps the pin and anything linking to them alive.
// That is the whole point: rules change, invites die, vanities appear.
//
// Message IDs are saved to scripts/rules-message.json. COMMIT THAT FILE. If it
// goes missing the next run has nothing to edit and posts duplicates instead.
//
// Uses the "Stockism Updates" bot (DISCORD_BOT_TOKEN), the same app that sends
// market alerts and the daily drop, NOT the login app. The bot needs View
// Channel, Send Messages, and Embed Links in the target channel.

const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', 'functions', '.env');
const STATE_PATH = path.join(__dirname, 'rules-message.json');
const API = 'https://discord.com/api/v10';

// ============================================================
// EDIT BELOW. Everything above is plumbing.
// ============================================================

// Posted bare so Discord renders the server card. Swap in a vanity here and
// re-run to update the existing message.
const INVITE_URL = 'https://discord.com/invite/hpVm8nQMvY';

const TITLE = 'Welcome!';

const INTRO = [
  'Stockism is a live stock market for Lookism characters.',
  'Trade at https://stockism.app',
].join('\n');

// Role mentions render as coloured pills. They never ping from inside an embed,
// and allowed_mentions is empty on send as a second belt.
const ANGEL_INVESTORS = '<@&1472108261040980230>';
const CUSTOM_ROLES = `Custom roles available to ${ANGEL_INVESTORS}`;

const STAFF = [
  '<@&1470614423910482081> - <@539194416120987648>',
  '<@&1471635846498353317> - <@1281576039960678461>, <@675125555787595806>',
].join('\n');

// Link buttons sit in a row under the embed. Add more objects for more buttons.
const BUTTONS = [
  { label: 'Chat Leaderboard', emoji: '📋', url: 'https://arcane.bot/leaderboard/stockism' },
];

// Reactions the bot adds to the rules message. Custom emoji use `name:id`.
// Re-running is harmless: adding a reaction that is already there is a no-op,
// and it restores any that got cleared.
const REACTIONS = [
  'STOCKISM:1466671436843454555',
  '💯',
  '📈',
  '😭',
  'Stare:1469817892110336061',
];

// Discord rate limits reaction adds fairly tightly. Same spacing the backend
// uses for role writes.
const REACTION_SPACING_MS = 300;

// Numbered and italicised at render time, so reordering or dropping a rule
// renumbers itself. Don't put asterisks in the text here.
const RULES = [
  'Follow Discord TOS.',
  'Keep your login to yourself. Staff will never DM you asking for one.',
  'No scam links, phishing, or fake Stockism sites.',
  'No doxxing.',
  'No slurs aimed at people.',
  'Sexualizing minors is an instant, permanent ban.',
  'Keep chat usable. No raids, mass pings, or spam floods.',
  'One Stockism account per person. Don\'t buy, sell, or share them.',
  'No ban evasion.',
  'Don\'t trust anyone, they are out to get you.',
];

const COLOR = 0xf97316; // site orange

// ============================================================

function buildEmbed() {
  const description = [INTRO, CUSTOM_ROLES, '', STAFF].join('\n');
  return {
    title: TITLE,
    description,
    color: COLOR,
    fields: [
      // Field names render bold on their own. Adding ** here would print the
      // asterisks literally.
      { name: 'Server Rules:', value: RULES.map((r, i) => `${i + 1}. *${r}*`).join('\n') },
      { name: 'Server Link', value: `➥ Permanent Invite - ${INVITE_URL}` },
    ],
  };
}

function buildComponents() {
  if (!BUTTONS.length) return [];
  return [{
    type: 1, // action row
    components: BUTTONS.map((b) => ({
      type: 2,    // button
      style: 5,   // link button, needs no custom_id and fires no interaction
      label: b.label,
      emoji: { name: b.emoji },
      url: b.url,
    })),
  }];
}

function readBotToken() {
  if (process.env.DISCORD_BOT_TOKEN) return process.env.DISCORD_BOT_TOKEN;
  if (!fs.existsSync(ENV_PATH)) {
    throw new Error(`No DISCORD_BOT_TOKEN in the environment and no ${ENV_PATH} to read it from.`);
  }
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0 && line.slice(0, i).trim() === 'DISCORD_BOT_TOKEN') {
      return line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  throw new Error(`DISCORD_BOT_TOKEN not found in ${ENV_PATH}`);
}

function readState() {
  if (!fs.existsSync(STATE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

const TOKEN = readBotToken();

async function discord(method, route, body) {
  const res = await fetch(API + route, {
    method,
    headers: { Authorization: `Bot ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(`${method} ${route} failed (${res.status}): ${json.message || text}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

// Edit the saved message if there is one, otherwise post. A saved ID that 404s
// means someone deleted the message by hand, so fall through to posting rather
// than dying and leaving the rules half-updated.
async function upsert(channelId, savedId, payload, label) {
  if (savedId) {
    try {
      const m = await discord('PATCH', `/channels/${channelId}/messages/${savedId}`, payload);
      console.log(`  ${label}: edited ${m.id}`);
      return m.id;
    } catch (err) {
      if (err.status !== 404) throw err;
      console.log(`  ${label}: saved message is gone, posting a fresh one`);
    }
  }
  const m = await discord('POST', `/channels/${channelId}/messages`, payload);
  console.log(`  ${label}: posted ${m.id}`);
  return m.id;
}

async function main() {
  const args = process.argv.slice(2);
  const flagIdx = args.indexOf('--channel');
  const state = readState();
  const channelId = flagIdx !== -1 ? args[flagIdx + 1] : state.channelId;

  if (!channelId) {
    throw new Error('No channel. First run needs: node scripts/post-rules.cjs --channel <id>');
  }
  if (INVITE_URL.includes('XXXXXXX')) {
    throw new Error('Set INVITE_URL at the top of this file first.');
  }

  console.log(`Channel ${channelId}`);

  // Link goes first so the rules embed sits underneath it.
  const linkMessageId = await upsert(
    channelId,
    state.linkMessageId,
    { content: INVITE_URL, allowed_mentions: { parse: [] } },
    'invite'
  );
  const rulesMessageId = await upsert(
    channelId,
    state.rulesMessageId,
    { embeds: [buildEmbed()], components: buildComponents(), allowed_mentions: { parse: [] } },
    'rules '
  );

  for (const emoji of REACTIONS) {
    await discord('PUT', `/channels/${channelId}/messages/${rulesMessageId}/reactions/${encodeURIComponent(emoji)}/@me`);
    console.log(`  reacted ${emoji}`);
    await new Promise((r) => setTimeout(r, REACTION_SPACING_MS));
  }

  fs.writeFileSync(
    STATE_PATH,
    JSON.stringify({ channelId, linkMessageId, rulesMessageId }, null, 2) + '\n'
  );
  console.log(`Saved ids to ${path.relative(process.cwd(), STATE_PATH)}. Commit it.`);
}

main().catch((err) => {
  console.error(err.message);
  if (err.status === 403) {
    console.error('403 usually means the bot lacks View Channel / Send Messages / Embed Links there.');
  }
  process.exit(1);
});
