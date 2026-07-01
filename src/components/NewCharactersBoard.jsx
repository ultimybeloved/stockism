import React from 'react';
import { CHARACTERS } from '../characters';
import { getThemeClasses } from '../utils/theme';
import { getWeekStart } from '../utils/date';

const NewCharactersBoard = ({ prices, priceHistory, darkMode, colorBlindMode = false, launchedTickers = [] }) => {
  const { cardClass, textClass, mutedClass } = getThemeClasses(darkMode);

  const weekStart = getWeekStart();

  // Find characters added this week
  const newCharacters = CHARACTERS.filter(char => {
    const addedDate = new Date(char.dateAdded);
    // Only show if added this week AND either not IPO-required or already launched
    const isNewThisWeek = addedDate >= weekStart;
    const isAvailable = !char.ipoRequired || launchedTickers.includes(char.ticker);
    return isNewThisWeek && isAvailable;
  }).sort((a, b) => new Date(a.dateAdded) - new Date(b.dateAdded));

  if (newCharacters.length === 0) return null;

  // Calculate weekly change for each new character
  const getWeeklyChange = (ticker) => {
    const currentPrice = prices[ticker];
    const history = priceHistory[ticker] || [];

    if (!currentPrice || history.length === 0) return 0;

    // Find price from start of week
    const weekStartTime = weekStart.getTime();
    const startPrice = history.find(h => h.timestamp >= weekStartTime)?.price || history[0]?.price || currentPrice;

    return startPrice > 0 ? ((currentPrice - startPrice) / startPrice) * 100 : 0;
  };

  return (
    <div className={`${cardClass} border rounded-sm p-3`}>
      <h3 className={`text-xs font-semibold uppercase tracking-wide mb-2 ${mutedClass}`}>
        🆕 New This Week ({newCharacters.length})
      </h3>
      <div className="max-h-48 overflow-y-auto space-y-1">
        {newCharacters.map(char => {
          const price = prices[char.ticker] || char.basePrice;
          const change = getWeeklyChange(char.ticker);
          return (
            <div key={char.ticker} className={`flex items-center justify-between py-1 border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'} last:border-0`}>
              <div className="min-w-0 flex-1">
                <span className={`text-sm font-semibold ${textClass}`}>{char.name}</span>
                <span className={`text-xs ${mutedClass} ml-1`}>${char.ticker}</span>
              </div>
              <div className="text-right ml-2">
                <span className={`text-sm font-bold ${textClass}`}>${(price || 0).toFixed(2)}</span>
                <span className={`text-xs ml-1 ${colorBlindMode ? (change >= 0 ? 'text-teal-500' : 'text-purple-500') : (change >= 0 ? 'text-green-500' : 'text-red-500')}`}>
                  {change >= 0 ? '▲' : '▼'}{Math.abs(change || 0).toFixed(1)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default NewCharactersBoard;
