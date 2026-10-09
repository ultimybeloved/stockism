// Season tiers: the thresholds, the size divisions and the default rules a
// season is scored by. Shared rule module (see src/rules/ladder.ts for what that
// means): the season card, board and admin panel read the same numbers the
// server banks tiers with. The scoring itself lives in
// functions/src/season/seasonTiers.ts, which explains the rules in full.
//
// The tiers are a ladder: each one needs everything the one below it does.
// Bronze is banked at the Thursday checkpoints and kept once earned. Silver and
// Gold are judged on where a player finishes the season. Platinum and Diamond
// are shares of the season board, handed out when the season ends. Arc length
// is never known in advance, so fixed return targets would be trivial in one arc
// and impossible in the next.

export const SEASON_TIER_ORDER = ['bronze', 'silver', 'gold', 'platinum', 'diamond'] as const;

// Bronze is not a return threshold. It is for turning up: a player active at
// this many weekly checkpoints earns it regardless of performance, so a losing
// season still ends with something.
export const SEASON_BRONZE_ACTIVE_WEEKS = 2;

// Smallest pinned baseline the server will score a player from. Below this a
// percentage return is noise, so the server skips the player entirely and the
// UI uses the same gate.
export const SEASON_MIN_BASELINE = 1000;

// Platinum and Diamond, as shares of the season board when the season ends.
// Fixed return targets were dropped on 2026-09-13: one hot month (median active
// player +34% while the index made +5%) can't say what a whole arc will look like.
export const SEASON_PLATINUM_TOP_SHARE = 0.15;
export const SEASON_DIAMOND_TOP_SHARE = 0.05;
// Diamond also needs the market beaten in this share of the season's weeks...
export const SEASON_DIAMOND_BEAT_SHARE = 0.75;
// ...and no single character above this share of invested money at ANY weekly
// checkpoint. Permanent for the season on purpose: dodging it means selling down
// before every Thursday and buying back after, paying price impact both ways.
export const SEASON_DIAMOND_MAX_CONCENTRATION = 0.6;
// A checkpoint only counts toward that limit when at least this share of the
// player's money is invested. Someone sitting almost all in cash with one small
// position is not "all in on one character".
export const SEASON_DIAMOND_CONCENTRATION_MIN_INVESTED = 0.25;

// Tiers that hand out a permanent title when the season ends. The lower tiers
// still show, they just don't pay a title: a title every active player owns
// means nothing.
export const SEASON_TITLED_TIERS: readonly string[] = Object.freeze(['gold', 'platinum', 'diamond']);

export interface SeasonDivision {
  id: string;
  label: string;
  min: number;
  max: number | null;
}

// Size divisions, by value when a player's season baseline was pinned. Platinum
// and Diamond are ranked WITHIN a division: on 2026-09-18 the median 30-day
// return was about the same at every size, but the best Rookie made +2,785% and
// the best Titan +90%, so one shared board handed the top places to small
// accounts that can swing further. `max: null` = no upper bound (Firestore
// can't store Infinity).
export const SEASON_DIVISIONS: readonly SeasonDivision[] = Object.freeze([
  Object.freeze({ id: 'rookie', label: 'Rookie', min: 0, max: 10000 }),
  Object.freeze({ id: 'trader', label: 'Trader', min: 10000, max: 50000 }),
  Object.freeze({ id: 'whale', label: 'Whale', min: 50000, max: 200000 }),
  Object.freeze({ id: 'titan', label: 'Titan', min: 200000, max: null }),
]);

/** The rules a season is scored by, pinned on the season doc at its start. */
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
export const rulesFor = (season: { rules?: Partial<SeasonRules> } | null | undefined): SeasonRules => ({
  ...DEFAULT_SEASON_RULES,
  ...(season?.rules || {}),
});

/** The size division a baseline value falls in (the first one if nothing matches). */
export const divisionOf = (
  baselineValue: number | null | undefined,
  rules: Pick<SeasonRules, 'divisions'> = DEFAULT_SEASON_RULES,
): SeasonDivision | null => {
  const divisions = rules.divisions || [];
  const v = baselineValue || 0;
  return (
    divisions.find((d) => v >= d.min && (d.max === null || d.max === undefined || v < d.max)) || divisions[0] || null
  );
};

/**
 * Silver or Gold from where a player stands on the season. Gold needs Silver
 * too: beating a falling market while down is not Gold.
 */
export const standingTier = ({
  returnPercent,
  marketPercent,
}: {
  returnPercent: number;
  marketPercent: number;
}): 'gold' | 'silver' | null => {
  if (!(returnPercent > 0)) return null;
  return returnPercent > marketPercent ? 'gold' : 'silver';
};
