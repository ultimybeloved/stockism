// Season tiers. Mirror of the season constants in functions/constants.js and the
// rules in functions/services/seasonTiers.js — keep them in sync
// (functions/seasonTiers.test.js checks the rules match).
//
// The tiers are a ladder: each one needs everything the one below it does.
// Bronze is banked at the Thursday checkpoints and kept once earned. Silver and
// Gold are judged on where a player finishes the season. Platinum and Diamond
// are shares of the season board, handed out when the season ends. Arc length is never known in advance (the finale is only
// announced by "Finale" appearing in a chapter title), and one month of market
// can't say what a whole arc will do, so fixed return targets would be trivial in
// one arc and impossible in the next.

export type SeasonTierId = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';

export interface SeasonTier {
  id: SeasonTierId;
  name: string;
  order: number;
  color: string;
}

export interface SeasonDivision {
  id: string;
  label: string;
  min: number;
  max: number | null;
}

export interface SeasonRules {
  bronzeActiveWeeks: number;
  platinumTopShare: number;
  diamondTopShare: number;
  diamondBeatShare: number;
  diamondMaxConcentration: number;
  diamondConcentrationMinInvested: number;
  titledTiers: readonly string[];
  divisions: readonly SeasonDivision[];
}

/** The parts of a season doc these helpers read. */
export interface SeasonLike {
  number?: number;
  preseason?: boolean;
  preseasons?: number;
  rules?: Partial<SeasonRules>;
}

export const SEASON_TIERS: SeasonTier[] = [
  { id: 'bronze', name: 'Bronze', order: 1, color: '#CD7F32' },
  { id: 'silver', name: 'Silver', order: 2, color: '#C0C0C0' },
  { id: 'gold', name: 'Gold', order: 3, color: '#FFD700' },
  { id: 'platinum', name: 'Platinum', order: 4, color: '#93C5FD' },
  { id: 'diamond', name: 'Diamond', order: 5, color: '#5FC9F3' },
];

export const SEASON_TIER_MAP: Record<string, SeasonTier> = Object.fromEntries(SEASON_TIERS.map((t) => [t.id, t]));

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
// A checkpoint only counts toward that limit when at least this share of the
// player's money is invested. Someone sitting almost all in cash with one small
// position is not "all in on one character", even though that position is 100%
// of what they hold. Mirror of functions/constants.js.
export const SEASON_DIAMOND_CONCENTRATION_MIN_INVESTED = 0.25;

// Tiers that give a permanent title when the season ends. Mirror of
// SEASON_TITLED_TIERS in functions/constants.js. The rest still show, they just
// don't pay a title.
export const SEASON_TITLED_TIERS: readonly string[] = Object.freeze(['gold', 'platinum', 'diamond']);

// Size divisions, by value when your season baseline was pinned. Platinum and
// Diamond are ranked within a division so small accounts, which swing further,
// don't take every top place. Mirror of SEASON_DIVISIONS in functions/constants.js.
export const SEASON_DIVISIONS: readonly SeasonDivision[] = Object.freeze([
  Object.freeze({ id: 'rookie', label: 'Rookie', min: 0, max: 10000 }),
  Object.freeze({ id: 'trader', label: 'Trader', min: 10000, max: 50000 }),
  Object.freeze({ id: 'whale', label: 'Whale', min: 50000, max: 200000 }),
  Object.freeze({ id: 'titan', label: 'Titan', min: 200000, max: null }),
]);

export const DEFAULT_SEASON_RULES: Readonly<SeasonRules> = Object.freeze({
  bronzeActiveWeeks: SEASON_BRONZE_ACTIVE_WEEKS,
  platinumTopShare: SEASON_PLATINUM_TOP_SHARE,
  diamondTopShare: SEASON_DIAMOND_TOP_SHARE,
  diamondBeatShare: SEASON_DIAMOND_BEAT_SHARE,
  diamondMaxConcentration: SEASON_DIAMOND_MAX_CONCENTRATION,
  diamondConcentrationMinInvested: SEASON_DIAMOND_CONCENTRATION_MIN_INVESTED,
  titledTiers: SEASON_TITLED_TIERS,
  divisions: SEASON_DIVISIONS,
});

