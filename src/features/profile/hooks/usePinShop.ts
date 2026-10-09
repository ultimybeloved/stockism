import { useCallback } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { purchasePinFunction, purchaseCosmeticFunction, db } from '../../../firebase';
import { SHOP_PINS } from '../../../crews';
import { reportUnexpected } from '../../../monitoring';
import { errorMessage } from '../../../utils/errors';
import type { ActionHookDeps } from '../../../shared/hooks/types';

export type PinAction = 'buyPin' | 'setShopPins' | 'setAchievementPins' | 'toggleCrewPin' | 'buySlot';

export function usePinShop({ user, userData, showNotification, setUserData, setLoadingKey }: ActionHookDeps) {
  const handlePinAction = useCallback(
    // payload is a pin id (buyPin), a pin list (set*Pins), a flag (toggleCrewPin) or a slot type (buySlot).
    async (action: PinAction, payload: unknown, cost?: number) => {
      if (!user || !userData) return;
      if (action === 'buyPin' || action === 'buySlot') setLoadingKey('pinAction', true);
      try {
        const userRef = doc(db, 'users', user.uid);
        if (action === 'buyPin') {
          const currentOwned = userData.ownedShopPins || [];
          const pinId = payload as string;
          if (currentOwned.includes(pinId)) return;
          await purchasePinFunction({ action: 'buyPin', pinId });
          setUserData((prev) =>
            prev
              ? {
                  ...prev,
                  ownedShopPins: [...(prev.ownedShopPins || []), pinId],
                  cash: (prev.cash || 0) - (cost || 0),
                }
              : prev,
          );
          const pin = SHOP_PINS[pinId]!;
          showNotification('success', `Purchased ${pin.name}!`, `/pins/${pin.image}`);
        } else if (action === 'setShopPins') {
          await updateDoc(userRef, { displayedShopPins: payload });
        } else if (action === 'setAchievementPins') {
          await updateDoc(userRef, { displayedAchievementPins: payload });
        } else if (action === 'toggleCrewPin') {
          if (!userData.isCrewHead) {
            await updateDoc(userRef, { displayCrewPin: payload });
          }
        } else if (action === 'buySlot') {
          await purchasePinFunction({ action: 'buySlot', slotType: payload as string });
          // Mirror the backend's field: it sets the extraShopSlot /
          // extraAchievementSlot boolean, which is what the slot math reads.
          const slotKey = payload === 'shop' ? 'extraShopSlot' : 'extraAchievementSlot';
          setUserData((prev) => (prev ? { ...prev, [slotKey]: true, cash: (prev.cash || 0) - (cost || 0) } : prev));
          showNotification('success', `Unlocked extra ${payload} pin slot!`);
        }
      } catch (err) {
        reportUnexpected(err, { where: 'handlePinAction' });
        showNotification('error', 'Action failed');
      } finally {
        setLoadingKey('pinAction', false);
      }
    },
    [user, userData, showNotification, setUserData, setLoadingKey],
  );

  const handlePurchaseCosmetic = useCallback(
    async (cosmeticId: string) => {
      if (!user || !userData) return;
      try {
        await purchaseCosmeticFunction({ cosmeticId });
        setUserData((prev) =>
          prev ? { ...prev, ownedCosmetics: [...(prev.ownedCosmetics || []), cosmeticId] } : prev,
        );
        showNotification('success', 'Cosmetic purchased!');
      } catch (err) {
        reportUnexpected(err, { where: 'handlePurchaseCosmetic', cosmeticId });
        showNotification('error', errorMessage(err) || 'Purchase failed');
      }
    },
    [user, userData, showNotification, setUserData],
  );

  const handleEquipCosmetic = useCallback(
    async (type: string, cosmeticId: string | null) => {
      if (!user) return;
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, { [`activeCosmetics.${type}`]: cosmeticId });
      setUserData((prev) =>
        prev
          ? {
              ...prev,
              activeCosmetics: { ...(prev.activeCosmetics || {}), [type]: cosmeticId },
            }
          : prev,
      );
    },
    [user, setUserData],
  );

  return { handlePinAction, handlePurchaseCosmetic, handleEquipCosmetic };
}
