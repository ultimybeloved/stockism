// Quick search (Ctrl+K, or Cmd+K on a Mac, or the Search button in the
// desktop header): type part of a stock's name or ticker, or a page, and jump
// to it. Enter opens the highlighted result; the Buy button opens the stock
// with its buy form already up.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CHARACTERS } from '../../../characters';
import { useSession, useMarket } from '../../../context/AppContext';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { useModalFocus } from '../../hooks/useModalFocus';
import { themeClasses } from '../../../utils/theme';
import { formatCurrency } from '../../../utils/formatters';

const PAGES = [
  { label: 'Market', path: '/' },
  { label: 'Portfolio', path: '/portfolio', needsUser: true },
  { label: 'Leaderboard', path: '/leaderboard' },
  { label: 'Predictions', path: '/predictions' },
  { label: 'Ladder', path: '/ladder' },
  { label: 'Achievements', path: '/achievements' },
  { label: 'Profile', path: '/profile', needsUser: true },
];

type Result = { key: string; path: string; label: string; sub?: string; ticker?: string };

const CommandPalette = ({ onClose }: { onClose: () => void }) => {
  const navigate = useNavigate();
  const { user } = useSession();
  const { prices } = useMarket();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const dialogRef = useModalFocus();
  useEscapeKey(onClose);
  const { overlayClass, modalShellClass, inputClass, mutedClass, textClass } = themeClasses;

  const results = useMemo((): Result[] => {
    const q = query.trim().toLowerCase().replace(/^\$/, '');
    const pages = PAGES.filter((p) => (!p.needsUser || user) && (!q || p.label.toLowerCase().includes(q))).map((p) => ({
      key: p.path,
      path: p.path,
      label: p.label,
      sub: 'Page',
    }));
    if (!q) return pages;
    const score = (c: (typeof CHARACTERS)[number]) => {
      const t = c.ticker.toLowerCase();
      const n = c.name.toLowerCase();
      if (t === q) return 0;
      if (t.startsWith(q)) return 1;
      if (n.startsWith(q)) return 2;
      if (n.split(/\s+/).some((w) => w.startsWith(q))) return 3;
      if (n.includes(q) || t.includes(q)) return 4;
      return 9;
    };
    const stocks = CHARACTERS.map((c) => ({ c, s: score(c) }))
      .filter((x) => x.s < 9)
      .sort((a, b) => a.s - b.s || a.c.ticker.localeCompare(b.c.ticker))
      .slice(0, 8)
      .map(({ c }) => ({
        key: c.ticker,
        path: `/stock/${c.ticker}`,
        label: `$${c.ticker}`,
        sub: c.name,
        ticker: c.ticker,
      }));
    return [...stocks, ...pages];
  }, [query, user]);

  const go = (path: string) => {
    onClose();
    navigate(path);
  };
  const current = Math.min(active, Math.max(0, results.length - 1));

  return (
    <div className={`${overlayClass} z-[60] !items-start pt-[12vh]`} onClick={onClose}>
      <div
        ref={dialogRef}
        aria-label="Quick search"
        className={`${modalShellClass} max-w-lg`}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          aria-label="Search stocks and pages"
          placeholder="Search a stock or page..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter' && results[current]) {
              e.preventDefault();
              const r = results[current]!;
              go(e.shiftKey && r.ticker && user ? `${r.path}?trade=buy` : r.path);
            }
          }}
          className={`w-full px-4 py-3 text-base border-b rounded-t-sm outline-none ${inputClass}`}
        />
        <ul className="max-h-[50vh] overflow-y-auto py-1" role="listbox">
          {results.length === 0 && <li className={`px-4 py-3 text-sm ${mutedClass}`}>Nothing matches.</li>}
          {results.map((r, i) => (
            <li
              key={r.key}
              role="option"
              aria-selected={i === current}
              onMouseEnter={() => setActive(i)}
              className={`flex items-center gap-3 px-4 py-2 cursor-pointer ${i === current ? 'bg-orange-500/10' : ''}`}
              onClick={() => go(r.path)}
            >
              <span
                className={r.ticker ? 'text-orange-500 font-mono font-semibold w-16' : `font-semibold ${textClass}`}
              >
                {r.label}
              </span>
              <span className={`flex-1 truncate text-sm ${mutedClass}`}>{r.sub}</span>
              {r.ticker && <span className={`text-sm ${textClass}`}>{formatCurrency(prices[r.ticker] || 0)}</span>}
              {r.ticker && user && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    go(`${r.path}?trade=buy`);
                  }}
                  className="px-2 py-0.5 text-xs font-semibold uppercase rounded-sm border border-orange-500 text-orange-500 hover:bg-orange-500/10"
                >
                  Buy
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className={`px-4 py-2 border-t text-[11px] ${mutedClass} light:border-amber-200 dark:border-zinc-800`}>
          ↑↓ to move, Enter to open, Shift+Enter to buy, Esc to close
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
