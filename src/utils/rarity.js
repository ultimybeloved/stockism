// Rarity tiers — a character's tier is its STANDING in the live market, not a
// fixed dollar price. Rank every non-ETF character by current price, slice the
// ranking into tiers by position, then nudge each tier boundary onto the nearest
// natural price gap so a boundary never cuts through a tight price cluster.
//
// Example: if the rank cutoff lands between $40.78 and $40.49, but $40.49 and
// $40.27 are followed by a clear drop to $39.90, the boundary slides down to
// that drop and the two borderline characters round UP into the higher tier.
// If no clear break exists below the cutoff (the cluster keeps going), the
// boundary instead retreats to the break above it.
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

// Gap snapping — how far a boundary may slide off its rank cutoff, and what
// counts as a "clear break" worth sliding to.
const GAP_WINDOW_DOWN = 4;   // slots a boundary may slide down (rounding characters UP into the higher tier)
const GAP_WINDOW_UP = 5;     // slots it may retreat up when the cluster extends past the down-window
const GAP_BREAK_RATIO = 1.2; // a break must beat every gap it skips over by this factor
const MIN_BREAK_GAP = 0.008; // ...and be at least a 0.8% relative price drop (ignores cluster noise)

// Relative price drop between rank c-1 and rank c (prices are sorted descending).
// Relative, not dollars, so a $0.40 step at $40 and a $0.13 step at $13 read the same.
const relativeGap = (ranked, c) => {
  const above = ranked[c - 1].price;
  return above > 0 ? (above - ranked[c].price) / above : 0;
};

/**
 * Slide one tier boundary from its nominal rank cutoff onto a natural price gap.
 * A boundary at count `c` means ranks 0..c-1 sit in higher tiers.
 *
 * Walk down first (preferring to round borderline characters up into the higher
 * tier) and stop at the first clear break; if the cluster runs past the window,
 * fall back to walking up to the break above. `prev` (the boundary of the tier
 * above) is a hard floor so tiers can never overlap or reorder.
 */
const snapBoundary = (ranked, nominal, prev, upperSize, lowerSize) => {
  const n = ranked.length;
  const base = Math.min(Math.max(nominal, prev + 1), n);
  if (base >= n) return base;

  // Cap the windows by tier size so a snap can't swallow half a neighboring tier.
  const down = Math.min(GAP_WINDOW_DOWN, Math.floor(lowerSize / 2));
  const up = Math.min(GAP_WINDOW_UP, Math.floor(upperSize / 2));

  // Scan candidates one slot at a time. A candidate is a break when its gap
  // clears the noise floor and beats every gap skipped so far by the ratio.
  // After a break is found, keep sliding only while the very next candidate is
  // an even clearer break (an adjacent straggler in front of a bigger divide);
  // stop at the first that isn't.
  const scanForBreak = (from, to, step) => {
    let maxSkipped = relativeGap(ranked, base);
    let breakAt = 0;
    let breakGap = 0;
    for (let c = from; step > 0 ? c <= to : c >= to; c += step) {
      const gap = relativeGap(ranked, c);
      if (breakAt) {
        if (gap < GAP_BREAK_RATIO * breakGap) break;
      } else if (gap < MIN_BREAK_GAP || gap < GAP_BREAK_RATIO * maxSkipped) {
        maxSkipped = Math.max(maxSkipped, gap);
        continue;
      }
      breakAt = c;
      breakGap = gap;
    }
    return breakAt;
  };

  return (
    scanForBreak(base + 1, Math.min(base + down, n - 1), 1) ||
    scanForBreak(base - 1, Math.max(base - up, prev + 1), -1) ||
    base
  );
};

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
  if (!n) return tiers;

  // Nominal boundary counts from the rank cutoffs (the trailing Infinity cutoff
  // has no boundary — everything left is common).
  const nominals = TIER_CUTOFFS.slice(0, -1).map((t) => Math.ceil(t.maxFraction * n));

  const bounds = [];
  let prev = 0;
  nominals.forEach((nominal, i) => {
    const upperSize = nominal - (i ? nominals[i - 1] : 0);
    const lowerSize = (i + 1 < nominals.length ? nominals[i + 1] : n) - nominal;
    prev = snapBoundary(ranked, nominal, prev, upperSize, lowerSize);
    bounds.push(prev);
  });

  ranked.forEach((entry, idx) => {
    const k = bounds.findIndex((b) => idx < b);
    tiers[entry.ticker] = (k === -1 ? TIER_CUTOFFS[TIER_CUTOFFS.length - 1] : TIER_CUTOFFS[k]).tier;
  });
  return tiers;
};

/** Class name for a tier (or '' when the ticker has none, e.g. ETFs). */
export const rarityClassFor = (tier) => (tier ? `rarity-${tier}` : '');
