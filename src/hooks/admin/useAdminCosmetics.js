import { adminGrantCosmeticFunction } from '../../firebase';
import { COSMETIC_MAP } from '../../constants/cosmetics';

// Grant/revoke cosmetics on the selected user (Users tab) — for giveaways.
// setSelectedUser comes from the user-list state so the open user card
// refreshes after acting on it.
export function useAdminCosmetics({ showMessage, setLoading, setSelectedUser }) {
  const handleGrantCosmetic = async (userId, displayName, cosmeticId) => {
    const cosmetic = COSMETIC_MAP[cosmeticId];
    if (!cosmetic) {
      showMessage('error', 'Pick a cosmetic first');
      return;
    }
    if (!confirm(`Give "${cosmetic.name}" to ${displayName} for free?`)) return;
    setLoading(true);
    try {
      await adminGrantCosmeticFunction({ userId, cosmeticId });
      showMessage('success', `Gave "${cosmetic.name}" to ${displayName}`);
      setSelectedUser(prev => prev
        ? { ...prev, ownedCosmetics: [...(prev.ownedCosmetics || []), cosmeticId] }
        : prev);
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed: ${err.message}`);
    }
    setLoading(false);
  };

  const handleRevokeCosmetic = async (userId, displayName, cosmeticId) => {
    const cosmetic = COSMETIC_MAP[cosmeticId];
    if (!confirm(`Take "${cosmetic?.name || cosmeticId}" away from ${displayName}? It will also be unequipped.`)) return;
    setLoading(true);
    try {
      await adminGrantCosmeticFunction({ userId, cosmeticId, revoke: true });
      showMessage('success', `Removed "${cosmetic?.name || cosmeticId}" from ${displayName}`);
      setSelectedUser(prev => prev
        ? { ...prev, ownedCosmetics: (prev.ownedCosmetics || []).filter(id => id !== cosmeticId) }
        : prev);
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed: ${err.message}`);
    }
    setLoading(false);
  };

  return { handleGrantCosmetic, handleRevokeCosmetic };
}
