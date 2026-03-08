import confetti from 'canvas-confetti';

export function fireBuyConfetti() {
  confetti({
    particleCount: 30,
    spread: 55,
    origin: { y: 0.7 },
    colors: ['#22c55e', '#16a34a', '#4ade80'],
  });
}

export function fireSellConfetti() {
  confetti({
    particleCount: 30,
    spread: 55,
    origin: { y: 0.7 },
    colors: ['#ef4444', '#dc2626', '#f87171'],
  });
}

export function fireRewardConfetti() {
  const end = Date.now() + 400;
  const frame = () => {
    confetti({
      particleCount: 3,
      angle: 60,
      spread: 55,
      origin: { x: 0 },
      colors: ['#f97316', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'],
    });
    confetti({
      particleCount: 3,
      angle: 120,
      spread: 55,
      origin: { x: 1 },
      colors: ['#f97316', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'],
    });
    if (Date.now() < end) requestAnimationFrame(frame);
  };
  frame();
}

export function fireBigTradeConfetti() {
  const end = Date.now() + 500;
  const frame = () => {
    confetti({
      particleCount: 3,
      angle: 60,
      spread: 70,
      origin: { x: 0, y: 0.6 },
      colors: ['#f59e0b', '#22c55e', '#3b82f6', '#ef4444'],
    });
    confetti({
      particleCount: 3,
      angle: 120,
      spread: 70,
      origin: { x: 1, y: 0.6 },
      colors: ['#f59e0b', '#22c55e', '#3b82f6', '#ef4444'],
    });
    if (Date.now() < end) requestAnimationFrame(frame);
  };
  frame();
}
