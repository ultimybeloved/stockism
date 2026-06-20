// ============================================
// FORMATTING UTILITY FUNCTIONS
// ============================================

/**
 * Format a number as USD currency
 * @param {number} value - The value to format
 * @returns {string} Formatted currency string
 */
export const formatCurrency = (value) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value) || 0);
};

/**
 * Format a percentage change with sign
 * @param {number} change - The percentage change value
 * @returns {string} Formatted change string with + or - prefix
 */
export const formatChange = (change) => {
  change = Number(change) || 0;
  const sign = change >= 0 ? '+' : '';
  return `${sign}${change.toFixed(2)}%`;
};

/**
 * Format large numbers with K/M suffix
 * @param {number} num - The number to format
 * @returns {string} Formatted number string
 */
export const formatNumber = (num) => {
  num = Number(num) || 0;
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
};

/**
 * Format milliseconds as time remaining (e.g., "2d 5h" or "30m")
 * @param {number} ms - Milliseconds remaining
 * @returns {string} Human-readable time remaining
 */
export const formatTimeRemaining = (ms) => {
  if (ms <= 0) return 'Ended';
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

/**
 * Format a past timestamp as relative "time ago" (e.g. "5m ago", "2h ago").
 * Accepts a Firestore Timestamp, a {seconds} object, a Date, or epoch ms.
 * @param {*} ts - The timestamp to format
 * @returns {string} Human-readable relative time
 */
export const formatTimeAgo = (ts) => {
  if (!ts) return '';
  const date = ts.toDate ? ts.toDate() : ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
  const diff = Date.now() - date.getTime();
  if (diff < 0) return 'just now';
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
};

/**
 * Round a number to 2 decimal places
 * @param {number} value - The value to round
 * @returns {number} Rounded value
 */
export const round2 = (value) => Math.round(value * 100) / 100;

/**
 * Round a number to 3 decimal places
 * @param {number} value - The value to round
 * @returns {number} Rounded value
 */
export const round3 = (value) => Math.round(value * 1000) / 1000;
