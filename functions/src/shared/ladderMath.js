'use strict';
// Ladder game deposit limits and chip balances.

const { TWENTY_FOUR_HOURS_MS, LADDER_RAMP_DAYS, LADDER_RAMP_MIN_FACTOR } = require('./constants');
const { getAccountAgeDays } = require('./impact');

// How much of the ladder deposit caps a user has unlocked, 0..1. Same ramp shape
// as getAccountAgeImpactFactor but on its own constants — the price-impact ramp
// is about market manipulation and lasts 3 days; this one is about alt accounts
// gambling their signup cash and lasts a week. An account with no readable
// createdAt gets full access rather than being locked out.
const getLadderDepositFactor = (userData) => {
  const ageDays = getAccountAgeDays(userData);
  if (ageDays === null) return 1;
  if (ageDays >= LADDER_RAMP_DAYS) return 1;
  return LADDER_RAMP_MIN_FACTOR + (1 - LADDER_RAMP_MIN_FACTOR) * (ageDays / LADDER_RAMP_DAYS);
};

// House chips: the check-in grants and the welcome stake. They can be played
// but never cashed out, so the withdrawable part of a ladder balance is
// whatever sits above them. Chips are staked before real balance, so a loss
// burns chips first and winnings on top of a chip stake are the player's.
//
// nonWithdrawable used to be the lifetime total ever granted and was never
// reduced when those chips were lost, so every daily top-up raised a floor the
// balance could never clear and regular players ended up unable to withdraw
// anything at all. This repairs those docs once: everything a player has ever
// lost came out of the chips first, so what is left of them is
// (granted - totalLost), and it can never exceed the balance actually sitting
// there. Mirror of getLadderChips in src/utils/ladderTax.ts.
const getLadderChips = (ladderData) => {
  const granted = ladderData?.nonWithdrawable || 0;
  if (ladderData?.chipsMigrated) return granted;
  const lost = ladderData?.totalLost || 0;
  const balance = ladderData?.balance ?? 0;
  return Math.max(0, Math.min(granted - lost, balance));
};

// What the player can actually move back to their main cash right now.
const getLadderWithdrawable = (ladderData) => Math.max(0, (ladderData?.balance ?? 0) - getLadderChips(ladderData));

// When the ladder caps reach full for this user, as an ISO date, or null if
// they are already there. Used to tell them when the limit lifts.
const getLadderRampEndDate = (userData) => {
  const ageDays = getAccountAgeDays(userData);
  if (ageDays === null || ageDays >= LADDER_RAMP_DAYS) return null;
  return new Date(Date.now() + (LADDER_RAMP_DAYS - ageDays) * TWENTY_FOUR_HOURS_MS).toISOString().slice(0, 10);
};

module.exports = { getLadderDepositFactor, getLadderChips, getLadderWithdrawable, getLadderRampEndDate };
