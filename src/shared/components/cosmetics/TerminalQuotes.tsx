import { useEffect, useRef } from 'react';
import { terminalQuotes, TERMINAL_QUOTES } from '../../../utils/cosmeticSeeds';

const TICK_MS = 700;

// The Terminal backdrop: the player's own grid of quotes, one quote changing
// every 0.7s and flashing as it does. The ticking writes straight to the DOM
// (it's decoration, not state) and stops when the row unmounts or the player
// prefers reduced motion.
const TerminalQuotes = ({ seedKey }: { seedKey?: string | null }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = ref.current;
    if (!term || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => {
      const cell = term.children[Math.floor(Math.random() * TERMINAL_QUOTES)];
      const em = cell?.querySelector('em');
      const u = cell?.querySelector('u');
      if (!cell || !em || !u) return;
      const up = Math.random() > 0.45;
      em.textContent = (parseFloat(em.textContent || '0') * (1 + (Math.random() - 0.45) * 0.02)).toFixed(2);
      u.className = up ? 'tu' : 'td';
      u.textContent = `${up ? '▲' : '▼'}${(Math.random() * 6).toFixed(1)}%`;
      cell.classList.remove('hit');
      void (cell as HTMLElement).offsetWidth; // restart the flash
      cell.classList.add('hit');
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [seedKey]);

  return (
    <div className="term" ref={ref}>
      {terminalQuotes(seedKey).map((q, i) => (
        <span key={i}>
          <b>{q.ticker}</b> <em>{q.price.toFixed(2)}</em>{' '}
          <u className={q.up ? 'tu' : 'td'}>
            {q.up ? '▲' : '▼'}
            {q.move.toFixed(1)}%
          </u>
        </span>
      ))}
    </div>
  );
};

export default TerminalQuotes;
