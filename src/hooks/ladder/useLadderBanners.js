import { useState, useEffect, useRef } from 'react';

// The two overlay banners: the intro "CHOOSE ODDS OR EVENS" banner and the
// per-round result banner, each with its 300ms fade-out. presentResult is the
// banner half of finishing a round; the game-state half lives in
// useLadderGameFlow's showResult.
export function useLadderBanners({ trackTimeout }) {
  const [showResultBanner, setShowResultBanner] = useState(false);
  const [resultText, setResultText] = useState('');
  const [resultOutcome, setResultOutcome] = useState('');
  const [resultWin, setResultWin] = useState(false);
  const [showInitBanner, setShowInitBanner] = useState(true);
  const [initBannerFading, setInitBannerFading] = useState(false);
  const [resultBannerFading, setResultBannerFading] = useState(false);

  const bannerTimeoutRef = useRef(null);

  // Auto-dismiss init banner
  useEffect(() => {
    const timer = setTimeout(() => {
      setInitBannerFading(true);
      setTimeout(() => setShowInitBanner(false), 300); // Wait for fade animation
    }, 12000);
    return () => clearTimeout(timer);
  }, []);

  // Clear the pending banner dismissal on unmount
  useEffect(() => {
    return () => {
      if (bannerTimeoutRef.current) {
        clearTimeout(bannerTimeoutRef.current);
      }
    };
  }, []);

  const dismissBanner = () => {
    setResultBannerFading(true);
    if (bannerTimeoutRef.current) {
      clearTimeout(bannerTimeoutRef.current);
      bannerTimeoutRef.current = null;
    }
    trackTimeout(() => {
      setShowResultBanner(false);
      setResultBannerFading(false);
    }, 300); // Wait for fade animation
  };

  const presentResult = (gameResult, won, betAmt, payout) => {
    setResultText(gameResult.toUpperCase());
    if (won) {
      setResultOutcome(`+$${payout.toLocaleString()}`);
      setResultWin(true);
    } else {
      setResultOutcome(`-$${betAmt.toLocaleString()}`);
      setResultWin(false);
    }

    setShowResultBanner(true);
    bannerTimeoutRef.current = trackTimeout(dismissBanner, 3000);
  };

  return {
    showResultBanner, resultText, resultOutcome, resultWin, resultBannerFading,
    showInitBanner, setShowInitBanner, initBannerFading, setInitBannerFading,
    dismissBanner, presentResult,
  };
}
