// Discord REST calls: channel posts, DMs, market status alerts.

import axios from 'axios';
import { reportError } from './sentry';
import {
  DISCORD_API_TIMEOUT_MS,
  CREW_EMOJIS,
  DISCORD_EMOJI_PATTERN,
  CREWS,
  discordTime,
  msUntilWeekly,
  PRE_MARKET_START_MINUTE,
  WEEKLY_HALT_END_MINUTE,
} from './constants';

/** A Discord embed object, passed through to the API as is. */
type Embed = Record<string, unknown>;

/** A Discord API response body. Callers read whichever fields the endpoint returns. */
type DiscordBody = { id?: string; message?: string; [field: string]: unknown };

/**
 * The emoji that stands for a crew in Discord.
 *
 * Prefers the custom crew emoji (CREW_EMOJIS in constants.js) and falls back to
 * the Unicode emblem from crews.ts, which is what the website shows. Returns ''
 * for an unknown crew id so callers can interpolate it blindly.
 *
 * Anything in CREW_EMOJIS that is not well-formed `<:name:id>` markup is treated
 * as absent: a half-pasted ID would otherwise print as literal angle brackets in
 * the middle of an embed, which looks far worse than the plain emblem.
 */
export function crewEmoji(crewId: string): string {
  const custom = (CREW_EMOJIS as Record<string, string>)[crewId];
  if (custom && DISCORD_EMOJI_PATTERN.test(custom)) return custom;
  const crew = (CREWS as Record<string, { emblem?: string }>)[crewId];
  return (crew && crew.emblem) || '';
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
 * @param method - 'get' | 'put' | 'delete' | 'post' | 'patch'
 * @param path - API path after /v10, e.g. `/guilds/123/roles`
 * @param opts - { body, reason } — `reason` becomes the Discord
 *        audit-log entry, which is how a server admin sees WHY the bot acted.
 */
export async function discordApi(
  method: 'get' | 'put' | 'delete' | 'post' | 'patch',
  path: string,
  opts: { body?: unknown; reason?: string; timeout?: number } = {},
) {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) return { status: 0, data: { message: 'DISCORD_BOT_TOKEN not configured' } as DiscordBody };

  const headers: Record<string, string> = { Authorization: `Bot ${botToken}` };
  if (opts.reason) {
    // Discord requires this header URL-encoded and caps it at 512 chars.
    headers['X-Audit-Log-Reason'] = encodeURIComponent(String(opts.reason).slice(0, 512));
  }

  return axios.request<DiscordBody>({
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
 * @param content - Message content (can be null if using embeds)
 * @param embeds - Array of Discord embed objects
 * @param channelType - Channel type: 'default', 'signups', or custom channel ID
 */
export async function sendDiscordMessage(
  content: string | null,
  embeds: Embed[] | null = null,
  channelType = 'default',
  components: unknown[] | null = null,
) {
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
    const payload: { content: string | null; embeds?: Embed[]; components?: unknown[] } = { content };
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
    reportError(error, {
      where: 'sendDiscordMessage',
      channelId,
      channelType,
      response: (error as { response?: { data?: unknown } }).response?.data,
    });
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
 * @param userId - Discord user ID (snowflake) to DM
 * @param content - Message text (can be null when using embeds)
 * @param embeds - Optional Discord embed objects
 * @returns whether the DM actually went out
 */
export async function sendDiscordDM(
  userId: string | null | undefined,
  content: string | null,
  embeds: Embed[] | null = null,
) {
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

  const payload: { content: string | null; embeds?: Embed[] } = { content };
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
 * @param kind - 'closed' | 'premarket' | 'open' | 'halted' | 'resumed'
 * @param reason - optional reason text (used for manual halts)
 */
export async function sendMarketStatusAlert(kind: string, reason = '') {
  const presets: Record<string, { color: number; title: string; description: string }> = {
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
