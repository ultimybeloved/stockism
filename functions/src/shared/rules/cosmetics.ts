// GENERATED from src/rules/cosmetics.ts by `npm run sync:chars`. Do not edit.
// Cosmetic rules the website shows and the server computes. Shared rule module
// (see src/rules/ladder.ts for what that means).

// The Bull / Bear row frame turns green or red with the wearer's day.
export const BULLBEAR_FRAME_ID = 'frame_bullbear';

export type FrameTrend = 'up' | 'down' | null;

// Up or down against the 24-hour portfolio snapshot. null when there is nothing
// to compare against yet (new account, no snapshot), so the frame stays neutral.
export const frameTrend = (
  portfolioValue: unknown,
  snapshot24h: { value?: unknown } | null | undefined,
): FrameTrend => {
  const base = snapshot24h?.value;
  if (typeof portfolioValue !== 'number' || typeof base !== 'number' || !(base > 0)) return null;
  if (portfolioValue > base) return 'up';
  if (portfolioValue < base) return 'down';
  return null;
};

// A stable number per player, from their name (the one key every surface has).
export const seedHash = (key: string | null | undefined): number => {
  let h = 2166136261;
  for (const ch of (key || '').toLowerCase()) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

// A per-player phase for frame animations, so two rows wearing the same frame
// never move in step: a delay of 0 to 60 seconds and a starting angle.
export const frameSeed = (key: string | null | undefined): { seconds: number; degrees: number } => {
  const h = seedHash(key);
  return { seconds: (h % 6000) / 100, degrees: (h >>> 13) % 360 };
};
