// Pure market statistics derived from local price history.
// No side effects, no Firebase, no React — see CLAUDE.md utils rules.

import { CHARACTER_MAP } from '../characters';

// Price at-or-before a timestamp, falling back to the oldest point.
const priceAt = (history, cutoff, fallback) => {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].timestamp <= cutoff) return history[i].price;
  }
  return history.length > 0 ? history[0].price : fallback;
};

// 24h percent change for a ticker.
export const get24hChange = (ticker, prices, priceHistory) => {
  const currentPrice = prices[ticker] || CHARACTER_MAP[ticker]?.basePrice || 0;
  const history = priceHistory[ticker] || [];
  if (history.length === 0) return 0;
  const price24hAgo = priceAt(history, Date.now() - 24 * 60 * 60 * 1000, currentPrice);
  return price24hAgo > 0 ? ((currentPrice - price24hAgo) / price24hAgo) * 100 : 0;
};

// Sentiment label from weighted 24h (60%) + 7d (40%) change.
export const getSentiment = (ticker, prices, priceHistory) => {
  const currentPrice = prices[ticker];
  if (!currentPrice) return 'Neutral';

  const history = priceHistory[ticker] || [];
  const now = Date.now();
  const price24hAgo = priceAt(history, now - 24 * 60 * 60 * 1000, currentPrice);
  const price7dAgo = priceAt(history, now - 7 * 24 * 60 * 60 * 1000, currentPrice);

  const dailyChange = price24hAgo > 0 ? ((currentPrice - price24hAgo) / price24hAgo) * 100 : 0;
  const weeklyChange = price7dAgo > 0 ? ((currentPrice - price7dAgo) / price7dAgo) * 100 : 0;
  const weightedChange = (dailyChange * 0.6) + (weeklyChange * 0.4);

  if (weightedChange > 3) return 'Strong Buy';
  if (weightedChange > 1) return 'Bullish';
  if (weightedChange < -3) return 'Strong Sell';
  if (weightedChange < -1) return 'Bearish';
  return 'Neutral';
};

// Trade activity proxy: price-history entry counts in the last day/week.
export const getTradeActivity = (history = []) => {
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const dayAgo = now - 24 * 60 * 60 * 1000;
  let weekTrades = 0;
  let dayTrades = 0;
  for (const entry of history) {
    if (entry.timestamp >= weekAgo) {
      weekTrades++;
      if (entry.timestamp >= dayAgo) dayTrades++;
    }
  }
  return { weekTrades, dayTrades };
};
