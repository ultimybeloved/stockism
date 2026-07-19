// Rarity tiers. The algorithm lives in src/characters.js (the shared
// frontend/backend file — npm run sync:chars copies it to functions/) so the
// dividend payout uses the exact same tier math. This module re-exports it for
// the frontend plus the CSS class helper.
//
// The visual treatment for each tier lives in src/index.css (.rarity-*).

export { RARITY_ORDER, computeRarityTiers } from '../characters';

/** Class name for a tier (or '' when the ticker has none, e.g. ETFs). */
export const rarityClassFor = (tier) => (tier ? `rarity-${tier}` : '');
