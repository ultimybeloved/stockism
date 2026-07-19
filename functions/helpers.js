'use strict';

const admin = require('firebase-admin');
const functions = require('firebase-functions');
const axios = require('axios');
const { reportError } = require('./sentry');
const db = admin.firestore();

// ============================================
// DIVIDEND SYSTEM CONSTANTS
// ============================================
// Rates, hold gate, and loyalty ladder live in characters.js (synced from
// src/characters.js) so frontend and backend always agree.
const { DIVIDEND_HOLD_MS, DIVIDEND_MATURE_MS } = require('./characters');

// Cohort bookkeeping helpers. `cohort = { eligible: N, pending: [{shares, availableAt}] }`
// Pending = purchase lots. A lot pays nothing until availableAt (the 10-day
// hold gate), then earns its loyalty-ladder multiplier from its age, and is
// folded into `eligible` (= fully matured, top multiplier) at 8 weeks.
// Invariant: eligible + sum(pending.shares) === holdings[ticker].
// Cohorts may carry extra fields (e.g. firstHeldAt for the Dividend Demon
// achievement) — every helper must preserve them, not rebuild bare objects.
const addPendingShares = (cohort, shares, now) => {
  const c = cohort && typeof cohort === 'object'
    ? { ...cohort, eligible: cohort.eligible || 0, pending: [...(cohort.pending || [])] }
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
  return { ...cohort, eligible, pending };
};

// Fold fully matured pending lots (held past the top loyalty rung) into
// eligible. Lots between the hold gate and full maturity stay pending so their
// age keeps driving the ladder multiplier.
const graduateCohort = (cohort, now) => {
  if (!cohort) return { eligible: 0, pending: [] };
  let eligible = cohort.eligible || 0;
  const stillPending = [];
  for (const p of (cohort.pending || [])) {
    const acquiredAt = (p.availableAt || 0) - DIVIDEND_HOLD_MS;
    if (now - acquiredAt >= DIVIDEND_MATURE_MS) eligible += (p.shares || 0);
    else stillPending.push(p);
  }
  return { ...cohort, eligible, pending: stillPending };
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
  IPO_PRICE_JUMP,
  DISCORD_RELINK_COOLDOWN_MS,
  CREW_MEMBERS,
  ALL_CREW_TICKERS,
  ANIMAL_TICKERS,
  UNDERDOG_PRICE_THRESHOLD,
} = require('./constants');

// Monday-based week ID (YYYY-MM-DD of the week's Monday) — keys weeklyMissions.
const getWeekId = (now = new Date()) => {
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
  if (weekStart > now) weekStart.setDate(weekStart.getDate() - 7);
  return weekStart.toISOString().split('T')[0];
};

// Mission/stat credit for a filled trade — shared by executeTrade, limit-order
// fills, and the pre-market auction so queued orders count the same as live
// trades. Returns { updates, animalProfitTotal }: `updates` is a field-path
// fragment that must be merged into the SAME user write as the balance change;
// `animalProfitTotal` is non-null only on an animal-ticker sell with a cost
// basis (executeTrade feeds it to the achievement context).
// `marketPrice` is the pre-impact market price (underdog check), while
// `executionPrice` is what the user actually paid/received per share.
const buildTradeCreditUpdates = ({ userData, ticker, action, shares, totalValue, executionPrice, marketPrice, now = Date.now() }) => {
  const todayDate = new Date(now).toISOString().split('T')[0];
  const weekId = getWeekId(new Date(now));
  const updates = {
    totalTrades: admin.firestore.FieldValue.increment(1),
    [`dailyMissions.${todayDate}.tradesCount`]: admin.firestore.FieldValue.increment(1),
    [`dailyMissions.${todayDate}.tradeVolume`]: admin.firestore.FieldValue.increment(shares),
    [`weeklyMissions.${weekId}.tradeValue`]: admin.firestore.FieldValue.increment(totalValue),
    [`weeklyMissions.${weekId}.tradeVolume`]: admin.firestore.FieldValue.increment(shares),
    [`weeklyMissions.${weekId}.tradeCount`]: admin.firestore.FieldValue.increment(1),
    [`weeklyMissions.${weekId}.tradingDays.${todayDate}`]: true
  };
  let animalProfitTotal = null;

  if (action === 'buy') {
    updates[`dailyMissions.${todayDate}.boughtAny`] = true;

    const userCrew = userData.crew;
    if (userCrew) {
      const crewMembers = CREW_MEMBERS[userCrew] || [];
      if (crewMembers.includes(ticker)) {
        updates[`dailyMissions.${todayDate}.boughtCrewMember`] = true;
        updates[`dailyMissions.${todayDate}.crewSharesBought`] = admin.firestore.FieldValue.increment(shares);
      }
      if (!crewMembers.includes(ticker) && ALL_CREW_TICKERS.has(ticker)) {
        updates[`dailyMissions.${todayDate}.boughtRival`] = true;
      }
    }
    if (marketPrice < UNDERDOG_PRICE_THRESHOLD) {
      updates[`dailyMissions.${todayDate}.boughtUnderdog`] = true;
    }

    // Lowest price while holding (for Diamond Hands achievement)
    const currentHoldings = userData.holdings?.[ticker] || 0;
    const currentLowest = userData.lowestWhileHolding?.[ticker];
    const newLowest = currentHoldings === 0
      ? executionPrice
      : Math.min(currentLowest || executionPrice, executionPrice);
    updates[`lowestWhileHolding.${ticker}`] = Math.round(newLowest * 100) / 100;
  }

  if (action === 'sell') {
    updates[`dailyMissions.${todayDate}.soldAny`] = true;

    // Animal Instinct: track cumulative profit from animal characters
    if (ANIMAL_TICKERS.has(ticker)) {
      const costBasis = userData.costBasis?.[ticker] || 0;
      if (costBasis > 0) {
        const profitThisSell = Math.max(0, (executionPrice - costBasis) * shares);
        const pbt = userData.profitByTicker || {};
        const newTickerProfit = (pbt[ticker] || 0) + profitThisSell;
        updates[`profitByTicker.${ticker}`] = newTickerProfit;
        animalProfitTotal = newTickerProfit +
          [...ANIMAL_TICKERS].filter(t => t !== ticker).reduce((s, t) => s + (pbt[t] || 0), 0);
      }
    }
  }

  return { updates, animalProfitTotal };
};

