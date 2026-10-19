// Pool-betting math for weekly predictions. Every stake joins its answer's pool
// and the winners split the whole pot in proportion to their stakes, so what a
// bet pays depends on how big it is. Must match claimPredictionPayout
// (functions/src/predictions/predictions.ts); odds.test.ts guards it.
import type { PredictionDoc, UserBet } from '../../../types';

/** The small bet the cards quote odds against, so a card never over-promises. */
export const PREVIEW_BET = 50;

/** answer -> money in it. Old predictions kept yesPool/noPool instead. */
export const poolsOf = (p: PredictionDoc): Record<string, number> =>
  p.pools || { Yes: p.yesPool || 0, No: p.noPool || 0 };

export const optionsOf = (p: PredictionDoc): string[] => p.options || ['Yes', 'No'];

export const poolTotal = (p: PredictionDoc): number => {
  const pools = poolsOf(p);
  return optionsOf(p).reduce((sum, o) => sum + (pools[o] || 0), 0);
};

/** Percent of the pot on one answer, rounded down. Even split while empty. */
export const poolShare = (p: PredictionDoc, option: string): number => {
  const total = poolTotal(p);
  if (total === 0) return Math.floor(100 / optionsOf(p).length);
  return Math.floor(((poolsOf(p)[option] || 0) / total) * 100);
};

/** What a new stake of `amount` on `option` pays if it wins. */
export const poolPayout = (p: PredictionDoc, option: string, amount: number): number => {
  const mine = (poolsOf(p)[option] || 0) + amount;
  return mine > 0 ? (amount / mine) * (poolTotal(p) + amount) : 0;
};

/** What an existing bet pays if it wins. Its stake is already in the pool. */
export const betPayout = (p: PredictionDoc, bet: UserBet): number => {
  const mine = poolsOf(p)[bet.option ?? ''] || 0;
  return mine > 0 ? (bet.amount / mine) * poolTotal(p) : bet.amount;
};

/** Every winning answer: one, or several when more than one came true. */
export const winnersOf = (p: PredictionDoc): string[] => p.outcomes || (p.outcome ? [p.outcome] : []);
