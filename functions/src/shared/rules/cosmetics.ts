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

// How a player wears the cosmetics that come with a choice. Stored on the user
// doc as `cosmeticStyle` (client-writable, like activeCosmetics), so every
// value is checked against these lists before anyone else sees it.
// - flap: the Split Flap name's motion
// - bullbear: the Bull / Bear frame follows the day, or always shows both halves
// - tint: the plain color backdrops as a fade or a solid fill
export const COSMETIC_STYLE_OPTIONS = {
  flap: ['random', 'scramble', 'board'],
  bullbear: ['daily', 'split'],
  tint: ['fade', 'solid'],
} as const;

export type FlapStyle = (typeof COSMETIC_STYLE_OPTIONS.flap)[number];
export type BullBearStyle = (typeof COSMETIC_STYLE_OPTIONS.bullbear)[number];
export type TintStyle = (typeof COSMETIC_STYLE_OPTIONS.tint)[number];
export type CosmeticStyleKey = keyof typeof COSMETIC_STYLE_OPTIONS;

export interface CosmeticStyle {
  flap?: FlapStyle;
  bullbear?: BullBearStyle;
  tint?: TintStyle;
}

/** Keeps only known keys with known values; anything else is dropped. */
export const cleanCosmeticStyle = (raw: unknown): CosmeticStyle => {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, options] of Object.entries(COSMETIC_STYLE_OPTIONS)) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === 'string' && (options as readonly string[]).includes(value)) out[key] = value;
  }
  return out as CosmeticStyle;
};
