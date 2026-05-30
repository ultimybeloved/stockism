'use strict';

const admin = require('firebase-admin');
const functions = require('firebase-functions');
const axios = require('axios');
const db = admin.firestore();

// ============================================
// DIVIDEND SYSTEM CONSTANTS
// ============================================
const DIVIDEND_HOLD_DAYS = 10;
const DIVIDEND_HOLD_MS = DIVIDEND_HOLD_DAYS * 24 * 60 * 60 * 1000;
const DIVIDEND_RATES = {
  'blue-chip': 0.010,
  'dividend':  0.005,
  'etf':       0.007,
  'growth':    0,
};

// Cohort bookkeeping helpers. `cohort = { eligible: N, pending: [{shares, availableAt}] }`
// Eligible = shares held >= 10 days and ready to earn dividends.
// Pending = shares within the 10-day waiting period.
// Invariant: eligible + sum(pending.shares) === holdings[ticker].
const addPendingShares = (cohort, shares, now) => {
  const c = cohort && typeof cohort === 'object'
    ? { eligible: cohort.eligible || 0, pending: [...(cohort.pending || [])] }
    : { eligible: 0, pending: [] };
  c.pending.push({ shares, availableAt: now + DIVIDEND_HOLD_MS });
  return c;
};

// Decrement a cohort by `shares`. Consumes eligible first, then oldest pending
// (FIFO by availableAt). Returns null if the cohort is fully consumed.
const decrementCohort = (cohort, shares) => {
  if (!cohort) return null;
  let remaining = shares;
  let eligible = cohort.eligible || 0;
  const pending = [...(cohort.pending || [])];

  const takeFromEligible = Math.min(eligible, remaining);
  eligible -= takeFromEligible;
  remaining -= takeFromEligible;

  pending.sort((a, b) => (a.availableAt || 0) - (b.availableAt || 0));
  while (remaining > 0 && pending.length > 0) {
    const head = pending[0];
    if (head.shares <= remaining) {
      remaining -= head.shares;
      pending.shift();
    } else {
      head.shares -= remaining;
      remaining = 0;
    }
  }

  if (eligible === 0 && pending.length === 0) return null;
  return { eligible, pending };
};

// Promote any pending entries past their availableAt into eligible.
const graduateCohort = (cohort, now) => {
  if (!cohort) return { eligible: 0, pending: [] };
  let eligible = cohort.eligible || 0;
  const stillPending = [];
  for (const p of (cohort.pending || [])) {
    if ((p.availableAt || 0) <= now) eligible += (p.shares || 0);
    else stillPending.push(p);
  }
  return { eligible, pending: stillPending };
};

// Cumulative marginal impact: makes splitting trades give same impact as bulk
// impact = price * 0.012 * (sqrt((cumBefore + new) / 100) - sqrt(cumBefore / 100))
const {
  BASE_IMPACT,
  BASE_LIQUIDITY,
  MAX_PRICE_CHANGE_PERCENT,
  TWENTY_FOUR_HOURS_MS,
  NEW_ACCOUNT_IMPACT_PERIOD_DAYS,
  NEW_ACCOUNT_MIN_IMPACT_FACTOR,
} = require('./constants');

const calculateMarginalImpact = (currentPrice, newShares, cumulativeSharesBefore) => {
  const rawMarginal = currentPrice * BASE_IMPACT * (
    Math.sqrt((cumulativeSharesBefore + newShares) / BASE_LIQUIDITY) -
    Math.sqrt(cumulativeSharesBefore / BASE_LIQUIDITY)
  );
  const maxImpact = currentPrice * MAX_PRICE_CHANGE_PERCENT;
  return Math.min(rawMarginal, maxImpact);
};

// Anti-manipulation: brand-new accounts move the market less, ramping from
// NEW_ACCOUNT_MIN_IMPACT_FACTOR at day 0 up to full (1.0) at the end of the
// ramp window. Mirrors getAccountAgeImpactFactor in src/App.jsx — keep in sync.
const getAccountAgeImpactFactor = (userData) => {
  if (!userData || !userData.createdAt) return 1;
  const createdAt = userData.createdAt;
  const createdMs = typeof createdAt.toMillis === 'function'
    ? createdAt.toMillis()
    : typeof createdAt === 'number' ? createdAt : Date.parse(createdAt);
  if (!createdMs || isNaN(createdMs)) return 1;
  const ageDays = (Date.now() - createdMs) / TWENTY_FOUR_HOURS_MS;
  if (ageDays >= NEW_ACCOUNT_IMPACT_PERIOD_DAYS) return 1;
  return NEW_ACCOUNT_MIN_IMPACT_FACTOR + (1 - NEW_ACCOUNT_MIN_IMPACT_FACTOR) * (ageDays / NEW_ACCOUNT_IMPACT_PERIOD_DAYS);
};

