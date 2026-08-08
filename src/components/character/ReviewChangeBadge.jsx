import { useAppContext } from '../../context/AppContext';
import { getThemeClasses } from '../../utils/theme';
import { formatCurrency } from '../../utils/formatters';

// The chapter-review adjustment on a card in the Review tab.
//
// This exists because the number people actually care about there is what the
// admin set during the review, and the card's own price and 24h change stop
// matching it the moment the market reopens and trading moves the price. Two
// different numbers on one card is confusing for the rest of the week, so this
// says plainly which one is the review and that the price has moved on.
//
// Gold framing on purpose: it must not read as another up/down number. The
// percentage keeps the normal up/down colours (teal/purple when colour-blind
// mode is on), the frame never competes with them.
const ReviewChangeBadge = ({ change }) => {
  const { darkMode, userData } = useAppContext();
  const { mutedClass } = getThemeClasses(darkMode);
  const colorBlindMode = userData?.colorBlindMode || false;

  if (!change || typeof change.percentChange !== 'number') return null;

  const up = change.percentChange > 0;
  const pctClass = up
    ? (colorBlindMode ? 'text-teal-400' : 'text-green-400')
    : (colorBlindMode ? 'text-purple-400' : 'text-red-400');

  return (
    <div
      className={`mb-2 rounded-sm border-l-4 border border-amber-500/40 border-l-amber-500 px-2 py-1.5 ${
        darkMode ? 'bg-amber-500/10' : 'bg-amber-50'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-amber-500">
          📖 Chapter Review
        </span>
        <span className={`font-extrabold text-base leading-none ${pctClass}`}>
          {up ? '+' : ''}{change.percentChange.toFixed(2)}%!
        </span>
      </div>
      <p className={`text-[10px] mt-0.5 ${mutedClass}`}>
        Set to {formatCurrency(change.newPrice)} from {formatCurrency(change.oldPrice)}. Trading has moved it since.
      </p>
    </div>
  );
};

export default ReviewChangeBadge;
