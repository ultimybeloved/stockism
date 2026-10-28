import { useCallback } from 'react';
import { playSound } from '../../../utils/sounds';
import { deleteField, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import {
  purchasePinFunction,
  purchaseCosmeticFunction,
  purchaseBundleFunction,
  giftCosmeticFunction,
} from '../../../api/callables';
import { SHOP_PINS } from '../../../crews';
import { reportUnexpected } from '../../../monitoring';
import { errorMessage } from '../../../utils/errors';
import { formatCurrency } from '../../../utils/formatters';
import type { ActionHookDeps } from '../../../shared/hooks/types';
import type { CosmeticStyle, CosmeticStyleKey } from '../../../rules/cosmetics';
import { afterShopPayment } from '../../../rules/shop';

/** What a gift is: one shop item or a whole bundle. */
export interface GiftTarget {
  kind: 'cosmetic' | 'bundle';
  id: string;
  name: string;
  /** What the giver sees: an item's price, or a whole bundle's before owned pieces come off. */
  price: number;
}

export type PinAction =
  'buyPin' | 'setShopPins' | 'setAchievementPins' | 'toggleCrewPin' | 'setFlairCrew' | 'buySlot' | 'buyStreakSaver';

export function usePinShop({ user, userData, showNotification, setUserData, setLoadingKey }: ActionHookDeps) {
  const handlePinAction = useCallback(
    // payload is a pin id (buyPin), a pin list (set*Pins), a flag (toggleCrewPin), a flair crew id
    // or null (setFlairCrew), a slot type (buySlot) or a streak saver plan (buyStreakSaver).
    async (action: PinAction, payload: unknown, cost?: number) => {
      if (!user || !userData) return;
      if (action === 'buyPin' || action === 'buySlot' || action === 'buyStreakSaver') setLoadingKey('pinAction', true);
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
                  ...afterShopPayment(prev, cost || 0),
                }
              : prev,
          );
          const pin = SHOP_PINS[pinId]!;
          playSound('purchase');
          showNotification('success', `Purchased ${pin.name}!`, `/pins/${pin.image}`);
        } else if (action === 'setShopPins') {
          await updateDoc(userRef, { displayedShopPins: payload });
        } else if (action === 'setAchievementPins') {
          await updateDoc(userRef, { displayedAchievementPins: payload });
        } else if (action === 'toggleCrewPin') {
          if (!userData.isCrewHead) {
            await updateDoc(userRef, { displayCrewPin: payload });
          }
        } else if (action === 'setFlairCrew') {
          await updateDoc(userRef, { flairCrew: payload ?? null });
        } else if (action === 'buySlot') {
          await purchasePinFunction({ action: 'buySlot', slotType: payload as string });
          // Mirror the backend's field: it sets the extraShopSlot /
          // extraAchievementSlot boolean, which is what the slot math reads.
          const slotKey = payload === 'shop' ? 'extraShopSlot' : 'extraAchievementSlot';
          setUserData((prev) => (prev ? { ...prev, [slotKey]: true, ...afterShopPayment(prev, cost || 0) } : prev));
          playSound('purchase');
          showNotification('success', `Unlocked extra ${payload} pin slot!`);
        } else if (action === 'buyStreakSaver') {
          const res = await purchasePinFunction({ action: 'buyStreakSaver', plan: payload as string });
          const until = (res.data as { until?: number | null }).until;
          setUserData((prev) =>
            prev
              ? {
                  ...prev,
                  ...(until ? { streakSaverUntil: until } : { streakSaverPermanent: true }),
                  ...afterShopPayment(prev, cost || 0),
                }
              : prev,
          );
          playSound('purchase');
          showNotification('success', 'Streak saver on. Every check-in pays the top reward.');
        }
      } catch (err) {
        reportUnexpected(err, { where: 'handlePinAction' });
        showNotification('error', errorMessage(err) || 'Action failed');
      } finally {
        setLoadingKey('pinAction', false);
      }
    },
    [user, userData, showNotification, setUserData, setLoadingKey],
  );

  const handlePurchaseCosmetic = useCallback(
    async (cosmeticId: string): Promise<boolean> => {
      if (!user || !userData) return false;
      try {
        await purchaseCosmeticFunction({ cosmeticId });
        setUserData((prev) =>
          prev ? { ...prev, ownedCosmetics: [...(prev.ownedCosmetics || []), cosmeticId] } : prev,
        );
        playSound('purchase');
        showNotification('success', 'Cosmetic purchased!');
        return true;
      } catch (err) {
        reportUnexpected(err, { where: 'handlePurchaseCosmetic', cosmeticId });
        showNotification('error', errorMessage(err) || 'Purchase failed');
        return false;
      }
    },
    [user, userData, showNotification, setUserData],
  );

  const handlePurchaseBundle = useCallback(
    async (bundleId: string) => {
      if (!user || !userData) return;
      try {
        const { data } = await purchaseBundleFunction({ bundleId });
        setUserData((prev) =>
          prev ? { ...prev, ownedCosmetics: [...new Set([...(prev.ownedCosmetics || []), ...data.items])] } : prev,
        );
        playSound('purchase');
        showNotification('success', 'Bundle purchased!');
      } catch (err) {
        reportUnexpected(err, { where: 'handlePurchaseBundle', bundleId });
        showNotification('error', errorMessage(err) || 'Purchase failed');
      }
    },
    [user, userData, showNotification, setUserData],
  );

  // Returns an error message for the gift dialog to show, or null on success.
  const handleGiftCosmetic = useCallback(
    async (target: GiftTarget, recipient: string): Promise<string | null> => {
      if (!user) return 'Log in first.';
      try {
        const { data } = await giftCosmeticFunction({
          ...(target.kind === 'bundle' ? { bundleId: target.id } : { cosmeticId: target.id }),
          recipient,
        });
        playSound('purchase');
        showNotification('success', `Gift sent to ${data.recipientName} for ${formatCurrency(data.price)}!`);
        return null;
      } catch (err) {
        return errorMessage(err) || 'Gift failed. Try again.';
      }
    },
    [user, showNotification],
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

  // How the player wears a cosmetic with a choice (Split Flap motion, Bull / Bear
  // style, backdrop tint, colors). The server only publishes values it knows.
  // null clears the choice, back to the item's own default.
  const handleSetCosmeticStyle = useCallback(
    async <K extends CosmeticStyleKey>(key: K, value: NonNullable<CosmeticStyle[K]> | null) => {
      if (!user) return;
      await updateDoc(doc(db, 'users', user.uid), { [`cosmeticStyle.${key}`]: value ?? deleteField() });
      setUserData((prev) => {
        if (!prev) return prev;
        const { [key]: _, ...rest } = prev.cosmeticStyle || {};
        return { ...prev, cosmeticStyle: value == null ? rest : { ...rest, [key]: value } };
      });
    },
    [user, setUserData],
  );

  return {
    handlePinAction,
    handlePurchaseCosmetic,
    handlePurchaseBundle,
    handleGiftCosmetic,
    handleEquipCosmetic,
    handleSetCosmeticStyle,
  };
}
