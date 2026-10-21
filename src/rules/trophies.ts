// The trophy case: up to six things a player chooses to show on their profile.
// Shared rule module (see src/rules/ladder.ts): the server checks a new case
// with cleanTrophyCase before saving it, and again when a profile is read, so
// something the player no longer owns (a revoked achievement) drops out on its
// own. The profile page uses the same checks to list what can be picked.
//
// A trophy is a string id, `kind:ref`:
//   ach:<achievement id>    an earned achievement
//   title:<title id>        a season title they own (not only the one worn)
//   cos:<cosmetic id>       any owned cosmetic (names, effects, backdrops, frames)
//   pin:<shop pin id>       an owned shop pin
//   head                    their longest reign as a crew head

export const TROPHY_SLOTS = 6;

export type TrophyKind = 'ach' | 'title' | 'cos' | 'pin' | 'head';

/** A player's longest reign as a crew head. Kept after the crown is lost. */
export interface CrewHeadBest {
  weeks: number;
  /** The crew they led then; null when only the CROWNED achievement proves a reign. */
  crew: string | null;
}

/** The parts of a user doc that prove ownership. */
export interface TrophySource {
  achievements?: unknown;
  ownedTitles?: unknown;
  ownedCosmetics?: unknown;
  ownedShopPins?: unknown;
  crewHeadBest?: CrewHeadBest | null;
}

const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Split a trophy id into its kind and reference, or null if it is malformed. */
export function parseTrophy(id: unknown): { kind: TrophyKind; ref: string } | null {
  if (typeof id !== 'string' || id.length > 100) return null;
  if (id === 'head') return { kind: 'head', ref: '' };
  const at = id.indexOf(':');
  const kind = id.slice(0, at);
  const ref = id.slice(at + 1);
  if (at < 1 || !ref) return null;
  return kind === 'ach' || kind === 'title' || kind === 'cos' || kind === 'pin' ? { kind, ref } : null;
}

/** The crew-head reign a player can show: their record, or one week if only CROWNED proves it. */
export function headReign(src: TrophySource): CrewHeadBest | null {
  const best = src.crewHeadBest;
  if (best && Number(best.weeks) >= 1) return { weeks: Math.floor(Number(best.weeks)), crew: best.crew || null };
  return list(src.achievements).includes('CROWNED') ? { weeks: 1, crew: null } : null;
}

/** Whether the player owns what this trophy shows. */
export function ownsTrophy(src: TrophySource, id: unknown): boolean {
  const t = parseTrophy(id);
  if (!t) return false;
  switch (t.kind) {
    case 'ach':
      return list(src.achievements).includes(t.ref);
    case 'title':
      return list(src.ownedTitles).includes(t.ref);
    case 'cos':
      return list(src.ownedCosmetics).includes(t.ref);
    case 'pin':
      return list(src.ownedShopPins).includes(t.ref);
    case 'head':
      return headReign(src) != null;
  }
}

/** A case made safe to save or show: owned items only, no repeats, at most TROPHY_SLOTS. */
export function cleanTrophyCase(src: TrophySource, ids: unknown): string[] {
  const out: string[] = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    if (out.length >= TROPHY_SLOTS) break;
    if (typeof id === 'string' && !out.includes(id) && ownsTrophy(src, id)) out.push(id);
  }
  return out;
}

/** Every trophy the player could put in their case, grouped by kind. */
export function ownedTrophies(src: TrophySource): Record<TrophyKind, string[]> {
  return {
    head: headReign(src) ? ['head'] : [],
    title: list(src.ownedTitles).map((r) => `title:${r}`),
    cos: list(src.ownedCosmetics).map((r) => `cos:${r}`),
    pin: list(src.ownedShopPins).map((r) => `pin:${r}`),
    ach: list(src.achievements).map((r) => `ach:${r}`),
  };
}
