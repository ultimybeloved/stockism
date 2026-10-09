// Season tier rules: who earned what. season.js does the reading and writing;
// everything here is a pure function.
//
// INTERNAL MODULE — required by season.js and users.js, never listed in
// servicePaths.js. The thresholds and money maths are shared rule modules
// (src/rules/seasons.ts, src/rules/seasonMoney.ts) the season card runs too.
//
// The rule, agreed 2026-09-13 after a calibration run over live accounts:
//
//   Bronze    active at SEASON_BRONZE_ACTIVE_WEEKS weekly checkpoints. The
//             only tier banked at a checkpoint and kept once earned.
//   Silver    Bronze, and up on the season, free money removed
//   Gold      Silver, and ahead of the market over the whole season
//             Both judged on where the player FINISHES. Banking them the first
//             Thursday they were touched rewarded one lucky week (or one big
//             borrowed bet) instead of a season (Darth YG, 2026-09-18).
//
// The tiers are a LADDER (Darth YG, 2026-09-28): each needs everything below it.
// Without that, 112 accounts nobody had touched in weeks would have taken Gold
// titles off stocks that happened to rise while they were away.
//
//   Platinum  Gold, and the top SEASON_PLATINUM_TOP_SHARE of the player's size division
//             (SEASON_DIVISIONS) against the market, handed out at season end
//   Diamond   the best of those, at most SEASON_DIAMOND_TOP_SHARE of the division,
//             who also beat the market in SEASON_DIAMOND_BEAT_SHARE of the
//             season's weeks and never had more than
//             SEASON_DIAMOND_MAX_CONCENTRATION of invested money in one
//             character at any checkpoint
//
// Return is measured against the money a player actually traded with
// (seasonCapital): their starting value, cash parked in the ladder at the start,
// what they owed on margin on average over the season, and any money that came
// in since (grants averaged over how long they have had them). Otherwise borrowing, or parking cash in the ladder before the start,
// makes the same trading look like a bigger percentage.
//
// Gold is generous in an arc that pumps a few characters: 85% of measurable
// active players beat the market over the four weeks before this shipped,
// because the index averages every character and the flashback lifted a
// handful. Accepted on purpose. "You beat the market" is honest, and the top two
// tiers carry the scarcity.
//
// The top two are never banked at a checkpoint. A share of the board and a share
// of weeks both have an unknown denominator until the Finale lands, and that is
// what stops anyone claiming a top tier in week one.

import { round2 } from '../shared/money';
import type { SeasonBaseline, SeasonDoc, SeasonRules, UserData, WeekRecord } from '../shared/types';
import {
  SEASON_TIER_ORDER,
  SEASON_MIN_BASELINE,
  WEEKLY_HALT_WEEKDAY,
  WEEKLY_HALT_START_MINUTE,
  ONE_WEEK_MS,
} from '../shared/constants';
import {
  averageOwed,
  seasonAverageMargin,
  sideFlowsSince,
  moneyIn,
  grantedDaysSince,
  seasonCapital,
  seasonAccountSize,
  weekMargin,
  weekGranted,
  weekConcentration,
} from './seasonMoney';
import { DEFAULT_SEASON_RULES, rulesFor, divisionOf, standingTier } from '../shared/rules/seasons';
// The defaults, the rules lookup and Silver/Gold are shared with the season card.
export { DEFAULT_SEASON_RULES, rulesFor, standingTier };
// Callers import these from seasonTiers, as before.
export * from './seasonMoney';

/** One player as the board ranks them (see boardEntry in seasonRecords). */
export interface RankedPlayer {
  uid: string;
  excess: number;
  returnPercent: number;
  marketPercent: number;
  activeWeeks?: number;
  beatShare: number;
  peakConcentration: number;
  division?: string | null;
  baselineValue?: number;
  tier?: string | null;
  topTierExcluded?: boolean;
}

export const tierRank = (tierId: string | null | undefined) =>
  tierId ? (SEASON_TIER_ORDER as readonly string[]).indexOf(tierId) + 1 : 0;

/** The better of two tiers. A banked tier is never lowered by this. */
export const higherTier = (a: string | null | undefined, b: string | null | undefined): string | null =>
  (tierRank(b) > tierRank(a) ? b : a) || null;

/**
 * A player's season baseline: value, the granted-value counter and the market
 * index at one instant, which is what makes "return net of free money, against
 * the market" computable over any span later.
 */