// Apply the +15% price jump + launch for any IPO that has ended (or sold out)
// but hasn't jumped yet. Shared by the 5-minute scheduler (predictions.js) and
// the pre-market auction (marketOrders.js) — the auction runs it FIRST so the
// jump and the auction's opening prices can never fight over the same ticker.
// Returns [{ ticker, newPrice, sharesSold, ipoTotalShares }] for callers to announce.
// Live price-chart history lives in its own doc (market/priceHistory, shape
// { [ticker]: [{ timestamp, price, source? }] }) so the hot market/current doc
// every client subscribes to stays small. Older points are archived (never
// deleted) to market/current/price_history/{ticker} by archiving.js.
const priceHistoryRef = () => db.collection('market').doc('priceHistory');

// Append history points for one or more tickers. Works inside a transaction
// (pass it) or standalone (pass null). set+merge creates the doc if missing.
const appendPriceHistory = (transaction, points) => {
  const updates = {};
  for (const [ticker, point] of Object.entries(points)) {
    updates[ticker] = admin.firestore.FieldValue.arrayUnion(point);
  }
  if (transaction) {
    transaction.set(priceHistoryRef(), updates, { merge: true });
    return null;
  }
  return priceHistoryRef().set(updates, { merge: true });
};

const applyDueIPOJumps = async () => {
  const ipoRef = db.collection('market').doc('ipos');
  const marketRef = db.collection('market').doc('current');
  const now = Date.now();

  return db.runTransaction(async (transaction) => {
    const ipoSnap = await transaction.get(ipoRef);
    if (!ipoSnap.exists) return [];

    const ipos = ipoSnap.data().list || [];
    const updatedList = [...ipos];
    const notifications = [];
    const marketUpdates = {};
    const historyPoints = {};
    const tickersToLaunch = [];

    for (let i = 0; i < ipos.length; i++) {
      const ipo = ipos[i];
      const soldOut = (ipo.sharesRemaining !== undefined && ipo.sharesRemaining <= 0);
      if ((now >= ipo.ipoEndsAt || soldOut) && !ipo.priceJumped) {
        const newPrice = Math.round(ipo.basePrice * (1 + IPO_PRICE_JUMP) * 100) / 100;
        marketUpdates[`prices.${ipo.ticker}`] = newPrice;
        historyPoints[ipo.ticker] = { timestamp: now, price: newPrice };
        tickersToLaunch.push(ipo.ticker);
        updatedList[i] = { ...ipo, priceJumped: true };

        const ipoTotalShares = ipo.totalShares || 150;
        notifications.push({
          ticker: ipo.ticker,
          newPrice,
          sharesSold: ipoTotalShares - (ipo.sharesRemaining || 0),
          ipoTotalShares
        });
      }
    }

    if (tickersToLaunch.length > 0) {
      transaction.update(marketRef, {
        ...marketUpdates,
        launchedTickers: admin.firestore.FieldValue.arrayUnion(...tickersToLaunch)
      });
      appendPriceHistory(transaction, historyPoints);
      transaction.update(ipoRef, { list: updatedList });
    }

    return notifications;
  });
};

