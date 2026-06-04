// ============================================
// USERNAME FORMAT VALIDATION
// ============================================
// Mirror of validateUsernameFormat in functions/helpers.js — keep both in sync.
// Returns a user-facing error string, or null if the name is valid.
// Does NOT check uniqueness, bans, or profanity — those are handled separately.

/**
 * @param {string} name - Trimmed display name
 * @returns {string|null} Error message, or null if valid
 */
export function validateUsername(name) {
  if (name.length < 3) return 'Username must be at least 3 characters';
  if (name.length > 20) return 'Username must be 20 characters or less';
  if (!/^[a-zA-Z0-9_]+$/.test(name)) return 'Username can only contain letters, numbers, and underscores';
  if ((name.match(/[a-zA-Z0-9]/g) || []).length < 3) return 'Username must include at least 3 letters or numbers';
  if ((name.match(/_/g) || []).length > 2 || name.includes('__') || name.startsWith('_') || name.endsWith('_')) {
    return 'Username can have at most 2 underscores, not repeated or at the start or end';
  }
  return null;
}
