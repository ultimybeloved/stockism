import { formatCurrency } from '../../../../utils/formatters';
import { themeClasses } from '../../../../utils/theme';

export type BuyBarAction = 'buy' | 'equip' | 'restyle' | 'unequip' | null;

interface ShopBuyBarProps {
  name: string;
  price: number;
  /** The full price, struck through, when this is the featured item. */
  listPrice?: number;
  /** What the main button does: buy it, wear it, save a new style, or take it off. */
  action: BuyBarAction;
  canAfford: boolean;
  onAction: () => void;
  /** Cosmetics can be gifted; pins can't. */
  onGift?: () => void;
}

const LABEL: Record<Exclude<BuyBarAction, null>, string> = {
  buy: 'Buy',
  equip: 'Equip',
  restyle: 'Use this style',
  unequip: 'Take off',
};

// The bar under the shop list for whatever was tapped last. It sits below the
// list, never over it, so it can't hide an item.
const ShopBuyBar = ({ name, price, listPrice, action, canAfford, onAction, onGift }: ShopBuyBarProps) => {
  const { textClass, mutedClass } = themeClasses;
  const enabled = action !== 'buy' || canAfford;
  return (
    <div className="shrink-0 mx-4 mb-4 flex items-center gap-2.5 rounded-b-md border border-t-0 px-3.5 py-3 light:border-amber-200 light:bg-amber-50 dark:border-zinc-800 dark:bg-zinc-900">
      <b className={`flex-1 min-w-0 truncate text-sm ${textClass}`}>{name}</b>
      {action === 'buy' && (
        <span className="whitespace-nowrap text-sm font-bold text-amber-500">
          {listPrice != null && (
            <span className={`mr-1.5 text-xs line-through ${mutedClass}`}>{formatCurrency(listPrice)}</span>
          )}
          {formatCurrency(price)}
        </span>
      )}
      {onGift && (
        <button
          type="button"
          onClick={onGift}
          title="Buy this for another player"
          className="shrink-0 px-3 py-1.5 text-xs font-semibold rounded-sm light:bg-slate-200 light:hover:bg-slate-300 light:text-slate-700 dark:bg-zinc-700 dark:hover:bg-zinc-600 dark:text-zinc-200"
        >
          Gift
        </button>
      )}
      {action && (
        <button
          type="button"
          onClick={() => enabled && onAction()}
          disabled={!enabled}
          title={enabled ? undefined : 'Not enough cash'}
          className={`shrink-0 px-3.5 py-1.5 text-xs font-semibold rounded-sm ${
            !enabled
              ? 'light:bg-slate-100 light:text-slate-400 dark:bg-zinc-800 dark:text-zinc-500 cursor-not-allowed'
              : action === 'unequip'
                ? 'light:bg-slate-200 light:hover:bg-slate-300 light:text-slate-700 dark:bg-zinc-700 dark:hover:bg-zinc-600 dark:text-zinc-200'
                : 'bg-orange-600 hover:bg-orange-700 text-white'
          }`}
        >
          {LABEL[action]}
        </button>
      )}
    </div>
  );
};

export default ShopBuyBar;
