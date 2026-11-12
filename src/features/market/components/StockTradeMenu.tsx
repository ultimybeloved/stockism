// The stock page's Buy, Sell, Short and Cover buttons (tablets and desktops),
// always showing. Phones use StickyTradeBar instead.
import type { TradeAction } from '../../../types';

interface StockTradeMenuProps {
  marketClosed: boolean;
  canSell: boolean;
  canCover: boolean;
  colorBlindMode: boolean;
  onAction: (action: TradeAction) => void;
}

const StockTradeMenu = ({ marketClosed, canSell, canCover, colorBlindMode, onAction }: StockTradeMenuProps) => {
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
  const actions: [TradeAction, string, boolean][] = [
    ['buy', `text-white ${colorBlindMode ? 'bg-teal-600 hover:bg-teal-700' : 'bg-green-600 hover:bg-green-700'}`, true],
    [
      'sell',
      `text-white ${colorBlindMode ? 'bg-purple-600 hover:bg-purple-700' : 'bg-red-600 hover:bg-red-700'}`,
      canSell,
    ],
    ['short', 'border-2 border-orange-500 text-orange-500 hover:bg-orange-500/10', true],
    ['cover', 'border-2 border-blue-500 text-blue-500 hover:bg-blue-500/10', canCover],
  ];
  return (
    <div className="max-md:hidden grid grid-cols-2 gap-2 mt-3 w-64">
      {actions.map(([action, cls, enabled]) => (
        <button
          key={action}
          disabled={!enabled}
          onClick={() => onAction(action)}
          className={`py-1.5 text-xs font-semibold uppercase rounded-sm ${cls} disabled:opacity-40`}
        >
          {action}
        </button>
      ))}
    </div>
  );
};

export default StockTradeMenu;
