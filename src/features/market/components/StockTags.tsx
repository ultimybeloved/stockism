import { useTheme } from '../../../context/AppContext';
import { CREWS } from '../../../crews';
import { CHARACTERS, type Character } from '../../../characters';
import { fundsContaining } from '../../../utils/marketFilters';
import { themeClasses, getReadableCrewColor } from '../../../utils/theme';
import CrewPin from '../../../shared/components/CrewPin';

// The chips beside a stock's name: every crew it belongs to (a character can
// be in more than one, TOM is in Fist Gang and WTJC) and every fund that holds
// it. One component so the cards, the chart window, the desktop stock window
// and the stock page can't drift apart. Funds themselves get no chips.
const SIZES = {
  // Cards: small and muted, they sit in a tight grid.
  sm: { chip: 'gap-0.5 text-[10px] px-1', pin: 'w-3 h-3' },
  // The big chart views.
  md: { chip: 'gap-1 text-xs px-1.5 py-0.5', pin: 'w-3.5 h-3.5' },
} as const;

const StockTags = ({
  character,
  size = 'md',
  className = 'inline-flex',
}: {
  character: Character;
  size?: keyof typeof SIZES;
  /** Layout of the row itself (spacing around it). */
  className?: string;
}) => {
  const { darkMode } = useTheme();
  if (character.isETF) return null;
  const crews = Object.values(CREWS).filter((c) => c.members.includes(character.ticker));
  const funds = fundsContaining(CHARACTERS, character.ticker);
  if (crews.length === 0 && funds.length === 0) return null;
  const s = SIZES[size];

  return (
    <span className={`${className} flex-wrap items-center gap-1`}>
      {crews.map((crew) => (
        <span
          key={crew.id}
          className={`flex items-center rounded font-semibold ${s.chip} ${size === 'sm' ? themeClasses.mutedClass : ''}`}
          style={{
            backgroundColor: crew.color + '22',
            border: `1px solid ${crew.color}55`,
            ...(size === 'md' ? { color: getReadableCrewColor(crew.color, darkMode) } : {}),
          }}
        >
          <CrewPin crew={crew} className={s.pin} />
          {crew.name}
        </span>
      ))}
      {funds.map((etf) => (
        <span
          key={etf.ticker}
          title={etf.name}
          className={`font-mono rounded ${s.chip} light:bg-purple-100 light:text-purple-700 dark:bg-purple-900/40 dark:text-purple-300`}
        >
          {etf.ticker}
        </span>
      ))}
    </span>
  );
};

export default StockTags;
