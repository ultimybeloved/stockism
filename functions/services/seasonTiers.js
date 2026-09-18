'use strict';
// Season tier rules: who earned what. season.js does the reading and writing;
// everything here is a pure function.
//
// INTERNAL MODULE — required by season.js and users.js, never listed in
// servicePaths.js. Mirror of src/constants/seasons.js and
// src/utils/seasonWeeks.js — keep them in sync.
//
// The rule, agreed 2026-09-13 after a calibration run over live accounts:
//
//   Bronze    active at SEASON_BRONZE_ACTIVE_WEEKS weekly checkpoints
//   Silver    up on the season, free money removed
//   Gold      ahead of the market since the player's season began
//             These three are checked every Thursday and kept once earned.
//
//   Platinum  the top SEASON_PLATINUM_TOP_SHARE of the player's size division
//             (SEASON_DIVISIONS) against the market, handed out at season end
//   Diamond   the best of those, at most SEASON_DIAMOND_TOP_SHARE of the division,
//             who also beat the market in SEASON_DIAMOND_BEAT_SHARE of the
//             season's weeks and never had more than
//             SEASON_DIAMOND_MAX_CONCENTRATION of invested money in one
//             character at any checkpoint
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

const { netReturnPercent, round2 } = require('../helpers');
const {
  SEASON_TIER_ORDER,
  SEASON_BRONZE_ACTIVE_WEEKS,
  SEASON_MIN_BASELINE,
  SEASON_PLATINUM_TOP_SHARE,
  SEASON_DIAMOND_TOP_SHARE,
  SEASON_DIAMOND_BEAT_SHARE,
  SEASON_DIAMOND_MAX_CONCENTRATION,
  SEASON_TITLED_TIERS,
  SEASON_DIVISIONS,
  WEEKLY_HALT_WEEKDAY,
  WEEKLY_HALT_START_MINUTE,
} = require('../constants');

/** The rules a season is scored by. Pinned onto the season doc when it starts. */
const DEFAULT_SEASON_RULES = Object.freeze({
  bronzeActiveWeeks: SEASON_BRONZE_ACTIVE_WEEKS,
  platinumTopShare: SEASON_PLATINUM_TOP_SHARE,
  diamondTopShare: SEASON_DIAMOND_TOP_SHARE,
  diamondBeatShare: SEASON_DIAMOND_BEAT_SHARE,
  diamondMaxConcentration: SEASON_DIAMOND_MAX_CONCENTRATION,
  titledTiers: SEASON_TITLED_TIERS,
  divisions: SEASON_DIVISIONS,
});

const rulesFor = (season) => ({ ...DEFAULT_SEASON_RULES, ...(season?.rules || {}) });

const tierRank = (tierId) => (tierId ? SEASON_TIER_ORDER.indexOf(tierId) + 1 : 0);

/** The better of two tiers. A banked tier is never lowered by this. */
const higherTier = (a, b) => (tierRank(b) > tierRank(a) ? b : a) || null;

/**
 * A player's season baseline: value, the granted-value counter and the market
 * index at one instant, which is what makes "return net of free money, against
 * the market" computable over any span later.
 */
const buildSeasonBaseline = ({ seasonId, value, granted, ladderFlow, index, pinnedAt }) => ({
  seasonId,
  value: round2(value || 0),
  granted: granted || 0,
  // Pinned so the ladder shadow stat can be worked out over the season.
  ladderFlow: ladderFlow || 0,
  // The market reading this player is measured from. Someone who joins in week
  // five is compared with the market from week five, not from the season start.
  index: round2(index || 0),
  pinnedAt,
});

/** The index reading a player's season is measured from. */
const baselineIndexFor = (baseline, season) =>
  (baseline?.index > 0 ? baseline.index : (season?.indexAtStart || 0));

/**
 * Where a player stands, or null if they can't be scored.
 *
 * `value` is their net equity at the moment being scored. The caller works it
 * out, because the stored portfolioValue is only as fresh as their last login.
 * `granted` overrides grants-since-baseline when scoring from a stored week
 * record rather than the live counter.
 */
const seasonScore = (userData, season, { value, indexNow, granted } = {}) => {
  const baseline = userData?.seasonBaseline;
  if (!baseline || baseline.seasonId !== season?.id) return null;
  if (!baseline.value || baseline.value < SEASON_MIN_BASELINE) return null;

  // Signed: a ladder deposit books a negative flow (see grantedFlowUpdate), and
  // clamping would turn money parked in the ladder into a fake trading loss.
  const grantedSinceStart = granted !== undefined
    ? granted
    : (userData.grantedValue || 0) - (baseline.granted || 0);
  const ladderNet = (userData.ladderFlowValue || 0) - (baseline.ladderFlow || 0);

  const returnPercent = netReturnPercent(value || 0, baseline.value, grantedSinceStart);
  const startIndex = baselineIndexFor(baseline, season);
  const marketPercent = (startIndex > 0 && indexNow > 0)
    ? ((indexNow - startIndex) / startIndex) * 100
    : 0;

  return {
    returnPercent,
    // What it would have been if ladder winnings counted. Shown, never ranked.
    returnWithLadder: netReturnPercent(value || 0, baseline.value, grantedSinceStart - ladderNet),
    marketPercent,
    excess: returnPercent - marketPercent,
  };
};

/** The tier a weekly checkpoint can bank. Never Platinum or Diamond. */
const checkpointTier = ({ returnPercent, marketPercent, activeWeeks }, rules = DEFAULT_SEASON_RULES) => {
  if (returnPercent > marketPercent) return 'gold';
  if (returnPercent > 0) return 'silver';
  return (activeWeeks || 0) >= rules.bronzeActiveWeeks ? 'bronze' : null;
};

