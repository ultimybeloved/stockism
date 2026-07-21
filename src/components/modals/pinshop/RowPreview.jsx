import { getCosmeticStyles } from '../../../utils/cosmetics';
import { getThemeClasses } from '../../../utils/theme';
import { formatCurrency } from '../../../utils/formatters';
import { useAppContext } from '../../../context/AppContext';
import PinDisplay from '../../common/PinDisplay';

// Live preview of the user's leaderboard row. Uses the exact cosmetic layering
// LeaderboardPage rows use (glow/backdrop inline styles + rowClass for animated
// effects + name color/class + PinDisplay), so what shows here is what every
// other player sees. Reads straight from userData, so it updates the moment
// anything is equipped or purchased.
const RowPreview = ({ portfolioValue }) => {
  const { darkMode, userData, holdings } = useAppContext();
  const { textClass, mutedClass } = getThemeClasses(darkMode);
  const { nameColor, nameClass, glowColor, backdropColor, rowClass } = getCosmeticStyles(userData?.activeCosmetics, userData?.ownedCosmetics);
  const holdingsCount = Object.values(holdings || {}).filter(s => s > 0).length;

  return (
    <div className="px-4 pt-3">
      <p className={`text-[10px] uppercase tracking-wide font-semibold ${mutedClass} mb-1`}>Your row on the leaderboard</p>
      <div
        className={`relative p-3 flex items-center gap-3 rounded-sm border ${darkMode ? 'border-zinc-800 bg-zinc-900/50' : 'border-amber-200 bg-amber-50'} ${rowClass}`}
        style={{
          ...(glowColor ? { boxShadow: `0 0 18px ${glowColor}50` } : {}),
          ...(backdropColor ? { backgroundColor: darkMode ? `${backdropColor}18` : `${backdropColor}12` } : {}),
        }}
      >
        <div className={`w-10 text-center font-bold ${mutedClass}`}>#?</div>
        <div className="flex-1 min-w-0">
          <div className={`font-semibold truncate ${textClass} flex items-center gap-1`}>
            <span className={nameClass} style={nameClass ? undefined : { color: nameColor }}>
              {userData?.displayName || 'You'}
            </span>
            <PinDisplay userData={userData} size="sm" />
          </div>
          <div className={`text-xs ${mutedClass}`}>{holdingsCount} characters</div>
        </div>
        <div className={`text-right font-bold ${textClass}`}>{formatCurrency(portfolioValue || 0)}</div>
      </div>
    </div>
  );
};

export default RowPreview;
