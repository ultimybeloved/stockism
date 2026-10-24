import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { searchPlayersFunction } from '../../../api/callables';
import type { PlayerSearchResult } from '../../../api/types';
import { CREW_MAP } from '../../../crews';
import CrewPin from '../../../shared/components/CrewPin';
import { formatCurrency } from '../../../utils/formatters';
import { themeClasses } from '../../../utils/theme';

const MIN_QUERY = 2;
const DEBOUNCE_MS = 300;

// Find any player by name from the leaderboard, not just the ones on the
// board. Public profiles open on click; private ones just show their name.
const PlayerSearch = () => {
  const { cardClass, cardEdgeClass, inputClass, textClass, mutedClass } = themeClasses;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlayerSearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  // Only the newest request may fill the list, however the replies arrive.
  const latest = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY) {
      latest.current++;
      setResults(null);
      setFailed(false);
      setLoading(false);
      return;
    }
    const id = ++latest.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await searchPlayersFunction({ query: q });
        if (id === latest.current) {
          setResults(res.data.players);
          setFailed(false);
        }
      } catch {
        if (id === latest.current) setFailed(true);
      }
      if (id === latest.current) setLoading(false);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const open = query.trim().length >= MIN_QUERY;

  return (
    <div className="relative mb-3">
      <input
        type="search"
        aria-label="Search players"
        placeholder="Search players..."
        value={query}
        maxLength={20}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
        className={`w-full px-3 py-2 text-sm rounded-sm border ${inputClass}`}
      />
      {open && (
        <div
          className={`absolute z-20 left-0 right-0 mt-1 border rounded-sm shadow-xl overflow-hidden ${cardClass} ${cardEdgeClass}`}
        >
          {failed ? (
            <p className={`px-3 py-2 text-sm ${mutedClass}`}>Search isn't working right now. Try again soon.</p>
          ) : loading && !results ? (
            <p className={`px-3 py-2 text-sm ${mutedClass}`}>Searching...</p>
          ) : results && results.length === 0 ? (
            <p className={`px-3 py-2 text-sm ${mutedClass}`}>No players found.</p>
          ) : (
            results?.map((p) => {
              const crew = p.crew ? CREW_MAP[p.crew] : null;
              const row = (
                <>
                  {crew ? <CrewPin crew={crew} className="w-4 h-4" /> : <span className="w-4 h-4 shrink-0" />}
                  <span className={`flex-1 truncate font-medium ${textClass}`}>{p.displayName}</span>
                  <span className={`text-xs tabular-nums ${mutedClass}`}>{formatCurrency(p.netWorth)}</span>
                </>
              );
              const rowClass = 'flex items-center gap-2 px-3 py-2 text-sm';
              return p.displayName ? (
                <Link
                  key={p.displayName}
                  to={`/u/${p.displayName.toLowerCase()}`}
                  className={`${rowClass} light:hover:bg-amber-50 dark:hover:bg-zinc-800`}
                >
                  {row}
                </Link>
              ) : (
                <div key={p.displayName} className={rowClass}>
                  {row}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

export default PlayerSearch;
