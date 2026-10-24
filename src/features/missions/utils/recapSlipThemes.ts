// The looks a Weekly Slip can come in. Each player gets one at random for
// the week (seeded by player and week, so it holds still across visits), from
// the set for the theme they're using. All of them lean on the site's oranges
// and yellows.

export interface SlipTheme {
  id: string;
  /** Slip background (CSS background). */
  bg: string;
  /** The band across the top. */
  band: string;
  /** Fill for the big net worth number (clipped to the text). */
  figure: string;
  ink: string;
  muted: string;
  /** Dashed perforation, dividers, tile borders. */
  line: string;
  tile: string;
  accent: string;
  /** Up and down colors, normal and color-blind. */
  up: string;
  down: string;
  upCb: string;
  downCb: string;
}

const DARK_BASE = {
  ink: '#fafafa',
  muted: '#a1a1aa',
  up: '#4ade80',
  down: '#f87171',
  upCb: '#2dd4bf',
  downCb: '#c084fc',
};
const LIGHT_BASE = {
  ink: '#1c1917',
  muted: '#57534e',
  up: '#15803d',
  down: '#b91c1c',
  upCb: '#0f766e',
  downCb: '#7e22ce',
};

export const DARK_SLIPS: SlipTheme[] = [
  {
    ...DARK_BASE,
    id: 'ember',
    bg: 'radial-gradient(120% 90% at 100% 0%, rgba(249,115,22,0.28), transparent 60%), #0c0a09',
    band: 'linear-gradient(90deg, #f97316, #facc15)',
    figure: 'linear-gradient(90deg, #fb923c, #fde047)',
    line: 'rgba(251,146,60,0.35)',
    tile: 'rgba(251,146,60,0.08)',
    accent: '#fb923c',
  },
  {
    ...DARK_BASE,
    id: 'graphite',
    bg: 'linear-gradient(160deg, #3f3f46, #18181b 70%)',
    band: 'linear-gradient(90deg, #facc15, #f59e0b)',
    figure: 'linear-gradient(90deg, #fde047, #f59e0b)',
    line: 'rgba(250,204,21,0.3)',
    tile: 'rgba(255,255,255,0.05)',
    accent: '#facc15',
  },
  {
    ...DARK_BASE,
    id: 'molten',
    bg: 'linear-gradient(135deg, #7c2d12, #1c1917 65%)',
    band: 'linear-gradient(90deg, #fde047, #fb923c, #ea580c)',
    figure: 'linear-gradient(90deg, #fef08a, #fb923c)',
    line: 'rgba(253,224,71,0.3)',
    tile: 'rgba(0,0,0,0.25)',
    accent: '#fde047',
  },
  {
    ...DARK_BASE,
    id: 'blackgold',
    bg: 'radial-gradient(90% 70% at 0% 100%, rgba(250,204,21,0.16), transparent 65%), #09090b',
    band: 'linear-gradient(90deg, #ca8a04, #fde047, #ca8a04)',
    figure: 'linear-gradient(180deg, #fef9c3, #facc15 55%, #ca8a04)',
    line: 'rgba(250,204,21,0.28)',
    tile: 'rgba(250,204,21,0.06)',
    accent: '#facc15',
  },
];

export const LIGHT_SLIPS: SlipTheme[] = [
  {
    ...LIGHT_BASE,
    id: 'paper',
    bg: '#ffffff',
    band: 'linear-gradient(90deg, #f97316, #facc15)',
    figure: 'linear-gradient(90deg, #ea580c, #d97706)',
    line: 'rgba(234,88,12,0.3)',
    tile: '#fff7ed',
    accent: '#ea580c',
  },
  {
    ...LIGHT_BASE,
    id: 'silver',
    bg: 'linear-gradient(160deg, #fafafa, #e4e4e7)',
    band: 'linear-gradient(90deg, #facc15, #f97316)',
    figure: 'linear-gradient(90deg, #c2410c, #f97316)',
    line: 'rgba(113,113,122,0.35)',
    tile: 'rgba(255,255,255,0.7)',
    accent: '#c2410c',
  },
  {
    ...LIGHT_BASE,
    id: 'lemon',
    bg: 'linear-gradient(160deg, #fef9c3, #fde68a)',
    band: 'linear-gradient(90deg, #ea580c, #f97316)',
    figure: 'linear-gradient(90deg, #9a3412, #ea580c)',
    line: 'rgba(154,52,18,0.3)',
    tile: 'rgba(255,255,255,0.55)',
    accent: '#c2410c',
  },
  {
    ...LIGHT_BASE,
    id: 'sunset',
    bg: 'linear-gradient(135deg, #fef3c7, #fed7aa 60%, #fdba74)',
    band: 'linear-gradient(90deg, #facc15, #ea580c)',
    figure: 'linear-gradient(90deg, #7c2d12, #c2410c)',
    line: 'rgba(124,45,18,0.3)',
    tile: 'rgba(255,255,255,0.5)',
    accent: '#9a3412',
  },
];

/** Small stable string hash (FNV-1a). */
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** This player's slip for this week, in the theme they're using. */
export const pickSlipTheme = (seed: string, dark: boolean): SlipTheme => {
  const set = dark ? DARK_SLIPS : LIGHT_SLIPS;
  return set[hash(seed) % set.length]!;
};

/** Bar widths (1 to 3) for the slip's decorative barcode, from the seed. */
export const barcode = (seed: string, bars = 36): number[] => {
  let h = hash(seed);
  return Array.from({ length: bars }, () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    return 1 + (h % 3);
  });
};
