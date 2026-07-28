'use strict';
// Slash-command handlers for the Stockism companion bot.
//
// Internal module — NOT exported through functions/index.js. discordInteractions.js
// owns the HTTP endpoint and signature check, defers the reply, then calls
// handleSlashCommand() here and edits the result in.
//
// Design rules for everything in this file:
//   * READ ONLY. No command mutates game state. Trading happens on the website —
//     /buy hands back a deep link, it does not place an order. This keeps the
//     bot entirely outside executeTrade's auth and anti-abuse surface.
//   * CHEAP. The bot is installable in partner servers we don't control, so
//     every command is a small, bounded number of Firestore reads. Nothing here
//     scans the users collection.
//   * FRIENDLY TO STRANGERS. Most people running these commands in a partner
//     server have no Stockism account. "Not linked" is a signup pitch, not an error.

const admin = require('firebase-admin');
const db = admin.firestore();

const { CHARACTERS } = require('../characters');
const {
  DISCORD_COMMAND_COOLDOWN_MS, DISCORD_LEADERBOARD_ROWS, DISCORD_PORTFOLIO_ROWS,
  SITE_URL, LEADERBOARD_CACHE_TTL,
} = require('../constants');
const { getDailyMissions, getCrewWeeklyMissions } = require('../crews');
const { DAILY_MISSION_CHECKS, WEEKLY_MISSION_CHECKS } = require('./missionChecks');
const { countRankAbove, getWeekId } = require('../helpers');

const BRAND_COLOR = 0x5865f2;
const EPHEMERAL = 64;

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const money = (n) => `$${(Number(n) || 0).toLocaleString('en-US', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})}`;

const signedPct = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

