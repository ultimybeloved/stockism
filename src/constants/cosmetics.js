export const COSMETICS = [
  // Name Colors — $5,000
  { id: 'name_gold',    name: 'Gold',    type: 'nameColor', color: '#F59E0B', price: 5000,  description: 'Your name shines in gold.' },
  { id: 'name_crimson', name: 'Crimson', type: 'nameColor', color: '#EF4444', price: 5000,  description: 'Your name burns in crimson.' },
  { id: 'name_emerald', name: 'Emerald', type: 'nameColor', color: '#10B981', price: 5000,  description: 'Your name glows in emerald.' },
  { id: 'name_sapphire',name: 'Sapphire',type: 'nameColor', color: '#60A5FA', price: 5000,  description: 'Your name gleams in sapphire.' },
  { id: 'name_violet',  name: 'Violet',  type: 'nameColor', color: '#A78BFA', price: 5000,  description: 'Your name radiates in violet.' },

  // Row Glow — $15,000
  { id: 'glow_gold',    name: 'Golden Aura', type: 'rowGlow', color: '#F59E0B', price: 15000, description: 'A golden halo frames your row.' },
  { id: 'glow_crimson', name: 'Blood Moon',  type: 'rowGlow', color: '#EF4444', price: 15000, description: 'A blood red glow surrounds your row.' },
  { id: 'glow_neon',    name: 'Neon',        type: 'rowGlow', color: '#34D399', price: 15000, description: 'A neon green glow lights your row.' },

  // Row Backdrop — $25,000
  { id: 'backdrop_royal',   name: 'Royal',   type: 'rowBackdrop', color: '#7C3AED', price: 25000, description: 'A royal purple backdrop on your row.' },
  { id: 'backdrop_inferno', name: 'Inferno', type: 'rowBackdrop', color: '#B91C1C', price: 25000, description: 'An infernal red backdrop on your row.' },
  { id: 'backdrop_frost',   name: 'Frost',   type: 'rowBackdrop', color: '#1D4ED8', price: 25000, description: 'A frosty blue backdrop on your row.' },
];

export const COSMETIC_MAP = Object.fromEntries(COSMETICS.map(c => [c.id, c]));

export const COSMETIC_TYPE_LABELS = {
  nameColor:   '✏️ Name Color',
  rowGlow:     '✨ Row Glow',
  rowBackdrop: '🎨 Row Backdrop',
};

export const COSMETIC_TYPES = ['nameColor', 'rowGlow', 'rowBackdrop'];
