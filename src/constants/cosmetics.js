export const COSMETICS = [
  // Name Colors — $5,000
  { id: 'name_gold',    name: 'Gold',    type: 'nameColor', color: '#F59E0B', price: 5000,  description: 'Your name shines in gold.' },
  { id: 'name_crimson', name: 'Crimson', type: 'nameColor', color: '#EF4444', price: 5000,  description: 'Your name burns in crimson.' },
  { id: 'name_emerald', name: 'Emerald', type: 'nameColor', color: '#10B981', price: 5000,  description: 'Your name glows in emerald.' },
  { id: 'name_sapphire',name: 'Sapphire',type: 'nameColor', color: '#60A5FA', price: 5000,  description: 'Your name gleams in sapphire.' },
  { id: 'name_violet',  name: 'Violet',  type: 'nameColor', color: '#A78BFA', price: 5000,  description: 'Your name radiates in violet.' },
  { id: 'name_rose',      name: 'Rose',      type: 'nameColor', color: '#F472B6', price: 5000,  description: 'Your name blooms in rose.' },
  { id: 'name_cyan',      name: 'Cyan',      type: 'nameColor', color: '#22D3EE', price: 5000,  description: 'Your name glows in cyan.' },
  { id: 'name_silver',    name: 'Silver',    type: 'nameColor', color: '#CBD5E1', price: 5000,  description: 'Your name gleams in silver.' },
  { id: 'name_tangerine', name: 'Tangerine', type: 'nameColor', color: '#FB923C', price: 5000,  description: 'Your name burns in tangerine.' },

  // Row Glow — $15,000
  { id: 'glow_gold',    name: 'Golden Aura', type: 'rowGlow', color: '#F59E0B', price: 15000, description: 'A golden halo frames your row.' },
  { id: 'glow_crimson', name: 'Blood Moon',  type: 'rowGlow', color: '#EF4444', price: 15000, description: 'A blood red glow surrounds your row.' },
  { id: 'glow_neon',    name: 'Neon',        type: 'rowGlow', color: '#34D399', price: 15000, description: 'A neon green glow lights your row.' },
  { id: 'glow_pink',     name: 'Fuchsia Aura', type: 'rowGlow', color: '#EC4899', price: 15000, description: 'A pink glow shimmers around your row.' },
  { id: 'glow_sapphire', name: 'Electric',     type: 'rowGlow', color: '#3B82F6', price: 15000, description: 'An electric blue glow surrounds your row.' },
  { id: 'glow_violet',   name: 'Amethyst',     type: 'rowGlow', color: '#8B5CF6', price: 15000, description: 'A violet glow pulses around your row.' },
  { id: 'glow_cyan',     name: 'Frostfire',    type: 'rowGlow', color: '#06B6D4', price: 15000, description: 'A cyan glow lights your row.' },
  { id: 'glow_orange',   name: 'Ember',        type: 'rowGlow', color: '#F97316', price: 15000, description: 'An orange glow burns around your row.' },
  { id: 'glow_silver',   name: 'Starlight',    type: 'rowGlow', color: '#E5E7EB', price: 15000, description: 'A silver glow frames your row.' },

  // Row Backdrop — $25,000
  { id: 'backdrop_royal',   name: 'Royal',   type: 'rowBackdrop', color: '#7C3AED', price: 25000, description: 'A royal purple backdrop on your row.' },
  { id: 'backdrop_inferno', name: 'Inferno', type: 'rowBackdrop', color: '#B91C1C', price: 25000, description: 'An infernal red backdrop on your row.' },
  { id: 'backdrop_frost',   name: 'Frost',   type: 'rowBackdrop', color: '#1D4ED8', price: 25000, description: 'A frosty blue backdrop on your row.' },
  { id: 'backdrop_blush',    name: 'Blush',    type: 'rowBackdrop', color: '#DB2777', price: 25000, description: 'A soft pink backdrop on your row.' },
  { id: 'backdrop_verdant',  name: 'Verdant',  type: 'rowBackdrop', color: '#047857', price: 25000, description: 'A deep green backdrop on your row.' },
  { id: 'backdrop_gilded',   name: 'Gilded',   type: 'rowBackdrop', color: '#B45309', price: 25000, description: 'A warm gold backdrop on your row.' },
  { id: 'backdrop_midnight', name: 'Midnight', type: 'rowBackdrop', color: '#312E81', price: 25000, description: 'A deep indigo backdrop on your row.' },
  { id: 'backdrop_onyx',     name: 'Onyx',     type: 'rowBackdrop', color: '#334155', price: 25000, description: 'A dark slate backdrop on your row.' },
  { id: 'backdrop_lagoon',   name: 'Lagoon',   type: 'rowBackdrop', color: '#0F766E', price: 25000, description: 'A cool teal backdrop on your row.' },

  // ─── Animated cosmetics (premium) ──────────────────────────────────────────
  // `effectClass` references a CSS animation in src/index.css. `rarity` is used
  // for gacha weighting (Phase 2). Keep ids/prices in sync with the backend
  // COSMETIC_CATALOG in functions/services/users.js.

  // Animated name effects
  { id: 'name_shimmer', name: 'Shimmer', type: 'nameColor', color: '#FBBF24', price: 40000, rarity: 'rare', effectClass: 'cos-name-shimmer', description: 'Your name shimmers with a sweeping gold sheen.' },
  { id: 'name_aurora',  name: 'Aurora',  type: 'nameColor', color: '#22D3EE', price: 50000, rarity: 'rare', effectClass: 'cos-name-aurora',  description: 'Your name flows through cyan and violet.' },
  { id: 'name_rainbow', name: 'Rainbow', type: 'nameColor', color: '#A78BFA', price: 60000, rarity: 'epic', effectClass: 'cos-name-rainbow', description: 'Your name cycles through every color.' },

  // Animated row frames (new type)
  { id: 'frame_ember',    name: 'Inferno Edge', type: 'rowFrame', color: '#EA580C', price: 80000,  rarity: 'epic',      effectClass: 'cos-frame-ember',    description: 'A flowing fiery border wraps your row.' },
  { id: 'frame_frost',    name: 'Frostbite',    type: 'rowFrame', color: '#06B6D4', price: 80000,  rarity: 'epic',      effectClass: 'cos-frame-frost',    description: 'A shimmering ice border frames your row.' },
  { id: 'frame_electric', name: 'Live Wire',    type: 'rowFrame', color: '#3B82F6', price: 90000,  rarity: 'epic',      effectClass: 'cos-frame-electric', description: 'An electric current races around your row.' },
  { id: 'frame_gold',     name: 'Gilded Frame', type: 'rowFrame', color: '#F59E0B', price: 120000, rarity: 'legendary', effectClass: 'cos-frame-gold',     description: 'A molten gold border crowns your row.' },

  // Animated glows — one pulsing variant per standard glow color
  { id: 'glow_pulse_gold',     name: 'Pulsing Gold',      type: 'rowGlow', color: '#F59E0B', price: 50000, rarity: 'rare', effectClass: 'cos-glow-pulse-gold',     description: 'A gold aura that pulses around your row.' },
  { id: 'glow_pulse_crimson',  name: 'Pulsing Crimson',   type: 'rowGlow', color: '#EF4444', price: 50000, rarity: 'rare', effectClass: 'cos-glow-pulse-crimson',  description: 'A blood red aura that pulses around your row.' },
  { id: 'glow_pulse_neon',     name: 'Pulsing Neon',      type: 'rowGlow', color: '#34D399', price: 50000, rarity: 'rare', effectClass: 'cos-glow-pulse-neon',     description: 'A neon green aura that pulses around your row.' },
  { id: 'glow_pulse_pink',     name: 'Pulsing Fuchsia',   type: 'rowGlow', color: '#EC4899', price: 50000, rarity: 'rare', effectClass: 'cos-glow-pulse-pink',     description: 'A pink aura that pulses around your row.' },
  { id: 'glow_pulse_sapphire', name: 'Pulsing Electric',  type: 'rowGlow', color: '#3B82F6', price: 50000, rarity: 'rare', effectClass: 'cos-glow-pulse-sapphire', description: 'An electric blue aura that pulses around your row.' },
  { id: 'glow_pulse_violet',   name: 'Pulsing Amethyst',  type: 'rowGlow', color: '#8B5CF6', price: 50000, rarity: 'rare', effectClass: 'cos-glow-pulse-violet',   description: 'A violet aura that pulses around your row.' },
  { id: 'glow_pulse_cyan',     name: 'Pulsing Frostfire', type: 'rowGlow', color: '#06B6D4', price: 50000, rarity: 'rare', effectClass: 'cos-glow-pulse-cyan',     description: 'A cyan aura that pulses around your row.' },
  { id: 'glow_pulse_orange',   name: 'Pulsing Ember',     type: 'rowGlow', color: '#F97316', price: 50000, rarity: 'rare', effectClass: 'cos-glow-pulse-orange',   description: 'An orange aura that pulses around your row.' },
  { id: 'glow_pulse_silver',   name: 'Pulsing Starlight', type: 'rowGlow', color: '#E5E7EB', price: 50000, rarity: 'rare', effectClass: 'cos-glow-pulse-silver',   description: 'A silver aura that pulses around your row.' },
];

export const COSMETIC_MAP = Object.fromEntries(COSMETICS.map(c => [c.id, c]));

export const COSMETIC_TYPE_LABELS = {
  nameColor:   '✏️ Name Color',
  rowGlow:     '✨ Row Glow',
  rowBackdrop: '🎨 Row Backdrop',
  rowFrame:    '🔥 Row Frame',
};

export const COSMETIC_TYPES = ['nameColor', 'rowGlow', 'rowFrame', 'rowBackdrop'];
