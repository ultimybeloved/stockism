// ============================================
// CHARACTER STATUS
// ============================================
// Whether a character is alive in the story right now. Independent of crews and
// generations, and set by hand rather than derived from anything.
//
// A character carries this as an optional `status` field in src/characters.js
// holding one of the ids below. No field means alive, which is the common case,
// so the roster does not need annotating for the majority. ETFs never get one.
//
// `flashback` exists because this story runs flashback arcs: a character can be
// dead in the present and active in the arc currently being published. Marking
// those as plain `dead` would be wrong on the board while they are the ones
// driving the chapter.
//
// `npm run check:data` rejects any value that is not an id here, so a typo in a
// batch fails loudly instead of quietly inventing a fourth state.

export const STATUSES = [
  { id: 'alive', label: 'Alive', badge: '', hint: 'Alive in the current story' },
  { id: 'dead', label: 'Dead', badge: '💀', hint: 'Dead in the current story' },
  { id: 'flashback', label: 'Flashback', badge: '⏳', hint: 'Dead in the present, active in a flashback arc' },
];

export const STATUS_IDS = STATUSES.map((s) => s.id);

// The stored ids. `alive` is never written to a character, only inferred.
export const STORED_STATUS_IDS = STATUS_IDS.filter((id) => id !== 'alive');

export const STATUS_MAP = Object.fromEntries(STATUSES.map((s) => [s.id, s]));

// A missing field means alive. Everything reading status goes through this so
// the default lives in one place.
export const statusOf = (character) => character?.status || 'alive';

export const statusBadge = (character) => STATUS_MAP[statusOf(character)]?.badge || '';
