'use strict';

// Finds the crew emojis in Discord and writes their IDs into CREW_EMOJIS in
// functions/constants.js, which helpers.crewEmoji() reads.
//
//   npm run discord:emojis                        # show what the bot can see
//   node scripts/sync-crew-emojis.cjs --all       # ...and list every emoji available to it
//   node scripts/sync-crew-emojis.cjs --write     # rewrite CREW_EMOJIS from what it found
//   node scripts/sync-crew-emojis.cjs --upload    # also upload the crew icons to the app
//
// Re-run --write after adding a crew, renaming a crew emoji, or replacing one.
//
// WHERE THE EMOJIS COME FROM:
// A bot may use any emoji from any server it is a member of, in any message,
// anywhere — no Nitro — and it renders for everyone who sees the message, not
// just members of that server. The Stockism server already has the crew set as
// `:stockism_*:`, so by default that is what this picks up. A second server the
// bot is invited to works exactly the same way, which is the cheap way to add
// emojis without spending Stockism's own slots.
//
// --upload is the alternative and the only write this script makes: it uploads
// public/crews/*.png to the Stockism Updates APP as application emojis. Those
// belong to us rather than to any server, so nothing can break them, and the app
// gets 2000 slots. They win over server emojis when both exist. The upload is
// idempotent — a name that already exists on the app is skipped, never replaced,
// so re-running cannot churn IDs already written into constants.js. To replace
// one, delete it in the Developer Portal (Emojis tab) and re-run.

const fs = require('fs');
const path = require('path');
const { readEnv, readBotToken, discord, getApp } = require('./discord-api.cjs');

const ROOT = path.join(__dirname, '..');
const { CREWS } = require(path.join(ROOT, 'src/crews.js'));
const CONSTANTS_PATH = path.join(ROOT, 'functions', 'constants.js');

// Discord caps an emoji image at 256 KB. The crew icons are ~15-35 KB, so this
// is a guard against someone dropping a full-resolution art file in later.
const MAX_EMOJI_BYTES = 256 * 1024;

// Emoji names allow [A-Za-z0-9_] only, 2-32 chars. Crew ids are already
// SCREAMING_SNAKE, so lowercasing is the whole transform.
const emojiName = (crewId) => `crew_${crewId.toLowerCase()}`;

