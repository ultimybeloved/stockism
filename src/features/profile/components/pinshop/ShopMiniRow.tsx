import { memo } from 'react';
import { getCosmeticStyles } from '../../../../utils/cosmetics';
import { themeClasses } from '../../../../utils/theme';
import { formatCurrency } from '../../../../utils/formatters';
import { useSession } from '../../../../context/AppContext';
import CosmeticLayers from '../../../../shared/components/cosmetics/CosmeticLayers';
import CosmeticName from '../../../../shared/components/cosmetics/CosmeticName';
import type { Cosmetic } from '../../../../constants/cosmetics';
import type { CosmeticStyle, FrameTrend } from '../../../../rules/cosmetics';

interface ShopMiniRowProps {
  cosmetic: Cosmetic;
  /** Premium cards hide the rank and the value to fit two across. */
  compact?: boolean;
  style?: CosmeticStyle;
  /** Bull / Bear: which day to show ('split' = both halves). */
  trend?: FrameTrend | 'split';
}

// The player's own leaderboard row wearing one shop item, live, for the shop
// cards. Same pieces as the real row, just this one item on.
const ShopMiniRow = ({ cosmetic, compact, style, trend = 'split' }: ShopMiniRowProps) => {
  const { userData, holdings } = useSession();
  const { textClass, mutedClass } = themeClasses;
  const name = userData?.displayName || 'You';
  const cosmetics = getCosmeticStyles({ [cosmetic.type]: cosmetic.id }, null, { seedKey: name, trend, style });
  const { glowColor, rowClass, rowStyle, layers } = cosmetics;
  const holdingsCount = Object.values(holdings || {}).filter((s) => s > 0).length;
  return (
    <div
      className={`relative flex items-center gap-2 rounded-sm border light:border-amber-200 light:bg-amber-50 dark:border-zinc-800 dark:bg-zinc-900/50 pointer-events-none ${
        compact ? 'px-2.5 py-2' : 'p-3 gap-3'
      } ${rowClass}`}
      data-trend={cosmetics.frameTrend}
      style={{ ...rowStyle, ...(glowColor ? { boxShadow: `0 0 18px ${glowColor}50` } : {}) }}
    >
      <CosmeticLayers {...layers} seedKey={name} />
      {!compact && <div className={`w-8 text-center font-bold ${mutedClass}`}>#4</div>}
      <div className="flex-1 min-w-0">
        <div className={`font-semibold truncate ${textClass} ${compact ? 'text-sm' : ''}`}>
          <CosmeticName name={name} styles={cosmetics} />
        </div>
        <div className={`${compact ? 'text-[10px]' : 'text-xs'} ${mutedClass}`}>{holdingsCount} characters</div>
      </div>
      {!compact && (
        <div className={`text-right font-bold ${textClass}`}>{formatCurrency(userData?.portfolioValue || 0)}</div>
      )}
    </div>
  );
};

export default memo(ShopMiniRow);
