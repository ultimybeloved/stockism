import React, { createContext, useContext } from 'react';

/**
 * AppContext - Shared state for the entire application
 * Provides access to user data, market data, and app settings across all pages
 * without prop drilling
 */
const AppContext = createContext(null);

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within AppProvider');
  }
  return context;
};

export const AppProvider = AppContext.Provider;
