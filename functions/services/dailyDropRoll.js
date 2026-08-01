'use strict';

// Daily free-stock loot roll. Internal module — required directly by
// discordInteractions.js and deliberately NOT listed in servicePaths.js
// (it exports no Cloud Functions).
//
// See the DISCORD DAILY DROP block in constants.js for the table design and
// the payout targets these weights are calibrated to.

const { CHARACTERS, computeRarityTiers, RARITY_ORDER } = require('../characters');
const {
  DAILY_DROP_JACKPOT_CHANCE,
  DAILY_DROP_BONUS_TIERS, DAILY_DROP_BONUS_SHARE_VALUES, DAILY_DROP_BONUS_SHARE_WEIGHTS,
  DAILY_DROP_BONUS_VARIETY_VALUES, DAILY_DROP_BONUS_VARIETY_WEIGHTS,
  DAILY_DROP_CORE_TIER_VALUES, DAILY_DROP_CORE_TIER_WEIGHTS,
  DAILY_DROP_CORE_SHARE_VALUES, DAILY_DROP_CORE_SHARE_WEIGHTS,
  DAILY_DROP_CORE_VARIETY_VALUES, DAILY_DROP_CORE_VARIETY_WEIGHTS,
  DAILY_DROP_LEGENDARY_CHANCE, DAILY_DROP_LEGENDARY_SHARES, DAILY_DROP_LEGENDARY_POOL_FRACTION,
  DAILY_DROP_JACKPOT_TIERS,
  DAILY_DROP_JACKPOT_SHARES_MIN, DAILY_DROP_JACKPOT_SHARES_MAX,
  DAILY_DROP_JACKPOT_VARIETY_MIN, DAILY_DROP_JACKPOT_VARIETY_MAX,
} = require('../constants');

const TIERS_BY_VALUE = [...RARITY_ORDER].reverse(); // legendary first

function weightedRandom(values, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < values.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return values[i];
  }
  return values[values.length - 1];
}

