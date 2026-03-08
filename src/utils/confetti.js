import confetti from 'canvas-confetti';

export function fireBuyConfetti() {
  confetti({
    particleCount: 60,
    spread: 55,
    origin: { y: 0.7 },
    colors: ['#22c55e', '#16a34a', '#4ade80'],
  });
}

export function fireSellConfetti() {
  confetti({
    particleCount: 60,
    spread: 55,
    origin: { y: 0.7 },
    colors: ['#ef4444', '#dc2626', '#f87171'],
  });
}

export function fireRewardConfetti() {
  const end = Date.now() + 600;
  const frame = () => {
    confetti({
      particleCount: 3,
      angle: 60,
      spread: 55,
      origin: { x: 0 },
      colors: ['#f59e0b', '#eab308', '#fbbf24'],
    });
    confetti({
      particleCount: 3,
      angle: 120,
      spread: 55,
      origin: { x: 1 },
      colors: ['#f59e0b', '#eab308', '#fbbf24'],
    });
    if (Date.now() < end) requestAnimationFrame(frame);
  };
  frame();
}

export function fireBigTradeConfetti() {
  const end = Date.now() + 800;
  const frame = () => {
    confetti({
      particleCount: 4,
      angle: 60,
      spread: 70,
      origin: { x: 0, y: 0.6 },
      colors: ['#f59e0b', '#22c55e', '#3b82f6', '#ef4444'],
    });
    confetti({
      particleCount: 4,
      angle: 120,
      spread: 70,
      origin: { x: 1, y: 0.6 },
      colors: ['#f59e0b', '#22c55e', '#3b82f6', '#ef4444'],
    });
    if (Date.now() < end) requestAnimationFrame(frame);
  };
  frame();
}
