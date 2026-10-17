import { themeClasses } from '../../../../utils/theme';
import { pixelatedIfSvg } from '../../../../constants/crests';
import { shortPrice } from '../../utils/shopCatalog';
import type { ShopPin } from '../../../../crews';

interface ShopPinGridProps {
  pins: ShopPin[];
  selectedId: string | null;
  owned: Set<string>;
  onPick: (pin: ShopPin) => void;
}

// Pins for sale, one grid, most expensive first. The Black Card keeps a gold
// edge. Tapping one tries it on the preview row.
const ShopPinGrid = ({ pins, selectedId, owned, onPick }: ShopPinGridProps) => {
  const { textClass } = themeClasses;
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {pins.map((pin) => {
        const selected = pin.id === selectedId;
        const gold = pin.id === 'black_card';
        return (
          <button
            key={pin.id}
            type="button"
            onClick={() => onPick(pin)}
            aria-pressed={selected}
            className={`flex flex-col items-center gap-1 rounded-md border px-1.5 py-3 text-xs transition-colors light:bg-white dark:bg-zinc-900/40 ${
              selected
                ? 'border-orange-500 ring-1 ring-orange-500'
                : gold
                  ? 'border-amber-500/80 shadow-[0_0_14px_-4px_#f59e0b88]'
                  : 'light:border-amber-200 dark:border-zinc-800 light:hover:border-amber-400 dark:hover:border-zinc-600'
            }`}
          >
            <img
              src={`/pins/${pin.image}`}
              alt=""
              className="w-10 h-10 object-contain"
              style={pixelatedIfSvg(pin.image)}
            />
            <b className={`text-center leading-tight ${textClass}`}>{pin.name}</b>
            {owned.has(pin.id) ? (
              <span className="text-xs font-bold text-orange-500">Owned</span>
            ) : (
              <span className="text-[13px] font-bold text-amber-500">{shortPrice(pin.price)}</span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export default ShopPinGrid;
