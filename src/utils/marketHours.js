/**
 * Weekly trading halt utility
 * Every Thursday 13:00–21:00 UTC (chapter review window)
 */

export const isWeeklyHalt = () => {
  const now = new Date();
  if (now.getUTCDay() !== 4) return false; // Thursday = 4
  const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  return utcMins >= 780 && utcMins < 1260; // 13:00 (780) to 21:00 (1260)
};

export const getHaltTimeRemaining = () => {
  const now = new Date();
  const reopenToday = new Date(now);
  reopenToday.setUTCHours(21, 0, 0, 0);
  return Math.max(0, reopenToday.getTime() - now.getTime());
};

export const getNextHaltStart = () => {
  const now = new Date();
  const day = now.getUTCDay();
  const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  // If Thursday before halt starts, return today
  if (day === 4 && utcMins < 780) {
    const today = new Date(now);
    today.setUTCHours(13, 0, 0, 0);
    return today;
  }
  const daysUntil = (4 - day + 7) % 7 || 7;
  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + daysUntil);
  next.setUTCHours(13, 0, 0, 0);
  return next;
};

export const formatCountdown = (ms) => {
  if (ms <= 0) return '0m';
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
};
