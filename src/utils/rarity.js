// Rarity tiers — a character's tier is its STANDING in the live market, not a
// fixed dollar price. Rank every non-ETF character by current price, then slice
// the ranking into tiers by position. Prices drift, the ranking re-sorts itself,
// and the tiers never need hand-tuning.
//
// Because tiers key off rank (not an absolute threshold), the top few characters
// always sit alone at Legendary no matter how far they run ahead of the pack, and
// a character bobbing around a round-number price can no longer flicker in and out
// of a tier — its rank barely moves.
//
// The visual treatment for each tier lives in src/index.css (.rarity-*).

export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

// Cumulative share of the roster, counting from the most expensive character down.
// Legendary = top 4% (~the top 3-5), Epic = next 12%, Rare = next 25%,
// Uncommon = next 35%, Common = the remaining ~24%. Adjust the splits here and the
// whole board re-tiers — no per-character edits.
const TIER_CUTOFFS = [
  { tier: 'legendary', maxFraction: 0.04 },
  { tier: 'epic',      maxFraction: 0.16 },
  { tier: 'rare',      maxFraction: 0.41 },
  { tier: 'uncommon',  maxFraction: 0.76 },
  { tier: 'common',    maxFraction: Infinity },
];

const tierForFraction = (fraction) =>
  TIER_CUTOFFS.find((t) => fraction < t.maxFraction).tier;

/**
 * Build a { ticker: tier } map from the current price map.
 * ETFs are excluded (they get their own badge, not a rarity trim), so ETF
 * tickers simply won't appear as keys.
 *
 * @param {Array}  characters - full character list (CHARACTERS)
 * @param {Object} prices     - live { ticker: price } map
 * @returns {Object} { ticker: 'common'|'uncommon'|'rare'|'epic'|'legendary' }
 */
export const computeRarityTiers = (characters, prices) => {
  const ranked = characters
    .filter((c) => !c.isETF)
    .map((c) => ({
      ticker: c.ticker,
      price: prices?.[c.ticker] ?? c.basePrice ?? 0,
    }))
    // Highest price first; ticker breaks ties so equal prices never reshuffle.
    .sort((a, b) => b.price - a.price || (a.ticker < b.ticker ? -1 : 1));

  const n = ranked.length;
  const tiers = {};
  ranked.forEach((entry, i) => {
    tiers[entry.ticker] = tierForFraction(n > 1 ? i / n : 0);
  });
  return tiers;
};

/** Class name for a tier (or '' when the ticker has none, e.g. ETFs). */
export const rarityClassFor = (tier) => (tier ? `rarity-${tier}` : '');
