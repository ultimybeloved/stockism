// Central theme class definitions.
// All components call getThemeClasses(darkMode) instead of repeating these ternaries.

export const getThemeClasses = (darkMode) => ({
  // Card/panel containers
  cardClass:   darkMode ? 'bg-zinc-900 border-zinc-800'  : 'bg-white border-amber-200',
  // Page/section background
  bgClass:     darkMode ? 'bg-zinc-950'                  : 'bg-amber-50',
  // Primary text
  textClass:   darkMode ? 'text-zinc-100'                : 'text-slate-900',
  // Secondary/muted text
  mutedClass:  darkMode ? 'text-zinc-400'                : 'text-zinc-600',
  // Form inputs
  inputClass:  darkMode
    ? 'bg-zinc-950 border-zinc-700 text-zinc-100'
    : 'bg-white border-amber-300 text-zinc-900',
  // Subtle section fill (inside a card)
  subtleClass: darkMode ? 'bg-zinc-800'                  : 'bg-amber-50',
  // Dividers/separators
  divideClass: darkMode ? 'divide-zinc-700'              : 'divide-amber-200',
  // Borders standalone
  borderClass: darkMode ? 'border-zinc-700'              : 'border-amber-200',

  // --- Elevation ---
  // Ambient depth for cards/panels that sit on the page background.
  // Pair with cardClass + `border`. Rarity-tiered cards get their own
  // shadows from index.css (.rarity-*) and don't need this.
  raisedClass: darkMode ? 'shadow-md shadow-black/40'    : 'shadow-sm shadow-amber-900/10',

  // --- Accent ---
  // Brand accent for tickers, links, and highlights.
  accentClass:      'text-orange-600',
  accentHoverClass: 'hover:text-orange-500',

  // --- Buttons ---
  // Quiet bordered button (tabs, pagination, secondary actions).
  // Pair with `border` + your own padding/rounding at the call site.
  ghostBtnClass: darkMode
    ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800'
    : 'border-amber-200 text-zinc-600 hover:bg-amber-50',

  // --- Chips/tags ---
  // Small neutral tag fill (filters, counts, metadata).
  chipClass: darkMode ? 'bg-zinc-800 text-zinc-300'      : 'bg-slate-200 text-zinc-600',
});

// Spacing rhythm — shared paddings/gaps so sections breathe evenly.
// Use these instead of ad-hoc p-*/mb-*/gap-* when laying out cards and grids.
export const SPACING = {
  cardPad:    'p-4',   // standard card interior
  sectionGap: 'mb-4',  // vertical gap between page sections
  gridGap:    'gap-4', // gap inside card grids
};

// ===== Rarity tier tokens =====
// The tier treatment is entirely visual — border, glow, accent line, and
// legendary brackets — and lives in src/index.css (.rarity-* rules; the
// --tier-* variables there are the single source of truth for tier hues).
// There are no text labels; the frame carries the tier on its own.

// Legendary frames tick once per 6s cycle (legendaryTick in index.css).
// Stagger each card by a hash of its ticker so several legendaries on screen
// never tick at the same moment (ambient motion must never move in unison).
export const getRarityStagger = (ticker = '') => {
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
export const getReadableCrewColor = (hex, darkMode) => {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  let r = parseInt(hex.slice(1, 3), 16);
  let g = parseInt(hex.slice(3, 5), 16);
  let b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const mix = (v, target, t) => Math.round(v + (target - v) * t);
  if (darkMode && luminance < 0.45) {
    const t = ((0.45 - luminance) / 0.45) * 0.85;
    r = mix(r, 255, t); g = mix(g, 255, t); b = mix(b, 255, t);
  } else if (!darkMode && luminance > 0.62) {
    const t = ((luminance - 0.62) / 0.38) * 0.85;
    r = mix(r, 0, t); g = mix(g, 0, t); b = mix(b, 0, t);
  }
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
};
