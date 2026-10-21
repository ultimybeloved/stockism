import { Link } from 'react-router-dom';
import { useMarket, useSession } from '../../../context/AppContext';
import { CHARACTER_MAP } from '../../../characters';
import { get24hChange } from '../../../utils/marketStats';
import { formatCurrency } from '../../../utils/formatters';
import { themeClasses } from '../../../utils/theme';
import type { Crew } from '../../../crews';

// The crew's fund and the characters in it, each linking to its stock page.
const CrewStocks = ({ crew }: { crew: Crew }) => {
  const { prices, priceHistory } = useMarket();
  const { userData } = useSession();
  const { cardClass, textClass, mutedClass, subtleClass, borderClass } = themeClasses;
  const up = userData?.colorBlindMode ? 'text-teal-500' : 'text-emerald-500';
  const down = userData?.colorBlindMode ? 'text-purple-500' : 'text-red-500';

  const quote = (ticker: string) => {
    const price = prices[ticker];
    const change = get24hChange(ticker, prices, priceHistory);
    return (
      <span className="text-right whitespace-nowrap">
        <span className={`font-semibold ${textClass}`}>{price != null ? formatCurrency(price) : '-'}</span>{' '}
        <span className={`text-xs ${change >= 0 ? up : down}`}>
          {change >= 0 ? '+' : ''}
          {change.toFixed(1)}%
        </span>
      </span>
    );
  };

  const fund = crew.etf ? CHARACTER_MAP[crew.etf] : null;
  const members = crew.members.map((t) => CHARACTER_MAP[t]).filter((c) => c != null);

  return (
    <div className={`${cardClass} border rounded-sm overflow-hidden`}>
      {fund && (
        <Link
          to={`/stock/${fund.ticker}`}
          className={`flex items-center justify-between gap-3 p-4 border-b ${borderClass} hover:opacity-80`}
        >
          <span>
            <span className={`block text-xs uppercase tracking-wide ${mutedClass}`}>Crew fund</span>
            <span className={`font-bold ${textClass}`}>
              ${fund.ticker} <span className={`font-normal text-sm ${mutedClass}`}>{fund.name}</span>
            </span>
          </span>
          {quote(fund.ticker)}
        </Link>
      )}
      <div className={`px-4 pt-3 pb-1 text-xs uppercase tracking-wide ${mutedClass}`}>Characters</div>
      <ul className="p-2 pt-0">
        {members.map((c) => (
          <li key={c.ticker}>
            <Link
              to={`/stock/${c.ticker}`}
              className={`flex items-center justify-between gap-3 px-2 py-2 rounded-sm text-sm light:hover:bg-amber-50 dark:hover:bg-zinc-800`}
            >
              <span className="truncate">
                <span className={`font-semibold ${textClass}`}>${c.ticker}</span>{' '}
                <span className={mutedClass}>{c.name}</span>
              </span>
              {quote(c.ticker)}
            </Link>
          </li>
        ))}
      </ul>
      {members.length === 0 && <p className={`px-4 pb-4 text-sm ${mutedClass} ${subtleClass}`}>No characters yet.</p>}
    </div>
  );
};

export default CrewStocks;
