'use strict';
// Discord: alerts, channels, crew head roles, crew emojis, slash commands.

// ============================================
// DISCORD ALERTS
// ============================================
const WHALE_ALERT_SHARES_SOFT = 50; // shares threshold (combined with price check) for whale alert
const WHALE_ALERT_PRICE_SOFT = 35; // price threshold (combined with shares check) for whale alert
const WHALE_ALERT_SHARES_HARD = 100; // shares threshold alone triggers whale alert regardless of price
const CREW_MILESTONE_THRESHOLDS = [5, 10, 25, 50, 100]; // crew member counts that trigger Discord alerts

// ============================================
// DISCORD CHANNELS
// ============================================
// Channel the daily free-stock drop posts to. Used by discord.js (dailyFreeStock) and
// health.js (discordHealthCheck) — single source of truth so the two can't drift.
const DISCORD_DAILY_DROP_CHANNEL = '1483767343581761658';

// ============================================
// DISCORD CREW HEAD ROLES (discordRoles.js)
// ============================================
// Every Monday the weekly crew rankings crown a head per crew. These roles
// make that visible in Discord: the head wears their crew's role, which colors
// their name (and shows the crew icon beside it if the server is Boost Level
// 2 — colors work at any level, icons silently don't below 2).
//
// The bot NEVER creates or edits roles. The roles are made by hand in Discord
// with whatever name/color/icon we want; the bot only adds and removes
// assignments, so its permission stays at Manage Roles alone. Its own role
// must sit ABOVE these in the hierarchy or Discord rejects every call with 403.
//
// Guild and role IDs live here rather than .env because they are not secrets
// (every server member can see them) and a mistyped ID is invisible forever in
// a gitignored file but obvious in a diff. The bot TOKEN stays in .env.
//
// A blank role ID disables that crew entirely — no add, no remove. All blank
// (the default) no-ops the whole feature, so this ships safely before the
// Discord side is set up.
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || '';
const CREW_HEAD_ROLE_IDS = {
  ALLIED: '',
  BIG_DEAL: '',
  FIST_GANG: '',
  GOD_DOG: '',
  SECRET_FRIENDS: '',
  HOSTEL: '',
  WTJC: '',
  WORKERS: '',
  YAMAZAKI: '',
  KITAE_UNION: '',
};
// ============================================
// DISCORD CREW EMOJIS (helpers.crewEmoji)
// ============================================
// The crew emblems in crews.js are plain Unicode (a handshake, a fist) because
// the website can only render Unicode. Discord can do better: these are the
// real crew icons as custom emojis, so an embed shows the same artwork the site
// does.
//
// These are the Stockism server's own `:stockism_*:` crew emojis. A bot may use
// any emoji from any server it is a member of, in any message, anywhere — no
// Nitro, and the emoji renders for everyone who sees the message, including
// people who are not in the server it came from. So these work in the partner
// servers the bot is installed in too.
//
// The one exposure is that these IDs belong to a server, not to us: if someone
// deletes or replaces one of those emojis, or the bot is removed from the
// server, the embed can end up showing stale art or raw `<:name:id>` text.
// `npm run discord:emojis` shows the current state; `--upload` copies the crew
// icons onto the Stockism Updates app itself as application emojis, which
// nothing outside the app can break.
//
// Do NOT hand-edit this block — run `node scripts/sync-crew-emojis.cjs --write`.
//
// Format is Discord's inline emoji markup, `<:name:id>` (animated: `<a:name:id>`).
// It renders in message content and everywhere inside an embed that takes text,
// including field names and titles — but NOT in an embed author/footer name, and
// NOT on a button, which needs the structured `{ emoji: { id, name } }` form.
//
// A blank entry falls back to that crew's Unicode emblem, so this ships safely
// half-filled and degrades to exactly today's output when empty.
// IDs live here rather than .env for the same reason the role IDs do: they are
// not secrets, and a mistyped one is obvious in a diff and invisible in a
// gitignored file.
const CREW_EMOJIS = {
  ALLIED: '<:stockism_allied:1466671644427948208>',
  BIG_DEAL: '<:stockism_bigdeal:1466671715701493951>',
  FIST_GANG: '<:stockism_gapryongkimfistgang:1466671819955372199>',
  GOD_DOG: '<:stockism_goddog:1466671860392525844>',
  SECRET_FRIENDS: '<:stockism_gookimsecretfriends:1466671940340023540>',
  HOSTEL: '<:stockism_hostel:1466671994971099321>',
  WTJC: '<:stockism_whitetigerjobcenterwtjc:1466672073005993985>',
  WORKERS: '<:stockism_workers:1466672134393954324>',
  KITAE_UNION: '<:kitaeunion:1535475594329071787>',
  YAMAZAKI: '<:stockism_yamazakisyndicate:1466672168921337866>',
};
// Matches `<:name:123...>` and `<a:name:123...>`. Anything in CREW_EMOJIS that
// fails this is ignored in favour of the Unicode emblem — a half-pasted ID
// would otherwise print as literal text in the middle of an embed.
const DISCORD_EMOJI_PATTERN = /^<a?:[A-Za-z0-9_]{2,32}:\d{17,20}>$/;

