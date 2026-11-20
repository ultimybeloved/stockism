import { useCallback } from 'react';
import { SHOP_DROP_CATEGORIES, SHOP_DROP_ID } from '../../../constants/cosmetics';
import { useSeenFlags } from '../../../shared/hooks/useSeenFlag';

const keyOf = (category: string) => `shop:${SHOP_DROP_ID}:${category}`;
const KEYS = SHOP_DROP_CATEGORIES.map(keyOf);

/**
 * The latest shop drop's NEW! badges: which categories hold new items the
 * player hasn't opened yet. A category's badge (and the Shop tab's, once none
 * are left) clears only when that category is opened, not when the shop is.
 */
export const useShopDrop = () => {
  const [unseen, markSeen] = useSeenFlags(KEYS);
  const open = useCallback(
    (category: string) => {
      if (SHOP_DROP_CATEGORIES.includes(category)) markSeen(keyOf(category));
    },
    [markSeen],
  );
  return {
    anyNew: unseen.size > 0,
    /** The first category still holding unseen new items, if any. */
    firstNew: SHOP_DROP_CATEGORIES.find((c) => unseen.has(keyOf(c))) ?? null,
    isNew: (category: string) => unseen.has(keyOf(category)),
    open,
  };
};
