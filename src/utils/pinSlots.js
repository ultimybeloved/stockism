import { ACHIEVEMENTS } from '../constants/achievements';

// Pin slot math + toggle logic, shared by the customization modal and the
// achievements page. Base 1 slot each; +1 achievement slot for earning every
// achievement; +1 of each purchasable in the shop (extraAchievementSlot /
// extraShopSlot booleans on the user doc, set by the purchasePin backend).

export const getMaxAchievementSlots = (userData) => {
  const earned = Array.isArray(userData?.achievements) ? userData.achievements.length : 0;
  const allBonus = earned >= Object.keys(ACHIEVEMENTS).length ? 1 : 0;
  return 1 + (userData?.extraAchievementSlot ? 1 : 0) + allBonus;
};

export const getMaxShopSlots = (userData) => 1 + (userData?.extraShopSlot ? 1 : 0);

// Toggle an id in a displayed-pins list, respecting the slot cap: removing
// always works, adding is a no-op when the list is full.
export const toggleDisplayedPin = (displayed, id, maxSlots) => {
  if (displayed.includes(id)) return displayed.filter(p => p !== id);
  return displayed.length < maxSlots ? [...displayed, id] : displayed;
};
