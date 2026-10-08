import { getThemeClasses } from '../../utils/theme';

// Full-page states shown before the app itself can render. They sit outside the
// context provider, so they take the theme as a prop.

export const LoadingScreen = ({ darkMode }: { darkMode: boolean }) => {
  const { bgClass, mutedClass } = getThemeClasses(darkMode);
  return (
    <div className={`min-h-screen ${bgClass} flex items-center justify-center`}>
      <div className={`text-lg ${mutedClass}`}>Loading Stockism...</div>
    </div>
  );
};

// Never reached the market data at all. Rendering the app here would fill every
// price with the character's basePrice, because roughly twenty components fall
// back to it, and present those invented numbers as live prices. That is what
// archive crawlers were capturing, and what a player with a stalled connection
// was being shown. Say so instead.
//
// Only shown when the FIRST read fails. A later failure keeps the real prices
// already on screen.
export const MarketUnavailableScreen = ({ darkMode }: { darkMode: boolean }) => {
  const { bgClass, mutedClass, textClass } = getThemeClasses(darkMode);
  return (
    <div className={`min-h-screen ${bgClass} flex items-center justify-center p-6`}>
      <div className="text-center max-w-sm">
        <p className={`text-lg ${textClass} mb-2`}>Live market data is unavailable</p>
        <p className={`text-sm ${mutedClass} mb-4`}>
          Prices could not be loaded, so none are shown rather than showing numbers that are not real. Try again in a
          moment.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold rounded-sm"
        >
          Reload
        </button>
        <p className={`text-xs ${mutedClass} mt-4`}>
          A plain snapshot of the current market is always available at{' '}
          <a href="/snapshot" className="text-orange-500 underline">
            /snapshot
          </a>
          .
        </p>
      </div>
    </div>
  );
};
