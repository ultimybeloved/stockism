'use strict';
// Discord REST calls: channel posts, DMs, market status alerts.

const admin = require('firebase-admin');
const axios = require('axios');
const { reportError } = require('./sentry');
const {
  DISCORD_API_TIMEOUT_MS,
  CREW_EMOJIS,
  DISCORD_EMOJI_PATTERN,
  CREWS,
  discordTime,
  msUntilWeekly,
  PRE_MARKET_START_MINUTE,
  WEEKLY_HALT_END_MINUTE,
} = require('./constants');

/**
 * The emoji that stands for a crew in Discord.
 *
 * Prefers the custom crew emoji (CREW_EMOJIS in constants.js) and falls back to
 * the Unicode emblem from crews.js, which is what the website shows. Returns ''
 * for an unknown crew id so callers can interpolate it blindly.
 *
 * Anything in CREW_EMOJIS that is not well-formed `<:name:id>` markup is treated
 * as absent: a half-pasted ID would otherwise print as literal angle brackets in
 * the middle of an embed, which looks far worse than the plain emblem.
 */
function crewEmoji(crewId) {
  const custom = CREW_EMOJIS[crewId];
  if (custom && DISCORD_EMOJI_PATTERN.test(custom)) return custom;
  return (CREWS[crewId] && CREWS[crewId].emblem) || '';
}

/**
 * One raw call to the Discord REST API as the bot.
 *
 * Deliberately does NOT throw on HTTP errors — Discord answers with meaningful
 * status codes (404 member gone, 403 role hierarchy, 429 rate limit) that
 * callers need to branch on, and try/catch flattens them all into one blob.
 * Only network failures and timeouts throw. A missing bot token comes back as
 * `{ status: 0 }` so callers have a single shape to handle.
 *
 * @param {string} method - 'get' | 'put' | 'delete' | 'post' | 'patch'
 * @param {string} path - API path after /v10, e.g. `/guilds/123/roles`
 * @param {Object} [opts] - { body, reason } — `reason` becomes the Discord
 *        audit-log entry, which is how a server admin sees WHY the bot acted.
 */
async function discordApi(method, path, opts = {}) {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) return { status: 0, data: { message: 'DISCORD_BOT_TOKEN not configured' } };

  const headers = { Authorization: `Bot ${botToken}` };
  if (opts.reason) {
    // Discord requires this header URL-encoded and caps it at 512 chars.
    headers['X-Audit-Log-Reason'] = encodeURIComponent(String(opts.reason).slice(0, 512));
  }

  return axios.request({
    method,
    url: `https://discord.com/api/v10${path}`,
    data: opts.body || undefined,
    headers,
    validateStatus: () => true,
    timeout: opts.timeout || DISCORD_API_TIMEOUT_MS,
  });
}

/**
 * Helper function to send messages to Discord
 * @param {string} content - Message content (can be null if using embeds)
 * @param {Array} embeds - Array of Discord embed objects
 * @param {string} channelType - Channel type: 'default', 'signups', or custom channel ID
 */
