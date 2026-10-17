import { SHOP_CATEGORIES, type ShopCategory } from '../../utils/shopCatalog';

interface ShopCategoryTabsProps {
  value: ShopCategory;
  counts: Partial<Record<ShopCategory, number>>;
  onChange: (category: ShopCategory) => void;
}

// The shop's category header: classic connected tabs (not pills). Joined
// segments with dividers; pointing at one lights it up; the open one joins the
// panel below it with an orange top edge.
const ShopCategoryTabs = ({ value, counts, onChange }: ShopCategoryTabsProps) => (
  <div
    role="tablist"
    aria-label="Shop categories"
    className="flex shrink-0 mx-4 mt-3 overflow-x-auto scrollbar-hide rounded-t-md border-x border-t light:border-amber-200 light:bg-amber-50/70 dark:border-zinc-800 dark:bg-zinc-900/60"
  >
    {SHOP_CATEGORIES.map(([key, label]) => {
      const on = key === value;
      return (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={on}
          onClick={() => onChange(key)}
          className={`flex-1 shrink-0 sm:shrink sm:min-w-0 px-3 sm:px-1 py-2.5 text-xs sm:text-[13px] font-semibold whitespace-nowrap border-r border-b last:border-r-0 light:border-amber-200 dark:border-zinc-800 transition-colors ${
            on
              ? 'shadow-[inset_0_2px_0_#f97316] !border-b-transparent light:bg-white light:text-slate-900 dark:bg-zinc-900 dark:text-zinc-50'
              : 'light:text-zinc-500 light:hover:bg-amber-100/70 light:hover:text-slate-800 dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100'
          }`}
        >
          {label}
          {counts[key] ? (
            <span className="hidden sm:inline ml-1 text-[11px] font-medium opacity-55">{counts[key]}</span>
          ) : null}
        </button>
      );
    })}
  </div>
);

export default ShopCategoryTabs;
