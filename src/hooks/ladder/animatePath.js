// The ladder path-draw animation, moved verbatim from LadderGame. It appends
// absolutely-positioned DOM segments inside the tracks container with eased
// timing, then colors the buttons and updates the balance via the setters
// provided by useLadderAnimation. Timing values here are load-bearing — the
// game feel breaks if they drift.
export const createAnimatePath = ({ tracksRef, trackTimeout, setActiveButton, setActiveResult, setDisplayBalance }) => {
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

        trackTimeout(() => {
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
          trackTimeout(resolve, 100);
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
          // Connect to center of horizontal segments (which are at y+1 to y+7, center y+4)
          const startY = from.y === 0 ? 0 : from.y + 4;
          const endY = to.y === height ? height : to.y + 4;
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
          // Horizontal - extend into verticals for seamless intersection, centered on 8px rung
          const startXPos = Math.min(from.x, to.x) - 3;
          const endXPos = Math.max(from.x, to.x) + 3;
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
          trackTimeout(startExtensions, delay * 0.8);
        }

        trackTimeout(drawNext, delay);
      };

      trackTimeout(drawNext, 150);
    });
  };

  return animatePath;
};
