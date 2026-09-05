import { useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { getThemeClasses } from '../../utils/theme';
import { formatCurrency } from '../../utils/formatters';
import { CREWS } from '../../crews';
import { CHARACTERS } from '../../characters';
import { fundsContaining } from '../../utils/marketFilters';

// The metadata under a card's name: crew badge, the funds a character belongs
// to, the description, and (for a fund) its constituents with a show-more
// toggle. Split out of CharacterCard when it hit its 400-line limit.
//
// It owns the expand state and derives its own crew/fund lookups because
// nothing else on the card reads them.
const CharacterMeta = ({ character }) => {
  const { darkMode, prices } = useAppContext();
  const { mutedClass } = getThemeClasses(darkMode);
  const [etfExpanded, setEtfExpanded] = useState(false);

  const isETF = character.isETF;
  // Every crew, not the first — a character can be in more than one.
  const characterCrews = !isETF
    ? Object.values(CREWS).filter(c => c.members.includes(character.ticker))
    : [];
  const characterEtfs = fundsContaining(CHARACTERS, character.ticker, isETF);

  // Constituents read best most-expensive first.
  const sorted = isETF && character.constituents
    ? [...character.constituents].sort((a, b) => (prices?.[b] || 0) - (prices?.[a] || 0))
    : [];
  const hasMore = sorted.length > 6;

  return (
    <>
      {!isETF && (characterCrews.length > 0 || characterEtfs.length > 0) && (
        <div className="flex flex-wrap gap-1 mt-0.5">
          {characterCrews.map(crew => (
            <span key={crew.id} className={`flex items-center gap-0.5 text-[10px] px-1 rounded font-semibold ${mutedClass}`} style={{ backgroundColor: crew.color + '22', border: `1px solid ${crew.color}55` }}>
              <img src={crew.icon} alt="" className="w-3 h-3 object-contain" />
              {crew.name}
            </span>
          ))}
          {characterEtfs.map(etf => (
            <span key={etf.ticker} className={`text-[10px] font-mono px-1 rounded ${darkMode ? 'bg-purple-900/40 text-purple-300' : 'bg-purple-100 text-purple-700'}`}>
              {etf.ticker}
            </span>
          ))}
        </div>
      )}
      {character.description && <p className={`text-xs ${mutedClass}${isETF ? ' mt-0.5' : ''}`}>{character.description}</p>}
      {isETF && character.constituents && (
        <div className="flex flex-wrap gap-1 mt-1">
          {(etfExpanded ? sorted : sorted.slice(0, 6)).map(t => (
            <span key={t} className={`text-[10px] font-mono px-1 rounded ${darkMode ? 'bg-purple-900/40 text-purple-300' : 'bg-purple-100 text-purple-700'}`}>
              {t}{etfExpanded && prices?.[t] ? ` ${formatCurrency(prices[t])}` : ''}
            </span>
          ))}
          {hasMore && (
            <button
              onClick={(e) => { e.stopPropagation(); setEtfExpanded(!etfExpanded); }}
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
