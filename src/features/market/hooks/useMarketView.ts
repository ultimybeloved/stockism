import { useCallback, useState } from 'react';

export type MarketView = 'cards' | 'list';

const KEY = 'stockism.marketView';

const read = (): MarketView => {
  try {
    return localStorage.getItem(KEY) === 'list' ? 'list' : 'cards';
  } catch {
    return 'cards';
  }
};

// Cards or list for the market, remembered on this device. The list is compact
// rows on phones and a sortable table on bigger screens.
export function useMarketView() {
  const [view, setViewState] = useState<MarketView>(read);
  const setView = useCallback((next: MarketView) => {
    setViewState(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* private mode: still switches, just not remembered */
    }
  }, []);
  return { view, setView };
}
