import { useState, useEffect } from 'react';
import { playLadderGameFunction } from '../../../firebase';
import { useAppContext } from '../../../context/AppContext';
import { useLadderAnimation } from './useLadderAnimation';
import { useLadderBanners } from './useLadderBanners';
import { errorMessage } from '../../../utils/errors';
import type { LadderOutcome, LadderSide } from '../../../api/types';
import type { LadderData } from '../../../utils/ladderTax';
import type { LadderHistoryEntry } from './useLadderData';

// Core game flow: side selection, bet validation, the server round, and the
// animation kickoff. Composes useLadderAnimation and useLadderBanners and
// re-exports what the board needs to render.
export function useLadderGameFlow({
  userLadderData,
  globalHistory,
  setShowLadderTutorial,
}: {
  userLadderData: LadderData | null;
  globalHistory: LadderHistoryEntry[];
  setShowLadderTutorial: (show: boolean) => void;
}) {
  const { user, userData, showNotification } = useAppContext();

  const [selectedStart, setSelectedStart] = useState<LadderSide | null>(null);
  const [_selectedBet, setSelectedBet] = useState<LadderOutcome | null>(null); // write-only: kept for setter call sites in the game flow
  const [playing, setPlaying] = useState(false);
  const [complete, setComplete] = useState(false);
  // The bet input stores what was typed, so this is a string once edited.
  const [betAmount, setBetAmount] = useState<number | string>(1);
  const [_currentLadder, setCurrentLadder] = useState<Record<string, unknown> | null>(null); // write-only: kept for setter call sites in the game flow
  const [displayBalance, setDisplayBalance] = useState<number | null>(null); // For immediate balance updates
  const [instruction, setInstruction] = useState('Choose a ladder');
  const [frozenHistory, setFrozenHistory] = useState<LadderHistoryEntry[] | null>(null); // Freeze history during gameplay

  const { tracksRef, activeButton, activeResult, trackTimeout, createRungs, revealRungs, animatePath, clearLadder } =
    useLadderAnimation({ setDisplayBalance });
  const banners = useLadderBanners({ trackTimeout });
  const { showInitBanner, setShowInitBanner, setInitBannerFading, dismissBanner, presentResult } = banners;

  // Sync displayBalance with Firebase balance when not playing
  useEffect(() => {
    if (!playing && userLadderData?.balance !== undefined) {
      setDisplayBalance(userLadderData.balance);
    }
  }, [userLadderData?.balance, playing]);

  // Update instruction text
  useEffect(() => {
    if (playing) {
      setInstruction('');
    } else if (complete) {
      setInstruction('Choose a ladder');
    } else if (!selectedStart) {
      setInstruction('Choose a ladder');
    } else {
      setInstruction('Choose odds or evens');
    }
  }, [playing, complete, selectedStart]);

  const selectStart = (side: LadderSide) => {
    if (playing) return;

    if (!user) {
      showNotification('info', 'Sign in to play the ladder game!');
      return;
    }
    if (!userData?.ladderTutorial2Completed) {
      setShowLadderTutorial(true);
      return;
    }

    // Fade out init banner when selecting
    if (showInitBanner) {
      setInitBannerFading(true);
      trackTimeout(() => setShowInitBanner(false), 300);
    }

    if (selectedStart === side) {
      setSelectedStart(null);
    } else {
      if (complete) {
        dismissBanner();
        clearLadder();
        setComplete(false);
      }
      setSelectedStart(side);
    }
  };

  const selectBetAndPlay = async (bet: LadderOutcome) => {
    if (playing || !selectedStart) return;

    const amount = parseInt(String(betAmount));
    if (isNaN(amount) || amount <= 0 || amount > (userLadderData?.balance || 0)) {
      showNotification('error', 'Invalid bet amount.');
      return;
    }

    setSelectedBet(bet);
    await startGame(bet, amount);
  };

  const startGame = async (bet: LadderOutcome, amount: number) => {
    // Only reached from selectBetAndPlay, which checks selectedStart first.
    const startSide = selectedStart as LadderSide;
    dismissBanner();
    setPlaying(true);
    setComplete(false);
    setFrozenHistory(globalHistory.slice(0, 5)); // Freeze current history during gameplay

    // Immediately deduct bet from display balance
    const currentBalance = userLadderData?.balance || 0;
    setDisplayBalance(currentBalance - amount);

    try {
      // Call server function
      const result = await playLadderGameFunction({
        startSide,
        bet,
        amount,
      });

      const { rungs, result: gameResult, won, payout, newBalance } = result.data;

      // Store ladder data for animation
      setCurrentLadder({
        rungs,
        result: gameResult,
        side: selectedStart,
        bet: amount,
        won,
        payout,
        newBalance,
      });

      // Clear old ladder
      clearLadder();

      // Create rungs
      createRungs(rungs);

      // Animate
      trackTimeout(() => {
        revealRungs()
          .then(() => {
            return animatePath(rungs, startSide, gameResult, newBalance);
          })
          .then(() => {
            showResult(gameResult, won, amount, payout);
          });
      }, 250);
    } catch (error) {
      console.error('Game error:', error);
      showNotification('error', errorMessage(error) || 'Failed to play game');
      setPlaying(false);
      setSelectedStart(null);
      setSelectedBet(null);
    }
  };

  const showResult = (gameResult: LadderOutcome, won: boolean, betAmt: number, payout: number) => {
    presentResult(gameResult, won, betAmt, payout);
    setFrozenHistory(null); // Unfreeze history to show new result

    setPlaying(false);
    setComplete(true);
    setSelectedStart(null);
    setSelectedBet(null);
  };

  return {
    ...banners,
    tracksRef,
    activeButton,
    activeResult,
    selectedStart,
    playing,
    complete,
    betAmount,
    setBetAmount,
    displayBalance,
    frozenHistory,
    instruction,
    selectStart,
    selectBetAndPlay,
  };
}
