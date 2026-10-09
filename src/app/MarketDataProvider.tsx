import { useCallback, useMemo, useRef, type ReactNode } from 'react';
import { CHARACTERS } from '../characters';
import { computeRarityTiers } from '../utils/rarity';
import { useMarketData } from '../features/market/hooks/useMarketData';
import { MarketProvider, type MarketAccessValue, type MarketContextValue } from '../context/AppContext';

// The live market subscriptions, mounted above App. A price tick re-renders this
// and whatever reads useMarket(), not App and the shell; App's handlers read the
// market at click time through getMarket instead.
export default function MarketDataProvider({ children }: { children: ReactNode }) {
  const {
    prices,
    priceHistory,
    marketData,
    dividendTierOverrides,
    launchedTickers,
    activeIPOs,
    predictions,
    crewStats,
    storedReviewChanges,
    siteMessages,
    marketStatus,
  } = useMarketData();

  // Get list of tickers currently in IPO (hype or active phase) - these shouldn't be tradeable
  const ipoRestrictedTickers = useMemo(() => {
    const now = Date.now();
    return activeIPOs
      .filter((ipo) => !ipo.priceJumped && now < ipo.ipoEndsAt) // In hype or buying phase
      .map((ipo) => ipo.ticker);
  }, [activeIPOs]);

  // Rarity tiers by market standing — computed once here so every card shares the
  // same ranking instead of each re-ranking the whole roster. See utils/rarity.js.
  const rarityTiers = useMemo(() => computeRarityTiers(CHARACTERS, prices), [prices]);

  const market = useMemo(
    (): MarketContextValue => ({
      prices,
      priceHistory,
      predictions,
      marketData,
      activeIPOs,
      ipoRestrictedTickers,
      launchedTickers,
      rarityTiers,
      crewStats,
      storedReviewChanges,
      siteMessages,
      dividendTierOverrides,
    }),
    [
      prices,
      priceHistory,
      predictions,
      marketData,
      activeIPOs,
      ipoRestrictedTickers,
      launchedTickers,
      rarityTiers,
      crewStats,
      storedReviewChanges,
      siteMessages,
      dividendTierOverrides,
    ],
  );

  // Always the value from the latest render, so a handler sees the same prices
  // the screen shows when it is clicked.
  const latest = useRef(market);
  latest.current = market;
  const getMarket = useCallback(() => latest.current, []);
  const access = useMemo((): MarketAccessValue => ({ marketStatus, getMarket }), [marketStatus, getMarket]);

  return (
    <MarketProvider market={market} access={access}>
      {children}
    </MarketProvider>
  );
}
