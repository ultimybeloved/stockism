// Rarity tiers. The algorithm lives in src/characters.ts (the shared
// frontend/backend file — npm run sync:chars copies it to functions/) so the
// dividend payout uses the exact same tier math. This module re-exports it for
// the frontend plus the CSS class helper.
//
// The visual treatment for each tier lives in src/index.css (.rarity-*).

export { RARITY_ORDER, computeRarityTiers } from '../characters';

/** Class name for a tier (or '' when the ticker has none, e.g. ETFs). */
export const rarityClassFor = (tier: string | null | undefined): string => (tier ? `rarity-${tier}` : '');

/** A tier's name and text color, for the written tag on cards and mission picks. */
export const RARITY_TAG: Record<string, { label: string; className: string }> = {
  legendary: { label: 'Legendary', className: 'text-amber-500' },
  epic: { label: 'Epic', className: 'text-purple-500' },
  rare: { label: 'Rare', className: 'text-sky-500' },
  uncommon: { label: 'Uncommon', className: 'text-emerald-500' },
  common: { label: 'Common', className: 'light:text-slate-500 dark:text-zinc-400' },
};
