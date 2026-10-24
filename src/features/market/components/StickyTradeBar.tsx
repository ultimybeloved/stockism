// Phones: Buy and Sell pinned to the bottom of the stock page, above the
// bottom bar, the way trading apps do it. "More" opens Short and Cover.
import { useState } from 'react';
import { useSession } from '../../../context/AppContext';
import { useHideOnScroll } from '../../../shared/hooks/useHideOnScroll';
import { themeClasses } from '../../../utils/theme';
import { formatCurrency } from '../../../utils/formatters';
import type { TradeAction } from '../../../types';

interface StickyTradeBarProps {
  price: number;
  canSell: boolean;
  canCover: boolean;
  disabledReason: string | null;
  onAction: (action: TradeAction) => void;
}

const StickyTradeBar = ({ price, canSell, canCover, disabledReason, onAction }: StickyTradeBarProps) => {
  const { getColorBlindColors } = useSession();
  const navVisible = useHideOnScroll();
  const [more, setMore] = useState(false);
  const { cardClass, textClass, mutedClass } = themeClasses;
  const btn = 'flex-1 py-3 text-sm font-semibold uppercase rounded-sm disabled:opacity-40';

  return (
    <>
      {/* Room at the bottom of the page so the bar never covers the last card. */}
      <div className="md:hidden h-20" aria-hidden="true" />
      <div
        data-tour="trade"
        className={`md:hidden fixed inset-x-0 z-30 border-t px-3 py-2 transition-[bottom] duration-300 ${cardClass} ${
          navVisible ? 'bottom-16' : 'bottom-0'
        }`}
      >
        {disabledReason ? (
          <p className={`text-center text-sm font-semibold py-2 ${mutedClass}`}>{disabledReason}</p>
        ) : (
          <>
            {more && (
              <div className="flex gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => onAction('short')}
                  className={`${btn} border-2 border-orange-500 text-orange-500`}
                >
                  Short
                </button>
                <button
                  type="button"
                  disabled={!canCover}
                  onClick={() => onAction('cover')}
                  className={`${btn} border-2 border-blue-500 text-blue-500`}
                >
                  Cover
                </button>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className={`w-20 shrink-0 text-sm font-bold ${textClass}`}>{formatCurrency(price)}</span>
              <button
                type="button"
                onClick={() => onAction('buy')}
                className={`${btn} ${getColorBlindColors(true).bg} text-white`}
              >
                Buy
              </button>
              <button
                type="button"
                disabled={!canSell}
                onClick={() => onAction('sell')}
                className={`${btn} ${getColorBlindColors(false).bg} text-white`}
              >
                Sell
              </button>
              <button
                type="button"
                aria-expanded={more}
                onClick={() => setMore((m) => !m)}
                className={`px-3 py-3 text-sm font-semibold rounded-sm border light:border-amber-200 dark:border-zinc-700 ${mutedClass}`}
              >
                {more ? 'Less' : 'More'}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
};

export default StickyTradeBar;