const calculateMarginalImpact = (currentPrice, newShares, cumulativeSharesBefore) => {
  const rawMarginal = currentPrice * BASE_IMPACT * (
    Math.sqrt((cumulativeSharesBefore + newShares) / BASE_LIQUIDITY) -
    Math.sqrt(cumulativeSharesBefore / BASE_LIQUIDITY)
  );
  const maxImpact = currentPrice * MAX_PRICE_CHANGE_PERCENT;
  return Math.min(rawMarginal, maxImpact);
};

// Admin price protection: true if this ticker was manually set by an admin
// (a priceHistory point tagged source 'admin_adjust') within `windowMs`.
// Automated price movers (bots, market maker) use this to skip protected
// tickers so they can't undo an admin adjustment. Assumes priceHistory is
// in chronological order (it is — entries are appended).
const isPriceProtected = (priceHistory, ticker, windowMs, now = Date.now()) => {
  const hist = (priceHistory && priceHistory[ticker]) || [];
  const cutoff = now - windowMs;
  for (let i = hist.length - 1; i >= 0; i--) {
    const entry = hist[i];
    if (!entry || entry.timestamp < cutoff) break; // older than window — stop scanning
    if (entry.source === 'admin_adjust') return true;
  }
  return false;
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

// ── LMSR event-market pricing ────────────────────────────────────────────────
// Logarithmic Market Scoring Rule for long-term event share markets.
// `q` = array of shares outstanding per outcome, `b` = liquidity parameter.
// Prices always sum to 1 and stay in (0,1); the house's max loss on a market is
// b * ln(q.length). Mirror of src/utils/calculations.js — keep both in sync.
const _lse = (xs) => {
  const m = Math.max(...xs);
  return m + Math.log(xs.reduce((s, x) => s + Math.exp(x - m), 0));
};
const lmsrCost = (q, b) => b * _lse(q.map((x) => x / b));
const lmsrPrices = (q, b) => {
  const xs = q.map((x) => x / b);
  const m = Math.max(...xs);
  const ex = xs.map((x) => Math.exp(x - m));
  const sum = ex.reduce((a, c) => a + c, 0);
  return ex.map((e) => e / sum);
};
const lmsrBuyCost = (q, b, idx, shares) => {
  const after = q.slice();
  after[idx] += shares;
  return lmsrCost(after, b) - lmsrCost(q, b);
};
const lmsrSellRefund = (q, b, idx, shares) => {
  const after = q.slice();
  after[idx] -= shares;
  return lmsrCost(q, b) - lmsrCost(after, b);
};

// Prune entries older than 24h, return summary
const pruneAndSumTradeHistory = (entries, now) => {
  const cutoff = now - TWENTY_FOUR_HOURS_MS;
  const recent = (entries || []).filter(e => e.ts > cutoff);
  const totalShares = recent.reduce((sum, e) => sum + (e.shares || 0), 0);
  const totalImpact = recent.reduce((sum, e) => sum + (e.impact || 0), 0);
  // count = real trades only. Synthetic ETF trailing entries (shares: 0) feed the
  // impact cap but must NOT count toward the 10-trades-per-ticker cap.
  const realCount = recent.reduce((n, e) => n + ((e.shares || 0) > 0 ? 1 : 0), 0);
  return { recent, totalShares, totalImpact, count: realCount };
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
  // 'yg' blocks any name containing those letters adjacently (admin
  // impersonation); underscores are stripped before matching, so y_g
  // is caught too. Subsumes the old 'darthyg' / 'darth_yg' entries.
  'stockism', 'yg', 'darth', 'null', 'undefined',
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
 * Validates username format (shared by createUser and changeDisplayName).
 * Throws an HttpsError with a user-facing message on the first failed rule.
 * Caller passes the already-trimmed name. Does NOT check uniqueness, bans, or
 * profanity — those stay at the call sites.
 * Mirror of validateUsername in src/utils/username.js — keep both in sync.
 * @param {string} name - Trimmed display name
 */
function validateUsernameFormat(name) {
  if (name.length < 3) {
    throw new functions.https.HttpsError('invalid-argument', 'Username must be at least 3 characters.');
  }
  if (name.length > 20) {
    throw new functions.https.HttpsError('invalid-argument', 'Username must be 20 characters or less.');
  }
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    throw new functions.https.HttpsError('invalid-argument', 'Username can only contain letters, numbers, and underscores.');
  }
  if ((name.match(/[a-zA-Z0-9]/g) || []).length < 3) {
    throw new functions.https.HttpsError('invalid-argument', 'Username must include at least 3 letters or numbers.');
  }
  if ((name.match(/_/g) || []).length > 2 || name.includes('__') || name.startsWith('_') || name.endsWith('_')) {
    throw new functions.https.HttpsError('invalid-argument', 'Username can have at most 2 underscores, not repeated or at the start or end.');
  }
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
 * Blocks value-moving actions for accounts flagged as a suspected alt (a same-IP
 * signup, or an admin manual flag) until they link a Discord account. Linking sets
 * `discordId`, which lifts the wall automatically. Mirrors checkBanned — call it
 * right after checkBanned in any function that moves money or affects the market.
 */
function checkDiscordWall(userData) {
  if (userData?.requiresDiscordLink && !userData?.discordId) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Link your Discord account to continue. This is a one-time verification step.'
    );
  }
}

