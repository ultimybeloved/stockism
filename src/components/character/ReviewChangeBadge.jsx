import { useAppContext } from '../../context/AppContext';
import { getThemeClasses } from '../../utils/theme';
import { formatCurrency, emphasisMarks } from '../../utils/formatters';

// The chapter-review adjustment on a card in the Review tab.
//
// This exists because the number people care about there is what the admin set
// during the review, and the card's own price stops matching it the moment the
// market reopens and trading takes over. So the badge shows both halves of the
// story: the adjustment itself, and how far the market has carried the price
// away from it since. The second figure is live, recomputed from the current
// price on every render.
//
// Gold framing on purpose: it must not read as another up/down number. The
// percentages keep the normal up/down colours (teal/purple in colour-blind
// mode), and the frame never competes with them.
const ReviewChangeBadge = ({ change, currentPrice }) => {
  const { darkMode, userData } = useAppContext();
  const { mutedClass } = getThemeClasses(darkMode);
  const colorBlindMode = userData?.colorBlindMode || false;

  if (!change || typeof change.percentChange !== 'number') return null;

  const toneFor = (pct) => (pct > 0
    ? (colorBlindMode ? 'text-teal-400' : 'text-green-400')
    : pct < 0
      ? (colorBlindMode ? 'text-purple-400' : 'text-red-400')
      : mutedClass);
  const signed = (pct) => `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;

  const reviewPct = change.percentChange;

  // Drift since the adjustment: from the price the admin set to the live price.
  const setPrice = change.newPrice;
  const sincePct = (setPrice > 0 && typeof currentPrice === 'number')
    ? ((currentPrice - setPrice) / setPrice) * 100
    : null;

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
        <span className={`font-extrabold text-base leading-none ${toneFor(reviewPct)}`}>
          {signed(reviewPct)}{emphasisMarks(reviewPct)}
        </span>
      </div>
      <p className={`text-[10px] mt-0.5 ${mutedClass}`}>
        {formatCurrency(change.oldPrice)} → {formatCurrency(setPrice)}
        {sincePct !== null && (
          <>
            {' · since then '}
            <span className={`font-semibold ${toneFor(sincePct)}`}>{signed(sincePct)}</span>
          </>
        )}
      </p>
    </div>
  );
};

export default ReviewChangeBadge;
