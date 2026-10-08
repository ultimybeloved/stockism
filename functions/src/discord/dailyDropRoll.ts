// Daily free-stock loot roll. Internal module — required directly by
// discordInteractions.js and deliberately NOT listed in servicePaths.js
// (it exports no Cloud Functions).
//
// See the DISCORD DAILY DROP block in constants.js for the table design and
// the payout targets these weights are calibrated to.

import { CHARACTERS, computeRarityTiers, RARITY_ORDER, splitFactorOf } from '../shared/characters';
import {
  DAILY_DROP_JACKPOT_CHANCE,
  DAILY_DROP_BONUS_TIERS,
  DAILY_DROP_BONUS_SHARE_VALUES,
  DAILY_DROP_BONUS_SHARE_WEIGHTS,
  DAILY_DROP_BONUS_VARIETY_VALUES,
  DAILY_DROP_BONUS_VARIETY_WEIGHTS,
  DAILY_DROP_CORE_TIER_VALUES,
  DAILY_DROP_CORE_TIER_WEIGHTS,
  DAILY_DROP_CORE_SHARE_VALUES,
  DAILY_DROP_CORE_SHARE_WEIGHTS,
  DAILY_DROP_CORE_VARIETY_VALUES,
  DAILY_DROP_CORE_VARIETY_WEIGHTS,
  DAILY_DROP_LEGENDARY_CHANCE,
  DAILY_DROP_LEGENDARY_SHARES,
  DAILY_DROP_LEGENDARY_POOL_FRACTION,
  DAILY_DROP_JACKPOT_TIERS,
  DAILY_DROP_JACKPOT_SHARES_MIN,
  DAILY_DROP_JACKPOT_SHARES_MAX,
  DAILY_DROP_JACKPOT_VARIETY_MIN,
  DAILY_DROP_JACKPOT_VARIETY_MAX,
} from '../shared/constants';
import type { Character, RarityTier } from '../shared/characters';

type Prices = Record<string, number>;

/** One stock a claim pays, tagged with the table it came from. */
export interface DropPick {
  ticker: string;
  name: string;
  shares: number;
  currentPrice: number | undefined;
  group: string;
}

const TIERS_BY_VALUE = [...RARITY_ORDER].reverse(); // legendary first

function weightedRandom<T>(values: readonly T[], weights: readonly number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < values.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0) return values[i]!;
  }
  return values[values.length - 1]!;
}

const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

// Fisher-Yates. The `sort(() => Math.random() - 0.5)` idiom used elsewhere in
// this codebase is NOT uniform — elements drift toward their starting index,
// which on a 4-stock legendary pool skewed the draw 36%/14%. Loot has to be
// even, so this one does it properly.
function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Split the tradeable roster into rarity tiers using live prices.
 * Returns { byTier, all } — `all` is the fallback pool for a roster too small
 * to populate every tier (the sandbox, mainly; prod has 150+ stocks).
 */
function buildDropPools(prices: Prices, launchedTickers: string[]) {
  const all = CHARACTERS.filter((c) => !c.ipoRequired || launchedTickers.includes(c.ticker)).filter(
    (c) => (prices[c.ticker] ?? 0) > 0,
  );

  const tiers = computeRarityTiers(CHARACTERS, prices);

  // computeRarityTiers ranks characters only, so ETFs come back untiered. Slot
  // each one into the highest tier whose cheapest member it still outprices —
  // an ETF trades like the characters it tracks, so it belongs in that band.
  // Pre-split prices throughout, the scale computeRarityTiers ranks on.
  const floors: Partial<Record<RarityTier, number>> = {};
  for (const c of all) {
    const tier = tiers[c.ticker];
    if (!tier) continue;
    const floor = floors[tier];
    if (floor === undefined || unsplitPrice(prices, c.ticker) < floor) {
      floors[tier] = unsplitPrice(prices, c.ticker);
    }
  }
  const tierOf = (c: Character): RarityTier =>
    tiers[c.ticker] ||
    TIERS_BY_VALUE.find((t) => floors[t] !== undefined && unsplitPrice(prices, c.ticker) >= floors[t]!) ||
    RARITY_ORDER[0]!;

  const byTier: Partial<Record<RarityTier, Character[]>> = {};
  for (const c of all) {
    const tier = tierOf(c);
    (byTier[tier] = byTier[tier] || []).push(c);
  }
  return { byTier, all };
}

/** A price on the pre-split scale, so split stocks compare like they used to. */
const unsplitPrice = (prices: Prices, ticker: string) => (prices[ticker] || 0) * splitFactorOf(ticker);

/**
 * Hand out `totalShares` round-robin across `variety` stocks drawn from `pool`.
 * Each stock's count is then scaled by its splitFactor, so a split stock pays
 * the same value it did before the split.
 */
