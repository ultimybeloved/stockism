import { describe, it, expect } from 'vitest';
import {
  MAX_WATCHLISTS,
  addList,
  cleanListName,
  deleteList,
  getWatchlists,
  renameList,
  toggleInList,
  watchlistWrite,
} from './watchlists';
import type { UserData, Watchlist } from '../../../types';

const user = (u: Partial<UserData>) => u as UserData;
const two: Watchlist[] = [
  { id: 'main', name: 'Watchlist', tickers: ['JAKE', 'GUN'] },
  { id: 'l1', name: 'Sleepers', tickers: ['GUN', 'JAY'] },
];

describe('watchlists', () => {
  it('reads an old single watchlist as one list called Watchlist', () => {
    expect(getWatchlists(user({ watchlist: ['JAKE'] }))).toEqual([
      { id: 'main', name: 'Watchlist', tickers: ['JAKE'] },
    ]);
    expect(getWatchlists(null)).toEqual([{ id: 'main', name: 'Watchlist', tickers: [] }]);
  });

  it('prefers the named lists once they exist', () => {
    expect(getWatchlists(user({ watchlist: ['X'], watchlists: two }))).toBe(two);
  });

  it('writes the flat watchlist as every ticker in any list, once', () => {
    expect(watchlistWrite(two).watchlist).toEqual(['JAKE', 'GUN', 'JAY']);
  });

  it('toggles a ticker in one list only', () => {
    const out = toggleInList(two, 'l1', 'GUN');
    expect(out[1]!.tickers).toEqual(['JAY']);
    expect(out[0]!.tickers).toEqual(['JAKE', 'GUN']);
    expect(toggleInList(out, 'l1', 'GUN')[1]!.tickers).toEqual(['JAY', 'GUN']);
  });

  it('adds a named list, holding the stock it was made for', () => {
    const made = addList(two, '  Big   Deal ', 'JAKE')!;
    expect(made.lists).toHaveLength(3);
    expect(made.lists[2]).toMatchObject({ id: made.id, name: 'Big Deal', tickers: ['JAKE'] });
  });

  it('refuses a blank name or an eleventh list', () => {
    expect(addList(two, '   ')).toBeNull();
    const full = Array.from({ length: MAX_WATCHLISTS }, (_, i) => ({ id: `l${i}`, name: `L${i}`, tickers: [] }));
    expect(addList(full, 'One more')).toBeNull();
  });

  it('cuts names to 20 characters', () => {
    expect(cleanListName('a'.repeat(30))).toHaveLength(20);
  });

  it('renames, and refuses a blank name', () => {
    expect(renameList(two, 'l1', 'Moon')![1]!.name).toBe('Moon');
    expect(renameList(two, 'l1', ' ')).toBeNull();
  });

  it('deletes a list but never the last one', () => {
    expect(deleteList(two, 'l1')).toEqual([two[0]]);
    expect(deleteList([two[0]!], 'main')).toBeNull();
  });
});
