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
});

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
