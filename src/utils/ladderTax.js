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
} from '../constants/economy';

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
