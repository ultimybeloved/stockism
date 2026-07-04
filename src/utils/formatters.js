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
 * Format a chart's y-axis gridline values as dollar labels.
 * Starts at the coarsest precision and adds decimals until every label is
 * distinct, so a tight price range never renders as "$85, $85, $85, $84".
 * On perfectly flat data (all gridlines equal) only the middle label is kept.
 * @param {number[]} values - Gridline values, in render order
 * @param {{kilo?: boolean}} [opts] - kilo: render as "$3.0k" style
 * @returns {string[]} One label per input value ('' = skip rendering)
 */
export const formatAxisLabels = (values, { kilo = false } = {}) => {
  const fmt = (v, d) => (kilo ? `$${(v / 1000).toFixed(d)}k` : `$${v.toFixed(d)}`);
  for (let d = kilo ? 1 : 0; d <= 2; d++) {
    const labels = values.map((v) => fmt(v, d));
    if (new Set(labels).size === labels.length) return labels;
  }
  const mid = Math.floor(values.length / 2);
  return values.map((v, i) => (i === mid ? fmt(v, kilo ? 1 : 2) : ''));
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
