// Central theme class definitions. Each string carries both themes: `light:`
// and `dark:` styles switch on the `dark` class App puts on <html>
// (tailwind.config.js), so components use these as they are instead of
// repeating darkMode ternaries.

// Shared building block: card surface (also the modal shell surface).
const card = 'light:bg-white light:border-amber-200 dark:bg-zinc-900 dark:border-zinc-800';

export const themeClasses = {
  // Card/panel containers
  cardClass: card,
  // Page/section background
  bgClass: 'light:bg-amber-50 dark:bg-zinc-950',
  // Primary text
  textClass: 'light:text-slate-900 dark:text-zinc-100',
  // Secondary/muted text
  mutedClass: 'light:text-zinc-600 dark:text-zinc-400',
  // Form inputs
  inputClass:
    'light:bg-white light:border-amber-300 light:text-zinc-900 dark:bg-zinc-950 dark:border-zinc-700 dark:text-zinc-100',
  // Subtle section fill (inside a card)
  subtleClass: 'light:bg-amber-50 dark:bg-zinc-800',
  // Dividers/separators
  divideClass: 'light:divide-amber-200 dark:divide-zinc-700',
  // Borders standalone
  borderClass: 'light:border-amber-200 dark:border-zinc-700',
  // Border color matching the card edge (modal header/footer dividers).
  // Pair with border-b/border-t at the call site.
  cardEdgeClass: 'light:border-amber-200 dark:border-zinc-800',

  // --- Elevation ---
  // Ambient depth for cards/panels that sit on the page background.
  // Pair with cardClass + `border`. Rarity-tiered cards get their own
  // shadows from index.css (.rarity-*) and don't need this.
  raisedClass: 'light:shadow-sm light:shadow-amber-900/10 dark:shadow-md dark:shadow-black/40',

  // --- Accent ---
  // Brand accent for tickers, links, and highlights. Text accents are
  // orange-500 everywhere; filled buttons stay bg-orange-600.
  accentClass: 'text-orange-500',
  accentHoverClass: 'hover:text-orange-400',

  // --- Buttons ---
  // Quiet bordered button (tabs, pagination, secondary actions).
  // Pair with `border` + your own padding/rounding at the call site.
  ghostBtnClass:
    'light:border-amber-200 light:text-zinc-600 light:hover:bg-amber-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800',

  // --- Chips/tags ---
  // Small neutral tag fill (filters, counts, metadata).
  chipClass: 'light:bg-slate-200 light:text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',

  // --- Modal shell ---
  // Fullscreen scrim + centering. Add a z-index at the call site (z-50 for
  // normal modals; walls/tutorials that sit above everything go higher).
  overlayClass: 'fixed inset-0 bg-black/60 flex items-center justify-center p-4',
  // Darker scrim for blocking walls and tutorials that demand full focus.
  overlayHeavyClass: 'fixed inset-0 bg-black/70 flex items-center justify-center p-4',
  // Modal container. Add max-w-* (and overflow/max-h/flex if the modal
  // scrolls) at the call site.
  modalShellClass: `w-full ${card} border rounded-sm shadow-xl`,
};

// Spacing rhythm — shared paddings/gaps so sections breathe evenly.
// Use these instead of ad-hoc p-*/mb-*/gap-* when laying out cards and grids.
export const SPACING = {
  cardPad: 'p-4', // standard card interior
  sectionGap: 'mb-4', // vertical gap between page sections
  gridGap: 'gap-4', // gap inside card grids
};

// ===== Rarity tier tokens =====
// The tier treatment is entirely visual — border, glow, accent line, and
// legendary brackets — and lives in src/index.css (.rarity-* rules; the
// --tier-* variables there are the single source of truth for tier hues).
// There are no text labels; the frame carries the tier on its own.

// Legendary frames tick once per 6s cycle (legendaryTick in index.css).
// Stagger each card by a hash of its ticker so several legendaries on screen
// never tick at the same moment (ambient motion must never move in unison).
export const getRarityStagger = (ticker = ''): string => {
  let hash = 0;
  for (let i = 0; i < ticker.length; i++) {
    hash = (hash * 31 + ticker.charCodeAt(i)) >>> 0; // simple string hash
  }
  // Spread delays across 0.0-4.9s of the cycle in 0.1s steps.
  return `${(hash % 50) / 10}s`;
};

