// "Save to list": the star on a stock opens this once a player has more than
// one watchlist. Each box saves the moment it's ticked. A bottom sheet on
// phones, a small window on computers.
import { useState } from 'react';
import SheetHandle from '../../../shared/components/SheetHandle';
import { useSheetRef } from '../../../shared/hooks/useSwipeToClose';
import { useEscapeKey } from '../../../shared/hooks/useEscapeKey';
import { themeClasses } from '../../../utils/theme';
import { openWatchlistPicker, useWatchlistPicker, useWatchlists } from '../hooks/useWatchlists';
import { MAX_WATCHLISTS, MAX_WATCHLIST_NAME, addList, toggleInList } from '../utils/watchlists';

const close = () => openWatchlistPicker(null);

const Picker = ({ ticker }: { ticker: string }) => {
  const { lists, save } = useWatchlists();
  const [name, setName] = useState('');
  const sheetRef = useSheetRef(close);
  useEscapeKey(close);
  const { sheetOverlayClass, sheetShellClass, textClass, mutedClass, inputClass, ghostBtnClass } = themeClasses;

  const create = () => {
    const made = addList(lists, name, ticker);
    if (made) void save(made.lists).then((ok) => ok && setName(''));
  };

  return (
    <div className={`${sheetOverlayClass} z-50`} onClick={close}>
      <div ref={sheetRef} className={`${sheetShellClass} p-4 md:max-w-xs`} onClick={(e) => e.stopPropagation()}>
        <SheetHandle />
        <h3 className={`text-sm font-semibold mb-3 ${textClass}`}>
          Save <span className="text-orange-500 font-mono">${ticker}</span> to
        </h3>
        <ul className="space-y-1 mb-3">
          {lists.map((l) => (
            <li key={l.id}>
              <label className="flex items-center gap-3 py-2 px-1 rounded-sm cursor-pointer light:hover:bg-amber-50 dark:hover:bg-zinc-800">
                <input
                  type="checkbox"
                  checked={l.tickers.includes(ticker)}
                  onChange={() => void save(toggleInList(lists, l.id, ticker))}
                  className="h-4 w-4 accent-orange-500"
                />
                <span className={`flex-1 text-sm ${textClass}`}>{l.name}</span>
                <span className={`text-xs ${mutedClass}`}>{l.tickers.length}</span>
              </label>
            </li>
          ))}
        </ul>
        {lists.length < MAX_WATCHLISTS ? (
          <form
            className="flex gap-2 mb-3"
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <input
              aria-label="New list name"
              placeholder="New list"
              value={name}
              maxLength={MAX_WATCHLIST_NAME}
              onChange={(e) => setName(e.target.value)}
              className={`flex-1 min-w-0 px-3 py-2 text-sm rounded-sm border ${inputClass}`}
            />
            <button
              type="submit"
              disabled={!name.trim()}
              className={`px-3 py-2 text-sm font-semibold rounded-sm border ${ghostBtnClass} disabled:opacity-50`}
            >
              Add
            </button>
          </form>
        ) : (
          <p className={`text-xs mb-3 ${mutedClass}`}>You have {MAX_WATCHLISTS} lists, the most you can have.</p>
        )}
        <button
          type="button"
          onClick={close}
          className="w-full py-2.5 text-sm font-semibold rounded-sm bg-orange-500 text-white hover:bg-orange-600"
        >
          Done
        </button>
      </div>
    </div>
  );
};

const WatchlistPicker = () => {
  const ticker = useWatchlistPicker();
  return ticker ? <Picker key={ticker} ticker={ticker} /> : null;
};

export default WatchlistPicker;
