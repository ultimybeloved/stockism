// Season tiers. Mirror of the season constants in functions/constants.js and the
// rules in functions/services/seasonTiers.js — keep them in sync
// (functions/seasonTiers.test.js checks the rules match).
//
// Bronze, Silver and Gold are checked at every Thursday checkpoint and kept once
// earned. Platinum and Diamond are shares of the season board, handed out when
// the season ends. Arc length is never known in advance (the finale is only
// announced by "Finale" appearing in a chapter title), and one month of market
// can't say what a whole arc will do, so fixed return targets would be trivial in
// one arc and impossible in the next.

export const SEASON_TIERS = [
  { id: 'bronze', name: 'Bronze', order: 1, color: '#CD7F32' },
  { id: 'silver', name: 'Silver', order: 2, color: '#C0C0C0' },
  { id: 'gold', name: 'Gold', order: 3, color: '#FFD700' },
  { id: 'platinum', name: 'Platinum', order: 4, color: '#93C5FD' },
  { id: 'diamond', name: 'Diamond', order: 5, color: '#5FC9F3' },
];

export const SEASON_TIER_MAP = Object.fromEntries(SEASON_TIERS.map(t => [t.id, t]));

// Bronze is not a return threshold. It is for turning up: a player active at this
// many weekly checkpoints earns it regardless of performance, so a losing season
// still ends with something. Without it the ~half of players who are down get
// nothing, which is the opposite of what a catch-up system is for.
export const SEASON_BRONZE_ACTIVE_WEEKS = 2;

// Smallest pinned baseline the server will score a player from. Mirror of
// SEASON_MIN_BASELINE in functions/constants.js — keep both in sync. Below this
// a percentage return is noise, so the server skips the player entirely; the UI
// has to use the same gate or it shows tier progress that is never banked.
export const SEASON_MIN_BASELINE = 1000;

// Platinum and Diamond, as shares of the season board when the season ends.
export const SEASON_PLATINUM_TOP_SHARE = 0.15;
export const SEASON_DIAMOND_TOP_SHARE = 0.05;
// Diamond also needs the market beaten in this share of the season's weeks, and
// no single character above this share of invested money at any checkpoint.
export const SEASON_DIAMOND_BEAT_SHARE = 0.75;
export const SEASON_DIAMOND_MAX_CONCENTRATION = 0.6;

export const DEFAULT_SEASON_RULES = Object.freeze({
  bronzeActiveWeeks: SEASON_BRONZE_ACTIVE_WEEKS,
  platinumTopShare: SEASON_PLATINUM_TOP_SHARE,
  diamondTopShare: SEASON_DIAMOND_TOP_SHARE,
  diamondBeatShare: SEASON_DIAMOND_BEAT_SHARE,
  diamondMaxConcentration: SEASON_DIAMOND_MAX_CONCENTRATION,
});

/** The rules a season is scored by: whatever it was started with, over the defaults. */
export const seasonRulesFor = (season) => ({ ...DEFAULT_SEASON_RULES, ...(season?.rules || {}) });

const asPercent = (share) => `${Math.round(share * 100)}%`;

/** One plain sentence per tier, for the card, the board and the admin panel. */
export const seasonTierRule = (tierId, rules = DEFAULT_SEASON_RULES) => ({
  bronze: `Be active in ${rules.bronzeActiveWeeks} weeks of the season.`,
  silver: 'Be up on the season. Free stock and bonuses don\'t count.',
  gold: 'Beat the market.',
  platinum: `Finish in the top ${asPercent(rules.platinumTopShare)} of the season board against the market.`,
  diamond: `The best Platinum finishers, up to ${asPercent(rules.diamondTopShare)} of the board, who beat the market in ${asPercent(rules.diamondBeatShare)} of weeks and never had more than ${asPercent(rules.diamondMaxConcentration)} of their invested money in one character.`,
}[tierId] || '');

/** "Season 2", or "Preseason" for a trial run that doesn't use up a number. */
export const seasonLabel = (season) => {
  if (!season?.preseason) return `Season ${season?.number}`;
  const n = season.preseasons || 1;
  return n > 1 ? `Preseason ${n}` : 'Preseason';
};

/** The tier above `tierId`, or null at the top. Drives "next up" in the UI. */
export const nextSeasonTier = (tierId) => {
  const order = tierId ? (SEASON_TIER_MAP[tierId]?.order || 0) : 0;
  return SEASON_TIERS.find(t => t.order === order + 1) || null;
};
