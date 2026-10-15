// Phones: long positions as compact rows. Tap one for its details and history
// in a sheet from the bottom; swipe left to sell, right to buy more.
import { useState } from 'react';
import SwipeRow from './SwipeRow';
import PositionDetail, { type PositionActions } from './PositionDetail';
import SheetHandle from '../../../shared/components/SheetHandle';
import { useSheetRef } from '../../../shared/hooks/useSwipeToClose';
import { useEscapeKey } from '../../../shared/hooks/useEscapeKey';
import { useSession } from '../../../context/AppContext';
import { themeClasses } from '../../../utils/theme';
import { formatCurrency, formatChange } from '../../../utils/formatters';
import { formatShares } from '../utils/shared';
import type { PortfolioItem } from '../utils/buildPositionItems';

const PositionSheet = ({
  item,
  weight,
  onClose,
  ...actions
}: PositionActions & { item: PortfolioItem; weight: number; onClose: () => void }) => {
  const sheetRef = useSheetRef(onClose);
  useEscapeKey(onClose);
  const { sheetOverlayClass, sheetShellClass, textClass, mutedClass } = themeClasses;
  // An order form opened from here replaces the sheet.
  const close =
    <A extends unknown[]>(fn: (...a: A) => void) =>
    (...a: A) => {
      onClose();
      fn(...a);
    };
  return (
    <div className={`${sheetOverlayClass} z-50`} onClick={onClose}>
      <div ref={sheetRef} className={`${sheetShellClass} p-4 md:max-w-2xl`} onClick={(e) => e.stopPropagation()}>
        <SheetHandle />
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <h3 className="text-orange-500 font-mono text-lg font-bold">${item.ticker}</h3>
            <p className={`text-sm ${mutedClass}`}>{item.character?.name}</p>
          </div>
          <span className={`text-lg font-bold ${textClass}`}>{formatCurrency(item.value)}</span>
        </div>
        <PositionDetail
          item={item}
          weight={weight}
          {...actions}
          onOrder={close(actions.onOrder)}
          onSellAll={close(actions.onSellAll)}
          onLimitSell={actions.onLimitSell && close(actions.onLimitSell)}
        />
      </div>
    </div>
  );
};

const PositionList = ({
  items,
  totalValue,
  ...actions
}: PositionActions & { items: PortfolioItem[]; totalValue: number }) => {
  const { userData, getColorBlindColors } = useSession();
  const { textClass, mutedClass } = themeClasses;
  const [open, setOpen] = useState<string | null>(null);
  const openItem = items.find((i) => i.ticker === open);
  const weightOf = (i: PortfolioItem) => (totalValue > 0 ? (i.value / totalValue) * 100 : 0);

  return (
    <>
      <div className="space-y-1.5">
        {items.map((item) => (
          <SwipeRow
            key={item.ticker}
            onSwipeLeft={() => actions.onOrder(item.ticker, 'sell')}
            onSwipeRight={() => actions.onOrder(item.ticker, 'buy')}
            colorBlindMode={userData?.colorBlindMode}
          >
            <button
              type="button"
              onClick={() => setOpen(item.ticker)}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left rounded-sm border light:border-amber-200 dark:border-zinc-800"
            >
              <div className="min-w-0 flex-1">
                <div className="text-orange-500 font-mono text-sm font-semibold">${item.ticker}</div>
                <div className={`text-xs truncate ${mutedClass}`}>
                  {formatShares(item.shares)} sh · {weightOf(item).toFixed(0)}%
                </div>
              </div>
              <div className="text-right">
                <div className={`text-sm font-semibold ${textClass}`}>{formatCurrency(item.value)}</div>
                <div className={`text-xs ${getColorBlindColors(item.totalReturnDollar >= 0).text}`}>
                  {item.totalReturnDollar >= 0 ? '+' : ''}
                  {formatCurrency(item.totalReturnDollar)} ({formatChange(item.totalReturnPercent)})
                </div>
              </div>
            </button>
          </SwipeRow>
        ))}
      </div>
      {openItem && (
        <PositionSheet item={openItem} weight={weightOf(openItem)} onClose={() => setOpen(null)} {...actions} />
      )}
    </>
  );
};

export default PositionList;
