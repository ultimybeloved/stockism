// The Watchlist tab's list switcher: one tab per list, and a bar under it to
// make, rename or delete lists.
import { useState } from 'react';
import TabBar from '../../../shared/components/TabBar';
import { themeClasses } from '../../../utils/theme';
import { useWatchlists } from '../hooks/useWatchlists';
import { MAX_WATCHLISTS, MAX_WATCHLIST_NAME, addList, deleteList, renameList } from '../utils/watchlists';
import type { Watchlist } from '../../../types';

type Mode = '' | 'new' | 'rename' | 'delete';

const WatchlistTabs = ({ active, setActive }: { active: Watchlist; setActive: (id: string) => void }) => {
  const { lists, save } = useWatchlists();
  const [mode, setMode] = useState<Mode>('');
  const [name, setName] = useState('');
  const { textClass, mutedClass, inputClass, ghostBtnClass } = themeClasses;
  const btn = `px-2.5 py-1 text-xs font-semibold rounded-sm border ${ghostBtnClass} disabled:opacity-50`;

  const start = (m: Mode) => {
    setMode(m);
    setName(m === 'rename' ? active.name : '');
  };
  const submit = async () => {
    if (mode === 'new') {
      const made = addList(lists, name);
      if (made && (await save(made.lists))) setActive(made.id);
    } else if (mode === 'rename') {
      await save(renameList(lists, active.id, name));
    } else if (mode === 'delete') {
      await save(deleteList(lists, active.id));
    }
    setMode('');
  };

  return (
    <div className="mb-3">
      <TabBar
        label="Your watchlists"
        tabs={lists.map((l) => ({ value: l.id, label: l.name, count: l.tickers.length }))}
        value={active.id}
        onChange={(id) => {
          setActive(id);
          setMode('');
        }}
      />
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-x border-b rounded-b-md light:border-amber-200 light:bg-white dark:border-zinc-800 dark:bg-zinc-900">
        {mode === 'new' || mode === 'rename' ? (
          <form
            className="flex flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <input
              autoFocus
              aria-label={mode === 'new' ? 'New list name' : 'List name'}
              placeholder="List name"
              value={name}
              maxLength={MAX_WATCHLIST_NAME}
              onChange={(e) => setName(e.target.value)}
              className={`flex-1 min-w-0 px-2.5 py-1 text-sm rounded-sm border ${inputClass}`}
            />
            <button type="submit" disabled={!name.trim()} className={btn}>
              {mode === 'new' ? 'Add list' : 'Save'}
            </button>
            <button type="button" onClick={() => setMode('')} className={btn}>
              Cancel
            </button>
          </form>
        ) : mode === 'delete' ? (
          <>
            <span className={`flex-1 text-xs ${textClass}`}>Delete {active.name}?</span>
            <button
              type="button"
              onClick={() => void submit()}
              className="px-2.5 py-1 text-xs font-semibold rounded-sm bg-red-600 text-white hover:bg-red-700"
            >
              Delete
            </button>
            <button type="button" onClick={() => setMode('')} className={btn}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <span className={`flex-1 text-xs ${mutedClass}`}>
              {active.tickers.length} {active.tickers.length === 1 ? 'stock' : 'stocks'}
            </span>
            <button
              type="button"
              onClick={() => start('new')}
              disabled={lists.length >= MAX_WATCHLISTS}
              title={lists.length >= MAX_WATCHLISTS ? `You can have up to ${MAX_WATCHLISTS} lists` : undefined}
              className={btn}
            >
              New list
            </button>
            <button type="button" onClick={() => start('rename')} className={btn}>
              Rename
            </button>
            {lists.length > 1 && (
              <button type="button" onClick={() => start('delete')} className={btn}>
                Delete
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default WatchlistTabs;
