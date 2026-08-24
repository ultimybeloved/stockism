import { COSMETIC_MAP } from '../constants/cosmetics';

// Resolve a user's equipped cosmetics into ready-to-apply pieces. Centralizes the
// COSMETIC_MAP lookups and the animated-vs-static logic that used to be copy-pasted
// across the profile header, profile modal, and leaderboard row.
//
// - Static cosmetics expose their `color` (the caller builds the exact inline style,
//   so each surface keeps its own glow/backdrop intensity — behavior unchanged).
// - Animated cosmetics expose an `effectClass` (a CSS class with keyframes, defined
//   in index.css) instead of a color, so they animate consistently everywhere.
// `ownedCosmetics` is optional: server payloads (leaderboard, public profile)
// arrive pre-filtered to owned items, so callers rendering them pass nothing.
// Callers with the full user doc (own profile header) pass the owned list so
// an unowned equip never renders, even for the owner.
export const getCosmeticStyles = (activeCosmetics = {}, ownedCosmetics = null) => {
  let ac = (activeCosmetics && typeof activeCosmetics === 'object') ? activeCosmetics : {};
  if (Array.isArray(ownedCosmetics)) {
    ac = Object.fromEntries(
      Object.entries(ac).filter(([, id]) => id == null || ownedCosmetics.includes(id))
    );
  }
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

// The season title to show under a player's name, or null.
//
// Server payloads (leaderboard, public profile) already arrive as a validated
// { id, text } on `title`. The own-profile surfaces hold the raw user doc
// instead, where activeTitle is client-writable — so an unowned equip is dropped
// here the same way the server drops it, and the label comes from titleMeta,
// which only adminEndSeason writes.
export const getActiveTitle = (userData) => {
  if (userData?.title) return userData.title;
  const id = userData?.activeTitle;
  if (typeof id !== 'string' || !id) return null;
  if (!Array.isArray(userData.ownedTitles) || !userData.ownedTitles.includes(id)) return null;
  return { id, text: userData.titleMeta?.[id] || id };
};
