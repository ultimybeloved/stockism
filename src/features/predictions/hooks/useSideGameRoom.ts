import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useMarket, useSession } from '../../../context/AppContext';
import { getLadderWithdrawable } from '../../../utils/ladderTax';
import { sideGameRoom } from '../../../rules/equity';
import type { LadderData } from '../../../utils/ladderTax';

/**
 * How much more the player can put into weekly bets, long-term markets or the
 * ladder: one shared limit, what they've invested in stocks (rules/equity).
 * Mirrors the server so the cards show the real ceiling instead of bouncing off
 * an error. Listens to the player's ladder doc, since own ladder money counts.
 */
export function useSideGameRoom() {
  const { user, userData } = useSession();
  const { predictions } = useMarket();
  const [ladder, setLadder] = useState<LadderData | null>(null);

  useEffect(() => {
    if (!user) return undefined;
    return onSnapshot(
      doc(db, 'ladderGameUsers', user.uid),
      (snap) => setLadder(snap.exists() ? snap.data() : null),
      () => setLadder(null),
    );
  }, [user]);

  return sideGameRoom(userData, predictions, getLadderWithdrawable(ladder));
}
