// ============================================
// LADDER WITHDRAWAL TAX
// The maths is the shared rule module src/rules/ladder.ts, which the server
// runs too, so the withdraw tab's preview is exactly what gets charged. This
// file adapts it to what the client has on hand.
// ============================================

import { ladderRampFactor } from '../rules/ladder';
import type { TimestampLike } from '../types';

export { getLadderChips, getLadderWithdrawable, calculateLadderWithdrawTax } from '../rules/ladder';

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
  totalDeposited?: number;
  totalWon?: number;
  principalWithdrawn?: number;
  profitWithdrawn?: number;
  /** Deposits inside the rush window, which raise the withdrawal tax. */
  recentDeposits?: { ts: number; amount?: number }[];
  [key: string]: unknown;
}

// How much of the ladder deposit caps a new account has unlocked, 0..1.
// Takes createdAt straight off the user doc, which arrives as a Firestore
// Timestamp on the client; an unreadable date means full access, same as server.
export const getLadderDepositFactor = (createdAt: TimestampLike): number => {
  if (!createdAt) return 1;
  const createdMs =
    typeof createdAt === 'object' && 'toMillis' in createdAt && typeof createdAt.toMillis === 'function'
      ? createdAt.toMillis()
      : typeof createdAt === 'number'
        ? createdAt
        : Date.parse(createdAt as string);
  if (!createdMs || isNaN(createdMs)) return 1;
  return ladderRampFactor((Date.now() - createdMs) / (24 * 60 * 60 * 1000));
};
