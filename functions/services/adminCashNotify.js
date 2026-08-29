'use strict';
// Internal module for adminOps.js — tells a player when an admin has put money
// in their account.
//
// NOT a service. Never list this in servicePaths.js; it exports a helper, not a
// Cloud Function.
//
// WHY THIS EXISTS
//
// Giveaway cash used to land silently. Missions, dividends and daily check-ins
// all notify, but an admin grant did not, so a prize winner had no way of
// knowing they had been paid short of counting their own balance. They asked in
// DMs instead.
//
// The player-facing text is deliberately GENERIC. The memo on the log entry is
// an internal note ("comp for my mistake", "alt refund") and must never be shown
// to the player, so the amount is the only thing that crosses over.
const { writeNotification, sendDiscordDM } = require('../helpers');

// Two decimals with thousands separators, so $12500 reads as $12,500.00.
const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Notify a player that cash was added to their account. Bell plus a Discord DM
 * if they have linked an account.
 *
 * Increases only. A subtraction is a correction rather than a gift, and
 * "you received -$200" is not a message anyone should get.
 *
 * Fail-soft throughout: the money has already landed by the time this runs, and
 * a notification that fails must never roll back or fail the grant itself.
 *
 * @param {string} uid - Firestore user id
 * @param {Object} userData - the user doc, read before the update
 * @param {number} delta - change in cash; anything <= 0 is ignored
 * @returns {{ notified: boolean, dmSent: boolean }}
 */
async function notifyCashGrant(uid, userData, delta) {
  const amount = Number(delta);
  if (!amount || !isFinite(amount) || amount <= 0) return { notified: false, dmSent: false };

  const text = `You received ${money(amount)}. It is in your account now.`;

  await writeNotification(uid, {
    type: 'system',
    title: '💰 Cash added',
    message: text,
    data: { amount: Math.round(amount * 100) / 100 },
  });

  let dmSent = false;
  if (userData?.discordId) {
    try {
      dmSent = await sendDiscordDM(userData.discordId, `💰 ${text}`);
    } catch {
      // sendDiscordDM already fails soft on Discord errors; this only catches a
      // network throw. Closed DMs are normal and not worth surfacing.
      dmSent = false;
    }
  }

  return { notified: true, dmSent };
}

module.exports = { notifyCashGrant };
