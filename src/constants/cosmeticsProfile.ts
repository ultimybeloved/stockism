import type { Cosmetic } from './cosmetics';

// Holding marks (how the stocks you own or short look on your own screen) and
// profile backgrounds (the page behind your public profile on a desktop).
// Added 2026-10-25.
//
// Marks are only ever seen by the player wearing them, so the color ones
// (Standard, Rail, Underglow, Ember) take any color from a picker
// (cosmeticStyle.markColor) and the free ones never touch the server catalog.
// `variantOf` groups the Color Wash pairs under one shop card; `colors`
// carries the stops a two-color item draws with.

const WASHES: [string, string, [string, string]][] = [
  ['dusk', 'Dusk', ['#1E1B4B', '#7C2D12']],
  ['lagoon', 'Lagoon', ['#042F2E', '#1E3A8A']],
  ['rose', 'Rose', ['#4A044E', '#9F1239']],
  ['gold', 'Gold', ['#1C1917', '#A16207']],
  ['mint', 'Mint', ['#022C22', '#3F6212']],
];

/** Ticker Wall's gradient, top then bottom, until the player picks their own. */
export const DEFAULT_TICKER_COLORS = '#f97316,#ec4899';

/** The default mark: the ring every held stock has always had. Wearing nothing means wearing this. */
export const STANDARD_MARK_ID = 'mark_standard';

export const PROFILE_COSMETICS: Cosmetic[] = [
  {
    id: STANDARD_MARK_ID,
    name: 'Standard',
    type: 'holdingMark',
    color: '#3B82F6',
    price: 0,
    free: true,
    pickColor: true,
    effectClass: 'mk-standard',
    description: 'The ring around every stock you hold, in any color you like.',
  },
  {
    id: 'mark_rail',
    name: 'Rail',
    type: 'holdingMark',
    color: '#3B82F6',
    price: 0,
    free: true,
    pickColor: true,
    effectClass: 'mk-rail',
    description: 'A solid line along the bottom edge, in any color you like.',
  },
  {
    id: 'mark_glow',
    name: 'Underglow',
    type: 'holdingMark',
    color: '#3B82F6',
    price: 0,
    free: true,
    pickColor: true,
    effectClass: 'mk-glow',
    description: 'A soft light rising from the bottom edge, in any color you like.',
  },
  {
    id: 'mark_stamp',
    name: 'Stamp',
    type: 'holdingMark',
    color: '#F87171',
    price: 10000,
    effectClass: 'mk-stamp',
    description: 'Your position as an inked stamp: HELD on a long, SHORT on a short.',
  },
  {
    id: 'mark_aura',
    name: 'Profit Aura',
    type: 'holdingMark',
    color: '#22C55E',
    price: 10000,
    effectClass: 'mk-aura',
    description: 'Green while the position makes money, red while it loses, brighter the bigger the move.',
  },
  {
    id: 'mark_ember',
    name: 'Ember',
    type: 'holdingMark',
    color: '#FB923C',
    price: 25000,
    pickColor: true,
    effectClass: 'mk-ember',
    description: 'A smoldering bottom edge with sparks drifting up now and then. Any color you like.',
  },
  {
    id: 'mark_receipt',
    name: 'Receipt',
    type: 'holdingMark',
    color: '#E7E5E4',
    price: 35000,
    effectClass: 'mk-receipt',
    description: 'A receipt strip with your shares, average cost and gain. On a short, your entry price.',
  },
  {
    id: 'mark_diamond',
    name: 'Diamond Hands',
    type: 'holdingMark',
    color: '#67E8F9',
    price: 75000,
    effectClass: 'mk-diamond',
    description: 'Facets light up as you hold: 1 day, 7 days, 30 days.',
  },
  {
    id: 'mark_bullion',
    name: 'Bullion',
    type: 'holdingMark',
    color: '#FDE047',
    price: 100000,
    effectClass: 'mk-bullion',
    description: 'A gold bar by your shares and a thick gold edge that catches the light.',
  },

  ...WASHES.map(([key, name, colors]): Cosmetic => ({
    id: `bg_wash_${key}`,
    name: `${name} Wash`,
    type: 'profileBg',
    color: colors[1],
    colors,
    price: 5000,
    variantOf: 'bg_wash',
    description: 'A two-tone gradient behind your profile.',
  })),
  {
    id: 'bg_tickers',
    name: 'Ticker Wall',
    type: 'profileBg',
    color: '#F97316',
    price: 15000,
    description:
      'Your three biggest holdings in huge outline type, drifting slowly, in your gradient. Shows them even on a private profile.',
  },
  {
    id: 'bg_skyline',
    name: 'Night Skyline',
    type: 'profileBg',
    color: '#141B45',
    price: 25000,
    description: 'Stars twinkle and office lights switch on and off.',
  },
  {
    id: 'bg_fight',
    name: 'Fight Night',
    type: 'profileBg',
    color: '#B91C1C',
    price: 30000,
    description: 'Spotlights sweep the ring, the ropes shake, cameras flash in the crowd.',
  },
  {
    id: 'bg_chart',
    name: 'Your Chart',
    type: 'profileBg',
    color: '#22C55E',
    price: 50000,
    description:
      'Your last 30 days drawn across the page, with a light running along the line. Shape only, never dollar amounts, even on a private profile.',
  },
  {
    id: 'bg_banknote',
    name: 'Banknote',
    type: 'profileBg',
    color: '#134E3A',
    price: 100000,
    description: 'Engraving, a rosette, a foil strip and your own serial number.',
  },
];
