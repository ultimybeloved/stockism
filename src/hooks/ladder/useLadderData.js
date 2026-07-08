import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAppContext } from '../../context/AppContext';

// Firestore listeners for the ladder game: the player's ladder doc, the
// global result history, and the player's main Stockism cash.
export function useLadderData() {
  const { user } = useAppContext();
  const [userLadderData, setUserLadderData] = useState(null);
  const [globalHistory, setGlobalHistory] = useState([]);
  const [userStockismCash, setUserStockismCash] = useState(0);

  // Real-time listeners
  useEffect(() => {
    if (!user) return;

    // Listen to user ladder data
    const userLadderRef = doc(db, 'ladderGameUsers', user.uid);
    const unsubUser = onSnapshot(userLadderRef, (doc) => {
      if (doc.exists()) {
        setUserLadderData(doc.data());
      } else {
        setUserLadderData({
          balance: 500,
          gamesPlayed: 0,
          wins: 0,
          currentStreak: 0,
          bestStreak: 0
        });
      }
    });

    // Listen to global history
    const globalRef = doc(db, 'ladderGame', 'global');
    const unsubGlobal = onSnapshot(globalRef, (doc) => {
      if (doc.exists()) {
        setGlobalHistory(doc.data().history || []);
      }
    });

    // Listen to user's Stockism cash
    const userRef = doc(db, 'users', user.uid);
    const unsubCash = onSnapshot(userRef, (doc) => {
      if (doc.exists()) {
        setUserStockismCash(doc.data().cash || 0);
      }
    });

    return () => {
      unsubUser();
      unsubGlobal();
      unsubCash();
    };
  }, [user]);

  return { userLadderData, globalHistory, userStockismCash };
}