// Total a user has "invested" in stocks: cost basis of holdings + collateral posted on
// open short positions. Used to cap prediction bets and ladder-game deposits.
const getTotalInvested = (userData) => {
  if (!userData) return 0;
  const holdings = userData.holdings || {};
  const costBasis = userData.costBasis || {};
  const holdingsValue = Object.entries(holdings).reduce(
    (sum, [ticker, shares]) => sum + ((costBasis[ticker] || 0) * (shares || 0)), 0
  );
  const shortMargin = Object.values(userData.shorts || {}).reduce(
    (sum, s) => sum + (s && s.shares > 0 ? (s.margin || 0) : 0), 0
  );
  return holdingsValue + shortMargin;
};

// Prune entries older than 24h, return summary
const pruneAndSumTradeHistory = (entries, now) => {
  const cutoff = now - TWENTY_FOUR_HOURS_MS;
  const recent = (entries || []).filter(e => e.ts > cutoff);
  const totalShares = recent.reduce((sum, e) => sum + (e.shares || 0), 0);
  const totalImpact = recent.reduce((sum, e) => sum + (e.impact || 0), 0);
  return { recent, totalShares, totalImpact, count: recent.length };
};

// ============================================
// NOTIFICATION HELPER
// ============================================
// Writes a notification doc to users/{uid}/notifications subcollection
// Fire-and-forget — errors are logged but don't block the caller
const writeNotification = async (uid, { type, title, message, data = {} }) => {
  try {
    await db.collection('users').doc(uid).collection('notifications').add({
      type,       // 'trade', 'alert', 'achievement', 'margin', 'system'
      title,
      message,
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      data        // { ticker?, price?, orderId?, achievementId? }
    });
  } catch (err) {
    console.error(`Failed to write notification for ${uid}:`, err.message);
  }
};

// Writes a feed doc to the global feed collection (fire-and-forget)
const writeFeedEntry = async ({ type, userId, displayName, crew, message, ticker, action, amount, price, achievementId, displayAfter }) => {
  try {
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 day TTL
    await db.collection('feed').add({
      type,         // 'trade', 'achievement', 'mission_complete'
      userId,
      displayName,
      crew: crew || null,
      ticker: ticker || null,
      action: action || null,
      amount: amount || null,
      price: price || null,
      achievementId: achievementId || null,
      message,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt,
      displayAfter: displayAfter || null
    });
  } catch (err) {
    console.error('Failed to write feed entry:', err.message);
  }
};

// Banned usernames (impersonation prevention)
const BANNED_NAMES = [
  'admin', 'administrator', 'mod', 'moderator', 'support', 'staff',
  'official', 'system', 'root', 'owner', 'founder', 'manager',
  'stockism', 'darthyg', 'darth_yg', 'darth', 'null', 'undefined',
  'ricky'
];

// Profanity filter
const PROFANITY_LIST = [
  // Profanity
  'fuck', 'shit', 'ass', 'bitch', 'damn', 'cunt', 'dick', 'cock', 'pussy', 'bastard',
  'whore', 'slut', 'piss', 'crap', 'fag', 'retard', 'nigger', 'nigga', 'chink',
  // Variations/leetspeak
  'f4ck', 'fuk', 'fck', 'sh1t', 'b1tch', 'azz', 'a55', 'd1ck', 'c0ck', 'cnt',
  'fag0t', 'r3tard', 'n1gger', 'n1gga',
  // Slurs
  'kike', 'spic', 'beaner', 'wetback', 'gook', 'towelhead', 'sandnigger',
  // Sexual/inappropriate
  'sex', 'porn', 'xxx', 'rape', 'molest', 'pedo', 'anal', 'vagina', 'penis',
  'testicle', 'semen', 'cumshot', 'jizz', 'blowjob', 'handjob',
  // Hate/offensive
  'nazi', 'hitler', 'kill', 'murder', 'terrorist', 'jihad', 'isis',
  // Common substitutions
  'fvck', 'phuck', 'biatch', 'bytch', 'azhole', 'assh0le'
];

/**
 * Normalize text for profanity detection (remove special chars, numbers that look like letters)
 * @param {string} text - Text to normalize
 * @returns {string} - Normalized text
 */
