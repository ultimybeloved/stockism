import { useMemo } from 'react';
import { useMarket } from '../../../context/AppContext';
import { CHARACTERS } from '../../../characters';
import { getWeekStart } from '../../../utils/date';
import { newThisWeek } from '../../../utils/marketFilters';

/** Characters added this week, with their price and move since the week began. For the header. */
export const useNewCharacters = () => {
  const { prices, priceHistory, launchedTickers } = useMarket();
  return useMemo(() => {
    const weekStart = getWeekStart();
    return newThisWeek(CHARACTERS, launchedTickers, weekStart).map((char) => {
      const currentPrice = prices[char.ticker] || char.basePrice;
      const history = priceHistory[char.ticker] || [];
      const weekStartTime = weekStart.getTime();
      const startPrice = history.find((h) => h.timestamp >= weekStartTime)?.price || history[0]?.price || currentPrice;
      const weeklyChange = startPrice > 0 ? ((currentPrice - startPrice) / startPrice) * 100 : 0;
      return { ...char, currentPrice, weeklyChange };
    });
  }, [prices, priceHistory, launchedTickers]);
};
