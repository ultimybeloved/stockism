// Registers the companion bot's slash commands with Discord.
//
// Usage:
//   node scripts/register-discord-commands.cjs           # register/update
//   node scripts/register-discord-commands.cjs --list    # show what's registered
//
// Run this once after deploying, and again any time the command list below
// changes. It is idempotent: Discord replaces the whole command set with what
// is sent, so re-running is always safe.
//
// WHY THE APP ID IS LOOKED UP INSTEAD OF READ FROM .env:
// This project has TWO Discord applications — the "Stockism Updates" bot (owns
// DISCORD_BOT_TOKEN, sends messages, and owns the interactions endpoint) and a
// separate login app (owns DISCORD_CLIENT_ID/SECRET for OAuth). Commands MUST be
// registered on the same app whose public key verifies our webhook, which is the
// bot-token app — NOT DISCORD_CLIENT_ID. Registering on the wrong one produces
// commands that appear in Discord and then fail silently. Asking Discord which
// app the token belongs to removes the guess entirely.

const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', 'functions', '.env');
const API = 'https://discord.com/api/v10';

function readBotToken() {
  if (process.env.DISCORD_BOT_TOKEN) return process.env.DISCORD_BOT_TOKEN;
  if (!fs.existsSync(ENV_PATH)) {
    throw new Error(`No DISCORD_BOT_TOKEN in the environment and no ${ENV_PATH} to read it from.`);
  }
  const line = fs.readFileSync(ENV_PATH, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith('DISCORD_BOT_TOKEN='));
  if (!line) throw new Error('DISCORD_BOT_TOKEN not found in functions/.env');
  return line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
}

// Discord option types we use.
const STRING = 3;
const USER = 6;

const COMMANDS = [
  {
    name: 'leaderboard',
    description: 'See the top traders on Stockism',
  },
  {
    name: 'profile',
    description: 'View a Stockism profile',
    options: [{
      type: USER,
      name: 'user',
      description: 'Whose profile to show (defaults to you)',
      required: false,
    }],
  },
  {
    name: 'price',
    description: 'Check the current price of a stock',
    options: [{
      type: STRING,
      name: 'stock',
      description: 'Ticker or character name, e.g. DG or James Lee',
      required: true,
    }],
  },
  {
    name: 'portfolio',
    description: 'See your holdings (only you can see the reply)',
  },
  {
    name: 'missions',
    description: 'See your daily and weekly missions (only you can see the reply)',
  },
  {
    name: 'buy',
    description: 'Get a link to trade a stock on the website',
    options: [{
      type: STRING,
      name: 'stock',
      description: 'Ticker or character name, e.g. DG or James Lee',
      required: true,
    }],
  },
];

async function discord(token, route, options = {}) {
  const res = await fetch(`${API}${route}`, {
    ...options,
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Discord ${options.method || 'GET'} ${route} failed (${res.status}): ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function main() {
  const token = readBotToken();
  const app = await discord(token, '/oauth2/applications/@me');

  console.log(`App:  ${app.name} (${app.id})`);
  console.log(`Public bot (installable in other servers): ${app.bot_public ? 'YES' : 'NO'}`);

  if (process.argv.includes('--list')) {
    const existing = await discord(token, `/applications/${app.id}/commands`);
    console.log(`\n${existing.length} command(s) registered:`);
    existing.forEach((c) => console.log(`  /${c.name} — ${c.description}`));
    return;
  }

  const result = await discord(token, `/applications/${app.id}/commands`, {
    method: 'PUT',
    body: JSON.stringify(COMMANDS),
  });

  console.log(`\nRegistered ${result.length} global command(s):`);
  result.forEach((c) => console.log(`  /${c.name}`));

  if (!app.bot_public) {
    console.log(
      '\nNOTE: this bot is currently PRIVATE, so only you can add it to a server.\n' +
      'To let partner servers install it, turn on "Public Bot" at\n' +
      `https://discord.com/developers/applications/${app.id}/bot`
    );
  }

  console.log(
    '\nGlobal commands can take up to an hour to appear the first time.\n' +
      'Install link for partner servers:\n' +
      `https://discord.com/oauth2/authorize?client_id=${app.id}&scope=applications.commands+bot&permissions=0`
  );
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
