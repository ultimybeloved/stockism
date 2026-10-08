'use strict';
// The cosmetic shop catalog.

// Cosmetic catalog — validates shop purchases (purchaseCosmetic) and admin
// grants (adminGrantCosmetic). Keep ids/prices in sync with the frontend list
// in src/constants/cosmetics.js.
const COSMETIC_CATALOG = {
  name_gold: { type: 'nameColor', price: 5000 },
  name_crimson: { type: 'nameColor', price: 5000 },
  name_emerald: { type: 'nameColor', price: 5000 },
  name_sapphire: { type: 'nameColor', price: 5000 },
  name_violet: { type: 'nameColor', price: 5000 },
  name_rose: { type: 'nameColor', price: 5000 },
  name_cyan: { type: 'nameColor', price: 5000 },
  name_silver: { type: 'nameColor', price: 5000 },
  name_tangerine: { type: 'nameColor', price: 5000 },
  glow_gold: { type: 'rowGlow', price: 15000 },
  glow_crimson: { type: 'rowGlow', price: 15000 },
  glow_neon: { type: 'rowGlow', price: 15000 },
  glow_pink: { type: 'rowGlow', price: 15000 },
  glow_sapphire: { type: 'rowGlow', price: 15000 },
  glow_violet: { type: 'rowGlow', price: 15000 },
  glow_cyan: { type: 'rowGlow', price: 15000 },
  glow_orange: { type: 'rowGlow', price: 15000 },
  glow_silver: { type: 'rowGlow', price: 15000 },
  backdrop_royal: { type: 'rowBackdrop', price: 25000 },
  backdrop_inferno: { type: 'rowBackdrop', price: 25000 },
  backdrop_frost: { type: 'rowBackdrop', price: 25000 },
  backdrop_blush: { type: 'rowBackdrop', price: 25000 },
  backdrop_verdant: { type: 'rowBackdrop', price: 25000 },
  backdrop_gilded: { type: 'rowBackdrop', price: 25000 },
  backdrop_midnight: { type: 'rowBackdrop', price: 25000 },
  backdrop_onyx: { type: 'rowBackdrop', price: 25000 },
  backdrop_lagoon: { type: 'rowBackdrop', price: 25000 },
  // Animated cosmetics
  name_shimmer: { type: 'nameColor', price: 40000 },
  name_aurora: { type: 'nameColor', price: 50000 },
  name_rainbow: { type: 'nameColor', price: 60000 },
  frame_ember: { type: 'rowFrame', price: 80000 },
  frame_frost: { type: 'rowFrame', price: 80000 },
  frame_electric: { type: 'rowFrame', price: 90000 },
  frame_gold: { type: 'rowFrame', price: 120000 },
  glow_pulse_gold: { type: 'rowGlow', price: 50000 },
  glow_pulse_crimson: { type: 'rowGlow', price: 50000 },
  glow_pulse_neon: { type: 'rowGlow', price: 50000 },
  glow_pulse_pink: { type: 'rowGlow', price: 50000 },
  glow_pulse_sapphire: { type: 'rowGlow', price: 50000 },
  glow_pulse_violet: { type: 'rowGlow', price: 50000 },
  glow_pulse_cyan: { type: 'rowGlow', price: 50000 },
  glow_pulse_orange: { type: 'rowGlow', price: 50000 },
  glow_pulse_silver: { type: 'rowGlow', price: 50000 },
};

module.exports = { COSMETIC_CATALOG };
