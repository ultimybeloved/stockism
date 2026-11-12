import { useSyncExternalStore } from 'react';
import { isPreMarketWindow } from '../../utils/marketHours';

// True during the Thursday pre-market window, when Buy and Sell queue for the
// opening auction instead of trading. One shared 10-second clock, so a page of
// stock cards doesn't run a timer each.
const listeners = new Set<() => void>();
let current = isPreMarketWindow();
let timer: ReturnType<typeof setInterval> | null = null;

const subscribe = (l: () => void) => {
  listeners.add(l);
  if (!timer) {
    current = isPreMarketWindow();
    timer = setInterval(() => {
      const next = isPreMarketWindow();
      if (next === current) return;
      current = next;
      listeners.forEach((fn) => fn());
    }, 10000);
  }
  return () => {
    listeners.delete(l);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
};

export const usePreMarket = () =>
  useSyncExternalStore(
    subscribe,
    () => current,
    () => false,
  );

/** A trade button's label: "Queue Buy" / "Queue Sell" during pre-market. */
export const tradeLabel = (action: 'buy' | 'sell' | 'short' | 'cover', preMarket: boolean) => {
  const word = action.charAt(0).toUpperCase() + action.slice(1);
  return preMarket && (action === 'buy' || action === 'sell') ? `Queue ${word}` : word;
};

/** Short and Cover can't be queued for the opening auction. */
export const PRE_MARKET_NO_QUEUE = 'Short and Cover open at the reopen';
