import { CHARACTER_MAP } from '../../../characters';
import { sharesOf } from '../../../utils/holdings';
import type { AdminUser } from './adminShared';
import type { PriceMap } from '../../../types';

export interface DeletionSummary {
  totalCash: number;
  totalShares: number;
  totalValue: number;
  totalShortShares: number;
  totalShortCollateral: number;
  /** ticker -> long shares across the selected accounts */
  holdingsSummary: Record<string, number>;
  /** ticker -> short shares across the selected accounts */
  shortsSummary: Record<string, number>;
}

/** What deleting the selected accounts would remove: cash, long positions and shorts. */
export const summarizeForDeletion = (
  selectedIds: Iterable<string>,
  allUsers: AdminUser[],
  prices: PriceMap,
): DeletionSummary => {
  const summary: DeletionSummary = {
    totalCash: 0,
    totalShares: 0,
    totalValue: 0,
    totalShortShares: 0,
    totalShortCollateral: 0,
    holdingsSummary: {},
    shortsSummary: {},
  };

  for (const userId of selectedIds) {
    const user = allUsers.find((u) => u.id === userId);
    if (!user) continue;

    summary.totalCash += user.cash || 0;

    Object.entries(user.holdings || {}).forEach(([ticker, shares]) => {
      const shareCount = sharesOf(shares);
      if (shareCount <= 0) return;
      summary.totalShares += shareCount;
      summary.holdingsSummary[ticker] = (summary.holdingsSummary[ticker] || 0) + shareCount;
      const price = prices[ticker] || CHARACTER_MAP[ticker]?.basePrice || 0;
      summary.totalValue += shareCount * price;
    });

    Object.entries(user.shorts || {}).forEach(([ticker, position]) => {
      if (!position || !(position.shares > 0)) return;
      summary.totalShortShares += position.shares;
      summary.totalShortCollateral += position.margin || 0;
      summary.shortsSummary[ticker] = (summary.shortsSummary[ticker] || 0) + position.shares;
    });
  }

  return summary;
};
