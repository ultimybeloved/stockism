'use strict';

// Shared Discord REST plumbing for the maintenance scripts.
//
// Used by register-discord-commands.cjs and sync-crew-emojis.cjs. It exists so
// the token lookup lives in exactly one place: both scripts have to talk to the
// SAME Discord application (the "Stockism Updates" bot that owns
// DISCORD_BOT_TOKEN), and the way you guarantee that is to ask Discord which
// app the token belongs to rather than reading an ID from anywhere.
//
// Nothing here is Firebase-aware — these scripts run from a laptop against the
// live Discord API, not against the deployed functions.

const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', 'functions', '.env');
const API = 'https://discord.com/api/v10';

/** One value out of the real environment, else out of functions/.env. '' if absent. */
function readEnv(key) {
  if (process.env[key]) return process.env[key];
  if (!fs.existsSync(ENV_PATH)) return '';
  const line = fs.readFileSync(ENV_PATH, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith(`${key}=`));
  if (!line) return '';
  return line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
}

function readBotToken() {
  const token = readEnv('DISCORD_BOT_TOKEN');
  if (!token) {
    throw new Error(`No DISCORD_BOT_TOKEN in the environment and none in ${ENV_PATH}.`);
  }
  return token;
}

/**
 * One call to the Discord REST API as the bot.
 *
 * Throws on any non-2xx with the body attached — these are one-shot scripts run
 * by hand, so a loud failure with Discord's own error text is exactly right.
 * (The deployed equivalent, helpers.discordApi, deliberately does the opposite
 * and returns the status, because live code has to branch on it.)
 */
async function discord(token, route, options = {}) {
  const res = await fetch(`${API}${route}`, {
    ...options,
    headers: {
      Authorization: `Bot ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Discord ${options.method || 'GET'} ${route} failed (${res.status}): ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

/** The application the bot token belongs to. Never guess this from .env. */
const getApp = (token) => discord(token, '/oauth2/applications/@me');

module.exports = { API, ENV_PATH, readEnv, readBotToken, discord, getApp };
