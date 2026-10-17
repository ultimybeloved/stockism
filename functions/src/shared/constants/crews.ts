// Crew rosters (derived from crews.ts) and crew values.

import { CREWS, CREW_UNDERDOG_MULT_MAX, CREW_SWITCH_PENALTY, CREW_SWITCH_EVENT, isFreeSwitchTarget } from '../crews';

// ============================================
// CREW MEMBER MAPPINGS
// ============================================
// Derived from src/crews.ts via the synced functions/src/shared/crews.ts — never list
// rosters here by hand (a hand-copied list once drifted and broke missions
// for newly added characters).
export const CREW_MEMBERS: Record<string, string[]> = {};
Object.values(CREWS).forEach((c) => {
  CREW_MEMBERS[c.id] = c.members;
});

export const ALL_CREW_TICKERS = new Set(Object.values(CREW_MEMBERS).flat());

export const ANIMAL_TICKERS = new Set(['RYAN', 'EDEN', 'MIRO', 'ENU']);

// Crew head ("top dog") — assigned automatically every Thursday reopen by
// weeklyCrewRankings: the biggest PORTFOLIO among a crew's active members.
// It used to be best weekly percentage gain, which players found confusing —
// a small account having one good week outranked the crew's actual
// heavyweight, and the crown changed hands for reasons nobody could see.
// Wealth is the obvious reading of "crew head", so that is what it is now.
// The crown carries no payout, only cosmetics, so ranking by size hands
// whales no economic advantage.
// Dynasty weeks = the streak that earns DYNASTY, and the reign length that
// makes dethroning someone count as USURPER.
export const CREW_HEAD_DYNASTY_WEEKS = 4;

export { CREWS, CREW_UNDERDOG_MULT_MAX, CREW_SWITCH_PENALTY, CREW_SWITCH_EVENT, isFreeSwitchTarget };