function draw(pool: Character[], prices: Prices, totalShares: number, variety: number, group: string): DropPick[] {
  if (!pool.length || totalShares < 1) return [];
  const count = Math.max(1, Math.min(variety, totalShares, pool.length));
  const picks = shuffle(pool)
    .slice(0, count)
    .map((c) => ({
      ticker: c.ticker,
      name: c.name,
      shares: 0,
      currentPrice: prices[c.ticker],
      group,
    }));
  for (let i = 0; i < totalShares; i++) picks[i % picks.length]!.shares += 1;
  for (const p of picks) p.shares *= splitFactorOf(p.ticker);
  return picks;
}

// Most valuable group wins when the same ticker comes out of two tables.
const GROUP_PRECEDENCE = ['legendary', 'main', 'bonus'];

// The tables draw from disjoint tiers, so a ticker normally appears once. It
// can collide when a tier is empty and a draw falls back to the full roster —
// and the award loop writes one holdings key per ticker, so a duplicate would
// silently drop shares. Fold them together instead.
function mergePicks(picks: DropPick[]) {
  const byTicker = new Map<string, DropPick>();
  for (const pick of picks) {
    const existing = byTicker.get(pick.ticker);
    if (!existing) {
      byTicker.set(pick.ticker, { ...pick });
      continue;
    }
    existing.shares += pick.shares;
    if (GROUP_PRECEDENCE.indexOf(pick.group) < GROUP_PRECEDENCE.indexOf(existing.group)) {
      existing.group = pick.group;
    }
  }
  return [...byTicker.values()];
}

// Third table on a normal roll, and usually a miss. Draws straight from the
// legendary tier with no fallback: if the tier is empty this pays nothing
// rather than mislabelling a cheap stock as a legendary.
function drawLegendaryChance(byTier: Partial<Record<RarityTier, Character[]>>, prices: Prices) {
  if (Math.random() >= DAILY_DROP_LEGENDARY_CHANCE) return [];
  const tier = [...(byTier.legendary || [])].sort(
    (a, b) => unsplitPrice(prices, a.ticker) - unsplitPrice(prices, b.ticker),
  );
  if (!tier.length) return [];
  const slice = tier.slice(0, Math.max(1, Math.ceil(tier.length * DAILY_DROP_LEGENDARY_POOL_FRACTION)));
  return draw(slice, prices, DAILY_DROP_LEGENDARY_SHARES, 1, 'legendary');
}

/**
 * Roll one claim.
 * @param prices           market/current prices map
 * @param launchedTickers market/current launchedTickers
 * @returns picks are tagged `group:
 *          'main' | 'bonus' | 'legendary'` so the Discord embed can show
 *          which table each one came from.
 */
export function rollDailyStock(
  prices: Prices | null | undefined,
  launchedTickers: string[] = [],
): { picks: DropPick[]; isJackpot: boolean } {
  const priceMap = prices || {};
  const { byTier, all } = buildDropPools(priceMap, launchedTickers);
  if (!all.length) return { picks: [], isJackpot: false };

  const poolFor = (tierNames: readonly string[]) => {
    const pool = tierNames.flatMap((t) => byTier[t as RarityTier] || []);
    return pool.length ? pool : all;
  };

  // Bonus table pays out on every claim, jackpot included.
  const bonus = draw(
    poolFor(DAILY_DROP_BONUS_TIERS),
    priceMap,
    weightedRandom(DAILY_DROP_BONUS_SHARE_VALUES, DAILY_DROP_BONUS_SHARE_WEIGHTS),
    weightedRandom(DAILY_DROP_BONUS_VARIETY_VALUES, DAILY_DROP_BONUS_VARIETY_WEIGHTS),
    'bonus',
  );

  const isJackpot = Math.random() < DAILY_DROP_JACKPOT_CHANCE;

  if (isJackpot) {
    const totalShares = randInt(DAILY_DROP_JACKPOT_SHARES_MIN, DAILY_DROP_JACKPOT_SHARES_MAX);
    const variety = randInt(DAILY_DROP_JACKPOT_VARIETY_MIN, DAILY_DROP_JACKPOT_VARIETY_MAX);
    const main = draw(poolFor(DAILY_DROP_JACKPOT_TIERS), priceMap, totalShares, variety, 'main');
    return { picks: mergePicks([...bonus, ...main]), isJackpot: true };
  }

  const tier = weightedRandom(DAILY_DROP_CORE_TIER_VALUES, DAILY_DROP_CORE_TIER_WEIGHTS);
  const main = draw(
    poolFor([tier]),
    priceMap,
    weightedRandom(
      DAILY_DROP_CORE_SHARE_VALUES[tier as keyof typeof DAILY_DROP_CORE_SHARE_VALUES],
      DAILY_DROP_CORE_SHARE_WEIGHTS[tier as keyof typeof DAILY_DROP_CORE_SHARE_WEIGHTS],
    ),
    weightedRandom(DAILY_DROP_CORE_VARIETY_VALUES, DAILY_DROP_CORE_VARIETY_WEIGHTS),
    'main',
  );
  const legendary = drawLegendaryChance(byTier, priceMap);
  return { picks: mergePicks([...bonus, ...main, ...legendary]), isJackpot: false };
}