export const buildSeasonBaseline = ({
  seasonId,
  value,
  granted,
  grantedDays,
  ladderFlow,
  predictionFlow,
  index,
  pinnedAt,
  ladder,
}: {
  seasonId: string;
  value?: number;
  granted?: number;
  grantedDays?: number;
  ladderFlow?: number;
  predictionFlow?: number;
  index?: number;
  pinnedAt: number;
  ladder?: number;
}): SeasonBaseline => ({
  seasonId,
  value: round2(value || 0),
  // Cash sitting in the ladder at pinning (withdrawable only). Not in `value`,
  // but still money the player has to trade with.
  ladder: round2(ladder || 0),
  granted: granted || 0,
  // When that money arrived (see grantedDaysUpdate in helpers.js), so money in
  // since can be averaged over the time it was held.
  grantedDays: grantedDays || 0,
  // Pinned so the ladder shadow stat can be worked out over the season.
  ladderFlow: ladderFlow || 0,
  // Prediction flows, pinned so they can be counted apart from grants.
  predictionFlow: predictionFlow || 0,
  // The market reading this player is measured from. Someone who joins in week
  // five is compared with the market from week five, not from the season start.
  index: round2(index || 0),
  pinnedAt,
});

/** The index reading a player's season is measured from. */
export const baselineIndexFor = (baseline: SeasonBaseline | null | undefined, season: SeasonDoc | null | undefined) =>
  baseline?.index !== undefined && baseline.index > 0 ? baseline.index : season?.indexAtStart || 0;

/**
 * Where a player stands, or null if they can't be scored.
 *
 * `value` is their net equity at the moment being scored. The caller works it
 * out, because the stored portfolioValue is only as fresh as their last login.
 * `granted`, `grantedDays`, `sideFlows`, `margin` (average owed) and `at`
 * override the live counters when scoring from a stored week record.
 */
export const seasonScore = (
  userData: UserData | null | undefined,
  season: SeasonDoc | null | undefined,
  {
    value,
    indexNow,
    granted,
    grantedDays,
    sideFlows,
    margin,
    at,
  }: {
    value?: number;
    indexNow?: number;
    granted?: number;
    grantedDays?: number;
    sideFlows?: number;
    margin?: number;
    at?: number;
  } = {},
) => {
  const baseline = userData?.seasonBaseline;
  if (!baseline || baseline.seasonId !== season?.id) return null;
  if (!baseline.value || seasonAccountSize(baseline) < SEASON_MIN_BASELINE) return null;

  // Signed: a ladder deposit books a negative flow (see grantedFlowUpdate), and
  // clamping would turn money parked in the ladder into a fake trading loss.
  const grantedSinceStart = granted !== undefined ? granted : (userData!.grantedValue || 0) - (baseline.granted || 0);
  const fromRecord = granted !== undefined;
  const grantedDaysSinceStart = fromRecord ? grantedDays : grantedDaysSince(userData);
  const sideSinceStart = fromRecord ? sideFlows || 0 : sideFlowsSince(userData);
  const ladderNet = (userData!.ladderFlowValue || 0) - (baseline.ladderFlow || 0);
  const capital = seasonCapital(baseline, {
    granted: moneyIn(
      grantedSinceStart,
      grantedDaysSinceStart,
      sideSinceStart,
      baseline.pinnedAt || 0,
      at || Date.now(),
    ),
    margin: margin !== undefined ? margin : seasonAverageMargin(userData, season!.id),
  });
  const gainPercent = (g: number) => (((value || 0) - g - baseline.value) / capital) * 100;

  const returnPercent = gainPercent(grantedSinceStart);
  const startIndex = baselineIndexFor(baseline, season);
  const marketPercent =
    startIndex > 0 && indexNow !== undefined && indexNow > 0 ? ((indexNow - startIndex) / startIndex) * 100 : 0;

  return {
    returnPercent,
    // What it would have been if ladder winnings counted. Shown, never ranked.
    returnWithLadder: gainPercent(grantedSinceStart - ladderNet),
    marketPercent,
    excess: returnPercent - marketPercent,
  };
};

/** The tier a weekly checkpoint can bank: Bronze, for turning up, or nothing. */
export const checkpointTier = ({ activeWeeks }: { activeWeeks?: number }, rules: SeasonRules = DEFAULT_SEASON_RULES) =>
  (activeWeeks || 0) >= rules.bronzeActiveWeeks ? 'bronze' : null;

/**
 * Silver or Gold from where the player stands on the whole season. Gold needs
 * Silver too: beating a falling market while down is not Gold.
 */

