// Season tiers. Mirror of SEASON_TIERS / seasonTierFor in functions/constants.js
// and functions/services/season.js — keep both in sync.
//
// Seasons run for one story arc. Nobody knows an arc's length ahead of time (the
// finale is only announced by "Finale" appearing in a chapter title), so tier
// targets are stored as a WEEKLY RATE and compounded over however many weeks the
// season has actually run. A fixed "+80% for Diamond" would be trivial in a
// 20-week arc and impossible in a 6-week one. Players never see the rate — the
// UI shows the live absolute target it works out to.

export const SEASON_TIERS = [
  { id: 'bronze', name: 'Bronze', order: 1, color: '#CD7F32' },
  { id: 'silver', name: 'Silver', order: 2, color: '#C0C0C0' },
  { id: 'gold', name: 'Gold', order: 3, color: '#FFD700' },
  { id: 'platinum', name: 'Platinum', order: 4, color: '#93C5FD' },
  { id: 'diamond', name: 'Diamond', order: 5, color: '#5FC9F3' },
];

export const SEASON_TIER_MAP = Object.fromEntries(SEASON_TIERS.map(t => [t.id, t]));

// Placeholder weekly rates, in percent per week, net of granted value. These are
// deliberate guesses — the real numbers come from the admin return-distribution
// readout once grant tracking has ~30 days of history. Diamond should land on
// roughly the top 3-5% of players.
export const DEFAULT_SEASON_THRESHOLDS = {
  silver: 0.4,
  gold: 1.0,
  platinum: 2.0,
  diamond: 3.5,
};

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

/**
 * The absolute return a tier requires after `weeks` of season, from its weekly
 * rate. Compounding, so a longer arc asks for more in total but the same
 * per-week pace.
 */
export const seasonTierTarget = (weeklyRatePercent, weeks) => {
  const w = Math.max(1, weeks || 1);
  return (Math.pow(1 + (weeklyRatePercent / 100), w) - 1) * 100;
};

/**
 * Highest tier a player has reached. `activeWeeks` only affects Bronze.
 * Returns null when nothing has been earned yet.
 */
export const seasonTierFor = ({ returnPercent, weeks, activeWeeks, thresholds }) => {
  const t = thresholds || DEFAULT_SEASON_THRESHOLDS;
  const ranked = ['diamond', 'platinum', 'gold', 'silver'];
  for (const id of ranked) {
    if (t[id] !== undefined && returnPercent >= seasonTierTarget(t[id], weeks)) return id;
  }
  if ((activeWeeks || 0) >= SEASON_BRONZE_ACTIVE_WEEKS) return 'bronze';
  return null;
};

/** The tier above `tierId`, or null at the top. Drives "next target" in the UI. */
export const nextSeasonTier = (tierId) => {
  const order = tierId ? (SEASON_TIER_MAP[tierId]?.order || 0) : 0;
  return SEASON_TIERS.find(t => t.order === order + 1) || null;
};