async function sendDiscordMessage(content, embeds = null, channelType = 'default', components = null) {
  const botToken = process.env.DISCORD_BOT_TOKEN;

  // Determine which channel to use
  let channelId;
  if (channelType === 'default') {
    channelId = process.env.DISCORD_CHANNEL_ID;
  } else if (channelType === 'signups') {
    channelId = process.env.DISCORD_SIGNUP_CHANNEL_ID || process.env.DISCORD_CHANNEL_ID; // Fallback to default
  } else {
    channelId = channelType; // Assume it's a custom channel ID
  }

  if (!botToken || !channelId) {
    console.error('Discord config missing');
    return;
  }

  try {
    const payload = { content };
    if (embeds) {
      payload.embeds = embeds;
    }
    if (components) {
      payload.components = components;
    }

    await axios.post(`https://discord.com/api/v10/channels/${channelId}/messages`, payload, {
      headers: {
        Authorization: `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
    });
    console.log(`Discord message sent successfully to channel ${channelId} (${channelType})`);
  } catch (error) {
    reportError(error, { where: 'sendDiscordMessage', channelId, channelType, response: error.response?.data });
  }
}

/**
 * Send a private DM to one Discord user as the bot.
 *
 * Used for anything that names players who have not been judged yet — alt
 * suspicions in particular. Those must never land in the public channel: most
 * of what the scanner surfaces is circumstantial, and a wrong name posted where
 * the server can read it is not retractable.
 *
 * Discord has no "send DM" endpoint. You first ask for a DM channel with the
 * recipient (idempotent — the same channel comes back every time), then post to
 * it like any other channel. The bot must share a server with the recipient,
 * and the recipient must allow DMs from server members.
 *
 * Fail-soft on purpose: a failed notification must never take down the job that
 * produced it.
 *
 * @param {string} userId - Discord user ID (snowflake) to DM
 * @param {string} content - Message text (can be null when using embeds)
 * @param {Array} [embeds] - Optional Discord embed objects
 * @returns {boolean} whether the DM actually went out
 */
async function sendDiscordDM(userId, content, embeds = null) {
  if (!userId) return false;

  const open = await discordApi('post', '/users/@me/channels', {
    body: { recipient_id: String(userId) },
  });

  if (open.status !== 200 || !open.data?.id) {
    reportError(new Error('Could not open Discord DM channel'), {
      where: 'sendDiscordDM.openChannel',
      userId,
      status: open.status,
      response: open.data,
    });
    return false;
  }

  const payload = { content };
  if (embeds) payload.embeds = embeds;

  const sent = await discordApi('post', `/channels/${open.data.id}/messages`, { body: payload });

  if (sent.status < 200 || sent.status >= 300) {
    // 403 here almost always means the recipient blocks DMs from server members.
    reportError(new Error('Discord DM rejected'), {
      where: 'sendDiscordDM.send',
      userId,
      status: sent.status,
      response: sent.data,
    });
    return false;
  }

  return true;
}

/**
 * Send a market status announcement to Discord.
 * @param {string} kind - 'closed' | 'premarket' | 'open' | 'halted' | 'resumed'
 * @param {string} reason - optional reason text (used for manual halts)
 */
async function sendMarketStatusAlert(kind, reason = '') {
  const presets = {
    closed: {
      color: 0xe74c3c,
      title: '🔴 Market Closed',
      description: `Trading is paused for chapter review. Pre-market orders open at ${discordTime(Date.now() + msUntilWeekly(PRE_MARKET_START_MINUTE), 't')}. Trading resumes at ${discordTime(Date.now() + msUntilWeekly(WEEKLY_HALT_END_MINUTE), 't')} (${discordTime(Date.now() + msUntilWeekly(WEEKLY_HALT_END_MINUTE), 'R')}).`,
    },
    premarket: {
      color: 0xf1c40f,
      title: '🟡 Pre-Market Queue Open',
      description: `You can now place pre-market orders. They fill when trading resumes at ${discordTime(Date.now() + msUntilWeekly(WEEKLY_HALT_END_MINUTE), 't')} (${discordTime(Date.now() + msUntilWeekly(WEEKLY_HALT_END_MINUTE), 'R')}).`,
    },
    open: { color: 0x2ecc71, title: '🟢 Market Open', description: 'Trading has resumed.' },
    halted: {
      color: 0xe74c3c,
      title: '🔴 Trading Halted',
      description: reason ? `Trading is paused. ${reason}` : 'Trading is paused by an admin.',
    },
    resumed: { color: 0x2ecc71, title: '🟢 Trading Resumed', description: 'Trading has resumed.' },
  };
  const preset = presets[kind];
  if (!preset) {
    console.error(`sendMarketStatusAlert: unknown kind "${kind}"`);
    return;
  }
  await sendDiscordMessage(null, [
    {
      color: preset.color,
      title: preset.title,
      description: preset.description,
      timestamp: new Date().toISOString(),
    },
  ]);
}

module.exports = { crewEmoji, discordApi, sendDiscordMessage, sendDiscordDM, sendMarketStatusAlert };
