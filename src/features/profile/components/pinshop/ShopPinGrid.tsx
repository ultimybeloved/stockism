import { themeClasses } from '../../../../utils/theme';
import { pixelatedIfSvg } from '../../../../constants/crests';
import { shortPrice } from '../../utils/shopCatalog';
import type { ShopPin } from '../../../../crews';

interface ShopPinGridProps {
  pins: ShopPin[];
  selectedId: string | null;
  owned: Set<string>;
  onPick: (pin: ShopPin) => void;
  /** A limited-time collection: shown under its name with the last day on sale. */
  limited?: { name: string; endsAt: number | null };
}

// "Sun, Nov 29, 23:59 UTC"
const endLabel = (ms: number) =>
  new Date(ms).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
  }) + ' UTC';

// Pins for sale, one grid, most expensive first. The Black Card keeps a gold
// edge. Tapping one tries it on the preview row. A limited collection gets
// its own grid under a heading that says when it leaves the shop.
const ShopPinGrid = ({ pins, selectedId, owned, onPick, limited }: ShopPinGridProps) => {
  const { textClass, mutedClass } = themeClasses;
  const grid = (
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
  if (!limited) return grid;
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className={`text-sm font-bold ${textClass}`}>{limited.name}</h3>
        <span className={`text-xs ${mutedClass}`}>
          <b className="text-orange-500">Limited.</b>
          {limited.endsAt != null && ` Leaves the shop ${endLabel(limited.endsAt)}`}
        </span>
      </div>
      {grid}
    </section>
  );
};

export default ShopPinGrid;
