// The cosmetic shop catalog.

// Cosmetic catalog — validates shop purchases (purchaseCosmetic) and admin
// grants (adminGrantCosmetic). Keep ids/types/prices/names in sync with the
// frontend list in src/constants/cosmetics.ts (cosmeticCatalog.test.ts checks).
// `earned`: a season reward. Never sold or gifted; `price` is only the value the
// money ledger books when one is handed out.
export type CatalogEntry = { type: string; price: number; name: string; earned?: true };

export const COSMETIC_CATALOG: Record<string, CatalogEntry> = {
  name_gold: { type: 'nameColor', price: 5000, name: 'Gold' },
  name_crimson: { type: 'nameColor', price: 5000, name: 'Crimson' },
  name_emerald: { type: 'nameColor', price: 5000, name: 'Emerald' },
  name_sapphire: { type: 'nameColor', price: 5000, name: 'Sapphire' },
  name_violet: { type: 'nameColor', price: 5000, name: 'Violet' },
  name_rose: { type: 'nameColor', price: 5000, name: 'Rose' },
  name_cyan: { type: 'nameColor', price: 5000, name: 'Cyan' },
  name_silver: { type: 'nameColor', price: 5000, name: 'Silver' },
  name_tangerine: { type: 'nameColor', price: 5000, name: 'Tangerine' },
  glow_gold: { type: 'rowGlow', price: 15000, name: 'Golden Aura' },
  glow_crimson: { type: 'rowGlow', price: 15000, name: 'Blood Moon' },
  glow_neon: { type: 'rowGlow', price: 15000, name: 'Neon' },
  glow_pink: { type: 'rowGlow', price: 15000, name: 'Fuchsia Aura' },
  glow_sapphire: { type: 'rowGlow', price: 15000, name: 'Electric' },
  glow_violet: { type: 'rowGlow', price: 15000, name: 'Amethyst' },
  glow_cyan: { type: 'rowGlow', price: 15000, name: 'Frostfire' },
  glow_orange: { type: 'rowGlow', price: 15000, name: 'Ember' },
  glow_silver: { type: 'rowGlow', price: 15000, name: 'Starlight' },
  backdrop_royal: { type: 'rowBackdrop', price: 25000, name: 'Royal' },
  backdrop_inferno: { type: 'rowBackdrop', price: 25000, name: 'Inferno' },
  backdrop_frost: { type: 'rowBackdrop', price: 25000, name: 'Frost' },
  backdrop_blush: { type: 'rowBackdrop', price: 25000, name: 'Blush' },
  backdrop_verdant: { type: 'rowBackdrop', price: 25000, name: 'Verdant' },
  backdrop_gilded: { type: 'rowBackdrop', price: 25000, name: 'Gilded' },
  backdrop_midnight: { type: 'rowBackdrop', price: 25000, name: 'Midnight' },
  backdrop_onyx: { type: 'rowBackdrop', price: 25000, name: 'Onyx' },
  backdrop_lagoon: { type: 'rowBackdrop', price: 25000, name: 'Lagoon' },
  // Animated cosmetics
  name_shimmer: { type: 'nameColor', price: 40000, name: 'Shimmer' },
  name_aurora: { type: 'nameColor', price: 50000, name: 'Aurora' },
  name_rainbow: { type: 'nameColor', price: 60000, name: 'Rainbow' },
  frame_ember: { type: 'rowFrame', price: 70000, name: 'Inferno Edge' },
  frame_frost: { type: 'rowFrame', price: 70000, name: 'Frostbite' },
  frame_electric: { type: 'rowFrame', price: 80000, name: 'Live Wire' },
  frame_gold: { type: 'rowFrame', price: 150000, name: 'Gilded Frame' },
  frame_steel: { type: 'rowFrame', price: 30000, name: 'Steel' },
  frame_jade: { type: 'rowFrame', price: 30000, name: 'Jade' },
  frame_ruby: { type: 'rowFrame', price: 30000, name: 'Ruby' },
  frame_bloodline: { type: 'rowFrame', price: 80000, name: 'Bloodline' },
  frame_bullbear: { type: 'rowFrame', price: 80000, name: 'Bull / Bear' },
  frame_ticker: { type: 'rowFrame', price: 100000, name: 'Ticker Tape' },
  frame_glitch: { type: 'rowFrame', price: 100000, name: 'Glitch' },
  frame_comet: { type: 'rowFrame', price: 150000, name: 'Comet' },
  frame_p1_bronze: { type: 'rowFrame', price: 10000, name: 'Preseason Bronze', earned: true },
  frame_p1_silver: { type: 'rowFrame', price: 25000, name: 'Preseason Silver', earned: true },
  frame_p1_gold: { type: 'rowFrame', price: 60000, name: 'Preseason Gold', earned: true },
  frame_p1_platinum: { type: 'rowFrame', price: 100000, name: 'Preseason Platinum', earned: true },
  frame_p1_diamond: { type: 'rowFrame', price: 200000, name: 'Preseason Diamond', earned: true },
  glow_pulse_gold: { type: 'rowGlow', price: 50000, name: 'Pulsing Gold' },
  glow_pulse_crimson: { type: 'rowGlow', price: 50000, name: 'Pulsing Crimson' },
  glow_pulse_neon: { type: 'rowGlow', price: 50000, name: 'Pulsing Neon' },
  glow_pulse_pink: { type: 'rowGlow', price: 50000, name: 'Pulsing Fuchsia' },
  glow_pulse_sapphire: { type: 'rowGlow', price: 50000, name: 'Pulsing Electric' },
  glow_pulse_violet: { type: 'rowGlow', price: 50000, name: 'Pulsing Amethyst' },
  glow_pulse_cyan: { type: 'rowGlow', price: 50000, name: 'Pulsing Frostfire' },
  glow_pulse_orange: { type: 'rowGlow', price: 50000, name: 'Pulsing Ember' },
  glow_pulse_silver: { type: 'rowGlow', price: 50000, name: 'Pulsing Starlight' },
};

// The catalog as a list, for the weekly featured pick (rules/shop).
export const COSMETIC_PRICE_LIST = Object.entries(COSMETIC_CATALOG).map(([id, c]) => ({
  id,
  price: c.price,
  earned: c.earned,
}));