// Any user-supplied text echoed back into an embed must be escaped and capped.
// Discord renders markdown inside embeds, so an unescaped echo lets someone run
// `/price [totally legit](https://evil.example)` and get the BOT — which carries
// more trust than they do, especially in a partner server — to render their link.
// Backslash-escape markdown punctuation and truncate to keep embeds in limits.
const safeEcho = (input, max = 60) => {
  const text = String(input == null ? '' : input).slice(0, max);
  return text.replace(/[\\`*_~|<>[\]()#@:-]/g, (ch) => `\\${ch}`);
};

const MEDALS = ['🥇', '🥈', '🥉'];
const rankLabel = (i) => MEDALS[i] || `\`#${String(i + 1).padStart(2, ' ')}\``;

const CHAR_BY_TICKER = new Map(CHARACTERS.map((c) => [c.ticker.toUpperCase(), c]));

// Resolve free text to a ticker: exact ticker first, then name / alt-name match.
// Players type "/price james lee" as often as "/price DG".
const resolveTicker = (input) => {
  if (!input) return null;
  const q = String(input).trim().toUpperCase();
  if (CHAR_BY_TICKER.has(q)) return CHAR_BY_TICKER.get(q);
  const lower = q.toLowerCase();
  return CHARACTERS.find((c) => c.name.toLowerCase() === lower)
    || CHARACTERS.find((c) => (c.altNames || []).some((a) => a.toLowerCase() === lower))
    || CHARACTERS.find((c) => c.name.toLowerCase().includes(lower))
    || null;
};

const linkButton = (label, url, emoji) => ({
  type: 2, style: 5, label, url, ...(emoji ? { emoji: { name: emoji } } : {}),
});

const buttonRow = (...buttons) => ({ type: 1, components: buttons.filter(Boolean) });

// ---------------------------------------------------------------------------
// Signup funnel
// ---------------------------------------------------------------------------

// Most /profile and /portfolio calls in a partner server come from someone with
// no account. That is the single best moment to pitch them, so it gets a real
// reply rather than an error.
const signupPitch = (what) => ({
  embeds: [{
    color: BRAND_COLOR,
    title: '📈 You are not on Stockism yet',
    description:
      `${what}\n\n` +
      'Stockism is a stock market for characters. You start with cash, buy who you ' +
      'think is going up, and climb the leaderboard.\n\n' +
      'Already have an account? Link your Discord and this command will work here.',
  }],
  components: [buttonRow(
    linkButton('Create an account', SITE_URL, '🚀'),
    linkButton('Link my Discord', `${SITE_URL}/link-discord`, '🔗'),
  )],
});

// ---------------------------------------------------------------------------
// Shared reads
// ---------------------------------------------------------------------------

const marketRef = () => db.collection('market').doc('current');

// Prices + the last pre-halt snapshot, so /price can show the move since the
// chapter opened. Both are single small docs.
const readMarket = async (withSnapshot = false) => {
  const reads = [marketRef().get()];
  if (withSnapshot) reads.push(db.collection('market').doc('preHaltSnapshot').get());
  const [marketSnap, snapshotSnap] = await Promise.all(reads);
  return {
    prices: marketSnap.exists ? (marketSnap.data().prices || {}) : {},
    launchedTickers: marketSnap.exists ? (marketSnap.data().launchedTickers || []) : [],
    marketHalted: marketSnap.exists ? !!marketSnap.data().marketHalted : false,
    previousPrices: snapshotSnap && snapshotSnap.exists ? (snapshotSnap.data().prices || {}) : {},
  };
};

// The account behind a Discord ID, or null. One indexed query.
const findUserByDiscordId = async (discordId) => {
  if (!discordId) return null;
  const snap = await db.collection('users').where('discordId', '==', discordId).limit(1).get();
  return snap.empty ? null : { uid: snap.docs[0].id, data: snap.docs[0].data() };
};

const portfolioValue = (userData, prices) => {
  const holdings = userData.holdings || {};
  const held = Object.entries(holdings)
    .reduce((sum, [t, s]) => sum + (s > 0 ? s * (prices[t] || 0) : 0), 0);
  return (userData.cash || 0) + held;
};

// ---------------------------------------------------------------------------
// /leaderboard
// ---------------------------------------------------------------------------

// Reads the same cached leaderboard doc the website uses. If it is stale the bot
// shows it anyway with a note rather than kicking off a full recompute — a
// partner server should never be able to trigger a users-collection scan.
const cmdLeaderboard = async () => {
  const snap = await db.collection('leaderboard').doc('global').get();
  const entries = snap.exists ? (snap.data().entries || []) : [];

  if (entries.length === 0) {
    return {
      embeds: [{
        color: BRAND_COLOR,
        title: '🏆 Leaderboard',
        description: 'The leaderboard is still being built. Try again in a few minutes.',
      }],
      components: [buttonRow(linkButton('Open Stockism', `${SITE_URL}/leaderboard`, '📈'))],
    };
  }

  // Display names are validated to letters/numbers/underscores, so they can't
  // carry a link — but an underscore still italicises in Discord, so escape them
  // to render names literally (and stay safe if that validation ever loosens).
  const rows = entries.slice(0, DISCORD_LEADERBOARD_ROWS).map((e, i) =>
    `${rankLabel(i)} **${safeEcho(e.displayName || 'Anonymous', 32)}** — ${money(e.portfolioValue)}`
  );

  const generatedAt = snap.data().generatedAt || 0;
  const stale = Date.now() - generatedAt > LEADERBOARD_CACHE_TTL;

  return {
    embeds: [{
      color: BRAND_COLOR,
      title: '🏆 Top Traders',
      description: rows.join('\n'),
      footer: { text: stale ? 'Updates every few minutes' : 'Live' },
    }],
    components: [buttonRow(linkButton('Full leaderboard', `${SITE_URL}/leaderboard`, '🏆'))],
  };
};

// ---------------------------------------------------------------------------
// /profile
// ---------------------------------------------------------------------------

const cmdProfile = async (interaction) => {
  // Optional user option: /profile @someone. Falls back to the caller.
  const targetOption = (interaction.data.options || []).find((o) => o.name === 'user');
  const targetId = targetOption ? targetOption.value : callerDiscordId(interaction);
  const isSelf = targetId === callerDiscordId(interaction);

  const found = await findUserByDiscordId(targetId);
  if (!found) {
    return isSelf
      ? signupPitch('Link your account to see your profile here.')
      : {
        embeds: [{
          color: BRAND_COLOR,
          title: 'No account found',
          description: 'That person has not linked a Stockism account yet.',
        }],
        components: [buttonRow(linkButton('Create an account', SITE_URL, '🚀'))],
      };
  }

  const { data } = found;
  const { prices } = await readMarket();
  const value = portfolioValue(data, prices);
  const rank = await countRankAbove(value, null);

  const holdings = data.holdings || {};
  const distinct = Object.values(holdings).filter((s) => s > 0).length;
  const achievements = Array.isArray(data.achievements) ? data.achievements.length : 0;

  const fields = [
    { name: 'Net worth', value: money(value), inline: true },
    { name: 'Rank', value: `#${rank}`, inline: true },
    { name: 'Cash', value: money(data.cash), inline: true },
    { name: 'Stocks held', value: `${distinct}`, inline: true },
    { name: 'Achievements', value: `${achievements}`, inline: true },
  ];
  if (data.crew) fields.push({ name: 'Crew', value: `${data.crew}`, inline: true });

  const name = data.displayName || 'Anonymous';
  return {
    embeds: [{
      color: BRAND_COLOR,
      title: `${data.isCrewHead ? '👑 ' : ''}${name}`,
      fields,
    }],
    components: [buttonRow(
      linkButton('View profile', data.isPublic && data.displayName
        ? `${SITE_URL}/u/${encodeURIComponent(data.displayName)}`
        : SITE_URL, '👤'),
    )],
  };
};

// ---------------------------------------------------------------------------
// /price
// ---------------------------------------------------------------------------

const cmdPrice = async (interaction) => {
  const raw = (interaction.data.options || []).find((o) => o.name === 'stock');
  const character = resolveTicker(raw && raw.value);

  if (!character) {
    return {
      embeds: [{
        color: BRAND_COLOR,
        title: 'Not found',
        description: `No stock matches **${safeEcho(raw && raw.value)}**. Try a ticker like \`DG\`, or a character name.`,
      }],
      components: [buttonRow(linkButton('Browse all stocks', SITE_URL, '📈'))],
    };
  }

  const { prices, previousPrices, launchedTickers, marketHalted } = await readMarket(true);
  const price = prices[character.ticker];

  if (price == null) {
    const unlaunched = character.ipoRequired && !launchedTickers.includes(character.ticker);
    return {
      embeds: [{
        color: BRAND_COLOR,
        title: `${character.name} (${character.ticker})`,
        description: unlaunched
          ? 'Not trading yet. This one launches in a future IPO.'
          : 'No price available right now.',
      }],
      components: [buttonRow(linkButton('Open Stockism', SITE_URL, '📈'))],
    };
  }

  const previous = previousPrices[character.ticker];
  const change = previous > 0 ? ((price - previous) / previous) * 100 : null;
  const arrow = change == null ? '' : change > 0 ? '🟢' : change < 0 ? '🔴' : '⚪';

  const fields = [{ name: 'Price', value: money(price), inline: true }];
  if (change != null) {
    fields.push({ name: 'Since chapter open', value: `${arrow} ${signedPct(change)}`, inline: true });
  }

  return {
    embeds: [{
      color: BRAND_COLOR,
      title: `${character.name} (${character.ticker})`,
      fields,
      footer: marketHalted ? { text: 'Market is halted for chapter review' } : undefined,
    }],
    components: [buttonRow(
      linkButton('Trade on Stockism', `${SITE_URL}/stock/${character.ticker}`, '💸'),
    )],
  };
};

// ---------------------------------------------------------------------------
// /portfolio
// ---------------------------------------------------------------------------

const cmdPortfolio = async (interaction) => {
  const found = await findUserByDiscordId(callerDiscordId(interaction));
  if (!found) return signupPitch('Link your account to see your portfolio here.');

  const { data } = found;
  const { prices } = await readMarket();

  const rows = Object.entries(data.holdings || {})
    .filter(([, shares]) => shares > 0)
    .map(([ticker, shares]) => ({
      ticker,
      shares,
      value: shares * (prices[ticker] || 0),
      name: (CHAR_BY_TICKER.get(ticker.toUpperCase()) || {}).name || ticker,
    }))
    .sort((a, b) => b.value - a.value);

  const total = portfolioValue(data, prices);
  const shown = rows.slice(0, DISCORD_PORTFOLIO_ROWS);
  const rest = rows.slice(DISCORD_PORTFOLIO_ROWS);

  let description;
  if (rows.length === 0) {
    description = 'You do not own any stocks yet.';
  } else {
    description = shown
      .map((r) => `**${r.ticker}** ${r.shares}× — ${money(r.value)}`)
      .join('\n');
    if (rest.length > 0) {
      const restValue = rest.reduce((s, r) => s + r.value, 0);
      description += `\n*+ ${rest.length} more worth ${money(restValue)}*`;
    }
  }

  return {
    embeds: [{
      color: BRAND_COLOR,
      title: '💼 Your Portfolio',
      description,
      fields: [
        { name: 'Net worth', value: money(total), inline: true },
        { name: 'Cash', value: money(data.cash), inline: true },
      ],
    }],
    components: [buttonRow(linkButton('Manage portfolio', SITE_URL, '💼'))],
  };
};

// ---------------------------------------------------------------------------
// /missions
// ---------------------------------------------------------------------------

const cmdMissions = async (interaction) => {
  const found = await findUserByDiscordId(callerDiscordId(interaction));
  if (!found) return signupPitch('Link your account to track your missions here.');

  const { data } = found;
  if (!data.crew) {
    return {
      embeds: [{
        color: BRAND_COLOR,
        title: '🎯 Missions',
        description: 'Pick a crew on the website to start getting missions.',
      }],
      components: [buttonRow(linkButton('Choose a crew', `${SITE_URL}/profile`, '🏴'))],
    };
  }

  const { prices } = await readMarket();
  const today = new Date().toISOString().split('T')[0];
  const weekId = getWeekId();

  const dailyProgress = (data.dailyMissions || {})[today] || {};
  const weeklyProgress = (data.weeklyMissions || {})[weekId] || {};
  const seed = weeklyProgress.rerollSeed || 0;

  const render = (missions, progress, checks, claimedMap) => missions.map((m) => {
    const claimed = !!(claimedMap || {})[m.id];
    const check = checks[m.id];
    const done = check ? check(progress, data, prices) : false;
    const icon = claimed ? '✅' : done ? '🎁' : '⬜';
    const suffix = claimed ? '' : done ? ' — **ready to claim**' : '';
    return `${icon} ${m.name || m.id}${suffix}`;
  }).join('\n') || 'None assigned.';

  const daily = getDailyMissions(today, data.crew, seed);
  const weekly = getCrewWeeklyMissions(data.crew, weekId, seed);

  return {
    embeds: [{
      color: BRAND_COLOR,
      title: '🎯 Your Missions',
      fields: [
        { name: 'Daily', value: render(daily, dailyProgress, DAILY_MISSION_CHECKS, dailyProgress.claimed) },
        { name: 'Weekly', value: render(weekly, weeklyProgress, WEEKLY_MISSION_CHECKS, weeklyProgress.claimed) },
      ],
      footer: { text: 'Claim rewards on the website' },
    }],
    components: [buttonRow(linkButton('Claim rewards', SITE_URL, '🎁'))],
  };
};

// ---------------------------------------------------------------------------
// /buy — deep link only, never places an order
// ---------------------------------------------------------------------------

const cmdBuy = async (interaction) => {
  const raw = (interaction.data.options || []).find((o) => o.name === 'stock');
  const character = resolveTicker(raw && raw.value);

  if (!character) {
    return {
      embeds: [{
        color: BRAND_COLOR,
        title: 'Not found',
        description: `No stock matches **${safeEcho(raw && raw.value)}**. Try a ticker like \`DG\`, or a character name.`,
      }],
      components: [buttonRow(linkButton('Browse all stocks', SITE_URL, '📈'))],
    };
  }

  const { prices, marketHalted } = await readMarket();
  const price = prices[character.ticker];

  return {
    embeds: [{
      color: BRAND_COLOR,
      title: `Trade ${character.name} (${character.ticker})`,
      description: price != null
        ? `Currently **${money(price)}** per share.`
        : 'Not trading yet.',
      footer: {
        text: marketHalted
          ? 'Market is halted for chapter review — you can still queue an order'
          : 'Trades happen on the website so you can see the price impact first',
      },
    }],
    components: [buttonRow(
      linkButton('Open trade page', `${SITE_URL}/stock/${character.ticker}`, '💸'),
    )],
  };
};

// ---------------------------------------------------------------------------
// Cooldown + dispatch
// ---------------------------------------------------------------------------

const callerDiscordId = (interaction) =>
  (interaction.member && interaction.member.user && interaction.member.user.id)
  || (interaction.user && interaction.user.id)
  || null;

// Instance-memory cooldown. Trimmed opportunistically so a busy instance cannot
// grow this map without bound.
const lastCommandAt = new Map();
const onCooldown = (discordId) => {
  if (!discordId) return false;
  const now = Date.now();
  if (lastCommandAt.size > 5000) {
    for (const [id, ts] of lastCommandAt) {
      if (now - ts > DISCORD_COMMAND_COOLDOWN_MS) lastCommandAt.delete(id);
    }
  }
  const previous = lastCommandAt.get(discordId);
  if (previous && now - previous < DISCORD_COMMAND_COOLDOWN_MS) return true;
  lastCommandAt.set(discordId, now);
  return false;
};

const HANDLERS = {
  leaderboard: cmdLeaderboard,
  profile: cmdProfile,
  price: cmdPrice,
  portfolio: cmdPortfolio,
  missions: cmdMissions,
  buy: cmdBuy,
};

// Commands whose reply is only meaningful to the caller. Public commands post
// visibly so partner servers get the shared-moment effect.
const PRIVATE_COMMANDS = new Set(['portfolio', 'missions']);

const isPrivate = (name) => PRIVATE_COMMANDS.has(name);

// Returns the message payload to edit into the deferred reply, or null if the
// command is unknown.
const handleSlashCommand = async (interaction) => {
  const name = interaction.data && interaction.data.name;
  const handler = HANDLERS[name];
  if (!handler) return null;

  if (onCooldown(callerDiscordId(interaction))) {
    return { content: 'Slow down a moment, then try again.' };
  }

  return handler(interaction);
};

module.exports = { handleSlashCommand, isPrivate, EPHEMERAL, HANDLERS };