function normalizeProfanity(text) {
  return text.toLowerCase()
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/8/g, 'b')
    .replace(/\$/g, 's')
    .replace(/@/g, 'a')
    .replace(/!/g, 'i')
    .replace(/\+/g, 't')
    .replace(/[^a-z]/g, '');
}

/**
 * Checks if text contains profanity
 * @param {string} text - Text to check
 * @returns {boolean} - True if profanity detected
 */
function containsProfanity(text) {
  if (!text) return false;

  const normalized = normalizeProfanity(text);
  const lower = text.toLowerCase();

  for (const word of PROFANITY_LIST) {
    // Exact match (whole word)
    const wordBoundaryRegex = new RegExp(`\\b${word}\\b`, 'i');
    if (wordBoundaryRegex.test(lower) || wordBoundaryRegex.test(normalized)) {
      return true;
    }

    // Substring match for shorter words (3+ chars)
    if (word.length >= 3 && (lower.includes(word) || normalized.includes(word))) {
      return true;
    }
  }

  return false;
}

/**
 * Checks if a username is banned (handles leetspeak variations).
 * @param {string} username - Lowercase username to check
 * @returns {boolean} - True if banned
 */
function isBannedUsername(username) {
  // Normalize leetspeak and variations
  const normalized = username
    .replace(/[0]/g, 'o')
    .replace(/[1]/g, 'i')
    .replace(/[3]/g, 'e')
    .replace(/[4]/g, 'a')
    .replace(/[5]/g, 's')
    .replace(/[7]/g, 't')
    .replace(/_/g, '');

  // Check exact matches
  if (BANNED_NAMES.includes(username) || BANNED_NAMES.includes(normalized)) {
    return true;
  }

  // Check if it contains banned terms
  for (const banned of BANNED_NAMES) {
    if (username.includes(banned) || normalized.includes(banned)) {
      return true;
    }
  }

  return false;
}

/**
 * Reusable ban check — throws if user is banned.
 * Call right after fetching userData in any user-facing function.
 */
function checkBanned(userData) {
  if (userData?.isBanned) {
    throw new functions.https.HttpsError('permission-denied', 'Account is banned.');
  }
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

    await axios.post(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      payload,
      {
        headers: {
          'Authorization': `Bot ${botToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`Discord message sent successfully to channel ${channelId} (${channelType})`);
  } catch (error) {
    console.error('Error sending Discord message:', error.response?.data || error.message);
  }
}

/**
 * Send a market status announcement to Discord.
 * @param {string} kind - 'closed' | 'premarket' | 'open' | 'halted' | 'resumed'
 * @param {string} reason - optional reason text (used for manual halts)
 */
async function sendMarketStatusAlert(kind, reason = '') {
  const presets = {
    closed:    { color: 0xE74C3C, title: '🔴 Market Closed', description: 'Trading is paused for chapter review. Pre-market orders open at 20:30 UTC. Trading resumes at 21:00 UTC.' },
    premarket: { color: 0xF1C40F, title: '🟡 Pre-Market Queue Open', description: 'You can now place pre-market orders. They fill when trading resumes at 21:00 UTC.' },
    open:      { color: 0x2ECC71, title: '🟢 Market Open', description: 'Trading has resumed.' },
    halted:    { color: 0xE74C3C, title: '🔴 Trading Halted', description: reason ? `Trading is paused. ${reason}` : 'Trading is paused by an admin.' },
    resumed:   { color: 0x2ECC71, title: '🟢 Trading Resumed', description: 'Trading has resumed.' },
  };
  const preset = presets[kind];
  if (!preset) {
    console.error(`sendMarketStatusAlert: unknown kind "${kind}"`);
    return;
  }
  await sendDiscordMessage(null, [{
    color: preset.color,
    title: preset.title,
    description: preset.description,
    timestamp: new Date().toISOString()
  }]);
}

module.exports = {
  DIVIDEND_HOLD_DAYS,
  DIVIDEND_HOLD_MS,
  DIVIDEND_RATES,
  addPendingShares,
  decrementCohort,
  graduateCohort,
  calculateMarginalImpact,
  getAccountAgeImpactFactor,
  getTotalInvested,
  pruneAndSumTradeHistory,
  writeNotification,
  writeFeedEntry,
  BANNED_NAMES,
  PROFANITY_LIST,
  normalizeProfanity,
  containsProfanity,
  isBannedUsername,
  checkBanned,
  sendDiscordMessage,
  sendMarketStatusAlert,
};
