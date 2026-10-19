// Desktop, under the bet slip: every bet and position still waiting on an
// answer, colored by the section it's in.
import { themeClasses } from '../../../utils/theme';
import { formatCurrency } from '../../../utils/formatters';
import { useSession } from '../../../context/AppContext';
import type { EventMarketDoc } from '../../../types';

const OpenBets = ({ weekly, futures }: { weekly: EventMarketDoc[]; futures: EventMarketDoc[] }) => {
  const { userData } = useSession();
  const { textClass, mutedClass, divideClass, borderClass } = themeClasses;
  const rows = [
    ...weekly.flatMap((p) => {
      const bet = userData?.bets?.[p.id];
      return bet ? [{ id: p.id, q: p.question, answer: bet.option, amount: bet.amount, futures: false }] : [];
    }),
    ...futures.flatMap((m) => {
      const pos = userData?.eventPositions?.[m.id];
      const held = (m.outcomes || []).filter((o) => (pos?.shares?.[o] || 0) > 0);
      return held.length
        ? [
            {
              id: m.id,
              q: m.question,
              answer: held.join(', '),
              amount: Math.max(0, pos?.costBasis || 0),
              futures: true,
            },
          ]
        : [];
    }),
  ];
  if (rows.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className={`text-sm font-bold mb-2 ${textClass}`}>Your open bets</h2>
      <ul className={`text-sm border-y divide-y ${borderClass} ${divideClass}`}>
        {rows.map((r) => (
          <li key={r.id} className="py-2 flex justify-between gap-3">
            <span className={`min-w-0 ${textClass}`}>
              <span className={`block truncate text-xs ${mutedClass}`}>{r.q}</span>
              <b
                className={r.futures ? 'text-indigo-600 dark:text-indigo-400' : 'text-orange-600 dark:text-orange-400'}
              >
                {r.answer}
              </b>
            </span>
            <span className={`shrink-0 self-end tabular-nums ${textClass}`}>{formatCurrency(r.amount)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default OpenBets;
