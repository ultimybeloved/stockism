// Season tiers for the UI: names, colours and the plain-language rules. The
// thresholds, divisions and default rules are the shared rule module
// src/rules/seasons.ts, so the season card and board read the same numbers the
// server banks tiers with.

import { rulesFor, divisionOf, standingTier, DEFAULT_SEASON_RULES } from '../rules/seasons';
import type { SeasonDivision, SeasonRules } from '../rules/seasons';

export {
  SEASON_BRONZE_ACTIVE_WEEKS,
  SEASON_MIN_BASELINE,
  SEASON_PLATINUM_TOP_SHARE,
  SEASON_DIAMOND_TOP_SHARE,
  SEASON_DIAMOND_BEAT_SHARE,
  SEASON_DIAMOND_MAX_CONCENTRATION,
  SEASON_DIAMOND_CONCENTRATION_MIN_INVESTED,
  SEASON_TITLED_TIERS,
  SEASON_DIVISIONS,
  DEFAULT_SEASON_RULES,
} from '../rules/seasons';
export type { SeasonDivision, SeasonRules } from '../rules/seasons';

export type SeasonTierId = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';

export interface SeasonTier {
  id: SeasonTierId;
  name: string;
  order: number;
  color: string;
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

/** The rules a season is scored by: whatever it was started with, over the defaults. */
export const seasonRulesFor = (season: SeasonLike | null | undefined): SeasonRules => rulesFor(season);

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

/** The size division a baseline value falls in. */
export const seasonDivisionFor = divisionOf;

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

/** Silver or Gold from where a player stands on the season (shared rule). */
export const seasonStandingTier = standingTier;

/** The tier above `tierId`, or null at the top. Drives "next up" in the UI. */
export const nextSeasonTier = (tierId: string | null | undefined): SeasonTier | null => {
  const order = tierId ? SEASON_TIER_MAP[tierId]?.order || 0 : 0;
  return SEASON_TIERS.find((t) => t.order === order + 1) || null;
};

// Coordinated-pressure flags in one season before the admin panel marks a
// player as a repeat case. Only a prompt: the admin still decides who is kept
// out of Platinum and Diamond.
export const SEASON_REPEAT_COORD_FLAGS = 3;
