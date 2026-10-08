// Rank badge styling and number formats for the leaderboard. Pure helpers.
import { formatCurrency } from './formatters';

export const getRankEmoji = (rank: number): string => {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `#${rank}`;
};

export const getRankStyle = (rank: number, darkMode: boolean, mutedClass: string): string => {
  if (rank === 1) return 'text-yellow-500';
  if (rank === 2) return darkMode ? 'text-zinc-400' : 'text-zinc-500';
  if (rank === 3) return 'text-amber-600';
  return mutedClass;
};

/** A weekly gain percent with its sign: "+4.2%". */
export const formatGainPct = (p: number | undefined): string => `${(p || 0) >= 0 ? '+' : ''}${(p || 0).toFixed(1)}%`;

/** A weekly gain in dollars with its sign: "+$1,234.00". */
export const formatGainDollars = (g: number | undefined): string =>
  `${(g || 0) >= 0 ? '+' : ''}${formatCurrency(g || 0)}`;
