import { useEffect, useRef } from 'react';
import type { FlapStyle } from '../../../rules/cosmetics';

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789$#%&';
const rnd = (n: number) => Math.floor(Math.random() * n);

// The Split Flap name: one flip-board tile per letter. A flip drops the top
// half of the old letter and lands the bottom half of the new one (names.css).
// The player picks how it flips:
// - random: each letter flips through one random character on its own timer
// - scramble: every few seconds a few letters spin and settle back
// - board: the whole name spins up and settles left to right, like an
//   arrivals board
// The flipping writes straight to the tiles (decoration, not state), and every
// timer stops when the name unmounts or changes.
const SplitFlap = ({ text, mode, className }: { text: string; mode: FlapStyle; className: string }) => {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const tiles = [...root.querySelectorAll<HTMLElement>('.tile')];
    const timers = new Set<number>();
    let alive = true;
    const later = (ms: number) =>
      new Promise<void>((resolve) => {
        const id = window.setTimeout(() => {
          timers.delete(id);
          resolve();
        }, ms);
        timers.add(id);
      });
    const flipTo = async (tile: HTMLElement, ch: string, ms: number) => {
      const [, top, bot, ft, fb] = [...tile.children] as HTMLElement[];
      if (!top || !bot || !ft || !fb) return;
      const old = tile.dataset.cur || '';
      top.textContent = ch;
      bot.textContent = old;
      ft.textContent = old;
      fb.textContent = ch;
      tile.style.setProperty('--ms', `${ms}ms`);
      tile.classList.remove('flipping');
      void tile.offsetWidth; // restart the flip
      tile.classList.add('flipping');
      tile.dataset.cur = ch;
      await later(ms);
      bot.textContent = ch;
      ft.textContent = ch;
      tile.classList.remove('flipping');
    };
    const spin = async (tile: HTMLElement, n: number, ms: number) => {
      for (let k = 0; k < n && alive; k++) await flipTo(tile, CHARS[rnd(CHARS.length)]!, ms);
      if (alive) await flipTo(tile, tile.dataset.c || '', ms);
    };
    const letters = tiles.filter((t) => (t.dataset.c || '').trim());

    if (mode === 'random') {
      letters.forEach(async (t) => {
        await later(300 + rnd(5000));
        while (alive) {
          await spin(t, 1, 170);
          await later(5000 + rnd(8000));
        }
      });
    } else if (mode === 'scramble') {
      (async () => {
        await later(500);
        while (alive && letters.length) {
          const picks = [...new Set([rnd(letters.length), rnd(letters.length), rnd(letters.length)])].slice(
            0,
            1 + rnd(3),
          );
          picks.forEach((p, i) =>
            later(i * 180).then(() => {
              if (alive) spin(letters[p]!, 3 + rnd(4), 130);
            }),
          );
          await later(4500 + rnd(4000));
        }
      })();
    } else {
      (async () => {
        await later(400);
        while (alive) {
          letters.forEach((t, i) => spin(t, 3 + i * 2, 110));
          await later(9000);
        }
      })();
    }
    return () => {
      alive = false;
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [text, mode]);

  return (
    <span ref={ref} className={className} aria-label={text}>
      {[...text].map((c, i) => {
        const ch = c === ' ' ? ' ' : c;
        return (
          <span key={`${i}${c}`} className="tile" data-c={ch} data-cur={ch} aria-hidden="true">
            <span className="sz">{ch}</span>
            <span className="h top">{ch}</span>
            <span className="h bot">{ch}</span>
            <span className="fl ft">{ch}</span>
            <span className="fl fb">{ch}</span>
          </span>
        );
      })}
    </span>
  );
};

export default SplitFlap;