/**
 * True if this Discord ID was linked to a Stockism account that was deleted
 * within the relink cooldown. Shared by discordAuth and discordLink so the two
 * can't drift. Blocks the create → grab the verified $3k → gamble → delete →
 * remake loop: deleteAccount tombstones the Discord ID, and this keeps it locked
 * for DISCORD_RELINK_COOLDOWN_MS before it can verify a fresh account again.
 * @param {string} discordId
 * @returns {Promise<boolean>}
 */
async function isDiscordRelinkBlocked(discordId) {
  if (!discordId) return false;
  const snap = await db.collection('discordTombstones').doc(String(discordId)).get();
  if (!snap.exists) return false;
  const deletedAt = snap.data().deletedAt || 0;
  return Date.now() - deletedAt < DISCORD_RELINK_COOLDOWN_MS;
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
    reportError(error, { where: 'sendDiscordMessage', channelId, channelType, response: error.response?.data });
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

// Coerce any of our timestamp shapes (Firestore Timestamp, epoch ms number,
// or ISO string) to epoch ms; 0 if missing/unparseable.
function toMs(ts) {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  if (typeof ts === 'string') { const p = Date.parse(ts); return isNaN(p) ? 0 : p; }
  return 0;
}

// Most-recent activity for a user, used by the active-user metric. Takes the
// max of the broad lastActive stamp plus the pre-existing lastTradeTime /
// lastCheckin so existing active players count immediately after deploy.
function getLastActiveMs(userData) {
  if (!userData) return 0;
  return Math.max(
    toMs(userData.lastActive),
    toMs(userData.lastTradeTime),
    toMs(userData.lastCheckin)
  );
}

// Fire-and-forget activity stamp. Called from player-action callables so the
// active-user metric reflects all actions, not just trades/check-ins. Never
// awaited — it must not affect the action's success.
function touchLastActive(uid) {
  if (!uid) return;
  db.collection('users').doc(uid).update({ lastActive: Date.now() }).catch(() => {});
}

// Shares currently locked from selling, combining the IPO and margin lockups.
// Both are { shares, until } maps on the user doc; a lock counts only while
// unexpired. Used by every sell path (executeTrade, limit orders, pre-market)
// so the lockups are enforced consistently and can't be dodged by one route.
const lockedShares = (userData, ticker, now = Date.now()) => {
  const ipo = userData?.ipoLockup?.[ticker];
  const margin = userData?.marginLockup?.[ticker];
  const ipoN = ipo && now < (ipo.until || 0) ? (ipo.shares || 0) : 0;
  const marginN = margin && now < (margin.until || 0) ? (margin.shares || 0) : 0;
  return { ipo: ipoN, margin: marginN, total: ipoN + marginN };
};

module.exports = {
  lockedShares,
  DIVIDEND_HOLD_MS,
  getLastActiveMs,
  touchLastActive,
  addPendingShares,
  decrementCohort,
  graduateCohort,
  calculateMarginalImpact,
  getWeekId,
  buildTradeCreditUpdates,
  applyDueIPOJumps,
  priceHistoryRef,
  appendPriceHistory,
  isPriceProtected,
  getAccountAgeImpactFactor,
  getTotalInvested,
  lmsrCost,
  lmsrPrices,
  lmsrBuyCost,
  lmsrSellRefund,
  pruneAndSumTradeHistory,
  writeNotification,
  writeFeedEntry,
  BANNED_NAMES,
  PROFANITY_LIST,
  normalizeProfanity,
  containsProfanity,
  isBannedUsername,
  validateUsernameFormat,
  checkBanned,
  checkDiscordWall,
  isDiscordRelinkBlocked,
  sendDiscordMessage,
  sendMarketStatusAlert,
  reportError,
};
