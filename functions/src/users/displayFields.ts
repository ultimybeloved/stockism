// What a player shows off (pins, cosmetics, title), made safe to publish.
//
// INTERNAL MODULE, used by the leaderboard and the public profile.
import type { DocumentData } from 'firebase-admin/firestore';
import { BULLBEAR_FRAME_ID, cleanCosmeticStyle, frameTrend } from '../shared/rules/cosmetics';

// Players write displayedShopPins / displayedAchievementPins / activeCosmetics
// directly from the client (they're on the user-doc rules allowlist), so
// nothing stops a raw Firestore write from flaunting pins or paid cosmetics
// the player never earned/bought — or from stuffing junk types that would
// crash rendering clients. Every public payload runs through this filter:
// only owned/earned items survive, and malformed values collapse to empties.
export const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const sanitizeDisplayFields = (userData: DocumentData) => {
  const achievements = asArray(userData.achievements);
  const ownedPins = asArray(userData.ownedShopPins);
  const ownedCosmetics = asArray(userData.ownedCosmetics);
  const active = userData.activeCosmetics;
  let activeCosmetics: Record<string, unknown> | null = null;
  if (active && typeof active === 'object' && !Array.isArray(active)) {
    activeCosmetics = {};
    for (const [slot, id] of Object.entries(active)) {
      // A holding mark is only ever seen by its wearer, so it is never published.
      if (slot === 'holdingMark') continue;
      // null = explicitly unequipped (kept); anything else must be owned.
      if (id == null || (typeof id === 'string' && ownedCosmetics.includes(id))) {
        activeCosmetics[slot] = id;
      }
    }
  }
  // Season title. Same deal as the pins: activeTitle is client-writable, so it
  // only survives if the server actually granted it (adminEndSeason writes both
  // ownedTitles and the titleMeta label at the same moment).
  const ownedTitles = asArray(userData.ownedTitles);
  const activeTitle = userData.activeTitle;
  const titleMeta = userData.titleMeta && typeof userData.titleMeta === 'object' ? userData.titleMeta : {};
  const title =
    typeof activeTitle === 'string' && ownedTitles.includes(activeTitle)
      ? { id: activeTitle, text: titleMeta[activeTitle] || activeTitle }
      : null;

  // The holding mark's color is the wearer's alone too.
  const { markColor: _markColor, ...cosmeticStyle } = cleanCosmeticStyle(userData.cosmeticStyle);

  return {
    displayedAchievementPins: asArray(userData.displayedAchievementPins).filter((id) => achievements.includes(id)),
    displayedShopPins: asArray(userData.displayedShopPins).filter((id) => ownedPins.includes(id)),
    activeCosmetics,
    cosmeticStyle,
    title,
    // Only wearers of the Bull / Bear frame get a direction, so the board
    // doesn't publish everyone's day.
    frameTrend:
      activeCosmetics?.rowFrame === BULLBEAR_FRAME_ID
        ? frameTrend(userData.portfolioValue, userData.portfolioSnapshot24h)
        : null,
  };
};
