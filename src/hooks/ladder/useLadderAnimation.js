import { useState, useEffect, useRef } from 'react';
import { createAnimatePath } from './animatePath';

// Ladder DOM animation: rung creation/reveal, the path draw (see
// animatePath.js), clearing the board, and post-game button coloring.
// Every setTimeout goes through trackTimeout so unmounting mid-animation
// can't leak timers.
export function useLadderAnimation({ setDisplayBalance }) {
  const [activeButton, setActiveButton] = useState(null); // 'left' or 'right' - stays colored after game
  const [activeResult, setActiveResult] = useState(null); // 'odd' or 'even' - result color for active button

  const tracksRef = useRef(null);
  const animationTimeoutsRef = useRef([]);

  // Cleanup all timeout refs on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      animationTimeoutsRef.current.forEach(id => clearTimeout(id));
      animationTimeoutsRef.current = [];
    };
  }, []);

  // Helper to track setTimeout IDs for cleanup
  const trackTimeout = (fn, delay) => {
    const id = setTimeout(fn, delay);
    animationTimeoutsRef.current.push(id);
    return id;
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
        trackTimeout(() => {
          rung.style.opacity = '1';
          if (idx === rungs.length - 1) {
            trackTimeout(resolve, 150);
          }
        }, idx * 120);
      });
    });
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

  const animatePath = createAnimatePath({ tracksRef, trackTimeout, setActiveButton, setActiveResult, setDisplayBalance });

  return { tracksRef, activeButton, activeResult, trackTimeout, createRungs, revealRungs, animatePath, clearLadder };
}