// Discord snowflakes are 17-20 digits. Catches a truncated paste, the single
// likeliest setup mistake.
const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/;
const DISCORD_API_TIMEOUT_MS = 10000; // per request
const DISCORD_ROLE_CALL_SPACING_MS = 300; // polite gap between role writes
const DISCORD_ROLE_SYNC_BUDGET_MS = 25000; // whole-sync wall clock ceiling
const DISCORD_ROLE_RETRY_MAX_MS = 5000; // longest 429 retry_after we wait out

// ============================================
// DISCORD SLASH COMMANDS (discordCommands.js)
// ============================================
// The bot is installable in partner servers, so command traffic comes from
// people we don't control. Per-user cooldown keeps a spam loop in one server
// from burning the Firestore free tier. Held in instance memory only — a cold
// start clears it, which is fine because the cap exists to blunt sustained
// spam, not to be an exact quota.
const DISCORD_COMMAND_COOLDOWN_MS = 3 * 1000;
// How long a warm instance will wait for a command's reads before giving up and
// deferring instead. Discord hard-kills any interaction not acknowledged within
// 3s, so this must leave comfortable room for the response to travel back.
const DIRECT_REPLY_BUDGET_MS = 1200;
// Public site URL. Slash-command replies deep-link back here (this is the whole
// point of the "trade on the website" buttons).
const SITE_URL = 'https://stockism.app';
// How many leaderboard rows a /leaderboard reply shows. Discord embeds get
// unreadable past ~10 lines on mobile.
const DISCORD_LEADERBOARD_ROWS = 10;
// How many holdings a /portfolio reply shows before it summarises the rest.
const DISCORD_PORTFOLIO_ROWS = 8;

module.exports = {
  WHALE_ALERT_SHARES_SOFT,
  WHALE_ALERT_PRICE_SOFT,
  WHALE_ALERT_SHARES_HARD,
  CREW_MILESTONE_THRESHOLDS,
  DISCORD_DAILY_DROP_CHANNEL,
  DISCORD_GUILD_ID,
  CREW_HEAD_ROLE_IDS,
  CREW_EMOJIS,
  DISCORD_EMOJI_PATTERN,
  DISCORD_SNOWFLAKE_PATTERN,
  DISCORD_API_TIMEOUT_MS,
  DISCORD_ROLE_CALL_SPACING_MS,
  DISCORD_ROLE_SYNC_BUDGET_MS,
  DISCORD_ROLE_RETRY_MAX_MS,
  DISCORD_COMMAND_COOLDOWN_MS,
  DIRECT_REPLY_BUDGET_MS,
  SITE_URL,
  DISCORD_LEADERBOARD_ROWS,
  DISCORD_PORTFOLIO_ROWS,
};
