import { useCallback } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { useAppContext } from '../context/AppContext';
import { purchasePinFunction, purchaseCosmeticFunction, db } from '../firebase';
import { SHOP_PINS } from '../crews';

export function usePinShop({ setUserData, setLoadingKey }) {
  const { user, userData, showNotification } = useAppContext();

  const handlePinAction = useCallback(async (action, payload, cost) => {
    if (!user || !userData) return;
    if (action === 'buyPin' || action === 'buySlot') setLoadingKey('pinAction', true);
    try {
      const userRef = doc(db, 'users', user.uid);
      if (action === 'buyPin') {
        const currentOwned = userData.ownedShopPins || [];
        if (currentOwned.includes(payload)) return;
        await purchasePinFunction({ action: 'buyPin', pinId: payload });
        setUserData(prev => prev ? { ...prev, ownedShopPins: [...(prev.ownedShopPins || []), payload], cash: (prev.cash || 0) - (cost || 0) } : prev);
        const pin = SHOP_PINS[payload];
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
        await purchasePinFunction({ action: 'buySlot', slotType: payload });
        const slotKey = payload === 'shop' ? 'shopPinSlots' : 'achievementPinSlots';
        setUserData(prev => prev ? { ...prev, [slotKey]: (prev[slotKey] || 3) + 1, cash: (prev.cash || 0) - (cost || 0) } : prev);
        showNotification('success', `Unlocked extra ${payload} pin slot!`);
      }
    } catch (err) {
      console.error('Pin action failed:', err);
      showNotification('error', 'Action failed');
    } finally {
      setLoadingKey('pinAction', false);
    }
  }, [user, userData, setUserData, setLoadingKey, showNotification]);

  const handlePurchaseCosmetic = useCallback(async (cosmeticId) => {
    if (!user || !userData) return;
    try {
      await purchaseCosmeticFunction({ cosmeticId });
      setUserData(prev => prev ? { ...prev, ownedCosmetics: [...(prev.ownedCosmetics || []), cosmeticId] } : prev);
      showNotification('success', 'Cosmetic purchased!');
    } catch (err) {
      showNotification('error', err.message || 'Purchase failed');
    }
  }, [user, userData, setUserData, showNotification]);

  const handleEquipCosmetic = useCallback(async (type, cosmeticId) => {
    if (!user) return;
    const userRef = doc(db, 'users', user.uid);
    await updateDoc(userRef, { [`activeCosmetics.${type}`]: cosmeticId });
    setUserData(prev => prev ? {
      ...prev,
      activeCosmetics: { ...(prev.activeCosmetics || {}), [type]: cosmeticId }
    } : prev);
  }, [user, setUserData]);

  return { handlePinAction, handlePurchaseCosmetic, handleEquipCosmetic };
}