/** The rules a season is scored by: whatever it was started with, over the defaults. */
export const seasonRulesFor = (season: SeasonLike | null | undefined): SeasonRules => ({
  ...DEFAULT_SEASON_RULES,
  ...(season?.rules || {}),
});

const asPercent = (share: number) => `${Math.round(share * 100)}%`;

/** One plain sentence per tier, for the card, the board and the admin panel. */
export const seasonTierRule = (tierId: string, rules: SeasonRules = DEFAULT_SEASON_RULES): string =>
  (
    ({
      bronze: `Be active in ${rules.bronzeActiveWeeks} weeks of the season.`,
      silver: "Earn Bronze and finish the season up. Free stock and bonuses don't count.",
      gold: 'Earn Silver and finish the season ahead of the market.',
      platinum: `Earn Gold and finish in the top ${asPercent(rules.platinumTopShare)} of your division against the market.`,
      diamond: `The best Platinum finishers, up to ${asPercent(rules.diamondTopShare)} of your division, who beat the market in ${asPercent(rules.diamondBeatShare)} of weeks and never had more than ${asPercent(rules.diamondMaxConcentration)} of their invested money on one character (shorts and crew funds included) at a checkpoint where at least ${asPercent(rules.diamondConcentrationMinInvested)} of their money was invested.`,
    }) as Record<string, string>
  )[tierId] || '';

/** The size division a baseline value falls in. Mirror of divisionFor in seasonTiers.js. */
export const seasonDivisionFor = (
  baselineValue: number | null | undefined,
  rules: Pick<SeasonRules, 'divisions'> = DEFAULT_SEASON_RULES,
): SeasonDivision | null => {
  const divisions = rules.divisions || [];
  const v = baselineValue || 0;
  return (
    divisions.find((d) => v >= d.min && (d.max === null || d.max === undefined || v < d.max)) || divisions[0] || null
  );
};

/** "$10k to $50k", "$200k and up". */
export const divisionRange = (d: SeasonDivision | null | undefined): string => {
  const k = (n: number) => `$${(n / 1000).toLocaleString()}k`;
  if (!d) return '';
  if (d.max === null || d.max === undefined) return `${k(d.min)} and up`;
  return d.min > 0 ? `${k(d.min)} to ${k(d.max)}` : `under ${k(d.max)}`;
};

/** Whether finishing on `tierId` earns a title this season. */
export const tierGivesTitle = (tierId: string, rules: SeasonRules = DEFAULT_SEASON_RULES): boolean =>
  rules.titledTiers.includes(tierId);

/** "Season 2", or "Preseason" for a trial run that doesn't use up a number. */
export const seasonLabel = (season: SeasonLike | null | undefined): string => {
  if (!season?.preseason) return `Season ${season?.number}`;
  const n = season.preseasons || 1;
  return n > 1 ? `Preseason ${n}` : 'Preseason';
};

/**
 * Silver or Gold from where a player stands on the season. Gold needs Silver
 * too: beating a falling market while down is not Gold. Mirror of standingTier
 * in seasonTiers.js.
 */
export const seasonStandingTier = ({
  returnPercent,
  marketPercent,
}: {
  returnPercent: number;
  marketPercent: number;
}): 'gold' | 'silver' | null => {
  if (!(returnPercent > 0)) return null;
  return returnPercent > marketPercent ? 'gold' : 'silver';
};

/** The tier above `tierId`, or null at the top. Drives "next up" in the UI. */
export const nextSeasonTier = (tierId: string | null | undefined): SeasonTier | null => {
  const order = tierId ? SEASON_TIER_MAP[tierId]?.order || 0 : 0;
  return SEASON_TIERS.find((t) => t.order === order + 1) || null;
};

// Coordinated-pressure flags in one season before the admin panel marks a
// player as a repeat case. Only a prompt: the admin still decides who is kept
// out of Platinum and Diamond.
export const SEASON_REPEAT_COORD_FLAGS = 3;
