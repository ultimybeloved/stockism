// GENERATED from src/rules/pinSlots.ts by `npm run sync:chars`. Do not edit.
// How many pins a player may show. Shared rule module (see src/rules/ladder.ts):
// the customization screen and the server's public payloads count slots with
// the same code, so a raw write can't show more pins than the player has
// slots for.
//
// One slot of each kind to start. One more of each can be bought in the shop
// (extraAchievementSlot / extraShopSlot on the user doc, set by purchasePin).
// Earning every achievement adds one more achievement slot.

// Number of achievements in src/constants/achievements.ts. The backend has no
// copy of that list, so the count lives here; src/utils/pinSlots.test.ts fails
// if the two drift apart.
export const ACHIEVEMENT_COUNT = 50;

/** The user-doc fields the slot math reads. */
export interface PinSlotFields {
  achievements?: unknown;
  extraAchievementSlot?: unknown;
  extraShopSlot?: unknown;
}

export const maxAchievementSlots = (user: PinSlotFields | null | undefined): number => {
  const earned = Array.isArray(user?.achievements) ? user.achievements.length : 0;
  return 1 + (user?.extraAchievementSlot ? 1 : 0) + (earned >= ACHIEVEMENT_COUNT ? 1 : 0);
};

export const maxShopSlots = (user: PinSlotFields | null | undefined): number => 1 + (user?.extraShopSlot ? 1 : 0);
