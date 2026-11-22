import { useState } from 'react';
import { useMarket } from '../../../context/AppContext';

import { themeClasses } from '../../../utils/theme';
import { formatCurrency } from '../../../utils/formatters';
import type { Character } from '../../../characters';
import StockTags from './StockTags';

// The metadata under a card's name: crew badges and the funds a character
// belongs to (StockTags), the description, and (for a fund) its constituents
// with a show-more toggle. Split out of CharacterCard when it hit its 400-line
// limit. It owns the expand state because nothing else on the card reads it.
const CharacterMeta = ({ character }: { character: Character }) => {
  const { prices } = useMarket();
  const { mutedClass } = themeClasses;
  const [etfExpanded, setEtfExpanded] = useState(false);

  const isETF = character.isETF;

  // Constituents read best most-expensive first.
  const sorted =
    isETF && character.constituents
      ? [...character.constituents].sort((a, b) => (prices?.[b] || 0) - (prices?.[a] || 0))
      : [];
  const hasMore = sorted.length > 6;

  return (
    <>
      <StockTags character={character} size="sm" className="flex mt-0.5" />
      {character.description && (
        <p className={`text-xs ${mutedClass}${isETF ? ' mt-0.5' : ''}`}>{character.description}</p>
      )}
      {isETF && character.constituents && (
        <div className="flex flex-wrap gap-1 mt-1">
          {(etfExpanded ? sorted : sorted.slice(0, 6)).map((t) => (
            <span
              key={t}
              className="text-[10px] font-mono px-1 rounded light:bg-purple-100 light:text-purple-700 dark:bg-purple-900/40 dark:text-purple-300"
            >
              {t}
              {etfExpanded && prices?.[t] ? ` ${formatCurrency(prices[t])}` : ''}
            </span>
          ))}
          {hasMore && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEtfExpanded(!etfExpanded);
              }}
              className={`text-[10px] ${mutedClass} hover:text-orange-500 cursor-pointer`}
            >
              {etfExpanded ? 'show less' : `+${sorted.length - 6} more`}
            </button>
          )}
        </div>
      )}
    </>
  );
};

export default CharacterMeta;
