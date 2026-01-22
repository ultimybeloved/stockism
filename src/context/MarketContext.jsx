// ============================================
// Market Context
// Provides market data state across the app
// ============================================

import React, { createContext, useContext } from 'react';
import { useMarket } from '../hooks/useMarket';

const MarketContext = createContext(null);

/**
 * Market Provider component
 * Wraps the app to provide market data state
 */
export const MarketProvider = ({ children }) => {
  const market = useMarket();

  return (
    <MarketContext.Provider value={market}>
      {children}
    </MarketContext.Provider>
  );
};

/**
 * Hook to access market context
 * @returns {Object} Market state and methods
 */
export const useMarketContext = () => {
  const context = useContext(MarketContext);
  if (!context) {
    throw new Error('useMarketContext must be used within a MarketProvider');
  }
  return context;
};

export default MarketContext;
