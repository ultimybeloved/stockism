'use strict';

const { cf } = require('../fnConfig');
const axios = require('axios');
const { sendDiscordMessage, reportError } = require('../helpers');
const { DISCORD_DAILY_DROP_CHANNEL } = require('../constants');

async function getDiscord(path, token) {
  return axios.get(`https://discord.com/api/v10${path}`, {
    headers: { Authorization: `Bot ${token}` },
    validateStatus: () => true,
    timeout: 10000,
  });
}

/**
 * Scheduled self-check for the Discord Updates bot. Verifies the bot token is valid and
 * that the bot can actually reach the channels it posts to. If anything is wrong it reports
 * to Sentry (reliable) AND tries to post an admin alert to any channel that still works.
 *
 * This is the guard that would have caught the wrong-bot-token outage on its own: a token
 * that belongs to the wrong bot passes the /users/@me check but 403s on every channel.
 */
exports.discordHealthCheck = cf().pubsub
  .schedule('every 24 hours')
  .timeZone('UTC')
  .onRun(async () => {
    const token = process.env.DISCORD_BOT_TOKEN;
    const problems = [];

    if (!token) {
      reportError(new Error('DISCORD_BOT_TOKEN is not set'), { where: 'discordHealthCheck' });
      return null;
    }

    // 1. Is the token valid at all?
    try {
      const me = await getDiscord('/users/@me', token);
      if (me.status !== 200) {
        problems.push(`Bot token rejected by Discord (status ${me.status})`);
      }
    } catch (e) {
      problems.push(`Could not reach Discord to validate token: ${e.message}`);
    }

    // 2. Can the bot reach each channel it needs to post to?
    const channelIds = [...new Set([
      DISCORD_DAILY_DROP_CHANNEL,
      process.env.DISCORD_CHANNEL_ID,
      process.env.DISCORD_SIGNUP_CHANNEL_ID,
    ].filter(Boolean))];

    const reachable = [];
    for (const id of channelIds) {
      try {
        const r = await getDiscord(`/channels/${id}`, token);
        if (r.status === 200) {
          reachable.push(id);
        } else {
          const msg = r.data && r.data.message ? r.data.message : '';
          problems.push(`Channel ${id} unreachable (status ${r.status} ${msg})`);
        }
      } catch (e) {
        problems.push(`Channel ${id} check failed: ${e.message}`);
      }
    }

    if (problems.length === 0) {
      console.log('discordHealthCheck: OK', { channels: reachable });
      return null;
    }

    // Surface to Sentry no matter what (this is the reliable signal).
    reportError(new Error('Discord health check failed: ' + problems.join('; ')), {
      where: 'discordHealthCheck',
      problems,
      reachable,
    });

    // Best effort: alert in any channel that still works. If the bot is fully broken
    // (e.g. wrong token), reachable is empty and Sentry is the only signal — by design.
    if (reachable.length > 0) {
      await sendDiscordMessage(
        null,
        [{
          title: '⚠️ Discord config health check failed',
          description: problems.map((p) => `• ${p}`).join('\n'),
          color: 0xE74C3C,
          footer: { text: 'Automated self-check • fix functions/.env and redeploy' },
          timestamp: new Date().toISOString(),
        }],
        reachable[0],
      );
    }

    return null;
  });
