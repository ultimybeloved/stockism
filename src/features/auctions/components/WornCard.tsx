import type { ReactNode } from 'react';
import { COSMETIC_MAP } from '../../../constants/cosmetics';
import { getCosmeticStyles } from '../../../utils/cosmetics';
import CosmeticLayers from '../../../shared/components/cosmetics/CosmeticLayers';
import { themeClasses } from '../../../utils/theme';

// A card wearing one cosmetic the way a leaderboard row does: an effect,
// backdrop or frame covers the whole card. A name effect has nothing to wear,
// so the card stays plain and the caller writes the name in its style.
const WornCard = ({
  itemId,
  seedKey,
  className = '',
  children,
}: {
  itemId: string;
  seedKey: string;
  className?: string;
  children: ReactNode;
}) => {
  const c = COSMETIC_MAP[itemId];
  const s = c && c.type !== 'nameColor' ? getCosmeticStyles({ [c.type]: c.id }, null, { seedKey }) : null;
  return (
    <div
      className={`relative overflow-hidden rounded-sm border ${themeClasses.cardClass} ${s?.rowClass || ''} flex flex-col items-center justify-center text-center p-4 ${className}`}
      data-trend={s?.frameTrend}
      style={s ? { ...s.rowStyle, ...(s.glowColor ? { boxShadow: `0 0 28px ${s.glowColor}66` } : {}) } : undefined}
    >
      {s && <CosmeticLayers {...s.layers} seedKey={seedKey} />}
      <div className="relative">{children}</div>
    </div>
  );
};

export default WornCard;
