// Questions that have their answer: one line each with how the player did.
// Admins can hide a line once nobody needs it; with nothing left, the whole
// section goes away.
import { themeClasses, getChangeColors } from '../../../utils/theme';
import { formatCurrency } from '../../../utils/formatters';
import { useSession } from '../../../context/AppContext';
import type { EventMarketDoc } from '../../../types';
import { winnersOf } from '../utils/odds';

// Futures keep their answer list in `outcomes`, so the winner is `outcome` alone.
const winners = (p: EventMarketDoc) => (p.type === 'event' ? (p.outcome ? [p.outcome] : []) : winnersOf(p));

interface SettledListProps {
  items: EventMarketDoc[];
  isAdmin?: boolean;
  onHide: (id: string) => void;
}

const SettledList = ({ items, isAdmin, onHide }: SettledListProps) => {
  const { userData } = useSession();
  const { textClass, mutedClass, divideClass, borderClass } = themeClasses;
  if (items.length === 0) return null;
  const cb = !!userData?.colorBlindMode;

  // [text, won?] for the player's result, or null when they weren't in it.
  const result = (p: EventMarketDoc): [string, boolean] | null => {
    const won = winners(p);
    if (p.type === 'event') {
      const pos = userData?.eventPositions?.[p.id];
      const winning = won.reduce((s, o) => s + (pos?.shares?.[o] || 0), 0);
      if (winning > 0) return [`Won ${formatCurrency(winning)}`, true];
      const putIn = Math.max(0, pos?.costBasis || 0);
      return putIn > 0 ? [`Lost ${formatCurrency(putIn)}`, false] : null;
    }
    const bet = userData?.bets?.[p.id];
    if (!bet) return null;
    return won.includes(bet.option ?? '')
      ? [bet.payout ? `Won ${formatCurrency(bet.payout)}` : 'Won', true]
      : [`Lost ${formatCurrency(bet.amount)}`, false];
  };

  return (
    <section className="mt-8">
      <h2 className={`text-sm font-bold mb-2 ${textClass}`}>Settled</h2>
      <ul className={`text-sm border-y divide-y ${borderClass} ${divideClass}`}>
        {items.map((p) => {
          const r = result(p);
          return (
            <li key={p.id} className="py-2 flex items-baseline justify-between gap-3">
              <span className={`min-w-0 ${textClass}`}>
                {p.question} <span className={mutedClass}>{winners(p).join(' & ')}</span>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => onHide(p.id)}
                    className={`ml-2 text-xs underline ${mutedClass} hover:text-orange-500`}
                  >
                    Hide
                  </button>
                )}
              </span>
              <span
                className={`shrink-0 tabular-nums font-semibold ${r ? getChangeColors(r[1], cb).text : `font-normal ${mutedClass}`}`}
              >
                {r ? r[0] : 'No bet'}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default SettledList;
