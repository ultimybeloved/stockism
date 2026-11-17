// ============================================
// DATE UTILITY FUNCTIONS
// ============================================

/**
 * Get today's date as a string (YYYY-MM-DD format)
 * Used for daily mission tracking
 * @returns {string} Today's date string
 */
import type { TimestampLike } from '../types';

/** Anything `new Date(...)` accepts. */
type DateInput = number | string | Date;

const isoDay = (d: Date): string => d.toISOString().split('T')[0]!;

export const getTodayDateString = (): string => {
  return isoDay(new Date());
};

/**
 * Check if a timestamp is from today
 * @param {number} timestamp - Unix timestamp in milliseconds
 * @returns {boolean} True if timestamp is from today
 */
export const isToday = (timestamp: DateInput): boolean => {
  const date = new Date(timestamp);
  const today = new Date();
  return date.toDateString() === today.toDateString();
};

/**
 * Convert Firestore Timestamp or number to milliseconds
 * Handles both Firestore Timestamp objects and plain numbers
 * @param {Object|number} timestamp - Firestore Timestamp object or number
 * @returns {number} Unix timestamp in milliseconds
 */
export const toMillis = (timestamp: TimestampLike): number => {
  if (!timestamp) return 0;
  if (typeof timestamp === 'number') return timestamp;
  if (typeof timestamp !== 'object' || timestamp instanceof Date) return 0;
  if ('toMillis' in timestamp && typeof timestamp.toMillis === 'function') return timestamp.toMillis();
  if ('nanoseconds' in timestamp && timestamp.seconds)
    return timestamp.seconds * 1000 + Math.floor((timestamp.nanoseconds || 0) / 1000000);
  if (timestamp.seconds) return timestamp.seconds * 1000;
  return 0;
};

/**
 * Convert Firestore Timestamp or string to date string format
 * Handles Timestamp objects, Date objects, and strings
 * @param {Object|string|Date} timestamp - Firestore Timestamp, Date, or string
 * @returns {string|null} Date string in format like "Mon Jan 27 2025"
 */
export const toDateString = (timestamp: TimestampLike): string | null => {
  if (!timestamp) return null;
  if (typeof timestamp === 'string') return timestamp;
  if (typeof timestamp === 'number') return null;
  if (timestamp instanceof Date) return timestamp.toDateString();
  if ('toDate' in timestamp && typeof timestamp.toDate === 'function') return timestamp.toDate().toDateString();
  if (timestamp.seconds) return new Date(timestamp.seconds * 1000).toDateString();
  return null;
};

/**
 * Convert any timestamp to UTC YYYY-MM-DD string (matches server format)
 * Used for check-in comparisons to avoid timezone mismatch
 */
export const toUTCDateString = (timestamp: TimestampLike): string | null => {
  if (!timestamp) return null;
  if (typeof timestamp === 'string') {
    const parsed = new Date(timestamp);
    if (!isNaN(parsed.getTime())) return isoDay(parsed);
    return null;
  }
  if (typeof timestamp === 'number') return isoDay(new Date(timestamp));
  if (timestamp instanceof Date) return isoDay(timestamp);
  if ('toDate' in timestamp && typeof timestamp.toDate === 'function') return isoDay(timestamp.toDate());
  if (timestamp.seconds) return isoDay(new Date(timestamp.seconds * 1000));
  return null;
};

/**
 * Get the start (local midnight) of the current chapter week, which begins
 * on Wednesday. Used for "new this week" boards and weekly persistence keys.
 * @returns {Date} Most recent Wednesday at 00:00 local time
 */
export const getWeekStart = (): Date => {
  const now = new Date();
  const day = now.getDay();
  // Wednesday = 3, so we need to go back to the most recent Wednesday
  const daysToSubtract = (day + 4) % 7; // Days since last Wednesday
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - daysToSubtract);
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
};

/**
 * Get milliseconds until next UTC midnight
 */
export const msUntilUTCMidnight = (): number => {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return tomorrow.getTime() - now.getTime();
};