/**
 * What Diamond is judged on, from the raw week record. Mirror of
 * deriveSeasonWeeks + summariseSeasonWeeks in src/utils/seasonWeeks.js.
 *
 * `checkpointsRun` is how many weekly checkpoints the season has had. A week
 * with no record for this player counts as not beaten, so someone who joins for
 * the last fortnight can't take Diamond off one lucky week.
 */
const weeklyRecordSummary = (seasonWeeks, { seasonId, baselineValue, baselineIndex }, checkpointsRun = 0) => {
  const rows = (Array.isArray(seasonWeeks) ? seasonWeeks : [])
    .filter((r) => r && r.s === seasonId && r.w > 0)
    .sort((a, b) => a.w - b.w);

  let prev = { v: baselineValue, g: 0, x: baselineIndex };
  let beatWeeks = 0;
  let peakConcentration = 0;
  for (const r of rows) {
    // Free money collected during the week is stripped before it is scored.
    const grantsThisWeek = (r.g || 0) - (prev.g || 0);
    const weekReturn = prev.v > 0 ? ((r.v - grantsThisWeek) - prev.v) / prev.v : 0;
    const weekIndex = prev.x > 0 ? (r.x - prev.x) / prev.x : 0;
    if (weekReturn > weekIndex) beatWeeks++;
    // Of invested money, not the whole portfolio.
    const concentration = r.h > 0 ? r.c / r.h : 0;
    if (concentration > peakConcentration) peakConcentration = concentration;
    prev = r;
  }

  const weeks = Math.max(checkpointsRun, rows.length);
  return { weeks, beatWeeks, beatShare: weeks ? beatWeeks / weeks : 0, peakConcentration };
};

/** How many Platinum and Diamond places a board of `n` players has. */
const topTierSlots = (n, rules = DEFAULT_SEASON_RULES) => (n > 0
  ? {
    platinum: Math.max(1, Math.round(n * rules.platinumTopShare)),
    diamond: Math.max(1, Math.round(n * rules.diamondTopShare)),
  }
  : { platinum: 0, diamond: 0 });

/** The size division a baseline value falls in. Below every minimum = the first. */
const divisionFor = (baselineValue, rules = DEFAULT_SEASON_RULES) => {
  const divisions = rules.divisions || [];
  const v = baselineValue || 0;
  const hit = divisions.find((d) => v >= d.min && (d.max === null || d.max === undefined || v < d.max));
  return (hit || divisions[0])?.id || null;
};

/** Players and Platinum/Diamond places per division, for the board and admin. */
const divisionSlots = (field, rules = DEFAULT_SEASON_RULES) => {
  const players = Array.isArray(field) ? field.filter(Boolean) : [];
  return (rules.divisions || []).map((d) => {
    const n = players.filter((p) => (p.division || divisionFor(p.baselineValue, rules)) === d.id).length;
    return { id: d.id, label: d.label, min: d.min, max: d.max ?? null, players: n, ...topTierSlots(n, rules) };
  });
};

/**
 * Hand out Platinum and Diamond, ranked within each size division.
 *
 * `field` is every player on the board, each { uid, excess, activeWeeks,
 * beatShare, peakConcentration, division }. Places are shares of the player's
 * own division, but only a player who beat the market and turned up for the
 * Bronze minimum can take one. Returns Map uid -> 'platinum' | 'diamond'.
 */
const rankTopTiers = (field, rules = DEFAULT_SEASON_RULES) => {
  const result = new Map();
  const players = Array.isArray(field) ? field.filter(Boolean) : [];
  const groups = new Map();
  for (const p of players) {
    const id = p.division || divisionFor(p.baselineValue, rules);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(p);
  }

  for (const group of groups.values()) {
    const slots = topTierSlots(group.length, rules);
    const platinum = group
      .filter((p) => p.excess > 0 && (p.activeWeeks || 0) >= rules.bronzeActiveWeeks)
      // Ties broken by uid so the same board always hands out the same places.
      .sort((a, b) => (b.excess - a.excess) || String(a.uid).localeCompare(String(b.uid)))
      .slice(0, slots.platinum);

    // Diamond is the best of Platinum who also passed both extra tests, not the
    // top of the division filtered down. Otherwise one-character sitters at the
    // very top would leave Diamond empty instead of handing it to the best trader
    // who wasn't.
    const diamond = platinum
      .filter((p) => p.beatShare >= rules.diamondBeatShare
        && p.peakConcentration <= rules.diamondMaxConcentration)
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
const seasonTitles = (season, tier) => {
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
const lastHaltStart = (now = Date.now()) => {
  const d = new Date(now);
  const daysBack = (d.getUTCDay() - WEEKLY_HALT_WEEKDAY + 7) % 7;
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysBack)
    + WEEKLY_HALT_START_MINUTE * 60 * 1000;
  // Thursday morning, before the halt: that's last week's halt.
  return start > now ? start - 7 * 24 * 60 * 60 * 1000 : start;
};

module.exports = {
  DEFAULT_SEASON_RULES,
  rulesFor,
  tierRank,
  higherTier,
  buildSeasonBaseline,
  baselineIndexFor,
  seasonScore,
  checkpointTier,
  weeklyRecordSummary,
  topTierSlots,
  divisionFor,
  divisionSlots,
  rankTopTiers,
  seasonTitles,
  lastHaltStart,
};
