// Reads what a player still has in the side games. INTERNAL MODULE, used by the
// bankruptcy flag (syncPortfolio) and the bailout.
import type { DocumentData } from 'firebase-admin/firestore';
import { sideGameWorth, type SideGameFields, type PredictionRef } from './rules/equity';
import { getLadderWithdrawable } from './ladderMath';
import { eventPositionsValue, type EventMarketRef } from './lmsr';

/** Side money above this keeps a player out of bankruptcy, matching the flag's $100 line. */
export const BANKRUPT_LINE = 100;

export const sideMoneyOf = (
  userData: DocumentData,
  predictionList: DocumentData[],
  ladderData: DocumentData | null | undefined,
): number =>
  sideGameWorth(
    userData as SideGameFields,
    predictionList as PredictionRef[],
    getLadderWithdrawable(ladderData),
    eventPositionsValue(userData.eventPositions || {}, predictionList as EventMarketRef[]),
  );
