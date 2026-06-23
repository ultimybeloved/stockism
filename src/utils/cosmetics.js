import { COSMETIC_MAP } from '../constants/cosmetics';

// Resolve a user's equipped cosmetics into ready-to-apply pieces. Centralizes the
// COSMETIC_MAP lookups and the animated-vs-static logic that used to be copy-pasted
// across the profile header, profile modal, and leaderboard row.
//
// - Static cosmetics expose their `color` (the caller builds the exact inline style,
//   so each surface keeps its own glow/backdrop intensity — behavior unchanged).
// - Animated cosmetics expose an `effectClass` (a CSS class with keyframes, defined
//   in index.css) instead of a color, so they animate consistently everywhere.
export const getCosmeticStyles = (activeCosmetics = {}) => {
  const ac = activeCosmetics || {};
  const nameC  = ac.nameColor   ? COSMETIC_MAP[ac.nameColor]   : null;
  const glowC  = ac.rowGlow     ? COSMETIC_MAP[ac.rowGlow]     : null;
  const backC  = ac.rowBackdrop ? COSMETIC_MAP[ac.rowBackdrop] : null;
  const frameC = ac.rowFrame    ? COSMETIC_MAP[ac.rowFrame]    : null;

  return {
    // Static name color (animated name effects render via nameClass instead).
    nameColor: nameC && !nameC.effectClass ? nameC.color : undefined,
    nameClass: nameC?.effectClass || '',
    // Static glow/backdrop base colors — caller applies its own alpha/spread.
    glowColor: glowC && !glowC.effectClass ? glowC.color : undefined,
    backdropColor: backC ? backC.color : undefined,
    // Animated glow + frame CSS classes (the row needs `position: relative`).
    rowClass: [glowC?.effectClass, frameC?.effectClass].filter(Boolean).join(' '),
  };
};
