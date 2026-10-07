// ============================================
// CHARACTER GENERATIONS
// ============================================
// Lore grouping, independent of crews — a character has exactly one generation
// and any number of crews. Used as a second filter row on the market grid that
// stacks on top of the crew filter.
//
// A character carries this as an optional `generation` field in
// src/characters.js holding one of the ids below. No field means unassigned,
// which is a normal state: the roster is being classified in batches, and the
// "Unassigned" pill exists to show what is left. ETFs never get one.
//
// `npm run check:data` rejects any value that is not an id here, so a typo in a
// batch fails loudly instead of quietly inventing a fifth generation.

export const GENERATIONS = [
  { id: 'pre', label: 'Pre-Generation' },
  { id: '1st', label: '1st Generation' },
  { id: '1.5', label: 'Generation 1.5' },
  { id: '2nd', label: '2nd Generation' },
];

export const GENERATION_IDS = GENERATIONS.map((g) => g.id);

export const GENERATION_LABELS = Object.fromEntries(GENERATIONS.map((g) => [g.id, g.label]));

// Filter sentinels, kept here so the hook and the pills agree on the strings.
export const GENERATION_FILTER_ALL = 'ALL';
export const GENERATION_FILTER_UNASSIGNED = 'UNASSIGNED';