const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// Fisher-Yates. The `sort(() => Math.random() - 0.5)` idiom used elsewhere in
// this codebase is NOT uniform — elements drift toward their starting index,
// which on a 4-stock legendary pool skewed the draw 36%/14%. Loot has to be
// even, so this one does it properly.
function shuffle(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Split the tradeable roster into rarity tiers using live prices.
 * Returns { byTier, all } — `all` is the fallback pool for a roster too small
 * to populate every tier (the sandbox, mainly; prod has 150+ stocks).
 */
function buildDropPools(prices, launchedTickers) {
  const all = CHARACTERS
    .filter((c) => !c.ipoRequired || launchedTickers.includes(c.ticker))
    .filter((c) => prices[c.ticker] > 0);

  const tiers = computeRarityTiers(CHARACTERS, prices);

  // computeRarityTiers ranks characters only, so ETFs come back untiered. Slot
  // each one into the highest tier whose cheapest member it still outprices —
  // an ETF trades like the characters it tracks, so it belongs in that band.
  const floors = {};
  for (const c of all) {
    const tier = tiers[c.ticker];
    if (!tier) continue;
    if (floors[tier] === undefined || prices[c.ticker] < floors[tier]) {
      floors[tier] = prices[c.ticker];
    }
  }
  const tierOf = (c) => tiers[c.ticker]
    || TIERS_BY_VALUE.find((t) => floors[t] !== undefined && prices[c.ticker] >= floors[t])
    || RARITY_ORDER[0];

  const byTier = {};
  for (const c of all) {
    const tier = tierOf(c);
    (byTier[tier] = byTier[tier] || []).push(c);
  }
  return { byTier, all };
}

/** Hand out `totalShares` round-robin across `variety` stocks drawn from `pool`. */
function draw(pool, prices, totalShares, variety, group) {
  if (!pool.length || totalShares < 1) return [];
  const count = Math.max(1, Math.min(variety, totalShares, pool.length));
  const picks = shuffle(pool).slice(0, count).map((c) => ({
    ticker: c.ticker,
    name: c.name,
    shares: 0,
    currentPrice: prices[c.ticker],
    group,
  }));
  for (let i = 0; i < totalShares; i++) picks[i % picks.length].shares += 1;
  return picks;
}

// Most valuable group wins when the same ticker comes out of two tables.
const GROUP_PRECEDENCE = ['legendary', 'main', 'bonus'];

// The tables draw from disjoint tiers, so a ticker normally appears once. It
// can collide when a tier is empty and a draw falls back to the full roster —
// and the award loop writes one holdings key per ticker, so a duplicate would
// silently drop shares. Fold them together instead.
function mergePicks(picks) {
  const byTicker = new Map();
  for (const pick of picks) {
    const existing = byTicker.get(pick.ticker);
    if (!existing) { byTicker.set(pick.ticker, { ...pick }); continue; }
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
function drawLegendaryChance(byTier, prices) {
  if (Math.random() >= DAILY_DROP_LEGENDARY_CHANCE) return [];
  const tier = [...(byTier.legendary || [])].sort((a, b) => prices[a.ticker] - prices[b.ticker]);
  if (!tier.length) return [];
  const slice = tier.slice(0, Math.max(1, Math.ceil(tier.length * DAILY_DROP_LEGENDARY_POOL_FRACTION)));
  return draw(slice, prices, DAILY_DROP_LEGENDARY_SHARES, 1, 'legendary');
}

/**
 * Roll one claim.
 * @param {Object} prices           market/current prices map
 * @param {string[]} launchedTickers market/current launchedTickers
 * @returns {{picks: Array, isJackpot: boolean}} picks are tagged `group:
 *          'main' | 'bonus' | 'legendary'` so the Discord embed can show
 *          which table each one came from.
 */
function rollDailyStock(prices, launchedTickers = []) {
  const { byTier, all } = buildDropPools(prices || {}, launchedTickers);
  if (!all.length) return { picks: [], isJackpot: false };

  const poolFor = (tierNames) => {
    const pool = tierNames.flatMap((t) => byTier[t] || []);
    return pool.length ? pool : all;
  };

  // Bonus table pays out on every claim, jackpot included.
  const bonus = draw(
    poolFor(DAILY_DROP_BONUS_TIERS),
    prices,
    weightedRandom(DAILY_DROP_BONUS_SHARE_VALUES, DAILY_DROP_BONUS_SHARE_WEIGHTS),
    weightedRandom(DAILY_DROP_BONUS_VARIETY_VALUES, DAILY_DROP_BONUS_VARIETY_WEIGHTS),
    'bonus'
  );

  const isJackpot = Math.random() < DAILY_DROP_JACKPOT_CHANCE;

  if (isJackpot) {
    const totalShares = randInt(DAILY_DROP_JACKPOT_SHARES_MIN, DAILY_DROP_JACKPOT_SHARES_MAX);
    const variety = randInt(DAILY_DROP_JACKPOT_VARIETY_MIN, DAILY_DROP_JACKPOT_VARIETY_MAX);
    const main = draw(poolFor(DAILY_DROP_JACKPOT_TIERS), prices, totalShares, variety, 'main');
    return { picks: mergePicks([...bonus, ...main]), isJackpot: true };
  }

  const tier = weightedRandom(DAILY_DROP_CORE_TIER_VALUES, DAILY_DROP_CORE_TIER_WEIGHTS);
  const main = draw(
    poolFor([tier]),
    prices,
    weightedRandom(DAILY_DROP_CORE_SHARE_VALUES[tier], DAILY_DROP_CORE_SHARE_WEIGHTS[tier]),
    weightedRandom(DAILY_DROP_CORE_VARIETY_VALUES, DAILY_DROP_CORE_VARIETY_WEIGHTS),
    'main'
  );
  const legendary = drawLegendaryChance(byTier, prices);
  return { picks: mergePicks([...bonus, ...main, ...legendary]), isJackpot: false };
}

module.exports = { rollDailyStock };