// crews.js stores a web path ('/crews/big deal.png'); the file lives in public/.
const iconPath = (crew) => path.join(ROOT, 'public', crew.icon.replace(/^\//, ''));

function toDataUri(file) {
  const buf = fs.readFileSync(file);
  if (buf.length > MAX_EMOJI_BYTES) {
    throw new Error(`${path.basename(file)} is ${Math.round(buf.length / 1024)} KB; Discord's limit is 256 KB`);
  }
  return `data:image/png;base64,${buf.toString('base64')}`;
}

// App emojis come back wrapped ({ items: [...] }); guild emojis come back as a
// bare array. Normalising here keeps the rest of the script from caring.
const listAppEmojis = async (token, appId) =>
  ((await discord(token, `/applications/${appId}/emojis`)) || {}).items || [];

const markup = (e) => `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`;

// Emoji names are typed by hand in Discord: the Stockism server's crew set is
// named `stockism_gapryongkimfistgang`, `stockism_bigdeal`, `kitaeunion`, and so
// on. Flattening to letters and digits and then matching on containment finds
// all of those without anyone having to rename an emoji.
const flat = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The best emoji for a crew, searching a list of sources in priority order.
 *
 * Order matters more than the matching does. Two servers can both have an
 * `:allied:` — the Stockism server's crew art and someone else's unrelated one —
 * so the home server (the one we actually post into) is searched before any
 * other, and the app's own emojis before that.
 */
function pickEmoji(crew, sources) {
  const want = [flat(emojiName(crew.id)), flat(crew.id), flat(crew.name)];
  for (const src of sources) {
    const exact = src.emojis.find((e) => want.includes(flat(e.name)));
    if (exact) return { emoji: exact, source: src.label };
    const partial = src.emojis.find((e) => want.some((w) => flat(e.name).includes(w)));
    if (partial) return { emoji: partial, source: src.label };
  }
  return null;
}

/** Current CREW_EMOJIS values, parsed out of constants.js without executing it. */
function readCurrentMap() {
  const src = fs.readFileSync(CONSTANTS_PATH, 'utf8');
  const block = src.match(/const CREW_EMOJIS = \{([\s\S]*?)\n\};/);
  if (!block) throw new Error('Could not find the CREW_EMOJIS block in functions/constants.js');
  const map = {};
  block[1].split('\n').forEach((line) => {
    const m = line.match(/^\s*([A-Z_]+):\s*'(.*)',?\s*$/);
    if (m) map[m[1]] = m[2];
  });
  return map;
}

/**
 * Rewrite the CREW_EMOJIS block in place.
 *
 * Only the values change — the surrounding comment, which is where the "why
 * application emojis" reasoning lives, is left alone. A crew with no emoji in
 * Discord keeps its blank entry and falls back to the Unicode emblem.
 */
function writeMap(resolved) {
  const src = fs.readFileSync(CONSTANTS_PATH, 'utf8');
  // constants.js is CRLF on the Windows dev machine. Joining with plain \n
  // would leave the one block LF, which shows up as a whole-file diff in git
  // and makes the "already up to date" check below never fire.
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const body = Object.keys(CREWS)
    .map((id) => `  ${id}: '${resolved[id] || ''}',`)
    .join(eol);
  const next = src.replace(
    /const CREW_EMOJIS = \{[\s\S]*?\r?\n\};/,
    `const CREW_EMOJIS = {${eol}${body}${eol}};`,
  );
  if (next === src) {
    console.log('CREW_EMOJIS already matches Discord — nothing to write.');
    return;
  }
  fs.writeFileSync(CONSTANTS_PATH, next);
  console.log(`Wrote CREW_EMOJIS into functions/constants.js (deploy functions to take effect).`);
}

async function main() {
  const upload = process.argv.includes('--upload');
  const write = process.argv.includes('--write');

  const token = readBotToken();
  const app = await getApp(token);
  console.log(`App: ${app.name} (${app.id})\n`);

  let appEmojis = await listAppEmojis(token, app.id);

  if (upload) {
    for (const crew of Object.values(CREWS)) {
      const name = emojiName(crew.id);
      if (appEmojis.some((e) => e.name === name)) {
        console.log(`  = ${name} already exists, skipped`);
        continue;
      }
      const file = iconPath(crew);
      if (!fs.existsSync(file)) {
        console.log(`  ! ${name}: no icon at public${crew.icon}`);
        continue;
      }
      const created = await discord(token, `/applications/${app.id}/emojis`, {
        method: 'POST',
        body: JSON.stringify({ name, image: toDataUri(file) }),
      });
      console.log(`  + ${name} uploaded`);
      appEmojis.push(created);
    }
    console.log('');
    appEmojis = await listAppEmojis(token, app.id);
  }

  // Server emojis are a valid source too — the crew set was hand-added to the
  // Stockism server long before any of this existed, so it gets picked up by
  // name rather than uploaded a second time.
  //
  // "Home" is whichever server owns DISCORD_CHANNEL_ID, the channel the updates
  // actually post to. Asking Discord beats hardcoding a guild ID, and it is the
  // tiebreak that stops an unrelated server's same-named emoji from winning.
  const guilds = await discord(token, '/users/@me/guilds');
  let homeGuildId = '';
  const channelId = readEnv('DISCORD_CHANNEL_ID');
  if (channelId) {
    homeGuildId = (await discord(token, `/channels/${channelId}`)).guild_id || '';
  }
  guilds.sort((a, b) => (b.id === homeGuildId) - (a.id === homeGuildId));

  const guildEmojis = [];
  const sources = [{ label: 'application', emojis: appEmojis }];
  for (const g of guilds) {
    const emojis = await discord(token, `/guilds/${g.id}/emojis`);
    emojis.forEach((e) => guildEmojis.push({ ...e, guild: g.name }));
    sources.push({ label: g.id === homeGuildId ? `${g.name} (home)` : g.name, emojis });
  }

  const current = readCurrentMap();
  const resolved = {};
  console.log('Crew                      source              emoji');
  console.log('----------------------------------------------------------------------');
  for (const crew of Object.values(CREWS)) {
    const pick = pickEmoji(crew, sources);
    resolved[crew.id] = pick ? markup(pick.emoji) : current[crew.id] || '';
    const source = pick ? pick.source : 'none';
    const shown = resolved[crew.id] || `${crew.emblem}  (Unicode fallback)`;
    console.log(`${crew.name.padEnd(26)}${source.slice(0, 18).padEnd(20)}${shown}`);
  }

  console.log(`\nBot is in: ${guilds.map((g) => g.name).join(', ')}`);
  console.log(`It may use any of those servers' ${guildEmojis.length} emoji(s) in any message it sends, anywhere.`);
  if (process.argv.includes('--all')) {
    console.log('  ' + guildEmojis.map((e) => `:${e.name}: ${markup(e)}`).join('\n  '));
  } else {
    console.log('Pass --all to list them.');
  }
  console.log('');

  if (write) {
    writeMap(resolved);
  } else {
    const changed = Object.keys(resolved).some((id) => resolved[id] !== (current[id] || ''));
    console.log(changed
      ? 'Re-run with --write to put these IDs into functions/constants.js.'
      : 'functions/constants.js is already up to date.');
  }
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
