import confetti from 'canvas-confetti';

const BUY_COLORS = ['#22c55e', '#16a34a', '#4ade80'];
const SELL_COLORS = ['#ef4444', '#dc2626', '#f87171'];

export function fireTradeConfetti(totalValue, action) {
  const colors = action === 'buy' ? BUY_COLORS : SELL_COLORS;

  if (totalValue >= 10000) {
    // Side-cannon animation for huge trades
    const end = Date.now() + 600;
    const frame = () => {
      confetti({
        particleCount: 4,
        angle: 60,
        spread: 70,
        origin: { x: 0, y: 0.6 },
        colors,
      });
      confetti({
        particleCount: 4,
        angle: 120,
        spread: 70,
        origin: { x: 1, y: 0.6 },
        colors,
      });
      if (Date.now() < end) requestAnimationFrame(frame);
    };
    frame();
  } else if (totalValue >= 1000) {
    confetti({
      particleCount: 50,
      spread: 65,
      origin: { y: 0.7 },
      colors,
    });
  } else if (totalValue >= 100) {
    confetti({
      particleCount: 30,
      spread: 55,
      origin: { y: 0.7 },
      colors,
    });
  } else {
    confetti({
      particleCount: 15,
      spread: 40,
      origin: { y: 0.7 },
      colors,
    });
  }
}

export function fireDailyRewardConfetti() {
  const colors = ['#f59e0b', '#f97316', '#fbbf24', '#fb923c'];
  const end = Date.now() + 400;
  const frame = () => {
    confetti({
      particleCount: 3,
      angle: 60,
      spread: 55,
      origin: { x: 0 },
      colors,
    });
    confetti({
      particleCount: 3,
      angle: 120,
      spread: 55,
      origin: { x: 1 },
      colors,
    });
    if (Date.now() < end) requestAnimationFrame(frame);
  };
  frame();
}

export function fireWeeklyRewardConfetti() {
  const colors = ['#a855f7', '#8b5cf6', '#c084fc', '#7c3aed'];
  const end = Date.now() + 400;
  const frame = () => {
    confetti({
      particleCount: 3,
      angle: 60,
      spread: 55,
      origin: { x: 0 },
      colors,
    });
    confetti({
      particleCount: 3,
      angle: 120,
      spread: 55,
      origin: { x: 1 },
      colors,
    });
    if (Date.now() < end) requestAnimationFrame(frame);
  };
  frame();
}
