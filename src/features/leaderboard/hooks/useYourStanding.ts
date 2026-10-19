import { useMemo } from 'react';
import { formatCurrency } from '../../../utils/formatters';
import type { RankedLeader } from './boardCache';

export interface Standing {
  rank: number;
  /** "$1,904 behind #211", "Tied with #4", "Top of the board", or null if unknown. */
  gapText: string | null;
  rankChange: number | null | undefined;
}

const sortValue = (l: RankedLeader, sortBy: string) =>
  sortBy === 'weeklyGainPercent'
    ? l.weeklyGainPercent || 0
    : sortBy === 'weeklyGain'
      ? l.weeklyGain || 0
      : l.portfolioValue || 0;

// Where the signed-in player stands on the open board and what it takes to
// climb one place. On the board the gap comes from the row above; off it, from
// the server (net-worth boards only).
export const useYourStanding = (
  leaders: RankedLeader[],
  uid: string | undefined,
  userRank: number | null,
  nextGap: number | null,
  sortBy: string,
): Standing | null =>
  useMemo(() => {
    if (!userRank) return null;
    const i = uid ? leaders.findIndex((l) => l.id === uid) : -1;
    const fmt = (n: number) => (sortBy === 'weeklyGainPercent' ? `${n.toFixed(1)} pts` : formatCurrency(n));
    let gap: number | null = null;
    if (i > 0) gap = sortValue(leaders[i - 1]!, sortBy) - sortValue(leaders[i]!, sortBy);
    else if (i === -1) gap = nextGap;
    const gapText =
      userRank === 1
        ? 'Top of the board'
        : gap === null
          ? null
          : gap <= 0
            ? `Tied with #${userRank - 1}`
            : `${fmt(gap)} behind #${userRank - 1}`;
    return { rank: userRank, gapText, rankChange: i === -1 ? undefined : leaders[i]!.rankChange };
  }, [leaders, uid, userRank, nextGap, sortBy]);