// Crew brand colors range from pure white (Hostel) to near-black (Workers,
// God Dog), so using them raw as text color can make a name invisible against
// the page background. This blends a too-dark color toward white in dark mode
// (and a too-light color toward black in light mode) just enough to read,
// while keeping the crew's hue recognizable.
export const getReadableCrewColor = <T extends string | null | undefined>(hex: T, darkMode: boolean): T | string => {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  let r = parseInt(hex.slice(1, 3), 16);
  let g = parseInt(hex.slice(3, 5), 16);
  let b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const mix = (v: number, target: number, t: number) => Math.round(v + (target - v) * t);
  if (darkMode && luminance < 0.45) {
    const t = ((0.45 - luminance) / 0.45) * 0.85;
    r = mix(r, 255, t);
    g = mix(g, 255, t);
    b = mix(b, 255, t);
  } else if (!darkMode && luminance > 0.62) {
    const t = ((luminance - 0.62) / 0.38) * 0.85;
    r = mix(r, 0, t);
    g = mix(g, 0, t);
    b = mix(b, 0, t);
  }
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
};

/** Class strings for one answer in a prediction or event market. */
export interface OutcomeColor {
  bg: string;
  border: string;
  text: string;
  fill: string;
}

// Written out in full so Tailwind's scanner sees every class name.
const OUTCOME_COLORS: OutcomeColor[] = [
  { bg: 'bg-green-600', border: 'border-green-600', text: 'text-green-500', fill: 'bg-green-500' },
  { bg: 'bg-red-600', border: 'border-red-600', text: 'text-red-500', fill: 'bg-red-500' },
  { bg: 'bg-blue-600', border: 'border-blue-600', text: 'text-blue-500', fill: 'bg-blue-500' },
  { bg: 'bg-amber-600', border: 'border-amber-600', text: 'text-amber-500', fill: 'bg-amber-500' },
  { bg: 'bg-cyan-600', border: 'border-cyan-600', text: 'text-cyan-500', fill: 'bg-cyan-500' },
  { bg: 'bg-violet-600', border: 'border-violet-600', text: 'text-violet-500', fill: 'bg-violet-500' },
];

// Colour-blind mode swaps the first two (green/red) for teal/purple.
const OUTCOME_COLORS_CB: OutcomeColor[] = [
  { bg: 'bg-teal-600', border: 'border-teal-600', text: 'text-teal-500', fill: 'bg-teal-500' },
  { bg: 'bg-purple-600', border: 'border-purple-600', text: 'text-purple-500', fill: 'bg-purple-500' },
  ...OUTCOME_COLORS.slice(2),
];

/** The colour for the answer at `index`, cycling when there are more answers than colours. */
export const getOutcomeColor = (index: number, colorBlindMode: boolean): OutcomeColor => {
  const palette = colorBlindMode ? OUTCOME_COLORS_CB : OUTCOME_COLORS;
  return palette[index % palette.length]!;
};

/** Tailwind classes for gains and losses, honouring color-blind mode. */
export interface ChangeColors {
  text: string;
  bg: string;
  bgHover: string;
  border: string;
}

/** Teal/purple in color-blind mode, green/red otherwise. */
export const getChangeColors = (isPositive: boolean, colorBlindMode: boolean): ChangeColors =>
  colorBlindMode
    ? {
        text: isPositive ? 'text-teal-500' : 'text-purple-500',
        bg: isPositive ? 'bg-teal-600' : 'bg-purple-600',
        bgHover: isPositive ? 'hover:bg-teal-700' : 'hover:bg-purple-700',
        border: isPositive ? 'border-teal-500' : 'border-purple-500',
      }
    : {
        text: isPositive ? 'text-green-500' : 'text-red-500',
        bg: isPositive ? 'bg-green-600' : 'bg-red-600',
        bgHover: isPositive ? 'hover:bg-green-700' : 'hover:bg-red-700',
        border: isPositive ? 'border-green-500' : 'border-red-500',
      };
