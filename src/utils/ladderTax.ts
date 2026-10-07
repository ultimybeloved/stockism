// ============================================
// LADDER WITHDRAWAL TAX
// Mirror of calculateLadderWithdrawTax in functions/services/ladderTransfers.js
// — keep both in sync. The server is the source of truth; this copy powers the
// live preview in the withdraw tab.
// ============================================

import {
  LADDER_WITHDRAW_PRINCIPAL_FEE_RATE,
  LADDER_WITHDRAW_RUSH_RATE,
  LADDER_WITHDRAW_PROFIT_BRACKETS,
  LADDER_RAMP_DAYS,
  LADDER_RAMP_MIN_FACTOR,
} from '../constants/economy';
import type { TimestampLike } from '../types';

// How much of the ladder deposit caps a new account has unlocked, 0..1.
// Mirror of getLadderDepositFactor in functions/helpers.js — keep both in sync.
// Takes createdAt straight off the user doc, which arrives as a Firestore
// Timestamp on the client; an unreadable date means full access, same as server.
/** ladderGameUsers/{uid}. */
export interface LadderData {
  nonWithdrawable?: number;
  chipsMigrated?: boolean;
  totalLost?: number;
  balance?: number;
  gamesPlayed?: number;
  wins?: number;
  currentStreak?: number;
  bestStreak?: number;
  [key: string]: unknown;
}

export const getLadderDepositFactor = (createdAt: TimestampLike): number => {
  if (!createdAt) return 1;
  const createdMs =
    typeof createdAt === 'object' && 'toMillis' in createdAt && typeof createdAt.toMillis === 'function'
      ? createdAt.toMillis()
      : typeof createdAt === 'number'
        ? createdAt
        : Date.parse(createdAt as string);
  if (!createdMs || isNaN(createdMs)) return 1;
  const ageDays = (Date.now() - createdMs) / (24 * 60 * 60 * 1000);
  if (ageDays >= LADDER_RAMP_DAYS) return 1;
  return LADDER_RAMP_MIN_FACTOR + (1 - LADDER_RAMP_MIN_FACTOR) * (ageDays / LADDER_RAMP_DAYS);
};

// House chips: check-in grants and the welcome stake. Playable, never cashable.
// They are staked before real balance, so losses burn them and winnings on top
// of them belong to the player. Mirror of getLadderChips in functions/helpers.js
// — keep both in sync. The server is the source of truth.
export const getLadderChips = (ladderData: LadderData | null | undefined): number => {
  const granted = ladderData?.nonWithdrawable || 0;
  if (ladderData?.chipsMigrated) return granted;
  const lost = ladderData?.totalLost || 0;
  const balance = ladderData?.balance ?? 0;
  return Math.max(0, Math.min(granted - lost, balance));
};

// What the player can actually move back to their main cash right now.
export const getLadderWithdrawable = (ladderData: LadderData | null | undefined): number =>
  Math.max(0, (ladderData?.balance ?? 0) - getLadderChips(ladderData));

// Round up to the cent (house favor). The epsilon guards against FP noise
// (e.g. 50.000000000001) charging a phantom extra cent.
const roundUpToCent = (x: number) => Math.ceil((x - 1e-9) * 100) / 100;

// Principal (the user's own deposits coming back) pays a flat fee; profit pays
// lifetime-progressive bracket rates over cumulative profit withdrawn; a rush
// surcharge on the whole amount applies if any deposit landed within the window.
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
