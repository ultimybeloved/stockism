import React, { useState, useEffect, useRef } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, playLadderGameFunction, depositToLadderGameFunction, getLadderLeaderboardFunction } from '../firebase';

const LadderGame = ({ user, onClose, darkMode }) => {
  const [userLadderData, setUserLadderData] = useState(null);
  const [globalHistory, setGlobalHistory] = useState([]);
  const [userStockismCash, setUserStockismCash] = useState(0);

  // Game state
  const [selectedStart, setSelectedStart] = useState(null);
  const [selectedBet, setSelectedBet] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [complete, setComplete] = useState(false);
  const [betAmount, setBetAmount] = useState(1);
  const [currentLadder, setCurrentLadder] = useState(null);
  const [displayBalance, setDisplayBalance] = useState(null); // For immediate balance updates
  const [showResultBanner, setShowResultBanner] = useState(false);
  const [resultText, setResultText] = useState('');
  const [resultOutcome, setResultOutcome] = useState('');
  const [resultWin, setResultWin] = useState(false);
  const [instruction, setInstruction] = useState('Choose a ladder');
  const [showInitBanner, setShowInitBanner] = useState(true);
  const [initBannerFading, setInitBannerFading] = useState(false);
  const [resultBannerFading, setResultBannerFading] = useState(false);
  const [activeButton, setActiveButton] = useState(null); // 'left' or 'right' - stays colored after game
  const [activeResult, setActiveResult] = useState(null); // 'odd' or 'even' - result color for active button
  const [frozenHistory, setFrozenHistory] = useState(null); // Freeze history during gameplay

  // Modals
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showLeaderboardModal, setShowLeaderboardModal] = useState(false);
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [depositAmount, setDepositAmount] = useState('');
  const [leaderboard, setLeaderboard] = useState([]);
  const [depositLoading, setDepositLoading] = useState(false);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);

  const bannerTimeoutRef = useRef(null);
  const tracksRef = useRef(null);

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

  // Auto-dismiss init banner
  useEffect(() => {
    const timer = setTimeout(() => {
      setInitBannerFading(true);
      setTimeout(() => setShowInitBanner(false), 300); // Wait for fade animation
    }, 12000);
    return () => clearTimeout(timer);
  }, []);

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

  const selectStart = (side) => {
    if (playing) return;

    // Fade out init banner when selecting
    if (showInitBanner) {
      setInitBannerFading(true);
      setTimeout(() => setShowInitBanner(false), 300);
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

  const selectBetAndPlay = async (bet) => {
    if (playing || !selectedStart) return;

    const amount = parseInt(betAmount);
    if (isNaN(amount) || amount <= 0 || amount > (userLadderData?.balance || 0)) {
      alert('Invalid bet amount.');
      return;
    }

    setSelectedBet(bet);
    await startGame(bet, amount);
  };

  const startGame = async (bet, amount) => {
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
        startSide: selectedStart,
        bet,
        amount
      });

      const { rungs, result: gameResult, won, payout, newBalance, currentStreak } = result.data;

      // Store ladder data for animation
      setCurrentLadder({
        rungs,
        result: gameResult,
        side: selectedStart,
        bet: amount,
        won,
        payout,
        newBalance
      });

      // Clear old ladder
      clearLadder();

      // Create rungs
      createRungs(rungs);

      // Animate
      setTimeout(() => {
        revealRungs().then(() => {
          return animatePath(rungs, selectedStart, gameResult, newBalance);
        }).then(() => {
          showResult(gameResult, won, amount, payout, currentStreak);
        });
      }, 250);

    } catch (error) {
      console.error('Game error:', error);
      alert(error.message || 'Failed to play game');
      setPlaying(false);
      setSelectedStart(null);
      setSelectedBet(null);
    }
  };

  const createRungs = (rungs) => {
    if (!tracksRef.current) return;

    const height = 140;
    rungs.forEach((rungPos, index) => {
      const y = (rungPos / 10) * height;
      const rung = document.createElement('div');
      rung.className = 'ladder-rung';
      rung.style.cssText = `
        position: absolute;
        height: 8px;
        background: #b4ac99;
        left: 22px;
        width: calc(100% - 44px);
        opacity: 0;
        transition: opacity 0.3s ease;
        top: ${y}px;
      `;
      rung.setAttribute('data-index', index);
      tracksRef.current.appendChild(rung);
    });
  };

  const revealRungs = () => {
    return new Promise((resolve) => {
      if (!tracksRef.current) {
        resolve();
        return;
      }

      const rungs = tracksRef.current.querySelectorAll('.ladder-rung');
      if (rungs.length === 0) {
        resolve();
        return;
      }

      rungs.forEach((rung, idx) => {
        setTimeout(() => {
          rung.style.opacity = '1';
          if (idx === rungs.length - 1) {
            setTimeout(resolve, 150);
          }
        }, idx * 120);
      });
    });
  };

  const animatePath = (rungs, side, result, newBalance) => {
    return new Promise((resolve) => {
      if (!tracksRef.current) {
        resolve();
        return;
      }

      const height = 140;
      const leftX = 22;
      const rightX = 220 - 22;
      const startX = side === 'left' ? leftX : rightX;
      let x = startX;
      let y = 0;

      const pathColor = result === 'odd' ? '#2286f6' : '#f22431';
      const points = [{ x, y }];

      rungs.forEach(rungPos => {
        const rY = (rungPos / 10) * height;
        points.push({ x, y: rY });
        x = x === leftX ? rightX : leftX;
        points.push({ x, y: rY });
      });
      points.push({ x, y: height });

      const endX = x;
      let idx = 0;
      let extensionsStarted = false;

      const startExtensions = () => {
        if (extensionsStarted) return;
        extensionsStarted = true;

        // Extension animations - smooth continuation from track endpoints
        const topSeg = document.createElement('div');
        topSeg.className = 'ladder-path-segment';
        topSeg.style.cssText = `
          position: absolute;
          background: ${pathColor};
          left: ${startX - 3}px;
          top: 0px;
          width: 6px;
          height: 0px;
          z-index: 5;
          transition: top 0.25s cubic-bezier(0.33, 1, 0.68, 1), height 0.25s cubic-bezier(0.33, 1, 0.68, 1);
        `;
        tracksRef.current.appendChild(topSeg);

        const bottomSeg = document.createElement('div');
        bottomSeg.className = 'ladder-path-segment';
        bottomSeg.style.cssText = `
          position: absolute;
          background: ${pathColor};
          left: ${endX - 3}px;
          top: ${height}px;
          width: 6px;
          height: 0px;
          z-index: 5;
          transition: height 0.25s cubic-bezier(0.33, 1, 0.68, 1);
        `;
        tracksRef.current.appendChild(bottomSeg);

        // Trigger with slight delay for smoother visual
        requestAnimationFrame(() => {
          topSeg.style.top = '-7px';
          topSeg.style.height = '7px';
          bottomSeg.style.height = '7px';
        });

        setTimeout(() => {
          // Color buttons via React state instead of DOM manipulation
          setActiveButton(side);
          setActiveResult(result); // 'odd' or 'even'

          // Update balance to final amount after animation
          setDisplayBalance(newBalance);

          // Still need DOM for the bottom winner button (not affected by re-render issue)
          const winBtn = document.getElementById(result === 'odd' ? 'oddBtn' : 'evenBtn');
          if (winBtn) {
            winBtn.classList.add('ladder-result-winner');
          }
          setTimeout(resolve, 100);
        }, 200);
      };

      const drawNext = () => {
        if (idx >= points.length - 1) {
          return;
        }

        const from = points[idx];
        const to = points[idx + 1];
        const seg = document.createElement('div');
        seg.className = 'ladder-path-segment';

        if (from.x === to.x) {
          // Vertical
          // Keep aligned with track: don't extend beyond 0 at top or height at bottom
          const startY = from.y === 0 ? 0 : from.y - 3;
          const endY = to.y === height ? height : to.y + 3;
          seg.style.cssText = `
            position: absolute;
            background: ${pathColor};
            left: ${from.x - 3}px;
            top: ${startY}px;
            width: 6px;
            height: ${endY - startY}px;
            z-index: 1;
          `;
        } else {
          // Horizontal - inset 1px on each side for gap within track, centered on 8px rung
          const startXPos = Math.min(from.x, to.x) + 1;
          const endXPos = Math.max(from.x, to.x) - 1;
          seg.style.cssText = `
            position: absolute;
            background: ${pathColor};
            left: ${startXPos}px;
            top: ${from.y + 1}px;
            width: ${endXPos - startXPos}px;
            height: 6px;
            z-index: 1;
          `;
        }

        tracksRef.current.appendChild(seg);
        idx++;

        // Smooth progressive slow-down using easing curve
        const totalSegments = points.length - 1;
        const progress = idx / totalSegments;

        // Quadratic ease-in: fast at start, smoothly slows toward end
        // Base speed 90ms, max speed 200ms at end
        const baseDelay = 90;
        const maxDelay = 200;
        const delay = baseDelay + (maxDelay - baseDelay) * (progress * progress);

        // Start extension animations near end of final segment for seamless transition
        if (idx === totalSegments - 1) {
          // Trigger after 80% of the final segment delay - gives time for segment to be visible
          setTimeout(startExtensions, delay * 0.8);
        }

        setTimeout(drawNext, delay);
      };

      setTimeout(drawNext, 150);
    });
  };

  const showResult = (gameResult, won, betAmt, payout, streak) => {
    setResultText(gameResult.toUpperCase());
    if (won) {
      setResultOutcome(`+$${payout.toLocaleString()}`);
      setResultWin(true);
    } else {
      setResultOutcome(`-$${betAmt.toLocaleString()}`);
      setResultWin(false);
    }

    setShowResultBanner(true);
    setFrozenHistory(null); // Unfreeze history to show new result
    bannerTimeoutRef.current = setTimeout(dismissBanner, 3000);

    setPlaying(false);
    setComplete(true);
    setSelectedStart(null);
    setSelectedBet(null);
  };

  const dismissBanner = () => {
    setResultBannerFading(true);
    if (bannerTimeoutRef.current) {
      clearTimeout(bannerTimeoutRef.current);
      bannerTimeoutRef.current = null;
    }
    setTimeout(() => {
      setShowResultBanner(false);
      setResultBannerFading(false);
    }, 300); // Wait for fade animation
  };

  const clearLadder = () => {
    if (!tracksRef.current) return;

    const elements = tracksRef.current.querySelectorAll('.ladder-rung, .ladder-path-segment');
    elements.forEach(el => el.remove());

    // Clear button classes
    const leftBtn = document.getElementById('leftXBtn');
    const rightBtn = document.getElementById('rightXBtn');
    const oddBtn = document.getElementById('oddBtn');
    const evenBtn = document.getElementById('evenBtn');

    if (leftBtn) {
      leftBtn.classList.remove('ladder-x-active-odd', 'ladder-x-active-even', 'ladder-x-selected');
    }
    if (rightBtn) {
      rightBtn.classList.remove('ladder-x-active-odd', 'ladder-x-active-even', 'ladder-x-selected');
    }
    if (oddBtn) {
      oddBtn.classList.remove('ladder-result-winner');
    }
    if (evenBtn) {
      evenBtn.classList.remove('ladder-result-winner');
    }

    setActiveButton(null);
    setActiveResult(null);
  };

  const handleDeposit = async () => {
    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount <= 0) {
      alert('Invalid amount');
      return;
    }
    if (amount > userStockismCash) {
      alert('Insufficient Stockism cash');
      return;
    }

    setDepositLoading(true);
    try {
      await depositToLadderGameFunction({ amount });
      setDepositAmount('');
      setShowDepositModal(false);
      alert(`Successfully deposited $${amount}`);
    } catch (error) {
      console.error('Deposit error:', error);
      alert(error.message || 'Deposit failed');
    } finally {
      setDepositLoading(false);
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

  // Fixed manhwa colors (light mode only)
  const bgMain = '#d4c4a8';
  const bgCard = '#e6dbc5';
  const bgCardInner = '#e9e3d2';
  const bgDark = '#3b3624';
  const textDark = '#2a2a2a';
  const textLight = '#666';
  const textHeader = '#5c5346';
  const btnGray = '#b4ac99';
  const cornerBrown = '#715a3b';

  const winRate = (userLadderData?.gamesPlayed || 0) > 0
    ? Math.round(((userLadderData?.wins || 0) / userLadderData.gamesPlayed) * 100)
    : 0;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: bgMain,
          maxWidth: '690px',
          width: '100%',
          borderRadius: '4px',
          position: 'relative',
          maxHeight: '90vh',
          overflowY: 'auto'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            background: '#ff4444',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            width: '30px',
            height: '30px',
            fontSize: '18px',
            cursor: 'pointer',
            zIndex: 10000,
            fontWeight: 'bold'
          }}
        >
          ×
        </button>

        <div className="ladder-layout" style={{ display: 'flex', gap: '12px', padding: '15px' }}>
          {/* Main Panel */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                background: bgCard,
                border: '5px solid #fff',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column'
              }}
            >
              {/* Corner accents */}
              <div
                style={{
                  position: 'absolute',
                  top: '-5px',
                  left: '-5px',
                  width: 'calc(100% + 10px)',
                  height: 'calc(100% + 10px)',
                  pointerEvents: 'none',
                  background: `
                    linear-gradient(135deg, ${cornerBrown} 20px, transparent 20px) top left,
                    linear-gradient(225deg, ${cornerBrown} 20px, transparent 20px) top right,
                    linear-gradient(45deg, ${cornerBrown} 20px, transparent 20px) bottom left,
                    linear-gradient(315deg, ${cornerBrown} 20px, transparent 20px) bottom right
                  `,
                  backgroundSize: '50% 50%',
                  backgroundRepeat: 'no-repeat',
                  clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, 5px 5px, 5px calc(100% - 5px), calc(100% - 5px) calc(100% - 5px), calc(100% - 5px) 5px, 5px 5px)'
                }}
              />

              {/* Header */}
              <div
                style={{
                  background: bgCard,
                  padding: '7px 20px',
                  textAlign: 'center'
                }}
              >
                <div
                  className="ladder-instruction"
                  style={{
                    fontSize: '27px',
                    color: btnGray,
                    textTransform: 'uppercase',
                    fontWeight: 500,
                    letterSpacing: '-0.01em',
                    height: '35px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  {instruction}
                </div>
              </div>

              {/* Inner game area */}
              <div
                style={{
                  background: bgCardInner,
                  padding: '20px 40px',
                  position: 'relative',
                  overflow: 'visible'
                }}
              >
                <div style={{ position: 'relative', width: '220px', margin: '0 auto', overflow: 'visible' }}>
                  {/* Top X buttons */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '7px', position: 'relative', zIndex: 15 }}>
                    <button
                      id="leftXBtn"
                      onClick={() => selectStart('left')}
                      disabled={playing}
                      className={
                        activeButton === 'left'
                          ? (activeResult === 'odd' ? 'ladder-x-active-odd' : 'ladder-x-active-even')
                          : (selectedStart === 'left' ? 'ladder-x-selected' : '')
                      }
                      style={{
                        width: '44px',
                        height: '44px',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '1.3rem',
                        background: selectedStart === 'left' ? '#a9a18e' : btnGray,
                        border: 'none',
                        color: '#333',
                        cursor: playing ? 'not-allowed' : 'pointer',
                        opacity: playing ? 0.5 : 1,
                        transition: 'all 0.15s ease'
                      }}
                    >
                      X
                    </button>
                    <button
                      id="rightXBtn"
                      onClick={() => selectStart('right')}
                      disabled={playing}
                      className={
                        activeButton === 'right'
                          ? (activeResult === 'odd' ? 'ladder-x-active-odd' : 'ladder-x-active-even')
                          : (selectedStart === 'right' ? 'ladder-x-selected' : '')
                      }
                      style={{
                        width: '44px',
                        height: '44px',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '1.3rem',
                        background: selectedStart === 'right' ? '#a9a18e' : btnGray,
                        border: 'none',
                        color: '#333',
                        cursor: playing ? 'not-allowed' : 'pointer',
                        opacity: playing ? 0.5 : 1,
                        transition: 'all 0.15s ease'
                      }}
                    >
                      X
                    </button>
                  </div>

                  {/* Tracks */}
                  <div
                    ref={tracksRef}
                    style={{
                      position: 'relative',
                      height: '140px',
                      margin: '0 auto',
                      width: '100%',
                      overflow: 'visible'
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        width: '12px',
                        height: '100%',
                        background: '#b4ac99',
                        top: 0,
                        left: '16px'
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        width: '12px',
                        height: '100%',
                        background: '#b4ac99',
                        top: 0,
                        right: '16px'
                      }}
                    />
                  </div>

                  {/* Bottom ODD/EVEN buttons */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '7px', position: 'relative', zIndex: 15 }}>
                    <button
                      id="oddBtn"
                      onClick={() => selectBetAndPlay('odd')}
                      disabled={!selectedStart || playing || complete}
                      style={{
                        width: '44px',
                        height: '44px',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '0.85rem',
                        textTransform: 'uppercase',
                        background: btnGray,
                        border: 'none',
                        color: '#333',
                        cursor: (!selectedStart || playing || complete) ? 'not-allowed' : 'pointer',
                        opacity: playing ? 0.5 : 1,
                        transition: 'all 0.15s ease',
                        position: 'relative',
                        zIndex: 10
                      }}
                    >
                      ODD
                    </button>
                    <button
                      id="evenBtn"
                      onClick={() => selectBetAndPlay('even')}
                      disabled={!selectedStart || playing || complete}
                      style={{
                        width: '44px',
                        height: '44px',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '0.85rem',
                        textTransform: 'uppercase',
                        background: btnGray,
                        border: 'none',
                        color: '#333',
                        cursor: (!selectedStart || playing || complete) ? 'not-allowed' : 'pointer',
                        opacity: playing ? 0.5 : 1,
                        position: 'relative',
                        zIndex: 10,
                        transition: 'all 0.15s ease'
                      }}
                    >
                      EVEN
                    </button>
                  </div>
                </div>

                {/* Result Banner */}
                {showResultBanner && (
                  <div
                    onClick={dismissBanner}
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-50%, -50%)',
                      background: bgDark,
                      padding: '16px 40px',
                      textAlign: 'center',
                      zIndex: 100,
                      cursor: 'pointer',
                      opacity: resultBannerFading ? 0 : 1,
                      transition: 'opacity 0.3s ease'
                    }}
                  >
                    <div
                      style={{
                        fontSize: '1.2rem',
                        fontWeight: 900,
                        textTransform: 'uppercase',
                        color: '#fff'
                      }}
                    >
                      {resultText}
                    </div>
                    <div
                      style={{
                        fontSize: '0.85rem',
                        color: resultWin ? '#8fbc8f' : '#cd9b9b',
                        marginTop: '4px',
                        fontWeight: 600
                      }}
                    >
                      {resultOutcome}
                    </div>
                  </div>
                )}

                {/* Init Banner */}
                {showInitBanner && (
                  <div
                    className="ladder-init-banner"
                    onClick={() => {
                      setInitBannerFading(true);
                      setTimeout(() => setShowInitBanner(false), 300);
                    }}
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-50%, -50%)',
                      background: bgDark,
                      padding: '17px 94px',
                      textAlign: 'center',
                      zIndex: 99,
                      cursor: 'pointer',
                      opacity: initBannerFading ? 0 : 1,
                      transition: 'opacity 0.3s ease'
                    }}
                  >
                    <div
                      className="ladder-init-banner-text"
                      style={{
                        fontSize: '28px',
                        fontWeight: 385,
                        color: '#fff',
                        textTransform: 'uppercase',
                        lineHeight: 1.13,
                        letterSpacing: '-0.02em',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      CHOOSE ODDS<br />OR EVENS
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div style={{ height: '18px', background: '#cec6af' }} />
              <div
                className="ladder-footer-text"
                style={{
                  background: '#e6dbc6',
                  height: '30px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '15px',
                  color: '#a69e8c',
                  textTransform: 'uppercase',
                  letterSpacing: '0.02em'
                }}
              >
                Purchase ratio changeable based on draw #
              </div>
            </div>
          </div>

          {/* Side Panel */}
          <div className="ladder-side-panel" style={{ width: '182px', display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                background: bgCard,
                border: '5px solid #fff',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                flex: 1
              }}
            >
              {/* Corner accents */}
              <div
                style={{
                  position: 'absolute',
                  top: '-5px',
                  left: '-5px',
                  width: 'calc(100% + 10px)',
                  height: 'calc(100% + 10px)',
                  pointerEvents: 'none',
                  background: `
                    linear-gradient(135deg, ${cornerBrown} 20px, transparent 20px) top left,
                    linear-gradient(225deg, ${cornerBrown} 20px, transparent 20px) top right,
                    linear-gradient(45deg, ${cornerBrown} 20px, transparent 20px) bottom left,
                    linear-gradient(315deg, ${cornerBrown} 20px, transparent 20px) bottom right
                  `,
                  backgroundSize: '50% 50%',
                  backgroundRepeat: 'no-repeat',
                  clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, 5px 5px, 5px calc(100% - 5px), calc(100% - 5px) calc(100% - 5px), calc(100% - 5px) 5px, 5px 5px)'
                }}
              />

              <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                {/* Header */}
                <div
                  style={{
                    background: '#af905b',
                    padding: '8px 10px',
                    display: 'flex',
                    justifyContent: 'space-around',
                    margin: '8px 8px 0 8px'
                  }}
                >
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#fff', textTransform: 'uppercase' }}>
                    Total
                  </span>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#fff', textTransform: 'uppercase' }}>
                    Bet
                  </span>
                </div>

                {/* Balance & Bet */}
                <div style={{ display: 'flex', padding: '10px 8px', gap: '6px', justifyContent: 'center' }}>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ fontSize: '0.9rem', fontWeight: 700, color: textDark }}>
                      ${(displayBalance !== null ? displayBalance : (userLadderData?.balance || 500)).toLocaleString()}
                    </div>
                  </div>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <input
                      type="number"
                      value={betAmount}
                      onChange={(e) => setBetAmount(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '4px 2px',
                        border: '1px solid #a99f8f',
                        fontSize: '0.9rem',
                        fontWeight: 700,
                        background: bgCardInner,
                        color: textDark,
                        textAlign: 'center'
                      }}
                    />
                  </div>
                </div>

                {/* Buttons */}
                <div style={{ padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <button
                    onClick={() => setShowDepositModal(true)}
                    style={{
                      padding: '6px',
                      background: '#af905b',
                      color: '#fff',
                      border: 'none',
                      fontWeight: 700,
                      fontSize: '0.7rem',
                      cursor: 'pointer',
                      textTransform: 'uppercase'
                    }}
                  >
                    Deposit
                  </button>
                  <button
                    onClick={() => setShowLeaderboardModal(true)}
                    style={{
                      padding: '6px',
                      background: '#af905b',
                      color: '#fff',
                      border: 'none',
                      fontWeight: 700,
                      fontSize: '0.7rem',
                      cursor: 'pointer',
                      textTransform: 'uppercase'
                    }}
                  >
                    Leaderboard
                  </button>
                  <button
                    onClick={() => setShowStatsModal(true)}
                    style={{
                      padding: '6px',
                      background: '#af905b',
                      color: '#fff',
                      border: 'none',
                      fontWeight: 700,
                      fontSize: '0.7rem',
                      cursor: 'pointer',
                      textTransform: 'uppercase'
                    }}
                  >
                    My Stats
                  </button>
                </div>

                {/* History */}
                <div style={{ padding: '8px 10px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
                    {(frozenHistory || globalHistory.slice(0, 5)).map((game, idx) => (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div
                          style={{
                            flex: 0.7,
                            height: '5px',
                            display: 'flex',
                            borderRadius: '1px',
                            overflow: 'hidden'
                          }}
                        >
                          <div
                            style={{
                              background: '#2286f6',
                              width: `${game.oddPct || 50}%`,
                              transition: 'width 0.3s ease'
                            }}
                          />
                          <div
                            style={{
                              background: '#f22431',
                              width: `${game.evenPct || 50}%`,
                              transition: 'width 0.3s ease'
                            }}
                          />
                        </div>
                        <div
                          style={{
                            width: '24px',
                            height: '24px',
                            borderRadius: '50%',
                            background: game.result === 'odd' ? '#2286f6' : '#f22431',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '12px',
                            fontWeight: 700,
                            color: '#fff',
                            flexShrink: 0
                          }}
                        >
                          {game.result === 'odd' ? 'O' : 'E'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Deposit Modal */}
        {showDepositModal && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.8)',
              zIndex: 10000,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            onClick={() => setShowDepositModal(false)}
          >
            <div
              style={{
                background: bgCard,
                padding: '20px',
                borderRadius: '4px',
                minWidth: '300px'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{ color: textDark, marginBottom: '10px' }}>Deposit to Ladder Game</h3>
              <p style={{ fontSize: '0.85rem', color: textLight, marginBottom: '10px' }}>
                Stockism Cash: ${userStockismCash.toLocaleString()}
              </p>
              <input
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="Amount"
                style={{
                  width: '100%',
                  padding: '8px',
                  marginBottom: '10px',
                  border: '1px solid #666',
                  background: bgCardInner,
                  color: textDark
                }}
              />
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={handleDeposit}
                  disabled={depositLoading}
                  style={{
                    flex: 1,
                    padding: '8px',
                    background: '#d4af37',
                    color: '#000',
                    border: 'none',
                    fontWeight: 700,
                    cursor: depositLoading ? 'not-allowed' : 'pointer'
                  }}
                >
                  {depositLoading ? 'Depositing...' : 'Deposit'}
                </button>
                <button
                  onClick={() => setShowDepositModal(false)}
                  style={{
                    flex: 1,
                    padding: '8px',
                    background: '#666',
                    color: '#fff',
                    border: 'none',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Leaderboard Modal */}
        {showLeaderboardModal && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.8)',
              zIndex: 10000,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            onClick={() => setShowLeaderboardModal(false)}
          >
            <div
              style={{
                background: bgCard,
                padding: '20px',
                borderRadius: '4px',
                minWidth: '400px',
                maxHeight: '80vh',
                overflowY: 'auto'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{ color: textDark, marginBottom: '10px' }}>Leaderboard</h3>
              {leaderboardLoading ? (
                <p style={{ color: textLight }}>Loading...</p>
              ) : (
                <div>
                  {leaderboard.map((player, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '8px',
                        marginBottom: '6px',
                        background: bgCardInner,
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '0.85rem',
                        color: textDark
                      }}
                    >
                      <span>
                        #{idx + 1} {player.username}
                      </span>
                      <span>${player.balance.toLocaleString()} ({player.winRate}%)</span>
                    </div>
                  ))}
                </div>
              )}
              <button
                onClick={() => setShowLeaderboardModal(false)}
                style={{
                  width: '100%',
                  padding: '8px',
                  marginTop: '10px',
                  background: '#666',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* My Stats Modal */}
        {showStatsModal && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.8)',
              zIndex: 10000,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            onClick={() => setShowStatsModal(false)}
          >
            <div
              style={{
                background: bgCard,
                padding: '20px',
                borderRadius: '4px',
                minWidth: '300px'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{ color: textDark, marginBottom: '15px' }}>My Stats</h3>
              <div style={{ background: bgCardInner, padding: '15px', borderRadius: '4px', marginBottom: '15px' }}>
                <div style={{ marginBottom: '10px' }}>
                  <div style={{ fontSize: '0.7rem', color: textLight, textTransform: 'uppercase', marginBottom: '4px' }}>
                    Games Played
                  </div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, color: textDark }}>
                    {userLadderData?.gamesPlayed || 0}
                  </div>
                </div>
                <div style={{ marginBottom: '10px' }}>
                  <div style={{ fontSize: '0.7rem', color: textLight, textTransform: 'uppercase', marginBottom: '4px' }}>
                    Win Rate
                  </div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, color: textDark }}>
                    {winRate}%
                  </div>
                </div>
                <div style={{ marginBottom: '10px' }}>
                  <div style={{ fontSize: '0.7rem', color: textLight, textTransform: 'uppercase', marginBottom: '4px' }}>
                    Current Streak
                  </div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, color: textDark }}>
                    {userLadderData?.currentStreak || 0}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.7rem', color: textLight, textTransform: 'uppercase', marginBottom: '4px' }}>
                    Best Streak
                  </div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, color: textDark }}>
                    {userLadderData?.bestStreak || 0}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setShowStatsModal(false)}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: '#666',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          </div>
        )}

        <style>
          {`
            .ladder-x-selected {
              background: #a9a18e !important;
              box-shadow: 0 0 0 3px rgba(138, 126, 110, 0.3) !important;
            }
            .ladder-x-active-odd {
              background: #2286f6 !important;
            }
            .ladder-x-active-even {
              background: #f22431 !important;
            }
            .ladder-result-winner {
              transform: scale(1.1) !important;
              z-index: 20 !important;
              opacity: 1 !important;
            }
            #oddBtn.ladder-result-winner {
              background: #2286f6 !important;
            }
            #evenBtn.ladder-result-winner {
              background: #f22431 !important;
            }

            @media (max-width: 600px) {
              .ladder-layout {
                flex-direction: column !important;
              }
              .ladder-side-panel {
                width: 100% !important;
              }
              .ladder-instruction {
                font-size: 16px !important;
                height: 21px !important;
              }
              .ladder-footer-text {
                font-size: 10px !important;
              }
              .ladder-init-banner {
                padding: 15px 55px !important;
              }
            }
          `}
        </style>
      </div>
    </div>
  );
};

export default LadderGame;
