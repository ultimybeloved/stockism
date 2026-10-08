/**
 * The share count stored for one ticker. Holdings are plain numbers, but very
 * old accounts stored `{ shares }` objects, and admin tools still read those.
 */
export const sharesOf = (value: unknown): number =>
  typeof value === 'number' ? value : (value as { shares?: number } | null)?.shares || 0;
