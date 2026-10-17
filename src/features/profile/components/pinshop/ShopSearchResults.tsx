import { themeClasses } from '../../../../utils/theme';
import { pixelatedIfSvg } from '../../../../constants/crests';
import { KIND_LABEL, shortPrice, type ShopEntry } from '../../utils/shopCatalog';
import ShopItemCard from './ShopItemCard';
import type { Cosmetic } from '../../../../constants/cosmetics';
import type { CosmeticStyle } from '../../../../rules/cosmetics';

interface ShopSearchResultsProps {
  results: ShopEntry[];
  selectedIds: Set<string>;
  selectedPinId: string | null;
  owned: Set<string>;
  salePriceOf: (c: Cosmetic) => number | undefined;
  style: CosmeticStyle;
  onStyle: (patch: CosmeticStyle) => void;
  onPick: (entry: ShopEntry) => void;
}

// While there's text in the search box: everything that matches, from every
// category, in one list, most expensive first.
const ShopSearchResults = ({
  results,
  selectedIds,
  selectedPinId,
  owned,
  salePriceOf,
  style,
  onStyle,
  onPick,
}: ShopSearchResultsProps) => {
  const { textClass, mutedClass } = themeClasses;
  if (!results.length) return <p className={`py-6 text-sm ${mutedClass}`}>Nothing matches.</p>;
  return (
    <div className="grid gap-2.5 grid-cols-1 sm:grid-cols-2 pt-4">
      {results.map((entry) =>
        entry.kind === 'cosmetic' ? (
          <ShopItemCard
            key={entry.item.id}
            cosmetic={entry.item}
            big={false}
            kind={KIND_LABEL[entry.item.type]}
            selected={selectedIds.has(entry.item.id)}
            owned={owned.has(entry.item.id)}
            salePrice={salePriceOf(entry.item)}
            style={style}
            onStyle={onStyle}
            onPick={() => onPick(entry)}
          />
        ) : (
          <button
            key={entry.item.id}
            type="button"
            onClick={() => onPick(entry)}
            aria-pressed={selectedPinId === entry.item.id}
            className={`flex items-center gap-3 rounded-md border p-3 text-left light:bg-white dark:bg-zinc-900/40 ${
              selectedPinId === entry.item.id
                ? 'border-orange-500 ring-1 ring-orange-500'
                : 'light:border-amber-200 dark:border-zinc-800 light:hover:border-amber-400 dark:hover:border-zinc-600'
            }`}
          >
            <img
              src={`/pins/${entry.item.image}`}
              alt=""
              className="w-9 h-9 object-contain"
              style={pixelatedIfSvg(entry.item.image)}
            />
            <b className={`text-[13px] ${textClass}`}>
              {entry.item.name}
              <span className={`ml-1.5 text-[11px] font-medium ${mutedClass}`}>{KIND_LABEL.pin}</span>
            </b>
            {owned.has(entry.item.id) ? (
              <span className="ml-auto text-xs font-bold text-orange-500">Owned</span>
            ) : (
              <span className="ml-auto text-[13px] font-bold text-amber-500">{shortPrice(entry.item.price)}</span>
            )}
          </button>
        ),
      )}
    </div>
  );
};

export default ShopSearchResults;
