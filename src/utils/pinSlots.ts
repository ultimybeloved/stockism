import { maxAchievementSlots, maxShopSlots } from '../rules/pinSlots';
import type { UserData } from '../types';

// Pin slot math + toggle logic, shared by the customization modal and the
// achievements page. The slot counts themselves are a shared rule
// (src/rules/pinSlots.ts), enforced again by the server on public payloads.

export const getMaxAchievementSlots = (userData: UserData | null | undefined): number => maxAchievementSlots(userData);

export const getMaxShopSlots = (userData: UserData | null | undefined): number => maxShopSlots(userData);

// Toggle an id in a displayed-pins list, respecting the slot cap: removing
// always works, adding is a no-op when the list is full.
export const toggleDisplayedPin = (displayed: string[], id: string, maxSlots: number): string[] => {
  if (displayed.includes(id)) return displayed.filter((p) => p !== id);
  return displayed.length < maxSlots ? [...displayed, id] : displayed;
};
