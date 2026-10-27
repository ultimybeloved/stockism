// GENERATED from src/rules/flairCrews.ts by `npm run sync:chars`. Do not edit.
// ============================================
// FLAIR CREWS
// ============================================
// Smaller crews inside a main crew that a player can rep. The small crew pin
// next to the player's name swaps to the flair crest, and the flair missions
// (Flair Support, Flair Tour) ask for its members. Rankings, the underdog
// multiplier, crew head, the ETF, and the other missions stay on the main crew.
//
// Free to pick or change any time. The player writes `flairCrew` straight to
// their user doc (it's on the rules allowlist), so a flair only counts while
// it belongs to the player's current crew: switching crews hides it without
// anything having to clear it. Everything reading it goes through flairOf.
//
// `members` lists the characters on the site who belong to the flair crew, for
// the flair missions. A character can sit in more than one, and two
// main crews can each have their own version of the same flair crew (each is
// its own entry, with its own crest).

export interface FlairCrew {
  id: string;
  name: string;
  /** The main crew it sits inside. */
  crew: string;
  members: string[];
}

const FLAIR_LIST: FlairCrew[] = [
  { id: 'BURN_KNUCKLES', name: 'Burn Knuckles', crew: 'ALLIED', members: ['VSCO', 'JACE'] },
  { id: 'ANSAN_PUBLIC', name: 'Ansan Public', crew: 'ALLIED', members: ['AHN', 'TM'] },
  { id: 'CHEONLIANG', name: 'Cheonliang', crew: 'ALLIED', members: ['VIN', '2SEC', '6KNG', 'SUJN'] },
  {
    id: 'J_HIGH',
    name: 'J High',
    crew: 'ALLIED',
    members: ['BDNL', 'LDNL', 'ZACK', 'JAY', 'VSCO', 'JACE', 'VIN', '2SEC', 'ELI'],
  },
  { id: 'BACK_DOOR', name: 'Back Door', crew: 'BIG_DEAL', members: ['DOOR', 'JIHO'] },
  { id: 'GANGSEO_UNION', name: 'Gangseo Union', crew: 'SECRET_FRIENDS', members: ['SAM', 'ALEX'] },
  { id: 'CHEONLIANG_SF', name: 'Cheonliang', crew: 'SECRET_FRIENDS', members: ['SHMN'] },
  { id: 'HOSTEL_A', name: 'Hostel A', crew: 'HOSTEL', members: ['OLLY', 'JGNG'] },
  { id: 'RUNAWAY_FAM', name: 'Runaway Fam', crew: 'HOSTEL', members: [] },
  {
    id: 'LIBERATION_TRAINING_CORPS',
    name: 'Liberation Training Corps',
    crew: 'FIST_GANG',
    members: ['JYNG', 'DNCE', 'EUNH'],
  },
  { id: 'THE_BEGGARS', name: 'The Beggars', crew: 'FIST_GANG', members: ['TOM', 'TOAD', 'DOGH', 'POLR'] },
  { id: 'BLACK_WORKERS', name: 'Black Workers', crew: 'WORKERS', members: ['BANG'] },
  { id: 'THE_CARTEL', name: 'The Cartel', crew: 'KITAE_UNION', members: ['KTAE', 'ISU', 'SHMN'] },
];

export const FLAIR_CREWS: Record<string, FlairCrew> = Object.fromEntries(FLAIR_LIST.map((f) => [f.id, f]));

/** The flair crews a main crew offers, in display order. */
export const flairCrewsOf = (crewId: string | null | undefined): FlairCrew[] =>
  FLAIR_LIST.filter((f) => f.crew === crewId);

/** The player's flair crew, or null if they have none or it isn't from their current crew. */
export const flairOf = (player: { crew?: string | null; flairCrew?: unknown } | null | undefined): FlairCrew | null => {
  const id = player?.flairCrew;
  const flair = typeof id === 'string' ? FLAIR_CREWS[id] : undefined;
  return flair && flair.crew === player?.crew ? flair : null;
};

/** The flair crew's pin, drawn by scripts/pixel-flair.cjs. */
export const flairCrestSrc = (flair: FlairCrew): string => `/pins/crests/flair/${flair.id.toLowerCase()}.svg`;
