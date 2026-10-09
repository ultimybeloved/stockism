// Ladder game deposit limits and chip balances.

import { TWENTY_FOUR_HOURS_MS, LADDER_RAMP_DAYS } from './constants';
import { getAccountAgeDays } from './impact';
import { ladderRampFactor, getLadderChips, getLadderWithdrawable } from './rules/ladder';
import type { UserData } from './types';

// How much of the ladder deposit caps a user has unlocked, 0..1. Same ramp shape
// as getAccountAgeImpactFactor but on its own constants — the price-impact ramp
// is about market manipulation and lasts 3 days; this one is about alt accounts
// gambling their signup cash and lasts a week. An account with no readable
// createdAt gets full access rather than being locked out.
export const getLadderDepositFactor = (userData: UserData) => ladderRampFactor(getAccountAgeDays(userData));

// House chips and what can be withdrawn: shared with the client, see rules/ladder.
export { getLadderChips, getLadderWithdrawable };

// When the ladder caps reach full for this user, as an ISO date, or null if
// they are already there. Used to tell them when the limit lifts.
export const getLadderRampEndDate = (userData: UserData) => {
  const ageDays = getAccountAgeDays(userData);
  if (ageDays === null || ageDays >= LADDER_RAMP_DAYS) return null;
  return new Date(Date.now() + (LADDER_RAMP_DAYS - ageDays) * TWENTY_FOUR_HOURS_MS).toISOString().slice(0, 10);
};
