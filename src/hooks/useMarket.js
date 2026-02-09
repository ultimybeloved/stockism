// ============================================
// useMarket Hook
// Market data state and subscriptions
// ============================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import { subscribeToMarket, subscribeToIPOs } from '../services/market';
import { CHARACTERS, CHARACTER_MAP } from '../characters';

/**
 * Custom hook for market data state and subscriptions
 * @returns {Object} Market state and methods
 */
export const useMarket = () => {
  const [prices, setPrices] = useState({});
  const [priceHistory, setPriceHistory] = useState({});
  const [marketData, setMarketData] = useState(null);
  const [activeIPOs, setActiveIPOs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Subscribe to market data
  useEffect(() => {
    const unsubscribe = subscribeToMarket(
      (newPrices, newHistory, data) => {
        setPrices(newPrices);
        setPriceHistory(newHistory);
        setMarketData(data);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // Subscribe to IPO data
  useEffect(() => {
    const unsubscribe = subscribeToIPOs(
      (ipoList) => {
        const now = Date.now();
        // Filter to only show active IPOs
        const active = ipoList.filter(ipo => {
          const inHypePhase = now < ipo.ipoStartsAt;
          const inBuyingPhase = now >= ipo.ipoStartsAt && now < ipo.ipoEndsAt && (ipo.sharesRemaining || 150) > 0;
          return inHypePhase || inBuyingPhase;
        });
        setActiveIPOs(active);
      },
      (err) => setError(err.message)
    );

    return () => unsubscribe();
  }, []);

  // Calculate 24h price changes
  const priceChanges = useMemo(() => {
    const changes = {};
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    CHARACTERS.forEach(char => {
      const ticker = char.ticker;
      const currentPrice = prices[ticker];
      const history = priceHistory[ticker] || [];

      if (currentPrice && history.length > 0) {
        // Find the price closest to 24 hours ago
        let priceOneDayAgo = history[0]?.price || currentPrice;

        for (const point of history) {
          if (point.timestamp >= oneDayAgo) {
            break;
          }
          priceOneDayAgo = point.price;
        }

        const change = priceOneDayAgo > 0 ? ((currentPrice - priceOneDayAgo) / priceOneDayAgo) * 100 : 0;
        changes[ticker] = {
          change: Math.round(change * 100) / 100,
          previousPrice: priceOneDayAgo
        };
      } else {
        changes[ticker] = { change: 0, previousPrice: currentPrice || char.basePrice };
      }
    });

    return changes;
  }, [prices, priceHistory]);

  // Get price for a specific ticker
  const getPrice = useCallback((ticker) => {
    return prices[ticker] || CHARACTER_MAP[ticker]?.basePrice || 0;
  }, [prices]);

  // Get price history for a specific ticker
  const getHistory = useCallback((ticker) => {
    return priceHistory[ticker] || [];
  }, [priceHistory]);

  // Get price change for a specific ticker
  const getChange = useCallback((ticker) => {
    return priceChanges[ticker]?.change || 0;
  }, [priceChanges]);

  return {
    prices,
    priceHistory,
    priceChanges,
    marketData,
    activeIPOs,
    loading,
    error,
    getPrice,
    getHistory,
    getChange
  };
};

export default useMarket;
