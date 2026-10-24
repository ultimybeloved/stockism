// A player's watchlists: up to MAX_WATCHLISTS named lists of tickers, stored on
// the user doc as `watchlists`. Older accounts only have the single `watchlist`
// array, which reads as one list called "Watchlist" until the first edit.
//
// Every write also stores `watchlist` as every ticker in any list, so the star
// on a card ("is it watched anywhere?") and the ticker rename keep reading the
// one flat array they always did.

import type { Ticker, UserData, Watchlist } from '../../../types';

export const MAX_WATCHLISTS = 10;
export const MAX_WATCHLIST_NAME = 20;
const FIRST_LIST: Watchlist = { id: 'main', name: 'Watchlist', tickers: [] };

/** The player's lists, oldest first. Never empty. */
export const getWatchlists = (userData: UserData | null | undefined): Watchlist[] => {
  const lists = userData?.watchlists;
  if (Array.isArray(lists) && lists.length) return lists;
  return [{ ...FIRST_LIST, tickers: userData?.watchlist || [] }];
};

/** Every ticker in any list, no repeats. */
export const watchedTickers = (lists: Watchlist[]): Ticker[] => [...new Set(lists.flatMap((l) => l.tickers))];

/** The fields to write for these lists. */
export const watchlistWrite = (lists: Watchlist[]) => ({ watchlists: lists, watchlist: watchedTickers(lists) });

/** Add the ticker to the list, or take it out if it's there. */
export const toggleInList = (lists: Watchlist[], listId: string, ticker: Ticker): Watchlist[] =>
  lists.map((l) =>
    l.id !== listId
      ? l
      : { ...l, tickers: l.tickers.includes(ticker) ? l.tickers.filter((t) => t !== ticker) : [...l.tickers, ticker] },
  );

/** A trimmed list name, or '' if there's nothing usable. */
export const cleanListName = (name: string) => name.replace(/\s+/g, ' ').trim().slice(0, MAX_WATCHLIST_NAME);

/** The lists with a new one on the end (holding `ticker` if given), or null when full or unnamed. */
export const addList = (
  lists: Watchlist[],
  name: string,
  ticker?: Ticker,
): { lists: Watchlist[]; id: string } | null => {
  const clean = cleanListName(name);
  if (!clean || lists.length >= MAX_WATCHLISTS) return null;
  const id = `l${Date.now().toString(36)}`;
  return { lists: [...lists, { id, name: clean, tickers: ticker ? [ticker] : [] }], id };
};

export const renameList = (lists: Watchlist[], listId: string, name: string): Watchlist[] | null => {
  const clean = cleanListName(name);
  return clean ? lists.map((l) => (l.id === listId ? { ...l, name: clean } : l)) : null;
};

/** The lists without that one, or null if it's the last one left. */
export const deleteList = (lists: Watchlist[], listId: string): Watchlist[] | null =>
  lists.length > 1 ? lists.filter((l) => l.id !== listId) : null;
