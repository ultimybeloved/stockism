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

// How much of the ladder deposit caps a new account has unlocked, 0..1.
// Mirror of getLadderDepositFactor in functions/helpers.js — keep both in sync.
// Takes createdAt straight off the user doc, which arrives as a Firestore
// Timestamp on the client; an unreadable date means full access, same as server.
export const getLadderDepositFactor = (createdAt) => {
  if (!createdAt) return 1;
  const createdMs = typeof createdAt.toMillis === 'function'
    ? createdAt.toMillis()
    : typeof createdAt === 'number' ? createdAt : Date.parse(createdAt);
  if (!createdMs || isNaN(createdMs)) return 1;
  const ageDays = (Date.now() - createdMs) / (24 * 60 * 60 * 1000);
  if (ageDays >= LADDER_RAMP_DAYS) return 1;
  return LADDER_RAMP_MIN_FACTOR + (1 - LADDER_RAMP_MIN_FACTOR) * (ageDays / LADDER_RAMP_DAYS);
};

// Round up to the cent (house favor). The epsilon guards against FP noise
// (e.g. 50.000000000001) charging a phantom extra cent.
const roundUpToCent = (x) => Math.ceil((x - 1e-9) * 100) / 100;

// Principal (the user's own deposits coming back) pays a flat fee; profit pays
// lifetime-progressive bracket rates over cumulative profit withdrawn; a rush
// surcharge on the whole amount applies if any deposit landed within the window.
export const calculateLadderWithdrawTax = ({ amount, totalDeposited, principalWithdrawn, profitWithdrawn, hasRecentDeposit }) => {
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

  return { grossAmount: amount, principalPart, profitPart, principalFee, profitTax, rushSurcharge, totalTax, netReceived };
};
