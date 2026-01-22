// ============================================
// DATE UTILITY FUNCTIONS
// ============================================

/**
 * Get today's date as a string (YYYY-MM-DD format)
 * Used for daily mission tracking
 * @returns {string} Today's date string
 */
export const getTodayDateString = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

/**
 * Get yesterday's date as a string (YYYY-MM-DD format)
 * @returns {string} Yesterday's date string
 */
export const getYesterdayDateString = () => {
  const now = new Date();
  now.setDate(now.getDate() - 1);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

/**
 * Check if a timestamp is from today
 * @param {number} timestamp - Unix timestamp in milliseconds
 * @returns {boolean} True if timestamp is from today
 */
export const isToday = (timestamp) => {
  const date = new Date(timestamp);
  const today = new Date();
  return date.toDateString() === today.toDateString();
};

/**
 * Check if a timestamp is from yesterday
 * @param {number} timestamp - Unix timestamp in milliseconds
 * @returns {boolean} True if timestamp is from yesterday
 */
export const isYesterday = (timestamp) => {
  const date = new Date(timestamp);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return date.toDateString() === yesterday.toDateString();
};

/**
 * Get the start of today (midnight) as a timestamp
 * @returns {number} Unix timestamp for start of today
 */
export const getStartOfToday = () => {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.getTime();
};

/**
 * Get a relative time string (e.g., "2 hours ago", "3 days ago")
 * @param {number} timestamp - Unix timestamp in milliseconds
 * @returns {string} Relative time string
 */
export const getRelativeTime = (timestamp) => {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'Just now';
};

/**
 * Format a timestamp to a short date string
 * @param {number} timestamp - Unix timestamp in milliseconds
 * @returns {string} Formatted date string (e.g., "Jan 15")
 */
export const formatShortDate = (timestamp) => {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });
};

/**
 * Format a timestamp to a full date string with time
 * @param {number} timestamp - Unix timestamp in milliseconds
 * @returns {string} Formatted date string (e.g., "Jan 15, 2024, 3:30 PM")
 */
export const formatFullDate = (timestamp) => {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};