/** Whether this board entry has earned Bronze, the first rung everything needs. */
export const hasBronze = (
  entry: { tier?: string | null; activeWeeks?: number },
  rules: SeasonRules = DEFAULT_SEASON_RULES,
) => tierRank(entry.tier) >= tierRank('bronze') || (entry.activeWeeks || 0) >= rules.bronzeActiveWeeks;

/**
 * The tier a player finishes on (or would, if the season ended now): the best
 * of banked Bronze, Silver/Gold from their standing, and a ranked Platinum or
 * Diamond place. Nothing at all without Bronze. `entry` is a boardEntry;
 * `ranked` is rankTopTiers' map (which only ranks players who have Gold).
 */
export const finalTier = (
  entry: RankedPlayer,
  ranked: Map<string, string> | null | undefined,
  rules: SeasonRules = DEFAULT_SEASON_RULES,
) => {
  if (!hasBronze(entry, rules)) return null;
  const standing = higherTier(higherTier(entry.tier, 'bronze'), standingTier(entry));
  return higherTier(standing, ranked?.get(entry.uid)) || null;
};

/** Average owed from pinning up to a week record. */
export const recordMargin = (r: WeekRecord | null | undefined, pinnedAt: number) =>
  r?.d === undefined ? undefined : averageOwed(r.d, pinnedAt, r.t);

/**
 * What Diamond is judged on, from the raw week record. The site's
 * deriveSeasonWeeks + summariseSeasonWeeks (src/utils/seasonWeeks.ts) show the same.
 *
 * `checkpointsRun` is how many weekly checkpoints the season has had. A week
 * with no record for this player counts as not beaten, so someone who joins for
 * the last fortnight can't take Diamond off one lucky week.
 */
export const weeklyRecordSummary = (
  seasonWeeks: unknown,
  {
    seasonId,
    baselineValue,
    baselineIndex,
    pinnedAt,
  }: { seasonId: string; baselineValue: number; baselineIndex: number; pinnedAt: number },
  checkpointsRun = 0,
) => {
  const rows = (Array.isArray(seasonWeeks) ? (seasonWeeks as (WeekRecord | null)[]) : [])
    .filter((r): r is WeekRecord => !!r && r.s === seasonId && r.w > 0)
    .sort((a, b) => a.w - b.w);

  let prev: WeekRecord = {
    s: seasonId,
    w: 0,
    c: 0,
    h: 0,
    v: baselineValue,
    g: 0,
    a: 0,
    f: 0,
    x: baselineIndex,
    t: pinnedAt,
    d: 0,
  };
  let beatWeeks = 0;
  let peakConcentration = 0;
  for (const r of rows) {
    // Free money collected during the week is stripped before it is scored, and
    // the week is measured against what was traded with, borrowing included.
    const grantsThisWeek = (r.g || 0) - (prev.g || 0);
    const weekCapital = prev.v + Math.max(0, weekGranted(r, prev)) + weekMargin(r, prev);
    const weekReturn = weekCapital > 0 ? (r.v - grantsThisWeek - prev.v) / weekCapital : 0;
    const weekIndex = prev.x > 0 ? (r.x - prev.x) / prev.x : 0;
    if (weekReturn > weekIndex) beatWeeks++;
    // Of invested money, not the whole portfolio, and only in a week with
    // enough invested for "all in on one character" to mean anything.
    const concentration = weekConcentration(r);
    if (concentration > peakConcentration) peakConcentration = concentration;
    prev = r;
  }

  const weeks = Math.max(checkpointsRun, rows.length);
  return { weeks, beatWeeks, beatShare: weeks ? beatWeeks / weeks : 0, peakConcentration };
};

/** How many Platinum and Diamond places a board of `n` players has. */
export const topTierSlots = (n: number, rules: SeasonRules = DEFAULT_SEASON_RULES) =>
  n > 0
    ? {
        platinum: Math.max(1, Math.round(n * rules.platinumTopShare)),
        diamond: Math.max(1, Math.round(n * rules.diamondTopShare)),
      }
    : { platinum: 0, diamond: 0 };

/** The size division a baseline value falls in. Below every minimum = the first. */
export const divisionFor = (baselineValue: number | null | undefined, rules: SeasonRules = DEFAULT_SEASON_RULES) =>
  divisionOf(baselineValue, rules)?.id || null;

