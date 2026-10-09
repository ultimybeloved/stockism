// GENERATED from src/rules/ladder.ts by `npm run sync:chars`. Do not edit.
// Ladder game money rules: deposit caps, the new-account ramp, house chips and
// the withdrawal tax. Shared rule module: this file is the only copy anyone
// edits. `npm run sync:chars` copies it to functions/src/shared/rules/, so the
// server charges exactly what the withdraw tab previews. It must stay pure (no
// Firebase, no React, no imports from outside src/rules/).

export const LADDER_GAME_MAX_BALANCE = 10000; // max cash held in the ladder at once
export const LADDER_GAME_MAX_DEPOSIT_PER_WINDOW = 10000; // max deposited within the rolling window
export const LADDER_DEPOSIT_WINDOW_MS = 12 * 60 * 60 * 1000; // rolling 12h window (deposit cap + rush fee)

// New accounts ramp up to the full ladder caps over their first week.
export const LADDER_RAMP_DAYS = 7;
export const LADDER_RAMP_MIN_FACTOR = 0.05; // 5% of the caps at day 0 → 100% at day 7

// Withdrawal tax.
export const LADDER_WITHDRAW_PRINCIPAL_FEE_RATE = 0.05; // flat 5% on the portion that is deposited principal coming back
export const LADDER_WITHDRAW_RUSH_RATE = 0.15; // +15% of the whole withdrawal if any deposit landed within LADDER_DEPOSIT_WINDOW_MS
// Lifetime-progressive brackets over cumulative profit withdrawn (not per-withdrawal,
// so splitting withdrawals can't dodge a bracket). upTo = upper bound of cumulative
// profit withdrawn that the rate applies to.
export const LADDER_WITHDRAW_PROFIT_BRACKETS = [
  { upTo: 1000, rate: 0.15 },
  { upTo: 5000, rate: 0.3 },
  { upTo: Infinity, rate: 0.45 },
];

/** The ladder fields the chip maths reads. */
export interface LadderChipFields {
  nonWithdrawable?: number;
  chipsMigrated?: boolean;
  totalLost?: number;
  balance?: number;
}

/**
 * How much of the ladder deposit caps an account has unlocked, 0..1, from its
 * age in days. null (age unknown or unreadable) means full access.
 */
export const ladderRampFactor = (ageDays: number | null): number => {
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
// balance could never clear. Docs written before chipsMigrated still hold that
// lifetime total; for them, everything lost came out of the chips first, so
// what is left is (granted - totalLost), never more than the balance itself.
export const getLadderChips = (ladderData: LadderChipFields | null | undefined): number => {
  const granted = ladderData?.nonWithdrawable || 0;
  if (ladderData?.chipsMigrated) return granted;
  const lost = ladderData?.totalLost || 0;
  const balance = ladderData?.balance ?? 0;
  return Math.max(0, Math.min(granted - lost, balance));
};

/** What the player can actually move back to their main cash right now. */
export const getLadderWithdrawable = (ladderData: LadderChipFields | null | undefined): number =>
  Math.max(0, (ladderData?.balance ?? 0) - getLadderChips(ladderData));

// Round up to the cent (house favor). The epsilon guards against FP noise
// (e.g. 50.000000000001) charging a phantom extra cent.
const roundUpToCent = (x: number) => Math.ceil((x - 1e-9) * 100) / 100;

/**
 * The tax on one withdrawal. Principal (the player's own deposits coming back)
 * pays a flat fee; profit pays lifetime-progressive bracket rates over
 * cumulative profit withdrawn; a rush surcharge on the whole amount applies if
 * any deposit landed within the window.
 */
export const calculateLadderWithdrawTax = ({
  amount,
  totalDeposited,
  principalWithdrawn,
  profitWithdrawn,
  hasRecentDeposit,
}: {
  amount: number;
  totalDeposited?: number;
  principalWithdrawn?: number;
  profitWithdrawn?: number;
  hasRecentDeposit?: boolean;
}) => {
  const deposited = totalDeposited || 0;
  const principalSoFar = principalWithdrawn || 0;
  const profitSoFar = profitWithdrawn || 0;

  const basisRemaining = Math.max(0, deposited - principalSoFar);
  const principalPart = Math.min(amount, basisRemaining);
  const profitPart = amount - principalPart;

  const principalFee = principalPart > 0 ? roundUpToCent(principalPart * LADDER_WITHDRAW_PRINCIPAL_FEE_RATE) : 0;

  let profitTaxRaw = 0;
  let prevUpTo = 0;
  for (const bracket of LADDER_WITHDRAW_PROFIT_BRACKETS) {
    const overlap = Math.max(0, Math.min(profitSoFar + profitPart, bracket.upTo) - Math.max(profitSoFar, prevUpTo));
    profitTaxRaw += overlap * bracket.rate;
    prevUpTo = bracket.upTo;
  }
  const profitTax = profitTaxRaw > 0 ? roundUpToCent(profitTaxRaw) : 0;

  const rushSurcharge = hasRecentDeposit ? roundUpToCent(amount * LADDER_WITHDRAW_RUSH_RATE) : 0;

  const totalTax = Math.round((principalFee + profitTax + rushSurcharge) * 100) / 100;
  const netReceived = Math.round((amount - totalTax) * 100) / 100;

  return {
    grossAmount: amount,
    principalPart,
    profitPart,
    principalFee,
    profitTax,
    rushSurcharge,
    totalTax,
    netReceived,
  };
};
