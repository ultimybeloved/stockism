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