/** Players and Platinum/Diamond places per division, for the board and admin. */
export const divisionSlots = (field: unknown, rules: SeasonRules = DEFAULT_SEASON_RULES) => {
  const players: RankedPlayer[] = Array.isArray(field) ? field.filter(Boolean) : [];
  return (rules.divisions || []).map((d) => {
    const n = players.filter((p) => (p.division || divisionFor(p.baselineValue, rules)) === d.id).length;
    return { id: d.id, label: d.label, min: d.min, max: d.max ?? null, players: n, ...topTierSlots(n, rules) };
  });
};

/**
 * Whether the admin has kept this player out of Platinum and Diamond for this
 * season, for repeated coordinated trading. Stored on the user doc, which only
 * the player and the admin can read, so the board never reveals who.
 */
export const isTopTierExcluded = (userData: UserData | null | undefined, seasonId: string | null | undefined) =>
  !!seasonId && userData?.seasonTopTierExclusion?.seasonId === seasonId;

/**
 * Hand out Platinum and Diamond, ranked within each size division.
 *
 * `field` is every player on the board, each { uid, excess, activeWeeks,
 * beatShare, peakConcentration, division }. Places are shares of the player's
 * own division, but only a player who beat the market and turned up for the
 * Bronze minimum can take one. Returns Map uid -> 'platinum' | 'diamond'.
 *
 * A player the admin has excluded (topTierExcluded) still counts toward the
 * division's size, so nobody loses a place because of them, but can't take
 * one: the next player down moves up.
 */
export const rankTopTiers = (field: unknown, rules: SeasonRules = DEFAULT_SEASON_RULES) => {
  const result = new Map<string, string>();
  const players: RankedPlayer[] = Array.isArray(field) ? field.filter(Boolean) : [];
  const groups = new Map<string | null, RankedPlayer[]>();
  for (const p of players) {
    const id = p.division || divisionFor(p.baselineValue, rules);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id)!.push(p);
  }

  for (const group of groups.values()) {
    const slots = topTierSlots(group.length, rules);
    const platinum = group
      // Gold first: Bronze's turnout, up on the season, and ahead of the market.
      .filter((p) => !p.topTierExcluded && hasBronze(p, rules) && standingTier(p) === 'gold')
      // Ties broken by uid so the same board always hands out the same places.
      .sort((a, b) => b.excess - a.excess || String(a.uid).localeCompare(String(b.uid)))
      .slice(0, slots.platinum);

    // Diamond is the best of Platinum who also passed both extra tests, not the
    // top of the division filtered down. Otherwise one-character sitters at the
    // very top would leave Diamond empty instead of handing it to the best trader
    // who wasn't.
    const diamond = platinum
      .filter((p) => p.beatShare >= rules.diamondBeatShare && p.peakConcentration <= rules.diamondMaxConcentration)
      .slice(0, slots.diamond);

    for (const p of platinum) result.set(p.uid, 'platinum');
    for (const p of diamond) result.set(p.uid, 'diamond');
  }
  return result;
};

/**
 * The permanent titles a tier earns when the season ends. A real season gives
 * two, the season number and the arc it covered. A preseason gives one,
 * "Preseason <Tier>", so a trial run can never pass for Season 1. A tier outside
 * the season's `titledTiers` gives none.
 */
export const seasonTitles = (season: SeasonDoc, tier: string | null | undefined) => {
  if (!tier || !rulesFor(season).titledTiers.includes(tier)) return [];
  const label = tier.charAt(0).toUpperCase() + tier.slice(1);
  if (season.preseason) {
    const n = season.preseasons || 1;
    return [{ id: `preseason_${n}_${tier}`, text: `Preseason${n > 1 ? ` ${n}` : ''} ${label}` }];
  }
  return [
    { id: `season_${season.number}_${tier}`, text: `Season ${season.number} ${label}` },
    { id: `arc_${season.id.toLowerCase()}_${tier}`, text: `${season.name} ${label}` },
  ];
};

/**
 * When the most recent Thursday halt began (13:00 UTC), at or before `now`.
 *
 * A season dated from here counts the current Thursday-to-Thursday week as
 * week 1, so the next scheduled checkpoint lands in week 2 even when the season
 * is started after this week's checkpoint has already run.
 */
export const lastHaltStart = (now = Date.now()) => {
  const d = new Date(now);
  const daysBack = (d.getUTCDay() - WEEKLY_HALT_WEEKDAY + 7) % 7;
  const start =
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysBack) + WEEKLY_HALT_START_MINUTE * 60 * 1000;
  // Thursday morning, before the halt: that's last week's halt.
  return start > now ? start - ONE_WEEK_MS : start;
};
