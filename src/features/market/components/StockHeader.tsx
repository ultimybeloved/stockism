import type { ReactNode } from 'react';
import type { Character } from '../../../characters';
import type { PricePoint } from '../../../types';
import { formatCurrency, formatChange } from '../../../utils/formatters';
import { themeClasses } from '../../../utils/theme';
import { statusBadge, STATUS_MAP, statusOf } from '../../../constants/statuses';
import PixelIcon from '../../../shared/components/PixelIcon';
import StockTags from './StockTags';

interface StockHeaderProps {
  ticker: string;
  character: Character;
  currentPrice: number;
  /** The chart point under the finger or mouse, shown instead of the live price. */
  hovered: PricePoint | null;
  /** First price of the chart's range, and the range's change and label. */
  rangeFirst: number;
  rangeChange: number;
  rangeLabel: string;
  upColor: string;
  downColor: string;
  /** The trade buttons (computers; phones use the bar pinned to the bottom). */
  children?: ReactNode;
}

// The top of the stock page: ticker and badges, then the name with its crews
// and funds, on the left; the price and its change over the chart's range on
// the right. Kept short on phones so the chart shows without scrolling.
export default function StockHeader({
  ticker,
  character,
  currentPrice,
  hovered,
  rangeFirst,
  rangeChange,
  rangeLabel,
  upColor,
  downColor,
  children,
}: StockHeaderProps) {
  const { cardClass, textClass, mutedClass } = themeClasses;
  const change = hovered ? (rangeFirst > 0 ? ((hovered.price - rangeFirst) / rangeFirst) * 100 : 0) : rangeChange;
  const badge = !character.isETF && statusBadge(character);

  return (
    <div className={`${cardClass} border rounded-sm p-3 md:p-4 mb-3 md:mb-4`}>
      <div className="flex justify-between items-start gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-orange-500 font-mono text-lg md:text-xl font-bold">${ticker}</span>
            {character.isETF && <span className="text-xs bg-purple-600 text-white px-1.5 py-0.5 rounded">ETF</span>}
            {badge && (
              <span className="flex shrink-0" title={STATUS_MAP[statusOf(character)]?.hint}>
                <PixelIcon name={badge} className="w-5 h-5" />
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5">
            <p className={`text-sm ${mutedClass}`}>{character.name}</p>
            <StockTags character={character} />
          </div>
          {character.description && (
            <p className={`hidden md:block text-xs ${mutedClass} mt-0.5`}>{character.description}</p>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className={`text-xl md:text-2xl font-bold ${textClass}`}>
            {formatCurrency(hovered ? hovered.price : currentPrice)}
          </div>
          <div className={`text-sm font-semibold ${change >= 0 ? upColor : downColor}`}>
            {change >= 0 ? '▲' : '▼'} {formatChange(change)}
            <span className={`text-xs ml-1 font-normal ${mutedClass}`}>({rangeLabel})</span>
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}
