import { adminGrantCosmeticFunction } from '../../../api/callables';
import { COSMETIC_MAP } from '../../../constants/cosmetics';
import { SHOP_PINS } from '../../../crews';
import type { AdminHookDeps } from '../utils/adminShared';
import { errorMessage } from '../../../utils/errors';

type ItemKind = 'cosmetic' | 'pin';
const FIELD = { cosmetic: 'ownedCosmetics', pin: 'ownedShopPins' } as const;
const nameOf = (kind: ItemKind, id: string) => (kind === 'cosmetic' ? COSMETIC_MAP[id]?.name : SHOP_PINS[id]?.name);

// Grant/revoke cosmetics and shop pins on the selected user (Users tab), for
// giveaways. setSelectedUser comes from the user-list state so the open user
// card refreshes after acting on it.
export function useAdminCosmetics({
  showMessage,
  setLoading,
  setSelectedUser,
}: Pick<AdminHookDeps, 'showMessage' | 'setLoading' | 'setSelectedUser'>) {
  const grant = async (kind: ItemKind, userId: string, displayName: string | undefined, id: string) => {
    const name = nameOf(kind, id);
    if (!name) {
      showMessage('error', `Pick a ${kind} first`);
      return;
    }
    if (!confirm(`Give "${name}" to ${displayName} for free?`)) return;
    setLoading(true);
    try {
      await adminGrantCosmeticFunction(kind === 'cosmetic' ? { userId, cosmeticId: id } : { userId, pinId: id });
      showMessage('success', `Gave "${name}" to ${displayName}`);
      setSelectedUser((prev) => (prev ? { ...prev, [FIELD[kind]]: [...(prev[FIELD[kind]] || []), id] } : prev));
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed: ${errorMessage(err)}`);
    }
    setLoading(false);
  };

  const revoke = async (kind: ItemKind, userId: string, displayName: string | undefined, id: string) => {
    const name = nameOf(kind, id) || id;
    const off = kind === 'cosmetic' ? 'unequipped' : 'taken off their profile';
    if (!confirm(`Take "${name}" away from ${displayName}? It will also be ${off}.`)) return;
    setLoading(true);
    try {
      await adminGrantCosmeticFunction(
        kind === 'cosmetic' ? { userId, cosmeticId: id, revoke: true } : { userId, pinId: id, revoke: true },
      );
      showMessage('success', `Removed "${name}" from ${displayName}`);
      setSelectedUser((prev) =>
        prev ? { ...prev, [FIELD[kind]]: (prev[FIELD[kind]] || []).filter((x) => x !== id) } : prev,
      );
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed: ${errorMessage(err)}`);
    }
    setLoading(false);
  };

  return {
    handleGrantCosmetic: (userId: string, displayName: string | undefined, id: string) =>
      grant('cosmetic', userId, displayName, id),
    handleRevokeCosmetic: (userId: string, displayName: string | undefined, id: string) =>
      revoke('cosmetic', userId, displayName, id),
    handleGrantPin: (userId: string, displayName: string | undefined, id: string) =>
      grant('pin', userId, displayName, id),
    handleRevokePin: (userId: string, displayName: string | undefined, id: string) =>
      revoke('pin', userId, displayName, id),
  };
}
