import { useState, useEffect } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import {
  db, depositToLadderGameFunction, withdrawFromLadderGameFunction, getLadderLeaderboardFunction,
} from '../../firebase';
import { useAppContext } from '../../context/AppContext';

// Everything modal-shaped around the game: transfer (deposit/withdraw),
// leaderboard, stats, and the tutorial gate.
export function useLadderModals({ userLadderData, userStockismCash }) {
  const { user, userData, showNotification } = useAppContext();

  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferTab, setTransferTab] = useState('deposit');
  const [showLeaderboardModal, setShowLeaderboardModal] = useState(false);
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [leaderboard, setLeaderboard] = useState([]);
  const [depositLoading, setDepositLoading] = useState(false);

  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [showLadderTutorial, setShowLadderTutorial] = useState(false);
  const [showLadderTutorialReview, setShowLadderTutorialReview] = useState(false);

  // Show tutorial on mount for any signed-in user who hasn't completed v2.
  // Guests skip it — they can't play anyway, so they get a sign-in prompt on
  // interaction instead of five pages of required reading first.
  useEffect(() => {
    if (user && !userData?.ladderTutorial2Completed) {
      setShowLadderTutorial(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLadderTutorialComplete = async () => {
    if (!user) return;
    await updateDoc(doc(db, 'users', user.uid), { ladderTutorial2Completed: true });
    setShowLadderTutorial(false);
  };

  const handleDeposit = async () => {
    const amount = Math.floor(parseFloat(depositAmount));
    if (isNaN(amount) || amount <= 0) {
      showNotification('error', 'Enter a whole dollar amount of at least $1');
      return;
    }
    if (amount > userStockismCash) {
      showNotification('error', 'Insufficient Stockism cash');
      return;
    }

    setDepositLoading(true);
    try {
      await depositToLadderGameFunction({ amount });
      setDepositAmount('');
      setShowTransferModal(false);
      showNotification('success', `Successfully deposited $${amount}`);
    } catch (error) {
      console.error('Deposit error:', error);
      showNotification('error', error.message || 'Deposit failed');
    } finally {
      setDepositLoading(false);
    }
  };

  const handleWithdraw = async () => {
    const balance = userLadderData?.balance || 0;
    const amount = parseFloat(withdrawAmount);
    if (isNaN(amount) || amount <= 0) {
      showNotification('error', 'Enter an amount greater than $0');
      return;
    }
    if (amount > balance) {
      showNotification('error', 'Amount exceeds your ladder balance');
      return;
    }
    setWithdrawLoading(true);
    try {
      const result = await withdrawFromLadderGameFunction({ amount });
      const { grossAmount, totalTax, netReceived } = result.data || {};
      setWithdrawAmount('');
      setShowTransferModal(false);
      const money = (n) => (n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      showNotification('success', `Withdrew $${money(grossAmount ?? amount)}. Tax was $${money(totalTax)}. You received $${money(netReceived)}.`);
    } catch (error) {
      console.error('Withdrawal error:', error);
      showNotification('error', error.message || 'Withdrawal failed');
    } finally {
      setWithdrawLoading(false);
    }
  };

  const loadLeaderboard = async () => {
    setLeaderboardLoading(true);
    try {
      const result = await getLadderLeaderboardFunction();
      setLeaderboard(result.data.leaderboard || []);
    } catch (error) {
      console.error('Leaderboard error:', error);
    } finally {
      setLeaderboardLoading(false);
    }
  };

  useEffect(() => {
    if (showLeaderboardModal) {
      loadLeaderboard();
    }
  }, [showLeaderboardModal]);

  return {
    showTransferModal, setShowTransferModal, transferTab, setTransferTab,
    showLeaderboardModal, setShowLeaderboardModal, showStatsModal, setShowStatsModal,
    depositAmount, setDepositAmount, withdrawAmount, setWithdrawAmount,
    depositLoading, withdrawLoading, handleDeposit, handleWithdraw,
    leaderboard, leaderboardLoading,
    showLadderTutorial, setShowLadderTutorial, showLadderTutorialReview, setShowLadderTutorialReview,
    handleLadderTutorialComplete,
  };
}
