// Rank badge styling for the leaderboard. Pure helpers, kept out of
// LeaderboardPage.jsx to hold it under the 300-line page limit.

export const getRankEmoji = (rank) => {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `#${rank}`;
};

export const getRankStyle = (rank, darkMode, mutedClass) => {
  if (rank === 1) return 'text-yellow-500';
  if (rank === 2) return darkMode ? 'text-zinc-400' : 'text-zinc-500';
  if (rank === 3) return 'text-amber-600';
  return mutedClass;
};
