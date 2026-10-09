import { themeClasses } from '../../../utils/theme';
import { formatCurrency } from '../../../utils/formatters';
import { formatShares } from '../utils/shared';
import type { Character } from '../../../characters';

export interface IpoHoldingItem {
  ticker: string;
  character?: Character;
  shares: number;
  price: number;
  total: number;
  maxPerUser: number;
}

// IPO holdings section of the portfolio modal (renders nothing when empty).
const IpoHoldingsList = ({ items }: { items: IpoHoldingItem[] }) => {
  if (!items || items.length === 0) return null;
  const { textClass, mutedClass } = themeClasses;

  return (
    <>
      <h3 className={`text-sm font-semibold ${textClass} mb-2 flex items-center gap-2`}>
        <span>🏷️</span> IPO Holdings
        <span className={`text-xs font-normal ${mutedClass}`}>({items.length})</span>
      </h3>
      <div className="space-y-2 mb-4">
        {items.map((item) => (
          <div
            key={`ipo-${item.ticker}`}
            className="rounded-sm border-2 p-3 light:border-indigo-400 light:bg-indigo-50 dark:border-indigo-600 dark:bg-indigo-950/30"
          >
            <div className="flex justify-between items-center">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-orange-500 font-mono font-semibold">${item.ticker}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded font-semibold light:bg-indigo-100 light:text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300">
                    IPO
                  </span>
                  <span className={`text-sm ${mutedClass}`}>{item.character?.name}</span>
                </div>
                <div className={`text-sm ${mutedClass} mt-1`}>
                  {formatShares(item.shares)} shares @ {formatCurrency(item.price)}
                  <span className="mx-1">•</span>
                  {formatShares(item.shares)}/{item.maxPerUser} allocation used
                </div>
              </div>
              <div className="text-right">
                <div className={`font-semibold ${textClass}`}>{formatCurrency(item.total)}</div>
                <div className={`text-xs ${mutedClass}`}>invested</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="border-b mb-4 light:border-amber-300 dark:border-zinc-700" />
    </>
  );
};

export default IpoHoldingsList;
