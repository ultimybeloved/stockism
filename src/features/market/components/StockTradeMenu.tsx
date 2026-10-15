// The stock page's Trade button (tablets and desktops): opens Buy, Sell,
// Short and Cover. Phones use StickyTradeBar instead.
import { useState } from 'react';
import { themeClasses } from '../../../utils/theme';
import type { TradeAction } from '../../../types';

interface StockTradeMenuProps {
  marketClosed: boolean;
  canSell: boolean;
  canCover: boolean;
  colorBlindMode: boolean;
  onAction: (action: TradeAction) => void;
}

const StockTradeMenu = ({ marketClosed, canSell, canCover, colorBlindMode, onAction }: StockTradeMenuProps) => {
  const [open, setOpen] = useState(false);
  const { mutedClass } = themeClasses;

  if (marketClosed) {
    return (
      <button
        disabled
        className="max-md:hidden mt-3 px-4 py-1.5 border border-red-500/30 text-red-400 opacity-60 text-sm font-semibold uppercase rounded-sm cursor-not-allowed"
      >
        Market Closed
      </button>
    );
  }
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="max-md:hidden mt-3 px-4 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold rounded-sm"
      >
        Trade
      </button>
    );
  }
  const actions: [TradeAction, string, boolean][] = [
    ['buy', colorBlindMode ? 'bg-teal-600 hover:bg-teal-700' : 'bg-green-600 hover:bg-green-700', true],
    ['sell', colorBlindMode ? 'bg-purple-600 hover:bg-purple-700' : 'bg-red-600 hover:bg-red-700', canSell],
    ['short', 'border-2 border-orange-500 text-orange-500 hover:bg-orange-500/10', true],
    ['cover', 'border-2 border-blue-500 text-blue-500 hover:bg-blue-500/10', canCover],
  ];
  return (
    <div className="max-md:hidden space-y-2 mt-3">
      <div className="grid grid-cols-2 gap-2">
        {actions.map(([action, cls, enabled]) => (
          <button
            key={action}
            disabled={!enabled}
            onClick={() => {
              onAction(action);
              setOpen(false);
            }}
            className={`py-1.5 text-xs font-semibold uppercase rounded-sm ${cls} text-white disabled:opacity-40`}
          >
            {action}
          </button>
        ))}
      </div>
      <button onClick={() => setOpen(false)} className={`w-full py-1 text-xs ${mutedClass} hover:text-orange-500`}>
        Cancel
      </button>
    </div>
  );
};

export default StockTradeMenu;
