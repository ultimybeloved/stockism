import { CHARACTER_MAP } from '../characters';
import { getThemeClasses } from '../utils/theme';
import { formatCurrency, formatTimeRemaining } from '../utils/formatters';
import { IPO_TOTAL_SHARES, IPO_MAX_PER_USER } from '../constants';
import { useAppContext } from '../context/AppContext';

const IPOHypeCard = ({ ipo }) => {
  const { darkMode, userData } = useAppContext();
  const colorBlindMode = userData?.colorBlindMode || false;
  const { cardClass, textClass, mutedClass, subtleClass } = getThemeClasses(darkMode);

  const timeRemaining = ipo.ipoStartsAt - Date.now();
  const character = CHARACTER_MAP[ipo.ticker];

  return (
    <div className={`${cardClass} border rounded-sm p-4 relative overflow-hidden`}>
      {/* Animated gradient background */}
      <div className="absolute inset-0 bg-gradient-to-r from-orange-600/10 via-amber-500/10 to-orange-600/10 animate-pulse" />

      <div className="relative">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xl">🚀</span>
          <span className="text-xs font-bold uppercase text-orange-500 tracking-wider">IPO Coming Soon</span>
        </div>

        <h3 className={`text-lg font-bold ${textClass}`}>
          ${ipo.ticker} - {character?.name}
        </h3>

        {character?.description && (
          <p className={`text-sm ${mutedClass} mt-1 line-clamp-2`}>{character.description}</p>
        )}

        <div className={`mt-3 p-3 rounded-sm ${subtleClass}`}>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div>
              <p className={`text-xs ${mutedClass}`}>IPO Price</p>
              <p className={`text-lg font-bold ${colorBlindMode ? 'text-teal-500' : 'text-green-500'}`}>{formatCurrency(ipo.basePrice)}</p>
            </div>
            <div>
              <p className={`text-xs ${mutedClass}`}>Shares Available</p>
              <p className="text-lg font-bold text-orange-500">{ipo.totalShares || IPO_TOTAL_SHARES}</p>
            </div>
          </div>
        </div>

        <div className="mt-3 text-center">
          <p className={`text-xs ${mutedClass}`}>IPO Opens In</p>
          <p className={`text-xl font-bold text-orange-500`}>{formatTimeRemaining(timeRemaining)}</p>
        </div>

        <p className={`text-xs ${mutedClass} mt-2 text-center`}>
          Max {ipo.maxPerUser || IPO_MAX_PER_USER} shares per person • First come, first served
        </p>
      </div>
    </div>
  );
};

export default IPOHypeCard;
